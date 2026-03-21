---
phase: 03-multi-window-tracking
verified: 2026-03-21T12:00:00Z
status: human_needed
score: 10/10 must-haves verified
human_verification:
  - test: "Per-window badge shows workspace initial or '?' in two open Firefox windows"
    expected: "Window A shows badge 'D' (Default), Window B shows '?' before assignment"
    why_human: "Firefox badge rendering cannot be verified via static analysis"
  - test: "In-use indicator icon appears on workspaces active in other windows"
    expected: "12x12 dual-window SVG icon visible next to workspace name with tooltip 'Active in another window'"
    why_human: "SVG rendering and tooltip display require browser UI inspection"
  - test: "Clicking in-use workspace focuses owning window and closes popup (WIN-03)"
    expected: "Window B comes to focus, popup closes"
    why_human: "Focus behavior is window-manager-dependent (noted in SUMMARY as Hyprland/Wayland limitation)"
  - test: "Browser restart reclaim via URL matching (D-10)"
    expected: "After restart, windows re-acquire their previous workspaces if >= 50% of URLs match"
    why_human: "Cannot simulate browser restart in web-ext run dev workflow"
---

# Phase 3: Multi-Window Tracking Verification Report

**Phase Goal:** Multi-window tracking — each browser window gets its own active workspace, with visual indicators and window lifecycle management
**Verified:** 2026-03-21T12:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Window-workspace map stored in storage.session survives background unloads | VERIFIED | `state.js:8` declares `WINDOW_MAP_KEY = 'windowMap'`; all CRUD helpers use `browser.storage.session.get/set` |
| 2 | saveCurrentWorkspace accepts explicit windowId and queries only that window's tabs | VERIFIED | `workspaces.js:79` signature `saveCurrentWorkspace(windowId)`; line 92 uses `browser.tabs.query({ windowId })` |
| 3 | switchWorkspace accepts windowId, enforces exclusive ownership, updates windowMap | VERIFIED | `workspaces.js:110` signature `switchWorkspace(targetId, windowId)`; lines 124-128 ownership check; line 208 `setWindowEntry(windowId, targetId)` |
| 4 | updateBadge accepts windowId and sets per-window badge text and color | VERIFIED | `workspaces.js:390` signature `updateBadge(workspace, windowId)`; line 391 spreads `{ windowId }` into both setBadgeText and setBadgeBackgroundColor calls |
| 5 | Tab event listeners pass windowId from event context to throttledSave | VERIFIED | `index.js:10-21` — all 6 tab events pass `tab.windowId`, `removeInfo.windowId`, `moveInfo.windowId`, `attachInfo.newWindowId`, `detachInfo.oldWindowId` |
| 6 | windows.onFocusChanged filters WINDOW_ID_NONE before any processing | VERIFIED | `index.js:29` guard `if (windowId === browser.windows.WINDOW_ID_NONE) return` is the first statement |
| 7 | windows.onRemoved releases workspace by deleting windowMap entry | VERIFIED | `index.js:24-26` listener calls `removeWindowEntry(windowId)` which deletes `map[String(windowId)]` |
| 8 | Browser restart triggers reclaimWorkspaces via runtime.onStartup | VERIFIED | `index.js:53-62` onStartup calls `reclaimWorkspaces()` when workspaces exist; `workspaces.js:348-386` implements URL-intersection scoring at `RECLAIM_THRESHOLD = 0.5` |
| 9 | getState message returns windowMap and per-window activeWorkspaceId | VERIFIED | `messaging.js:22-34` getState case returns `{ workspaces, windowMap, currentWindowId, activeWorkspaceId: windowMap[String(msg.windowId)] \|\| null }` |
| 10 | New message actions: focusWindow, assignWorkspace routed in messaging.js | VERIFIED | `messaging.js:47-58` cases for both `focusWindow` and `assignWorkspace` |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/background/state.js` | Window map CRUD helpers and window-aware throttledSave | VERIFIED | Exports `getWindowMap`, `setWindowEntry`, `removeWindowEntry`, `throttledSave(windowId)` — 59 lines, substantive implementation |
| `src/background/workspaces.js` | Window-scoped save, switch, badge, assign, reclaim functions | VERIFIED | All functions accept explicit windowId; `assignWorkspace` and `reclaimWorkspaces` exported — 421 lines |
| `src/background/messaging.js` | Window-aware message routing with focusWindow and assignWorkspace | VERIFIED | Contains `case 'focusWindow':` and `case 'assignWorkspace':` — fully substantive |
| `src/background/index.js` | Window lifecycle listeners and windowId-aware tab event listeners | VERIFIED | Contains `windows.onFocusChanged`, `windows.onRemoved`, all tab events pass windowId |
| `src/popup/popup.js` | Window-aware popup rendering with in-use indicators and assign action | VERIFIED | Contains `currentWindowId`, `windowMap`, `onFocusWindow`, `onAssign`, `ws-unassigned-banner`, `ws-in-use-icon` — 339 lines |
| `src/popup/popup.css` | Styles for unassigned banner, in-use indicator, assign button | VERIFIED | Contains `.ws-unassigned-banner`, `.ws-in-use-icon`, `.ws-actions button.assign`, `.workspace-list--unassigned .ws-actions` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `state.js` | `browser.storage.session` | `getWindowMap/setWindowEntry/removeWindowEntry` | WIRED | `storage.session.get/set` present in all three helpers at lines 25, 32, 38 |
| `index.js` | `state.js` | `throttledSave(windowId)` in tab event listeners | WIRED | All 6 tab listeners call `throttledSave(tab.windowId)` or equivalent; import at line 5 |
| `workspaces.js` | `state.js` | imports `getWindowMap`, `setWindowEntry` | WIRED | `import { getSessionState, setSessionState, getWindowMap, setWindowEntry } from './state.js'` at line 3 |
| `messaging.js` | `workspaces.js` | imports `assignWorkspace` | WIRED | `import { ..., assignWorkspace, ... } from './workspaces.js'` at line 3 |
| `popup.js` | `messaging.js` | `sendMessage` with `windowId` in every action | WIRED | All 6 action calls include `windowId: currentWindowId`; verified at lines 205, 220, 225, 241, 282, 289 |
| `popup.js` | `messaging.js` | `focusWindow` action for in-use workspace click | WIRED | `onFocusWindow` sends `{ action: 'focusWindow', targetWindowId }` at line 213 |
| `popup.js` | `messaging.js` | `assignWorkspace` action for Assign Here button | WIRED | `onAssign` sends `{ action: 'assignWorkspace', workspaceId, windowId: currentWindowId }` at line 220 |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| WIN-01 | 03-01 | Each window tracks its own active workspace independently via windowId→workspaceId mapping | SATISFIED | `storage.session` windowMap in `state.js`; `switchWorkspace` updates map via `setWindowEntry`; `saveCurrentWorkspace` reads map to find workspace |
| WIN-02 | 03-02 | Popup shows which workspaces are active in other windows | SATISFIED | `popup.js:88` builds `workspaceWindowMap` reverse lookup; `isInUse` detection at line 88; `ws-in-use-icon` span with tooltip rendered at lines 114-128 |
| WIN-03 | 03-02 | User can switch to the window that owns a workspace (or close it) from the popup | SATISFIED | `popup.js:175-177` click handler calls `onFocusWindow(owningWindowId)` for in-use items; `onFocusWindow` sends `focusWindow` action and calls `window.close()` |
| WIN-04 | 03-01 | Tab queries use explicit windowId from event context instead of currentWindow: true | SATISFIED | `grep -rn 'currentWindow: true' src/background/` returns no matches; all tab queries use `{ windowId }` parameter |
| WIN-05 | 03-01 | windows.onFocusChanged handler filters out WINDOW_ID_NONE events | SATISFIED | `index.js:29` first statement in handler: `if (windowId === browser.windows.WINDOW_ID_NONE) return` |
| WIN-06 | 03-01 | Per-window badge text shows each window's active workspace initial | SATISFIED | `updateBadge(workspace, windowId)` uses `{ windowId }` spread in `setBadgeText`/`setBadgeBackgroundColor`; badge init IIFE iterates all open windows |

All 6 required IDs (WIN-01 through WIN-06) are accounted for across plans 03-01 and 03-02. No orphaned requirements found in REQUIREMENTS.md for Phase 3.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `popup.js` | 177-178 | Row click in unassigned window calls `onSwitch` (sends `switchWorkspace`), not `onAssign` — SUMMARY incorrectly claims "clicking row sends assignWorkspace" | Info | `switchWorkspace` on an unassigned window does assign it as a side effect (calls `setWindowEntry` at line 208), so behavior is correct; SUMMARY documentation is inaccurate but code works |
| `popup.css` | — | `workspace-item--in-use` class applied in JS but has no corresponding CSS rule | Info | No visual tint on in-use workspace rows; only indicator is the `ws-in-use-icon` SVG. The icon alone satisfies WIN-02 per UI-SPEC which specified the icon as the indicator mechanism |

No blocker or warning-level anti-patterns found.

### Human Verification Required

The following items passed all automated checks but require browser testing to confirm end-to-end behavior:

#### 1. Per-Window Badge Display (WIN-06)

**Test:** Open two Firefox windows with the extension loaded. Switch to different workspaces in each window.
**Expected:** Each window's browser toolbar shows a badge with the first letter of its active workspace; a new/unassigned window shows `?` on gray.
**Why human:** Browser badge rendering cannot be asserted via static analysis.

#### 2. In-Use Indicator Visibility (WIN-02)

**Test:** Assign Workspace A to Window 1. Open popup in Window 2. Look at Workspace A in the list.
**Expected:** Workspace A shows a small dual-window SVG icon (12x12) with tooltip "Active in another window". The workspace row is not clickable-to-switch.
**Why human:** SVG rendering, tooltip display, and click-handler branching require browser UI inspection.

#### 3. Focus Window Behavior (WIN-03)

**Test:** With two windows open, click an in-use workspace in Window 2's popup.
**Expected:** Window 1 (the owner) comes to the foreground; Window 2's popup closes.
**Why human:** Focus behavior is window-manager-dependent. The SUMMARY noted this could not be fully verified under Hyprland/Wayland. The code (`browser.windows.update({ focused: true })`) is correct per the WebExtensions API.

#### 4. Browser Restart Reclaim (D-10)

**Test:** Assign workspaces to two windows. Close and reopen the browser (not `web-ext run` — use a real Firefox restart).
**Expected:** Each window re-acquires its previous workspace based on URL matching (at least 50% of saved URLs must be present).
**Why human:** Cannot simulate a true browser restart in the `web-ext run` development workflow.

### Notable Observations

- **Security invariant maintained:** No `innerHTML` usage found anywhere in `src/`. All DOM construction uses `createElement` and `.textContent`.
- **ESLint:** Exits 0 with no errors or warnings across all source files.
- **web-ext lint:** 0 errors, 0 warnings, 0 notices.
- **No `currentWindow: true` in background:** Confirmed — grep returns no matches in `src/background/`.
- **Commit integrity:** All documented commits (`e2c0db8`, `d355767`, `a952d8e`) exist in git log.
- **Rollback path includes windowMap restore:** `rollbackSwitch` restores both `workspaces` array and the window map entry via `setWindowEntry(windowId, snapshot.previousWsId)`.

---

_Verified: 2026-03-21T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
