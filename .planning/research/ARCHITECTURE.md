# Architecture Research

**Domain:** Firefox WebExtension — tab/workspace manager (v1.1 integration patterns)
**Researched:** 2026-03-23
**Confidence:** HIGH (based on official MDN docs + direct source code analysis)

---

## Context: This Is an Integration Research Document

The v1.0 architecture is already built and verified. This document answers three focused questions for the v1.1 milestone:

1. How does context menu tab movement integrate with the existing background modules?
2. How does new-window workspace opening integrate?
3. How should the circular dependency between state.js and workspaces.js be resolved?

Refer to the original ARCHITECTURE.md content for foundational patterns (per-window switching lock, atomic switch with rollback, storage.sync/session/local layers). This document extends those patterns — it does not replace them.

---

## Existing Module Dependency Graph

Current imports, as shipped in v1.0:

```
index.js
  ├── state.js (throttledSave, removeWindowEntry, getWindowMap)
  ├── workspaces.js (initDefaultWorkspace, updateBadge, saveCurrentWorkspace, reclaimWorkspaces)
  ├── messaging.js (handleMessage)
  └── sync.js (migrateIfNeeded, getWorkspaces)

state.js
  └── workspaces.js (saveCurrentWorkspace)   ← creates the circular dependency

workspaces.js
  ├── state.js (getSessionState, setSessionState, getWindowMap, setWindowEntry)
  └── sync.js (getWorkspaces, saveWorkspaces, deleteWorkspaceFromSync)

messaging.js
  ├── workspaces.js (switchWorkspace, createWorkspace, deleteWorkspace,
  │                  updateWorkspace, saveCurrentWorkspace, assignWorkspace, COLORS)
  ├── state.js (getWindowMap)
  └── sync.js (getWorkspaces)

sync.js
  └── (no internal imports — only browser.storage.* APIs)
```

The circular dependency: `state.js` imports `saveCurrentWorkspace` from `workspaces.js`, while `workspaces.js` imports `getSessionState`, `setSessionState`, `getWindowMap`, and `setWindowEntry` from `state.js`. ES modules tolerate this at runtime because by the time `throttledSave()` executes, both modules are fully initialized — but it is fragile: any change that causes one module to call the other before initialization completes will fail silently.

---

## Feature 1: Resolve Circular Dependency (state.js ↔ workspaces.js)

### Root Cause

`state.js` calls `saveCurrentWorkspace()` (from workspaces.js) inside `throttledSave()`. This is the only reason state.js depends on workspaces.js. Everything else in state.js is pure storage session CRUD with no knowledge of workspace logic.

### Solution: Extract `throttledSave` into index.js

`throttledSave` does not belong in state.js. Its job is to orchestrate: check the window map, check the switching lock, then call `saveCurrentWorkspace`. That is coordinator logic, not state storage logic.

Move `throttledSave` from `state.js` into `index.js`, where it is the only caller. The dependency graph after the move:

```
index.js (throttledSave lives here)
  ├── state.js (getWindowMap, getSessionState, setSessionState,
  │             removeWindowEntry, setWindowEntry)
  ├── workspaces.js (saveCurrentWorkspace, initDefaultWorkspace,
  │                  updateBadge, reclaimWorkspaces)
  ├── messaging.js (handleMessage)
  └── sync.js (migrateIfNeeded, getWorkspaces)

state.js
  └── sync.js (no imports from workspaces.js — circular dependency gone)

workspaces.js
  ├── state.js (getSessionState, setSessionState, getWindowMap, setWindowEntry)
  └── sync.js (getWorkspaces, saveWorkspaces, deleteWorkspaceFromSync)

messaging.js
  ├── workspaces.js
  ├── state.js
  └── sync.js
```

state.js becomes a pure session-storage module with no dependency on workspaces.js. The circular dependency is eliminated.

**Change scope:** Move the `throttledSave` function and its `THROTTLE_MS` constant from state.js to index.js. Update the export list in state.js (remove `throttledSave`). Update imports in index.js (add `getSessionState` or pass through parameters as needed). No behavior change.

---

## Feature 2: Fix validateWorkspaceData Not Called on readFromLocal()

### Location

In `sync.js`, `readFromLocal()` returns raw storage data without validation:

```javascript
async function readFromLocal() {
  const result = await browser.storage.local.get('workspaces')
  return Array.isArray(result.workspaces) ? result.workspaces : []
}
```

`validateWorkspaceData()` lives in `workspaces.js`. sync.js does not and should not import from workspaces.js (that would introduce another dependency direction issue and validation logic does not belong in the storage layer).

### Solution: Move validateWorkspaceData to sync.js, or call it at the getWorkspaces() boundary

Two options:

**Option A (preferred): Call validateWorkspaceData() in getWorkspaces(), not in readFromLocal().**

`getWorkspaces()` is the public API surface. Apply validation once at the exit point of sync.js, regardless of whether data came from sync or local. This requires sync.js to either import `validateWorkspaceData` from workspaces.js (bad — wrong direction) or inline the validation logic.

**Option B (recommended): Move validateWorkspaceData() and DEFAULT_WORKSPACE_DATA() from workspaces.js to sync.js.**

Validation of workspace data is fundamentally a concern of the storage layer — it is the contract for what comes out of storage. The function has no dependency on workspaces.js internals (it only works with plain objects). Moving it to sync.js puts it at the right boundary.

After the move, call it in `readFromLocal()` and in `assembleFromSync()` before returning.

**Change scope:** Move `validateWorkspaceData` and `DEFAULT_WORKSPACE_DATA` from workspaces.js to sync.js. Export them from sync.js. Update imports in workspaces.js (import from sync.js instead of defining locally). Call `validateWorkspaceData()` at both exit paths in sync.js: `assembleFromSync()` return and `readFromLocal()` return.

---

## Feature 3: Context Menu "Move to Workspace"

### New API Surface

Firefox's `browser.menus` API (requires `"menus"` permission in manifest.json) supports a `"tab"` context type (Firefox-only, available since Firefox 63). This context fires when the user right-clicks a tab in the tab strip — distinct from right-clicking page content.

**Permission required:** Add `"menus"` to `permissions` in `manifest.json`. The `"tabs"` permission already exists, which is needed to query and move tabs.

**Key events:**
- `browser.menus.onShown` — fires before menu displays; use to rebuild workspace submenu based on current workspaces
- `browser.menus.onClicked` — fires when an item is chosen; receives `info.menuItemId` and `tab` (the right-clicked tab)

### Menu Structure

```
[Right-click tab strip]
└── Move to Workspace  (parent, context: ["tab"])
    ├── Workspace A    (child, id: "move-to:{workspaceId}")
    ├── Workspace B    (child, id: "move-to:{workspaceId}")
    └── ...
```

The workspace list changes at runtime. Use `onShown` + `menus.update()` + `menus.refresh()` to rebuild the children on each menu open. Creating a fixed parent and dynamically updating child items on `onShown` is the correct pattern — do not recreate the parent on every show.

**Concurrency safety:** `onShown` handlers that call async APIs (getWorkspaces) must guard against stale updates using an instance counter pattern (see Pattern section below).

### Data Flow: Move Tab

```
User right-clicks tab → right-clicks "Move to Workspace" → selects "Work"
    │
    ▼
menus.onClicked fires: info.menuItemId = "move-to:abc123", tab = { id: 42, windowId: 7 }
    │
    ▼
background: parse workspaceId from menuItemId
    │
    ▼
background: moveTabToWorkspace(tab.id, workspaceId, tab.windowId)
    │
    ├── read windowMap from storage.session
    ├── find which window owns the target workspace (if any)
    ├── if target workspace is active in a window:
    │     browser.tabs.move(tab.id, { windowId: owningWindowId, index: -1 })
    │     save owning window's workspace (tab added)
    │     save source window's workspace (tab removed)
    └── if target workspace is not active anywhere:
          serialize the tab
          append to workspace.tabs in storage
          remove the tab from the current window
          save current window's workspace
```

### New Module: background/menus.js

The menu logic (register, rebuild on show, handle click) is self-contained and should not live in index.js (which already handles all browser event listeners) or messaging.js (which handles popup messages). Create `src/background/menus.js`.

Responsibilities of `menus.js`:
- Export `initMenus()` — called once from index.js at startup to register the parent menu item and attach `onShown`/`onClicked` listeners
- Export `moveTabToWorkspace(tabId, workspaceId, sourceWindowId)` — the core business logic function
- Imports from: `workspaces.js` (serializeTabs), `sync.js` (getWorkspaces, saveWorkspaces), `state.js` (getWindowMap, setWindowEntry)

index.js calls `initMenus()` at the top level (synchronous registration) so the event listeners are registered before the background can unload.

### Integration with Existing Modules

| Existing Module | Change Required |
|-----------------|-----------------|
| `index.js` | Import `initMenus` from `menus.js`, call it at top level |
| `manifest.json` | Add `"menus"` to `permissions` array |
| `state.js` | No change (menus.js uses getWindowMap, setWindowEntry — already exported) |
| `workspaces.js` | Export `serializeTabs` — it is already defined, just not exported |
| `sync.js` | No change (menus.js uses getWorkspaces, saveWorkspaces — already exported) |
| `messaging.js` | No change |
| `popup.js` | No change (context menu is background-only) |

**New file:** `src/background/menus.js`

---

## Feature 4: Open Workspace in New Window

### Behavior Changes

Current: Unassigned windows show a banner with "Assign Here" buttons. Clicking a workspace assigns the current window to it (replaces current tabs, keeps current window).

New behavior:
- **Unassigned window, clicking a workspace:** Open the workspace in a new window (not the current window). The current window remains unassigned.
- **Any window, middle-click or Ctrl+click a workspace:** Open the workspace in a new window.

The "Assign Here" button is removed entirely.

### Opening a Workspace in a New Window: API Pattern

`browser.windows.create()` accepts a `url` array parameter. The flow:

```
openWorkspaceInNewWindow(workspaceId)
    │
    ▼
read workspace from getWorkspaces()
    │
    ▼
check exclusivity: is workspaceId already assigned to an existing window?
    if yes → focus that window instead (same as current "isInUse" behavior)
    │
    ▼
browser.windows.create({ url: tabUrls, focused: true })
    │  Note: windows.create only accepts URLs, not full tab objects.
    │  Pinned state and discarded state must be set after creation.
    │
    ▼
newWindow = returned windows.Window object (tabs array populated)
    │
    ▼
for pinned tabs: browser.tabs.update(tabId, { pinned: true })
    │  (tabs are created in order — match by index)
    │
    ▼
setWindowEntry(newWindow.id, workspaceId)
updateBadge(workspace, newWindow.id)
```

**Limitation of windows.create with URL array:** `windows.create()` does not accept tab option objects — only URL strings. Pinned state, `discarded` flag, and title cannot be set at creation time. Apply pinned state post-creation by iterating `newWindow.tabs` and calling `browser.tabs.update()` on tabs that should be pinned.

**about:newtab handling:** `windows.create()` does not accept `about:newtab` as a URL (it results in an error or is ignored). If the workspace is empty or contains only `about:newtab` entries, create the window without a URL and let Firefox open a default new tab.

### New Message Action: openInNewWindow

The popup needs a new message action to trigger this. Add to messaging.js:

```
case 'openInNewWindow':
  return openWorkspaceInNewWindow(msg.workspaceId)
```

`openWorkspaceInNewWindow` can live in `workspaces.js` (it is a workspace operation that affects tab/window state) or in a new helper. Given it uses `browser.windows.create`, `browser.tabs.update`, `getWindowMap`, `setWindowEntry`, and `updateBadge` — all of which workspaces.js already imports — it belongs in `workspaces.js`.

### Popup Changes

Two interaction paths trigger new-window opening:

**Path 1: Unassigned window clicks workspace**

Currently: calls `onSwitch(ws.id)` → `switchWorkspace` message (which in turn calls `assignWorkspace` behavior)
New: calls `onOpenInNewWindow(ws.id)` → `openInNewWindow` message

Remove the "Assign Here" button rendering branch. Remove `onAssign()` function. The `activeWorkspaceId === null` branch in renderList now generates items that call `onOpenInNewWindow` instead of `onSwitch`.

**Path 2: Middle-click or Ctrl+click on any workspace item**

Add a `mousedown` or `auxclick` listener to each workspace `<li>`. Check for `e.button === 1` (middle-click) or `(e.button === 0 && e.ctrlKey)`. Call `onOpenInNewWindow(ws.id)`. Stop propagation to prevent the regular click handler from also firing.

### Integration with Existing Modules

| Existing Module | Change Required |
|-----------------|-----------------|
| `workspaces.js` | Add `openWorkspaceInNewWindow(workspaceId)` function |
| `messaging.js` | Add `'openInNewWindow'` case calling `openWorkspaceInNewWindow` |
| `popup.js` | Remove "Assign Here" button. Replace unassigned-window click path. Add middle/Ctrl+click handler. |
| `state.js` | No change |
| `sync.js` | No change |
| `index.js` | No change |
| `menus.js` | No change (context menu handles tab movement, not window opening) |

---

## Updated System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     UI Layer (transient)                         │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐      │
│  │  popup.html / popup.js                                  │      │
│  │  - Sends { action, windowId, ...payload } messages     │      │
│  │  - Middle/Ctrl+click → openInNewWindow                 │      │
│  │  - Unassigned window click → openInNewWindow           │      │
│  └──────────────────────────┬──────────────────────────────┘     │
└──────────────────────────────│──────────────────────────────────-┘
                               │ browser.runtime.sendMessage
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Background Layer (event-driven)                  │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐   │
│  │  messaging.js  │  │  menus.js      │  │  index.js        │   │
│  │  (popup msgs)  │  │  (tab context  │  │  (tab/window     │   │
│  │                │  │   menu + move) │  │   events,        │   │
│  └───────┬────────┘  └───────┬────────┘  │   throttledSave) │   │
│          │                   │            └────────┬─────────┘   │
│          └───────────────────┴─────────────────────┘             │
│                              │                                    │
│  ┌───────────────────────────▼───────────────────────────────┐   │
│  │                   workspaces.js                            │   │
│  │  switchWorkspace, createWorkspace, deleteWorkspace,        │   │
│  │  updateWorkspace, assignWorkspace, reclaimWorkspaces,      │   │
│  │  openWorkspaceInNewWindow (NEW), moveTabToWorkspace (NEW)  │   │
│  │  saveCurrentWorkspace, updateBadge, serializeTabs          │   │
│  └────────────────────┬──────────────────────────────────────┘   │
│                        │                                          │
│          ┌─────────────┴──────────────┐                          │
│          ▼                            ▼                           │
│  ┌───────────────┐           ┌────────────────┐                  │
│  │  state.js     │           │  sync.js       │                  │
│  │  (session     │           │  (storage      │                  │
│  │   storage,    │           │   abstraction, │                  │
│  │   windowMap)  │           │   validation)  │                  │
│  └───────────────┘           └────────────────┘                  │
└──────────────────────────────────────────────────────────────────┘
                               │
                               ▼ browser.storage.sync / .session / .local
```

---

## Component Responsibilities (Updated)

| Component | Responsibility | New in v1.1 |
|-----------|---------------|-------------|
| `index.js` | Top-level event listeners, lifecycle, `throttledSave` (moved here) | Receives `throttledSave` from state.js |
| `state.js` | Pure session-storage CRUD: windowMap, sessionState | Loses `throttledSave`, removes workspaces.js dependency |
| `workspaces.js` | Workspace CRUD, atomic switch, badge, tab serialization | Adds `openWorkspaceInNewWindow`, exports `serializeTabs` |
| `messaging.js` | Route popup messages to workspace functions | Adds `'openInNewWindow'` case |
| `sync.js` | Storage abstraction, validation | Gains `validateWorkspaceData`, `DEFAULT_WORKSPACE_DATA` (moved from workspaces.js) |
| `menus.js` (NEW) | Context menu registration, dynamic rebuild, `moveTabToWorkspace` | Entirely new |
| `popup.js` | UI rendering, user interactions | Removes "Assign Here", adds middle/Ctrl+click |

---

## Architectural Patterns for New Features

### Pattern 1: Dynamic Context Menu with onShown

**What:** Register a static parent menu item at install/startup. On each `menus.onShown`, fetch current workspaces, update child items, call `menus.refresh()`. Use an instance counter to prevent stale async updates.

**When to use:** Any context menu whose items depend on runtime state (workspace list changes as user creates/deletes).

**Key constraints:**
- The parent item must exist before `onShown` fires — register it in `browser.runtime.onInstalled` (and re-register on startup via a helper, since onInstalled only fires on install/update, not on every background wake).
- `menus.create()` for non-persistent backgrounds must be called inside `runtime.onInstalled`. For the startup case (background wakes, menus are gone), check and recreate in `runtime.onStartup` or at the top of index.js.
- Child items use IDs like `"move-to:{workspaceId}"` — parse with `menuItemId.startsWith("move-to:")`.

**Example:**
```javascript
// menus.js

let lastMenuInstance = 0
let nextMenuInstance = 1

export function initMenus() {
  browser.menus.create({
    id: 'ws-move-parent',
    title: 'Move to Workspace',
    contexts: ['tab'],
  })

  browser.menus.onShown.addListener(async (info, tab) => {
    if (!info.contexts.includes('tab')) return

    const instanceId = nextMenuInstance++
    lastMenuInstance = instanceId

    const workspaces = await getWorkspaces()

    if (instanceId !== lastMenuInstance) return  // menu closed already

    // Remove old child items
    const existingChildren = info.menuIds.filter(id =>
      typeof id === 'string' && id.startsWith('move-to:')
    )
    await Promise.all(existingChildren.map(id => browser.menus.remove(id)))

    // Recreate children for current workspaces
    for (const ws of workspaces) {
      browser.menus.create({
        id: `move-to:${ws.id}`,
        parentId: 'ws-move-parent',
        title: ws.name,
        contexts: ['tab'],
      })
    }

    browser.menus.refresh()
  })

  browser.menus.onClicked.addListener(async (info, tab) => {
    if (!info.menuItemId.startsWith('move-to:')) return
    const workspaceId = info.menuItemId.slice('move-to:'.length)
    await moveTabToWorkspace(tab.id, workspaceId, tab.windowId)
  })
}
```

**Trade-off:** Remove + recreate children on each show is slightly heavier than `update()`, but required because workspace count can change between shows. `menus.update()` cannot add or remove items, only change properties of existing ones.

---

### Pattern 2: windows.create for Tab-Array Workspaces

**What:** Create a new browser window with a URL array from a workspace's tab list. Apply pinned state post-creation. Register the new window in the windowMap.

**When to use:** Any operation that opens a workspace in a new window (unassigned window click, middle-click/Ctrl+click).

**Key constraint:** `windows.create()` takes URL strings only. `about:newtab` is not a valid URL for `windows.create()`. If the workspace is empty or all tabs are `about:newtab`, omit the `url` parameter entirely.

**Example:**
```javascript
// workspaces.js

export async function openWorkspaceInNewWindow(workspaceId) {
  const workspaces = await getWorkspaces()
  const workspace = workspaces.find(w => w.id === workspaceId)
  if (!workspace) return { success: false, error: 'Workspace not found' }

  // Exclusive ownership check — if already open, focus instead
  const windowMap = await getWindowMap()
  for (const [wid, wsId] of Object.entries(windowMap)) {
    if (wsId === workspaceId) {
      await browser.windows.update(Number(wid), { focused: true })
      return { success: true, focused: true }
    }
  }

  const realUrls = workspace.tabs
    .filter(t => t.url && !t.url.startsWith('about:'))
    .map(t => t.url)

  const createProps = realUrls.length > 0 ? { url: realUrls, focused: true } : { focused: true }
  const newWindow = await browser.windows.create(createProps)

  // Apply pinned state post-creation (windows.create cannot set pinned)
  const pinnedTabs = workspace.tabs.filter(t => t.pinned)
  if (pinnedTabs.length > 0 && newWindow.tabs) {
    for (let i = 0; i < Math.min(pinnedTabs.length, newWindow.tabs.length); i++) {
      await browser.tabs.update(newWindow.tabs[i].id, { pinned: true })
    }
  }

  await setWindowEntry(newWindow.id, workspaceId)
  updateBadge(workspace, newWindow.id)

  return { success: true }
}
```

---

### Pattern 3: Circular Dependency Resolution via Responsibility Migration

**What:** When module A imports from module B and module B imports from module A, identify which import is "out of place" by asking: "Is this function at home in this module given its stated responsibility?" Move the function to the module where it is conceptually at home.

**When to use:** Any time a circular dependency exists in the background module graph.

**For this codebase:**
- `throttledSave` belongs in index.js (it coordinates save timing, not storage state)
- `validateWorkspaceData` belongs in sync.js (it validates what comes out of storage)

**Trade-off:** None. Circular dependencies in ES modules work at runtime but signal a design boundary violation that becomes a maintenance hazard. Resolving them creates clean, testable boundaries.

---

## Build Order for v1.1 Milestone

Dependencies between the features determine safe implementation order:

```
1. Resolve circular dependency (state.js ↔ workspaces.js)
   └── Move throttledSave to index.js
   └── Zero behavior change, just module restructuring
   └── Required first: all other features touch these modules

2. Fix validateWorkspaceData gap (sync.js)
   └── Move validateWorkspaceData + DEFAULT_WORKSPACE_DATA to sync.js
   └── Call at readFromLocal() and assembleFromSync() exit points
   └── Independent of features 3 and 4

3. Context menu: "Move to Workspace" (menus.js NEW)
   └── Requires: manifest.json permission, serializeTabs exported from workspaces.js
   └── New file — does not modify existing files beyond index.js and manifest.json

4. Open in new window (workspaces.js + messaging.js + popup.js)
   └── Requires: workspaces.js stable (done in step 1)
   └── Last because it touches popup.js (more test surface)
```

Steps 2 and 3 are independent of each other and can be done in either order. Step 1 must precede steps 3 and 4 because both touch workspaces.js and state.js. Step 4 touches the most files (workspaces.js, messaging.js, popup.js, popup.css likely) and should be last.

---

## Data Flow Changes

### Move Tab Flow (new)

```
User right-clicks tab in tab strip → "Move to Workspace" → "Work"
    │
    ▼
menus.onClicked: { menuItemId: "move-to:abc123", tab: { id: 42, windowId: 7 } }
    │
    ▼
menus.js: moveTabToWorkspace(tabId=42, workspaceId="abc123", sourceWindowId=7)
    │
    ├── getWorkspaces() — find target workspace
    ├── getWindowMap() — find if target workspace is active somewhere
    │
    ├── [if target is active in window W]
    │     browser.tabs.move(42, { windowId: W, index: -1 })
    │     saveCurrentWorkspace(W)          [tab now in target window]
    │     saveCurrentWorkspace(7)          [tab removed from source window]
    │
    └── [if target is not active anywhere]
          find workspace.tabs index for this workspace
          serialize the tab → append to workspace.tabs
          saveWorkspaces(workspaces)
          browser.tabs.remove(42)
```

### Open in New Window Flow (new)

```
User clicks workspace in unassigned window popup
 OR middle-clicks workspace in any window popup
    │
    ▼
popup.js: sendMessage({ action: 'openInNewWindow', workspaceId, windowId: currentWindowId })
    │
    ▼
messaging.js: case 'openInNewWindow' → openWorkspaceInNewWindow(workspaceId)
    │
    ▼
workspaces.js: openWorkspaceInNewWindow(workspaceId)
    ├── exclusivity check → focus if already open
    ├── browser.windows.create({ url: [...realUrls] })
    ├── post-creation: browser.tabs.update for pinned tabs
    ├── setWindowEntry(newWindow.id, workspaceId)
    └── updateBadge(workspace, newWindow.id)
```

---

## Integration Points

### New API Permission

| Manifest Change | Reason |
|-----------------|--------|
| Add `"menus"` to `permissions` | Required for `browser.menus` API (context menu) |

### New Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `index.js → menus.js` | `initMenus()` called at top-level | Registers context menu and its event listeners |
| `menus.js → workspaces.js` | Direct import: `serializeTabs`, `moveTabToWorkspace` | menus.js needs to serialize tabs when moving to inactive workspace |
| `menus.js → sync.js` | Direct import: `getWorkspaces`, `saveWorkspaces` | Read workspace list for menu rebuild; write after tab move |
| `menus.js → state.js` | Direct import: `getWindowMap`, `setWindowEntry` | Find owning window; update map after move |
| `popup.js → background` | New message `'openInNewWindow'` | Replaces "Assign Here" flow and handles middle/Ctrl+click |

### Boundaries That Do Not Change

| Boundary | Reason |
|----------|--------|
| `popup.js → 'switchWorkspace'` | Used for assigned window workspace switching — unchanged |
| `popup.js → 'getState'` | Unchanged — still needed for rendering workspace list |
| `storage.sync / .session / .local` | No schema changes required for v1.1 features |

---

## Anti-Patterns Specific to New Features

### Anti-Pattern 1: Recreating the Context Menu Parent on Every onShown

**What people do:** Call `browser.menus.remove('ws-move-parent')` then `browser.menus.create(...)` inside `onShown` to get a fresh slate.

**Why it's wrong:** `menus.remove()` is async. By the time it resolves inside an async `onShown` handler, the menu may already be visible. Firefox may display an empty or broken submenu. Timing is unreliable.

**Do this instead:** Create the parent once at startup. In `onShown`, only remove and recreate the child items (which are not yet visible to the user at `onShown` time). The parent is always present.

---

### Anti-Pattern 2: Passing Tab Objects to windows.create

**What people do:** Try to pass full tab objects `{ url, title, pinned, favIconUrl }` to `windows.create()` to preserve all tab properties.

**Why it's wrong:** `windows.create()` only accepts URL strings in its `url` parameter. Passing objects causes the call to fail silently or throw.

**Do this instead:** Extract URL strings for `windows.create()`. Apply pinned state afterward via `browser.tabs.update()`. Accept that `favIconUrl` is not restorable at creation time — the browser fetches it when the tab loads.

---

### Anti-Pattern 3: Moving a Tab Without Saving Source and Target Workspace State

**What people do:** After `browser.tabs.move()` succeeds, only update the target workspace's tab list.

**Why it's wrong:** The source window's workspace still has the old tab in its saved state. The next auto-save will fix it, but there is a window (pun intended) where a crash or background unload between the move and the next auto-save leaves the tab "present" in two workspaces' saved state simultaneously.

**Do this instead:** After `tabs.move()`, explicitly call `saveCurrentWorkspace()` for both the source and target windows before returning.

---

## Sources

- [MDN: menus API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus)
- [MDN: menus.ContextType — "tab" context (Firefox 63+)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/ContextType)
- [MDN: menus.onShown](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/onShown)
- [MDN: menus.onClicked](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/onClicked)
- [MDN: windows.create()](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/create)
- Direct source code analysis: src/background/{index,state,workspaces,messaging,sync}.js, src/popup/popup.js

---

*Architecture research for: Firefox WebExtension tab/workspace manager — v1.1 integration*
*Researched: 2026-03-23*
