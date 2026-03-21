---
phase: 03-multi-window-tracking
plan: 01
subsystem: background
tags: [firefox-extension, storage-session, window-map, multi-window, badge, webextensions]

# Dependency graph
requires:
  - phase: 02-data-integrity
    provides: "validateWorkspaceData, atomic switchWorkspace with rollback, storage.session bgState pattern"
  - phase: 01-mv3-and-security
    provides: "background module split (state.js, workspaces.js, messaging.js, index.js), throttledSave throttle pattern"
provides:
  - "windowId -> workspaceId map in storage.session (WINDOW_MAP_KEY)"
  - "getWindowMap, setWindowEntry, removeWindowEntry helpers in state.js"
  - "throttledSave(windowId) — window-aware, guards on unassigned windows"
  - "saveCurrentWorkspace(windowId), switchWorkspace(targetId, windowId) — explicit windowId, no currentWindow: true"
  - "updateBadge(workspace, windowId) — per-window badge via action.setBadgeText windowId param"
  - "assignWorkspace (D-09) — saves window's tabs into a workspace and assigns the map entry"
  - "reclaimWorkspaces (D-10) — URL-intersection scoring at RECLAIM_THRESHOLD=0.5 on browser restart"
  - "focusWindow message action (WIN-03)"
  - "Window lifecycle listeners: windows.onRemoved releases workspace, windows.onFocusChanged refreshes badge"
  - "All tab events pass explicit windowId to throttledSave"
affects:
  - "03-02 (popup rendering) — getState now returns windowMap and activeWorkspaceId; popup must pass windowId in all messages"
  - "04-storage-sync — window-workspace schema is finalized here; sync migration reads this"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "window-workspace map: single object under WINDOW_MAP_KEY in storage.session, keys are string(windowId)"
    - "exclusive ownership check: scan windowMap for targetId before allowing switch/assign"
    - "URL-intersection scoring for restart reclaim: matches / workspace.tabs.length >= 0.5"
    - "per-window badge via { windowId } spread in browser.action.setBadgeText/setBadgeBackgroundColor"
    - "unassigned window badge: text='?', color='#888888'"

key-files:
  created: []
  modified:
    - src/background/state.js
    - src/background/workspaces.js
    - src/background/messaging.js
    - src/background/index.js

key-decisions:
  - "throttledSave uses a single global lastSaveTime throttle (not per-window) — acceptable 500ms collision risk, consistent with Phase 1 decision"
  - "initDefaultWorkspace always requires explicit windowId — index.js uses windows.getCurrent() for onInstalled case"
  - "rollbackSwitch restores workspaces array and window map entry to previous values"
  - "windows.onFocusChanged does not trigger a save — badge refresh only (Claude's Discretion)"
  - "assignWorkspace saves current window tabs into the workspace before assigning (preserves tab state)"

patterns-established:
  - "All background functions that touch tabs or badges now accept explicit windowId — never rely on currentWindow: true"
  - "Exclusive ownership enforced in both switchWorkspace and assignWorkspace before state mutation"
  - "Window lifecycle (onRemoved, onFocusChanged) registered synchronously at module top-level per Firefox event page requirement"

requirements-completed: [WIN-01, WIN-04, WIN-05, WIN-06]

# Metrics
duration: 4min
completed: 2026-03-21
---

# Phase 3 Plan 1: Multi-Window Background Layer Summary

**Per-window workspace tracking via storage.session windowMap — all background functions accept explicit windowId, no currentWindow: true, exclusive ownership enforced, per-window badge and restart reclaim implemented**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-21T10:57:28Z
- **Completed:** 2026-03-21T10:57:42Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Replaced global `activeWorkspaceId` runtime lookup with `windowId -> workspaceId` map in `storage.session` — each window independently tracks its workspace
- All four background modules (state.js, workspaces.js, messaging.js, index.js) are now window-aware: no function uses `currentWindow: true`
- Added `assignWorkspace` (D-09), `reclaimWorkspaces` (D-10 with 0.5 URL-score threshold), and `focusWindow` message action (WIN-03)
- Per-window badge via `browser.action.setBadgeText({ windowId })` — unassigned windows show `'?'` on gray

## Task Commits

Each task was committed atomically:

1. **Task 1: Add window map helpers to state.js and make workspaces.js window-aware** - `e2c0db8` (feat)
2. **Task 2: Wire window lifecycle listeners in index.js and route new actions in messaging.js** - `d355767` (feat)

## Files Created/Modified

- `src/background/state.js` — Added `WINDOW_MAP_KEY`, `getWindowMap`, `setWindowEntry`, `removeWindowEntry`; `throttledSave(windowId)` guards on undefined windowId and unassigned window map entry
- `src/background/workspaces.js` — All functions accept windowId; new `assignWorkspace` and `reclaimWorkspaces`; `updateBadge` supports per-window and unassigned (`'?'`/`'#888888'`)
- `src/background/messaging.js` — `getState` returns `windowMap` + `activeWorkspaceId`; all actions pass `msg.windowId`; new `focusWindow` and `assignWorkspace` cases
- `src/background/index.js` — Tab events pass windowId; window lifecycle listeners added; `onStartup` calls `reclaimWorkspaces`; badge init sets per-window badges

## Decisions Made

- **throttledSave global throttle:** Kept single `lastSaveTime` for simplicity. Per-window throttle deferred to Phase 3 if proven problematic (research open question #2).
- **initDefaultWorkspace always requires windowId:** `index.js` uses `browser.windows.getCurrent()` for the `onInstalled` case, keeping `workspaces.js` free of `currentWindow: true`.
- **windows.onFocusChanged:** Badge refresh only, no save triggered (Claude's Discretion — tab events already handle saves).
- **assignWorkspace snapshot:** Saves current window tabs into the workspace before assigning; this makes the workspace represent the window's current state immediately.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Removed unused `removeWindowEntry` import from workspaces.js**
- **Found during:** Task 1 (ESLint verification)
- **Issue:** Initial import included `removeWindowEntry` which is only needed in `index.js`, not `workspaces.js` — ESLint reported `no-unused-vars` warning
- **Fix:** Removed from workspaces.js import; it remains exported from state.js and imported by index.js
- **Files modified:** src/background/workspaces.js
- **Verification:** ESLint exits 0 with no warnings
- **Committed in:** e2c0db8 (Task 1 commit)

**2. [Rule 2 - Missing Critical] Removed unused `reclaimWorkspaces` import from messaging.js**
- **Found during:** Task 2 (ESLint verification)
- **Issue:** Initial messaging.js import included `reclaimWorkspaces` which is only used in `index.js` — ESLint `no-unused-vars` warning
- **Fix:** Removed from messaging.js import
- **Files modified:** src/background/messaging.js
- **Verification:** ESLint exits 0 with no warnings
- **Committed in:** d355767 (Task 2 commit)

**3. [Rule 1 - Bug] initDefaultWorkspace made strictly windowId-required**
- **Found during:** Task 1 acceptance criteria check
- **Issue:** Plan step 13 specified a `currentWindow: true` fallback when no windowId, but the success criterion said "no function uses `currentWindow: true`" — contradiction resolved in favor of the stricter criterion
- **Fix:** `initDefaultWorkspace(windowId)` always uses `{ windowId }`; index.js calls `browser.windows.getCurrent()` before the call in `onInstalled` and `onStartup` fallback paths
- **Files modified:** src/background/workspaces.js, src/background/index.js
- **Verification:** `grep -rn 'currentWindow: true' src/background/` returns no matches
- **Committed in:** e2c0db8, d355767

---

**Total deviations:** 3 auto-fixed (2 unused import cleanup, 1 spec contradiction resolution)
**Impact on plan:** All auto-fixes improve code quality; no scope creep. `initDefaultWorkspace` change aligns `index.js` with full window-awareness.

## Issues Encountered

None — implementation straightforward. The plan's detailed action specifications and research patterns made execution direct.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Background layer is fully window-aware — ready for Phase 3 Plan 2 (popup rendering)
- Popup must be updated to: call `browser.tabs.query({ active: true, currentWindow: true })` to get `currentWindowId`, include `windowId` in all messages, render `windowMap` in-use indicators, and call `focusWindow` action for in-use workspace clicks
- `storage.session windowMap` schema is stable — Phase 4 sync migration can rely on this structure

---
*Phase: 03-multi-window-tracking*
*Completed: 2026-03-21*
