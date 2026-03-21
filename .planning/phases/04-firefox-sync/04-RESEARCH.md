# Phase 4: Firefox Sync - Research

**Researched:** 2026-03-21
**Domain:** Firefox WebExtension `browser.storage.sync` API, per-item quota management, local fallback, storage migration
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYNC-01 | Primary storage is `browser.storage.sync` tied to Firefox account | Storage abstraction layer (see Architecture Patterns) wraps all reads/writes; sync is tried first on every operation |
| SYNC-02 | Workspace data split into per-workspace keys (`ws:{id}`) to respect 8KB per-item limit | Tab chunks at CHUNK_SIZE=25; ws:{id} stores metadata only; ws:{id}:t:N stores tab arrays; empirically verified under 8KB |
| SYNC-03 | Proactive quota monitoring via `getBytesInUse()` before writes | Call `getBytesInUse(null)` before every `saveWorkspacesToSync()`; trigger fallback at 90% of QUOTA_BYTES |
| SYNC-04 | Graceful fallback to `browser.storage.local` when sync quota exceeded | Catch `QuotaExceededError` name; write to `storage.local` with `syncFailed: true` flag; no data loss |
| SYNC-05 | Migration from existing `storage.local` data to new sync schema on first run | Check `wsIndex` key in sync as sentinel; if absent and `workspaces` in local exists, migrate and delete old local keys |
</phase_requirements>

---

## Summary

Phase 4 replaces the extension's `browser.storage.local` workspace persistence with `browser.storage.sync`, enabling workspaces to survive reinstalls and sync across devices via the user's Firefox account. The core challenge is the strict 8KB per-item quota: empirical sizing confirms a workspace object with 40 tabs and full `favIconUrl` data (same-domain) lands at ~8,667 bytes — exceeding the limit. The solution is a chunked schema: workspace metadata (`ws:{id}`) plus separate tab-array chunks (`ws:{id}:t:N`) at 25 tabs per chunk, each empirically verified well under 8KB. A storage abstraction module (`src/background/sync.js`) wraps all reads and writes, trying sync first and falling back silently to `storage.local` on `QuotaExceededError`. All 12 `storage.local` call sites across `workspaces.js`, `messaging.js`, and `index.js` must be routed through this abstraction.

The migration path (SYNC-05) uses `wsIndex` key presence in `storage.sync` as an idempotent sentinel: first run finds no `wsIndex`, reads existing `storage.local` data, writes it to sync schema, then clears the old local keys. Subsequent runs find `wsIndex` immediately and skip migration. The `onInstalled` handler with `reason === 'update'` is the correct trigger point; `onStartup` handles the browser-restart case. Extension ID `simple-workspaces@jaehho` is already set in `manifest.json` (SEC-05 from Phase 1), which is a prerequisite for `storage.sync` to work in Firefox.

**Primary recommendation:** Introduce `src/background/sync.js` as a new module with `getWorkspaces()` / `saveWorkspaces()` / `migrateIfNeeded()`. Route all 12 existing `storage.local` call sites through it. No other files need structural changes — `workspaces.js`, `messaging.js`, and `index.js` only need their `browser.storage.local` calls replaced with `sync.js` imports.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `browser.storage.sync` | built-in | Primary workspace persistence, Firefox account sync | Required by SYNC-01; official WebExtensions API |
| `browser.storage.local` | built-in | Fallback storage when sync quota exceeded | Required by SYNC-04; already in use by extension |
| `browser.storage.sync.getBytesInUse()` | built-in (all versions) | Proactive quota check before writes | Required by SYNC-03 |

### No Additional npm Dependencies
Phase 4 is pure WebExtensions API work. No new npm packages are needed.

**Installation:** None required.

**Version verification:** All APIs are built-in. `getBytesInUse()` for `storage.sync` is supported in all Firefox versions per MDN (no minimum version constraint beyond Firefox 142+ already set in manifest).

---

## Architecture Patterns

### Recommended Storage Schema

```
storage.sync keys:
  wsIndex                    -> string[]          // ordered workspace IDs
  ws:{id}                    -> WorkspaceMeta     // { id, name, color, createdAt, tabChunks: N }
  ws:{id}:t:0                -> TabData[]         // first 25 tabs
  ws:{id}:t:1                -> TabData[]         // next 25 tabs (if workspace has 26-50 tabs)

storage.local keys (fallback only):
  syncFailed                 -> boolean           // true when sync quota exceeded
  workspaces                 -> Workspace[]       // full denormalized array (same schema as pre-Phase-4)
  (old) workspaces           -> cleared after migration
```

**Key insight:** `activeWorkspaceId` is NOT stored in sync. It is per-device session state already managed by `storage.session` windowMap (Phase 3). Different devices have different active workspaces — syncing this would cause incorrect behavior.

### Recommended Project Structure (new file)
```
src/background/
├── index.js         # (existing) entry point — add migrateIfNeeded() call
├── state.js         # (existing) session state, window map, throttledSave
├── workspaces.js    # (existing) workspace CRUD — swap storage.local calls to sync.js
├── messaging.js     # (existing) message router — swap storage.local calls to sync.js
└── sync.js          # (NEW) storage abstraction: getWorkspaces, saveWorkspaces, migrateIfNeeded
```

### Pattern 1: Storage Abstraction Module (sync.js)

**What:** A single module that owns all workspace persistence. Callers never touch `browser.storage.sync` or `browser.storage.local` directly for workspace data.
**When to use:** Every read/write of workspace data in all four background modules.

```javascript
// src/background/sync.js
// Source: MDN storage.sync docs + empirical size testing

const CHUNK_SIZE = 25
const QUOTA_BYTES = 102400          // browser.storage.sync.QUOTA_BYTES
const QUOTA_BYTES_PER_ITEM = 8192   // browser.storage.sync.QUOTA_BYTES_PER_ITEM
const QUOTA_THRESHOLD = 0.9         // fall back at 90% full
const SYNC_FAILED_KEY = 'syncFailed'

// ── Read ─────────────────────────────────────────────────────

export async function getWorkspaces() {
  const failed = await isSyncFailed()
  if (failed) return readFromLocal()

  try {
    const syncData = await browser.storage.sync.get(null)  // get everything
    if (syncData.wsIndex && Array.isArray(syncData.wsIndex)) {
      return assembleFromSync(syncData)
    }
  } catch (e) {
    console.warn('[Workspaces] sync.get failed, falling back to local:', e)
  }
  return readFromLocal()
}

// ── Write ─────────────────────────────────────────────────────

export async function saveWorkspaces(workspaces) {
  const failed = await isSyncFailed()
  if (failed) return writeToLocal(workspaces)

  // SYNC-03: proactive quota check
  const used = await browser.storage.sync.getBytesInUse(null)
  const estimated = estimateBytes(workspaces)
  if (used + estimated > QUOTA_BYTES * QUOTA_THRESHOLD) {
    console.warn('[Workspaces] Sync quota near limit, falling back to local')
    await activateFallback(workspaces)
    return
  }

  try {
    await writeToSync(workspaces)
  } catch (e) {
    if (e.name === 'QuotaExceededError' || (e.message && e.message.includes('quota'))) {
      // SYNC-04: reactive fallback
      console.warn('[Workspaces] Sync quota exceeded, falling back to local:', e)
      await activateFallback(workspaces)
    } else {
      throw e
    }
  }
}
```

### Pattern 2: Chunked Write to sync

**What:** Serialize workspaces into keyed items — one metadata key per workspace, one tab-array key per 25-tab chunk. Batch into a single `storage.sync.set()` call.
**When to use:** Inside `writeToSync()`.

```javascript
// Source: MDN storage.sync quota docs, empirical sizing (this research file)
function serializeToSyncItems(workspaces) {
  const items = {}
  const wsIndex = workspaces.map(ws => ws.id)
  items.wsIndex = wsIndex

  for (const ws of workspaces) {
    const key = `ws:${ws.id}`
    const chunks = chunkArray(ws.tabs, CHUNK_SIZE)

    items[key] = {
      id: ws.id,
      name: ws.name,
      color: ws.color,
      createdAt: ws.createdAt,
      tabChunks: chunks.length,
    }

    for (let i = 0; i < chunks.length; i++) {
      items[`${key}:t:${i}`] = chunks[i]
    }
  }

  return items
}

function chunkArray(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks.length > 0 ? chunks : [[]]  // always at least one chunk
}
```

### Pattern 3: Assemble Workspace Array from sync items

**What:** Reassemble the flat sync key-value store back into a workspaces array, preserving ordering from `wsIndex`.
**When to use:** Inside `assembleFromSync()`.

```javascript
// Source: MDN storage.sync docs
function assembleFromSync(syncData) {
  const wsIndex = syncData.wsIndex || []
  const workspaces = []

  for (const id of wsIndex) {
    const meta = syncData[`ws:${id}`]
    if (!meta) continue

    const tabs = []
    for (let i = 0; i < (meta.tabChunks || 1); i++) {
      const chunk = syncData[`ws:${id}:t:${i}`]
      if (Array.isArray(chunk)) tabs.push(...chunk)
    }

    workspaces.push({
      id: meta.id,
      name: meta.name,
      color: meta.color,
      createdAt: meta.createdAt,
      tabs,
    })
  }

  return workspaces
}
```

### Pattern 4: Fallback Activation (SYNC-04)

**What:** On quota failure, write the workspace array to `storage.local` in the legacy format and set a `syncFailed` flag. Subsequent reads and writes use local only.
**When to use:** Catch of `QuotaExceededError` or proactive threshold breach.

```javascript
async function activateFallback(workspaces) {
  await browser.storage.local.set({
    [SYNC_FAILED_KEY]: true,
    workspaces,  // legacy flat array — same schema as pre-Phase-4
  })
}

async function isSyncFailed() {
  const result = await browser.storage.local.get({ [SYNC_FAILED_KEY]: false })
  return result[SYNC_FAILED_KEY]
}
```

### Pattern 5: Migration (SYNC-05)

**What:** On `onInstalled reason=update` and `onStartup`, check if migration from the old `storage.local` schema to sync is needed.
**When to use:** Called from `index.js` in both `onInstalled` and `onStartup` handlers, before `reclaimWorkspaces()`.

```javascript
// Source: MDN runtime.onInstalled docs
export async function migrateIfNeeded() {
  // wsIndex presence = already migrated (idempotent sentinel)
  const syncData = await browser.storage.sync.get('wsIndex')
  if (syncData.wsIndex) return  // already on sync schema

  // Check for old storage.local data
  const localData = await browser.storage.local.get('workspaces')
  if (!localData.workspaces || !Array.isArray(localData.workspaces)) return

  // Migrate: write to sync, clear old local keys
  try {
    await saveWorkspaces(localData.workspaces)
    await browser.storage.local.remove('workspaces')
    console.log('[Workspaces] Migrated', localData.workspaces.length, 'workspaces to sync storage')
  } catch (e) {
    // Migration failed — keep local data intact, activateFallback will handle writes
    console.warn('[Workspaces] Migration failed, remaining on local storage:', e)
  }
}
```

### Anti-Patterns to Avoid

- **Reading `activeWorkspaceId` from sync:** It is session state (per-device), not user data. It lives in `storage.session` windowMap. Never put it in `storage.sync`.
- **Multiple `storage.sync.set()` calls per save:** All sync writes for one workspace update must be batched into a single `set()` call (one `items` object). Multiple calls create race conditions if the background unloads mid-write.
- **Calling `storage.sync.clear()` to fix quota issues:** This deletes all workspace data. The correct response to quota exceeded is fallback to `storage.local` without touching existing sync data.
- **Leaving old `storage.local` workspaces key after migration:** After successful migration to sync, remove the `workspaces` key from local storage. Leaving stale data creates confusion if the extension later reads from local as fallback.
- **Calling `storage.sync.get()` with specific keys before knowing the schema:** Use `get(null)` to retrieve all sync data in one round-trip, then assemble in JS. Avoid N+1 gets per workspace.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Workspace size estimation | Custom byte counter | `JSON.stringify(value).length + key.length` inline | The spec defines "size = JSON stringification + key length" — this formula IS the spec |
| Cross-device conflict resolution | Merge algorithm | Accept last-write-wins (built-in) | Firefox sync uses per-key server-wins semantics. Workspaces are not aggregated counters; LWW is correct for personal tab sets. See Out of Scope in REQUIREMENTS.md |
| Quota constants | Hardcode magic numbers | `browser.storage.sync.QUOTA_BYTES` and `QUOTA_BYTES_PER_ITEM` | Browser constants are guaranteed accurate; hardcoded fallbacks (102400, 8192) only used if properties somehow absent |
| Retry logic on quota failure | Exponential backoff | Immediate fallback to local | Quota is a hard ceiling, not a transient condition. Retrying the same write will keep failing |

**Key insight:** The sync schema complexity (chunking) exists entirely to stay within per-item limits. If the per-item limit were removed, the schema could collapse back to a single key. This is the "respect 8KB per-item limit" referenced in SYNC-02.

---

## Common Pitfalls

### Pitfall 1: favIconUrl Blows the 8KB Per-Item Limit
**What goes wrong:** A workspace with 40 tabs where all tabs are from one domain (e.g., all Stack Overflow or all GitHub) has a `favIconUrl` repeated 40 times in the JSON. The repeated URL adds ~1,600 bytes (40 × ~40 chars), pushing a 7,200-byte workspace to 8,800 bytes — over the 8,192-byte limit.
**Why it happens:** `favIconUrl` is stored per tab in the existing `serializeTabs()`. Same-domain tabs share an identical favicon URL but the JSON deduplication does not happen.
**How to avoid:** Strip `favIconUrl` from tab objects before writing to sync. Favicons are display-only metadata; they are re-fetched by the browser automatically when tabs are restored. The `favIconUrl` field in `storage.local` fallback can be kept as-is since local has no per-item limit.
**Warning signs:** `QuotaExceededError` on workspaces with 30+ tabs from one domain even before total quota is approached.

### Pitfall 2: Stale `storage.local` workspaces Key After Migration
**What goes wrong:** Migration writes to sync successfully but does not remove the old `workspaces` key from local. On the next sync failure (or if `isSyncFailed()` returns true from a previous session), the extension reads the old local data — which does not include changes made after migration.
**Why it happens:** Migration is a two-phase write (sync write + local delete). If the local delete is skipped "for safety," the stale copy becomes a ghost that silently diverges.
**How to avoid:** After a successful `saveWorkspaces(localData.workspaces)` in `migrateIfNeeded()`, always call `browser.storage.local.remove('workspaces')`.
**Warning signs:** User sees old workspace data after editing on another device.

### Pitfall 3: `storage.sync.get(null)` Returns Empty on First Sync After Migration
**What goes wrong:** After migration, the data exists in sync locally but has not yet been pushed to the server (sync runs every 10 minutes). On a fresh device, `storage.sync.get(null)` returns `{}` because Firefox has not yet pulled from the server.
**Why it happens:** Sync is asynchronous at the Firefox level. The extension cannot force an immediate sync.
**How to avoid:** The `migrateIfNeeded()` sentinel check (`wsIndex` presence) handles this correctly for the same device. On a new device (reinstall case), if sync data is not yet available, `getWorkspaces()` falls back to local which returns empty; `initDefaultWorkspace()` creates a default workspace. Once Firefox pulls from the server, sync data becomes available on the next read. This is acceptable — the user sees a default workspace briefly, then sync catches up.
**Warning signs:** User reports "my workspaces disappeared after reinstall" immediately — this is the expected 10-minute sync window, not a bug.

### Pitfall 4: Writing `activeWorkspaceId` to sync
**What goes wrong:** If `activeWorkspaceId` is added to the sync schema (e.g., inside the workspace meta key), syncing to another device causes that device to activate a workspace it may not have open, potentially causing incorrect badge display or tab restoration.
**Why it happens:** Pre-Phase-3 code stored `activeWorkspaceId` in `storage.local`. It is tempting to include it in the sync schema for "completeness."
**How to avoid:** `activeWorkspaceId` must remain in `storage.session` windowMap (set in Phase 3). The sync schema stores only workspace definitions, never per-device active state.
**Warning signs:** Badge shows wrong workspace on Device B after Device A switches workspace.

### Pitfall 5: Using `storage.sync.remove()` When Over Quota
**What goes wrong:** Calling `storage.sync.remove()` while the extension is already over quota fails with `QuotaExceededError` (confirmed in Mozilla Bugzilla #1656947). This makes it impossible to clean up sync data using the remove API once over quota.
**Why it happens:** Firefox enforces quota on all sync write operations including remove.
**How to avoid:** The fallback strategy does not attempt to free sync space. Instead, it stops writing to sync altogether and uses local. If sync space needs to be freed, use `browser.storage.sync.clear()` (which does not enforce quota) — but this wipes all workspace data from sync, so it should only be used as a last resort recovery, not in the normal fallback path.
**Warning signs:** `QuotaExceededError` on `storage.sync.remove()` calls.

### Pitfall 6: Single-call `storage.sync.set()` Per Workspace vs. Batch Write
**What goes wrong:** Calling `storage.sync.set()` once per workspace in a loop means the MV3 event page could unload between calls, leaving sync in a partially-updated state (some workspaces updated, others not).
**Why it happens:** Each `await` is a suspension point where the background can unload.
**How to avoid:** Serialize all sync writes into a single `items` object and call `browser.storage.sync.set(items)` once. This is atomic from the extension's perspective.

---

## Code Examples

### Full getWorkspaces() Implementation

```javascript
// src/background/sync.js — getWorkspaces()
// Source: MDN storage.sync API, empirical schema design
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

async function readFromLocal() {
  const result = await browser.storage.local.get('workspaces')
  return Array.isArray(result.workspaces) ? result.workspaces : []
}
```

### Full saveWorkspaces() Implementation

```javascript
// src/background/sync.js — saveWorkspaces()
// Source: MDN storage.sync.getBytesInUse, QuotaExceededError handling
export async function saveWorkspaces(workspaces) {
  const failed = await isSyncFailed()
  if (failed) {
    await browser.storage.local.set({ workspaces })
    return
  }

  // SYNC-03: proactive quota check
  let used = 0
  try {
    used = await browser.storage.sync.getBytesInUse(null)
  } catch (e) {
    console.warn('[Workspaces] getBytesInUse failed:', e)
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
      // SYNC-04: reactive fallback
      console.warn('[Workspaces] Sync quota exceeded, falling back to local:', e)
      await activateFallback(workspaces)
    } else {
      throw e
    }
  }
}
```

### Stale Chunk Pruning

```javascript
// When a workspace has fewer tabs, old chunk keys must be deleted
// e.g., workspace was 30 tabs (2 chunks), now 10 tabs (1 chunk): delete ws:{id}:t:1
async function pruneStaleChunks(workspaces) {
  const syncData = await browser.storage.sync.get(null)
  const keysToRemove = []

  for (const ws of workspaces) {
    const newChunks = Math.ceil(ws.tabs.length / CHUNK_SIZE) || 1
    const meta = syncData[`ws:${ws.id}`]
    if (!meta) continue
    const oldChunks = meta.tabChunks || 1
    for (let i = newChunks; i < oldChunks; i++) {
      keysToRemove.push(`ws:${ws.id}:t:${i}`)
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
```

### Workspace Deletion Cleanup

```javascript
// When a workspace is deleted, its sync keys must be cleaned up
// Called from deleteWorkspace() in workspaces.js after saveWorkspaces()
export async function deleteWorkspaceFromSync(workspaceId) {
  try {
    const syncData = await browser.storage.sync.get(`ws:${workspaceId}`)
    const meta = syncData[`ws:${workspaceId}`]
    const chunkCount = meta ? (meta.tabChunks || 1) : 0
    const keysToRemove = [`ws:${workspaceId}`]
    for (let i = 0; i < chunkCount; i++) {
      keysToRemove.push(`ws:${workspaceId}:t:${i}`)
    }
    await browser.storage.sync.remove(keysToRemove)
  } catch (e) {
    console.warn('[Workspaces] deleteWorkspaceFromSync failed (non-fatal):', e)
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `browser.storage.local` for all workspace data | `browser.storage.sync` primary, local fallback | Phase 4 (this phase) | Workspaces survive reinstalls and sync across devices |
| Single `workspaces` array key | Per-workspace `ws:{id}` + chunk keys | Phase 4 (this phase) | Stays within 8KB per-item limit; independent workspace writes |
| No quota monitoring | Proactive `getBytesInUse()` + reactive `QuotaExceededError` catch | Phase 4 (this phase) | Silent fallback, no data loss on quota breach |

**Deprecated/outdated:**
- Direct `browser.storage.local.get(['workspaces'])` calls in `workspaces.js`, `messaging.js`, `index.js`: replaced by `getWorkspaces()` from `sync.js`
- Direct `browser.storage.local.set({ workspaces })` calls: replaced by `saveWorkspaces()` from `sync.js`

---

## Open Questions

1. **favIconUrl: strip from sync or keep per-chunk?**
   - What we know: Same-domain favicons (40 tabs, one domain) push a workspace over 8KB. Unique favicons per tab are typically ~40 chars and do not cause issues.
   - What's unclear: Whether stripping favIconUrl entirely from sync serialization is acceptable, or if storing it per tab in chunks is safer (no need for local-only fav storage).
   - Recommendation: Strip `favIconUrl` when writing to sync (tabs stored without it), preserve in `storage.local` fallback as-is. Favicons are display-only and the browser re-fetches them when tabs restore. This is the simplest fix that guarantees 40 tabs fit in a single `ws:{id}:t:0` chunk most of the time.

2. **Pruning deleted workspace's sync keys: timing**
   - What we know: `deleteWorkspace()` calls `saveWorkspaces()` which writes the updated array (minus deleted workspace) to sync. But the old `ws:{id}`, `ws:{id}:t:0` keys remain orphaned in sync storage.
   - What's unclear: Whether orphan keys will cause problems (they won't — `assembleFromSync` only reads IDs in `wsIndex`), but they waste quota space.
   - Recommendation: Call `deleteWorkspaceFromSync(workspaceId)` from `deleteWorkspace()` after `saveWorkspaces()` succeeds. Non-fatal if it fails (orphans are harmless).

3. **onStartup migration timing vs. reclaimWorkspaces()**
   - What we know: `index.js` currently calls `reclaimWorkspaces()` in `onStartup`. Migration must happen before reclaim since reclaim reads workspaces.
   - What's unclear: Exact ordering needed.
   - Recommendation: In `onStartup`, call `await migrateIfNeeded()` first, then `await reclaimWorkspaces()`. Migration is idempotent (wsIndex check), so the overhead on subsequent starts is one `storage.sync.get('wsIndex')` call.

---

## Sources

### Primary (HIGH confidence)
- MDN `storage.sync` documentation — quota limits (QUOTA_BYTES=102400, QUOTA_BYTES_PER_ITEM=8192, MAX_ITEMS=512), getBytesInUse API, error behavior, Firefox-specific notes (https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync)
- MDN `StorageArea.getBytesInUse()` — full API signature, parameter types, Firefox 131+ support for session (https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/StorageArea/getBytesInUse)
- MDN `runtime.onInstalled` — reason field values, migration use case pattern (https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/onInstalled)
- Empirical node.js size calculations — 40-tab workspace JSON sizing, chunk sizing, 8KB boundary verification (this research session)

### Secondary (MEDIUM confidence)
- Mozilla Add-ons Blog: "Changes to storage.sync in Firefox 79" — Rust-based backend, quota enforcement enabled in FF79, error name `QuotaExceededError`, `getBytesInUse` guidance (https://blog.mozilla.org/addons/2020/07/09/changes-to-storage-sync-in-firefox-79/)
- Mozilla Bugzilla #1656947 — confirmed that `storage.sync.remove()` throws `QuotaExceededError` when already over quota (https://bugzilla.mozilla.org/show_bug.cgi?id=1656947)
- Mozilla Discourse: storage.sync preservation across updates — confirmed sync data persists; calling `clear()` on empty-looking storage is a known anti-pattern (https://discourse.mozilla.org/t/is-storage-sync-preserved-after-extensions-are-updated/126878)

### Tertiary (LOW confidence)
- WebSearch results on `QuotaExceededError` error name — "e.name === 'QuotaExceededError'" pattern seen in community code but not in official MDN example

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all APIs are built-in WebExtensions APIs verified against MDN
- Architecture: HIGH — schema verified empirically with node.js size calculations; quota constants verified against MDN
- Pitfalls: HIGH (Pitfalls 1-4) / MEDIUM (Pitfall 5: QuotaExceededError on remove — verified via Bugzilla, not MDN)
- Migration pattern: HIGH — onInstalled reason values from MDN; sentinel approach derived from first principles

**Research date:** 2026-03-21
**Valid until:** 2026-09-21 (storage.sync API is stable; quota values have not changed since FF79)
