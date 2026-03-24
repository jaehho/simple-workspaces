---
phase: quick
plan: 260324-kqf
subsystem: manifest
tags: [keyboard-shortcut, popup, manifest]
dependency_graph:
  requires: []
  provides: [keyboard-popup-shortcut]
  affects: [src/manifest.json]
tech_stack:
  added: []
  patterns: [firefox-special-command]
key_files:
  created: []
  modified:
    - src/manifest.json
decisions:
  - "Use _execute_action (MV3 special command) over custom command + JS handler: zero code, native Firefox support"
  - "Alt+Shift+W chosen as default: avoids common browser conflicts while being mnemonic (W for Workspaces)"
metrics:
  duration: "~5min"
  completed: "2026-03-24"
  tasks_completed: 1
  files_modified: 1
---

# Quick Task 260324-kqf: Add Keyboard Shortcut to Open Workspace Popup — Summary

**One-liner:** Single `_execute_action` manifest command with `Alt+Shift+W` opens the popup via Firefox's native special command mechanism — no JS code required.

## What Was Built

A `commands` section was added to `src/manifest.json` with the special Firefox MV3 command name `_execute_action`. Firefox recognises this reserved name and automatically opens the extension's browser action popup when the shortcut is pressed. No `browser.commands.onCommand` listener or background JS is needed.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Add `_execute_action` command with Alt+Shift+W default to manifest | adc88f1 | src/manifest.json |

## Key Decisions

1. **`_execute_action` special command** — Firefox MV3 reserves this command name to trigger the browser action popup natively. No JS listener needed, no risk of timing issues or background script wake failures.
2. **Alt+Shift+W default** — `Ctrl+Shift+W` closes all tabs (too dangerous as a default), `Alt+W` can conflict with app menus. `Alt+Shift+W` is mnemonic and unlikely to conflict with OS or browser shortcuts. Users can remap it in `about:addons` → Manage Extension Shortcuts.

## Implementation Details

**`src/manifest.json`** — Added `"commands"` block after the `"icons"` block:
- `"_execute_action"`: `Alt+Shift+W`, description "Open Simple Workspaces popup"

No changes to background scripts or popup scripts.

## Deviations from Plan

The original checkpoint implementation had added next-workspace and previous-workspace cycle commands plus a `switchToAdjacentWorkspace` function in `workspaces.js` and a `browser.commands.onCommand` listener in `index.js`. Per user feedback at the checkpoint, those were not the desired approach.

Those changes had not been committed (checkpoint was reached before commit), so no revert was needed — the JS files were already in a clean state. Only the manifest required a new change.

## Known Stubs

None.

## Self-Check: PASSED

- `src/manifest.json` contains `_execute_action` command: FOUND
- Commit `adc88f1` exists: confirmed (`git log --oneline` shows it)
- `npm run lint` (web-ext + eslint): 0 errors, 0 warnings, 0 notices
- No JS files modified (background/index.js and background/workspaces.js unchanged)
