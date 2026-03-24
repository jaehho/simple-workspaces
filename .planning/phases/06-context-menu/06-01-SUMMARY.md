---
phase: 06-context-menu
plan: 01
subsystem: background
tags: [move-tabs, mru-tracking, cross-window, atomic, sync-storage]
dependency_graph:
  requires: []
  provides: [moveTabsToWorkspace, lastUsedAt]
  affects: [src/background/workspaces.js, src/background/sync.js]
tech_stack:
  added: []
  patterns: [atomic-rollback, isSwitching-guard, pinned-tab-sort, MRU-timestamp]
key_files:
  created: []
  modified:
    - src/background/workspaces.js
    - src/background/sync.js
decisions:
  - "Remove from source by re-querying window tabs after browser.tabs.move() (cross-window path) rather than URL-based filtering to avoid duplicate URL collisions"
  - "Remove from source by URL-based Set filtering (same-window path) since tab IDs may not be stable after switchWorkspace"
  - "Sort pinned tabs first before browser.tabs.move() to prevent silent move failures (Firefox requires pinned order)"
metrics:
  duration: 94s
  completed: 2026-03-24
  tasks_completed: 2
  files_modified: 2
---

# Phase 6 Plan 01: Move Tabs Foundation Summary

**One-liner:** `moveTabsToWorkspace()` with cross-window `browser.tabs.move()`, same-window save+switch, atomic rollback, pinned-first sorting, and `lastUsedAt` MRU timestamps persisted through sync serialization round-trip.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Add lastUsedAt field to sync serialization and switchWorkspace | 637a1ee | src/background/sync.js, src/background/workspaces.js |
| 2 | Implement moveTabsToWorkspace() in workspaces.js | 72aae34 | src/background/workspaces.js |

## What Was Built

### Task 1: lastUsedAt MRU field

- `serializeToSyncItems()` in `sync.js`: added `lastUsedAt: ws.lastUsedAt || 0` to workspace metadata object stored under each `ws:{id}` key
- `assembleFromSync()` in `sync.js`: added `lastUsedAt: meta.lastUsedAt || 0` when reconstructing workspace objects from sync data
- `switchWorkspace()` in `workspaces.js`: added `target.lastUsedAt = Date.now()` just before `saveWorkspaces()` so every workspace switch records the timestamp
- `createWorkspace()` and `initDefaultWorkspace()` in `workspaces.js`: both include `lastUsedAt: Date.now()` in the new workspace object literal

### Task 2: moveTabsToWorkspace()

The function handles two distinct paths:

**Cross-window (target is active in another window):**
1. Set `isSwitching: true` to prevent `throttledSave` interference
2. Snapshot workspaces for rollback
3. Sort tabs with pinned first (Firefox silent failure prevention)
4. Call `browser.tabs.move()` to physically move tabs without reload (D-05)
5. Re-query source window tabs for accurate remaining list (avoids URL duplicate issues)
6. Re-query target window tabs for accurate new list
7. Set `targetWs.lastUsedAt = Date.now()`
8. Save workspaces, update badge on source window
9. Focus target window (D-02/D-03)

**Same-window (target is inactive):**
1. Set `isSwitching: true`
2. Snapshot workspaces for rollback
3. Serialize moved tabs, append to `targetWs.tabs`
4. Remove moved URLs from `sourceWs.tabs` via Set filter
5. Set `targetWs.lastUsedAt = Date.now()`
6. Save workspaces, call `switchWorkspace()` to display target

**Shared:** `finally` block always resets `isSwitching: false`; catch block restores snapshot via `saveWorkspaces(snapWorkspaces)` (D-09 atomic rollback).

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all data flows are wired. `moveTabsToWorkspace()` is a complete implementation ready for consumption by Plan 02 (context menu UI).

## Self-Check: PASSED

Files verified:
- `src/background/sync.js` — contains `lastUsedAt: ws.lastUsedAt || 0` (line 164) and `lastUsedAt: meta.lastUsedAt || 0` (line 197)
- `src/background/workspaces.js` — contains `export async function moveTabsToWorkspace` (line 218), `target.lastUsedAt = Date.now()` in switchWorkspace, `lastUsedAt: Date.now()` in createWorkspace and initDefaultWorkspace
- ESLint: 0 errors on both files
- web-ext lint: 0 errors, 0 warnings, 0 notices
- Commits 637a1ee and 72aae34 verified in git log
