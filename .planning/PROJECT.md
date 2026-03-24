# Simple Workspaces

## What This Is

A Firefox extension that lets users organize browser tabs into named, color-coded workspaces they can switch between. Hardened for production: MV3 compliant, atomic switching with rollback, per-window workspace tracking, Firefox Sync storage, context menu tab movement, and new-window opening via click modifiers.

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
- ✓ Multi-window awareness: show which window owns a workspace, switch to or close that window — Validated in Phase 3: multi-window-tracking
- ✓ Storage migration from `browser.storage.local` to `browser.storage.sync` (with local fallback for quota) — Validated in Phase 4: firefox-sync
- ✓ Fix validateWorkspaceData not called on readFromLocal() fallback path — Validated in Phase 5: module-integrity
- ✓ Resolve circular dependency state.js <-> workspaces.js — Validated in Phase 5: module-integrity
- ✓ Context menu "Move to {workspace}" for selected tabs (moves tabs + switches) — Validated in Phase 6: context-menu
- ✓ Clicking workspace from unassigned window opens in new window (remove "Assign Here") — Validated in Phase 7: new-window-opening
- ✓ Middle-click or Ctrl+click workspace to open in new window — Validated in Phase 7: new-window-opening

### Active

(No active requirements — all v1.1 requirements validated)

### Out of Scope

- Cross-browser support (Chrome, Edge) — Firefox-only for now
- Cloud sync beyond Firefox Sync — `browser.storage.sync` is sufficient
- Tab grouping within workspaces — keep it flat
- Keyboard shortcuts — not requested
- Import/export of workspaces — not requested
- Automated test suite — valuable but not in this milestone

## Current State

**Shipped v1.1** — all planned features delivered. No active milestone.

## Context

**Shipped v1.1** with 1,833 LOC (JS + HTML + CSS) across 7 phases, 13 plans (2 milestones).

- Extension code split into ES modules: background/ (index.js, state.js, workspaces.js, messaging.js, sync.js, menus.js), popup/ (popup.js, popup.html, popup.css)
- Manifest V3 compliant — AMO publishing unblocked
- Per-window workspace tracking via `windowWorkspaces` session map — each window owns its workspace independently
- `switchWorkspace()` is atomic — snapshot rollback restores state on partial tab creation failure
- Storage uses `browser.storage.sync` as primary with automatic `browser.storage.local` fallback at 90% quota
- Chunked sync schema: workspace metadata + tab chunks (25 tabs/chunk, favIconUrl stripped to save space)
- `migrateIfNeeded()` runs on update/startup — existing local data migrated idempotently
- Module graph is acyclic — state.js has zero project imports
- Right-click "Move to Workspace" context menu with MRU-sorted submenu, multi-tab selection, cross-window move
- Open workspace in new window via unassigned-window click, Ctrl+click, or middle-click
- No automated tests exist

## Constraints

- **Platform**: Firefox WebExtension APIs only
- **Storage**: Must use `browser.storage.sync` as primary, `browser.storage.local` as fallback
- **Manifest**: Must be Manifest V3 compatible for AMO publishing
- **Security**: No innerHTML, validate all data from storage and messages

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use browser.storage.sync over IndexedDB | Ties to Firefox account, survives reinstalls, syncs across devices | ✓ Good — v1.0 |
| Migrate to Manifest V3 | V2 deprecated, blocks AMO publishing | ✓ Good — v1.0 |
| Per-window workspace tracking | Global activeWorkspaceId causes multi-window corruption | ✓ Good — v1.0 |
| Split background.js into 4 ES modules | Clean boundaries for multi-phase work | ✓ Good — v1.0 |
| Throttle-first save (500ms suppression) | Eliminates dropped saves on MV3 background unload | ✓ Good — v1.0 |
| Atomic switch with snapshot rollback | Prevents tab loss on partial switch failure | ✓ Good — v1.0 |
| Chunked sync schema (25 tabs/chunk, no favIconUrl) | Stays under 8KB per-item limit for storage.sync | ✓ Good — v1.0 |
| storage.session for window map + switch lock | Per-session state survives background unloads, never syncs | ✓ Good — v1.0 |
| Move throttledSave to workspaces.js to break circular dep | state.js becomes zero-import; no initialization-order risk | ✓ Good — v1.1 |
| Storage module (sync.js) owns schema validation | Validation lives beside the data it protects | ✓ Good — v1.1 |
| menus.onShown dynamic rebuild (not static items) | MRU order and [open] labels stay current without stale data | ✓ Good — v1.1 |
| Instance ID guard in onShown handler | Prevents stale async fetch from overwriting newer menu open | ✓ Good — v1.1 |
| Exclusive ownership check in openWorkspaceInNewWindow | If workspace already open elsewhere, focus that window instead of creating duplicate | ✓ Good — v1.1 |
| Rollback via browser.windows.remove on partial tab creation | Prevents orphan empty windows when tab creation fails | ✓ Good — v1.1 |

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
*Last updated: 2026-03-24 after v1.1 milestone complete*
