# Architecture Research

**Domain:** Firefox WebExtension — tab/workspace manager
**Researched:** 2026-03-21
**Confidence:** HIGH (based on official MDN docs + Firefox Extension Workshop + direct API verification)

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     UI Layer (transient)                      │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  popup.html / popup.js                               │    │
│  │  - Reads windowId via windows.getCurrent()           │    │
│  │  - Sends { action, windowId, ...payload } messages   │    │
│  │  - Renders workspace list for current window only    │    │
│  └────────────────────────┬─────────────────────────────┘    │
└───────────────────────────│─────────────────────────────────-┘
                            │ browser.runtime.sendMessage
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  Background Layer (event-driven)             │
│                                                              │
│  ┌─────────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Message Router │  │ Window State │  │ Tab Events    │  │
│  │  (onMessage)    │  │ (per-window  │  │ (debounced    │  │
│  │                 │  │  switch lock)│  │  save)        │  │
│  └────────┬────────┘  └──────┬───────┘  └───────┬───────┘  │
│           │                  │                   │           │
│  ┌────────▼──────────────────▼───────────────────▼───────┐  │
│  │              Workspace Operations Layer                │  │
│  │  switchWorkspace(windowId, targetId)                  │  │
│  │  saveWindowWorkspace(windowId)                        │  │
│  │  createWorkspace / deleteWorkspace / updateWorkspace  │  │
│  └────────────────────────┬──────────────────────────────┘  │
└───────────────────────────│──────────────────────────────────┘
                            │ browser.storage.sync / .local
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     Storage Layer                            │
│                                                              │
│  ┌───────────────────────┐   ┌──────────────────────────┐   │
│  │  storage.sync         │   │  storage.session          │   │
│  │  (workspace metadata  │   │  (per-window isSwitching  │   │
│  │   + tab lists)        │   │   flags, temp state)      │   │
│  │  Primary, 100KB quota │   │  In-memory, cleared on    │   │
│  │                       │   │  browser close            │   │
│  └───────────────────────┘   └──────────────────────────┘   │
│  ┌───────────────────────┐                                   │
│  │  storage.local        │                                   │
│  │  (fallback when sync  │                                   │
│  │   quota exceeded,     │                                   │
│  │   or sync unavail.)   │                                   │
│  └───────────────────────┘                                   │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `popup.js` | Render workspace list for ONE window, capture user intent, send messages | Background via `runtime.sendMessage` |
| `background.js` (message router) | Validate sender, dispatch to operations, return result | All components |
| `background.js` (workspace ops) | Atomic switch, CRUD, badge updates | Storage layer, `browser.tabs`, `browser.windows` |
| `background.js` (tab events) | Debounced auto-save on tab changes, window-scoped | Operations layer |
| `background.js` (window tracker) | Maintain `windowId → workspaceId` map in `storage.session` | Operations layer, storage |
| Storage (sync) | Persist workspace definitions and tab lists across reinstalls | Background only |
| Storage (session) | Hold per-window switching locks (`isSwitching[windowId]`) — cleared on restart | Background only |
| Storage (local) | Fallback when sync quota exceeded | Background only |

## Recommended Project Structure

The existing flat structure in `src/` is appropriate for this extension's scope. No major restructuring needed, but file responsibilities should be tightened:

```
src/
├── background.js          # All background logic (single file, ~500 lines is fine)
│                          # Sections: init, window-tracker, tab-events, workspace-ops, message-router
├── manifest.json          # MV3 format: "action" key, non-persistent background
├── popup/
│   ├── popup.html         # No inline scripts, CSP-safe
│   ├── popup.js           # Window-aware: reads windowId, scoped state display
│   └── popup.css          # Unchanged
└── icons/
    ├── icon-48.svg
    └── icon-96.svg
```

### Structure Rationale

- **Single background.js:** Extension scope is small enough that splitting into multiple modules adds friction without benefit. Internal comment sections (`// ── Window Tracker ──`) provide sufficient organization.
- **No build step required:** The codebase deliberately avoids a bundler. Modules within background.js use function-scope, not ES modules, to keep the toolchain minimal.
- **popup.js stays thin:** All business logic lives in background. The popup's only job is to ask "what workspaces exist for my windowId?" and render the answer.

## Architectural Patterns

### Pattern 1: Per-Window Switching Lock

**What:** Replace the single `isSwitching` boolean with a `Map<windowId, boolean>` stored in `storage.session`. Each window gets its own lock so a switch in Window A cannot block saves in Window B.

**When to use:** Any time tab events fire — check `isSwitching[tab.windowId]` not a global flag.

**Trade-offs:** Slightly more complex lookup, but eliminates silent corruption when multiple windows are open simultaneously.

**Example:**
```javascript
// On background init — restore from session or default to empty
async function getSwitchingLocks() {
  const { switchingLocks } = await browser.storage.session.get({ switchingLocks: {} });
  return switchingLocks;
}

async function setWindowLock(windowId, value) {
  const locks = await getSwitchingLocks();
  locks[windowId] = value;
  await browser.storage.session.set({ switchingLocks: locks });
}

async function isWindowSwitching(windowId) {
  const locks = await getSwitchingLocks();
  return !!locks[windowId];
}
```

**Note:** `storage.session` is available from Firefox 115+ (HIGH confidence, MDN verified). Since this is a new milestone feature, targeting Firefox 115+ minimum is safe.

---

### Pattern 2: Window-to-Workspace Mapping in storage.session

**What:** Maintain a `Map<windowId, workspaceId>` in `storage.session`. This replaces the single `activeWorkspaceId` global in storage.sync. When the background wakes, it restores from session (survives background unloading in MV3; cleared on browser close, which triggers re-initialization).

**When to use:** Every workspace operation that is window-scoped: save, switch, badge update, popup render.

**Trade-offs:** `storage.session` is cleared on browser close. On startup, the extension must re-initialize window mapping from stored workspace data (which window has which tabs). This requires a reconciliation step in `onStartup`.

**Example:**
```javascript
// Stored in storage.sync (persists across sessions):
// { workspaces: [...], windowWorkspaces: { "123": "ws_id_A", "456": "ws_id_B" } }
//
// Stored in storage.session (survives background unloads, not browser restart):
// { activeByWindow: { "123": "ws_id_A", "456": "ws_id_B" } }

async function getActiveWorkspaceForWindow(windowId) {
  const { activeByWindow } = await browser.storage.session.get({ activeByWindow: {} });
  return activeByWindow[windowId] ?? null;
}
```

**Key distinction:** `storage.sync` stores the canonical truth (what workspace is assigned to each window); `storage.session` stores the runtime cache for fast background access without a sync round-trip.

---

### Pattern 3: Atomic Tab Switch with Rollback

**What:** Capture the current tab list as a snapshot before starting a switch. If tab creation fails partially, restore the snapshot rather than leaving mixed state.

**When to use:** Every call to `switchWorkspace()`.

**Trade-offs:** Requires one extra storage write at the start of every switch. The benefit is reliable rollback — user never ends up with an empty window.

**Example:**
```javascript
async function switchWorkspace(windowId, targetId) {
  await setWindowLock(windowId, true);
  const snapshot = await browser.tabs.query({ windowId });

  try {
    // 1. Save current workspace tabs
    // 2. Create all target tabs (collect created IDs)
    // 3. Only remove old tabs after ALL new tabs confirmed created
    // 4. Update storage.sync with new windowId→workspaceId mapping
    // 5. Update badge
    return { success: true };
  } catch (err) {
    // Rollback: if any new tabs were created, close them
    // The old tabs are still open because we haven't closed them yet
    // (Step 3 only runs after ALL of Step 2 succeeds)
    await closeCreatedTabs(createdTabIds);
    console.error('[Workspaces] Switch failed, rolled back:', err);
    return { success: false, error: err.message };
  } finally {
    await setWindowLock(windowId, false);
  }
}
```

**Implementation note:** The existing code already creates tabs before closing old ones. The gap is that it closes old tabs even when some new tabs failed to create. Fix: only call `browser.tabs.remove(oldTabIds)` after `createdTabIds.length === tabsToCreate.length`.

---

### Pattern 4: storage.sync with local Fallback

**What:** Try `storage.sync.set()`. On quota error (catches `QUOTA_BYTES` or `QUOTA_BYTES_PER_ITEM` exceeded), fall back to `storage.local.set()` for that operation and persist a flag indicating which backend is in use.

**When to use:** Every write operation.

**Trade-offs:** Requires every read to check which backend is in use. Sync quota is tight: 100KB total, 8192 bytes per item. A workspace with 30 tabs at ~200 bytes each = ~6KB per workspace object — approaches the per-item limit at high tab counts. Splitting large workspaces across multiple keys adds complexity but solves the problem.

**Storage key design to stay under 8192 bytes per item:**
```javascript
// Workspace metadata (no tabs) — stored in sync
// Key: "ws_meta"
// Value: [{ id, name, color, createdAt, windowAssignment }]

// Tab data split by workspace — stored in sync if small, local if large
// Key: "ws_tabs_{workspaceId}"
// Value: [{ url, title, pinned, favIconUrl }]
// If this exceeds 8192 bytes, store in local with key "ws_tabs_local_{workspaceId}"

// Active window mapping
// Key: "window_workspaces"
// Value: { "windowId1": "wsId1", "windowId2": "wsId2" }
```

**Example fallback pattern:**
```javascript
async function storageSyncSetWithFallback(key, value) {
  try {
    await browser.storage.sync.set({ [key]: value });
  } catch (err) {
    if (err.message?.includes('QUOTA') || err.message?.includes('quota')) {
      console.warn('[Workspaces] sync quota exceeded for key:', key, '— using local');
      await browser.storage.local.set({ [key]: value, [`${key}_in_local`]: true });
    } else {
      throw err;
    }
  }
}
```

---

### Pattern 5: MV3 Non-Persistent Background Event Registration

**What:** All event listeners registered synchronously at module top-level (not inside async functions or conditional blocks). State that was previously in global variables must be read from `storage.session` at the start of each event handler.

**When to use:** Required for Manifest V3 compliance. Firefox MV3 uses non-persistent event pages (not Chrome-style service workers — Firefox uses `background.scripts` array, not `background.service_worker`).

**Trade-offs:** Slight latency on first wake (storage.session read). The solution is to design event handlers to be idempotent — safe to run on re-wake from unloaded state.

**Example:**
```javascript
// manifest.json (MV3 Firefox)
// "background": { "scripts": ["background.js"], "persistent": false }
// "action": { "default_popup": "popup/popup.html" }   (not "browser_action")

// background.js — listeners at top-level, no async wrapping
browser.tabs.onCreated.addListener(handleTabCreated);
browser.windows.onRemoved.addListener(handleWindowRemoved);
browser.runtime.onMessage.addListener(handleMessage);

// Handlers read session state rather than globals
async function handleTabCreated(tab) {
  if (await isWindowSwitching(tab.windowId)) return;
  debouncedSave(tab.windowId);
}
```

**Key Firefox MV3 divergence from Chrome:** Firefox uses `"scripts": [...]` in background, not `"service_worker"`. The `browser.*` namespace works. No need for a polyfill. `browser.browserAction` becomes `browser.action`. [Source: Firefox Extension Workshop MV3 guide]

---

## Data Flow

### Workspace Switch Flow (multi-window aware)

```
User clicks workspace in popup
    │
    ▼
popup.js: windows.getCurrent() → get windowId
    │
    ▼
popup.js: sendMessage({ action: 'switchWorkspace', windowId, targetId })
    │
    ▼
background.js message router: validate sender (moz-extension URL check)
    │
    ▼
switchWorkspace(windowId, targetId)
    │
    ├─ setWindowLock(windowId, true)          [storage.session write]
    │
    ├─ snapshot = tabs.query({ windowId })    [capture current tabs]
    │
    ├─ save current workspace tabs            [storage.sync write]
    │
    ├─ create new tabs one-by-one             [browser.tabs.create]
    │   └─ on any failure: close created, return { success: false }
    │
    ├─ remove old tabs (only if all created)  [browser.tabs.remove]
    │
    ├─ update windowWorkspaces mapping        [storage.sync write]
    │
    ├─ updateBadge(windowId, workspace)       [browser.action.setBadgeText windowId]
    │
    └─ setWindowLock(windowId, false)         [storage.session write]
```

### Auto-Save Flow (window-scoped)

```
Tab event fires (onCreated/onRemoved/onUpdated/onMoved)
    │
    ▼
Filter: tab.windowId known?  AND  isWindowSwitching(windowId) == false?
    │
    ▼
debouncedSave(windowId) — per-window timeout map
    │  (400ms debounce, keyed by windowId)
    ▼
saveWindowWorkspace(windowId)
    ├─ tabs.query({ windowId })
    ├─ serializeTabs()
    └─ storage write: update ws_tabs_{activeWorkspaceForWindow(windowId)}
```

### Popup Initialization Flow

```
Popup opens
    │
    ▼
popup.js: windows.getCurrent() → windowId
    │
    ▼
sendMessage({ action: 'getState', windowId })
    │
    ▼
background: read storage.sync workspaces + activeByWindow[windowId]
    │
    ▼
return { workspaces, activeWorkspaceId: activeByWindow[windowId] }
    │
    ▼
popup.js: renderList() — shows all workspaces, highlights active one for this window
```

### Key State Flows

1. **Window opened:** `windows.onCreated` → assign first available workspace (or create new one) → update `windowWorkspaces` in storage.sync + `activeByWindow` in storage.session → update badge for that window.

2. **Window closed:** `windows.onRemoved` → save that window's workspace tabs → remove `windowId` from `activeByWindow` in session (workspace stays in sync for future use).

3. **Browser restart:** `runtime.onStartup` → `storage.session` is empty → read `windowWorkspaces` from storage.sync → reconcile with currently open windows (some may be stale) → re-populate `activeByWindow` in session.

4. **Background unloaded (MV3 idle):** `storage.session` persists across background wake/sleep cycles. On next event, handlers read session state normally.

## Scaling Considerations

This extension runs locally in a single browser. "Scaling" means number of workspaces and windows.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-5 windows, 1-20 workspaces | Current approach works. No changes. |
| 5-10 windows, 20-50 workspaces | Monitor storage.sync quota. At 50 workspaces × 6KB tabs data = 300KB — exceeds sync quota. Split tabs to local storage for large workspaces. |
| 50+ workspaces | Implement workspace archiving. storage.local has 5MB+ limit (with unlimitedStorage permission). Metadata stays in sync, large tab arrays move to local. |

### Scaling Priorities

1. **First bottleneck:** `storage.sync` per-item 8192 byte limit. A workspace with 30+ tabs and long URLs hits this. Fix: store tab arrays under separate keys (`ws_tabs_{id}`), not nested inside workspace objects.

2. **Second bottleneck:** Total sync quota (100KB). At ~4KB per workspace (30 tabs), you hit the limit around 25 workspaces. Fix: move `ws_tabs_{id}` to `storage.local` if its size exceeds a threshold (e.g., 6000 bytes). Metadata (name, color, createdAt) stays in sync at ~100 bytes per workspace.

## Anti-Patterns

### Anti-Pattern 1: Global `activeWorkspaceId` + `isSwitching`

**What people do:** Store a single `activeWorkspaceId` string and a single `isSwitching` boolean in module scope or storage. (This is the current code.)

**Why it's wrong:** Multiple windows. Window A switching workspaces sets `isSwitching = true` globally, which blocks auto-save in Window B. Window A's `activeWorkspaceId` overwrites Window B's, so saving Window B's tabs updates the wrong workspace. Data corruption is silent.

**Do this instead:** Key everything by `windowId`. `isSwitching` becomes `switchingLocks: { [windowId]: boolean }` in `storage.session`. `activeWorkspaceId` becomes `activeByWindow: { [windowId]: workspaceId }` also in `storage.session` (with `windowWorkspaces` as the persistent backup in `storage.sync`).

---

### Anti-Pattern 2: Save Current State Before Confirming New Tabs Exist

**What people do:** Save the current workspace's tab list first, then try to create new tabs. If tab creation fails, the saved tabs are already overwritten.

**Why it's wrong:** If `browser.tabs.create()` throws for any reason (invalid URL, browser limit), the old workspace tabs are already gone from storage. The user loses their tab history with no recovery path.

**Do this instead:** Snapshot current tabs at switch start but do NOT write to storage until all new tabs are confirmed created. The write order is: (1) create all new tabs, (2) verify count matches, (3) write tab snapshot to storage, (4) remove old tabs.

---

### Anti-Pattern 3: Storing All Workspace Data Under One Storage Key

**What people do:** Store `{ workspaces: [{ id, name, color, tabs: [...] }], activeWorkspaceId }` as a single object under one key.

**Why it's wrong:** The 8192 byte per-item limit in `storage.sync` will be hit as soon as a workspace grows beyond ~30 tabs. The entire `set()` call fails with a quota error, losing all changes for all workspaces.

**Do this instead:** Split storage into at least two keys per workspace: `ws_meta` (all workspace metadata without tabs, safely under 8192 bytes for dozens of workspaces) and `ws_tabs_{id}` (tab array for each workspace individually). If a single workspace's tab array exceeds 6KB, store it in `storage.local` and set a marker flag in sync.

---

### Anti-Pattern 4: Using `currentWindow: true` in Background Tab Queries

**What people do:** Call `browser.tabs.query({ currentWindow: true })` in background script handlers.

**Why it's wrong:** In a background script (not a popup), `currentWindow` resolves to the most recently focused window — which may not be the window that triggered the tab event. When handling `tabs.onCreated`, the created tab includes its `windowId` on the event object itself. Using `currentWindow` can silently query the wrong window's tabs.

**Do this instead:** Always use explicit `windowId` from the event object: `browser.tabs.query({ windowId: tab.windowId })`.

---

### Anti-Pattern 5: `persistent: true` Background in MV3

**What people do:** Attempt to keep the old MV2 persistent background behavior by setting `"persistent": true` in manifest.json.

**Why it's wrong:** MV3 ignores this flag — all MV3 backgrounds are non-persistent in Firefox. Relying on global variables for state will cause subtle failures when the background is unloaded after idle periods. AMO requires MV3 for new submissions.

**Do this instead:** Move all state that must survive background unloads to `storage.session` (for session-scoped, in-memory state) or `storage.sync`/`storage.local` (for persistent state). Design handlers to read state from storage at the start rather than assuming in-memory globals are current.

---

## Integration Points

### External Services

None. The extension is intentionally self-contained with no external service dependencies.

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| popup.js → background.js | `browser.runtime.sendMessage({ action, windowId, ...payload })` | Popup must include `windowId` in every message. Background validates sender URL is `moz-extension://...popup.html`. |
| background.js → storage.sync | `browser.storage.sync.get/set` | Used for workspace metadata, tab arrays (if small), and window→workspace mapping. |
| background.js → storage.session | `browser.storage.session.get/set` | Used for per-window switching locks and `activeByWindow` runtime cache. Available Firefox 115+. |
| background.js → storage.local | `browser.storage.local.get/set` | Fallback for tab arrays exceeding 8192 bytes, or when sync is unavailable. |
| background.js → browser.tabs | `tabs.query`, `tabs.create`, `tabs.remove` | All calls scoped by explicit `windowId`, never `currentWindow: true` in background. |
| background.js → browser.windows | `windows.onCreated`, `windows.onRemoved`, `windows.onFocusChanged`, `windows.getAll` | Used to initialize per-window state and clean up on window close. |
| background.js → browser.action | `action.setBadgeText({ text, windowId })`, `action.setBadgeBackgroundColor({ color, windowId })` | MV3 `browser.action` API supports per-window badge via `windowId` parameter. |

**Critical boundary note on `browser.action` badge:** The MV3 `browser.action.setBadgeText()` API accepts a `windowId` parameter (in addition to `tabId`), allowing per-window badge text. This means each window can independently display its active workspace initial without interference. [HIGH confidence — MDN verified.]

## Sources

- [MDN: storage.sync quota limits](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync)
- [MDN: storage.session](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session)
- [MDN: Background scripts (MV3 non-persistent model)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts)
- [MDN: windows.getCurrent() — popup context behavior](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/getCurrent)
- [MDN: tabs.query() — windowId parameter](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/query)
- [MDN: windows API — onCreated/onRemoved/onFocusChanged](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows)
- [Firefox Extension Workshop: MV3 Migration Guide](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/) — confirms Firefox uses `scripts` not `service_worker`, `action` not `browser_action`
- [MDN: runtime.MessageSender](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/MessageSender) — sender URL for validation

---

*Architecture research for: Firefox WebExtension tab/workspace manager (Simple Workspaces)*
*Researched: 2026-03-21*
