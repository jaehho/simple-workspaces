# Stack Research

**Domain:** Firefox WebExtension — context menu tab movement, new-window workspace opening, circular dependency resolution
**Researched:** 2026-03-23
**Confidence:** HIGH (APIs verified against MDN official documentation)

---

## Context

This is a subsequent-milestone stack document for v1.1. The prior milestone (v1.0) delivered the
validated stack in full: MV3, ES module background, storage.sync with chunked schema, storage.session
window map, atomic switching with rollback. That foundation is complete and not re-researched here.

This document covers only the three new capability areas:
1. Context menu API (`browser.menus`) for "Move to Workspace" tab context menus
2. Window creation / tab movement APIs for opening workspaces in new windows
3. Module dependency resolution pattern for the state.js ↔ workspaces.js circular import

No new npm dependencies are required. All capabilities are built-in Firefox WebExtension APIs.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `browser.menus` API | Built-in (Firefox 55+ as `menus`) | Tab context menu items for "Move to {workspace}" | The only WebExtension API for tab bar right-click menus; `contexts: ["tab"]` is the correct context type for tab strip menus |
| `browser.menus.onShown` + `menus.refresh()` | Built-in (Firefox 60+) | Rebuild workspace submenu dynamically before the menu appears | Allows lazy population of workspace items so the list is always current without creating/destroying items on every workspace change |
| `browser.tabs.query({ highlighted: true, windowId })` | Built-in | Get all currently multi-selected tabs at menu click time | `highlighted: true` is the correct filter for Firefox multi-selected tabs; the `tab` parameter in `menus.onClicked` only gives the single right-clicked tab |
| `browser.tabs.move(tabIds, { windowId, index })` | Built-in | Move one or more tabs to a target window | Accepts an array of tab IDs and a target windowId; use index: `-1` to append at end |
| `browser.windows.create({ url: [...] })` | Built-in | Open a workspace's tabs in a brand-new window | Accepts a URL array to open all tabs at once; does NOT accept multiple existing tabIds — use tabs.move() after create() for existing tabs |
| `browser.windows.create({ tabId })` | Built-in | Move a single existing tab to a new window as the seed | Can only receive one tabId; for multi-tab new-window creation from existing tabs, create with first tab then move remaining tabs |

### Supporting Libraries

None. All capabilities are native Firefox WebExtension APIs. Adding any library would require a build
pipeline that does not exist and is not warranted for this scope.

### Development Tools

No change from existing toolchain. `web-ext lint` will flag if the `menus` permission is missing from
the manifest — that is the only new manifest change required.

---

## API Decisions by Change Area

### 1. Context Menu: "Move to Workspace"

**Permission required:** Add `"menus"` to the `permissions` array in `manifest.json`.

```json
"permissions": ["tabs", "storage", "menus"]
```

The legacy alias `"contextMenus"` also works and grants access to `browser.contextMenus`, but
`"menus"` is the current name and maps to `browser.menus`. Use `"menus"` for consistency with
the current API surface.

**When to call `menus.create()`:** For MV3 non-persistent event pages (which this extension uses),
menu items registered via `menus.create()` persist across background script restarts. However, the
static parent item and workspace child items need to be created. Use `runtime.onInstalled` for the
initial static parent item, and `menus.onShown` + `menus.refresh()` for the dynamic workspace
children. This avoids accumulating duplicate items if the background restarts.

**Recommended menu structure:**

```javascript
// In runtime.onInstalled listener — create the static parent once
browser.menus.create({
  id: 'move-to-workspace',
  title: 'Move to Workspace',
  contexts: ['tab'],
})

// In menus.onShown — rebuild children against current workspace list
browser.menus.onShown.addListener(async (info, tab) => {
  // Only act when our parent item is in the shown menu
  if (!info.menuIds.includes('move-to-workspace')) return

  // Remove stale children
  const workspaces = await getWorkspaces()
  // Re-populate children (removeAll children, then recreate)
  // ... see ARCHITECTURE.md for full pattern
  await browser.menus.refresh()
})
```

**Why `onShown` + `refresh()` rather than `removeAll` + `create` on every workspace change:**

Rebuilding menus on every storage write is wasteful — the menu is rarely open. The `onShown` pattern
rebuilds only when the menu is actually about to appear, and `refresh()` applies changes while the
menu is visible. This is the MDN-documented pattern for dynamic menu content.

**Constraint — async in `onShown`:** If `onShown` calls async APIs, there is a race: the menu may
close before the async work completes. Mitigate by caching the workspace list in `storage.session`
(already maintained by the existing state layer) and reading from the cache synchronously where
possible, or by keeping the async window very small.

**Identifying which tabs to move:**

The `tab` argument to `menus.onClicked` is the single tab that was right-clicked. To respect Firefox
multi-tab selection, also query for highlighted tabs in the same window:

```javascript
browser.menus.onClicked.addListener(async (info, tab) => {
  if (!info.menuItemId.startsWith('ws-target:')) return

  const targetWorkspaceId = info.menuItemId.replace('ws-target:', '')

  // Collect all highlighted (multi-selected) tabs; fall back to the single clicked tab
  const highlighted = await browser.tabs.query({
    windowId: tab.windowId,
    highlighted: true,
  })
  const tabsToMove = highlighted.length > 1 ? highlighted : [tab]

  // ... dispatch moveTabsToWorkspace(tabsToMove, targetWorkspaceId, tab.windowId)
})
```

**Confidence: HIGH** — `browser.menus` API, `contexts: ["tab"]`, `onShown`/`refresh()` pattern, and
`tabs.query({ highlighted: true })` all verified against MDN official documentation.

---

### 2. Open Workspace in New Window

**Two distinct user flows require different implementations:**

**Flow A — Open an unassigned workspace in a new window (from unassigned window popup):**
The workspace has a saved tabs array. Create a new window using `windows.create({ url: [...] })` with
the tab URLs as an array. This is the cleanest path — no existing tabs to move.

```javascript
async function openWorkspaceInNewWindow(workspaceId) {
  const workspaces = await getWorkspaces()
  const ws = workspaces.find(w => w.id === workspaceId)
  if (!ws) return { success: false, error: 'Workspace not found' }

  const urls = ws.tabs.length > 0
    ? ws.tabs.map(t => t.url)
    : ['about:newtab']

  const newWin = await browser.windows.create({ url: urls })
  await setWindowEntry(newWin.id, workspaceId)
  updateBadge(ws, newWin.id)
  return { success: true, windowId: newWin.id }
}
```

**Flow B — Middle-click or Ctrl+click from the popup (any workspace, including assigned ones):**
Same as Flow A — the workspace's saved tabs are opened in a new window. The workspace becomes
assigned to the new window. The previous window's assignment is unchanged (exclusive ownership
check: verify the workspace is not already active in another window before assigning the new window).

**Constraint — `windows.create()` accepts only one `tabId`:** The API signature is:
```javascript
windows.create({ tabId: integer })  // single existing tab only
```
For moving multiple existing tabs to a new window, the correct sequence is:
1. `windows.create({ tabId: firstTab.id })` — creates the window with one tab
2. `tabs.move(remainingTabIds, { windowId: newWin.id, index: -1 })` — moves the rest

For the workspace use case (opening from saved URL list, not from live tabs), `windows.create({ url: [...] })` is simpler and preferred.

**`about:newtab` handling:** Firefox will reject `about:newtab` passed in the `url` array to
`windows.create()`. For newtab entries, omit the URL (Firefox defaults new tabs to about:newtab):

```javascript
const urls = ws.tabs
  .filter(t => t.url && !t.url.startsWith('about:'))
  .map(t => t.url)
// If no URLs remain, let windows.create() open a single default tab
const createProps = urls.length > 0 ? { url: urls } : {}
const newWin = await browser.windows.create(createProps)
```

**Confidence: HIGH** — `windows.create()` parameter shape and single-tabId limitation verified against
MDN documentation. URL array behavior for newtab verified via MDN tabs API documentation.

---

### 3. Circular Dependency Resolution: state.js ↔ workspaces.js

**The cycle:**

```
state.js        imports  saveCurrentWorkspace  from  workspaces.js
workspaces.js   imports  getSessionState, setSessionState,
                         getWindowMap, setWindowEntry      from  state.js
```

This is a real circular dependency in ES module static imports, not just a theoretical one. ES
modules resolve circular imports by providing incomplete exports at the time the cycle is first
encountered — functions work fine because function declarations are hoisted, but the execution-order
risk is real and will cause `undefined` errors if any module-level initialization code references
the other module's exports directly.

**Recommended fix: extract a `storage.js` module as shared neutral ground.**

The root cause is that `state.js` only needs `saveCurrentWorkspace` from `workspaces.js` for the
`throttledSave` function. Move all `browser.storage.session` primitives into a new `storage.js`, and
have both `state.js` and `workspaces.js` import from it instead of from each other.

```
storage.js      (new)  — raw storage.session read/write: getSessionState, setSessionState,
                          getWindowMap, setWindowEntry, removeWindowEntry
state.js        (revised) — imports from storage.js only; throttledSave calls saveCurrentWorkspace
                              via a callback registered at startup (no import of workspaces.js)
workspaces.js   (revised) — imports from storage.js only (replaces state.js imports)
index.js        (revised) — registers the throttledSave→saveCurrentWorkspace wiring at startup
```

**Alternative: dependency injection via a registered callback.**

If extracting `storage.js` is disruptive to the milestone scope, a lighter fix is to break the
import cycle by injecting the `saveCurrentWorkspace` function into `state.js` at startup rather
than importing it statically:

```javascript
// state.js — no static import of workspaces.js
let _saveCurrentWorkspace = null

export function registerSaveCallback(fn) {
  _saveCurrentWorkspace = fn
}

export async function throttledSave(windowId) {
  // ... guard checks ...
  if (_saveCurrentWorkspace) await _saveCurrentWorkspace(windowId)
}
```

```javascript
// index.js — wires the dependency after both modules are loaded
import { registerSaveCallback } from './state.js'
import { saveCurrentWorkspace } from './workspaces.js'
registerSaveCallback(saveCurrentWorkspace)
```

This resolves the cycle without restructuring the module graph. It is the lower-risk option for a
milestone that has other concurrent work. The `storage.js` extraction is the cleaner long-term
architecture.

**Which to use:**

Use the dependency injection approach (registered callback) for this milestone. It is a surgical
two-file change, introduces no new module boundary that must be tested, and the circular dependency
is latent (functions work at runtime in Firefox today because of hoisting). The `storage.js`
extraction can be done as a dedicated refactor milestone when there is no concurrent feature work.

**Confidence: HIGH** — ES module circular dependency behavior is well-specified. The injection
pattern is a standard technique verified against general ES module documentation and community
practice. No Firefox-specific behavior involved.

---

## Manifest Changes Required

The only manifest change this milestone requires is adding `"menus"` to permissions:

```json
{
  "permissions": ["tabs", "storage", "menus"]
}
```

No new host permissions. No new background scripts. The existing `"management"` permission already
present in `messaging.js` (`browser.management.getSelf()`) is handled — check `manifest.json` to
confirm it is declared; if not, add it alongside `"menus"`.

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `"contextMenus"` permission | Deprecated name; aliases to `browser.contextMenus` not `browser.menus` | `"menus"` permission with `browser.menus.*` |
| `menus.create()` at top level for dynamic items | On non-persistent event pages, top-level calls run on every background restart; dynamic workspace items will accumulate duplicates | `runtime.onInstalled` for the static parent; `menus.onShown` + `menus.refresh()` for dynamic children |
| `menus.removeAll()` + rebuild on workspace CRUD | Wasteful if the menu is never opened; breaks any other menu items the extension might add | `onShown` lazy rebuild |
| `windows.create({ tabId: [id1, id2] })` | `tabId` is an integer, not an array — passing an array silently fails or throws | `windows.create({ url: [...] })` for URL-based open; `windows.create({ tabId: firstId })` then `tabs.move(rest, ...)` for existing-tab moves |
| `info.tab` from `menus.OnClickData` to get the right-clicked tab | `menus.OnClickData` does not have a `tab` property; the tab is the second parameter to the `onClicked` listener | The second argument to `menus.onClicked.addListener((info, tab) => ...)` |
| Checking `OnClickData` for multi-selected tab list | `OnClickData` has no `selectedTabs` or `highlighted` field | `browser.tabs.query({ windowId: tab.windowId, highlighted: true })` at click time |
| Static import of `workspaces.js` from `state.js` | Creates the circular dependency being fixed | Dependency injection via registered callback, or extract shared `storage.js` |

---

## Version Compatibility

| API / Feature | Firefox Version | Notes |
|---------------|-----------------|-------|
| `browser.menus` API | Firefox 55+ | Available as `menus`; older alias `contextMenus` exists from pre-55 |
| `menus.onShown` + `menus.refresh()` | Firefox 60+ | Required for dynamic menu rebuild pattern |
| `browser.menus` with `contexts: ["tab"]` | Firefox 55+ | Tab strip context menus supported from initial menus API release |
| `browser.tabs.query({ highlighted: true })` | All supported Firefox versions | `highlighted` property in QueryInfo is stable |
| `browser.tabs.move(tabIds[], { windowId })` | All supported Firefox versions | Array of tabIds accepted; cross-window move via windowId |
| `browser.windows.create({ url: [] })` | All supported Firefox versions | URL array for multi-tab window open |
| ES module circular dependency injection | N/A (language feature) | Resolved at module load time; no Firefox version constraint |

All APIs are within Firefox 142+. No compatibility gaps.

---

## Integration Points with Existing Module Structure

| New Capability | Integrates With | Notes |
|---------------|-----------------|-------|
| `browser.menus` listener registration | `background/index.js` | Register `menus.onClicked` and `menus.onShown` listeners at top level alongside existing tab/window listeners |
| Move tabs to workspace | `background/workspaces.js` | Add `moveTabsToWorkspace(tabIds, targetWorkspaceId, sourceWindowId)` — saves source workspace, moves tabs, updates window map |
| Open workspace in new window | `background/workspaces.js` | Add `openWorkspaceInNewWindow(workspaceId)` — wraps `windows.create()` + `setWindowEntry()` + `updateBadge()` |
| New message actions | `background/messaging.js` | Add `moveTabsToWorkspace` and `openInNewWindow` cases to the `handleMessage` switch |
| Circular dependency fix | `background/state.js` + `background/index.js` | Add `registerSaveCallback()` to `state.js`, call it from `index.js` after imports |
| Popup "open in new window" | `popup/popup.js` | Middle-click and Ctrl+click handlers dispatch `openInNewWindow` message; remove "Assign Here" button |

---

## Sources

- [MDN: browser.menus API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus) — Full API surface, `contexts: ["tab"]`, onClicked/onShown/onHidden events, permission name
- [MDN: menus.create()](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/create) — CreateProperties shape, when to call in non-persistent pages, parentId for submenus
- [MDN: menus.onShown](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/onShown) — Info object shape, tab parameter, async race condition warning
- [MDN: menus.refresh()](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/refresh) — onShown + refresh() dynamic update pattern, performance warning
- [MDN: menus.OnClickData](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/OnClickData) — Full property list; confirmed no selectedTabs or highlighted field
- [MDN: tabs.Tab](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/Tab) — `highlighted` property definition; active tabs are always highlighted; multi-select via Ctrl/Shift
- [MDN: tabs.query()](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/query) — `highlighted: boolean` in QueryInfo confirmed
- [MDN: tabs.move()](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/move) — Array of tabIds, cross-window move via windowId, index: -1 for end
- [MDN: windows.create()](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/create) — CreateData shape; `tabId` is integer (single tab only); `url` accepts string array
- [MDN: manifest permissions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/permissions) — `"menus"` and `"management"` permission names confirmed

---

*Stack research for: Firefox WebExtension context menu tab movement, new-window workspace opening, circular dependency resolution*
*Researched: 2026-03-23*
