---
phase: 03-multi-window-tracking
plan: 02
subsystem: popup
tags: [firefox-extension, popup, multi-window, window-map, in-use-indicator, assign-here, webextensions]

# Dependency graph
requires:
  - phase: 03-multi-window-tracking
    plan: 01
    provides: "windowMap in getState response, focusWindow/assignWorkspace message actions, per-window activeWorkspaceId"
provides:
  - "popup acquires currentWindowId from browser.tabs.query at startup"
  - "windowId included in all popup->background messages (getState, switch, create, update, delete, assign)"
  - "workspace-item--in-use class modifier with dual-window SVG icon indicator"
  - "onFocusWindow — sends focusWindow action and calls window.close() (WIN-03)"
  - "onAssign — sends assignWorkspace action to assign unassigned window to workspace (D-09)"
  - "ws-unassigned-banner shown above list when activeWorkspaceId is null (D-08)"
  - "Assign Here buttons on available workspaces when window is unassigned"
  - "CSS: banner, in-use icon, assign button, unassigned list opacity styles"
affects:
  - "03 human-verify checkpoint — end-to-end multi-window testing required"
  - "04-storage-sync — popup message shapes finalized here"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "currentWindowId acquired via browser.tabs.query({ active: true, currentWindow: true }) before first message"
    - "workspaceWindowMap reverse lookup: iterate windowMap entries to map wsId->windowId"
    - "isInUse detection: !isActive && workspaceWindowMap[ws.id] !== undefined && !== currentWindowId"
    - "unassigned banner inserted via list.parentNode.insertBefore(banner, list)"
    - "workspace-list--unassigned class on <ul> reveals assign buttons via CSS opacity"

key-files:
  created: []
  modified:
    - src/popup/popup.js
    - src/popup/popup.css

key-decisions:
  - "currentWindowId uses browser.tabs.query (currentWindow: true) in popup context — correct because popup is opened in popup's window, this flag refers to popup's window"
  - "assignWorkspace subtext says 'Click a workspace to assign' even though dedicated Assign Here buttons exist — both interactions work (clicking row in unassigned window sends assignWorkspace action)"
  - "onFocusWindow closes popup immediately after sending message, no wait for response — window.close() is best-effort and non-destructive"

patterns-established:
  - "All popup messages now include windowId: currentWindowId — consistent with background API contract"
  - "Banner removal before re-render guards against duplicate banners (remove .ws-unassigned-banner before inserting new one)"

requirements-completed: [WIN-02, WIN-03]

# Metrics
duration: 2min
completed: 2026-03-21
---

# Phase 3 Plan 2: Window-Aware Popup UI Summary

**popup.js acquires windowId at startup and passes it in every message; workspaces active in other windows show a dual-window icon indicator; clicking in-use workspace focuses that window; unassigned windows show a banner with "Assign Here" inline buttons; all CSS tokens match UI-SPEC**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-21T11:03:13Z
- **Completed:** 2026-03-21T11:05:15Z
- **Tasks:** 1 of 2 (1 code, 1 human-verify checkpoint)
- **Files modified:** 2

## Accomplishments

- `popup.js` acquires `currentWindowId` from `browser.tabs.query({ active: true, currentWindow: true })` before any messages
- All 6 message types (getState, switchWorkspace, createWorkspace, updateWorkspace, deleteWorkspace, assignWorkspace) now include `windowId: currentWindowId`
- `renderList` builds `workspaceWindowMap` reverse lookup from `windowMap` response and drives `isInUse` / `isActive` per-item state
- In-use workspaces show a 12x12 dual-window SVG icon (`ws-in-use-icon`) with tooltip "Active in another window"
- `onFocusWindow(targetWindowId)` sends `focusWindow` action and calls `window.close()` — clicking in-use workspace focuses its owner window
- Unassigned window: `ws-unassigned-banner` inserted above the list with heading "No workspace assigned" and subtext "Click a workspace to assign this window, or create a new one."
- `onAssign(workspaceId)` sends `assignWorkspace` action; Assign Here buttons appear only for non-in-use workspaces in unassigned windows
- CSS: banner styles (`#252536` bg, `1px solid #2e2e3e` border), in-use icon color (`#6c7086`), assign button accent (`#89b4fa`), `.workspace-list--unassigned .ws-actions { opacity: 1 }`

## Task Commits

1. **Task 1: Make popup.js window-aware with in-use indicators, unassigned banner, and assign action** - `a952d8e` (feat)

## Files Created/Modified

- `src/popup/popup.js` — Window-aware popup: currentWindowId, renderList with windowMap/workspaceWindowMap, in-use icon, onFocusWindow, onAssign, unassigned banner, all messages include windowId
- `src/popup/popup.css` — New sections: unassigned banner, in-use indicator, assign button, unassigned list opacity reveal

## Decisions Made

- **currentWindowId via browser.tabs.query:** Used `currentWindow: true` in popup context — this refers to popup's window (the Firefox window containing the popup). This is the HIGH confidence approach from RESEARCH.md Pattern 1.
- **Popup closes immediately in onFocusWindow:** `window.close()` called after sending the message without awaiting a response — non-destructive and the correct UX (user sees the other window come to front, popup gone).
- **Banner insertion:** `list.parentNode.insertBefore(banner, list)` places banner above list. Banner removed at top of each `renderList` call to prevent duplicates.

## Deviations from Plan

None — plan executed exactly as written. All 14 popup.js changes and 4 CSS additions match the plan's action specification.

## Known Stubs

None — all data flows are wired. `windowMap` comes from the background's `getState` response (implemented in Plan 01). `focusWindow` and `assignWorkspace` message actions are handled in `messaging.js` (implemented in Plan 01). No hardcoded values, no placeholder data.

## Checkpoint Required

Task 2 is a `checkpoint:human-verify` gate requiring end-to-end testing in Firefox with multiple windows. The human tester must verify all 8 multi-window scenarios (per-window badge, workspace isolation, in-use indicator, focus window, unassigned window, exclusive ownership, window close releases workspace, browser restart reclaim).

---
*Phase: 03-multi-window-tracking*
*Completed: 2026-03-21*
