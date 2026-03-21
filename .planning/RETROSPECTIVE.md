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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~8 | 4 | Established GSD workflow, module boundaries, sync abstraction |

### Cumulative Quality

| Milestone | Tests | Coverage | Tech Debt Items |
|-----------|-------|----------|-----------------|
| v1.0 | 0 | 0% | 5 (1 medium, 2 low, 2 info) |

### Top Lessons (Verified Across Milestones)

1. Module boundaries in Phase 1 pay compound dividends — every subsequent phase benefits
2. Milestone audit is essential — per-phase verification misses cross-phase integration gaps
