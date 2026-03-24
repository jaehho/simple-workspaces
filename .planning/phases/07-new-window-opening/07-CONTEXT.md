# Phase 7: New-Window Opening - Context

**Gathered:** 2026-03-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can open any workspace in a new window — either by clicking from an unassigned window or by using a modifier key (Ctrl+click) in the popup. The "Assign Here" button and unassigned-window banner are removed. Middle-click also opens in a new window. If a workspace is already active in another window, any click variant focuses that window instead.

</domain>

<decisions>
## Implementation Decisions

### Already-open workspace conflict
- **D-01:** If a workspace is already active in another window, always focus that window — regardless of how the user clicked (regular click, middle-click, Ctrl+click, or from unassigned window)
- **D-02:** No new window is created for already-active workspaces. Exclusive ownership rule stays intact.
- **D-03:** Popup closes naturally when focusing the existing window — no extra visual feedback

### Unassigned window popup appearance
- **D-04:** Remove the "No workspace assigned" banner entirely (WIN-02)
- **D-05:** Remove all "Assign Here" buttons from the popup (WIN-02)
- **D-06:** Keep "Workspaces" as the popup title in both assigned and unassigned windows
- **D-07:** Add a subtitle line below the title that varies by window state:
  - Unassigned window: "Click to open in new window"
  - Assigned window: "Ctrl+click to open in new window"
- **D-08:** Subtitle is the sole discoverability mechanism — no tooltips on workspace items

### Click behavior by window state
- **D-09:** From unassigned window: regular click opens workspace in a new window (WIN-01). Current window left untouched.
- **D-10:** From assigned window: regular click switches workspace in current window (existing behavior, unchanged)
- **D-11:** From any window: middle-click opens workspace in a new window (WIN-03)
- **D-12:** From any window: Ctrl+click opens workspace in a new window (WIN-04)
- **D-13:** Ctrl+clicking or middle-clicking the workspace that is active in the current window does nothing (ignored)

### Feedback and UX
- **D-14:** No extra feedback for new-window open — popup closes, new window appears naturally
- **D-15:** Subtitle mentions only Ctrl+click, not middle-click — middle-click is a power user affordance

### Claude's Discretion
- New window size/state (maximized, normal, inherit from current)
- Tab creation order and discarded-tab optimization in new window
- Whether to focus the new window or keep focus on the current one
- Error handling if window creation fails
- How to handle the default about:newtab tab that Firefox creates in new windows

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<canonical_refs>
## Canonical References

### Requirements
- `.planning/REQUIREMENTS.md` — WIN-01 through WIN-04 define the four window management requirements

### Roadmap
- `.planning/ROADMAP.md` §Phase 7 — Success criteria (4 conditions that must be TRUE)

### Prior phase decisions
- `.planning/phases/06-context-menu/06-CONTEXT.md` — D-01/D-02 established that already-active workspaces focus their window; cross-window move patterns are documented

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `switchWorkspace()` in `workspaces.js`: Tab creation pattern (lines 147-178) — create first tab active, rest discarded, fallback without discarded flag. Reuse for populating new window.
- `updateBadge()` in `workspaces.js`: Per-window badge update — call for new window after creation
- `serializeTabs()` in `workspaces.js`: Tab filtering/normalization — reuse if saving state before open
- `getWindowMap()` / `setWindowEntry()` in `state.js`: Per-window workspace tracking — call `setWindowEntry(newWindowId, workspaceId)` after window creation

### Established Patterns
- **Exclusive ownership check** in `switchWorkspace()` (lines 110-117): Iterates windowMap to find if target is active elsewhere — reuse same check for new-window open to decide focus-vs-create
- **Atomic operations with `isSwitching` flag**: Prevents saves during transitions — apply same guard during new-window creation
- **Message routing** in `messaging.js`: Action-based switch statement — add `openWorkspaceInNewWindow` case

### Integration Points
- `manifest.json`: May need `windows` permission (verify if Firefox requires it explicitly)
- `popup.js` lines 52-84: Banner rendering — remove entirely
- `popup.js` lines 133-143: "Assign Here" button creation — remove entirely
- `popup.js` lines 172-180: Click handler — add modifier detection (ctrlKey) and unassigned-window logic
- `popup.js`: Add `auxclick` listener for middle-click (button === 1)
- `messaging.js`: New action `openWorkspaceInNewWindow`
- `workspaces.js`: New exported function for opening workspace in new window via `browser.windows.create()`
- No existing `browser.windows.create()` usage in codebase — this is a new API surface

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 07-new-window-opening*
*Context gathered: 2026-03-24*
