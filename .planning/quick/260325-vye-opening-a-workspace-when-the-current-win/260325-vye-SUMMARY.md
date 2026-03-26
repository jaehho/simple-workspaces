---
phase: quick
plan: 260325-vye
subsystem: workspace-open
tags: [ux, window-management, tab-operations]
dependency_graph:
  requires: []
  provides: [openWorkspaceInCurrentWindow]
  affects: [src/background/workspaces.js, src/background/messaging.js, src/popup/popup.js]
tech_stack:
  added: []
  patterns: [empty-window-detection, smart-routing]
key_files:
  created: []
  modified:
    - src/background/workspaces.js
    - src/background/messaging.js
    - src/popup/popup.js
decisions:
  - "Detect empty-new-tab window in popup at renderList() time so isEmptyNewTabWindow is available for both subtitle text and click handlers"
  - "Atomicity rollback in openWorkspaceInCurrentWindow removes only created tabs (no new window to close unlike openWorkspaceInNewWindow)"
metrics:
  duration: "~5min"
  completed_date: "2026-03-26"
---

# Quick Task 260325-vye: Opening a workspace when the current window is just a new tab

**One-liner:** Smart workspace opening that reuses the current window when it contains only a blank about:newtab, avoiding orphaned empty windows.

## What Was Built

When a user opens Firefox to a fresh new window (single about:newtab, no workspace assigned) and clicks a workspace in the popup, the workspace now opens in that same window rather than spawning a separate new window. Multi-tab unassigned windows and all normal switching paths are unchanged.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add openWorkspaceInCurrentWindow to background | ca0dd23 | src/background/workspaces.js, src/background/messaging.js |
| 2 | Update popup to detect empty-window and route accordingly | 28d39a7 | src/popup/popup.js |
| 3 | Verify workspace opening behavior in Firefox | PENDING CHECKPOINT | — |

## Implementation Details

### openWorkspaceInCurrentWindow (workspaces.js)

New exported async function that acts as a hybrid of `openWorkspaceInNewWindow` (no current workspace to save) and `switchWorkspace` (reuses the current window):

1. Sets `isSwitching: true` via `setSessionState`
2. Loads workspaces, validates targetId exists
3. Performs exclusive ownership check — rejects if targetId is active in another window
4. Queries old tabs before creating new ones
5. Creates target workspace tabs in the current window with discarded fallback
6. Atomicity check: if not all tabs created, removes created tabs and returns error
7. Removes old tabs (the about:newtab)
8. Updates `lastUsedAt`, saves workspaces, sets window entry, updates badge
9. `finally` sets `isSwitching: false`

### Empty-window detection (popup.js)

At `renderList()` scope, after getting state:
- Queries current window's tabs via `browser.tabs.query({ windowId: currentWindowId })`
- `isEmptyNewTabWindow = activeWorkspaceId === null && currentTabs.length === 1 && (!currentTabs[0].url || currentTabs[0].url === 'about:newtab')`

### Subtitle text update

- Assigned window: `'Ctrl+click to open in new window'`
- Unassigned + empty new-tab: `'Click to switch'`
- Unassigned + multi-tab: `'Click to open in new window'`

### Click handler routing

The `activeWorkspaceId === null` branch now checks `isEmptyNewTabWindow`:
- True: calls `onOpenInCurrentWindow(ws.id)` — sends `openWorkspaceInCurrentWindow` message
- False: calls `onOpenInNewWindow(ws.id)` — existing behavior unchanged

Keyboard Enter navigation naturally routes through the same click handler, no separate change needed.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Verification

- `npx eslint src/background/workspaces.js src/background/messaging.js src/popup/popup.js` passes
- Task 3 (human verification in Firefox) is pending at checkpoint

## Self-Check: PASSED

Files modified exist:
- src/background/workspaces.js: FOUND
- src/background/messaging.js: FOUND
- src/popup/popup.js: FOUND

Commits verified:
- ca0dd23: feat(quick-260325-vye): add openWorkspaceInCurrentWindow to background
- 28d39a7: feat(quick-260325-vye): detect empty new-tab window and reuse it for workspace open
