# Phase 6: Context Menu - Research

**Researched:** 2026-03-24
**Domain:** Firefox WebExtensions `browser.menus` API, cross-window tab movement, multi-tab selection
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Cross-window move behavior**
- D-01: Workspaces active in another window ARE shown in the submenu (not hidden or grayed out)
- D-02: Moving tabs to a workspace active in another window physically moves the tabs to that window immediately (using `browser.tabs.move()`) and focuses that window
- D-03: Source workspace loses the moved tabs; user ends up viewing the target window

**Tab state preservation**
- D-04: Tabs must preserve their state on move — same behavior as dragging a tab between windows (no reload, no loss of form data, scroll position, or media playback)
- D-05: Use `browser.tabs.move()` for cross-window moves to achieve seamless behavior
- D-06: For same-window moves (move + switch), keep the moved tabs alive during the workspace switch rather than closing and recreating them
- D-07: If keeping tabs alive during same-window switch adds significant complexity, start with reload approach and optimize later

**Empty source workspace**
- D-08: Moving all tabs out of a workspace leaves it with an empty tab list (about:newtab placeholder on next restore) — do not prevent or auto-delete
- D-09: Move operation should be atomic with rollback, consistent with existing `switchWorkspace()` safety pattern

**Submenu appearance**
- D-10: Each submenu entry shows: workspace name + tab count (e.g., "Work (12 tabs)")
- D-11: Workspaces active in another window have a visual indicator distinguishing them from inactive workspaces
- D-12: Submenu entries ordered by most recently used
- D-13: Parent menu item labeled "Move to Workspace" — positioned inside Firefox's "Move Tab" context menu area, after the "Move to New Window" item

**Menu updates**
- D-14: Submenu reflects current workspace list dynamically — rebuilds on workspace create, rename, or delete (per MENU-03)
- D-15: Active workspace for the current window is excluded from the submenu (per success criteria)

### Claude's Discretion
- Menu rebuild strategy (rebuild all items vs. incremental update)
- Exact format of the "active in another window" indicator
- Rollback implementation details for the move operation
- How to track "most recently used" ordering (timestamp field vs. derived from switch history)
- Error notification approach when moves fail
- Whether D-13's placement inside Firefox's built-in "Move Tab" menu is possible via WebExtensions API — if not, fall back to top-level tab context menu item with "Move to Workspace" submenu

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MENU-01 | User can right-click selected tab(s) and see a "Move to Workspace" submenu listing each existing workspace | `browser.menus.create()` with `contexts: ["tab"]` + `parentId` for submenu; `menus.onShown` for dynamic population |
| MENU-02 | Moving tabs via context menu removes them from the source workspace, adds them to the target, and switches to the target workspace | `browser.tabs.move()` for same-window and cross-window; `switchWorkspace()` for same-window switch; `saveWorkspaces()` after mutation |
| MENU-03 | Context menu workspace list updates dynamically when workspaces are created, renamed, or deleted | `menus.onShown` pattern: remove child items + recreate with current workspace list + `menus.refresh()` |
| MENU-04 | Multi-tab selection (Ctrl+click / Shift+click on tabs) is respected — all highlighted tabs move together | `browser.tabs.query({ windowId, highlighted: true })` to collect all highlighted tabs before moving |
</phase_requirements>

---

## Summary

Phase 6 adds a right-click context menu on Firefox's tab strip that lets users move one or more tabs to a different workspace. The Firefox `browser.menus` API (permission: `"menus"`) supports a `"tab"` context type that inserts items into the tab strip right-click menu. A parent item ("Move to Workspace") with child items per workspace is created via `parentId`. The submenu is populated dynamically on each open using the `menus.onShown` event, which provides the right-clicked tab's full `tabs.Tab` object and fires before the menu is visible to the user.

Multi-tab selection is handled by querying `browser.tabs.query({ windowId: tab.windowId, highlighted: true })` when the menu item is clicked — `highlighted: true` returns all Ctrl/Shift-selected tabs in that window, not just the right-clicked one. For cross-window moves, `browser.tabs.move(tabIds, { windowId: targetWindowId, index: -1 })` physically relocates tabs without reloading page content, satisfying D-04/D-05. For same-window moves, tabs are already in the window so the operation serializes moved tabs into the target workspace and then calls `switchWorkspace()` to show the target.

The critical MV3 constraint is that `menus.create()` must be called inside `browser.runtime.onInstalled` (not at module top-level), while `browser.menus.onClicked` must be used instead of the `onclick` property. Menu items persist across event-page restarts automatically once registered in `onInstalled`.

**Primary recommendation:** Use `menus.onShown` to rebuild child menu items dynamically on every open (remove all children, recreate from current workspace list, call `menus.refresh()`). This is simpler and more reliable than incremental update and handles the MENU-03 requirement automatically.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `browser.menus` | Built-in (Firefox 55+) | Create/manage context menu items | Only Firefox WebExtensions API for context menus |
| `browser.tabs.move()` | Built-in | Move tabs between windows without reload | Only API that preserves tab state across windows (D-05) |
| `browser.tabs.query()` | Built-in | Retrieve highlighted (multi-selected) tabs | Only way to enumerate Ctrl+click selected tabs |
| `browser.windows.update()` | Built-in | Focus target window after cross-window move | Already used in existing `focusWindow` message handler |

No npm packages required — pure Firefox WebExtensions API.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `browser.tabs.move()` for cross-window | Close + recreate tabs in target window | Causes full page reload, loses form state — violates D-04 |
| `menus.onShown` rebuild | `menus.update()` per item | More complex, needs tracking of item IDs that match workspace IDs; `onShown` rebuild is simpler and equally performant |
| `menus.onShown` rebuild | Storage change listener to rebuild menus | Async, harder to coordinate; `onShown` is the right event because menu state needs to be current at open time, not at workspace-change time |

---

## Architecture Patterns

### New File

```
src/background/
├── index.js        # Add: menus.create in onInstalled, menus.onShown, menus.onClicked listeners
├── menus.js        # NEW: menu creation, onShown handler, onClicked handler
├── workspaces.js   # Add: moveTabsToWorkspace() function
├── messaging.js    # No changes needed
├── state.js        # May add: lastUsedAt timestamp helpers
└── sync.js         # No changes needed
```

### Pattern 1: Menu Registration in `onInstalled` (MV3 Required)

**What:** `browser.menus.create()` must be called inside `browser.runtime.onInstalled`, not at top-level or in module init for MV3 event pages. The parent item persists; children are managed dynamically via `onShown`.

**When to use:** Required for all Firefox MV3 extensions. Top-level calls would re-create items on every event-page wake.

**Example:**
```javascript
// Source: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus
// In index.js inside the existing onInstalled listener:
browser.runtime.onInstalled.addListener(async (details) => {
  // ... existing install logic ...

  // Create the persistent parent menu item (children are built dynamically)
  browser.menus.create({
    id: 'move-to-workspace',
    title: 'Move to Workspace',
    contexts: ['tab'],
  })
})
```

### Pattern 2: Dynamic Submenu via `menus.onShown`

**What:** On every menu open, remove all previously created child items and recreate them from the current workspace list. Call `menus.refresh()` to commit changes before the menu is shown.

**When to use:** MENU-03 requires the list to always reflect current state. `onShown` fires just before display, making it the correct hook. The operation is synchronous (no async API calls needed — workspace data is fetched async but guarded with instance ID).

**Example:**
```javascript
// Source: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/onShown
let lastMenuInstanceId = 0
let nextMenuInstanceId = 1
const CHILD_ID_PREFIX = 'move-to-ws-'

browser.menus.onShown.addListener(async (info, tab) => {
  if (!info.contexts.includes('tab')) return  // Only care about tab context

  const menuInstanceId = nextMenuInstanceId++
  lastMenuInstanceId = menuInstanceId

  const [workspaces, windowMap] = await Promise.all([
    getWorkspaces(),
    getWindowMap(),
  ])

  if (menuInstanceId !== lastMenuInstanceId) return  // Menu closed during async fetch

  const activeWsId = windowMap[String(tab.windowId)]

  // Remove stale child items
  await removeAllSubmenuChildren()

  // Rebuild children sorted by lastUsedAt (most recently used first)
  const candidates = workspaces
    .filter(ws => ws.id !== activeWsId)
    .sort((a, b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt))

  for (const ws of candidates) {
    const isElsewhere = Object.values(windowMap).includes(ws.id)
    const label = isElsewhere
      ? `${ws.name} (${ws.tabs.length} tabs) [open]`   // D-11: indicator
      : `${ws.name} (${ws.tabs.length} tabs)`           // D-10
    browser.menus.create({
      id: CHILD_ID_PREFIX + ws.id,
      parentId: 'move-to-workspace',
      title: label,
      contexts: ['tab'],
    })
  }

  browser.menus.refresh()
})
```

### Pattern 3: Multi-Tab Selection via `tabs.query({ highlighted: true })`

**What:** When a menu item is clicked, `onClicked` receives the right-clicked `tab` object. Query all highlighted tabs in that window to get the full selection.

**When to use:** MENU-04 — all Ctrl+click / Shift+click highlighted tabs must move together.

**Example:**
```javascript
// Source: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/query
browser.menus.onClicked.addListener(async (info, tab) => {
  if (!info.menuItemId.startsWith(CHILD_ID_PREFIX)) return

  const targetWsId = info.menuItemId.slice(CHILD_ID_PREFIX.length)

  // Collect all highlighted tabs in the source window
  const highlightedTabs = await browser.tabs.query({
    windowId: tab.windowId,
    highlighted: true,
  })
  // If nothing highlighted beyond the right-clicked tab, fall back to just that tab
  const tabsToMove = highlightedTabs.length > 0 ? highlightedTabs : [tab]

  await moveTabsToWorkspace(tabsToMove, targetWsId, tab.windowId)
})
```

### Pattern 4: `moveTabsToWorkspace()` — Same-window vs. Cross-window

**What:** The move operation has two distinct paths depending on whether the target workspace is active in a different window or not active anywhere.

**Scenario A — Target workspace is inactive (stored, not open in any window):**
1. Save moved tabs' current state into target workspace's `tabs` array
2. Update source workspace's `tabs` array by removing the moved tabs
3. Call `switchWorkspace(targetWsId, sourceWindowId)` — this closes old tabs and opens new ones. The moved tabs are NOT in the current window at switch time, so they'll be opened fresh from the saved tab data.

> Note on D-06/D-07: For same-window switches where we want to keep moved tabs alive, the simplest approach is to save the moved tabs into the target workspace, then call switchWorkspace which will recreate them. D-07 explicitly allows starting with the reload approach if keeping them alive adds significant complexity.

**Scenario B — Target workspace is active in another window:**
1. Use `browser.tabs.move(tabIds, { windowId: targetWindowId, index: -1 })` to physically move tabs (D-05, no reload)
2. Update source workspace's `tabs` array to remove moved tabs
3. Update target workspace's `tabs` array (query target window's tabs after move)
4. Call `browser.windows.update(targetWindowId, { focused: true })` (D-02/D-03)
5. Save both updated workspaces

**Example:**
```javascript
// Source: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/move
export async function moveTabsToWorkspace(tabs, targetWsId, sourceWindowId) {
  await setSessionState({ isSwitching: true })
  const snapshot = null  // build before mutations for rollback (D-09)

  try {
    const workspaces = await getWorkspaces()
    const windowMap = await getWindowMap()

    const targetWs = workspaces.find(w => w.id === targetWsId)
    if (!targetWs) return { success: false, error: 'Target workspace not found' }

    // Snapshot for rollback
    const snapWorkspaces = JSON.parse(JSON.stringify(workspaces))

    const tabIds = tabs.map(t => t.id)
    const sourceWs = workspaces.find(w => w.id === windowMap[String(sourceWindowId)])

    // Find target window (if workspace is active elsewhere)
    const targetWindowId = Object.entries(windowMap)
      .find(([, wsId]) => wsId === targetWsId)?.[0]

    if (targetWindowId) {
      // Cross-window: physically move tabs (no reload, D-05)
      await browser.tabs.move(tabIds, { windowId: Number(targetWindowId), index: -1 })

      // Update stored tab lists
      if (sourceWs) {
        const movedUrls = new Set(tabs.map(t => t.url))
        sourceWs.tabs = sourceWs.tabs.filter(t => !movedUrls.has(t.url))
      }
      const targetWindowTabs = await browser.tabs.query({ windowId: Number(targetWindowId) })
      targetWs.tabs = serializeTabs(targetWindowTabs)

      await saveWorkspaces(workspaces)
      await browser.windows.update(Number(targetWindowId), { focused: true })
    } else {
      // Same-window: save moved tabs into target, remove from source, then switch
      const movedTabData = serializeTabs(tabs)
      targetWs.tabs = [...targetWs.tabs, ...movedTabData]
      if (sourceWs) {
        const movedUrls = new Set(tabs.map(t => t.url))
        sourceWs.tabs = sourceWs.tabs.filter(t => !movedUrls.has(t.url))
      }
      await saveWorkspaces(workspaces)
      await switchWorkspace(targetWsId, sourceWindowId)
    }

    return { success: true }
  } catch (e) {
    console.error('[Workspaces] Move error:', e)
    if (snapWorkspaces) {
      await saveWorkspaces(snapWorkspaces).catch(err =>
        console.error('[Workspaces] Move rollback failed:', err)
      )
    }
    return { success: false, error: e.message }
  } finally {
    await setSessionState({ isSwitching: false })
  }
}
```

### Pattern 5: `lastUsedAt` Timestamp for MRU Ordering (D-12)

**What:** Add a `lastUsedAt` field to workspace objects, updated whenever a workspace is switched to. Used to sort submenu entries (D-12).

**When to use:** Required for D-12. Track in `switchWorkspace()` and `moveTabsToWorkspace()` when a workspace becomes the active destination.

**Example:**
```javascript
// In switchWorkspace(), just before saving:
workspaces[targetIdx].lastUsedAt = Date.now()

// In moveTabsToWorkspace(), just before saving:
targetWs.lastUsedAt = Date.now()
```

### Anti-Patterns to Avoid

- **`onclick` in `menus.create()`:** Throws synchronously in MV3 event pages. Use `browser.menus.onClicked` listener exclusively.
- **`menus.create()` at module top-level:** Will re-create duplicate items on every event-page wake. Place only the persistent parent in `onInstalled`.
- **Not calling `menus.refresh()` after `onShown` updates:** Menu will show stale items. `refresh()` is mandatory after any `update()`/`create()`/`remove()` inside `onShown`.
- **Not guarding async operations in `onShown` with instance ID:** If workspace fetch takes > a few ms while user has already dismissed the menu, stale data overwrites correct state. The `menuInstanceId` guard prevents this.
- **Moving pinned tabs across windows without checking:** `browser.tabs.move()` silently fails for pinned tabs moved after unpinned tabs. Either filter out pinned tabs or move them first.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-window tab move without reload | Custom tab serialization + close/reopen | `browser.tabs.move()` | Only way to preserve page state (D-05); custom approach causes reload |
| Tab context menu | Custom overlay / content script click intercept | `browser.menus` with `contexts: ["tab"]` | WebExtensions provides native integration; overlays don't intercept tab strip right-click |
| Multi-tab selection detection | Track click events with content scripts | `browser.tabs.query({ highlighted: true })` | Firefox exposes this via the tabs API natively; no custom tracking needed |
| Dynamic menu content | Rebuild on every storage change | `menus.onShown` + `menus.refresh()` | `onShown` fires at exactly the right moment; storage listeners would waste API calls on every workspace mutation |

**Key insight:** The `browser.menus` API with `onShown` provides exactly the dynamic-on-open pattern needed for this feature. Do not attempt to pre-build or cache menu state.

---

## Common Pitfalls

### Pitfall 1: `menus.create()` called outside `onInstalled` in MV3

**What goes wrong:** If `menus.create()` is called at module top-level (like other event listeners in `index.js`), each time the event page wakes up (tab event, message, etc.) it will try to create items that already exist, causing errors. Items may also not persist if the background wakes without the install event.

**Why it happens:** MV3 event pages have a different lifecycle than persistent backgrounds. The MDN and Extension Workshop documentation both state menus must be registered in `onInstalled` for MV3.

**How to avoid:** Place `browser.menus.create()` for the parent item only inside the existing `browser.runtime.onInstalled.addListener()` block in `index.js`.

**Warning signs:** Console errors like "Could not create the context menu item" or duplicate items appearing.

### Pitfall 2: `tabs.onAttached` / `tabs.onDetached` firing during `browser.tabs.move()`

**What goes wrong:** `browser.tabs.move()` triggers `tabs.onDetached` (from source window) and `tabs.onAttached` (to target window). The existing `index.js` already listens to `onAttached` and `onDetached` and calls `throttledSave()`. This will trigger a save of the source window mid-operation.

**Why it happens:** `tabs.move()` is an asynchronous operation; during it, the tab temporarily belongs to neither window. The `onDetached` event fires before `onAttached`.

**How to avoid:** Set `isSwitching: true` via `setSessionState` before calling `browser.tabs.move()` (already done in Pattern 4 above). The existing `throttledSave()` already guards on `isSwitching`. Clear it in `finally`.

**Warning signs:** Source workspace is saved with empty or inconsistent tab list during cross-window move.

### Pitfall 3: Pinned tabs silently fail in `browser.tabs.move()`

**What goes wrong:** If a user Ctrl+clicks several tabs including pinned ones, `browser.tabs.move()` will silently reject the move for pinned tabs that would be placed after unpinned tabs (index ordering constraint).

**Why it happens:** Browser enforces that pinned tabs cannot follow unpinned tabs. No error is thrown — the move simply doesn't happen for those tabs.

**How to avoid:** Sort `tabIds` so pinned tabs come first when calling `browser.tabs.move()`. Or explicitly detect and skip pinned tabs with a log message.

**Warning signs:** Some tabs from a multi-select operation are not moved; no error in console.

### Pitfall 4: `browser.tabs.query({ highlighted: true })` includes the active tab even if not explicitly selected

**What goes wrong:** The currently active tab is always `highlighted: true`, even when the user has only Ctrl+clicked other tabs. This means if the user right-clicks a non-active tab and the active tab is in the same window, both will be returned by the highlighted query — but the user may not intend to move the active tab.

**Why it happens:** The `highlighted` property is defined as "part of the current tab selection" — and the active tab is always considered selected.

**How to avoid:** When the context is a tab right-click (`contexts: ["tab"]`), the `tab` object in `onClicked` is the right-clicked tab. The semantically correct behavior is: move all highlighted tabs (the user's explicit multi-selection). If the user right-clicked on a non-highlighted tab (i.e., `tab.highlighted === false`), move only that one tab. If `tab.highlighted === true`, move all highlighted tabs.

**Warning signs:** Active tab is unexpectedly moved to the target workspace when user only selected a few other tabs.

### Pitfall 5: D-13 — inserting inside Firefox's built-in "Move Tab" menu is not possible via WebExtensions API

**What goes wrong:** The user/CONTEXT.md requested placing "Move to Workspace" inside Firefox's native "Move Tab" submenu. The WebExtensions `browser.menus` API cannot inject items into Firefox's built-in submenus — extension items are always appended to the tab context menu at the top level or as their own submenu.

**Why it happens:** The `menus` API adds extension-owned items; it cannot modify Firefox's built-in menu structure.

**How to avoid (per D-13's fallback):** Create a top-level tab context menu item titled "Move to Workspace" with its own submenu. This is explicitly permitted as the fallback in the Decisions section.

**Warning signs:** Attempts to use `parentId` referencing a Firefox built-in menu item ID will fail silently.

---

## Code Examples

### Create parent menu item (in `onInstalled`)

```javascript
// Source: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/create
browser.runtime.onInstalled.addListener(async (details) => {
  // ... existing logic ...

  browser.menus.create({
    id: 'move-to-workspace',
    title: 'Move to Workspace',
    contexts: ['tab'],
  })
})
```

### Register listeners at top-level (required for event page wakeup)

```javascript
// Source: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus
// In index.js — top-level, synchronous
browser.menus.onShown.addListener(handleMenuShown)
browser.menus.onClicked.addListener(handleMenuClicked)
```

### Remove all children of the parent item

```javascript
// No built-in removeChildren — track child IDs manually or use prefix convention
const CHILD_ID_PREFIX = 'move-to-ws-'

async function removeAllSubmenuChildren() {
  // browser.menus has no "getAll" — track child IDs in module-level Set
  for (const id of currentChildIds) {
    await browser.menus.remove(id)
  }
  currentChildIds.clear()
}
```

> Note: `browser.menus` has no `getAll()` or `getChildren()` method. The module must track child item IDs in a module-level Set updated on each `onShown` rebuild.

### Move tabs cross-window with state preservation

```javascript
// Source: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/move
const tabIds = highlightedTabs.map(t => t.id)
await browser.tabs.move(tabIds, { windowId: targetWindowId, index: -1 })
```

### Focus target window after cross-window move

```javascript
// Source: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/update
await browser.windows.update(targetWindowId, { focused: true })
```

### Query highlighted tabs in a window

```javascript
// Source: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/query
const highlightedTabs = await browser.tabs.query({
  windowId: sourceWindowId,
  highlighted: true,
})
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `onclick` parameter in `menus.create()` | `browser.menus.onClicked` listener | MV3 / Firefox 55+ | `onclick` throws in event pages; must use listener |
| `menus.create()` at top-level | `menus.create()` in `onInstalled` | MV3 event pages | Prevents duplicate item errors on event-page wake |
| `contextMenus` namespace | `menus` namespace (preferred) | Firefox 55 | `menus` is the canonical name; `contextMenus` is the alias |
| `contexts: ["page"]` (default) | `contexts: ["tab"]` | Available since Firefox 63 | Required for tab strip right-click context |

**Deprecated/outdated:**
- `onclick` property in `menus.create()`: Throws synchronously in MV3 event pages. Use `menus.onClicked` listener.
- `browser.contextMenus`: Still works as alias but `browser.menus` is canonical for Firefox.

---

## Open Questions

1. **`lastUsedAt` field in workspace schema (D-12)**
   - What we know: Workspace objects currently have `{ id, name, color, tabs, createdAt }`. The schema in `sync.js` serialization strips `favIconUrl`. A `lastUsedAt` field would need to be persisted.
   - What's unclear: `lastUsedAt` needs to round-trip through the sync serialization layer (`serializeToSyncItems` / `assembleFromSync`). The metadata object in `ws:{id}` already stores arbitrary fields (`createdAt`, etc.) so adding `lastUsedAt` to the metadata key should work. Verification needed.
   - Recommendation: Add `lastUsedAt` to the `items[key]` metadata in `serializeToSyncItems()` and read it back in `assembleFromSync()`. Update in `switchWorkspace()` and in the new `moveTabsToWorkspace()`.

2. **Child item ID tracking without `browser.menus.getAll()`**
   - What we know: The menus API does not expose a list of existing items. To remove children before rebuilding, the code must track them.
   - What's unclear: Module-level state in an event page resets on wakeup. If the background wakes fresh for the `onShown` event, the child ID Set is empty — but menus created in a previous session's `onShown` are also gone (menus created in `onShown` are not persistent, only menus from `onInstalled` persist).
   - Recommendation: Use the `CHILD_ID_PREFIX` convention. On `onShown`, call `browser.menus.remove()` for each known child ID, ignoring errors (items may not exist). Then recreate. This is safe because `onShown` child items from a previous menu open are automatically cleaned up when the menu closes.

3. **"Active in another window" visual indicator (D-11, discretionary)**
   - What we know: Menu item `title` is plain text — no color, icon, or bold. Icons can only be set on submenu items (not top-level context menu items per MDN). The `icons` property IS available on submenu children.
   - Recommendation: Append `[open]` text suffix (or `[window 2]` if window count is useful) to the label for workspaces active elsewhere. Optionally use a small color square SVG icon if distinguishing visually is important.

---

## Sources

### Primary (HIGH confidence)
- MDN `browser.menus` - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus
- MDN `menus.create()` - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/create
- MDN `menus.ContextType` - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/ContextType
- MDN `menus.onShown` - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/onShown
- MDN `menus.onClicked` - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/onClicked
- MDN `tabs.move()` - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/move
- MDN `tabs.query()` - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/query
- MDN `tabs.Tab` (highlighted property) - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/Tab
- MDN `windows.update()` - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/update
- MDN Background scripts (event page guidance) - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts
- Firefox Extension Workshop MV3 Migration Guide - https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/

### Secondary (MEDIUM confidence)
- Mozilla Discourse: MV3 menus.create in onInstalled behavior - https://discourse.mozilla.org/t/strange-mv3-behaviour-browser-runtime-oninstalled-event-and-menus-create/111208
- MDN permissions - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/permissions

### Tertiary (LOW confidence)
- `browser.tabs.move()` cross-window behavior regarding page reload: MDN documents it as a move operation without specifying reload behavior; based on D-04/D-05 user confirmation and analogy to drag-and-drop, tab state is preserved. Direct testing recommended during implementation.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all APIs documented on MDN, verified against current Firefox 142+ target
- Architecture: HIGH — `onShown` pattern is the documented standard for dynamic menus; verified in MDN examples
- Pitfalls: HIGH for P1/P2/P3/P5 (verified from official docs and Discourse); MEDIUM for P4 (highlighted behavior reasoned from API docs)
- Tab state preservation with `tabs.move()`: MEDIUM — behavior documented but reload specifics not explicitly stated; consistent with D-04/D-05 decisions

**Research date:** 2026-03-24
**Valid until:** 2026-09-24 (stable API — Firefox WebExtensions menus API changes rarely)
