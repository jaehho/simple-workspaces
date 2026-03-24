---
status: partial
phase: 06-context-menu
source: [06-VERIFICATION.md]
started: 2026-03-24T00:00:00Z
updated: 2026-03-24T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Basic single-tab move (MENU-01, MENU-02)
expected: Right-click tab shows "Move to Workspace" submenu with "{name} ({n} tabs)" format; clicking moves the tab
result: [pending]

### 2. Multi-tab selection (MENU-04)
expected: Ctrl+click tabs then right-click moves ALL highlighted tabs together
result: [pending]

### 3. Cross-window move (D-02, D-05)
expected: Tab moves to other window without reload; [open] suffix shown; target window focused
result: [pending]

### 4. Dynamic updates (MENU-03)
expected: Submenu reflects workspace create/rename/delete without extension restart
result: [pending]

### 5. MRU ordering (D-12)
expected: Most recently used workspace appears first in submenu
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
