---
phase: quick
plan: 260324-kzp
type: execute
wave: 1
depends_on: []
files_modified:
  - src/popup/popup.css
  - src/popup/popup.js
autonomous: true
requirements: []
must_haves:
  truths:
    - "ArrowDown and j keys move highlight to the next workspace item"
    - "ArrowUp and k keys move highlight to the previous workspace item"
    - "Enter key switches to the highlighted workspace"
    - "Keyboard navigation wraps around at list boundaries"
    - "Keyboard navigation does not fire when modal is open or an input is focused"
    - "Highlighted item is visually distinct from hover and active states"
  artifacts:
    - path: "src/popup/popup.css"
      provides: "Keyboard highlight style for workspace items"
      contains: ".workspace-item.kb-highlight"
    - path: "src/popup/popup.js"
      provides: "Keyboard navigation handler and highlight tracking"
      contains: "keydown"
  key_links:
    - from: "src/popup/popup.js"
      to: "src/popup/popup.css"
      via: ".kb-highlight class toggle"
      pattern: "kb-highlight"
---

<objective>
Add keyboard navigation (ArrowUp/k, ArrowDown/j, Enter) to the workspace popup list.

Purpose: Let keyboard-driven users navigate and switch workspaces without touching the mouse, especially useful when the popup is opened via the Alt+Shift+W shortcut.
Output: Updated popup.js with keydown handler, updated popup.css with highlight style.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/popup/popup.js
@src/popup/popup.css
@src/popup/popup.html
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add keyboard highlight CSS style</name>
  <files>src/popup/popup.css</files>
  <action>
Add a `.workspace-item.kb-highlight` rule in the "Workspace List" CSS section (after the `.workspace-item.active::before` block, around line 103). The highlight must be visually distinct from both `:hover` (bg #252536) and `.active` (bg #2a2a42).

Style specification:
- `background: #2e2e4e` (slightly brighter than hover, clearly visible)
- `outline: 1px solid #89b4fa` (blue accent outline matching the primary button color)
- `outline-offset: -1px` (inset so it doesn't overflow the popup width)

Also add a rule to show `.ws-actions` when an item has `.kb-highlight` (same as `:hover` shows them):
```css
.workspace-item.kb-highlight .ws-actions {
  opacity: 1;
}
```

This ensures the edit/delete buttons are visible on the keyboard-highlighted item, consistent with mouse hover behavior.
  </action>
  <verify>
    <automated>cd /home/jaeho/simple-workspaces && grep -c "kb-highlight" src/popup/popup.css</automated>
  </verify>
  <done>popup.css contains .workspace-item.kb-highlight style with background and outline, plus a rule showing .ws-actions on highlighted items. Visually distinct from hover and active states.</done>
</task>

<task type="auto">
  <name>Task 2: Add keyboard navigation logic to popup</name>
  <files>src/popup/popup.js</files>
  <action>
Add keyboard navigation to popup.js. This requires two changes:

**1. Track highlight index (module-level variable, near line 8):**
Add `let kbIndex = -1;` after the existing module-level variables. A value of -1 means no item is highlighted.

**2. Add keydown listener (inside the DOMContentLoaded handler, after the existing event listeners around line 28):**

Add a `document.addEventListener('keydown', onKeyNav)` call.

**3. Implement the `onKeyNav` function (new section after the SVG Helpers section, or as a new "Keyboard Navigation" section):**

```javascript
// ── Keyboard Navigation ─────────────────────────────────────

function onKeyNav(e) {
  // Don't intercept when modal is open or an input/textarea is focused
  if (!document.getElementById('edit-modal').classList.contains('hidden')) return
  if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return

  const items = document.querySelectorAll('.workspace-item')
  if (!items.length) return

  let handled = false

  if (e.key === 'ArrowDown' || e.key === 'j') {
    kbIndex = kbIndex < items.length - 1 ? kbIndex + 1 : 0
    handled = true
  } else if (e.key === 'ArrowUp' || e.key === 'k') {
    kbIndex = kbIndex > 0 ? kbIndex - 1 : items.length - 1
    handled = true
  } else if (e.key === 'Enter' && kbIndex >= 0 && kbIndex < items.length) {
    items[kbIndex].click()
    handled = true
  }

  if (handled) {
    e.preventDefault()
    updateKbHighlight(items)
  }
}

function updateKbHighlight(items) {
  items.forEach((item, i) => {
    item.classList.toggle('kb-highlight', i === kbIndex)
  })
  // Scroll highlighted item into view if needed
  if (kbIndex >= 0 && items[kbIndex]) {
    items[kbIndex].scrollIntoView({ block: 'nearest' })
  }
}
```

**4. Reset highlight on re-render (inside `renderList()`, at the start around line 37):**

Add `kbIndex = -1;` at the top of `renderList()` (after the early return guard) so the highlight resets when the list is rebuilt (e.g., after switching workspaces or deleting one).

**Key design decisions:**
- Uses `.click()` on Enter to reuse the existing click handler logic (which already handles active/in-use/unassigned window states, ctrl+click, etc.) rather than duplicating that branching logic.
- Wraps around at boundaries (down on last item goes to first, up on first goes to last).
- The `e.preventDefault()` on handled keys prevents ArrowDown/ArrowUp from scrolling the popup body independently of the highlight.
- Modal guard checks both the modal hidden class and activeElement tag, covering both the edit modal and any future input scenarios.
  </action>
  <verify>
    <automated>cd /home/jaeho/simple-workspaces && grep -c "onKeyNav" src/popup/popup.js && grep -c "kbIndex" src/popup/popup.js && grep -c "kb-highlight" src/popup/popup.js</automated>
  </verify>
  <done>Keyboard navigation fully functional: j/ArrowDown moves highlight down, k/ArrowUp moves highlight up (both wrapping), Enter activates highlighted item via click. Navigation inactive when modal is open or input is focused. Highlight resets on list re-render.</done>
</task>

</tasks>

<verification>
1. Open the extension popup (click icon or Alt+Shift+W)
2. Press j or ArrowDown — first workspace item gets blue outline highlight
3. Press j/ArrowDown again — highlight moves to next item, wraps at bottom
4. Press k or ArrowUp — highlight moves up, wraps at top
5. Press Enter on a non-active workspace — switches to that workspace
6. Open edit modal (click edit button) — press j/k, nothing happens (modal guard works)
7. Close modal — j/k navigation resumes
</verification>

<success_criteria>
- Arrow keys and hjkl navigate workspace list with visible highlight
- Enter activates the highlighted workspace (switch, focus, or open in new window depending on state)
- No interference with modal input or edit-name field
- Highlight wraps around at list boundaries
- Highlight resets when list is re-rendered
</success_criteria>

<output>
After completion, create `.planning/quick/260324-kzp-add-hjkl-and-arrow-key-navigation-to-wor/260324-kzp-SUMMARY.md`
</output>
