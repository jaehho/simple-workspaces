---
phase: 02-data-integrity
plan: 01
subsystem: storage
tags: [validation, schema, uuid, crypto, firefox-extension, data-integrity]

# Dependency graph
requires:
  - phase: 01-mv3-and-security
    provides: "background module split (workspaces.js, index.js, state.js, messaging.js)"

provides:
  - "validateWorkspaceData function exported from workspaces.js — guards all storage reads"
  - "DEFAULT_WORKSPACE_DATA factory for safe empty default"
  - "crypto.randomUUID() replaces genId() at both workspace creation sites"
  - "Corrupted storage triggers recovery via initDefaultWorkspace instead of crash"

affects:
  - 02-data-integrity
  - 03-multi-window
  - 04-storage-sync

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Validate-on-read: validateWorkspaceData called immediately after every browser.storage.local.get"
    - "Safe default factory: DEFAULT_WORKSPACE_DATA() returns empty workspaces array and null activeWorkspaceId"
    - "UUID v4: crypto.randomUUID() for all workspace ID generation (standards-compliant, collision-resistant)"

key-files:
  created: []
  modified:
    - src/background/workspaces.js
    - src/background/index.js

key-decisions:
  - "validateWorkspaceData exported so index.js can import and use it in onStartup and badge init IIFE"
  - "genId() deleted entirely — crypto.randomUUID() used inline at each call site (initDefaultWorkspace, createWorkspace)"
  - "activeWorkspaceId pointing to nonexistent workspace is corrected to first valid workspace ID (not null)"

patterns-established:
  - "validate-on-read: const raw = await browser.storage.local.get(...); const data = validateWorkspaceData(raw)"

requirements-completed: [DATA-03, DATA-04]

# Metrics
duration: 2min
completed: 2026-03-21
---

# Phase 2 Plan 1: Schema Validation and UUID Migration Summary

**validateWorkspaceData guard on every storage.local.get call site in workspaces.js and index.js; genId() deleted and replaced with crypto.randomUUID() at both workspace creation sites**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-21T09:49:45Z
- **Completed:** 2026-03-21T09:51:42Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- Added `validateWorkspaceData` and `DEFAULT_WORKSPACE_DATA` exports to `workspaces.js`, implementing structural invariant checks on every storage read
- Wired validation into all 5 functions in `workspaces.js` that read storage: `saveCurrentWorkspace`, `switchWorkspace`, `createWorkspace`, `deleteWorkspace`, `updateWorkspace`
- Wired validation into both storage reads in `index.js`: `onStartup` listener and badge init IIFE
- Deleted `genId()` (Date.now + Math.random pattern) and replaced with `crypto.randomUUID()` at both call sites in `initDefaultWorkspace` and `createWorkspace`
- Corrupted or partial storage data now returns `DEFAULT_WORKSPACE_DATA()` and triggers `initDefaultWorkspace()` recovery instead of a runtime crash

## Task Commits

Each task was committed atomically:

1. **Task 1: Add validateWorkspaceData, replace genId with crypto.randomUUID, wire validation into all storage reads** - `ce7cd2c` (feat)

## Files Created/Modified

- `src/background/workspaces.js` — Added `DEFAULT_WORKSPACE_DATA` factory, `validateWorkspaceData` function; replaced `genId()` with `crypto.randomUUID()`; wired validation into 5 functions
- `src/background/index.js` — Added `validateWorkspaceData` to import; wired into `onStartup` and badge init IIFE

## Decisions Made

- `validateWorkspaceData` exported from `workspaces.js` so `index.js` can use it without circular dependencies
- `genId()` deleted entirely rather than aliased — all call sites updated inline, no migration shim needed
- `activeWorkspaceId` pointing to a workspace that passed filtering (but is now absent) gets corrected to `validWorkspaces[0].id`, not null, so callers never need to handle a valid-workspaces-but-null-active case

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- DATA-03 and DATA-04 complete; storage reads are now safe against corrupted or partial data
- Plan 02-02 (atomicity and rollback) can proceed: `validateWorkspaceData` is already imported and available in `switchWorkspace`
- No blockers

---
*Phase: 02-data-integrity*
*Completed: 2026-03-21*
