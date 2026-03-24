---
phase: 07-new-window-opening
plan: 02
subsystem: ui
tags: [popup, click-handler, new-window, modifier-keys, firefox-webextension]

# Dependency graph
requires:
  - phase: 07-new-window-opening plan 01
    provides: openWorkspaceInNewWindow background action via messaging.js
provides:
  - Popup UI with removed banner/assign-here buttons
  - Context-sensitive subtitle (Click vs Ctrl+click to open in new window)
  - Ctrl+click handler routing to onOpenInNewWindow
  - Middle-click (auxclick) handler routing to onOpenInNewWindow
  - Unassigned-window regular-click routing to onOpenInNewWindow
  - Active-workspace guard on all new-window paths
affects: [future popup UI phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "modifier-key-routing: e.ctrlKey + e.preventDefault() before main click logic"
    - "auxclick-with-button-guard: e.button !== 1 early return to isolate middle-click"
    - "active-workspace-guard: !isActive check on all new-window trigger paths"

key-files:
  created: []
  modified:
    - src/popup/popup.html
    - src/popup/popup.js
    - src/popup/popup.css

key-decisions:
  - "Ctrl+click uses e.preventDefault() to suppress macOS system context menu before routing"
  - "auxclick handler uses e.button !== 1 guard to safely no-op right-click without breaking context menus"
  - "onOpenInNewWindow does not await or check background response — popup closes unconditionally; errors logged in background"
  - "isActive guard on unassigned-window path is defensive (theoretically impossible state) for future safety"

patterns-established:
  - "Click routing: check action-button target first, then modifier keys, then window-assignment state"
  - "New-window intent always closes popup via window.close() after sendMessage"

requirements-completed: [WIN-01, WIN-02, WIN-03, WIN-04]

# Metrics
duration: 15min
completed: 2026-03-24
---

# Phase 07 Plan 02: New-Window Opening Popup Summary

**Popup UI rewired to open workspaces in new windows via Ctrl+click, middle-click, and unassigned-window click, with banner and assign-here buttons removed and context-sensitive subtitle added**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-24
- **Completed:** 2026-03-24
- **Tasks:** 3 (2 auto + 1 human-verify)
- **Files modified:** 3

## Accomplishments

- Removed unassigned-window banner and "Assign Here" buttons from all popup states (WIN-02)
- Added `.ws-subtitle` element that displays "Click to open in new window" (unassigned) or "Ctrl+click to open in new window" (assigned) for discoverability
- Rewired click handler to route Ctrl+click to `onOpenInNewWindow` from any window with `e.preventDefault()` for macOS (WIN-04)
- Added `auxclick` listener with `e.button !== 1` guard for middle-click new-window opening (WIN-03)
- Unassigned-window regular click now opens workspace in new window instead of the removed assign flow (WIN-01)
- Human verification confirmed all 8 test scenarios (A through H) pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove banner, assign button, and deprecated CSS; add subtitle and header-text wrapper** - `900404b` (feat)
2. **Task 2: Rewire click handlers with modifier detection and add auxclick listener** - `857502a` (feat)
3. **Task 3: Verify new-window opening end-to-end** - human-approved checkpoint (no commit)

## Files Created/Modified

- `src/popup/popup.html` - Added `.header-text` wrapper div and `<p id="ws-subtitle">` element inside header
- `src/popup/popup.js` - Added `onOpenInNewWindow()`, rewired click handler with modifier detection and unassigned-window branch, added `auxclick` listener; removed `onAssign`, banner rendering, and assign-button creation blocks
- `src/popup/popup.css` - Added `.header-text` and `.ws-subtitle` rules; removed `.ws-unassigned-banner`, `.ws-unassigned-heading`, `.ws-unassigned-subtext`, `.ws-actions button.assign`, and `.workspace-list--unassigned` blocks

## Decisions Made

- Ctrl+click calls `e.preventDefault()` before routing to suppress macOS context menu (pitfall from research)
- `auxclick` uses `e.button !== 1` early-return guard so right-click (`button === 2`) passes through to native context menu
- `onOpenInNewWindow` does not check the background response — popup closes unconditionally via `window.close()`; errors surface in the background console
- Defensive `!isActive` guard on the unassigned-window path even though `activeWorkspaceId === null` makes the active-workspace-click case technically impossible

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 07 is complete. All four WIN requirements (WIN-01 through WIN-04) are satisfied:
- WIN-01: Unassigned-window click opens workspace in new window
- WIN-02: Banner and Assign Here UI removed
- WIN-03: Middle-click opens workspace in new window
- WIN-04: Ctrl+click opens workspace in new window

No blockers for subsequent phases.

---
*Phase: 07-new-window-opening*
*Completed: 2026-03-24*
