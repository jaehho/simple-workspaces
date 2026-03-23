# Pitfalls Research

**Domain:** Firefox WebExtension — tab/workspace management with MV3 migration, storage.sync, multi-window tracking
**Researched:** 2026-03-21 (v1.0); updated 2026-03-23 (v1.1 — context menu, new-window, circular deps, validation gap)
**Confidence:** HIGH (critical pitfalls verified against MDN, Extension Workshop, and Bugzilla; medium pitfalls from official docs + community sources)

---

## v1.1 Pitfalls (New — context menu, new-window, circular dependencies, storage validation)

### Pitfall V1-1: `menus` permission missing from manifest silently breaks all context menu functionality

**What goes wrong:**
`browser.menus.create()` is called in the background script but the `"menus"` permission is not declared in `manifest.json`. In Firefox, the API is silently unavailable — no error is thrown at call time, but `browser.menus` is `undefined` and context menu items never appear. The extension loads normally, the `runtime.onInstalled` handler completes without error, and the bug is invisible until a user tries to right-click a tab.

**Why it happens:**
The current manifest only declares `["tabs", "storage"]`. Developers familiar with the `browser.tabs` API (which requires no separate permission beyond `"tabs"`) assume context menus work similarly. The WebExtensions polyfill issue tracker confirms `browser.menus is undefined` is a known confusion point when the permission is absent.

**How to avoid:**
Add `"menus"` to the `permissions` array in `manifest.json` before writing any `browser.menus.*` calls. Verify with `web-ext lint` which will flag references to APIs whose permissions are absent.

**Warning signs:**
- `browser.menus` is `undefined` when accessed in the background console.
- No context menu items appear after right-clicking a tab, even with correct `menus.create()` calls.
- No error in the browser console on extension load.

**Phase to address:** Context menu phase, as the very first step before any `browser.menus.*` API usage.

---

### Pitfall V1-2: Context menu items created at top level in MV3 event page are duplicated on every background wake

**What goes wrong:**
In MV3, the background script is non-persistent (an event page). It unloads after ~30 seconds of inactivity and reloads on the next event. If `browser.menus.create()` is called at the top level of `background/index.js` (not inside `runtime.onInstalled`), then every time the background reloads it re-registers all menu items. Firefox does not clear menu items between background reloads — it only clears them when the extension is uninstalled or updated. The result is increasingly duplicate menu entries accumulating until the browser is restarted.

**Why it happens:**
The existing `index.js` registers all event listeners at the top level, which is correct for listeners. Developers apply the same pattern to `menus.create()`, which is correct for MV2 persistent backgrounds but incorrect for MV3 event pages.

**How to avoid:**
Register context menu items only inside `browser.runtime.onInstalled.addListener()`. This callback runs once on install/update and correctly bypasses the duplicate-creation problem. The `menus.onClicked` listener, however, must remain at the top level so it survives background reloads.

```javascript
// CORRECT for MV3 event page
browser.runtime.onInstalled.addListener(() => {
  browser.menus.create({ id: 'move-to-ws-parent', title: 'Move to Workspace', contexts: ['tab'] })
})

// onClicked must be top-level (not inside onInstalled)
browser.menus.onClicked.addListener((info, tab) => { ... })
```

**Warning signs:**
- After using the extension for a day, the "Move to Workspace" submenu contains duplicate workspace names.
- Duplicate entries multiply by the number of background reload cycles since the last browser restart.
- The issue disappears on browser restart (because all menu items are cleared on extension unload).

**Phase to address:** Context menu phase, before implementing any menu item creation.

---

### Pitfall V1-3: Dynamic workspace submenu update in `menus.onShown` with async storage read races menu close

**What goes wrong:**
The "Move to Workspace" submenu must list current workspace names. The natural implementation is to read workspaces from `getWorkspaces()` inside a `menus.onShown` handler, then call `menus.update()` and `menus.refresh()` for each item. Because `getWorkspaces()` is async (hits `storage.sync` or `storage.local`), there is a window between the await and the `menus.refresh()` call. If the user dismisses the context menu (clicks elsewhere or presses Escape) during that window, `menus.refresh()` is called on a closed menu, causing an error or silently doing nothing. The menu shows stale workspace names until the next open.

**Why it happens:**
The MDN documentation for `menus.onShown` explicitly warns about this but it is easy to miss. Developers write the async handler as a straightforward async function without the guard check.

**How to avoid:**
Use the MDN-recommended menu instance ID guard pattern:

```javascript
let lastMenuInstanceId = 0
let nextMenuInstanceId = 1

browser.menus.onShown.addListener(async (info, tab) => {
  const menuInstanceId = nextMenuInstanceId++
  lastMenuInstanceId = menuInstanceId

  const workspaces = await getWorkspaces()

  // Menu may have been dismissed while awaiting — check before refreshing
  if (menuInstanceId !== lastMenuInstanceId) return

  for (const ws of workspaces) {
    await browser.menus.update('move-to-' + ws.id, { title: ws.name, visible: true })
  }
  browser.menus.refresh()
})

browser.menus.onHidden.addListener(() => {
  lastMenuInstanceId = 0
})
```

Alternatively, cache the workspace list in `storage.session` and read from cache synchronously to eliminate the async gap entirely.

**Warning signs:**
- Context menu shows workspace names from a previous version of the list (stale after renames).
- Occasional console errors about refreshing a closed menu.
- Menu items are occasionally invisible or empty when opened quickly.

**Phase to address:** Context menu phase, required before using any async call inside `menus.onShown`.

---

### Pitfall V1-4: `menus.onClicked` receives the right-clicked tab in `tab`, but NOT the active tab — moving the wrong tab

**What goes wrong:**
When a context menu is shown in the `tab` context (right-clicking a browser tab), `menus.onClicked` receives a `tab` parameter. Developers assume this is the currently active tab (the one in the foreground). In fact, the `tab` parameter is the tab that was right-clicked, which may be any tab in the tab strip — including an inactive background tab. If the code uses `tab.id` to identify which tab to move, it correctly moves the right-clicked tab. But if the code also reads `tab.windowId` from this parameter and uses it to look up the workspace, it may get the correct window. The failure is if the code calls `browser.tabs.query({ active: true, currentWindow: true })` to find "the tab to move" instead of using `info` and `tab` directly — it then always moves the active tab, ignoring the user's actual selection.

**Why it happens:**
The `tab` parameter name suggests "the current tab." Developers are habituated to using `tabs.query({ active: true })` in other popup handlers. The context menu click explicitly provides the right-clicked tab — use it directly.

**How to avoid:**
Always use the `tab` parameter from `menus.onClicked` as the source of truth for the target tab. Do not call `tabs.query` to find the tab — it is already provided. For moving the tab, use `browser.tabs.move(tab.id, { windowId: targetWindowId, index: -1 })` or recreate the tab in the target workspace.

**Warning signs:**
- Users report that right-clicking on a background tab and selecting "Move to Workspace" moves the foreground tab instead.
- In logs, the tab ID being moved does not match the tab that was right-clicked.

**Phase to address:** Context menu phase, during implementation of the `menus.onClicked` handler.

---

### Pitfall V1-5: `browser.windows.create()` fires `tabs.onCreated` before `windowMap` is updated — triggering spurious throttled saves

**What goes wrong:**
When opening a workspace in a new window via `browser.windows.create({ url: [...] })`, Firefox fires `tabs.onCreated` for each tab being created before the extension's `windowMap` is updated with the new window's workspace assignment. The existing `throttledSave` handler in `state.js` checks `windowMap` and returns early if the window has no assignment — this is the correct guard. However, if `setWindowEntry()` is called after `windows.create()` resolves rather than immediately before any tabs could be created, the window is briefly untracked. During that window, if `tabs.onCreated` fires and `windowMap` already has a stale entry for a different workspace pointing at the same window ID (impossible given window IDs are unique, but see below), a save would fire incorrectly.

The real risk is the converse: `windows.create()` is called, the promise resolves, and the caller calls `setWindowEntry(newWindow.id, workspaceId)`. But between `windows.create()` resolving and `setWindowEntry()` completing (both async), `tabs.onCreated` fires. The `throttledSave` check finds no entry and correctly skips — this is safe. The actual problem is if `initDefaultWorkspace()` is triggered by `runtime.onInstalled` concurrently for the new window before the caller has a chance to assign the workspace, resulting in the new window getting a freshly-created default workspace instead of the intended workspace.

**Why it happens:**
The event-driven nature of Firefox means external events (`tabs.onCreated`, `windows.onCreated`) can interleave with the caller's async operations. The extension's `runtime.onInstalled` handler calls `initDefaultWorkspace` only on `reason === 'install'` — but the `onStartup` handler calls `reclaimWorkspaces()`, which tries to match windows to workspaces by URL overlap. A new window created by the extension with workspace URLs could be "claimed" by `reclaimWorkspaces` before the explicit `setWindowEntry` runs.

**How to avoid:**
When creating a new window for a workspace, use the promise return value of `windows.create()` and call `setWindowEntry()` immediately on the resolved `window.id` before yielding control. Keep the assignment atomic with the creation by sequencing them without any intervening awaits:

```javascript
const newWin = await browser.windows.create({ url: tabUrls })
await setWindowEntry(newWin.id, workspaceId)  // assign immediately
updateBadge(workspace, newWin.id)
```

Do not `await` anything between `windows.create()` and `setWindowEntry()` that could trigger competing logic.

**Warning signs:**
- A new window opened for a workspace gets assigned to a different workspace (visible via badge showing wrong initial).
- After opening in new window, the badge briefly shows `?` before settling on the correct workspace initial.
- In `storage.session`, the new window ID is absent from `windowMap` for a brief period after `windows.create()` resolves.

**Phase to address:** New-window workspace opening phase, required before implementing `windows.create()` for workspaces.

---

### Pitfall V1-6: Opening a workspace in new window creates duplicate tab objects with new IDs — old workspace tabs are not moved, they are cloned

**What goes wrong:**
Developers reaching for `browser.windows.create({ tabId: existingTabId })` expect this to "move" an existing tab into a new window. This works only when moving a single tab — the tab changes its `windowId` but keeps its `tabId`. When creating a new window for a whole workspace (multiple tabs), using `url` array creates brand-new tab objects with new `tabId` values. The old workspace entry still holds serialized tab data (URLs, titles) — it does not hold live tab IDs. This is correct and expected in the current architecture. The pitfall is conflating "moving tabs" (DOM state, scroll position, form state) with "opening workspace tabs" (creating new tabs from saved URLs). Opening in a new window always creates new tabs from saved URLs — scroll position, form state, and loaded DOM are lost.

**Why it happens:**
The workspace model stores URLs, not tab IDs. This is intentional and correct. The confusion arises when a developer tries to implement "move the current window's live tabs to a new window" as a power feature and reaches for `browser.windows.create({ tabId })` to preserve tab state, finding it only supports one tab.

**How to avoid:**
Accept the architectural constraint: opening a workspace in a new window means restoring from saved tab URLs, not transferring live tabs. Do not attempt to use `tabs.move()` to relocate live tabs into a new workspace-owned window — this bypasses the workspace save/restore cycle and creates inconsistency between the live window and saved workspace data.

If moving a single live tab via context menu into an existing workspace's window, `browser.tabs.move(tabId, { windowId, index: -1 })` is appropriate. For opening a whole workspace in a new window, always create tabs from saved URLs.

**Warning signs:**
- After "Open in New Window," scroll positions are reset (expected, not a bug).
- Attempting to "move" tabs via `tabs.move()` into the new window puts them alongside the workspace's tabs, creating duplicates.
- The workspace entry in storage has `tabs` that no longer match what is open (if live tabs are moved instead of workspace tabs being opened).

**Phase to address:** New-window workspace opening phase, during design of the implementation approach.

---

### Pitfall V1-7: Middle-click and Ctrl+click in popup must use `auxclick` or `mousedown` button check — `click` event does not fire for middle button

**What goes wrong:**
Implementing "Ctrl+click to open workspace in new window" in the popup by listening for `click` events and checking `e.ctrlKey` works correctly. But implementing "middle-click to open workspace in new window" by listening for `click` with `e.button === 1` (middle button) does not — the `click` event is not fired for middle-button clicks in Firefox. Only `auxclick` is fired for non-primary button clicks.

Separately, inside the popup, middle-click on any element will trigger the browser's default "autoscroll" behavior if not prevented. The popup window is small and autoscroll causes visual artifacts.

**Why it happens:**
The W3C `click` event spec fires only for the primary mouse button. `auxclick` was introduced specifically for non-primary buttons. Many developers are unaware of `auxclick` because `click` works for most UI purposes.

**How to avoid:**
Use `auxclick` for middle-click detection in the popup:

```javascript
li.addEventListener('auxclick', (e) => {
  if (e.button === 1) {  // middle click
    e.preventDefault()   // prevents autoscroll in popup
    onOpenInNewWindow(ws.id)
  }
})
```

For Ctrl+click (or Cmd+click on macOS), the standard `click` event with `e.ctrlKey || e.metaKey` check is correct — no change needed.

**Warning signs:**
- Middle-click on a workspace item has no effect (no event fires).
- Ctrl+click works but middle-click does not, despite seemingly identical event handler logic.
- Autoscroll cursor appears briefly when middle-clicking inside the popup.

**Phase to address:** Middle-click/Ctrl+click handling phase.

---

### Pitfall V1-8: Popup closes immediately on `switchWorkspace` completion — Ctrl+click must explicitly call `windows.create` before popup close

**What goes wrong:**
When `switchWorkspace` is called from the popup, it changes the tabs in the current window, and the popup automatically closes because the active tab changed. For Ctrl+click opening a workspace in a new window, the operation must not trigger a switch in the current window — it should open a new window. If the code reuses `onSwitch()` with a `ctrlKey` flag, the workspace switch still executes in the current window before (or instead of) creating a new window. The user's current workspace is disrupted.

**Why it happens:**
The popup action handler for "click workspace item" calls `onSwitch()`. Adding Ctrl+click detection after the fact requires inserting a branch before the switch call. Developers add the branch but forget that `sendMessage({ action: 'switchWorkspace' })` must not be called at all for Ctrl+click — it should call a new `openInNewWindow` action instead.

**How to avoid:**
In the `click` and `auxclick` handlers in `popup.js`, check modifier keys first and dispatch to completely separate handlers:

```javascript
li.addEventListener('click', (e) => {
  if (e.target.closest('.ws-actions')) return
  if (e.ctrlKey || e.metaKey) {
    onOpenInNewWindow(ws.id)  // never calls switchWorkspace
  } else if (isInUse) {
    onFocusWindow(owningWindowId)
  } else if (!isActive) {
    onSwitch(ws.id)
  }
})
```

The background `openInNewWindow` message handler calls `windows.create()` and `setWindowEntry()` but does NOT call `switchWorkspace()`.

**Warning signs:**
- Ctrl+clicking a workspace switches the current window's tabs first, then also opens the new window (two operations instead of one).
- Current window is left with a blank new tab or the wrong workspace after Ctrl+click.
- New window opens but the source window also changed workspaces.

**Phase to address:** Middle-click/Ctrl+click handling phase, alongside the new-window workspace opening implementation.

---

### Pitfall V1-9: Circular dependency between `state.js` and `workspaces.js` causes initialization-time `undefined` exports

**What goes wrong:**
`state.js` imports `saveCurrentWorkspace` from `workspaces.js` (for `throttledSave`). `workspaces.js` imports `getSessionState`, `setSessionState`, `getWindowMap`, and `setWindowEntry` from `state.js`. This is a circular ES module dependency. At module load time, JavaScript resolves the import graph. When module A imports module B and module B imports module A, one of the two modules receives the other's exports as `undefined` during its own initialization phase. The specific value that is `undefined` depends on the load order. In this case, if `state.js` is resolved first, `saveCurrentWorkspace` from `workspaces.js` is `undefined` at the point `throttledSave` is defined as a function body reference — this is a "delayed circular dependency" because `saveCurrentWorkspace` is only called at runtime (not at module initialization time). This means the bug is latent: it does not crash on load, but any code path that imports only `state.js` before `workspaces.js` has fully initialized could see `undefined`.

**Why it happens:**
The split from a single `background.js` into modules created natural coupling: state operations need workspace logic, and workspace logic needs session state. The circular dependency was accepted as latent because runtime behavior appeared correct. As more code is added (context menu handlers importing from both modules), the initialization order becomes more fragile.

**How to avoid:**
Extract the circular link. `throttledSave` in `state.js` calls `saveCurrentWorkspace` — this is the only reason `state.js` imports from `workspaces.js`. Break this by:

1. **Option A (preferred):** Move `throttledSave` out of `state.js` into a new `autosave.js` module. `autosave.js` imports from both `state.js` and `workspaces.js`. Neither `state.js` nor `workspaces.js` imports from `autosave.js`. The circle is broken.

2. **Option B:** Convert the `saveCurrentWorkspace` call in `throttledSave` to a dynamic import (`await import('./workspaces.js')`). This defers the import to runtime, after all modules have initialized.

Option A is cleaner and makes the dependency graph acyclic.

**Warning signs:**
- `throttledSave` throws `TypeError: saveCurrentWorkspace is not a function` in edge cases.
- Adding a new import in `index.js` that changes module evaluation order causes previously-passing behavior to break.
- During debugging, `saveCurrentWorkspace` shows as `undefined` in the `state.js` module scope when inspected at startup.

**Phase to address:** Tech debt resolution phase, as the first item before adding new features that would import from either module.

---

### Pitfall V1-10: `readFromLocal()` in `sync.js` does not call `validateWorkspaceData()` — corrupted local fallback data loads unvalidated

**What goes wrong:**
In `sync.js`, `getWorkspaces()` calls `readFromLocal()` as a fallback when sync fails or is disabled. `readFromLocal()` returns `result.workspaces` directly if it is an array, without calling `validateWorkspaceData()`. The sync path goes through `assembleFromSync()` which constructs workspace objects field-by-field and is implicitly safer (it only reads known keys). The local fallback reads the raw stored object. If the stored data has a workspace with a missing `tabs` field, a null `id`, or a non-array `tabs`, the rest of the extension (which assumes all workspaces have valid structure) will throw or misbehave.

This is a known gap: `validateWorkspaceData()` exists and is well-written, but is not called on the local path.

**Why it happens:**
The local fallback was added as a safety net after the sync path was built. The validation function was added during Phase 2 for the sync read path. The local path predates the validation function and was not updated when validation was added.

**How to avoid:**
Call `validateWorkspaceData()` inside `readFromLocal()`:

```javascript
async function readFromLocal() {
  const result = await browser.storage.local.get('workspaces')
  if (!Array.isArray(result.workspaces)) return []
  const validated = validateWorkspaceData({ workspaces: result.workspaces, activeWorkspaceId: null })
  return validated.workspaces
}
```

Alternatively, call `validateWorkspaceData()` at the `getWorkspaces()` return site to cover both paths.

**Warning signs:**
- Extension crashes or behaves unexpectedly after the sync quota fallback activates.
- `Cannot read properties of undefined (reading 'length')` errors in `switchWorkspace` or `reclaimWorkspaces` when `ws.tabs` is undefined.
- Users in the fallback state (sync failed) see worse behavior than sync-enabled users.

**Phase to address:** Tech debt resolution phase, alongside the circular dependency fix. These two items should be addressed together as low-risk, high-value fixes before any new features land.

---

## Critical Pitfalls (v1.0 — retained)

### Pitfall 1: Global in-memory state silently resets in MV3 non-persistent background

**What goes wrong:**
After migrating to MV3, the background script becomes non-persistent (an "event page"). It is loaded on demand and unloaded after a few seconds of inactivity. Any in-memory variable — `isSwitching`, `saveTimeout`, the active window ID — is wiped on unload. When the next tab event fires and reloads the background, all those variables start from their initial values. This means a switch in progress when the background unloads will leave `isSwitching` stuck at `false` on reload, allowing a concurrent save to corrupt the partial switch state.

**Why it happens:**
MV2 persistent background pages never unload, so global variables work fine. Developers port the code 1:1 to MV3 and assume the same lifetime. Firefox does not warn when a variable is reset — the extension continues to run silently with corrupted state.

**How to avoid:**
- Move all cross-event state to `browser.storage.session` (cleared on browser shutdown, 10 MB limit, synchronous-feeling API). This is the correct MV3 replacement for in-memory state.
- The `isSwitching` flag and `saveTimeout` replacement must be stored in `storage.session` or a per-message lock pattern, not module-scope variables.
- Replace `setTimeout` / `clearTimeout` with `browser.alarms` API. Alarms survive background unloading; `setTimeout` does not.
- Register all event listeners at the top level synchronously so they survive script reload.

**Warning signs:**
- Tab saves fire during an active workspace switch (indicates `isSwitching` was reset mid-operation).
- Workspace switch partially completes, leaving old and new tabs mixed.
- Any state visible via `getBackgroundPage()` returns stale or default values after a period of inactivity.

**Phase to address:** MV3 migration phase, before storage.sync or multi-window work. All state-holding variables must be audited before any other changes are made on top of MV3.

---

### Pitfall 2: storage.sync QUOTA_BYTES_PER_ITEM (8,192 bytes) breaks tab-rich workspaces

**What goes wrong:**
The current extension stores all workspaces as a single `workspaces` array key under `storage.local`. Migrating to `storage.sync` naively (replacing `.local` with `.sync`) will immediately hit the per-item limit of 8,192 bytes for any workspace with more than ~20-30 tabs (each tab serializes to roughly 200-400 bytes depending on URL and title length). The `storage.sync.set()` call fails with a quota error. The extension silently stops saving that workspace's state.

**Why it happens:**
Developers check the 102,400-byte total quota (generous) without noticing the 8,192-byte _per-item_ limit. Storing all workspaces as one key violates per-item limits with realistic usage.

**How to avoid:**
- Store each workspace as a separate key (`workspace:{id}`) instead of one `workspaces` array. This distributes data across items.
- Keep a lightweight index key (`workspace:index`) with just IDs, names, colors, and createdAt — not tabs.
- Enforce a tab URL + title truncation (e.g., 200 bytes per tab) before storage to create a hard ceiling per workspace.
- Call `storage.sync.getBytesInUse()` on startup and log a warning if usage exceeds 70% of the 102,400-byte total.
- Keep `storage.local` as a confirmed-write fallback when `storage.sync.set()` rejects.

**Warning signs:**
- `storage.sync.set()` throws `QuotaExceededError` for any workspace.
- Workspace state is not restored after reinstall despite "sync" being active.
- Workspaces with more than 25 tabs silently stop persisting tab changes.

**Phase to address:** storage.sync migration phase. The data model must change before migrating — do not attempt a 1:1 storage area swap.

---

### Pitfall 3: `browser_specific_settings` with explicit gecko ID omitted — storage.sync silently fails to sync

**What goes wrong:**
`browser.storage.sync` in Firefox relies on the extension's Add-on ID to key sync data. If `browser_specific_settings.gecko.id` is not set in `manifest.json`, the extension has an auto-generated ephemeral ID. Data "syncs" locally into `storage-sync2.sqlite` but is never associated with a stable identity across devices or reinstalls — defeating the entire purpose of `storage.sync`.

**Why it happens:**
The extension currently has no `browser_specific_settings` key (common for extensions not yet published to AMO). Developers assume sync "just works" after switching from `.local` to `.sync`.

**How to avoid:**
- Add `browser_specific_settings.gecko.id` to `manifest.json` with a stable, unique identifier (e.g., `simple-workspaces@yourname.example`) before writing any production data to `storage.sync`.
- Set this before migration — data written without a stable ID cannot be retroactively attributed to that ID.

**Warning signs:**
- Workspace data does not appear on a second Firefox instance logged into the same account.
- After reinstall, workspaces are not restored despite sync being enabled.
- `browser.storage.sync.getBytesInUse()` returns 0 on a fresh profile despite data having been written.

**Phase to address:** storage.sync migration phase, as the very first step before any storage write logic changes.

---

### Pitfall 4: `tabs.query({ currentWindow: true })` uses the last-focused window, not the workspace's window

**What goes wrong:**
The current code uses `{ currentWindow: true }` throughout to identify which tabs belong to the active workspace. In a single-window world this works. With multi-window support, "current window" in a background script resolves to the last window the user focused — not necessarily the window whose workspace is being operated on. If the user briefly focuses a second window and then an auto-save debounce fires, the save captures tabs from the wrong window and overwrites the correct workspace's tab list.

**Why it happens:**
`currentWindow: true` is documented as the window that was last focused. In popup scripts it refers to the window containing the popup. In background scripts it refers to the last-focused window, which changes with every `windows.onFocusChanged` event. Without per-window workspace tracking, there is no way to know which window a save should target.

**How to avoid:**
- Add a `windowWorkspaces` map in `storage.session`: `{ [windowId]: workspaceId }`.
- All tab event listeners must capture the tab's `windowId` and resolve the correct workspace from the map.
- Replace all `tabs.query({ currentWindow: true })` calls with `tabs.query({ windowId: specificWindowId })` where `specificWindowId` is the window the operation targets.
- Listen to `windows.onCreated`, `windows.onRemoved`, and `windows.onFocusChanged` to maintain the map.

**Warning signs:**
- Tabs from Window B appear in Workspace A's saved state.
- Switching workspace in one window also changes the visible tabs in another window.
- After focusing a different window and waiting 400ms, the previously-focused window's workspace tab list is overwritten.

**Phase to address:** Multi-window tracking phase. This is the architectural core of that feature and must be solved before the auto-save is changed.

---

### Pitfall 5: No rollback when tab creation partially fails during workspace switch

**What goes wrong:**
`switchWorkspace()` saves the current workspace's tabs first, then creates new tabs, then removes old tabs. If tab creation fails for several tabs (e.g., browser tab limit, invalid URLs, browser resource exhaustion), the current code still removes old tabs with `browser.tabs.remove(oldTabIds)`. The saved workspace data for the original workspace is already written and the new tabs are partially created — the user ends up in an inconsistent state with no recovery path.

**Why it happens:**
The current approach optimistically proceeds and treats partial failures as acceptable. The try/catch wraps individual tab creation but not the full atomic operation. There is no rollback to the pre-switch state.

**How to avoid:**
- Capture a snapshot of the current workspace's tab list _before_ any mutation (already done partially, but must be committed to storage only after confirming success).
- Do not overwrite the current workspace's persisted tabs until new tabs are confirmed created.
- If fewer than all tabs are created, close any partially-created tabs and restore the original window state.
- Report failure to the popup via the `{ success: false, error }` return value and let the popup show a user-visible error.
- Consider implementing a staged commit: `pendingSwitch` stored in `storage.session`, committed to `storage.local/sync` only after tab creation completes.

**Warning signs:**
- After a failed switch, `browser.storage.local.get('workspaces')` shows the target workspace as active but the window has mixed tabs from both workspaces.
- Users report "workspace disappeared" after a switch that was interrupted.
- `console.error('[Workspaces] Tab create failed entirely')` appears but the extension continues switching anyway.

**Phase to address:** Race condition / data loss fix phase, before any other storage or multi-window changes. This is the most acute data loss risk in the current codebase.

---

### Pitfall 6: `windows.onFocusChanged` fires WINDOW_ID_NONE spuriously on Windows/Linux before every window switch

**What goes wrong:**
On Windows and many Linux window managers, `windows.onFocusChanged` always fires `WINDOW_ID_NONE` immediately before firing the new window's ID when the user switches between two browser windows. If the multi-window tracking code treats `WINDOW_ID_NONE` as "no window active" and triggers an auto-save at that moment, it saves against whatever window was previously tracked — which is the correct window, but with stale state captured at the wrong moment. More critically, if a debounced save is in progress and the `WINDOW_ID_NONE` event cancels or redirects the save, the workspace's tabs are written incorrectly.

**Why it happens:**
This is a platform-specific quirk documented in MDN but easy to miss. Developers test on macOS where the spurious `WINDOW_ID_NONE` does not occur, then the extension misbehaves on Windows.

**How to avoid:**
- Treat `WINDOW_ID_NONE` as transient. Never trigger a save or state change when the new window ID is `WINDOW_ID_NONE`.
- Buffer focus changes: wait for a non-`WINDOW_ID_NONE` window ID before updating `windowWorkspaces`.
- The focus-change handler should only update the "last focused window" pointer, not immediately trigger saves.

**Warning signs:**
- On Windows, workspaces get scrambled after rapid window switching.
- Auto-save fires twice in quick succession during a window focus change.
- The extension works correctly on macOS/Linux GNOME but fails on Windows.

**Phase to address:** Multi-window tracking phase, as part of implementing the `windows.onFocusChanged` listener.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store all workspaces as single `workspaces` array key in storage.sync | Minimal refactor from storage.local migration | Hits QUOTA_BYTES_PER_ITEM (8,192 bytes) with 20+ tabs; set() silently fails | Never — data model must change for storage.sync |
| Keep `isSwitching` as a module-scope variable after MV3 migration | No change required | Variable resets when background unloads, causing concurrent save/switch corruption | Never — must move to storage.session |
| Omit `browser_specific_settings.gecko.id` from manifest | Simplifies manifest | storage.sync data is anonymous and does not sync across devices or reinstalls | Never — must be set before any storage.sync use |
| Use `currentWindow: true` for all tab queries in multi-window code | Simple, matches current single-window code | Resolves to wrong window when user has multiple windows open | Never — replace with explicit windowId targeting |
| Replace `browserAction` with `action` only in API calls, not in manifest | Fewer changes | MV3 extension fails manifest validation — `browser_action` key is rejected in MV3 | Never — both manifest key and API must be updated together |
| Skip rollback logic on partial tab creation failure | Simpler switch implementation | User loses workspace tab list permanently on browser resource exhaustion | Never for primary path; acceptable to log and surface error only at extreme edge cases |
| Create menus.create() at top level of event page (not in onInstalled) | Familiar pattern from listener registration | Duplicate menu entries accumulate on every background reload | Never for MV3 event pages — always wrap in onInstalled |
| Skip `validateWorkspaceData()` on local fallback path | Less code, was "safe enough" for initial implementation | Corrupted local data loads unchecked, causes downstream crashes | Never — validate on all storage read paths |
| Leave circular import between state.js and workspaces.js | No refactor required | Latent undefined exports on initialization order change; new imports make the circle more fragile | Never — break the circle before adding new modules |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `browser.storage.sync` | Write all workspace data under one `workspaces` key | Write each workspace as `workspace:{id}` key; keep separate index key |
| `browser.storage.sync` | Assume sync is active without checking Firefox Sync is enabled and "Add-ons" sync is selected | Document that sync requires Firefox account + Add-ons sync enabled; fall back to storage.local silently when sync fails |
| `browser.alarms` | Use `setTimeout` for debounce in MV3 | Use `browser.alarms.create()` with a name; `alarms.onAlarm` fires even after background reload |
| `browser.action` (MV3) | Call `browser.browserAction.setBadgeText()` — silently undefined | Update both manifest key (`action`) and all API calls (`browser.action.setBadgeText`) together |
| `tabs.query` | Pass `{ currentWindow: true }` from background in multi-window context | Pass explicit `{ windowId: targetWindowId }` captured from the originating event |
| `windows.onFocusChanged` | Treat WINDOW_ID_NONE as a valid "no window" state and update tracking state | Ignore WINDOW_ID_NONE; only update tracking state on real window IDs |
| `storage.session` | Use as MV3 state store without checking Firefox version support | `browser.storage.session` is available in Firefox 102+; add version check or use storage.local with cleanup for earlier versions |
| `browser.menus` | Call menus API without declaring `"menus"` permission in manifest | Add `"menus"` to permissions array; verify with `web-ext lint` |
| `browser.menus.onClicked` | Register `onClicked` inside `runtime.onInstalled` — it will not survive background reloads | Register `menus.onClicked` at top level; register `menus.create` inside `onInstalled` |
| `menus.onShown` | Call `menus.refresh()` after async operation without checking if menu is still open | Use menu instance ID guard pattern; track `lastMenuInstanceId` and compare before calling `refresh()` |
| `browser.windows.create` | Create window then `await` other operations before calling `setWindowEntry` | Call `setWindowEntry` immediately after `windows.create` resolves, with no intervening awaits |
| Popup `click` event | Listen for `click` with `e.button === 1` to detect middle click | Use `auxclick` event for non-primary button detection; `click` only fires for the primary button |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Storing full tab objects (with favIconUrl data URLs) in storage.sync | storage.sync quota consumed rapidly; favicons are often 2-5 KB base64 data URLs | Strip favIconUrl before storage.sync write, or store only the URL for later re-fetch | At 5+ workspaces with favicon-heavy tabs |
| Full workspace list DOM re-render on every popup open | Popup open feels sluggish at 15+ workspaces | Already noted in codebase concerns; use DOM diffing or DocumentFragment batching | At 20+ workspaces |
| `tabs.query` on every debounced save without windowId scoping | Background processes tabs from all windows when only one window changed | Always pass `windowId` filter to tabs.query in save handlers once multi-window is active | As soon as user opens a second window |
| Calling `storage.sync.getBytesInUse()` on every save | Unnecessary async overhead on every tab change | Call `getBytesInUse()` only on startup and on storage.sync write errors | At high tab event frequency (rapid URL loading) |
| Fetching full workspace list from storage on every `menus.onShown` | Context menu takes 200-400ms to update names (noticeable lag) | Cache workspace list in `storage.session`; update cache on every `saveWorkspaces` call; read from cache synchronously in `onShown` | Immediately visible on first use |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Using `innerHTML` for SVG icons in popup buttons (lines 64, 69 of popup.js) | XSS if any stored workspace data reaches template rendering; violates Mozilla content security policy | Replace with `document.createElementNS('http://www.w3.org/2000/svg', 'svg')` construction or use `textContent` where SVG is not needed |
| No sender validation in `onMessage` handler | Any content script or injected code could call `switchWorkspace` or `deleteWorkspace` | Check `sender.id === browser.runtime.id` before processing messages; whitelist valid action names |
| Setting CSS custom property `--ws-color` directly from stored `ws.color` without validation | CSS injection if color value is manipulated in storage | Validate `color` field against `/^#[0-9a-f]{6}$/i` before any CSS or storage use |
| Storing `activeWorkspaceId` and `workspaces` as unsanitized objects read from storage.sync | If sync data is tampered (unlikely but possible on shared devices), malformed data crashes background | Add a validation function called on all storage reads: check required fields (`id`, `name`, `color`, `tabs` array), reject and reset to default on failure |
| Building context menu item title from raw workspace name without length/character check | Very long workspace names or names with special characters could cause display issues or overflow | Truncate workspace names used in menu item titles (e.g., max 50 chars); menu titles use plain text so XSS is not a risk here |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent failure when workspace switch fails mid-operation | User sees mixed tab state with no explanation; appears as a browser glitch | Return `{ success: false, error }` from `switchWorkspace`; popup should display an error toast before closing |
| No indication that storage.sync is not syncing (e.g., user not logged in to Firefox account) | User expects cross-device sync, does not get it, loses trust | Show sync status in popup footer: "Synced" / "Sync unavailable — check Firefox account" |
| Popup shows workspace count without window context in multi-window mode | User opens popup in Window B and sees all workspaces including those assigned to Window A; switching is confusing | Show per-window workspace assignment; dim or separate workspaces owned by other windows |
| Badge text breaks on emoji workspace names (first char of emoji is garbage) | Badge shows empty or garbled character | Use `[...name][0]` (spread to grapheme array) or a grapheme cluster library for badge initial |
| Workspace switch leaves the window in the wrong state if tab creation fails and is silently ignored | User is left with a partially restored workspace with no way to trigger a retry | Show error state in badge (e.g., "!" badge color) and expose a "retry switch" action |
| Context menu "Move to Workspace" shown when the tab is already in the active workspace | User sees their own workspace in the move list and clicks it, nothing happens | Filter the active workspace out of the "Move to" submenu; or show it dimmed/disabled |
| "Open in New Window" for a workspace that is already open in another window | Spawns a duplicate window; two windows now claim the same workspace | Check `windowMap` before creating; if workspace is active elsewhere, offer to focus that window instead |
| Popup closes immediately after middle-click (because `auxclick` bubbles and triggers click handler) | Middle-click to open in new window also closes popup unexpectedly | Call `e.preventDefault()` and `e.stopPropagation()` in `auxclick` handler to prevent click-through |

---

## "Looks Done But Isn't" Checklist

- [ ] **MV3 migration:** `browser_action` renamed to `action` in manifest AND all `browser.browserAction.*` API calls updated to `browser.action.*` — verify both; only changing the manifest or only the API is a common partial migration.
- [ ] **MV3 migration:** `"persistent": true` removed from background declaration — verify the background does not re-add persistence; non-persistence must be intentional.
- [ ] **storage.sync:** `browser_specific_settings.gecko.id` set in manifest — verify data actually syncs to a second device/profile before declaring migration complete.
- [ ] **storage.sync:** Per-item quota respected — verify workspaces with 30+ tabs do not trigger `QuotaExceededError` silently; test by creating a workspace with 40 tabs.
- [ ] **Multi-window:** `tabs.query({ currentWindow: true })` replaced everywhere with explicit `windowId` — search codebase for `currentWindow: true` after implementation and confirm zero remaining usages in background.js.
- [ ] **Multi-window:** `windows.onFocusChanged` handler ignores `WINDOW_ID_NONE` — unit test the handler with `WINDOW_ID_NONE` input and confirm no state mutation occurs.
- [ ] **Race condition fix:** Workspace tabs are not written to storage until new tab creation succeeds — verify by simulating a tab creation failure and checking storage state before and after.
- [ ] **Security:** No `innerHTML` usage in popup — run `grep -r innerHTML src/` and confirm zero results after fix.
- [ ] **storage.session availability:** Code using `browser.storage.session` is guarded for Firefox 102+ — verify the extension does not crash on older Firefox versions if that is a supported target.
- [ ] **Context menu:** `"menus"` permission present in manifest.json — verify with `web-ext lint` before testing context menu functionality.
- [ ] **Context menu:** `menus.create()` is inside `runtime.onInstalled` — verify menu items are not duplicated after leaving the extension idle for >30 seconds and right-clicking again.
- [ ] **Context menu:** `menus.onShown` uses menu instance ID guard — verify that rapidly opening and dismissing the context menu does not cause errors or stale names.
- [ ] **Context menu:** Active workspace is excluded from "Move to Workspace" list — verify the current workspace does not appear as a move target.
- [ ] **New window:** `setWindowEntry` called immediately after `windows.create` resolves — verify badge shows correct workspace initial immediately, not `?`.
- [ ] **New window:** Opening workspace in new window does not switch current window — verify the current window's workspace is unchanged after Ctrl+click.
- [ ] **Middle-click:** `auxclick` used (not `click`) for middle-click detection — verify middle-click works and `click` handler is not triggered for it.
- [ ] **Circular dependency:** `state.js` does not import from `workspaces.js` after refactor — verify import graph is acyclic by reading module headers.
- [ ] **Storage validation:** `validateWorkspaceData()` called on local fallback path — verify by manually corrupting a `workspaces` entry in `storage.local` and confirming graceful recovery.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Non-persistent state reset causes stuck `isSwitching` flag | LOW | On next user action, the flag is `false` (default), unblocking saves; the cost is a possibly corrupted workspace that the user will overwrite naturally |
| storage.sync quota exceeded — new writes blocked | MEDIUM | Implement a "storage cleanup" function: delete workspaces not accessed in 30+ days; strip favIconUrl from all tabs; rebuild index; manual recovery possible via about:debugging |
| Partial tab creation leaves mixed workspace state | HIGH | Without rollback: user must manually close stray tabs. With rollback: re-close any created tabs and restore from pre-switch snapshot. Implement the pre-switch snapshot before shipping multi-tab workspaces. |
| storage.sync data lost due to server-wins overwrite across devices | HIGH | No automatic recovery without explicit conflict detection; mitigate by surfacing `storage.onChanged` events and prompting user when a remote change overwrites local state |
| Extension ID not set before first storage.sync write | HIGH | All sync data written under ephemeral ID is orphaned. Recovery requires the user to recreate workspaces on each device. Set the ID in the first commit that touches storage.sync — it cannot be fixed retroactively. |
| Duplicate context menu entries from top-level menus.create in event page | LOW | Browser restart clears all extension menus. Fix the code to use `onInstalled`. Users affected must restart their browser once. |
| Unvalidated local fallback data causes crash | MEDIUM | Add validation to `readFromLocal()`; provide a `storage.local.set({ workspaces: [] })` emergency reset path accessible via browser console at `about:debugging`. |
| Circular dependency causes `saveCurrentWorkspace` to be `undefined` at runtime | MEDIUM | Immediate fix: move `throttledSave` to a new module. Temporary workaround: convert call to dynamic import. No user-visible recovery path exists for data already lost from skipped saves. |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Non-persistent state reset (`isSwitching`, `saveTimeout`) | MV3 migration phase | After migration, trigger a workspace switch, wait 5+ seconds for background to unload, trigger another event, verify no state corruption |
| `browser_action` → `action` (manifest + API) | MV3 migration phase | Validate manifest with `web-ext lint`; confirm badge updates work after migration |
| `browser_specific_settings.gecko.id` missing | storage.sync migration phase (first step) | Verify sync works between two Firefox profiles using the same account |
| QUOTA_BYTES_PER_ITEM exceeded by large workspaces | storage.sync migration phase | Test with a workspace containing 40 tabs; confirm no QuotaExceededError; check `getBytesInUse()` |
| Server-wins overwrite on multi-device sync | storage.sync migration phase | Test with two devices: modify a workspace on each before sync; verify the expected winner wins and no silent data loss |
| `currentWindow: true` resolves to wrong window | Multi-window tracking phase | Open two windows with different workspaces; switch focus to Window B; wait for debounce; confirm Window A's workspace was not overwritten |
| WINDOW_ID_NONE spurious events on focus change | Multi-window tracking phase | Test on Windows; switch windows rapidly 10 times; confirm workspace assignments are stable |
| No rollback on partial tab creation failure | Race condition fix phase | Mock `browser.tabs.create` to fail on the 3rd tab; confirm storage state is unchanged and old tabs are not removed |
| `innerHTML` in popup SVG buttons | Security fixes phase | `web-ext lint` + grep; confirm no innerHTML usages post-fix |
| No message sender validation | Security fixes phase | Attempt to call `switchWorkspace` from a content script; confirm it is rejected |
| Circular dependency `state.js` ↔ `workspaces.js` | Tech debt resolution phase (v1.1, first) | Read import headers after refactor; verify no circular import; confirm `throttledSave` still works after 30s idle background reload |
| `validateWorkspaceData` missing on local fallback path | Tech debt resolution phase (v1.1, first) | Corrupt a `workspaces` entry in storage.local; confirm extension recovers gracefully instead of crashing |
| `"menus"` permission missing from manifest | Context menu phase (v1.1, first step) | `web-ext lint` passes; `browser.menus` is defined in background console |
| `menus.create()` at top level duplicates on background reload | Context menu phase (v1.1) | Leave extension idle >30s; right-click a tab; confirm no duplicate submenu entries |
| Async `menus.onShown` race with menu close | Context menu phase (v1.1) | Rapidly open/dismiss context menu 10 times; confirm no errors and names are current |
| `menus.onClicked` uses `tabs.query` instead of provided `tab` | Context menu phase (v1.1) | Right-click a background tab; confirm that tab is moved, not the active tab |
| `windows.create` then delayed `setWindowEntry` allows competing assignment | New-window phase (v1.1) | Open workspace in new window; confirm badge is correct immediately and no reclaimWorkspaces collision |
| `click` event used for middle-click detection | Middle-click/Ctrl+click phase (v1.1) | Middle-click workspace item; confirm `auxclick` fires and new window opens |
| Ctrl+click calls `switchWorkspace` on current window | Middle-click/Ctrl+click phase (v1.1) | Ctrl+click a workspace; confirm current window workspace unchanged; new window opens with correct workspace |

---

## Sources

- [menus — MDN (permissions, create, onClicked, onShown, ContextType)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus) — HIGH confidence
- [menus.create() — MDN (event page initialization pattern)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/create) — HIGH confidence
- [menus.onShown — MDN (async race guard pattern)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/onShown) — HIGH confidence
- [menus.ContextType — MDN (tab context details)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/ContextType) — HIGH confidence
- [menus.OnClickData — MDN (tab parameter behavior)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/OnClickData) — HIGH confidence
- [windows.create() — MDN (tabId move vs URL create, incognito limits)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/create) — HIGH confidence
- [windows.onCreated — MDN (event timing)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/onCreated) — HIGH confidence
- [Element: auxclick event — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/auxclick_event) — HIGH confidence
- [permissions — MDN (menus permission requirement)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/permissions) — HIGH confidence
- [browser.menus is undefined — webextension-polyfill issue #74](https://github.com/mozilla/webextension-polyfill/issues/74) — MEDIUM confidence (confirms missing permission causes undefined)
- [ES6 circular dependency behavior — railsware.com](https://railsware.com/blog/how-to-analyze-circular-dependencies-in-es6/) — MEDIUM confidence (community article, aligns with spec)
- [Manifest V3 migration guide — Firefox Extension Workshop](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/) — HIGH confidence
- [background — MDN (non-persistent event pages)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background) — HIGH confidence
- [Background scripts — MDN (MV3 state management patterns)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts) — HIGH confidence
- [storage.sync — MDN (quota limits, browser_specific_settings requirement)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync) — HIGH confidence
- [windows.onFocusChanged — MDN (WINDOW_ID_NONE platform caveat)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/onFocusChanged) — HIGH confidence
- [tabs.query() — MDN (currentWindow behavior)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/query) — HIGH confidence
- [Codebase concerns audit — .planning/codebase/](../.planning/codebase/) — HIGH confidence (direct code analysis of this codebase)

---

*Pitfalls research for: Firefox WebExtension workspace/tab management — MV3 migration, storage.sync, multi-window, tab atomicity, context menu, new-window, circular dependencies, storage validation*
*Researched: 2026-03-21 (v1.0); updated 2026-03-23 (v1.1)*
