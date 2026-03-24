# Phase 6: Context Menu - Context

**Gathered:** 2026-03-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Right-click "Move to Workspace" submenu with multi-tab selection support. Users can right-click any tab and move it (or a multi-tab selection) to a different workspace via a submenu. Creating new workspaces, drag-and-drop reordering, and keyboard shortcuts are separate concerns.

</domain>

<decisions>
## Implementation Decisions

### Cross-window move behavior
- **D-01:** Workspaces active in another window ARE shown in the submenu (not hidden or grayed out)
- **D-02:** Moving tabs to a workspace active in another window physically moves the tabs to that window immediately (using `browser.tabs.move()`) and focuses that window
- **D-03:** Source workspace loses the moved tabs; user ends up viewing the target window

### Tab state preservation
- **D-04:** Tabs must preserve their state on move — same behavior as dragging a tab between windows (no reload, no loss of form data, scroll position, or media playback)
- **D-05:** Use `browser.tabs.move()` for cross-window moves to achieve seamless behavior
- **D-06:** For same-window moves (move + switch), keep the moved tabs alive during the workspace switch rather than closing and recreating them
- **D-07:** If keeping tabs alive during same-window switch adds significant complexity, start with reload approach and optimize later

### Empty source workspace
- **D-08:** Moving all tabs out of a workspace leaves it with an empty tab list (about:newtab placeholder on next restore) — do not prevent or auto-delete
- **D-09:** Move operation should be atomic with rollback, consistent with existing `switchWorkspace()` safety pattern

### Submenu appearance
- **D-10:** Each submenu entry shows: workspace name + tab count (e.g., "Work (12 tabs)")
- **D-11:** Workspaces active in another window have a visual indicator distinguishing them from inactive workspaces
- **D-12:** Submenu entries ordered by most recently used
- **D-13:** Parent menu item labeled "Move to Workspace" — positioned inside Firefox's "Move Tab" context menu area, after the "Move to New Window" item

### Menu updates
- **D-14:** Submenu reflects current workspace list dynamically — rebuilds on workspace create, rename, or delete (per MENU-03)
- **D-15:** Active workspace for the current window is excluded from the submenu (per success criteria)

### Claude's Discretion
- Menu rebuild strategy (rebuild all items vs. incremental update)
- Exact format of the "active in another window" indicator
- Rollback implementation details for the move operation
- How to track "most recently used" ordering (timestamp field vs. derived from switch history)
- Error notification approach when moves fail
- Whether D-13's placement inside Firefox's built-in "Move Tab" menu is possible via WebExtensions API — if not, fall back to top-level tab context menu item with "Move to Workspace" submenu

</decisions>

<specifics>
## Specific Ideas

- "Tab state must be preserved — the same behavior as if I were to drag a tab from one window to another"
- Move to Workspace should feel native — placed inside the existing "Move Tab" menu in Firefox's tab context menu, right after "Move to New Window"
- Cross-window tab movement is a common use case, not an edge case — must work smoothly

</specifics>

<canonical_refs>
## Canonical References

No external specs — requirements are fully captured in decisions above and in:

### Requirements
- `.planning/REQUIREMENTS.md` — MENU-01 through MENU-04 define the four context menu requirements

### Roadmap
- `.planning/ROADMAP.md` §Phase 6 — Success criteria (4 conditions that must be TRUE)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `serializeTabs()` in `workspaces.js`: Filters and normalizes browser tabs for storage — reuse for serializing moved tabs into target workspace
- `saveWorkspaces()` in `sync.js`: Persists workspace array to sync/local storage — reuse for saving after tab move
- `getWorkspaces()` in `sync.js`: Reads current workspace list — needed for building submenu and performing moves
- `getWindowMap()` in `state.js`: Maps windowId → workspaceId — needed to identify which workspace is active where
- `updateBadge()` in `workspaces.js`: Updates toolbar badge for a window — call after move to reflect new state

### Established Patterns
- **Exclusive ownership check** in `switchWorkspace()`: Iterates `windowMap` to find if target workspace is active elsewhere — reuse pattern but allow cross-window moves instead of rejecting
- **Atomic switch with rollback** in `switchWorkspace()` + `rollbackSwitch()`: Snapshot-before, compensate-on-failure — extend pattern to move operations
- **Top-level listener registration** in `index.js`: All `browser.*` listeners registered synchronously at module top level — `browser.menus` listeners must follow same pattern for MV3 event page compatibility
- **Throttled save** via `throttledSave()`: Prevents redundant saves on rapid tab events — moves will trigger tab events, throttle must not interfere

### Integration Points
- `manifest.json`: Needs `menus` permission added
- `index.js`: Context menu creation and click handler registration (top-level, synchronous)
- `messaging.js`: May need new message action if popup needs to trigger menu rebuilds
- `workspaces.js`: New `moveTabsToWorkspace()` function (or similar) — the core move operation
- `state.js`: May need "last used" timestamp tracking for submenu ordering

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 06-context-menu*
*Context gathered: 2026-03-24*
