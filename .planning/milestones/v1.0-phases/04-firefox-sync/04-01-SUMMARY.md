---
phase: 04-firefox-sync
plan: 01
subsystem: storage
tags: [browser.storage.sync, browser.storage.local, chunking, quota, migration, fallback]

# Dependency graph
requires:
  - phase: 03-multi-window-tracking
    provides: windowMap session state (activeWorkspaceId per device, not synced)
provides:
  - src/background/sync.js — sync-first storage abstraction with chunked schema, quota monitoring, local fallback, and migration
affects: [04-02-wiring, workspaces.js, messaging.js, index.js]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Sync-first storage abstraction — try storage.sync, fall back to storage.local on quota or failure
    - Chunked workspace schema — ws:{id} metadata + ws:{id}:t:N tab arrays (25 tabs/chunk)
    - Idempotent migration sentinel — wsIndex presence in sync signals migration already done
    - Proactive + reactive quota protection — getBytesInUse before write + QuotaExceededError catch

key-files:
  created:
    - src/background/sync.js
  modified: []

key-decisions:
  - "favIconUrl stripped from sync writes to avoid 8KB per-item limit (Pitfall 1 from research)"
  - "QUOTA_BYTES_PER_ITEM=8192 kept as documented constant even though not used in quota math (total quota threshold used instead)"
  - "pruneStaleChunks wrapped in outer try/catch for syncData read failure — non-fatal path"

patterns-established:
  - "sync.js is the sole interface for workspace persistence — callers never touch browser.storage directly"
  - "All sync writes batched into single storage.sync.set(items) call to avoid partial-write on MV3 unload"
  - "activateFallback writes syncFailed:true + workspaces to local atomically"

requirements-completed: [SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05]

# Metrics
duration: 2min
completed: 2026-03-21
---

# Phase 4 Plan 01: Firefox Sync Storage Abstraction

**sync-first storage abstraction with chunked workspace schema, 90% quota fallback, and idempotent local-to-sync migration**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-21T20:48:58Z
- **Completed:** 2026-03-21T20:50:09Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Created `src/background/sync.js` as sole workspace persistence interface with 4 exported functions
- Chunked sync schema keeps each storage item under 8KB by splitting tabs at 25/chunk and stripping favIconUrl
- Dual quota protection: proactive getBytesInUse() check at 90% threshold + reactive QuotaExceededError catch
- Migration path reads existing storage.local workspaces, writes to sync schema, removes stale local key

## Task Commits

1. **Task 1: Create src/background/sync.js storage abstraction module** - `e39b5d9` (feat)

## Files Created/Modified

- `src/background/sync.js` — Storage abstraction module: getWorkspaces, saveWorkspaces, migrateIfNeeded, deleteWorkspaceFromSync + internal helpers (serializeToSyncItems, assembleFromSync, chunkArray, pruneStaleChunks, activateFallback, isSyncFailed, readFromLocal)

## Decisions Made

- favIconUrl stripped from sync writes (not from local fallback writes) — browser re-fetches favicons on tab restore, and same-domain favicon repetition was measured to push a 40-tab workspace over 8KB
- QUOTA_BYTES_PER_ITEM=8192 retained as a named constant for documentation even though the quota threshold check uses total QUOTA_BYTES — keeps the research-specified constants self-documenting
- pruneStaleChunks reads all sync data then computes diff — acceptable single extra get() per save since it prevents quota waste from orphaned chunk keys

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- sync.js is complete and ready for Plan 02 wiring
- Plan 02 will replace all 12 `browser.storage.local` call sites in workspaces.js, messaging.js, and index.js with calls to getWorkspaces()/saveWorkspaces() from sync.js
- migrateIfNeeded() must be called from index.js onInstalled (reason=update) and onStartup before reclaimWorkspaces()
- deleteWorkspaceFromSync() must be called from deleteWorkspace() in workspaces.js after saveWorkspaces() succeeds

## Known Stubs

None — sync.js is a pure storage abstraction with no UI or data-source stubs.

## Self-Check: PASSED

- `src/background/sync.js` — FOUND
- `.planning/phases/04-firefox-sync/04-01-SUMMARY.md` — FOUND
- Commit `e39b5d9` — FOUND

---
*Phase: 04-firefox-sync*
*Completed: 2026-03-21*
