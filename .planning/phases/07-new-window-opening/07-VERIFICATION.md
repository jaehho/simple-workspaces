---
phase: 07-new-window-opening
verified: 2026-03-24T00:00:00Z
status: human_needed
score: 15/15 must-haves verified
re_verification: false
human_verification:
  - test: "Subtitle display — unassigned window"
    expected: "Popup shows 'Click to open in new window' when window has no workspace assigned"
    why_human: "Requires running Firefox extension; cannot simulate activeWorkspaceId === null branch programmatically"
  - test: "Subtitle display — assigned window"
    expected: "Popup shows 'Ctrl+click to open in new window' when window has a workspace assigned"
    why_human: "Requires running Firefox extension to verify rendered subtitle text"
  - test: "WIN-01: Unassigned-window regular click"
    expected: "Clicking a workspace from an unassigned window opens that workspace in a NEW browser window; the original window is left untouched"
    why_human: "Requires multi-window browser interaction; routing logic is verified in code but end-to-end behavior needs live test"
  - test: "WIN-04: Ctrl+click from assigned window"
    expected: "Ctrl+clicking a non-active workspace opens it in a new window; macOS context menu does not appear"
    why_human: "e.preventDefault() presence verified in code; macOS suppression only testable on real hardware"
  - test: "WIN-03: Middle-click from any window"
    expected: "Middle-clicking a non-active workspace opens it in a new window; no browser autoscroll occurs"
    why_human: "e.button !== 1 guard verified in code; autoscroll suppression only testable in running browser"
  - test: "D-01/D-02: Already-active workspace focuses existing window"
    expected: "When workspace is already open in another window, the existing window gains focus — no new window is created"
    why_human: "Exclusive ownership loop verified in workspaces.js code; window focus side-effect requires live two-window test"
  - test: "D-13: Active workspace guard — no action on Ctrl+click or middle-click of active workspace"
    expected: "Ctrl+click or middle-click on the currently active workspace does nothing"
    why_human: "!isActive guard verified in code; confirming the no-op behaviour requires live interaction"
  - test: "D-10: Regular click from assigned window still switches"
    expected: "A regular left-click on a non-active workspace in an assigned window switches that workspace in the current window as before"
    why_human: "Code path verified (falls through to onSwitch(ws.id)); tab switching side-effect requires live browser test"
  - test: "WIN-02: Banner and Assign Here buttons gone"
    expected: "No 'No workspace assigned' banner and no 'Assign Here' buttons appear in any window state"
    why_human: "Negative code patterns confirmed absent; visual absence requires popup rendering in Firefox"
---

# Phase 07: New-Window Opening Verification Report

**Phase Goal:** Users can open any workspace in a new window — either by clicking from an unassigned window or by using a modifier key in the popup
**Verified:** 2026-03-24
**Status:** human_needed (all automated checks pass; 9 items require live-browser verification)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `openWorkspaceInNewWindow` creates a new browser window and populates it with the target workspace's tabs | VERIFIED | `browser.windows.create({ focused: true })` at line 441, tab loop lines 449-480 in workspaces.js |
| 2 | If the target workspace is already active in another window, that window is focused instead of creating a new one (D-01, D-02) | VERIFIED | Ownership loop lines 430-435 in workspaces.js; `browser.windows.update(Number(wid), { focused: true })` called unconditionally on any match |
| 3 | The auto-created blank tab Firefox injects into new windows is removed after workspace tabs are created | VERIFIED | `blankTabId = newWindow.tabs[0].id` at line 442; `browser.tabs.remove(blankTabId)` at line 489 — executed only after successful tab creation |
| 4 | `isSwitching` guard prevents `throttledSave` from persisting partial state during new-window creation | VERIFIED | `setSessionState({ isSwitching: true })` at line 423 (before try); `setSessionState({ isSwitching: false })` in `finally` block at line 501 |
| 5 | The new window's workspace assignment is recorded in the windowMap and badge is updated | VERIFIED | `setWindowEntry(newWindow.id, targetId)` line 493; `updateBadge(target, newWindow.id)` line 494 |
| 6 | The popup can send an `openWorkspaceInNewWindow` message and receive a success/error response | VERIFIED | `case 'openWorkspaceInNewWindow': return openWorkspaceInNewWindow(msg.workspaceId)` in messaging.js line 59-60; `onOpenInNewWindow` in popup.js line 196-199 sends `{ action: 'openWorkspaceInNewWindow', workspaceId }` |
| 7 | The unassigned-window banner is gone from the popup (D-04) | VERIFIED | No `.ws-unassigned-banner` in popup.js, popup.css, or popup.html |
| 8 | No 'Assign Here' button appears in the popup for any workspace (D-05) | VERIFIED | No `onAssign`, no `Assign Here`, no `assignBtn` in popup.js; no `.ws-actions button.assign` in popup.css |
| 9 | Subtitle reads 'Click to open in new window' when window is unassigned (D-07) | VERIFIED | Lines 43-48 in popup.js: `subtitle.textContent = activeWorkspaceId === null ? 'Click to open in new window' : 'Ctrl+click to open in new window'` |
| 10 | Subtitle reads 'Ctrl+click to open in new window' when window is assigned (D-07) | VERIFIED | Same branch at popup.js line 47 |
| 11 | Clicking a workspace from an unassigned window sends `openWorkspaceInNewWindow` (D-09, WIN-01) | VERIFIED | `activeWorkspaceId === null` branch at popup.js line 144 calls `onOpenInNewWindow(ws.id)` |
| 12 | Ctrl+clicking a workspace sends `openWorkspaceInNewWindow` (D-12, WIN-04) | VERIFIED | `e.ctrlKey` check at popup.js line 135; `e.preventDefault()` line 136; `if (!isActive) onOpenInNewWindow(ws.id)` line 137 |
| 13 | Middle-clicking a workspace sends `openWorkspaceInNewWindow` (D-11, WIN-03) | VERIFIED | `auxclick` listener at popup.js line 154; `e.button !== 1` guard line 155; `e.preventDefault()` line 157; `if (!isActive) onOpenInNewWindow(ws.id)` line 158 |
| 14 | Ctrl+clicking or middle-clicking the active workspace does nothing (D-13) | VERIFIED | `!isActive` guard present on ctrlKey branch (line 137), auxclick branch (line 158), and unassigned-window branch (line 146) |
| 15 | Regular click from an assigned window still switches workspace in the current window (D-10) | VERIFIED | Else branch at popup.js line 147-150: `else if (!isActive) { onSwitch(ws.id) }` — reached only when `activeWorkspaceId !== null` and `!isInUse` |

**Score:** 15/15 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/background/workspaces.js` | `openWorkspaceInNewWindow` function | VERIFIED | 82-line function at lines 422-503; exported; substantive implementation |
| `src/background/messaging.js` | `openWorkspaceInNewWindow` message routing | VERIFIED | Import at line 3; `case 'openWorkspaceInNewWindow'` at lines 59-60 |
| `src/popup/popup.html` | Header with `ws-subtitle` element and `header-text` wrapper | VERIFIED | `<div class="header-text">` line 9; `<p id="ws-subtitle" class="ws-subtitle"></p>` line 11 |
| `src/popup/popup.js` | Click routing, modifier detection, `onOpenInNewWindow`, subtitle update | VERIFIED | `onOpenInNewWindow` at lines 196-199; click handler lines 130-151; auxclick lines 154-159; subtitle lines 43-48 |
| `src/popup/popup.css` | Subtitle styling; deprecated banner/assign CSS removed | VERIFIED | `.header-text` at line 37; `.ws-subtitle` at line 42; no deprecated selectors present |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/background/messaging.js` | `src/background/workspaces.js` | `import openWorkspaceInNewWindow` | WIRED | Line 3: `import { ..., openWorkspaceInNewWindow, ... } from './workspaces.js'` |
| `src/background/workspaces.js` | `browser.windows.create` | API call to create new window | WIRED | Line 441: `const newWindow = await browser.windows.create({ focused: true })` |
| `src/background/workspaces.js` | `state.js setWindowEntry` | Records new window in windowMap | WIRED | Line 493: `await setWindowEntry(newWindow.id, targetId)` |
| `src/popup/popup.js` | `messaging.js openWorkspaceInNewWindow` | `browser.runtime.sendMessage({ action: 'openWorkspaceInNewWindow' })` | WIRED | Line 197: `await browser.runtime.sendMessage({ action: 'openWorkspaceInNewWindow', workspaceId })` |
| `src/popup/popup.js` | `ws-subtitle` DOM element | `getElementById('ws-subtitle')` textContent update | WIRED | Lines 43-48: element retrieved by id, `textContent` set conditionally |
| `src/popup/popup.html` | `popup.css` | `class="ws-subtitle"` | WIRED | Line 11 of popup.html; `.ws-subtitle` rule at line 42 of popup.css |

---

### Data-Flow Trace (Level 4)

Not applicable. Phase 07 produces event-driven popup UI (click handlers, window API calls) and background functions — not components that render data fetched from a store. The `subtitle` element's data source is `activeWorkspaceId` from `getState` response, which is already a live value from `windowMap` via `messaging.js` `getState` case. No static/hollow data path found.

---

### Behavioral Spot-Checks

Step 7b: SKIPPED — the extension requires a running Firefox browser with the WebExtensions runtime. No runnable entry points exist outside of the browser. All behavioral checks are routed to Human Verification.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| WIN-01 | 07-01-PLAN.md, 07-02-PLAN.md | Clicking from unassigned window opens workspace in new window | SATISFIED | `activeWorkspaceId === null` branch in popup.js line 144 → `onOpenInNewWindow`; backend `openWorkspaceInNewWindow` creates window |
| WIN-02 | 07-02-PLAN.md | "Assign Here" buttons and unassigned-window banner removed | SATISFIED | No `.ws-unassigned-banner`, `onAssign`, `Assign Here`, or `.ws-actions button.assign` in any popup file |
| WIN-03 | 07-01-PLAN.md, 07-02-PLAN.md | Middle-click opens workspace in new window | SATISFIED | `auxclick` listener with `e.button !== 1` guard in popup.js lines 154-159 |
| WIN-04 | 07-01-PLAN.md, 07-02-PLAN.md | Ctrl+click opens workspace in new window | SATISFIED | `e.ctrlKey` branch with `e.preventDefault()` in popup.js lines 135-139 |

All four WIN requirements are accounted for. No orphaned requirements found for Phase 7 in REQUIREMENTS.md.

---

### Anti-Patterns Found

None. Scanned all five modified files for: TODO/FIXME/PLACEHOLDER comments, empty return values, stub message patterns, hardcoded empty props, and console.log-only implementations. Zero findings.

ESLint exit code 0 on all three JavaScript files.
web-ext lint: 0 errors, 0 warnings, 0 notices.

---

### Human Verification Required

#### 1. Subtitle display — unassigned window

**Test:** Open a fresh Firefox window with no workspace assignment (Ctrl+N), then open the extension popup.
**Expected:** Subtitle below "Workspaces" reads "Click to open in new window".
**Why human:** Requires live extension rendering; `activeWorkspaceId === null` value comes from `windowMap` at runtime.

#### 2. Subtitle display — assigned window

**Test:** Open the extension popup from a window that has a workspace assigned.
**Expected:** Subtitle reads "Ctrl+click to open in new window".
**Why human:** Same as above — requires rendered popup in running Firefox.

#### 3. WIN-01: Unassigned-window regular click

**Test:** From an unassigned window's popup, click any workspace name.
**Expected:** A new browser window opens containing that workspace's tabs. The original unassigned window is untouched.
**Why human:** Window creation side-effect requires multi-window live test.

#### 4. WIN-04: Ctrl+click from assigned window

**Test:** From an assigned window's popup, Ctrl+click a workspace that is not active in the current window.
**Expected:** A new window opens with that workspace. On macOS, no system context menu appears.
**Why human:** `e.preventDefault()` presence is verified; macOS context-menu suppression requires real macOS hardware.

#### 5. WIN-03: Middle-click from any window

**Test:** From any window's popup, middle-click a workspace that is not active in the current window.
**Expected:** A new window opens with that workspace. No browser autoscroll cursor appears (Windows).
**Why human:** Autoscroll suppression requires live browser interaction.

#### 6. D-01/D-02: Already-active workspace focuses existing window

**Test:** Open workspace "A" in Window 1. From Window 2's popup, click (or Ctrl+click, or middle-click) workspace "A".
**Expected:** Window 1 is focused/raised to front. No new window is created.
**Why human:** Two-window focus side-effect; the ownership loop logic is code-verified but the window focus call requires a live browser.

#### 7. D-13: Active workspace guard

**Test:** From a window where workspace "B" is active, Ctrl+click or middle-click workspace "B".
**Expected:** Nothing happens — no new window, no error.
**Why human:** `!isActive` guard verified in code; the do-nothing outcome must be confirmed in the running popup.

#### 8. D-10: Regular click from assigned window still switches

**Test:** From an assigned window's popup, regular-click a different workspace.
**Expected:** The workspace switches in the current window (existing pre-Phase-7 behaviour preserved).
**Why human:** `onSwitch` call path is code-verified; tab-replacement side-effect needs live confirmation.

#### 9. WIN-02: Banner and Assign Here buttons gone

**Test:** Open popup from an unassigned window and from an assigned window.
**Expected:** No "No workspace assigned" banner and no "Assign Here" buttons visible in either state.
**Why human:** Negative code patterns confirmed absent; visual absence requires popup rendering.

---

### Gaps Summary

No gaps. All 15 must-have truths are verified at code level (levels 1-4). All four WIN requirement IDs are satisfied by substantive, wired implementations. No missing artifacts, no stubs, no orphaned requirements.

The only outstanding items are 9 live-browser behavioral checks that confirm the end-to-end UX. These require a running Firefox instance and cannot be completed programmatically. The code evidence for each is strong — the human checks are confirmatory, not investigative.

---

_Verified: 2026-03-24_
_Verifier: Claude (gsd-verifier)_
