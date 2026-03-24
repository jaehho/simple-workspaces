---
phase: quick
plan: 260324-kqf
type: execute
wave: 1
depends_on: []
files_modified:
  - src/manifest.json
  - src/background/index.js
  - src/background/workspaces.js
autonomous: true
requirements: [QUICK]

must_haves:
  truths:
    - "User can press Alt+Shift+Right to switch to the next workspace"
    - "User can press Alt+Shift+Left to switch to the previous workspace"
    - "Shortcuts wrap around (last->first, first->last)"
    - "Shortcuts only switch within the current window's workspace context"
    - "Shortcuts skip workspaces active in other windows (exclusive ownership)"
  artifacts:
    - path: "src/manifest.json"
      provides: "commands key declaring keyboard shortcuts"
      contains: "commands"
    - path: "src/background/index.js"
      provides: "browser.commands.onCommand listener"
      contains: "commands.onCommand"
    - path: "src/background/workspaces.js"
      provides: "switchToAdjacentWorkspace helper"
      exports: ["switchToAdjacentWorkspace"]
  key_links:
    - from: "src/manifest.json"
      to: "src/background/index.js"
      via: "commands declaration triggers onCommand listener"
      pattern: "commands\\.onCommand"
    - from: "src/background/index.js"
      to: "src/background/workspaces.js"
      via: "onCommand calls switchToAdjacentWorkspace"
      pattern: "switchToAdjacentWorkspace"
---

<objective>
Add keyboard shortcuts for switching between workspaces without opening the popup.

Purpose: Power users need fast workspace switching. Alt+Shift+Left/Right provides next/previous workspace cycling that wraps around at boundaries, respects exclusive window ownership, and works from any tab.

Output: Two manifest-declared commands with a background listener that delegates to a new directional switch helper in workspaces.js.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/manifest.json
@src/background/index.js
@src/background/workspaces.js
@src/background/state.js
@src/background/sync.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Declare commands in manifest and add onCommand listener</name>
  <files>src/manifest.json, src/background/index.js, src/background/workspaces.js</files>
  <action>
1. In `src/manifest.json`, add a top-level `"commands"` key with two entries:

```json
"commands": {
  "next-workspace": {
    "suggested_key": {
      "default": "Alt+Shift+Right"
    },
    "description": "Switch to next workspace"
  },
  "previous-workspace": {
    "suggested_key": {
      "default": "Alt+Shift+Left"
    },
    "description": "Switch to previous workspace"
  }
}
```

Place it after the `"action"` block.

2. In `src/background/workspaces.js`, add and export a new function `switchToAdjacentWorkspace(direction, windowId)` where `direction` is `1` (next) or `-1` (previous):

```js
export async function switchToAdjacentWorkspace(direction, windowId) {
  const workspaces = await getWorkspaces()
  if (workspaces.length <= 1) return { success: true }

  const windowMap = await getWindowMap()
  const currentWsId = windowMap[String(windowId)]
  if (!currentWsId) return { success: false, error: 'No workspace assigned to this window' }

  const currentIdx = workspaces.findIndex(w => w.id === currentWsId)
  if (currentIdx === -1) return { success: false, error: 'Current workspace not found' }

  // Build set of workspace IDs active in OTHER windows (exclusive ownership)
  const busyIds = new Set()
  for (const [wid, wsId] of Object.entries(windowMap)) {
    if (wsId && wid !== String(windowId)) busyIds.add(wsId)
  }

  // Walk in `direction`, wrapping around, skipping busy workspaces
  const len = workspaces.length
  for (let step = 1; step < len; step++) {
    const candidateIdx = ((currentIdx + direction * step) % len + len) % len
    const candidate = workspaces[candidateIdx]
    if (!busyIds.has(candidate.id)) {
      return switchWorkspace(candidate.id, windowId)
    }
  }

  // Every other workspace is busy in another window
  return { success: false, error: 'No available workspace to switch to' }
}
```

This reuses the existing `switchWorkspace` for the actual switch logic. The modular arithmetic with `+ len) % len` handles negative wrap-around correctly.

3. In `src/background/index.js`, add the import for `switchToAdjacentWorkspace` from `./workspaces.js` (add it to the existing import line). Then register a top-level `browser.commands.onCommand` listener (must be top-level for event page wakeup, same pattern as other listeners):

```js
// ── Keyboard Shortcut Listeners ──────────────────────────
browser.commands.onCommand.addListener(async (command) => {
  if (command !== 'next-workspace' && command !== 'previous-workspace') return

  const direction = command === 'next-workspace' ? 1 : -1
  const win = await browser.windows.getLastFocused()
  await switchToAdjacentWorkspace(direction, win.id)
})
```

Place this section after the Context Menu Listeners block and before the Message Handler block. Use `browser.windows.getLastFocused()` to get the focused window ID since commands fire in the background context without a sender window.
  </action>
  <verify>
    <automated>cd /home/jaeho/simple-workspaces && npx eslint src/manifest.json src/background/index.js src/background/workspaces.js && echo "Lint passed"</automated>
  </verify>
  <done>
    - manifest.json contains "commands" with "next-workspace" and "previous-workspace" entries
    - background/index.js has a top-level browser.commands.onCommand listener
    - background/workspaces.js exports switchToAdjacentWorkspace
    - ESLint passes with no errors
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>Keyboard shortcuts Alt+Shift+Left and Alt+Shift+Right for cycling through workspaces</what-built>
  <how-to-verify>
    1. Load the extension in Firefox (run `make run` or `npx web-ext run`)
    2. Create 3+ workspaces via the popup
    3. Press Alt+Shift+Right — should switch to the next workspace
    4. Press Alt+Shift+Right again — should switch to the one after that
    5. Keep pressing — should wrap from last back to first
    6. Press Alt+Shift+Left — should switch to the previous workspace
    7. If multiple windows are open with workspaces, confirm that shortcuts skip workspaces active in other windows
    8. Verify shortcuts can be customized at about:addons -> gear icon -> Manage Extension Shortcuts
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>

</tasks>

<verification>
- ESLint passes on all modified files
- Extension loads without errors in Firefox
- Keyboard shortcuts switch workspaces in both directions with wrap-around
</verification>

<success_criteria>
- Alt+Shift+Right switches to the next workspace
- Alt+Shift+Left switches to the previous workspace
- Wrap-around works at both ends of the workspace list
- Workspaces active in other windows are skipped
- User can customize shortcuts via Firefox's built-in shortcut manager
</success_criteria>

<output>
After completion, create `.planning/quick/260324-kqf-add-keyboard-shortcuts-for-switching-wor/260324-kqf-SUMMARY.md`
</output>
