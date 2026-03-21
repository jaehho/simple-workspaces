# Phase 3: Multi-Window Tracking - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Each browser window independently tracks its own active workspace — no cross-window corruption possible. Replaces the global `activeWorkspaceId` with a per-window mapping. Popup shows cross-window workspace status and lets users focus other windows. New windows start unassigned; browser restart reclaims previous assignments.

Delivers: WIN-01, WIN-02, WIN-03, WIN-04, WIN-05, WIN-06.

</domain>

<decisions>
## Implementation Decisions

### Workspace exclusivity
- **D-01:** Exclusive ownership — one workspace per window. Two windows cannot have the same workspace active simultaneously.
- **D-02:** Clicking a workspace that's active in another window focuses that window (no "take over" or "steal" option).
- **D-03:** No detection of duplicate tabs across windows — if a user manually opens the same tabs in two windows, that's their responsibility.
- **D-04:** Closing a window releases its workspace — the workspace becomes available for any window to claim.

### Popup display for other-window workspaces
- **D-05:** In-use workspaces appear in the same list (not grouped separately, not dimmed). A subtle icon indicator marks them as in use by another window.
- **D-06:** Clicking an in-use workspace focuses the owning window and closes the popup.
- **D-07:** The current window's active workspace is visually highlighted (beyond just a text label — visual treatment like background color or border, not just "active" text).

### New window behavior
- **D-08:** New windows start unassigned — no workspace, tabs are not tracked until the user explicitly assigns one.
- **D-09:** Popup in an unassigned window shows: full workspace list (with in-use indicators), option to create a new workspace, and option to move all currently open tabs in that window into a workspace.

### Browser restart reclaim
- **D-10:** On browser restart (new `windowId` values), each window attempts to reclaim its previous workspace by matching its open tabs against saved workspace tab URLs. If no match is found, the window stays unassigned.

### Claude's Discretion
- Badge display for unassigned windows (empty, "?", or nothing)
- Tab-URL matching algorithm for restart reclaim (exact match, fuzzy, threshold)
- Icon choice for "in use by another window" indicator
- Visual highlight style for current workspace (background, border, accent)
- Storage location for window-workspace mapping (storage.session vs in-memory with session backup)
- How "move tabs to workspace" works in the popup (dropdown, modal, inline action)
- Whether `windows.onFocusChanged` triggers a save or just updates badge
- Exact message actions added to the messaging router

</decisions>

<specifics>
## Specific Ideas

- "Move tabs to workspace" in unassigned window popup — lets user capture an ad-hoc window's tabs into an existing or new workspace without losing them
- Focus-on-click for in-use workspaces keeps the mental model simple: one workspace = one window, click to go there

</specifics>

<canonical_refs>
## Canonical References

### Multi-window requirements
- `.planning/REQUIREMENTS.md` — WIN-01 through WIN-06: per-window tracking, popup display, window switching, explicit windowId, focus filtering, per-window badge
- `.planning/ROADMAP.md` — Phase 3 success criteria (4 items)

### Prior phase context
- `.planning/phases/01-mv3-and-security/1-CONTEXT.md` — D-08: background split into modules (state.js, workspaces.js, messaging.js, index.js); D-01/D-03: throttle/session state pattern
- `.planning/PROJECT.md` — Key decision: per-window workspace tracking, constraint that storage.sync schema depends on this phase

### Upstream constraints
- `.planning/STATE.md` — Blocker note: Phase 4 sync schema depends on window-workspace association schema finalized here
- `.planning/ROADMAP.md` — Phase 4 depends on Phase 3; window-workspace mapping must be stable before sync migration

No external specs — requirements are fully captured in decisions above and REQUIREMENTS.md.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `state.js` session state pattern: `getSessionState()` / `setSessionState()` — can extend to store window-workspace mapping in `storage.session`
- `workspaces.js` `validateWorkspaceData()`: schema validation — needs update to handle per-window mapping instead of global `activeWorkspaceId`
- `workspaces.js` `serializeTabs()`: tab serialization — reusable as-is for restart reclaim matching
- `popup.js` `makeSvgIcon()`: SVG icon helper — reusable for "in use" indicator icon
- `popup.js` `renderList()`: workspace list renderer — needs modification for in-use indicators and highlighted active state

### Established Patterns
- Message-based popup-to-background communication via action routing — extend with new actions for window-aware state
- `[Workspaces]` console prefix — maintain for new logging
- Throttled save via `state.js` — save logic needs window context (which window's workspace to update)
- `sanitizeColor()` / `HEX_COLOR_RE` validation — unchanged

### Integration Points
- `saveCurrentWorkspace()` (workspaces.js:77): uses `currentWindow: true` — must accept explicit `windowId`
- `switchWorkspace()` (workspaces.js:104): uses `currentWindow: true` — must scope to specific window
- `initDefaultWorkspace()` (workspaces.js:55): uses `currentWindow: true` — may need window-aware variant
- `updateBadge()` (workspaces.js:298): sets badge globally — must use `{ windowId }` parameter for per-window badges
- `handleMessage()` (messaging.js:11): `getState` returns global `activeWorkspaceId` — must return per-window state including other windows' assignments
- Tab event listeners (index.js:10-21): `throttledSave()` has no window context — tab events provide `windowId` in their info objects
- `browser.action.setBadgeText/setBadgeBackgroundColor`: both accept `{ windowId }` parameter for per-window badges

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-multi-window-tracking*
*Context gathered: 2026-03-21*
