---
phase: 04-firefox-sync
plan: 02
subsystem: storage
tags: [firefox-extension, storage-sync, storage-local, migration, workspace-persistence]

# Dependency graph
requires:
  - phase: 04-firefox-sync/04-01
    provides: sync.js abstraction with getWorkspaces, saveWorkspaces, deleteWorkspaceFromSync, migrateIfNeeded
provides:
  - All workspace reads in workspaces.js, index.js, messaging.js routed through sync.js
  - migrateIfNeeded() wired into onInstalled(update) and onStartup lifecycle hooks
  - deleteWorkspaceFromSync() called on workspace deletion to clean up orphaned sync keys
  - No direct browser.storage.local calls for workspace data outside sync.js
affects: [phase-04-firefox-sync, phase-05-if-any, AMO-publishing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "All workspace persistence flows through sync.js abstraction (never touch browser.storage directly)"
    - "migrateIfNeeded() runs before reclaimWorkspaces() on startup — migration-first ordering"
    - "deleteWorkspace calls deleteWorkspaceFromSync() for sync key cleanup after saveWorkspaces()"

key-files:
  created: []
  modified:
    - src/background/workspaces.js
    - src/background/index.js
    - src/background/messaging.js

key-decisions:
  - "activeWorkspaceId never written to sync — initDefaultWorkspace drops the activeWorkspaceId field from saveWorkspaces call, relying only on setWindowEntry for session state"
  - "deleteWorkspaceFromSync() called after saveWorkspaces() in deleteWorkspace — sync key cleanup is non-fatal and runs unconditionally"
  - "migrateIfNeeded() fires in both onInstalled(update) AND onStartup — belt-and-suspenders coverage for existing users"
  - "validateWorkspaceData removed from index.js and messaging.js — getWorkspaces() in sync.js already returns a validated plain array"

patterns-established:
  - "Sync-first reads: all workspace reads use getWorkspaces() which tries sync, falls back to local"
  - "Sync-first writes: all workspace writes use saveWorkspaces() which handles quota and fallback internally"
  - "Migration-first startup: migrateIfNeeded() always runs before any workspace read in lifecycle handlers"

requirements-completed: [SYNC-01, SYNC-02, SYNC-05]

# Metrics
duration: 3min
completed: 2026-03-21
---

# Phase 4 Plan 02: Wire sync.js Abstraction into All Background Modules Summary

**All 19 direct browser.storage.local workspace call sites replaced with sync.js abstraction — workspaces.js, index.js, and messaging.js now use getWorkspaces()/saveWorkspaces(), with migrateIfNeeded() wired into onInstalled and onStartup lifecycle hooks.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-21T20:51:56Z
- **Completed:** 2026-03-21T20:54:57Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- All workspace reads route through `getWorkspaces()` — extension now reads from storage.sync first with local fallback
- All workspace writes route through `saveWorkspaces()` — chunked sync storage with quota guard and local fallback
- `deleteWorkspaceFromSync()` called on workspace deletion to remove orphaned sync chunk keys
- `migrateIfNeeded()` wired into `onInstalled(update)` and `onStartup` — existing users' local data migrates to sync on next browser start or extension update
- `validateWorkspaceData` removed from index.js and messaging.js imports (no longer needed — getWorkspaces() handles validation internally)
- ESLint and web-ext lint both pass with zero errors on all four background modules

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace storage.local calls in workspaces.js** - `f99f699` (feat)
2. **Task 2: Wire sync.js into index.js and messaging.js, add migration** - `67eb865` (feat)
3. **Task 3: Full-codebase verification — zero direct storage.local for workspaces** - verification only, no file changes

## Files Created/Modified

- `src/background/workspaces.js` - All 15 storage.local call sites replaced; sync.js imported; deleteWorkspaceFromSync() called in deleteWorkspace
- `src/background/index.js` - 3 storage.local call sites replaced; migrateIfNeeded() added to onInstalled(update) and onStartup; validateWorkspaceData import removed
- `src/background/messaging.js` - 1 storage.local call site replaced in getState handler; validateWorkspaceData import removed; sync.js import added

## Decisions Made

- `activeWorkspaceId` not passed to `saveWorkspaces()` in `initDefaultWorkspace` — it is session state owned by `setWindowEntry()` in state.js, never persisted to storage.sync
- `deleteWorkspaceFromSync()` called unconditionally after `saveWorkspaces()` in `deleteWorkspace` — cleanup is non-fatal, consistent with research decision on orphan key handling
- `validateWorkspaceData` removed from callers — `getWorkspaces()` already returns a validated plain array, making the wrapper call redundant

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 4 is complete: sync.js created (Plan 01), all callers wired (Plan 02)
- Extension now reads from browser.storage.sync first, falls back to local on errors
- Existing local storage data migrates to sync on next update or startup
- All ESLint and web-ext lint checks pass — extension is AMO-publishable

## Self-Check: PASSED

- FOUND: src/background/workspaces.js
- FOUND: src/background/index.js
- FOUND: src/background/messaging.js
- FOUND: .planning/phases/04-firefox-sync/04-02-SUMMARY.md
- FOUND: commit f99f699 (Task 1)
- FOUND: commit 67eb865 (Task 2)

---
*Phase: 04-firefox-sync*
*Completed: 2026-03-21*
