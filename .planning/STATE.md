---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Hardening & Tab Movement
status: Milestone complete
stopped_at: Completed 07-02-PLAN.md
last_updated: "2026-03-24T16:08:54.497Z"
last_activity: 2026-03-24
progress:
  total_phases: 3
  completed_phases: 3
  total_plans: 5
  completed_plans: 5
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-23)

**Core value:** Workspaces reliably preserve and restore tab groups without losing data — even across windows, restarts, and reinstalls.
**Current focus:** Phase 07 — new-window-opening

## Current Position

Phase: 07
Plan: Not started

## Performance Metrics

**By Phase:**

| Phase | Duration | Tasks | Files |
|-------|----------|-------|-------|
| Phase 01-mv3-and-security P01 | 1 | 1 tasks | 7 files |
| Phase 01-mv3-and-security P02 | 1 | 3 tasks | 3 files |
| Phase 02-data-integrity P01 | 2 | 1 tasks | 2 files |
| Phase 02-data-integrity P02 | 1 | 1 tasks | 1 files |
| Phase 03-multi-window-tracking P01 | 4 | 2 tasks | 4 files |
| Phase 03-multi-window-tracking P02 | 5 | 2 tasks | 2 files |
| Phase 04-firefox-sync P01 | 2min | 1 tasks | 1 files |
| Phase 04-firefox-sync P02 | 3min | 3 tasks | 3 files |
| Phase 05 P01 | 2 | 2 tasks | 4 files |
| Phase 06 P01 | 94s | 2 tasks | 2 files |
| Phase 06-context-menu P02 | 30 | 3 tasks | 4 files |
| Phase 07 P01 | 1 | 1 tasks | 2 files |
| Phase 07 P02 | 15min | 3 tasks | 3 files |

## Accumulated Context

### Decisions

All decisions logged in PROJECT.md Key Decisions table.

- [Phase 05]: Move throttledSave to workspaces.js — functions live in the module that owns their primary dependency (saveCurrentWorkspace)
- [Phase 05]: Move validateWorkspaceData to sync.js — validation belongs at the storage boundary that reads data, not in the CRUD module
- [Phase 06]: Cross-window source update: re-query window tabs after browser.tabs.move() rather than URL filtering to avoid duplicate URL collisions
- [Phase 06]: Same-window source update: URL-based Set filtering since tab IDs may not be stable after switchWorkspace
- [Phase 06]: Sort pinned tabs first before browser.tabs.move() to prevent Firefox silent move failures
- [Phase 06]: Place menus.create() for parent item inside onInstalled (not top-level) — MV3 event page requires persistent items in onInstalled
- [Phase 06]: Same-window source cleanup after switchWorkspace: URL Set filter to remove re-serialized moved tabs from source workspace
- [Phase 07]: openWorkspaceInNewWindow exclusive ownership check omits caller window exclusion — any window owning the target is focused, since the caller always intends a new window
- [Phase 07]: Rollback on partial tab creation failure closes the new window entirely via browser.windows.remove()
- [Phase 07]: Ctrl+click uses e.preventDefault() to suppress macOS system context menu before routing to onOpenInNewWindow
- [Phase 07]: auxclick handler uses e.button !== 1 guard to safely no-op right-click; onOpenInNewWindow closes popup unconditionally without checking background response

### Pending Todos

None.

### Blockers/Concerns

None. Phase 5 must complete before Phase 6 or Phase 7 begin — circular dependency and validation gap must be resolved before new code touches those modules.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260321-oyr | Fix edit/new workspace modal cutoff in popup | 2026-03-21 | 6a250dd | [260321-oyr-the-edit-workspace-popup-and-new-workspa](./quick/260321-oyr-the-edit-workspace-popup-and-new-workspa/) |

## Session Continuity

Last activity: 2026-03-24
Stopped at: Completed 07-02-PLAN.md
Resume file: None
