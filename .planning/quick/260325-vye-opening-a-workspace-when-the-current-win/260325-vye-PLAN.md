---
phase: quick
plan: 260325-vye
type: execute
wave: 1
depends_on: []
files_modified:
  - src/background/workspaces.js
  - src/background/messaging.js
  - src/popup/popup.js
autonomous: false
requirements: []
must_haves:
  truths:
    - "When a window contains only about:newtab and has no workspace, clicking a workspace replaces the current window contents instead of opening a new window"
    - "When a window has multiple real tabs and no workspace, clicking a workspace still opens in a new window (existing behavior preserved)"
    - "Normal workspace switching in assigned windows is unaffected"
  artifacts:
    - path: "src/background/workspaces.js"
      provides: "openWorkspaceInCurrentWindow function"
      exports: ["openWorkspaceInCurrentWindow"]
    - path: "src/background/messaging.js"
      provides: "openWorkspaceInCurrentWindow message handler"
      contains: "openWorkspaceInCurrentWindow"
    - path: "src/popup/popup.js"
      provides: "Smart routing: empty-window detection for workspace click"
      contains: "isEmptyNewTabWindow"
  key_links:
    - from: "src/popup/popup.js"
      to: "src/background/messaging.js"
      via: "sendMessage with action openWorkspaceInCurrentWindow"
      pattern: "action.*openWorkspaceInCurrentWindow"
    - from: "src/background/messaging.js"
      to: "src/background/workspaces.js"
      via: "import and dispatch openWorkspaceInCurrentWindow"
      pattern: "openWorkspaceInCurrentWindow"
---

<objective>
When the current window is just a blank new tab (about:newtab) with no workspace assigned,
clicking a workspace should replace the current window's content with that workspace's tabs
instead of spawning a separate new window.

Purpose: Avoids leaving behind an orphaned empty window, which is the expected UX when you
open a workspace from a fresh browser window.

Output: Modified background and popup scripts that detect the "empty new-tab window" case
and reuse the current window.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/background/workspaces.js
@src/background/messaging.js
@src/popup/popup.js
@src/background/state.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add openWorkspaceInCurrentWindow to background</name>
  <files>src/background/workspaces.js, src/background/messaging.js</files>
  <action>
In `src/background/workspaces.js`, add a new exported async function `openWorkspaceInCurrentWindow(targetId, windowId)` that:

1. Sets `isSwitching: true` via `setSessionState`.
2. Loads workspaces and validates targetId exists.
3. Performs the exclusive ownership check (same as switchWorkspace) -- reject if targetId is active in another window.
4. Determines tabs to create from target workspace (same logic as switchWorkspace lines 142-144: use target.tabs if non-empty, else a single about:newtab).
5. Queries the current window's old tabs BEFORE creating new ones (to know which tabs to remove afterward).
6. Creates all target workspace tabs in the current window using the same tab-creation loop with discarded fallback (same pattern as switchWorkspace lines 147-178).
7. Performs atomicity check: if not all tabs were created, rolls back (remove created tabs) and returns `{ success: false, error: '...' }`.
8. Removes the old tabs (the about:newtab) using `browser.tabs.remove(oldTabIds)`.
9. Updates `lastUsedAt` on the target workspace, saves workspaces, sets window entry via `setWindowEntry(windowId, targetId)`, updates badge.
10. In the `finally` block, sets `isSwitching: false`.

The function is essentially a hybrid of `openWorkspaceInNewWindow` (no current workspace to save) and `switchWorkspace` (reuses the current window). The key difference from `switchWorkspace` is that it does NOT try to save the current workspace tabs or look up a currentWsId -- the window is unassigned.

Import and use: `getSessionState`, `setSessionState`, `getWindowMap`, `setWindowEntry` from state.js; `getWorkspaces`, `saveWorkspaces` from sync.js; and the local `updateBadge` function.

In `src/background/messaging.js`:
1. Add `openWorkspaceInCurrentWindow` to the import from `./workspaces.js`.
2. Add a new case `'openWorkspaceInCurrentWindow'` in the switch statement that calls `openWorkspaceInCurrentWindow(msg.workspaceId, msg.windowId)`.
  </action>
  <verify>
    <automated>cd /home/jaeho/simple-workspaces && npx eslint src/background/workspaces.js src/background/messaging.js</automated>
  </verify>
  <done>
    - `openWorkspaceInCurrentWindow` is exported from workspaces.js
    - messaging.js routes the `openWorkspaceInCurrentWindow` action to the new function
    - ESLint passes with no errors
  </done>
</task>

<task type="auto">
  <name>Task 2: Update popup to detect empty-window and route accordingly</name>
  <files>src/popup/popup.js</files>
  <action>
In `src/popup/popup.js`, modify the workspace item click handler (the `li.addEventListener('click', ...)` block around lines 135-156) to detect when the current unassigned window contains only a single about:newtab tab:

1. At the top of `renderList()`, after querying state (line 37), query the current window's tabs:
   ```
   const currentTabs = await browser.tabs.query({ windowId: currentWindowId })
   const isEmptyNewTabWindow = activeWorkspaceId === null
     && currentTabs.length === 1
     && (!currentTabs[0].url || currentTabs[0].url === 'about:newtab')
   ```

2. In the click handler, change the `activeWorkspaceId === null` branch (lines 149-151) from:
   ```
   if (!isActive) onOpenInNewWindow(ws.id)
   ```
   to:
   ```
   if (!isActive) {
     if (isEmptyNewTabWindow) {
       onOpenInCurrentWindow(ws.id)
     } else {
       onOpenInNewWindow(ws.id)
     }
   }
   ```

3. Add a new async function `onOpenInCurrentWindow(workspaceId)` near the other action functions (after `onOpenInNewWindow`):
   ```
   async function onOpenInCurrentWindow(workspaceId) {
     const items = document.querySelectorAll('.workspace-item')
     items.forEach(item => item.style.opacity = '0.5')

     await browser.runtime.sendMessage({
       action: 'openWorkspaceInCurrentWindow',
       workspaceId,
       windowId: currentWindowId,
     })
     window.close()
   }
   ```

4. Also update the keyboard Enter handler behavior. When `kbIndex >= 0` and Enter is pressed, `items[kbIndex].click()` is called which triggers the same click handler, so no separate change is needed for keyboard nav -- it will naturally route through the same detection logic.

The subtitle text ("Click to open in new window") should also be updated. Change the `activeWorkspaceId === null` case (line 51) to conditionally show different text:
   - If `isEmptyNewTabWindow`: `'Click to switch'`
   - Otherwise: `'Click to open in new window'`

To make `isEmptyNewTabWindow` accessible to the subtitle update and the click handlers inside `forEach`, compute it at the `renderList` function scope (before the subtitle update and the forEach loop).
  </action>
  <verify>
    <automated>cd /home/jaeho/simple-workspaces && npx eslint src/popup/popup.js</automated>
  </verify>
  <done>
    - Popup detects single-newtab unassigned windows and sends `openWorkspaceInCurrentWindow` instead of `openWorkspaceInNewWindow`
    - Multi-tab unassigned windows still open in new window (unchanged)
    - Subtitle text reflects the actual behavior
    - ESLint passes with no errors
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Verify workspace opening behavior in Firefox</name>
  <files>src/background/workspaces.js, src/background/messaging.js, src/popup/popup.js</files>
  <action>User verifies the new behavior manually in Firefox.</action>
  <what-built>
    Smart workspace opening that reuses the current window when it is just a blank new tab,
    instead of always spawning a new window.
  </what-built>
  <how-to-verify>
    1. Load the extension in Firefox (`npx web-ext run` or reload the installed version)
    2. Open a brand new Firefox window (Ctrl+N) -- it should show a single new tab
    3. Click the extension icon -- subtitle should say "Click to switch"
    4. Click any non-active workspace -- the workspace tabs should appear IN the current window (no new window spawned)
    5. Verify the old about:newtab is gone and the workspace badge is set
    6. Now test the multi-tab case: open a new window, then open several tabs in it
    7. Click the extension icon -- subtitle should say "Click to open in new window"
    8. Click a workspace -- it should open in a NEW window (old behavior preserved)
    9. Verify normal workspace switching still works in an assigned window
  </how-to-verify>
  <verify>Manual verification by user</verify>
  <done>All three scenarios pass: empty-window reuse, multi-tab new window, normal switching</done>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>

</tasks>

<verification>
- `npx eslint src/background/workspaces.js src/background/messaging.js src/popup/popup.js` passes
- Manual test: new-tab-only window reuses itself when opening a workspace
- Manual test: multi-tab unassigned window still opens workspace in new window
- Manual test: assigned-window switching works unchanged
</verification>

<success_criteria>
- Single about:newtab window replaces in-place when a workspace is clicked
- Multi-tab unassigned windows still open in a new window
- All existing workspace switching paths remain functional
- No ESLint errors
</success_criteria>

<output>
After completion, create `.planning/quick/260325-vye-opening-a-workspace-when-the-current-win/260325-vye-SUMMARY.md`
</output>
