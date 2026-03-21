// ── Workspace CRUD and Tab Operations ───────────────────────

import { getSessionState, setSessionState, getWindowMap, setWindowEntry } from './state.js'

export const COLORS = [
  { name: 'Blue',   hex: '#3b82f6' },
  { name: 'Red',    hex: '#ef4444' },
  { name: 'Green',  hex: '#22c55e' },
  { name: 'Purple', hex: '#a855f7' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Teal',   hex: '#14b8a6' },
  { name: 'Pink',   hex: '#ec4899' },
]

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/
const RECLAIM_THRESHOLD = 0.5

function sanitizeColor(value) {
  if (HEX_COLOR_RE.test(value)) return value
  return COLORS[0].hex  // fallback to Blue: #3b82f6
}

// ── Schema Validation ────────────────────────────────────────

export const DEFAULT_WORKSPACE_DATA = () => ({
  workspaces: [],
  activeWorkspaceId: null,
})

export function validateWorkspaceData(data) {
  if (!data || typeof data !== 'object') return DEFAULT_WORKSPACE_DATA()
  if (!Array.isArray(data.workspaces)) return DEFAULT_WORKSPACE_DATA()
  if (data.workspaces.length === 0) return DEFAULT_WORKSPACE_DATA()

  const validWorkspaces = data.workspaces.filter(ws =>
    ws !== null &&
    typeof ws === 'object' &&
    typeof ws.id === 'string' && ws.id.length > 0 &&
    typeof ws.name === 'string' &&
    typeof ws.color === 'string' &&
    Array.isArray(ws.tabs)
  )

  if (validWorkspaces.length === 0) return DEFAULT_WORKSPACE_DATA()

  const activeValid = validWorkspaces.some(ws => ws.id === data.activeWorkspaceId)
  return {
    workspaces: validWorkspaces,
    activeWorkspaceId: activeValid ? data.activeWorkspaceId : validWorkspaces[0].id,
  }
}

// ── Initialization ──────────────────────────────────────────

export async function initDefaultWorkspace(windowId) {
  const tabs = await browser.tabs.query({ windowId })
  const tabData = serializeTabs(tabs)

  const defaultWorkspace = {
    id: crypto.randomUUID(),
    name: 'Default',
    color: COLORS[0].hex,
    tabs: tabData,
    createdAt: Date.now(),
  }

  await browser.storage.local.set({
    workspaces: [defaultWorkspace],
    activeWorkspaceId: defaultWorkspace.id,
  })

  await setWindowEntry(windowId, defaultWorkspace.id)
  updateBadge(defaultWorkspace, windowId)
}

// ── Save Current Workspace ──────────────────────────────────

export async function saveCurrentWorkspace(windowId) {
  const state = await getSessionState()
  if (state.isSwitching) return

  try {
    const raw = await browser.storage.local.get(['workspaces'])
    const data = validateWorkspaceData(raw)
    if (!data.workspaces.length) return

    const windowMap = await getWindowMap()
    const workspaceId = windowMap[String(windowId)]
    if (!workspaceId) return

    const tabs = await browser.tabs.query({ windowId })
    const tabData = serializeTabs(tabs)

    // Don't save empty state (could be mid-switch or window closing)
    if (tabData.length === 0) return

    const idx = data.workspaces.findIndex(w => w.id === workspaceId)
    if (idx !== -1) {
      data.workspaces[idx].tabs = tabData
      await browser.storage.local.set({ workspaces: data.workspaces })
    }
  } catch (e) {
    console.error('[Workspaces] Save error:', e)
  }
}

// ── Switch Workspace ────────────────────────────────────────

export async function switchWorkspace(targetId, windowId) {
  await setSessionState({ isSwitching: true })
  let snapshot = null
  const createdTabIds = []

  try {
    const raw = await browser.storage.local.get(['workspaces'])
    const data = validateWorkspaceData(raw)
    if (!data.workspaces.length) throw new Error('No workspaces found')

    // Exclusive ownership check (D-01): reject if targetId is active in another window
    const windowMap = await getWindowMap()
    const currentWsId = windowMap[String(windowId)]

    for (const [wid, wsId] of Object.entries(windowMap)) {
      if (wsId === targetId && wid !== String(windowId)) {
        return { success: false, error: 'Workspace active in another window' }
      }
    }

    if (targetId === currentWsId) return { success: true }

    const currentTabs = await browser.tabs.query({ windowId })

    // Save current workspace tabs into data (mutates data.workspaces in memory)
    if (currentWsId) {
      const currentIdx = data.workspaces.findIndex(w => w.id === currentWsId)
      if (currentIdx !== -1) {
        data.workspaces[currentIdx].tabs = serializeTabs(currentTabs)
      }
    }

    // Snapshot AFTER updating current tabs, BEFORE opening new ones
    // Deep copy required — data.workspaces was mutated above
    snapshot = {
      workspaces: JSON.parse(JSON.stringify(data.workspaces)),
      previousWsId: currentWsId,
    }

    const target = data.workspaces.find(w => w.id === targetId)
    if (!target) throw new Error('Target workspace not found')

    // Determine tabs to open
    const tabsToCreate = target.tabs.length > 0
      ? target.tabs
      : [{ url: 'about:newtab', title: 'New Tab', pinned: false }]

    // Create new tabs in the target window (first one active, rest discarded to save RAM)
    for (let i = 0; i < tabsToCreate.length; i++) {
      const t = tabsToCreate[i]
      const isAbout = !t.url || t.url.startsWith('about:')
      const createProps = {
        windowId,
        active: i === 0,
        pinned: t.pinned || false,
      }

      if (!isAbout) {
        createProps.url = t.url
        if (i > 0) {
          createProps.discarded = true
          createProps.title = t.title || t.url
        }
      }

      try {
        const created = await browser.tabs.create(createProps)
        createdTabIds.push(created.id)
      } catch (err) {
        console.warn('[Workspaces] Tab create fallback for:', t.url, err)
        try {
          delete createProps.discarded
          delete createProps.title
          const created = await browser.tabs.create(createProps)
          createdTabIds.push(created.id)
        } catch (err2) {
          console.error('[Workspaces] Tab create failed entirely:', err2)
        }
      }
    }

    // DATA-01: Atomicity check — all tabs must be created before removing old ones
    if (createdTabIds.length !== tabsToCreate.length) {
      // DATA-02: Rollback — close partial tabs, restore snapshot
      await rollbackSwitch(createdTabIds, snapshot, windowId)
      return { success: false, error: 'Switch aborted: not all tabs could be created' }
    }

    // All tabs created successfully — safe to remove old ones
    const oldTabIds = currentTabs.map(t => t.id)
    if (oldTabIds.length > 0) {
      await browser.tabs.remove(oldTabIds)
    }

    // Persist workspaces (tab data update); do NOT write activeWorkspaceId to local storage
    await browser.storage.local.set({ workspaces: data.workspaces })

    // Update window-workspace map
    await setWindowEntry(windowId, targetId)

    updateBadge(target, windowId)

    return { success: true }

  } catch (e) {
    console.error('[Workspaces] Switch error:', e)
    // DATA-02: Rollback on unexpected error
    if (snapshot) await rollbackSwitch(createdTabIds, snapshot, windowId)
    return { success: false, error: e.message }
  } finally {
    await setSessionState({ isSwitching: false })
  }
}

// ── Rollback (compensation for failed switch) ───────────────

async function rollbackSwitch(createdTabIds, snapshot, windowId) {
  if (createdTabIds.length > 0) {
    try {
      await browser.tabs.remove(createdTabIds)
    } catch (e) {
      console.warn('[Workspaces] Rollback: tab removal failed:', e)
    }
  }
  if (snapshot) {
    try {
      await browser.storage.local.set({ workspaces: snapshot.workspaces })
      // Restore window map entry to previous value
      if (snapshot.previousWsId !== undefined) {
        await setWindowEntry(windowId, snapshot.previousWsId)
      }
    } catch (e) {
      console.error('[Workspaces] Rollback: storage restore failed:', e)
    }
  }
}

// ── Create Workspace ────────────────────────────────────────

export async function createWorkspace(name, color, windowId) {
  const raw = await browser.storage.local.get(['workspaces'])
  const { workspaces } = validateWorkspaceData(raw)

  const newWorkspace = {
    id: crypto.randomUUID(),
    name: name || `Workspace ${workspaces.length + 1}`,
    color: color ? sanitizeColor(color) : COLORS[workspaces.length % COLORS.length].hex,
    tabs: [],
    createdAt: Date.now(),
  }

  workspaces.push(newWorkspace)
  await browser.storage.local.set({ workspaces })

  // Switch to the new (empty) workspace
  await switchWorkspace(newWorkspace.id, windowId)

  return newWorkspace
}

// ── Delete Workspace ────────────────────────────────────────

export async function deleteWorkspace(workspaceId, windowId) {
  const raw = await browser.storage.local.get(['workspaces'])
  const data = validateWorkspaceData(raw)
  if (data.workspaces.length <= 1) {
    return { success: false, error: 'Cannot delete the last workspace' }
  }

  const idx = data.workspaces.findIndex(w => w.id === workspaceId)
  if (idx === -1) return { success: false, error: 'Workspace not found' }

  data.workspaces.splice(idx, 1)
  await browser.storage.local.set({ workspaces: data.workspaces })

  // If we deleted the active workspace for this window, switch to the first available
  const windowMap = await getWindowMap()
  const isActiveHere = windowMap[String(windowId)] === workspaceId
  if (isActiveHere) {
    await switchWorkspace(data.workspaces[0].id, windowId)
  }

  return { success: true }
}

// ── Update Workspace (rename / recolor) ─────────────────────

export async function updateWorkspace(workspaceId, updates, windowId) {
  const raw = await browser.storage.local.get(['workspaces'])
  const { workspaces } = validateWorkspaceData(raw)
  const idx = workspaces.findIndex(w => w.id === workspaceId)
  if (idx === -1) return { success: false, error: 'Not found' }

  if (updates.name !== undefined) workspaces[idx].name = updates.name
  if (updates.color !== undefined) workspaces[idx].color = sanitizeColor(updates.color)

  await browser.storage.local.set({ workspaces })

  // Update badge if this is the active workspace for this window
  const windowMap = await getWindowMap()
  if (windowMap[String(windowId)] === workspaceId) {
    updateBadge(workspaces[idx], windowId)
  }

  return { success: true }
}

// ── Assign Workspace (D-09) ──────────────────────────────────

export async function assignWorkspace(workspaceId, windowId) {
  const raw = await browser.storage.local.get(['workspaces'])
  const { workspaces } = validateWorkspaceData(raw)
  if (!workspaces.length) return { success: false, error: 'No workspaces found' }

  const workspace = workspaces.find(w => w.id === workspaceId)
  if (!workspace) return { success: false, error: 'Workspace not found' }

  // Exclusive ownership check (D-01)
  const windowMap = await getWindowMap()
  for (const [wid, wsId] of Object.entries(windowMap)) {
    if (wsId === workspaceId && wid !== String(windowId)) {
      return { success: false, error: 'Workspace active in another window' }
    }
  }

  // Save current window's tabs into the target workspace
  const tabs = await browser.tabs.query({ windowId })
  workspace.tabs = serializeTabs(tabs)

  await browser.storage.local.set({ workspaces })
  await setWindowEntry(windowId, workspaceId)
  updateBadge(workspace, windowId)

  return { success: true }
}

// ── Reclaim Workspaces on Restart (D-10) ────────────────────

export async function reclaimWorkspaces() {
  const raw = await browser.storage.local.get(['workspaces'])
  const { workspaces } = validateWorkspaceData(raw)
  if (!workspaces.length) return

  const windows = await browser.windows.getAll({ populate: true })
  const claimed = new Set()

  for (const win of windows) {
    const winUrls = new Set(
      (win.tabs || [])
        .map(t => t.url)
        .filter(u => u && !u.startsWith('about:') && !u.startsWith('moz-extension:'))
    )

    let bestScore = 0
    let bestWorkspace = null

    for (const ws of workspaces) {
      if (claimed.has(ws.id)) continue
      const wsUrls = ws.tabs.map(t => t.url)
      if (wsUrls.length === 0) continue
      const matches = wsUrls.filter(u => winUrls.has(u)).length
      const score = matches / wsUrls.length
      if (score > bestScore && score >= RECLAIM_THRESHOLD) {
        bestScore = score
        bestWorkspace = ws
      }
    }

    if (bestWorkspace) {
      await setWindowEntry(win.id, bestWorkspace.id)
      updateBadge(bestWorkspace, win.id)
      claimed.add(bestWorkspace.id)
    } else {
      updateBadge(null, win.id)
    }
  }
}

// ── Badge ───────────────────────────────────────────────────

export function updateBadge(workspace, windowId) {
  const opts = windowId !== undefined ? { windowId } : {}
  let text, color
  if (!workspace) {
    text = '?'
    color = '#888888'
  } else {
    text = workspace.name.charAt(0).toUpperCase()
    color = sanitizeColor(workspace.color)
  }
  browser.action.setBadgeText({ text, ...opts })
  browser.action.setBadgeBackgroundColor({ color, ...opts })
}

// ── Helpers ─────────────────────────────────────────────────

export function serializeTabs(tabs) {
  return tabs
    .filter(t => {
      // Keep about:newtab but skip other internal pages
      if (t.url.startsWith('about:') && t.url !== 'about:newtab') return false
      if (t.url.startsWith('moz-extension:')) return false
      return true
    })
    .map(t => ({
      url: t.url,
      title: t.title || t.url,
      pinned: t.pinned,
      favIconUrl: t.favIconUrl || '',
    }))
}
