# Roadmap: Simple Workspaces

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-03-21)
- **v1.1 Hardening & Tab Movement** — Phases 5-7 (active)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-4) — SHIPPED 2026-03-21</summary>

- [x] Phase 1: MV3 and Security (2/2 plans) — completed 2026-03-21
- [x] Phase 2: Data Integrity (2/2 plans) — completed 2026-03-21
- [x] Phase 3: Multi-Window Tracking (2/2 plans) — completed 2026-03-21
- [x] Phase 4: Firefox Sync (2/2 plans) — completed 2026-03-21

</details>

### v1.1 Hardening & Tab Movement

- [x] **Phase 5: Module Integrity** - Eliminate circular dependency and close the storage validation gap on the local fallback path (completed 2026-03-24)
- [ ] **Phase 6: Context Menu** - Right-click "Move to Workspace" submenu with multi-tab selection support
- [ ] **Phase 7: New-Window Opening** - Open workspaces in new windows from unassigned windows and via modifier clicks

## Phase Details

### Phase 5: Module Integrity
**Goal**: The module graph is acyclic and all storage read paths validate data before returning it to callers
**Depends on**: Nothing (first phase of v1.1)
**Requirements**: DEBT-01, DEBT-02
**Success Criteria** (what must be TRUE):
  1. The extension loads and operates identically to before — no behavior change is observable
  2. When `browser.storage.sync` fails and `readFromLocal()` is used, corrupted or partial workspace data is rejected rather than passed to callers
  3. Adding new imports to `state.js` or `workspaces.js` does not risk initialization-order errors — the circular dependency is gone
**Plans:** 1/1 plans complete
Plans:
- [x] 05-01-PLAN.md — Break circular dependency and close local fallback validation gap

### Phase 6: Context Menu
**Goal**: Users can right-click any tab and move it (or a multi-tab selection) to a different workspace via a submenu
**Depends on**: Phase 5
**Requirements**: MENU-01, MENU-02, MENU-03, MENU-04
**Success Criteria** (what must be TRUE):
  1. Right-clicking any tab in the Firefox tab strip shows a "Move to Workspace" submenu listing all workspaces except the one currently active in that window
  2. Clicking a workspace in the submenu moves the right-clicked tab to that workspace and switches to it
  3. When multiple tabs are selected (Ctrl+click or Shift+click), all highlighted tabs move together as a group — not just the right-clicked one
  4. After creating, renaming, or deleting a workspace, the submenu reflects the updated list the next time it is opened
**Plans**: TBD

### Phase 7: New-Window Opening
**Goal**: Users can open any workspace in a new window — either by clicking from an unassigned window or by using a modifier key in the popup
**Depends on**: Phase 5
**Requirements**: WIN-01, WIN-02, WIN-03, WIN-04
**Success Criteria** (what must be TRUE):
  1. Clicking a workspace from an unassigned window opens it in a new window; the current unassigned window is left untouched
  2. The "Assign Here" button and the unassigned-window banner are no longer visible in the popup
  3. Middle-clicking a workspace in the popup opens it in a new window regardless of the current window's assignment state
  4. Ctrl+clicking a workspace in the popup opens it in a new window without switching the current window's workspace
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. MV3 and Security | v1.0 | 2/2 | Complete | 2026-03-21 |
| 2. Data Integrity | v1.0 | 2/2 | Complete | 2026-03-21 |
| 3. Multi-Window Tracking | v1.0 | 2/2 | Complete | 2026-03-21 |
| 4. Firefox Sync | v1.0 | 2/2 | Complete | 2026-03-21 |
| 5. Module Integrity | v1.1 | 1/1 | Complete   | 2026-03-24 |
| 6. Context Menu | v1.1 | 0/? | Not started | - |
| 7. New-Window Opening | v1.1 | 0/? | Not started | - |
