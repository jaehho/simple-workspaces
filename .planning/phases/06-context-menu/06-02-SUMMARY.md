---
phase: 06-context-menu
plan: "02"
subsystem: ui
tags: [context-menu, browser-menus, tab-movement, firefox-webextensions]

# Dependency graph
requires:
  - phase: 06-01
    provides: moveTabsToWorkspace() with cross-window and same-window paths, lastUsedAt field on workspace objects

provides:
  - "Move to Workspace" right-click context menu on the tab strip with dynamic submenu
  - Multi-tab selection support (Ctrl+click + right-click moves all highlighted tabs)
  - MRU-sorted submenu (most recently used workspace first)
  - Cross-window workspace detection with [open] suffix label
  - menus.js module with handleMenuShown and handleMenuClicked handlers
affects:
  - future ui phases that add more context menu items
  - any phase touching workspaces.js moveTabsToWorkspace same-window path

# Tech tracking
tech-stack:
  added: [browser.menus API (menus permission)]
  patterns:
    - "Menu parent in onInstalled, children rebuilt dynamically in onShown (MV3 event page pattern)"
    - "Instance ID guard prevents stale async fetch from overwriting newer menu open"
    - "Set-based child ID tracking for clean removal on each onShown cycle"
    - "Highlighted tab check for multi-tab selection: if tab.highlighted, query all highlighted"

key-files:
  created:
    - src/background/menus.js
  modified:
    - src/manifest.json
    - src/background/index.js
    - src/background/workspaces.js

key-decisions:
  - "Place menus.create() for parent item inside onInstalled (not top-level) — MV3 event page requires persistent items to be created in onInstalled to survive restarts"
  - "Use menus.onClicked listener (not onclick property) — onclick in menus.create() throws in MV3"
  - "Instance ID guard pattern for onShown: increment counter, check before applying async results to detect stale fetches"
  - "Same-window source cleanup after switchWorkspace: re-fetch workspaces and filter by URL Set because switchWorkspace re-serializes live tab state, including the tabs that were just moved"

patterns-established:
  - "Pattern 1 (menu registration): parent item in onInstalled, children rebuilt in onShown, removed from Set on next open"
  - "Pattern 2 (async guard): instance ID counter prevents race conditions in async menu callbacks"

requirements-completed: [MENU-01, MENU-03, MENU-04]

# Metrics
duration: ~30min
completed: 2026-03-24
---

# Phase 6 Plan 02: Context Menu Summary

**"Move to Workspace" context menu on the tab strip with dynamic MRU-sorted submenu, multi-tab selection, and cross-window detection**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-03-24
- **Completed:** 2026-03-24
- **Tasks:** 3 (2 auto + 1 human-verify)
- **Files modified:** 4

## Accomplishments

- Created menus.js module with handleMenuShown (dynamic submenu builder) and handleMenuClicked (tab move dispatcher)
- Wired menu listeners at top-level in index.js and registered parent menu item in onInstalled per MV3 event page pattern
- Human verification passed: all 5 test scenarios (basic move, multi-tab, cross-window, dynamic updates, MRU ordering) confirmed working after bug fix

## Task Commits

Each task was committed atomically:

1. **Task 1: Create menus.js module and add manifest permission** - `f10ac67` (feat)
2. **Task 2: Wire menu listeners into index.js** - `942ac75` (feat)
3. **Task 3: Verify context menu end-to-end** - human-approved (no code commit)

**Bug fix (deviation):** `d31b920` (fix)

## Files Created/Modified

- `src/background/menus.js` - New module: handleMenuShown builds dynamic submenu on each open; handleMenuClicked resolves target workspace from child ID prefix and dispatches moveTabsToWorkspace(); instance ID guard prevents stale async results; PARENT_MENU_ID exported for index.js
- `src/manifest.json` - Added "menus" to permissions array
- `src/background/index.js` - Import of handleMenuShown/handleMenuClicked/PARENT_MENU_ID; top-level onShown/onClicked listener registration; menus.create() for parent item in onInstalled block
- `src/background/workspaces.js` - Bug fix: same-window source cleanup after switchWorkspace re-serializes live tab state

## Decisions Made

- `menus.create()` for the parent item runs in `onInstalled` for both install and update reasons. This is required for MV3 event pages: items created at top-level get duplicated on each event-page wake.
- `onclick` property omitted from `menus.create()` calls — it throws in MV3. `browser.menus.onClicked` listener used instead.
- Instance ID guard: `lastMenuInstanceId` checked after the async `Promise.all([getWorkspaces(), getWindowMap()])` fetch to discard results from a stale open. Prevents wrong submenu from being applied when two onShown events fire in quick succession.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Same-window move left moved tabs in source workspace**
- **Found during:** Task 3 (human verification — test scenario B, same-window move)
- **Issue:** `moveTabsToWorkspace` same-window path calls `switchWorkspace()` after prepending moved tabs to the target. `switchWorkspace()` saves the current window's live tabs (which still include the moved tabs as browser tabs) into the source workspace before switching. As a result, moved tabs were re-added to the source workspace after the switch completed.
- **Fix:** After `await switchWorkspace(targetWsId, sourceWindowId)` returns, re-fetch workspaces and filter the source workspace tabs by URL Set (matching the tabs that were moved) to remove the re-added entries.
- **Files modified:** `src/background/workspaces.js` (lines 276-284)
- **Verification:** Human confirmed moved tabs no longer appear in source after same-window move (test scenario B passed)
- **Committed in:** `d31b920` (separate fix commit during checkpoint)

---

**Total deviations:** 1 auto-fixed (Rule 1 bug)
**Impact on plan:** Fix necessary for correctness — without it, same-window moves silently duplicated tabs in the source workspace. No scope creep.

## Issues Encountered

None beyond the deviation documented above. ESLint and web-ext lint passed clean on all files.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 06 context menu feature is complete. Both plans (06-01 moveTabsToWorkspace and 06-02 context menu UI) are done.
- The `menus.js` module is self-contained and can be extended with additional context menu actions in future phases.
- The same-window source-cleanup pattern (URL Set filter after switchWorkspace) is now documented in STATE.md decisions for any future caller of moveTabsToWorkspace in the same-window path.

## Self-Check: PASSED

- FOUND: .planning/phases/06-context-menu/06-02-SUMMARY.md
- FOUND: src/background/menus.js
- FOUND: src/background/index.js
- FOUND: commit f10ac67 (feat: create menus.js module and add manifest permission)
- FOUND: commit 942ac75 (feat: wire menu listeners into index.js)
- FOUND: commit d31b920 (fix: remove moved tabs from source workspace after switch)

---
*Phase: 06-context-menu*
*Completed: 2026-03-24*
