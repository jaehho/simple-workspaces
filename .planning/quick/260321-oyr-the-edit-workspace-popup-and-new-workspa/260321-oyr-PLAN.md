---
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/popup/popup.css
  - src/popup/popup.js
autonomous: false
must_haves:
  truths:
    - "Edit workspace modal is fully visible including title, inputs, color picker, and action buttons"
    - "New workspace modal is fully visible including title, inputs, color picker, and action buttons"
    - "Modal visibility fix works regardless of how many workspaces exist in the list"
    - "Closing the modal restores normal popup sizing"
  artifacts:
    - path: "src/popup/popup.css"
      provides: "body.modal-open min-height rule"
      contains: "body.modal-open"
    - path: "src/popup/popup.js"
      provides: "modal-open class toggling on body"
      contains: "modal-open"
  key_links:
    - from: "src/popup/popup.js"
      to: "src/popup/popup.css"
      via: "body.modal-open class toggle"
      pattern: "classList.*(add|remove).*modal-open"
---

<objective>
Fix edit workspace and new workspace modals being cut off in the Firefox extension popup.

Purpose: The modal uses `position: fixed; inset: 0` to overlay the popup viewport, but since fixed-position elements are removed from document flow, they do not contribute to the popup's height calculation. When the workspace list is short, Firefox sizes the popup small and the modal content gets clipped — the title and/or action buttons are not visible.

Output: Both modals display fully within the popup viewport regardless of workspace list length.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/popup/popup.css
@src/popup/popup.js
@src/popup/popup.html
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add CSS min-height rule and JS class toggling for modal visibility</name>
  <files>src/popup/popup.css, src/popup/popup.js</files>
  <action>
**CSS change in `src/popup/popup.css`:**

Add a `body.modal-open` rule in the Modal section (after the existing `body` rule or near the `.modal` rules around line 210). The rule must set a `min-height` that guarantees enough viewport space for the modal content to render fully. The modal-content has ~18px padding top/bottom, ~14px h2, ~12px label margin, ~30px input, ~26px color swatches + 16px margin, ~30px buttons = roughly 300px of content height. Use `min-height: 350px` to provide comfortable clearance:

```css
body.modal-open {
  min-height: 350px;
}
```

Place this rule immediately after the existing `body { ... }` block (after line 15) so it is co-located with body styling.

**JS changes in `src/popup/popup.js`:**

1. In `openEditModal()` (line 247): Add `document.body.classList.add('modal-open')` as the first line of the function body, before any other operations.

2. In `openCreateModal()` (line 259): Add `document.body.classList.add('modal-open')` as the first line of the function body, before any other operations.

3. In `closeModal()` (line 271): Add `document.body.classList.remove('modal-open')` after hiding the modal (after the classList.add('hidden') line), before setting `editingId = null`.

Do NOT change any other behavior. The class must be added BEFORE the modal is shown (classList.remove('hidden')) to ensure Firefox recalculates the popup height before rendering the modal overlay.
  </action>
  <verify>
    <automated>cd /home/jaeho/simple-workspaces && grep -n 'modal-open' src/popup/popup.css src/popup/popup.js</automated>
  </verify>
  <done>
    - `body.modal-open { min-height: 350px; }` exists in popup.css
    - `document.body.classList.add('modal-open')` appears in both `openEditModal` and `openCreateModal` functions
    - `document.body.classList.remove('modal-open')` appears in `closeModal` function
    - No other behavioral changes introduced
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Verify modals display fully in Firefox popup</name>
  <files>src/popup/popup.css, src/popup/popup.js</files>
  <action>
User visually verifies that both the New Workspace and Edit Workspace modals are fully visible within the Firefox extension popup, with no content clipped or cut off.
  </action>
  <verify>Manual visual inspection in Firefox</verify>
  <done>Both modals show all content (title, input, color picker, buttons) without cutoff</done>
</task>

</tasks>

<verification>
- `grep -n 'modal-open' src/popup/popup.css` shows the min-height rule
- `grep -n 'modal-open' src/popup/popup.js` shows add in both open functions and remove in closeModal
- `npx eslint src/popup/popup.js src/popup/popup.css` passes without errors
- `npx addons-linter src/` passes without new errors
</verification>

<success_criteria>
Edit and New Workspace modals are fully visible (title, input, color picker, action buttons) regardless of how many workspaces exist in the list. Closing the modal restores the popup to its normal sizing behavior.
</success_criteria>

<output>
After completion, create `.planning/quick/260321-oyr-the-edit-workspace-popup-and-new-workspa/260321-oyr-SUMMARY.md`
</output>
