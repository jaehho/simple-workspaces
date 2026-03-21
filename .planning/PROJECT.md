# Simple Workspaces

## What This Is

A Firefox extension that lets users organize browser tabs into named, color-coded workspaces they can switch between. Currently functional but fragile — this milestone hardens the extension, adds multi-window awareness, migrates storage to sync with the user's Firefox account, and fixes known bugs including data loss risks.

## Core Value

Workspaces reliably preserve and restore tab groups without losing data — even across windows, restarts, and reinstalls.

## Requirements

### Validated

- ✓ Create, edit, and delete named color-coded workspaces — existing
- ✓ Switch between workspaces (saves current tabs, restores target) — existing
- ✓ Visual indicator of active workspace in popup — existing
- ✓ Badge shows active workspace initial on toolbar icon — existing
- ✓ Debounced auto-save of tab changes — existing
- ✓ Manifest V3 migration — Validated in Phase 1: mv3-and-security
- ✓ Fix innerHTML XSS in popup SVG icons — Validated in Phase 1: mv3-and-security
- ✓ Add message sender validation in background script — Validated in Phase 1: mv3-and-security
- ✓ Fix color value validation (prevent CSS injection) — Validated in Phase 1: mv3-and-security
- ✓ Fix race condition in workspace switching (atomic with rollback) — Validated in Phase 2: data-integrity
- ✓ Fix data loss on failed switch (snapshot restore on failure) — Validated in Phase 2: data-integrity
- ✓ Add storage validation and corruption recovery — Validated in Phase 2: data-integrity
- ✓ Improve ID generation (crypto.randomUUID) — Validated in Phase 2: data-integrity

### Active

- [ ] Multi-window awareness: show which window owns a workspace, switch to or close that window
- [ ] Storage migration from `browser.storage.local` to `browser.storage.sync` (with local fallback for quota)

### Out of Scope

- Cross-browser support (Chrome, Edge) — Firefox-only for now
- Cloud sync beyond Firefox Sync — `browser.storage.sync` is sufficient
- Tab grouping within workspaces — keep it flat
- Keyboard shortcuts — not requested
- Import/export of workspaces — not requested
- Automated test suite — valuable but not in this milestone

## Context

- Extension code split into ES modules: background/ (index.js, state.js, workspaces.js, messaging.js), popup/ (popup.js, popup.html, popup.css)
- Manifest V3 compliant — AMO publishing unblocked
- Codebase map exists at `.planning/codebase/`
- Single global `activeWorkspaceId` causes silent corruption when multiple windows are open
- `switchWorkspace()` is now atomic — snapshot rollback restores state on partial tab creation failure
- Current storage (`browser.storage.local`) survives restarts but not reinstalls
- `browser.storage.sync` quota is 100KB total — workspace metadata is small enough but needs quota monitoring
- No automated tests exist

## Constraints

- **Platform**: Firefox WebExtension APIs only
- **Storage**: Must use `browser.storage.sync` as primary, `browser.storage.local` as fallback
- **Manifest**: Must be Manifest V3 compatible for AMO publishing
- **Security**: No innerHTML, validate all data from storage and messages

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use browser.storage.sync over IndexedDB | Ties to Firefox account, survives reinstalls, syncs across devices | — Pending |
| Migrate to Manifest V3 | V2 deprecated, blocks AMO publishing | ✓ Phase 1 |
| Per-window workspace tracking | Global activeWorkspaceId causes multi-window corruption | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-21 after Phase 2 completion*
