# Project Research Summary

**Project:** Simple Workspaces — Firefox Extension v1.1
**Domain:** Firefox WebExtension — tab/workspace management
**Researched:** 2026-03-23
**Confidence:** HIGH

## Executive Summary

Simple Workspaces v1.1 is an incremental capability milestone on top of a solid v1.0 foundation. The v1.0 architecture — MV3 event page, ES module background split across `index.js`, `state.js`, `workspaces.js`, `messaging.js`, and `sync.js`, storage.sync with chunked schema, storage.session window map, atomic switching with rollback — is already built and verified. This milestone adds three user-facing features: a right-click "Move to Workspace" context menu for tab movement, new-window workspace opening (replacing the confusing "Assign Here" behavior), and middle-click/Ctrl+click modifiers in the popup to open any workspace in a new window. Before those features land, two pieces of tech debt must be resolved: the circular dependency between `state.js` and `workspaces.js`, and the missing `validateWorkspaceData` call on the `readFromLocal()` fallback path.

The recommended approach is to address tech debt first (Phase 1), then add context menu support (Phase 2), then complete new-window workspace opening including popup modifier keys (Phase 3). This sequencing is dictated by module coupling: both the context menu and new-window features touch `workspaces.js` and `state.js`, so resolving the circular dependency first removes fragility before new code is layered on top. All required APIs are built-in Firefox WebExtension APIs — no new npm dependencies, no build pipeline changes, only a `"menus"` permission addition to `manifest.json`.

The key implementation risks are: MV3 event page menu item duplication (must use `runtime.onInstalled` for static item registration, not top-level), async race in `menus.onShown` (use the instance ID guard pattern), and the `windows.create()` constraint that it only accepts URL strings — pinned state must be applied post-creation. The exclusive ownership invariant (one workspace, one window at a time) is already enforced by the existing `switchWorkspace` path and must be carried through the new `openWorkspaceInNewWindow` function.

---

## Key Findings

### Recommended Stack

No new npm packages are required. All three new capabilities rely exclusively on native Firefox WebExtension APIs. The only manifest change is adding `"menus"` to the `permissions` array alongside the existing `"tabs"` and `"storage"` entries.

**Core technologies (new surface area only):**
- `browser.menus` API (Firefox 55+, `"menus"` permission): Tab strip right-click context menu — the only WebExtension API path for this; `contexts: ["tab"]` is the correct context type
- `menus.onShown` + `menus.refresh()` (Firefox 60+): Lazy rebuild of workspace submenu — rebuilds only when menu is actually about to appear, avoiding wasteful rebuilds on every workspace write
- `browser.tabs.query({ highlighted: true, windowId })`: Correct API for getting all multi-selected tabs at context menu click time; the `tab` parameter in `menus.onClicked` gives only the right-clicked tab
- `browser.tabs.move(tabIds, { windowId, index: -1 })`: Cross-window tab movement; accepts an array of IDs
- `browser.windows.create({ url: [...] })`: New window from URL array; does NOT accept `about:newtab` URLs; pinned state must be applied after creation via `tabs.update()`
- Dependency injection via registered callback: Low-risk resolution of the `state.js` ↔ `workspaces.js` circular import — `registerSaveCallback()` in `state.js`, wired in `index.js`; or preferred: move `throttledSave` to `index.js` to eliminate the dependency entirely

### Expected Features

**Must have (table stakes for v1.1):**
- Right-click any tab in the tab strip → "Move to Workspace" submenu listing all workspaces except the currently active one — all comparable extensions (Simple Tab Groups, FoxyTab, Tab Manager Plus, Tabby) have this
- Multi-selected tab support in "Move to Workspace" — Firefox supports Ctrl+click tab multi-select; users expect bulk operations to respect the selection
- Click workspace in unassigned window → opens workspace in a new window, replacing the "Assign Here" button — the current "Assign Here" concept requires users to understand the unassigned-window mental model; opening in a new window is the obvious, intuitive action
- Fix `validateWorkspaceData` missing from `readFromLocal()` fallback path — silent data corruption risk on every storage.sync failure

**Should have (differentiators):**
- Middle-click workspace item in popup → open in new window — most comparable extensions do not offer this modifier shortcut
- Ctrl+click workspace item in popup → open in new window — same shortcut for keyboard-dominant users
- Color indicator (Unicode ● character) prepended to workspace names in context menu items — competitors show plain text; colored dots make workspaces identifiable at a glance (CSS color in context menus is not possible via WebExtension API)

**Defer (not in this milestone):**
- Workspace search or address bar quick-switch
- Keyboard shortcuts
- Import/export

### Architecture Approach

The v1.1 architecture extends the existing module graph minimally. One new module is added (`background/menus.js`), `throttledSave` migrates from `state.js` to `index.js` to eliminate the circular dependency, and `validateWorkspaceData` migrates from `workspaces.js` to `sync.js` so it applies to all storage read paths. All other modules change only at specific integration points.

**Major components (updated for v1.1):**
1. `index.js` — Top-level event listeners, lifecycle; gains `throttledSave` (moved from `state.js`); calls `initMenus()` from new `menus.js`
2. `state.js` — Pure session-storage CRUD (windowMap, sessionState); loses `throttledSave` and its dependency on `workspaces.js`; circular dependency eliminated
3. `workspaces.js` — Workspace CRUD, atomic switch, badge, tab serialization; gains `openWorkspaceInNewWindow()`; exports `serializeTabs`; loses `validateWorkspaceData` (moves to `sync.js`)
4. `sync.js` — Storage abstraction; gains `validateWorkspaceData` and `DEFAULT_WORKSPACE_DATA` (moved from `workspaces.js`); applies validation at both `readFromLocal()` and `assembleFromSync()` exit points
5. `messaging.js` — Popup message routing; adds `'openInNewWindow'` case
6. `menus.js` (NEW) — Context menu registration (`initMenus()`), dynamic `onShown` rebuild with instance ID guard, `moveTabToWorkspace()` business logic
7. `popup.js` — Removes "Assign Here" button and `onAssign()` handler; replaces unassigned-window click path with `openInNewWindow` dispatch; adds `auxclick` listener for middle-click and Ctrl+click modifier check in existing `click` handler

### Critical Pitfalls

1. **MV3 menu item duplication on background reload** — Calling `menus.create()` at the top level of the background script in a non-persistent event page causes duplicate menu entries to accumulate on every background reload. Register the static parent item inside `runtime.onInstalled` only; register `menus.onClicked` at the top level (it must survive reloads).

2. **Async race in `menus.onShown`** — Awaiting `getWorkspaces()` inside `onShown` then calling `menus.refresh()` can operate on a menu the user has already dismissed. Use the MDN-recommended instance ID guard: assign an incrementing ID at the start of each `onShown` invocation; check it is still the latest before calling `refresh()`.

3. **`windows.create()` URL-only constraint** — The API only accepts URL strings, not tab objects. `about:newtab` URLs are rejected and must be filtered before the call (omitting them lets Firefox default to a new tab). Pinned state cannot be set at creation time and must be applied post-creation via `browser.tabs.update()` for each pinned tab.

4. **Circular dependency `state.js` ↔ `workspaces.js`** — Currently latent (functions work at runtime due to hoisting), but fragile. Adding new imports that change module evaluation order can surface `undefined` errors. Resolve before adding any code that touches either module.

5. **Missing validation on `readFromLocal()` fallback** — `validateWorkspaceData()` is not called when the sync path fails and `storage.local` is used instead. Corrupted local data (missing `tabs` array, null `id`) reaches workspace logic unvalidated. Fix by moving `validateWorkspaceData` to `sync.js` and calling it at both read exit points.

6. **`auxclick` vs `click` for middle-click** — The standard `click` event does not fire for middle-button clicks in Firefox. Use `auxclick` with `e.button === 1`. Call `e.preventDefault()` to suppress the browser's autoscroll behavior inside the popup.

7. **Ctrl+click must not call `switchWorkspace`** — The click handler must branch before dispatching to `onSwitch()`. If `switchWorkspace` runs with Ctrl held, it replaces the current window's tabs before the new window opens. Check modifier keys first and dispatch to a completely separate `onOpenInNewWindow()` handler that never calls `switchWorkspace`.

---

## Implications for Roadmap

The implementation order is dictated by module coupling. All three new features touch `workspaces.js` and `state.js`. The circular dependency must be resolved and the validation gap must be closed before new code is layered onto those modules.

### Phase 1: Tech Debt — Module Integrity

**Rationale:** The circular `state.js` ↔ `workspaces.js` dependency is latent today but will become a real initialization-order bug as new imports are added in Phases 2 and 3. The missing `validateWorkspaceData` on `readFromLocal()` is a data corruption risk that affects all users who hit the sync fallback path. Both fixes are low-risk, high-value, and touch no user-visible behavior.
**Delivers:** A clean, acyclic module graph and consistent data validation on all storage read paths.
**Addresses:** Tech debt items from FEATURES.md (P1 priority); Pitfalls V1-9 and V1-10.
**Avoids:** Initialization-order `undefined` errors surfacing during Phase 2/3 development; silent data corruption on sync fallback.
**Implementation scope:** Move `throttledSave` (and its `THROTTLE_MS` constant) from `state.js` to `index.js`; move `validateWorkspaceData` and `DEFAULT_WORKSPACE_DATA` from `workspaces.js` to `sync.js`; call validation at `readFromLocal()` and `assembleFromSync()` exit points. Zero behavior change.

### Phase 2: Context Menu — "Move to Workspace"

**Rationale:** This is a standalone new module (`menus.js`) that integrates with the now-stable `state.js` and `workspaces.js`. It touches `manifest.json` (one line), `index.js` (one `initMenus()` call), and `workspaces.js` (export `serializeTabs`). It does not touch `popup.js`, limiting test surface. The context menu feature is the highest-value new capability for power users and closes the biggest competitive gap.
**Delivers:** Right-click "Move to Workspace" submenu in the Firefox tab strip, with multi-selected tab support.
**Addresses:** Context menu feature from FEATURES.md (P1); competitor parity with Simple Tab Groups, FoxyTab, Tab Manager Plus, and Tabby.
**Avoids:** Menu item duplication (Pitfall V1-2); async onShown race (Pitfall V1-3); wrong-tab targeting (Pitfall V1-4).
**Implementation scope:** New `src/background/menus.js`; add `"menus"` permission to `manifest.json`; call `initMenus()` from `index.js`; export `serializeTabs` from `workspaces.js`.

### Phase 3: New-Window Workspace Opening + Popup Modifier Keys

**Rationale:** This phase modifies the most files (workspaces.js, messaging.js, popup.js) and changes user-visible behavior in the popup. It is last because it has the largest test surface and depends on `workspaces.js` being stable (ensured by Phase 1). The unassigned-window click change and the middle-click/Ctrl+click additions share the same `openWorkspaceInNewWindow` action and should ship together.
**Delivers:** Opening any workspace in a new window from either the unassigned-window popup or a modifier-click; removal of the "Assign Here" button.
**Addresses:** New-window opening and middle/Ctrl+click features from FEATURES.md (P1 and P2); replaces confusing "Assign Here" UX with the obvious action.
**Avoids:** `windows.create()` URL-only and `about:newtab` constraints (Pitfalls V1-5 and V1-6); spurious throttled saves during window creation (Pitfall V1-5); Ctrl+click calling `switchWorkspace` (Pitfall V1-8); middle-click using `click` instead of `auxclick` (Pitfall V1-7).
**Implementation scope:** Add `openWorkspaceInNewWindow()` to `workspaces.js`; add `'openInNewWindow'` case to `messaging.js`; update `popup.js` to remove `onAssign()`, replace unassigned-window click path, add `auxclick` and Ctrl+click handlers.

### Phase Ordering Rationale

- Phase 1 before Phases 2 and 3: Both new features import from or modify `state.js` and `workspaces.js`. Resolving the circular dependency first means no new code is layered onto a fragile module boundary.
- Phase 2 before Phase 3: `menus.js` is a new file with minimal integration surface. Phase 3 modifies existing files with user-visible behavior. Isolating the new-file work first keeps the Phase 3 diff clean and reviewable.
- Phases 2 and 3 are independent of each other once Phase 1 is complete, and could be parallelized if multiple contributors are available.

### Research Flags

Phases with well-documented patterns (skip research-phase):
- **Phase 1 (tech debt):** Pure refactoring. Module migration patterns are well-understood; no API research needed.
- **Phase 2 (context menu):** All APIs verified against MDN. The `menus.onShown` instance ID guard and `runtime.onInstalled` registration patterns are fully specified.
- **Phase 3 (new window):** All APIs verified against MDN. The `windows.create()` URL-array pattern and pinned-state post-application are fully specified.

No phases require a `/gsd:research-phase` call. All required API behavior was verified during the initial research cycle.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All APIs verified against MDN official documentation. No new dependencies. Firefox 142+ minimum version covers all required APIs (menus.onShown requires Firefox 60+). |
| Features | HIGH | Core API behavior verified against MDN. UX patterns cross-referenced against four competitor extensions on AMO. Feature scope defined in PROJECT.md. |
| Architecture | HIGH | Based on direct source code analysis of v1.0 modules plus MDN docs. Module graph and integration points are fully mapped. Build order is unambiguous. |
| Pitfalls | HIGH | Critical pitfalls verified against MDN docs, Extension Workshop, and Bugzilla. v1.0 pitfalls (storage.sync quota, MV3 state reset) already resolved in shipped code. |

**Overall confidence:** HIGH

### Gaps to Address

- **`menus.create()` persistence after background restart:** ARCHITECTURE.md notes the parent menu item is registered in `runtime.onInstalled`. Menu items registered in `onInstalled` persist in Firefox between background reloads — but this should be verified empirically during Phase 2 development. If items are lost on restart, a fallback `menus.create` call in the startup path with a prior `menus.remove` guard will be needed.
- **`about:newtab` tab count on new window:** When a workspace consists entirely of `about:newtab` entries, `windows.create()` is called without a URL array and opens a single default tab, not N tabs. This is an acceptable constraint but should be documented in implementation comments so future maintainers understand why empty workspaces restore with one tab.
- **`tabs.move()` with pinned tabs in context menu:** ARCHITECTURE.md notes that `tabs.move()` behavior with pinned tabs (moving them before unpinned tabs) may need additional handling. This is a minor edge case to validate during Phase 2 testing, not a blocker.

---

## Sources

### Primary (HIGH confidence — MDN official documentation)
- [MDN: browser.menus API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus) — full API surface, contexts, permission name
- [MDN: menus.onShown](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/onShown) — async race condition and instance ID guard pattern
- [MDN: menus.refresh()](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/refresh) — onShown + refresh() dynamic update pattern
- [MDN: tabs.query()](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/query) — `highlighted: boolean` in QueryInfo
- [MDN: tabs.move()](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/move) — array of tabIds, cross-window move, index: -1
- [MDN: windows.create()](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/create) — tabId is integer (single tab only); url accepts string array; no tab objects
- [MDN: auxclick event](https://developer.mozilla.org/en-US/docs/Web/API/Element/auxclick_event) — non-primary button click detection in popup

### Secondary (MEDIUM confidence)
- [WebExtensions dynamic context menu — Mozilla Discourse](https://discourse.mozilla.org/t/webextensions-dynamic-context-menu/18051) — confirmed async race in onShown is a known issue
- [Bug 1469148: middle click in WebExtension menus — Bugzilla (VERIFIED FIXED, Firefox 64)](https://bugzilla.mozilla.org/show_bug.cgi?id=1469148) — auxclick event behavior in Firefox
- AMO competitor extensions: Simple Tab Groups, FoxyTab, Tab Manager Plus, Tabby — feature comparison and market expectations

### Internal
- Direct source code analysis: `src/background/{index,state,workspaces,messaging,sync}.js`, `src/popup/popup.js` — module dependency graph, existing patterns

---

*Research completed: 2026-03-23*
*Ready for roadmap: yes*
