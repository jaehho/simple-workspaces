# Project Research Summary

**Project:** Simple Workspaces — Firefox WebExtension
**Domain:** Firefox WebExtension tab/workspace management (milestone hardening)
**Researched:** 2026-03-21
**Confidence:** HIGH

## Executive Summary

Simple Workspaces is an existing Firefox extension that needs to be hardened for AMO publishing. It is not a greenfield project — the core workspace management UI and logic already exists in vanilla JS. The milestone covers five interrelated problem areas: MV3 migration (required for AMO), storage migration from `storage.local` to `storage.sync` (data portability), per-window workspace tracking (correctness), a race condition fix in the workspace switch operation (data integrity), and security hardening (XSS, message validation, color injection). These five areas have strict ordering dependencies: MV3 state-management changes must come first because they affect how all subsequent features store and retrieve state.

The recommended approach is to treat this as a hardening milestone with zero new UI features. All work happens in `background.js` and `manifest.json`; `popup.js` gets targeted fixes (innerHTML removal, windowId awareness) but no redesign. The stack stays exactly as-is — vanilla JS, `web-ext`, ESLint — with no added npm dependencies. The key architectural change is replacing the single global `activeWorkspaceId` with a `windowId → workspaceId` map stored in `storage.session`, and replacing the single `isSwitching` boolean with a per-window lock in `storage.session`. Every other change flows from this redesign.

The primary risk is sequencing: if the storage.sync migration is attempted before the per-item key design is in place, large workspaces will silently fail to save. If per-window tracking is implemented before the MV3 event-page state management is resolved, the new state will corrupt on background unload. The correct order is: (1) MV3 + security, (2) data integrity and race condition fix, (3) multi-window tracking, (4) storage.sync migration with quota fallback. Skipping or reordering these phases creates compounding bugs that are hard to isolate.

---

## Key Findings

### Recommended Stack

The existing stack requires no additions. The five change areas use only built-in Firefox WebExtension APIs, all available at the project's declared minimum of Firefox 142. No libraries are needed — the ~1,000-line extension scope makes any framework dependency disproportionate.

**Core technologies:**
- `browser.action` (MV3 replacement for `browser.browserAction`) — toolbar badge with per-window `windowId` parameter support
- `browser.storage.sync` — cross-device workspace persistence via Firefox account (102 KB total, 8 KB/item, 512 items)
- `browser.storage.session` — in-memory per-window state (`windowId → workspaceId` map, per-window switch locks); 10 MB, cleared on browser close, correct lifetime for volatile window data
- `browser.storage.local` — fallback when sync quota exceeded; already declared with `unlimitedStorage`
- `browser.sessions` (`setWindowValue`/`getWindowValue`) — secondary record for window→workspace associations that survive window close/restore within a session
- `browser.windows` API — window lifecycle events (`onCreated`, `onRemoved`, `onFocusChanged`) for per-window state management
- `crypto.randomUUID()` — replaces the current collision-prone `genId()` pattern; zero-dependency, Firefox 95+
- `web-ext` + `addons-linter` — already present; validates MV3 manifest against AMO rules

**Critical version note:** All required APIs are available in Firefox 112+ (storage.session) or earlier, well within the declared project minimum of Firefox 142.

### Expected Features

This milestone is defined by correctness and safety, not new capabilities. The feature landscape divides sharply between P1 gates that block AMO publishing and P2 polish that ships after core hardening.

**Must have — AMO publishing gates:**
- Manifest V3 migration (`manifest_version: 3`, `action` key, non-persistent background) — AMO will not accept MV2 for new submissions
- Remove `innerHTML` for SVG icons in popup — blocks Mozilla security review
- Add message sender validation in `onMessage` handler — blocks Mozilla security review
- Color value validation to prevent CSS injection from stored workspace data

**Must have — data integrity:**
- Fix race condition in `switchWorkspace()`: snapshot → create all tabs → verify count → delete old tabs → commit storage (current code writes storage before confirming new tabs exist)
- Rollback on partial tab creation failure (restore pre-switch snapshot if any tab creation fails)
- Storage schema validation on every read with corruption recovery (reset to default if data is malformed)

**Must have — correctness:**
- Per-window `activeWorkspaceId` tracking: replace global with `windowId → workspaceId` map in `storage.session`
- Per-window `isSwitching` lock replacing the global boolean
- Popup reads its own `windowId` via `windows.getCurrent()` and sends it in every message

**Should have — data portability (v1.x, ship after core hardening):**
- `storage.sync` migration with per-workspace key design (`workspace:{id}`) to avoid the 8,192-byte per-item limit
- `getBytesInUse()` quota monitoring with graceful `storage.local` fallback
- User-visible error notification when switch fails

**Defer to v2+:**
- Right-click "Move tab to workspace" context menu
- Workspace search/quick-switch via address bar
- Keyboard shortcut for workspace switcher

**Anti-features to avoid:**
- `tabs.hide`/`tabs.show` approach (requires extra user-facing browser permission warning, many edge cases with pinned/active tabs)
- Drag-and-drop between workspaces (no stable DnD API in extension popups)
- Tab grouping within workspaces (competes with Firefox native Tab Groups; undermines the extension's simplicity)
- Cloud sync beyond Firefox Sync (requires backend infrastructure outside scope)

### Architecture Approach

The architecture stays flat and single-file for background logic. No module bundler or structural reorganization is needed — the scope is small enough that well-commented sections within `background.js` provide sufficient organization. The critical change is replacing every global state variable with keyed, window-scoped state in `storage.session`, and ensuring all event listeners are registered synchronously at top-level (required for MV3 non-persistent event pages).

**Major components and their new responsibilities:**
1. `manifest.json` — MV3 format: `"action"` key, `"background": { "scripts": ["background.js"] }`, `"sessions"` permission added, `"persistent": true` removed
2. `background.js` (message router) — validates sender URL (`moz-extension://`), whitelists action names, passes `windowId` from every popup message to operation handlers
3. `background.js` (window tracker) — maintains `windowId → workspaceId` map in `storage.session`; per-window `switchingLocks` map also in `storage.session`; rebuilds from `storage.sync` on `runtime.onStartup`
4. `background.js` (workspace ops) — `switchWorkspace(windowId, targetId)` with snapshot-before-write and rollback; all `tabs.query` calls use explicit `windowId` not `currentWindow: true`
5. `background.js` (tab events) — debounce keyed by `windowId`; ignores events when window's switch lock is true; filters `WINDOW_ID_NONE` from `windows.onFocusChanged`
6. `popup.js` — reads `windowId` via `windows.getCurrent()`, includes `windowId` in all messages, renders workspace list for its own window only
7. Storage layer — `storage.sync` for workspace metadata/tabs (per-workspace keys), `storage.session` for runtime window state, `storage.local` as sync fallback

**Key pattern — window-scoped state in `storage.session`:**
```
{ activeByWindow: { "42": "ws-id-A", "99": "ws-id-B" } }
{ switchingLocks: { "42": false, "99": true } }
```
This replaces global `activeWorkspaceId` and `isSwitching`. Every handler reads these at the start of execution rather than trusting module-scope variables that reset when the background page unloads.

### Critical Pitfalls

1. **Global in-memory state resets silently in MV3 non-persistent background** — `isSwitching` and `saveTimeout` become stale defaults when the background unloads between events. Move all cross-event state to `storage.session`. Replace `setTimeout` debounce with `browser.alarms` if the debounce needs to survive background unloads (or restructure so it doesn't need to). Register all event listeners synchronously at top-level.

2. **`storage.sync` 8,192-byte per-item limit breaks tab-rich workspaces** — A naive 1:1 swap of `.local` for `.sync` will fail silently for any workspace with 20+ tabs. The data model must change to per-workspace keys (`workspace:{id}`) before the storage area is changed. Test with a 40-tab workspace; confirm no `QuotaExceededError`.

3. **`browser_specific_settings.gecko.id` missing causes sync to fail silently** — Without a stable extension ID, sync data is written under an ephemeral ID and is never associated across devices or reinstalls. This must be set in `manifest.json` before the first `storage.sync` write. The extension already has this set (`simple-workspaces@jaehho`) — verify it is present in the MV3 manifest and retained throughout migration.

4. **`tabs.query({ currentWindow: true })` resolves to the wrong window in background** — In background scripts, `currentWindow` means the most recently focused window, not the window the event came from. With multi-window support, this silently overwrites the wrong workspace on every debounced save. Replace every occurrence with `tabs.query({ windowId: specificWindowId })` using the windowId captured from the originating event.

5. **`windows.onFocusChanged` fires `WINDOW_ID_NONE` spuriously on Windows/Linux** — On non-macOS platforms, every window switch fires `WINDOW_ID_NONE` before the new window's ID. Code that triggers auto-saves or state updates on this event will corrupt tracking state. Treat `WINDOW_ID_NONE` as a no-op; only update the active window pointer on real window IDs.

6. **No rollback leaves users with empty or mixed windows on failed switches** — If `browser.tabs.create()` fails mid-loop, the current code still removes old tabs. The fix requires: capture snapshot before switch, create all new tabs, verify count equals expected, only then remove old tabs. If creation fails, close any partially-created tabs and keep old tabs open.

---

## Implications for Roadmap

Based on the dependency graph across all four research files, these areas have strict ordering requirements. The suggested phase structure below respects those dependencies.

### Phase 1: Security Hardening and MV3 Migration

**Rationale:** AMO will not accept MV2 extensions for new submissions. The security fixes (innerHTML, message validation, color injection) are explicitly listed as Mozilla review blockers. MV3 migration changes the background page model — doing it first means all subsequent phases are built on the correct foundation. MV3 non-persistent state management is a prerequisite for every other change that touches `isSwitching` or `activeWorkspaceId`.

**Delivers:** An extension that passes `web-ext lint` with MV3 manifest, has no AMO security review blockers, and has a correctly structured non-persistent background.

**Addresses:** Manifest V3 migration, innerHTML XSS fix, message sender validation, color value validation, `browser.browserAction` → `browser.action` rename (manifest + all API calls), `"persistent": true` removal.

**Avoids:** Pitfall 1 (global in-memory state reset) — move `isSwitching` and `saveTimeout` to `storage.session` as part of MV3 migration, not as a separate step. The MV3 event page model forces this correctly.

**Research flag:** Standard patterns, well-documented. No additional research phase needed. Verification: `web-ext lint` passes, `addons-linter src/` passes, badge updates correctly after migration.

---

### Phase 2: Data Integrity — Race Condition and Rollback Fix

**Rationale:** The race condition in `switchWorkspace()` is the most acute data loss risk in the current codebase. It must be fixed before adding multi-window complexity on top of it — otherwise, debugging which bug caused a workspace corruption becomes difficult. This phase is also a prerequisite for the storage.sync migration because the correct write order (create → verify → commit → delete) determines how `storage.sync.set()` is called.

**Delivers:** A workspace switch that never leaves users with missing tabs. Rollback on partial failure. Schema validation on storage reads with automatic corruption recovery.

**Addresses:** Race condition fix (snapshot → create all tabs → verify count → delete old → commit storage), rollback on partial tab creation failure, storage schema validation function (`isValidWorkspace()`), corruption recovery (reset to default workspace if all data invalid).

**Avoids:** Pitfall 5 (no rollback on partial tab creation), Anti-Pattern 2 (save before confirming new tabs exist).

**Research flag:** Standard transactional pattern applied to tabs API. No additional research phase needed. Verification: mock `browser.tabs.create` to fail on 3rd tab; confirm storage is unchanged and old tabs are retained.

---

### Phase 3: Multi-Window Workspace Tracking

**Rationale:** Per-window workspace tracking is the central correctness gap. It depends on MV3 state management being in place (Phase 1) because the window→workspace map lives in `storage.session`, which requires correct non-persistent state handling. It also benefits from having the fixed `switchWorkspace()` (Phase 2) because the multi-window version calls the same operation with explicit `windowId` parameters.

**Delivers:** Each browser window tracks its own active workspace independently. Popup shows the correct workspace for its window. Badge shows the correct workspace initial per window. Auto-save writes to the correct workspace for the window where the tab event occurred.

**Addresses:** Per-window `windowId → workspaceId` map in `storage.session`, per-window `switchingLocks` in `storage.session`, replace all `currentWindow: true` with explicit `windowId`, `windows.onFocusChanged` handler with `WINDOW_ID_NONE` filtering, `windows.onCreated` and `windows.onRemoved` lifecycle handlers, popup `windowId`-aware rendering via `windows.getCurrent()`, `browser.action.setBadgeText({ windowId })` for per-window badge.

**Avoids:** Pitfall 4 (`currentWindow: true` resolves to wrong window), Pitfall 6 (`WINDOW_ID_NONE` spurious events on Windows/Linux), Anti-Pattern 1 (global `activeWorkspaceId` + `isSwitching`), Anti-Pattern 4 (`currentWindow: true` in background tab queries).

**Research flag:** No additional research needed. API behavior is verified. Verification checklist: open two windows with different workspaces; switch focus; wait for debounce; confirm Window A's workspace was not overwritten by Window B's tabs.

---

### Phase 4: Firefox Sync Integration (storage.sync Migration)

**Rationale:** This phase comes last because it requires the per-workspace key design (`workspace:{id}`) which is a data model change, and because the read/write paths established in Phases 2 and 3 must be in their final form before changing the storage backend. Migrating storage before the multi-window tracking is correct would risk writing window-state data incorrectly to sync.

**Delivers:** Workspaces persist across reinstalls and sync across devices via Firefox account. Quota-aware writes with graceful fallback to `storage.local` when sync quota is exceeded.

**Addresses:** Data model change to per-workspace keys (`workspace:{id}`, `workspaceIndex`), `runtime.onInstalled` migration from `storage.local` to `storage.sync` (read-verify-write-clear), `storage.session` for `windowWorkspaces` runtime cache (with `storage.sync` as canonical backup), `getBytesInUse()` quota monitoring on startup, `storage.local` fallback on `QuotaExceededError`, `sessions.setWindowValue`/`getWindowValue` as secondary association record for window close/restore.

**Avoids:** Pitfall 2 (8,192-byte per-item limit), Pitfall 3 (missing gecko ID), Anti-Pattern 3 (all workspace data under one key).

**Research flag:** The per-item quota behavior with real-world tab counts needs empirical verification. Test with a 40-tab workspace and confirm `getBytesInUse()` stays under 8,192 bytes per key. If URL truncation is needed, determine the cutoff. This is worth a brief research-phase before implementing the migration logic.

---

### Phase Ordering Rationale

The ordering is driven by three dependencies discovered across the research files:

- **MV3 before everything:** Non-persistent background changes the state model that all other phases depend on. Building multi-window tracking on top of a persistent-style codebase would require rewriting it again after MV3 migration.
- **Data integrity before multi-window:** The race condition fix defines the correct write order for `switchWorkspace()`. Multi-window adds a `windowId` parameter to the same function but does not change its internal logic. Getting the logic right in single-window context first makes multi-window testing cleaner.
- **Multi-window before storage.sync migration:** The window-workspace association (`windowWorkspaces`) is part of what gets stored in `storage.sync`. Migrating the storage layer before the association map is finalized risks locking in a flawed schema.

### Research Flags

**Needs research during planning:**
- **Phase 4 (storage.sync migration):** Empirical quota testing with real-world workspace sizes. The 8,192-byte per-item limit requires validation that the per-workspace key design stays under limit with typical usage (30+ tabs, long URLs). Also validate that the `runtime.onInstalled` migration from `storage.local` to `storage.sync` does not lose data in edge cases (sync temporarily unavailable at install time).

**Standard patterns — skip additional research phase:**
- **Phase 1 (MV3 + security):** Fully documented by Extension Workshop migration guide and OWASP. `web-ext lint` provides automated verification.
- **Phase 2 (race condition fix):** Standard transactional pattern. The fix is clearly defined: snapshot → create → verify → delete → commit.
- **Phase 3 (multi-window):** All APIs verified against MDN. The `WINDOW_ID_NONE` gotcha is documented and the prevention is mechanical.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All APIs verified against MDN and Extension Workshop; version compatibility confirmed against Firefox 142+ minimum; no external dependencies to assess |
| Features | HIGH | Feature categories verified against three AMO competitor extensions and OWASP; MVP boundary is clear and non-negotiable (AMO review requirements) |
| Architecture | HIGH | All architectural patterns verified against MDN; anti-patterns are directly observable in the existing codebase (code analysis in CONCERNS.md); no speculative patterns |
| Pitfalls | HIGH | Critical pitfalls verified against MDN, Extension Workshop, and Bugzilla; WINDOW_ID_NONE behavior confirmed in MDN docs; quota limits confirmed against official storage.sync documentation |

**Overall confidence:** HIGH

### Gaps to Address

- **Empirical quota sizing:** The 8,192-byte per-item limit is documented, but the actual serialized size of a realistic workspace (30 tabs, mixed URL lengths) needs measurement before committing to the per-workspace key schema in Phase 4. If a single workspace exceeds 8 KB, a second level of key splitting (`workspace:{id}:tabs:{chunk}`) may be needed — not anticipated in the current design.

- **`browser.alarms` for debounce:** The 400ms debounce currently uses `setTimeout`. In a non-persistent MV3 background, `setTimeout` is reset on background unload. If the background unloads during a 400ms debounce window, the save is silently dropped. The research recommends `browser.alarms` as the replacement, but the exact implementation (alarm naming convention, minimum 1-minute alarm granularity in Firefox) needs validation. If the 1-minute minimum makes `browser.alarms` unsuitable for a 400ms debounce, an alternative approach (synchronous save on every tab event, filtered by lock) should be evaluated during Phase 3 planning.

- **Firefox Sync availability check at runtime:** `storage.sync` requires the user to have Firefox Sync enabled with "Add-ons" selected. There is no API to check this state directly. The research recommends falling back to `storage.local` on write failure, but there is no known way to proactively warn the user that sync is disabled. A UX approach (popup footer status message after a failed `getBytesInUse()` call) may need design validation.

---

## Sources

### Primary (HIGH confidence)
- [MDN: storage.sync](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync) — quota constants, error behavior, gecko ID requirement
- [MDN: storage.session](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session) — in-memory lifetime, 10 MB quota, Firefox 112+ availability
- [MDN: Background scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts) — MV3 non-persistent event page model, state management patterns
- [MDN: windows.onFocusChanged](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/onFocusChanged) — WINDOW_ID_NONE platform behavior
- [MDN: tabs.query](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/query) — currentWindow behavior in background scripts
- [MDN: runtime.MessageSender](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/MessageSender) — sender.url validation pattern
- [MDN: sessions API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sessions) — setWindowValue/getWindowValue, close-restore persistence
- [Extension Workshop: MV3 Migration Guide](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/) — authoritative MV2→MV3 change list
- [Codebase CONCERNS.md](../.planning/codebase/CONCERNS.md) — direct analysis of this codebase's current issues

### Secondary (MEDIUM confidence)
- [Mozilla Addons Blog: MV3 March 2024 Update](https://blog.mozilla.org/addons/2024/03/13/manifest-v3-manifest-v2-march-2024-update/) — confirmed MV2 not deprecated in Firefox; event pages not service workers
- [Mozilla Addons Blog: Changes to storage.sync in Firefox 79](https://blog.mozilla.org/addons/2020/07/09/changes-to-storage-sync-in-firefox-79/) — quota enforcement, automatic migration
- [Mozilla Discourse: MV3 event page behavior](https://discourse.mozilla.org/t/mv3-event-page-behavior-clarification/97738) — community confirmation of event page lifetime
- [Bugzilla #1656947](https://bugzilla.mozilla.org/show_bug.cgi?id=1656947) — QuotaExceededError on storage.sync operations
- [AMO competitor extensions](https://addons.mozilla.org/en-US/firefox/addon/tab-workspaces/) — feature landscape comparison

### Tertiary (informational)
- [OWASP Browser Extension Vulnerabilities Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html) — security baseline for extension review

---
*Research completed: 2026-03-21*
*Ready for roadmap: yes*
