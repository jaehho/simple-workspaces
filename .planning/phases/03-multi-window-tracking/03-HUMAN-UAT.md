---
status: partial
phase: 03-multi-window-tracking
source: [03-VERIFICATION.md]
started: 2026-03-21
updated: 2026-03-21
---

## Current Test

[awaiting human testing]

## Tests

### 1. Per-window badge display
expected: Each browser window shows different workspace initials/color on the extension badge
result: [pending]

### 2. In-use indicator visibility
expected: Workspaces assigned to other windows show a dual-window SVG icon with tooltip "Active in another window"
result: [pending]

### 3. Focus window behavior (WIN-03)
expected: Clicking an in-use workspace focuses the owning window (note: Hyprland/Wayland WM may handle focus differently)
result: [pending]

### 4. Browser restart reclaim (D-10)
expected: After closing and reopening browser, windows reclaim previous workspaces by tab URL matching (untestable with web-ext run)
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
