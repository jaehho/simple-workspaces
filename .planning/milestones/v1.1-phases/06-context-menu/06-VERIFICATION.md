---
phase: 06-context-menu
verified: 2026-03-24T00:00:00Z
status: human_needed
score: 16/16 must-haves verified
human_verification:
  - test: "Basic single-tab move (MENU-01, MENU-02)"
    expected: "Right-clicking a tab shows 'Move to Workspace' parent item; submenu lists all workspaces except the active one; each entry shows '{name} ({n} tabs)' format; clicking an entry moves the tab and switches to the target workspace"
    why_human: "Context menu appearance and tab-move behavior require live browser interaction to confirm"
  - test: "Multi-tab selection move (MENU-04)"
    expected: "Ctrl+clicking 2-3 tabs, then right-clicking one of the highlighted tabs and selecting a workspace, moves ALL highlighted tabs — not just the right-clicked one"
    why_human: "tab.highlighted logic and multi-tab dispatch require live browser interaction to confirm"
  - test: "Cross-window move with [open] suffix (D-05, D-11)"
    expected: "A workspace active in another window shows '[open]' suffix in the submenu; clicking it physically moves the tab to the other window without reload; the target window is focused"
    why_human: "Cross-window tab movement and no-reload guarantee require live browser interaction to confirm"
  - test: "Dynamic submenu updates (MENU-03)"
    expected: "Creating, renaming, or deleting a workspace via the popup is immediately reflected in the next right-click submenu without a browser restart"
    why_human: "onShown rebuild behavior on workspace changes requires live browser interaction to confirm"
  - test: "MRU ordering (D-12)"
    expected: "After switching between workspaces, the most recently used workspace appears first in the right-click submenu"
    why_human: "lastUsedAt sorting order in the submenu requires live browser interaction to confirm"
---

# Phase 6: Context Menu Verification Report

**Phase Goal:** Context menu — right-click tab → "Move to Workspace" submenu
**Verified:** 2026-03-24
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

All automated checks passed. Code is substantive and fully wired. Five items require human verification in a live browser.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | moveTabsToWorkspace() moves tabs cross-window via browser.tabs.move() without reload | VERIFIED | `workspaces.js:244` — `await browser.tabs.move(sortedTabs.map(t => t.id), { windowId: targetWindowId, index: -1 })` |
| 2 | moveTabsToWorkspace() handles same-window move by saving tabs to target workspace and calling switchWorkspace() | VERIFIED | `workspaces.js:273` — `await switchWorkspace(targetWsId, sourceWindowId)` in else branch |
| 3 | Multi-tab selection (highlighted tabs) collected and moved as a group (MENU-04) | VERIFIED | `menus.js:87-91` — `if (tab.highlighted)` queries all highlighted tabs; `menus.js:96` dispatches full array |
| 4 | Source workspace tab list updated to remove moved tabs | VERIFIED | Cross-window: `workspaces.js:248-249` re-queries and serializes remaining tabs. Same-window: `workspaces.js:277-283` post-switch URL-set filter |
| 5 | Target workspace tab list updated to include moved tabs | VERIFIED | Cross-window: `workspaces.js:253-254` re-queries target window tabs. Same-window: `workspaces.js:267` appends `movedTabData` |
| 6 | lastUsedAt field round-trips through sync serialization and assembly | VERIFIED | `sync.js:164` — `lastUsedAt: ws.lastUsedAt \|\| 0` in serializeToSyncItems; `sync.js:197` — `lastUsedAt: meta.lastUsedAt \|\| 0` in assembleFromSync |
| 7 | Move operation is atomic with rollback on failure (D-09) | VERIFIED | `workspaces.js:233` — snapshot taken; `workspaces.js:289-292` — catch restores snapshot; `workspaces.js:296` — finally resets isSwitching |
| 8 | Right-clicking a tab shows 'Move to Workspace' parent item with workspace submenu children (MENU-01) | VERIFIED (code) / NEEDS HUMAN (behavior) | `manifest.json:9` — "menus" permission; `index.js:61-65` — menus.create in onInstalled; `menus.js:22-74` — handleMenuShown builds children |
| 9 | Submenu lists all workspaces except active one (D-15) | VERIFIED | `menus.js:51` — `.filter(ws => ws.id !== activeWsId)` |
| 10 | Each submenu entry shows workspace name + tab count with singular/plural ("1 tab" / "N tabs") (D-10) | VERIFIED | `menus.js:57-61` — `tabWord = tabCount === 1 ? 'tab' : 'tabs'`; label constructed with both formats |
| 11 | Workspaces active in another window show '[open]' suffix (D-11) | VERIFIED | `menus.js:55,59` — `isOpenElsewhere` check; label includes `[open]` suffix |
| 12 | Submenu entries sorted by lastUsedAt descending, falling back to createdAt (D-12) | VERIFIED | `menus.js:52` — `.sort((a, b) => (b.lastUsedAt \|\| b.createdAt) - (a.lastUsedAt \|\| a.createdAt))` |
| 13 | Clicking a submenu entry calls moveTabsToWorkspace() with correct tabs | VERIFIED | `menus.js:96` — `await moveTabsToWorkspace(tabsToMove, targetWsId, tab.windowId)` |
| 14 | Submenu rebuilds on every open via menus.onShown (MENU-03) | VERIFIED (code) / NEEDS HUMAN (behavior) | `index.js:44` — `browser.menus.onShown.addListener(handleMenuShown)` at top level |
| 15 | switchWorkspace() sets lastUsedAt on target workspace before saving | VERIFIED | `workspaces.js:194` — `target.lastUsedAt = Date.now()` before `saveWorkspaces()` at line 197 |
| 16 | menus.onShown and menus.onClicked registered at top level in index.js | VERIFIED | `index.js:44-45` — both listeners registered synchronously at module scope |

**Score:** 16/16 truths verified (5 need additional human confirmation)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/background/workspaces.js` | moveTabsToWorkspace() and lastUsedAt in switchWorkspace | VERIFIED | Lines 218-298 (move function), line 194 (MRU in switch), lines 40/334 (MRU in init/create) |
| `src/background/sync.js` | lastUsedAt persisted through serializeToSyncItems and assembleFromSync | VERIFIED | Lines 164 and 197 |
| `src/background/menus.js` | handleMenuShown and handleMenuClicked | VERIFIED | Lines 22-74 and 78-100; all three imports present; PARENT_MENU_ID exported |
| `src/manifest.json` | "menus" permission | VERIFIED | Line 9 — "menus" in permissions array |
| `src/background/index.js` | Import, top-level listener registration, menus.create in onInstalled | VERIFIED | Line 9 (import), lines 44-45 (listeners), lines 61-65 (menus.create) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/background/menus.js | src/background/workspaces.js | moveTabsToWorkspace() call in handleMenuClicked | WIRED | `menus.js:7` imports; `menus.js:96` calls with full arguments |
| src/background/menus.js | src/background/sync.js | getWorkspaces() for submenu population | WIRED | `menus.js:5` imports; `menus.js:29` calls in handleMenuShown |
| src/background/menus.js | src/background/state.js | getWindowMap() for cross-window detection | WIRED | `menus.js:6` imports; `menus.js:30` calls in handleMenuShown |
| src/background/index.js | src/background/menus.js | import { handleMenuShown, handleMenuClicked, PARENT_MENU_ID } | WIRED | `index.js:9` — exact named import confirmed |
| src/background/workspaces.js | src/background/sync.js | saveWorkspaces() for move persistence | WIRED | `workspaces.js:4` imports; calls at lines 257, 269, 282, 290 |
| src/background/workspaces.js | src/background/state.js | getWindowMap() for cross-window detection, setSessionState for isSwitching | WIRED | `workspaces.js:3` imports both; called at lines 219, 224, 296 |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MENU-01 | 06-02 | User can right-click tab(s) and see "Move to Workspace" submenu listing each workspace | SATISFIED | menus.js handleMenuShown builds complete submenu; manifest has "menus" permission; index.js registers all listeners and creates parent item in onInstalled |
| MENU-02 | 06-01 | Moving tabs removes from source, adds to target, switches to target | SATISFIED | moveTabsToWorkspace() handles both paths: cross-window re-queries both windows; same-window appends, calls switchWorkspace, then URL-filters source cleanup |
| MENU-03 | 06-02 | Context menu workspace list updates dynamically on workspace changes | SATISFIED (code) | menus.onShown fires on every open; handleMenuShown always calls getWorkspaces() fresh; child items removed and rebuilt each time. Dynamic behavior requires human confirmation |
| MENU-04 | 06-01, 06-02 | Multi-tab selection moves all highlighted tabs together | SATISFIED | Plan 01: moveTabsToWorkspace accepts tabs[] array. Plan 02: menus.js:87-93 checks tab.highlighted and queries all highlighted tabs before calling moveTabsToWorkspace |

No orphaned requirements found. All four MENU-* requirements are covered by plans 06-01 and 06-02 and map to Phase 6 in REQUIREMENTS.md.

### Anti-Patterns Found

No blockers or stubs found.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/background/menus.js | 42 | Empty catch block `catch { }` (no param) | Info | Intentional — silences expected "item not found" errors when the menu closes mid-cleanup. Safe to ignore. |

All data flows are substantive: no placeholder returns, no hardcoded empty arrays that flow to rendering, no TODO/FIXME markers in modified files.

### Human Verification Required

#### 1. Basic Single-Tab Move

**Test:** Run `npx web-ext run --source-dir src/`. Create 2+ workspaces. Right-click any tab.
**Expected:** "Move to Workspace" appears in context menu. Submenu lists all workspaces except the currently active one. Each entry shows "{name} ({n} tabs)". Clicking an entry moves the tab to that workspace and switches to it.
**Why human:** Context menu rendering and tab-move behavior require a live Firefox instance.

#### 2. Multi-Tab Selection Move (MENU-04)

**Test:** Ctrl+click 2-3 tabs to highlight them. Right-click one of the highlighted tabs. Click a workspace in the submenu.
**Expected:** All highlighted tabs move together — not just the one right-clicked.
**Why human:** tab.highlighted behavior and the resulting batch move require live browser interaction.

#### 3. Cross-Window Move with [open] Suffix (D-05, D-11)

**Test:** Open a second Firefox window. Assign it a different workspace. In window 1, right-click a tab.
**Expected:** The second window's workspace shows "[open]" suffix. Clicking it moves the tab to the second window without reloading it (form data preserved). The second window receives focus.
**Why human:** Cross-window tab movement, no-reload guarantee, and focus behavior require live browser interaction.

#### 4. Dynamic Submenu Updates (MENU-03)

**Test:** Right-click a tab. Create a new workspace via the popup. Right-click a tab again.
**Expected:** The new workspace appears in the submenu immediately, without a browser restart. Same for renames and deletes.
**Why human:** onShown rebuild behavior on workspace CRUD changes requires live browser interaction.

#### 5. MRU Ordering (D-12)

**Test:** Switch between several workspaces via the popup. Right-click a tab.
**Expected:** The most recently switched-to workspace appears first in the submenu.
**Why human:** lastUsedAt sort order in the rendered submenu requires live browser interaction to observe.

### Gaps Summary

No gaps. All code artifacts exist, are substantive, and are fully wired. ESLint passes with zero errors on all four modified files. web-ext lint passes with zero errors, warnings, or notices. All 5 commits from both plan summaries (637a1ee, 72aae34, f10ac67, 942ac75, d31b920) are verified in git history.

The only outstanding items are the five human verification tests above, which cannot be confirmed by static analysis. The context menu feature is a UI surface — its correctness under real user interaction (rendering, tab movement, focus, MRU ordering) needs a human with a live Firefox instance to confirm.

---

_Verified: 2026-03-24_
_Verifier: Claude (gsd-verifier)_
