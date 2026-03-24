---
phase: 05-module-integrity
plan: 01
subsystem: background-modules
tags: [firefox-extension, es-modules, circular-dependency, storage-validation, refactor]

# Dependency graph
requires:
  - phase: 04-firefox-sync
    provides: sync.js storage abstraction with readFromLocal fallback path
provides:
  - Acyclic module dependency graph in background/ — state.js has zero project imports
  - validateWorkspaceData and DEFAULT_WORKSPACE_DATA defined in sync.js (storage module)
  - readFromLocal() in sync.js validates all data through validateWorkspaceData before returning
  - throttledSave exported from workspaces.js alongside saveCurrentWorkspace
affects: [06-context-menu, 07-window-management, any future background/ module additions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Storage module (sync.js) owns schema validation — validation lives beside the data it protects"
    - "Re-export pattern: workspaces.js re-exports validateWorkspaceData/DEFAULT_WORKSPACE_DATA from sync.js for backward compat"
    - "Pure session module: state.js has zero imports — no risk of initialization-order issues"

key-files:
  created: []
  modified:
    - src/background/state.js
    - src/background/workspaces.js
    - src/background/index.js
    - src/background/sync.js

key-decisions:
  - "Move throttledSave to workspaces.js (not a new module) — it calls saveCurrentWorkspace which lives there already"
  - "Move validateWorkspaceData to sync.js — validation belongs beside the read operation it protects"
  - "Re-export validateWorkspaceData from workspaces.js — defensive backward compat for Phase 6/7 imports"

patterns-established:
  - "Validation at read boundary: readFromLocal() validates before returning, never exposes raw storage data"
  - "Module ownership: functions live in the module that owns their primary dependency"

requirements-completed: [DEBT-01, DEBT-02]

# Metrics
duration: 2min
completed: 2026-03-24
---

# Phase 5 Plan 01: Module Integrity Summary

**Circular dependency state.js <-> workspaces.js eliminated and local storage fallback path now validates all data through validateWorkspaceData before returning to callers**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-24T05:45:33Z
- **Completed:** 2026-03-24T05:47:08Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Eliminated circular import: state.js had `import { saveCurrentWorkspace } from './workspaces.js'` which caused a mutual dependency. Now state.js has zero project imports.
- throttledSave moved to workspaces.js where it belongs — it wraps saveCurrentWorkspace and uses getWindowMap/getSessionState already imported there.
- validateWorkspaceData and DEFAULT_WORKSPACE_DATA moved from workspaces.js to sync.js — validation now lives at the storage boundary where it protects callers from corrupted data.
- readFromLocal() now calls validateWorkspaceData() before returning, closing the gap where corrupted local storage could silently reach callers.

## Task Commits

Each task was committed atomically:

1. **Task 1: Break circular dependency — move throttledSave to workspaces.js** - `8eef3dc` (refactor)
2. **Task 2: Close validation gap — move validateWorkspaceData to sync.js** - `5b5ab64` (fix)

## Files Created/Modified

- `src/background/state.js` - Removed import of workspaces.js, removed THROTTLE_MS constant and throttledSave function. Now has zero import statements.
- `src/background/workspaces.js` - Added THROTTLE_MS constant and throttledSave export; removed validateWorkspaceData/DEFAULT_WORKSPACE_DATA definitions; added import and re-export of those from sync.js.
- `src/background/index.js` - Updated import: throttledSave now imported from workspaces.js instead of state.js.
- `src/background/sync.js` - Added validateWorkspaceData and DEFAULT_WORKSPACE_DATA exports; updated readFromLocal() to validate data before returning.

## Decisions Made

- throttledSave moved to workspaces.js (not its own module) because it directly wraps saveCurrentWorkspace and already had all required imports available in that file.
- validateWorkspaceData moved to sync.js (storage module) because validation belongs at the boundary that reads from storage — ownership follows the data.
- Re-exported validateWorkspaceData from workspaces.js as a defensive measure since Phase 6 and 7 may add imports from workspaces.js.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Module graph is acyclic — Phase 6 (context-menu) and Phase 7 (window-management) can safely add imports to any background module without initialization-order risk.
- All local storage reads are now validated — corrupted fallback data will be rejected gracefully.
- Lint passes with zero errors/warnings.

---
*Phase: 05-module-integrity*
*Completed: 2026-03-24*
