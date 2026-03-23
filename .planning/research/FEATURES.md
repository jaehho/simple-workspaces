# Feature Research

**Domain:** Firefox WebExtension — context menu tab movement, new-window workspace launching, modifier-click UX
**Researched:** 2026-03-23
**Confidence:** HIGH (core API behavior verified against MDN docs and official Firefox WebExtension API; UX patterns verified against competitor extensions)

---

## Scope

This document covers **new features for v1.1** only. Existing features (workspace CRUD, per-window tracking, sync storage) are documented in the prior research cycle and already shipped. The three new feature areas are:

1. Context menu "Move to {workspace}" for selected tabs
2. New-window workspace opening (replacing "Assign Here" for unassigned windows)
3. Middle-click / Ctrl+click popup workspace item to open in new window

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist given how comparable extensions behave. Missing these makes the extension feel unfinished relative to competitors.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Right-click a tab → "Move to [workspace]" submenu | Tab Manager Plus, FoxyTab, Simple Tab Groups, and Tabby all have this. Users who research workspace extensions will look for it. | MEDIUM | Requires `menus` permission, `contexts: ["tab"]`, dynamic submenu per workspace. `menus.onShown` + `menus.refresh()` is the correct async pattern (HIGH confidence — MDN verified). |
| Move multiple selected tabs at once | Firefox supports multi-select (Ctrl+click tabs, highlighted: true). Power users expect bulk operations to respect selection. | MEDIUM | `tabs.query({ highlighted: true, windowId })` returns all selected tabs. The `menus.onClicked` `tab` parameter gives the right-clicked tab, but highlighted tabs may be different. Query `highlighted: true` from the clicked tab's window. |
| Skip self when building "Move to" list | "Move to [current workspace]" is meaningless and confusing | LOW | Filter `ws.id !== activeWorkspaceId` when building the submenu. Already know `activeWorkspaceId` from `windowMap`. |
| New-window option in "Move to" submenu | Users expect an escape hatch: "move these tabs to a new, fresh workspace" without committing to an existing one | MEDIUM | "Move to New Window" as a dedicated submenu item. Creates a new workspace + new window. |

### Differentiators (Competitive Advantage)

Features that go beyond what users find in most comparable extensions.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Middle-click / Ctrl+click popup item opens workspace in new window | Keyboard+mouse modifier shortcut for power users. Most extensions don't offer this; they require digging through menus to open a separate window. | LOW | Standard DOM `auxclick` event (button === 1 for middle-click) and `click` with `e.ctrlKey || e.metaKey` in the popup. `windows.create({ url: [...tabUrls] })` creates a new window with workspace tabs. Browser supports this natively since Firefox 63+. |
| Clicking workspace in unassigned window opens it in a new window (not "Assign Here") | "Assign Here" forces users to understand the "unassigned" concept. Opening in a new window is the obvious, intuitive action — it's what users actually want when they open a new browser window and see "No workspace assigned." | MEDIUM | Change the unassigned-window click handler to call a `openWorkspaceInNewWindow()` action instead of `assignWorkspace()`. The current window (unassigned) can then close or remain empty. Requires a new message action `openInNewWindow`. |
| Context menu shows workspace color indicator | Competitors show plain text in submenus. Color dots make workspaces immediately identifiable at a glance. | LOW | The `menus.create` title parameter accepts emoji or Unicode. A colored circle character (●) prepended to the name provides a simple visual differentiator without requiring custom rendering. Actual CSS color in context menus is not possible via WebExtension API. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Drag-and-drop tab to workspace in popup | "More natural" than right-click | No stable DnD API for WebExtension popups. The popup DOM is isolated; cannot receive tab drops from the browser chrome. High implementation cost with no supported API path. | Right-click context menu on the tab strip is the correct and fully supported approach. |
| "Move to" menu that reflects real-time tab changes as they happen | Some users want the menu to rebuild instantly as tabs open/close | The `menus.onShown` event fires asynchronously. Rebuilding the workspace list in the handler introduces a race: the menu can display before `menus.refresh()` is called, showing stale data. (MEDIUM confidence — Mozilla Discourse thread on dynamic context menus confirms this is a known timing issue.) | Rebuild the menu whenever workspace data changes (on `runtime.onInstalled`, on workspace CRUD operations). At `onShown` time, only perform lightweight visibility toggling. This keeps the menu fast and correct. |
| "Move to" applies only to the right-clicked tab (ignoring multi-select) | Simpler to implement | Users who select multiple tabs via Ctrl+click expect operations to apply to all of them. Ignoring the selection is surprising behavior that breaks expected browser conventions. | Query `highlighted: true` for the window, include the right-clicked tab if it is not in the highlighted set (user may have right-clicked without selecting). |
| Auto-close the source window after moving all tabs out | "Feels clean" | The user may have opened the window intentionally. Auto-closing something the user opened is aggressive and unexpected. Window management decisions should belong to the user. | Leave the window open. The background will show an "unassigned" state if all tabs were moved out and no other workspace owns it. |
| "Open in new window" that copies the workspace (duplicate) | Quick way to start a parallel session | Duplicating a workspace creates a naming collision and a storage ambiguity: which copy do you keep? Storage sync will conflict immediately. | Open in new window means: create a NEW window and switch it to the chosen workspace (exclusive ownership applies — the source window becomes unassigned). No duplication. |

---

## Feature Dependencies

```
[Context menu "Move to {workspace}"]
    └──requires──> [menus permission in manifest]
    └──requires──> [menus.create with contexts: ["tab"]]
    └──requires──> [Dynamic submenu per workspace in background index.js]
    └──requires──> [New message action: moveTabsToWorkspace]
                       └──requires──> [tabs.query highlighted:true for multi-select]
                       └──requires──> [tabs.move() to move physical tab to target window]
                       └──requires──> [Existing switchWorkspace() logic for target window]
    └──enhances──> [Per-window workspace tracking (already built)]

[Open workspace in new window]
    └──requires──> [New message action: openInNewWindow(workspaceId)]
    └──requires──> [browser.windows.create({ url: [...tabUrls] })]
                       └──requires──> [about:newtab handling — omit url param, not pass "about:newtab"]
    └──requires──> [setWindowEntry() for new window → workspaceId]
    └──requires──> [Exclusive ownership check (already exists in switchWorkspace)]

[Middle-click / Ctrl+click popup item]
    └──requires──> [Open workspace in new window (shared action)]
    └──requires──> [auxclick event handler (button === 1) in popup.js]
    └──requires──> [click event handler checking e.ctrlKey || e.metaKey in popup.js]
    └──conflicts──> [Normal click (switch in same window)] — must differentiate at event handler level

[Unassigned window → click opens in new window]
    └──requires──> [Open workspace in new window (shared action)]
    └──replaces──> [Assign Here button / onAssign() handler]
    └──enhances──> [Unassigned window UX (already built)]
```

### Dependency Notes

- **Context menu tab movement depends on "Move tabs" concept, not workspace "switch":** Moving tabs from window A into workspace B (which lives in window B) is physically moving the tab DOM nodes between windows via `tabs.move()`. This is different from `switchWorkspace()`, which replaces all tabs in one window. The implementation path is: find the window where workspace B is active, use `tabs.move(tabIds, { windowId: targetWindowId, index: -1 })`, then save the updated workspace.

- **"Open in new window" is shared by three features:** The same `openInNewWindow(workspaceId)` action backs (1) the unassigned window click, (2) middle-click, and (3) Ctrl+click. Implement the action once in `workspaces.js`, expose via messaging, call from popup in three places.

- **Multi-select tab movement requires careful window scoping:** `tabs.query({ highlighted: true })` returns tabs from ALL windows unless `windowId` is specified. Always pass the source window's ID when querying for selected tabs. The clicked tab's `tab.windowId` from `menus.onClicked` provides the source window.

- **Dynamic menus must handle workspace changes:** When workspaces are added, renamed, or deleted, the context menu submenu must be rebuilt. Hook menu rebuilding to the workspace write path (after `saveWorkspaces()`), not to `menus.onShown`. This avoids async race conditions.

- **about:newtab in windows.create:** If a workspace has a tab stored as `about:newtab`, do NOT pass it in the `url` array to `windows.create()`. Instead: create the window without the newtab URL (it opens a blank new tab by default), then handle remaining tabs with `tabs.create()`. Or filter out `about:newtab` entries before constructing the URL array and let the window default handle it.

---

## MVP Definition (This Milestone)

These are the active requirements from PROJECT.md for v1.1. All three feature areas must ship together.

### Tech Debt (Fix First — Non-blocking but risky to defer)

- [ ] Fix `validateWorkspaceData` not called on `readFromLocal()` fallback path — data corruption risk on every storage.sync failure
- [ ] Resolve circular dependency `state.js` ↔ `workspaces.js` — currently latent (no runtime error) but will cause bundler and test issues

### New Features (Ship Together)

- [ ] Context menu "Move to {workspace}" on right-clicked tab — must include multi-select support (highlighted tabs)
- [ ] Clicking workspace from unassigned window opens workspace in a new window (remove "Assign Here" button and `onAssign` handler)
- [ ] Middle-click or Ctrl+click any workspace in popup opens it in a new window

### Not in This Milestone

- [ ] Workspace search or address bar quick-switch — defer
- [ ] Keyboard shortcuts — out of scope per PROJECT.md
- [ ] Import/export — out of scope per PROJECT.md

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Fix validateWorkspaceData on local fallback | HIGH (silent data corruption risk) | LOW | P1 |
| Resolve circular dependency | MEDIUM (latent, not crashing) | LOW | P1 |
| Context menu "Move to {workspace}" | HIGH (expected by power users, asked for by workspace extension users) | MEDIUM | P1 |
| Open workspace in new window (unassigned UX) | HIGH (replaces confusing "Assign Here" with obvious behavior) | MEDIUM | P1 |
| Middle-click / Ctrl+click → new window | MEDIUM (power user shortcut) | LOW (reuses new-window action) | P2 |
| Color indicator in context menu (Unicode ●) | LOW (polish) | LOW | P3 |

---

## API Capabilities Summary (verified)

These are the Firefox WebExtension APIs that enable the new features. All are available in MV3 with the current manifest (Firefox 142+).

| API | Use | Confidence | Notes |
|-----|-----|------------|-------|
| `browser.menus.create({ contexts: ["tab"] })` | Show menu on tab strip right-click | HIGH (MDN) | Available since Firefox 63. Requires `"menus"` permission in manifest. |
| `browser.menus.onShown` + `menus.refresh()` | Rebuild submenu dynamically | HIGH (MDN) | Fire on show, update items, call refresh(). Async race risk if rebuilding from storage — prefer proactive rebuild on workspace write. |
| `menus.onClicked` `tab` parameter | Get the right-clicked tab object (id, windowId) | HIGH (MDN) | Tab object is passed as second param to `onClicked` listener when context is "tab". |
| `tabs.query({ highlighted: true, windowId })` | Get all selected tabs in the source window | HIGH (MDN) | Returns all highlighted (multi-selected) tabs. Always scope to `windowId` from the clicked tab. |
| `tabs.move(tabIds, { windowId, index: -1 })` | Physically move tabs between windows | HIGH (MDN) | Works across windows. Returns moved Tab objects. Does NOT work on pinned tabs before unpinned. |
| `browser.windows.create({ url: [...] })` | Open a new browser window with specified URLs | HIGH (MDN) | URL can be array. Returns Window object with `tabs` always populated. Omit about:newtab from array — handle separately. |
| `browser.windows.create({ tabId })` | Move a single existing tab into a new window | HIGH (MDN) | Convenience form — moves the tab rather than creating a new one. |
| DOM `auxclick` event (`button === 1`) | Detect middle-click in popup | HIGH (MDN + bugzilla) | `auxclick` fires for non-primary button clicks (middle = 1). `preventDefault()` prevents autoscroll. Available in popup HTML as standard DOM event. |
| DOM `click` event `e.ctrlKey` / `e.metaKey` | Detect modifier-key click in popup | HIGH (standard DOM) | `ctrlKey` on Windows/Linux, `metaKey` on Mac. Both should be checked for cross-platform support. |

---

## Competitor Feature Analysis

| Feature | Simple Tab Groups | FoxyTab | Tab Manager Plus | Tabby | Simple Workspaces (this) |
|---------|-------------------|---------|------------------|-------|--------------------------|
| Right-click "Move to group/workspace" | Yes (full submenu) | Yes | Yes | Yes | Target for v1.1 |
| Multi-select tab move | Yes | Yes | Yes | Yes | Target for v1.1 |
| Open group in new window | Yes (click group icon triggers focus/open) | Partial | Yes | Yes | Target for v1.1 |
| Middle-click to close tab | Yes | — | — | — | Not in scope (close is destructive) |
| Middle-click to open in new window | Not documented | — | — | — | Target for v1.1 (differentiator) |
| Ctrl+click to open in new window | Not documented | — | — | — | Target for v1.1 (differentiator) |
| Color-coded workspace list | Partial (colored icons) | No | No | No | Already exists |
| Firefox Sync storage | Not mentioned | No | No | No | Already built (v1.0) |

---

## Sources

- [menus.ContextType — MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/ContextType)
- [menus.onShown — MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/onShown)
- [menus.onClicked — MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/onClicked)
- [tabs.query — MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs)
- [tabs.move — MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/move)
- [windows.create — MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/create)
- [tabs.highlight — MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/highlight)
- [auxclick event — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/auxclick_event)
- [Bug 1469148: Web Extension menus should be able to react to middle click — Bugzilla (VERIFIED FIXED, Firefox 64)](https://bugzilla.mozilla.org/show_bug.cgi?id=1469148)
- [WebExtensions dynamic context menu — Mozilla Discourse](https://discourse.mozilla.org/t/webextensions-dynamic-context-menu/18051)
- [Simple Tab Groups — AMO](https://addons.mozilla.org/en-US/firefox/addon/simple-tab-groups/)
- [FoxyTab — AMO](https://addons.mozilla.org/en-US/firefox/addon/foxytab/)
- [Tab Manager Plus for Firefox — AMO](https://addons.mozilla.org/en-US/firefox/addon/tab-manager-plus-for-firefox/)
- [Tabby - Window & Tab Manager — AMO](https://addons.mozilla.org/en-US/firefox/addon/tabby-window-tab-manager/)

---

*Feature research for: Firefox WebExtension tab/workspace management — v1.1 context menu and window management*
*Researched: 2026-03-23*
