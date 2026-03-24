---
phase: 07-new-window-opening
plan: 01
subsystem: background
tags: [firefox-extension, windows-api, tabs-api, workspace-management]

# Dependency graph
requires:
  - phase: 06-context-menu
    provides: "workspaces.js with moveTabsToWorkspace, state.js session storage patterns, messaging.js switch statement routing"
provides:
  - "openWorkspaceInNewWindow(targetId) exported from workspaces.js"
  - "openWorkspaceInNewWindow message routing in messaging.js"
  - "Exclusive ownership check with window focus-on-conflict for new-window opens"
  - "Rollback (window removal) on partial tab creation failure"
affects:
  - "07-02: popup.js will send openWorkspaceInNewWindow messages using this new action"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "browser.windows.create() with no URL then tab loop + blank tab removal"
    - "isSwitching guard (try/finally) applied to new-window creation, same as switchWorkspace"
    - "Exclusive ownership without caller exclusion (any window owning target gets focused)"
    - "Rollback via browser.windows.remove() on partial tab creation failure"

key-files:
  created: []
  modified:
    - src/background/workspaces.js
    - src/background/messaging.js

key-decisions:
  - "Exclusive ownership check for openWorkspaceInNewWindow does NOT exclude a caller window ID — unlike switchWorkspace, any window owning the target is focused, because the intent is always to create a new window, not switch the caller's window"
  - "Rollback on partial tab creation failure closes the entire new window via browser.windows.remove() rather than leaving partial state for user recovery"
  - "isSwitching guard set at start of openWorkspaceInNewWindow to prevent throttledSave from persisting partial state while tabs are created in the new window"

patterns-established:
  - "New-window creation: browser.windows.create() with focused:true, capture blankTabId from tabs[0].id, run tab loop, remove blank tab"
  - "Rollback pattern: browser.windows.remove(newWindow.id) on createdTabIds.length !== tabsToCreate.length"

requirements-completed: [WIN-01, WIN-03, WIN-04]

# Metrics
duration: 1min
completed: 2026-03-24
---

# Phase 07 Plan 01: New-Window Opening Background Plumbing Summary

**openWorkspaceInNewWindow function in workspaces.js: creates a browser window, populates it with workspace tabs using the discarded-tab pattern, removes the auto-injected blank tab, handles exclusive ownership by focusing existing windows, and records the windowMap entry**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-24T15:39:09Z
- **Completed:** 2026-03-24T15:40:10Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Implemented `openWorkspaceInNewWindow(targetId)` exported from `workspaces.js` with full isSwitching guard, exclusive ownership check, window creation, discarded-tab loop, blank tab removal, rollback, windowMap entry, and badge update
- Wired `openWorkspaceInNewWindow` message routing in `messaging.js` — the popup can now send `{ action: 'openWorkspaceInNewWindow', workspaceId }` to trigger the new function
- Both files pass ESLint and web-ext lint with 0 errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add openWorkspaceInNewWindow to workspaces.js and wire messaging.js** - `1baea41` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `src/background/workspaces.js` - Added 83-line `openWorkspaceInNewWindow` function after `assignWorkspace`
- `src/background/messaging.js` - Added `openWorkspaceInNewWindow` to import and added `case 'openWorkspaceInNewWindow'` in switch

## Decisions Made
- Exclusive ownership check in `openWorkspaceInNewWindow` does NOT exclude the caller's window ID — unlike `switchWorkspace` which uses `wid !== String(windowId)` to allow the caller's window to switch freely, `openWorkspaceInNewWindow` has no caller window because it always creates a new window. Any existing window owning the target workspace gets focused (D-01, D-02 fully honored).
- Rollback on partial tab creation failure closes the entire new window via `browser.windows.remove(newWindow.id)` rather than leaving partial tabs. The new window was extension-created — removing it cleanly is less surprising than leaving a partially populated window.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Background plumbing complete. Plan 02 (popup.js changes) can now send `openWorkspaceInNewWindow` messages and receive `{ success, focusedExisting? }` responses.
- No blockers.

---
*Phase: 07-new-window-opening*
*Completed: 2026-03-24*
