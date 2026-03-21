# Roadmap: Simple Workspaces

## Overview

This milestone hardens an existing Firefox extension for AMO publishing. The core workspace UI already works; the work is correctness, security, and data portability. Four phases execute in strict dependency order: MV3 migration and security hardening first (foundation for everything else), then atomic workspace switching (data integrity), then per-window workspace tracking (correctness), then Firefox Sync migration (data portability). Each phase delivers one complete, verifiable capability on top of the previous.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: MV3 and Security** - Migrate to Manifest V3 and eliminate all AMO security review blockers
- [ ] **Phase 2: Data Integrity** - Make workspace switching atomic with rollback and storage validation
- [ ] **Phase 3: Multi-Window Tracking** - Each browser window independently tracks its own active workspace
- [ ] **Phase 4: Firefox Sync** - Migrate primary storage to browser.storage.sync with quota-safe fallback

## Phase Details

### Phase 1: MV3 and Security
**Goal**: Extension passes AMO review — Manifest V3 compliant, no security vulnerabilities, non-persistent background correctly structured
**Depends on**: Nothing (first phase)
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, DATA-05
**Success Criteria** (what must be TRUE):
  1. `web-ext lint` reports zero errors on the MV3 manifest
  2. Popup SVG icons render correctly using DOM APIs with no innerHTML anywhere in the codebase
  3. Background script rejects messages from non-extension origins (sender URL not `moz-extension://`)
  4. Workspace color values that are not valid hex format are rejected before any CSS is applied
  5. In-memory switch lock and debounce state persists correctly across background page unloads via `storage.session`
**Plans**: TBD

### Phase 2: Data Integrity
**Goal**: Workspace switching never loses tabs — atomic create-then-delete with rollback on failure and schema validation on every storage read
**Depends on**: Phase 1
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04
**Success Criteria** (what must be TRUE):
  1. If a tab creation fails mid-switch, all partially-created tabs are closed and the original workspace tabs remain open
  2. Workspace data that fails schema validation on read triggers automatic recovery to a safe default state rather than a crash or silent corruption
  3. Workspace IDs are UUID format (`crypto.randomUUID()`) — no `Date.now()` or `Math.random()` patterns remain
**Plans**: TBD

### Phase 3: Multi-Window Tracking
**Goal**: Each browser window independently tracks its own active workspace — no cross-window corruption possible
**Depends on**: Phase 2
**Requirements**: WIN-01, WIN-02, WIN-03, WIN-04, WIN-05, WIN-06
**Success Criteria** (what must be TRUE):
  1. Opening two windows with different workspaces active — switching tabs in Window A does not change the workspace state displayed in Window B's popup
  2. Popup shows which workspaces are active in other open windows
  3. User can click a workspace owned by another window to switch focus to that window
  4. Each window's toolbar badge shows its own active workspace initial independently
**Plans**: TBD

### Phase 4: Firefox Sync
**Goal**: Workspaces survive reinstalls and sync across devices via Firefox account, with graceful fallback when sync quota is exceeded
**Depends on**: Phase 3
**Requirements**: SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05
**Success Criteria** (what must be TRUE):
  1. After reinstalling the extension with the same Firefox account logged in, all previously created workspaces are restored
  2. A workspace with 40 tabs saves and loads correctly without quota errors
  3. When sync quota is exceeded, the extension silently falls back to `storage.local` without data loss
  4. Existing workspaces from `storage.local` are automatically migrated to `storage.sync` on first run after update
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. MV3 and Security | 0/TBD | Not started | - |
| 2. Data Integrity | 0/TBD | Not started | - |
| 3. Multi-Window Tracking | 0/TBD | Not started | - |
| 4. Firefox Sync | 0/TBD | Not started | - |
