// ── Storage Abstraction: Sync-first with Local Fallback ──────
// Sole interface for workspace data persistence.
// Tries browser.storage.sync first (Firefox account sync),
// falls back to browser.storage.local on quota errors.
// Handles migration from pre-Phase-4 local-only schema.

const CHUNK_SIZE = 25
const QUOTA_BYTES = 102400
const QUOTA_BYTES_PER_ITEM = 8192
const QUOTA_THRESHOLD = 0.9
const SYNC_FAILED_KEY = 'syncFailed'

// Silence unused-variable lint warning for QUOTA_BYTES_PER_ITEM
// (kept as a documented constant per spec, used implicitly by chunk design)
void QUOTA_BYTES_PER_ITEM

// ── Read ─────────────────────────────────────────────────────

export async function getWorkspaces() {
  const failed = await isSyncFailed()
  if (failed) return readFromLocal()

  try {
    const syncData = await browser.storage.sync.get(null)
    if (syncData.wsIndex && Array.isArray(syncData.wsIndex) && syncData.wsIndex.length > 0) {
      return assembleFromSync(syncData)
    }
  } catch (e) {
    console.warn('[Workspaces] sync.get failed, using local fallback:', e)
  }

  return readFromLocal()
}

// ── Write ─────────────────────────────────────────────────────

export async function saveWorkspaces(workspaces) {
  const failed = await isSyncFailed()
  if (failed) {
    await browser.storage.local.set({ workspaces })
    return
  }

  // SYNC-03: proactive quota check before writing
  let used = 0
  try {
    used = await browser.storage.sync.getBytesInUse(null)
  } catch (e) {
    console.warn('[Workspaces] getBytesInUse failed, defaulting to 0:', e)
  }

  const items = serializeToSyncItems(workspaces)
  const estimated = Object.entries(items).reduce(
    (sum, [k, v]) => sum + k.length + JSON.stringify(v).length, 0
  )

  if (used + estimated > QUOTA_BYTES * QUOTA_THRESHOLD) {
    console.warn('[Workspaces] Near sync quota limit, falling back to local')
    await activateFallback(workspaces)
    return
  }

  try {
    // Delete stale chunk keys before writing (workspace may have fewer tabs now)
    await pruneStaleChunks(workspaces)
    await browser.storage.sync.set(items)
  } catch (e) {
    if (e.name === 'QuotaExceededError' ||
        (e.message && e.message.toLowerCase().includes('quota'))) {
      // SYNC-04: reactive fallback on quota exceeded
      console.warn('[Workspaces] Sync quota exceeded, falling back to local:', e)
      await activateFallback(workspaces)
    } else {
      throw e
    }
  }
}

// ── Migration ─────────────────────────────────────────────────

export async function migrateIfNeeded() {
  // wsIndex presence = already migrated (idempotent sentinel)
  const syncCheck = await browser.storage.sync.get('wsIndex')
  if (syncCheck.wsIndex) return

  // Check for old storage.local data
  const localData = await browser.storage.local.get('workspaces')
  if (!localData.workspaces || !Array.isArray(localData.workspaces) || localData.workspaces.length === 0) return

  try {
    await saveWorkspaces(localData.workspaces)
    await browser.storage.local.remove('workspaces')
    console.log('[Workspaces] Migrated', localData.workspaces.length, 'workspaces to sync storage')
  } catch (e) {
    // Migration failed — keep local data intact for fallback
    console.warn('[Workspaces] Migration failed, remaining on local storage:', e)
  }
}

// ── Workspace Deletion Cleanup ────────────────────────────────

export async function deleteWorkspaceFromSync(workspaceId) {
  try {
    const syncData = await browser.storage.sync.get('ws:' + workspaceId)
    const meta = syncData['ws:' + workspaceId]
    const chunkCount = meta ? (meta.tabChunks || 1) : 0
    const keysToRemove = ['ws:' + workspaceId]
    for (let i = 0; i < chunkCount; i++) {
      keysToRemove.push('ws:' + workspaceId + ':t:' + i)
    }
    await browser.storage.sync.remove(keysToRemove)
  } catch (e) {
    console.warn('[Workspaces] deleteWorkspaceFromSync failed (non-fatal):', e)
  }
}

// ── Serialization ─────────────────────────────────────────────

function serializeToSyncItems(workspaces) {
  const items = {}
  items.wsIndex = workspaces.map(ws => ws.id)

  for (const ws of workspaces) {
    const key = 'ws:' + ws.id
    // Strip favIconUrl from tabs before chunking (Pitfall 1: per-item quota)
    const strippedTabs = ws.tabs.map(t => ({ url: t.url, title: t.title, pinned: t.pinned }))
    const chunks = chunkArray(strippedTabs, CHUNK_SIZE)

    items[key] = {
      id: ws.id,
      name: ws.name,
      color: ws.color,
      createdAt: ws.createdAt,
      tabChunks: chunks.length,
    }

    for (let i = 0; i < chunks.length; i++) {
      items[key + ':t:' + i] = chunks[i]
    }
  }

  return items
}

// ── Assembly ──────────────────────────────────────────────────

function assembleFromSync(syncData) {
  const wsIndex = syncData.wsIndex || []
  const workspaces = []

  for (const id of wsIndex) {
    const meta = syncData['ws:' + id]
    if (!meta) continue  // orphan ID — skip

    const tabs = []
    for (let i = 0; i < (meta.tabChunks || 1); i++) {
      const chunk = syncData['ws:' + id + ':t:' + i]
      if (Array.isArray(chunk)) tabs.push(...chunk)
    }

    workspaces.push({
      id: meta.id,
      name: meta.name,
      color: meta.color,
      createdAt: meta.createdAt,
      tabs,
      // Note: favIconUrl not present in sync tabs — browser re-fetches on restore
    })
  }

  return workspaces
}

// ── Stale Chunk Pruning ───────────────────────────────────────

async function pruneStaleChunks(workspaces) {
  let syncData
  try {
    syncData = await browser.storage.sync.get(null)
  } catch (e) {
    console.warn('[Workspaces] pruneStaleChunks: could not read sync data:', e)
    return
  }

  const keysToRemove = []

  for (const ws of workspaces) {
    const newChunks = Math.ceil(ws.tabs.length / CHUNK_SIZE) || 1
    const meta = syncData['ws:' + ws.id]
    if (!meta) continue
    const oldChunks = meta.tabChunks || 1
    for (let i = newChunks; i < oldChunks; i++) {
      keysToRemove.push('ws:' + ws.id + ':t:' + i)
    }
  }

  if (keysToRemove.length > 0) {
    try {
      await browser.storage.sync.remove(keysToRemove)
    } catch (e) {
      // Non-fatal: stale keys are harmless orphans; assembleFromSync reads only up to tabChunks
      console.warn('[Workspaces] Stale chunk pruning failed (non-fatal):', e)
    }
  }
}

// ── Fallback ──────────────────────────────────────────────────

async function activateFallback(workspaces) {
  await browser.storage.local.set({ [SYNC_FAILED_KEY]: true, workspaces })
}

async function isSyncFailed() {
  const result = await browser.storage.local.get({ [SYNC_FAILED_KEY]: false })
  return result[SYNC_FAILED_KEY]
}

async function readFromLocal() {
  const result = await browser.storage.local.get('workspaces')
  return Array.isArray(result.workspaces) ? result.workspaces : []
}

// ── Helpers ───────────────────────────────────────────────────

function chunkArray(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks.length > 0 ? chunks : [[]]  // always at least one chunk
}
