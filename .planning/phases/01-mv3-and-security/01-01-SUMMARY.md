---
phase: 01-mv3-and-security
plan: 01
subsystem: infra
tags: [manifest-v3, es-modules, storage-session, firefox-extension, web-ext]

# Dependency graph
requires: []
provides:
  - MV3-compliant manifest with action key, module background, no unlimitedStorage
  - Background split into ES modules: index.js, state.js, workspaces.js, messaging.js
  - storage.session throttle replaces setTimeout debounce for save reliability
  - isSwitching lock persisted to storage.session (survives background unloads)
  - browser.action replaces browser.browserAction (MV3 API)
  - ESLint configured for both script (popup) and module (background) source types
affects: [02-mv3-and-security, 03-mv3-and-security, Phase 2, Phase 3, Phase 4]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "storage.session structured state for cross-unload persistence (D-01 through D-04)"
    - "throttle-over-debounce: save immediately on first tab event, suppress for 500ms"
    - "ES module background with synchronous top-level listener registration"
    - "import/export across background modules: state.js <- workspaces.js -> messaging.js -> index.js"

key-files:
  created:
    - src/background/index.js
    - src/background/state.js
    - src/background/workspaces.js
    - src/background/messaging.js
  modified:
    - src/manifest.json
    - eslint.config.js
  deleted:
    - src/background.js

key-decisions:
  - "D-01/D-04: Throttle replaces debounce — save immediately, suppress 500ms — eliminates dropped saves on MV3 background unload"
  - "D-02/D-03: isSwitching and lastSaveTime persisted as structured object in storage.session"
  - "D-05: manifest_version 3, browser.action replaces browser.browserAction"
  - "D-06: unlimitedStorage permission dropped — not needed, cleaner for AMO review"
  - "D-08: background.js split into 4 ES modules with clean responsibility boundaries"
  - "D-13: Extension ID simple-workspaces@jaehho preserved through MV3 migration (SEC-05)"

patterns-established:
  - "Pattern: All event listeners registered synchronously at top level of index.js — no await before addListener"
  - "Pattern: storage.session getSessionState/setSessionState for any cross-unload state"
  - "Pattern: throttledSave() instead of debouncedSave() for tab events"

requirements-completed: [SEC-01, SEC-05]

# Metrics
duration: 1min
completed: 2026-03-21
---

# Phase 01 Plan 01: MV3 Migration and Background Module Split Summary

**MV3 manifest with module background, storage.session throttle replacing setTimeout debounce, and background.js split into four ES modules (index.js, state.js, workspaces.js, messaging.js)**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-03-21T09:14:05Z
- **Completed:** 2026-03-21T09:15:59Z
- **Tasks:** 1
- **Files modified:** 7 (6 created/modified + 1 deleted)

## Accomplishments
- Migrated manifest from V2 to V3: `manifest_version: 3`, `action` replaces `browser_action`, `type: module` in background, `unlimitedStorage` removed
- Split monolithic `src/background.js` into four ES modules with clean responsibility boundaries
- Replaced fragile `setTimeout` debounce with `storage.session` throttle pattern — first tab event saves immediately, subsequent events suppressed for 500ms, no dropped saves on background unload
- Migrated `isSwitching` in-memory flag to `storage.session` structured state so it survives mid-switch background unloads
- Updated ESLint config for dual sourceType: `script` for popup files, `module` for background files
- `web-ext lint` and `eslint src/` both pass with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate manifest to V3 and create background module skeleton** - `a0ae1ab` (feat)

**Plan metadata:** (final commit hash — created after SUMMARY)

## Files Created/Modified
- `src/manifest.json` - MV3 manifest: action, module background, no unlimitedStorage, ID preserved
- `src/background/index.js` - Entry point with synchronous top-level listener registration
- `src/background/state.js` - storage.session helpers: getSessionState, setSessionState, throttledSave
- `src/background/workspaces.js` - All workspace CRUD ops + badge update, exports for messaging consumption
- `src/background/messaging.js` - Message router with sender validation placeholder (SEC-03 in plan 02)
- `eslint.config.js` - Dual config: script for popup, module for background
- `src/background.js` - DELETED (replaced by src/background/ modules)

## Decisions Made
- D-01/D-04: Throttle with 500ms suppression window (vs 400ms debounce) — saves on first event, not after delay
- D-02/D-03: `{ isSwitching: bool, lastSaveTime: number }` structured object in storage.session
- D-06: Dropped `unlimitedStorage` — not needed for Phase 1-3 scope, cleaner AMO profile
- D-08: Module split boundaries follow responsibility: state management, workspace operations, messaging, entry

## Deviations from Plan

None - plan executed exactly as written. The `void sender` line added in messaging.js to suppress the ESLint unused-vars warning for the placeholder `sender` parameter is a minor stylistic addition; the parameter is intentionally kept for Plan 02's SEC-03 implementation.

## Issues Encountered

None — all verification checks (web-ext lint, eslint, grep checks) passed on the first attempt.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- MV3 foundation complete — Plan 02 can add sender validation (SEC-03) and color validation (SEC-04) on top of this module structure
- Plan 02 messaging.js already has the TODO marker and `sender` parameter wired for SEC-03 implementation
- ESLint module config in place — all future background modules will be linted as ES modules automatically
- No blockers

---
*Phase: 01-mv3-and-security*
*Completed: 2026-03-21*
