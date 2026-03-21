# Phase 1: MV3 and Security - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate to Manifest V3 and eliminate all AMO security review blockers. Extension passes `web-ext lint`, uses non-persistent background with correct state management, no innerHTML, validated messages and color values. Delivers: SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, DATA-05.

</domain>

<decisions>
## Implementation Decisions

### Background state management (DATA-05)
- **D-01:** Replace `setTimeout` debounce with throttle pattern — save immediately on first tab event, suppress subsequent events for a window. Zero risk of dropped saves on background unload.
- **D-02:** Persist `isSwitching` lock in `storage.session` so it survives background unloads mid-switch.
- **D-03:** Use structured state object in `storage.session` (not bare flags) — e.g., `{ isSwitching: bool, lastSaveTime: number }` so state is inspectable and extensible for later phases.
- **D-04:** `saveTimeout` timer ID is not persisted. Throttle logic reconstructs from `lastSaveTime` on wake.

### MV3 manifest migration (SEC-01)
- **D-05:** `manifest_version: 3`, `browser.action` replaces `browser.browserAction`, non-persistent event page background.
- **D-06:** Drop `unlimitedStorage` permission now (not needed until Phase 4 storage decision, cleaner for AMO review).
- **D-07:** Keep `strict_min_version: "142.0"` — no need to broaden compatibility.

### Background script structure
- **D-08:** Split `background.js` into ES modules (`"type": "module"` in manifest). Separate concerns: storage/state, tab operations, messaging. Sets up cleaner boundaries for Phases 2-4.

### Security: SVG icons (SEC-02)
- **D-09:** Replace `innerHTML` SVG assignments in popup.js (lines 64, 69) with DOM API (`document.createElementNS` for SVG elements). No innerHTML anywhere in codebase.

### Security: Message sender validation (SEC-03)
- **D-10:** Reject messages from non-extension origins (sender URL not `moz-extension://`). Silent rejection in production — no response, no console output.
- **D-11:** In development mode (detected via `browser.management.getSelf()` returning `installType: "development"`), log rejected messages to console for debugging. Automatic — no manual toggle.

### Security: Color validation (SEC-04)
- **D-12:** Validate color values against hex format before CSS application. Invalid colors fall back to a default from the COLORS array rather than rejecting the operation.

### Extension identity (SEC-05)
- **D-13:** Extension ID already set in manifest (`simple-workspaces@jaehho`). Verify it's preserved correctly through MV3 migration.

### Claude's Discretion
- Throttle suppression window duration (currently 400ms debounce — Claude picks appropriate throttle interval)
- Whether to add `onSuspend` listener as final-save safety net
- How to handle unknown message actions (current: silent null return)
- Console log prefix style for security warnings in dev mode
- Exact module split boundaries for background.js
- SVG DOM construction approach details

</decisions>

<specifics>
## Specific Ideas

- Dev-mode security logging should be automatic (detect temporary install), not a manual toggle
- Module split is forward-looking — Phases 2-4 add significant logic to background, so clean boundaries now prevent a messy refactor later

</specifics>

<canonical_refs>
## Canonical References

### MV3 migration
- `src/manifest.json` — Current V2 manifest, migration source
- `src/background.js` — Current monolithic background script, all in-memory state

### Security fixes
- `src/popup/popup.js` lines 64, 69 — innerHTML SVG assignments to replace
- `src/background.js` line 289 — Message handler with ignored `_sender` parameter
- `src/background.js` lines 256-257 — Color values applied without validation

### Project constraints
- `.planning/REQUIREMENTS.md` — SEC-01 through SEC-05, DATA-05 requirements
- `.planning/ROADMAP.md` — Phase 1 success criteria (5 items)

No external specs — requirements are fully captured in decisions above and REQUIREMENTS.md.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `COLORS` array (background.js:7-16): Predefined hex colors — use as fallback source for D-12
- `serializeTabs()` (background.js:312-326): Tab serialization — unchanged by this phase
- `genId()` (background.js:328-330): ID generation — not changed in this phase (DATA-04 is Phase 2)

### Established Patterns
- `[Workspaces]` console prefix for all logs — maintain for any new logging
- Action-based message routing via switch statement — preserve pattern, add sender check before dispatch
- Try-catch with error objects for async operations — maintain pattern in new modules

### Integration Points
- `browser.browserAction` calls (background.js:274-275) must become `browser.action`
- `browser.storage.local` calls throughout — unchanged this phase (Phase 4 migrates storage)
- Popup communicates via `browser.runtime.sendMessage` — message format unchanged, sender validation added server-side
- `web-ext lint` must pass on final manifest — validation gate for success criterion 1

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-mv3-and-security*
*Context gathered: 2026-03-21*
