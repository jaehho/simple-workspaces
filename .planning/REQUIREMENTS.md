# Requirements: Simple Workspaces

**Defined:** 2026-03-23
**Core Value:** Workspaces reliably preserve and restore tab groups without losing data — even across windows, restarts, and reinstalls.

## v1.1 Requirements

Requirements for v1.1 Hardening & Tab Movement. Each maps to roadmap phases.

### Tech Debt

- [ ] **DEBT-01**: Storage validation is applied on the `readFromLocal()` fallback path, preventing corrupted data from reaching callers
- [ ] **DEBT-02**: Circular dependency between state.js and workspaces.js is eliminated without behavior change

### Context Menu

- [ ] **MENU-01**: User can right-click selected tab(s) and see a "Move to Workspace" submenu listing each existing workspace
- [ ] **MENU-02**: Moving tabs via context menu removes them from the source workspace, adds them to the target, and switches to the target workspace
- [ ] **MENU-03**: Context menu workspace list updates dynamically when workspaces are created, renamed, or deleted
- [ ] **MENU-04**: Multi-tab selection (Ctrl+click / Shift+click on tabs) is respected — all highlighted tabs move together

### Window Management

- [ ] **WIN-01**: Clicking a workspace from an unassigned window opens it in a new window instead of overriding the current window
- [ ] **WIN-02**: "Assign Here" buttons and unassigned-window banner are removed from the popup UI
- [ ] **WIN-03**: User can middle-click a workspace to open it in a new window (from any window state)
- [ ] **WIN-04**: User can Ctrl+click a workspace to open it in a new window (from any window state)

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Testing

- **TEST-01**: Automated test suite for core workspace operations
- **TEST-02**: Integration tests for storage sync/local fallback

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cross-browser support (Chrome, Edge) | Firefox-only for now |
| Drag-and-drop tab reordering between workspaces | High complexity, context menu covers the use case |
| Keyboard shortcuts for workspace switching | Not requested |
| Import/export of workspaces | Not requested |
| Tab grouping within workspaces | Keep it flat |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DEBT-01 | — | Pending |
| DEBT-02 | — | Pending |
| MENU-01 | — | Pending |
| MENU-02 | — | Pending |
| MENU-03 | — | Pending |
| MENU-04 | — | Pending |
| WIN-01 | — | Pending |
| WIN-02 | — | Pending |
| WIN-03 | — | Pending |
| WIN-04 | — | Pending |

**Coverage:**
- v1.1 requirements: 10 total
- Mapped to phases: 0
- Unmapped: 10

---
*Requirements defined: 2026-03-23*
*Last updated: 2026-03-23 after initial definition*
