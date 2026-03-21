---
phase: 02-data-integrity
plan: 02
subsystem: storage
tags: [atomicity, rollback, compensation, tab-switching, firefox-extension, data-integrity]

# Dependency graph
requires:
  - phase: 02-data-integrity
    provides: "validateWorkspaceData guard on all storage reads (Plan 01)"

provides:
  - "rollbackSwitch helper that closes partial tabs and restores storage snapshot on failure"
  - "Snapshot-before-mutation in switchWorkspace (deep copy after saving current tabs, before tab creation)"
  - "Count-based atomicity check: old tabs only removed when all new tabs created successfully"
  - "Catch block rollback for unexpected errors during switch"

affects:
  - 03-multi-window
  - 04-storage-sync

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Compensation rollback: snapshot-before-mutation + count-based failure detection + rollbackSwitch cleanup"
    - "Deep copy snapshot: JSON.parse(JSON.stringify(data.workspaces)) before tab creation loop"
    - "Atomicity gate: old tabs never removed unless createdTabIds.length === tabsToCreate.length"

key-files:
  created: []
  modified:
    - src/background/workspaces.js

key-decisions:
  - "rollbackSwitch placed after switchWorkspace, before createWorkspace — private (not exported); all internal errors caught to prevent masking the original failure"
  - "snapshot taken AFTER saving current workspace tabs but BEFORE tabs.create loop — ensures rollback restores the most recent tab state, not stale pre-save state"
  - "rollbackSwitch NOT in finally block — finally runs on success too; rollback only runs in failure path and catch block"
  - "early return for same-workspace switch now returns { success: true } instead of undefined"

patterns-established:
  - "Compensation pattern: rollbackSwitch(createdTabIds, snapshot) called at count mismatch and in catch block"
  - "Atomicity guard: if (createdTabIds.length !== tabsToCreate.length) { rollback; return failure }"

requirements-completed: [DATA-01, DATA-02]

# Metrics
duration: 1min
completed: 2026-03-21
---

# Phase 2 Plan 2: Atomic Workspace Switch with Compensation Rollback Summary

**switchWorkspace made atomic via snapshot-before-mutation, count-based failure detection, and rollbackSwitch helper that closes partial tabs and restores storage on failure**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-03-21T09:53:45Z
- **Completed:** 2026-03-21T09:54:45Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added `rollbackSwitch(createdTabIds, snapshot)` private helper that closes any partially-created tabs and restores the pre-switch storage snapshot — both wrapped in separate try-catch blocks so rollback errors never propagate
- Modified `switchWorkspace` to take a deep-copy snapshot (`JSON.parse(JSON.stringify)`) after saving current workspace tabs but before the `tabs.create` loop
- Added count-based atomicity check: `if (createdTabIds.length !== tabsToCreate.length)` triggers rollback before old tabs are ever removed
- Added rollback in the `catch` block for unexpected errors (only when snapshot exists, i.e., error happened after snapshot was taken)
- Old tab removal guard simplified from `if (createdTabIds.length > 0 && oldTabIds.length > 0)` to `if (oldTabIds.length > 0)` — atomicity check above already guarantees all tabs were created

## Task Commits

Each task was committed atomically:

1. **Task 1: Add rollbackSwitch helper and make switchWorkspace atomic with snapshot and count-based failure detection** - `a0e5555` (feat)

## Files Created/Modified

- `src/background/workspaces.js` — Modified `switchWorkspace`: added `let snapshot = null`, moved `const createdTabIds = []` to outer scope, added deep-copy snapshot, atomicity check with rollback call, and catch-block rollback; added private `rollbackSwitch` helper after `switchWorkspace`

## Decisions Made

- `rollbackSwitch` is NOT exported — it is a private compensation function called only by `switchWorkspace`
- Snapshot is taken AFTER `data.workspaces[currentIdx].tabs = serializeTabs(currentTabs)` mutation but BEFORE the `tabs.create` loop — this ensures rollback restores the most recent (post-save) workspace tab state
- Two separate try-catch blocks inside `rollbackSwitch` (one for `tabs.remove`, one for `storage.local.set`) ensure a tab-removal failure cannot prevent the storage restoration
- `rollbackSwitch` never throws — all errors are caught internally and logged with `[Workspaces]` prefix per project convention

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- DATA-01 and DATA-02 complete; workspace switching is now atomic with full compensation rollback
- Phase 2 complete: all data integrity requirements (DATA-01 through DATA-04) satisfied
- Phase 3 (multi-window awareness) can proceed with a hardened, safe storage layer underneath

---
*Phase: 02-data-integrity*
*Completed: 2026-03-21*

## Self-Check: PASSED

- FOUND: src/background/workspaces.js
- FOUND: .planning/phases/02-data-integrity/02-02-SUMMARY.md
- FOUND commit: a0e5555
