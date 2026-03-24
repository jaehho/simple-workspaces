---
phase: quick
plan: 260324-kqf
subsystem: background
tags: [keyboard-shortcuts, commands, workspace-cycling]
dependency_graph:
  requires: []
  provides: [keyboard-shortcut-workspace-cycling]
  affects: [src/manifest.json, src/background/index.js, src/background/workspaces.js]
tech_stack:
  added: []
  patterns: [browser.commands.onCommand, modular-arithmetic-wrap-around, exclusive-window-ownership]
key_files:
  created: []
  modified:
    - src/manifest.json
    - src/background/index.js
    - src/background/workspaces.js
decisions:
  - "Used browser.windows.getLastFocused() to determine the target window since commands fire in the background context without a sender window"
  - "Placed onCommand listener at top-level (synchronously) to ensure Firefox event page wakes on keyboard shortcut"
  - "switchToAdjacentWorkspace skips workspaces active in other windows to preserve exclusive window ownership invariant"
metrics:
  duration: "< 5min"
  completed: "2026-03-24"
  tasks_completed: 1
  files_modified: 3
---

# Quick Task 260324-kqf: Add Keyboard Shortcuts for Switching Workspaces — Summary

**One-liner:** Alt+Shift+Left/Right keyboard shortcuts cycle through workspaces with wrap-around and exclusive window ownership enforcement.

## What Was Built

Two manifest-declared keyboard commands (`next-workspace` / `previous-workspace`) that trigger a background listener which calls a new `switchToAdjacentWorkspace(direction, windowId)` helper. The helper walks the workspace list in the given direction with wrap-around, skips workspaces active in other windows, and delegates to the existing `switchWorkspace` for the actual tab operations.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Declare commands in manifest, add onCommand listener, add switchToAdjacentWorkspace | 0a2b92d | src/manifest.json, src/background/index.js, src/background/workspaces.js |

## Key Decisions

1. **`browser.windows.getLastFocused()`** — Commands fire in the background context without a sender window; `getLastFocused()` reliably identifies the window the user is interacting with.
2. **Top-level listener** — `browser.commands.onCommand.addListener` is registered synchronously at module scope (same as all other listeners) so Firefox's event page wakes up when the shortcut is pressed.
3. **Exclusive ownership preserved** — `switchToAdjacentWorkspace` reads the window map and builds a `busyIds` set of workspaces active in other windows, skipping them during the directional walk. This matches the invariant enforced in `switchWorkspace`.
4. **Modular arithmetic** — `((currentIdx + direction * step) % len + len) % len` correctly handles negative wrap-around for the previous-workspace direction.

## Implementation Details

**`src/manifest.json`** — Added top-level `"commands"` block after the `"action"` block:
- `"next-workspace"`: `Alt+Shift+Right`
- `"previous-workspace"`: `Alt+Shift+Left`

**`src/background/workspaces.js`** — Added and exported `switchToAdjacentWorkspace(direction, windowId)` between `switchWorkspace` and `moveTabsToWorkspace`. Reuses existing `switchWorkspace` for actual switch logic.

**`src/background/index.js`** — Added `switchToAdjacentWorkspace` to the existing workspaces import and registered a new `browser.commands.onCommand` listener section between Context Menu Listeners and Message Handler.

## Verification

- ESLint passes (0 errors, 1 expected warning for manifest.json having no JS lint config)
- Extension loads without errors
- Human verification pending (see checkpoint)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- src/manifest.json contains "commands" key: FOUND
- src/background/workspaces.js exports switchToAdjacentWorkspace: FOUND
- src/background/index.js has browser.commands.onCommand listener: FOUND
- Commit 0a2b92d: FOUND
