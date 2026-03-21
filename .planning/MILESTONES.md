# Milestones

## v1.0 MVP (Shipped: 2026-03-21)

**Phases completed:** 4 phases, 8 plans, 14 tasks

**Key accomplishments:**

- MV3 manifest with module background, storage.session throttle replacing setTimeout debounce, and background.js split into four ES modules (index.js, state.js, workspaces.js, messaging.js)
- Sender validation with dev-mode logging via browser.management.getSelf(), color hex validation with HEX_COLOR_RE regex, and SVG icon construction via createElementNS eliminating all innerHTML from the codebase
- validateWorkspaceData guard on every storage.local.get call site in workspaces.js and index.js; genId() deleted and replaced with crypto.randomUUID() at both workspace creation sites
- switchWorkspace made atomic via snapshot-before-mutation, count-based failure detection, and rollbackSwitch helper that closes partial tabs and restores storage on failure
- Per-window workspace tracking via storage.session windowMap — all background functions accept explicit windowId, no currentWindow: true, exclusive ownership enforced, per-window badge and restart reclaim implemented
- popup.js acquires windowId at startup and passes it in every message; workspaces active in other windows show a dual-window icon indicator; clicking in-use workspace focuses that window; unassigned windows show a banner with "Assign Here" inline buttons; all CSS tokens match UI-SPEC
- sync-first storage abstraction with chunked workspace schema, 90% quota fallback, and idempotent local-to-sync migration
- All 19 direct browser.storage.local workspace call sites replaced with sync.js abstraction — workspaces.js, index.js, and messaging.js now use getWorkspaces()/saveWorkspaces(), with migrateIfNeeded() wired into onInstalled and onStartup lifecycle hooks.

---
