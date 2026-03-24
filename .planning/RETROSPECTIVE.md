# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-03-21
**Phases:** 4 | **Plans:** 8 | **Tasks:** 14

### What Was Built
- Manifest V3 migration with modular ES background (4 modules → 5 with sync.js)
- Security hardening: sender validation, hex color validation, SVG DOM construction (zero innerHTML)
- Atomic workspace switching with snapshot rollback — eliminates tab loss on failure
- Per-window workspace tracking with in-use indicators, focus-window, and per-window badges
- Firefox Sync storage with chunked schema, 90% quota fallback, and idempotent migration

### What Worked
- Strict phase dependency ordering (MV3 → integrity → multi-window → sync) prevented rework
- Module split in Phase 1 paid off immediately — Phases 2-4 touched only their target modules
- Throttle-first save pattern eliminated the class of "dropped saves on background unload" bugs
- GSD workflow kept scope tight — no feature creep across 4 phases

### What Was Inefficient
- Phase 3 SUMMARY.md frontmatter was incomplete (requirements_completed empty) — caught only at audit
- validateWorkspaceData wiring was undone by Phase 4 rewiring — integration gap detected at audit, not during execution
- UI-SPEC for Phase 3 required two revision rounds before passing checker

### Patterns Established
- `sync.js` as sole storage abstraction — callers never touch browser.storage directly
- `storage.session` for per-session state (window map, switch lock) that must not sync
- Explicit `windowId` parameter threading through all background functions
- Message-based architecture preserved (popup → messaging → workspaces → sync)

### Key Lessons
1. Cross-phase integration gaps (like DATA-03 weakened by Phase 4) are invisible during per-phase execution — milestone audit catches them
2. Module boundaries established early (Phase 1 split) dramatically reduce merge risk in later phases
3. Chunking strategy for storage.sync should be designed with empirical testing, not theoretical limits
4. Non-persistent background (MV3) fundamentally changes state management — must be Phase 1

### Cost Observations
- Model mix: balanced profile throughout
- Sessions: ~8 sessions across 4 phases
- Notable: All 4 phases completed in a single day — tight scope and clear dependencies kept velocity high

---

## Milestone: v1.1 — Hardening & Tab Movement

**Shipped:** 2026-03-24
**Phases:** 3 | **Plans:** 5 | **Tasks:** 11

### What Was Built
- Circular dependency elimination and local fallback validation gap closure (module integrity)
- "Move to Workspace" right-click context menu with dynamic MRU-sorted submenu and multi-tab selection
- Open workspace in new window via unassigned-window click, Ctrl+click, or middle-click
- Removed "Assign Here" banner, replaced with context-sensitive subtitle
- menus.js module added to background/ (6th module)

### What Worked
- Phase 5 (tech debt) as first phase — clean module graph made Phases 6-7 straightforward
- Wave-based execution for Phase 7 — backend (Wave 1) completed before popup UI (Wave 2) needed it
- Human-verify checkpoint in Phase 7 caught the right moment for end-to-end testing
- All 3 phases completed in a single day — tight scope continued from v1.0

### What Was Inefficient
- Skipped milestone audit — no cross-phase integration check before completion
- Phase 5 feat commits used `refactor()` and `fix()` prefixes instead of `feat(05-01)` — made git range analysis harder

### Patterns Established
- `lastUsedAt` MRU timestamp on workspaces — consumed by context menu and available for future sort UIs
- Instance ID guard pattern in menus.onShown — prevents stale async overwrites
- Exclusive ownership check — reused pattern from windowMap to prevent duplicate workspace windows
- Active-workspace guard on all modifier click paths — prevents no-op new-window opens

### Key Lessons
1. Tech debt phases as milestone openers are effective — they create a clean foundation before feature work
2. Modifier key routing (Ctrl+click, middle-click) needs careful `preventDefault()` to avoid browser defaults (context menu, autoscroll)
3. Dynamic context menus via onShown are preferable to static menus for any data that changes at runtime

### Cost Observations
- Model mix: balanced profile (sonnet for subagents, opus for orchestrator)
- Sessions: ~3 sessions across 3 phases
- Notable: Entire milestone completed in one day, same as v1.0

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~8 | 4 | Established GSD workflow, module boundaries, sync abstraction |
| v1.1 | ~3 | 3 | Tech debt first, wave-based execution, human-verify checkpoints |

### Cumulative Quality

| Milestone | Tests | Coverage | Tech Debt Items |
|-----------|-------|----------|-----------------|
| v1.0 | 0 | 0% | 5 (1 medium, 2 low, 2 info) |
| v1.1 | 0 | 0% | 3 resolved, 0 new |

### Top Lessons (Verified Across Milestones)

1. Module boundaries in Phase 1 pay compound dividends — every subsequent phase benefits (v1.0, v1.1)
2. Milestone audit is essential — per-phase verification misses cross-phase integration gaps (v1.0)
3. Tech debt as milestone opener creates clean foundation for feature work (v1.1)
4. One-day milestones are achievable with tight scope and clear phase dependencies (v1.0, v1.1)
