---
phase: 01-mv3-and-security
plan: 02
subsystem: security
tags: [security, sender-validation, color-validation, svg-dom, no-innerHTML, firefox-extension]

# Dependency graph
requires:
  - 01-01 (background ES modules: messaging.js, workspaces.js structure)
provides:
  - Zero innerHTML in entire src/ directory — SVG icons via createElementNS DOM API
  - Message sender validation rejecting non-extension origins (moz-extension://)
  - Dev-mode rejected-message logging via browser.management.getSelf()
  - Color hex validation with HEX_COLOR_RE regex and COLORS[0].hex fallback
  - All Phase 1 success criteria verified and passing
affects: [Phase 2, Phase 3, Phase 4]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sender validation: check sender.url.startsWith('moz-extension://') before dispatch"
    - "Dev-mode detection: browser.management.getSelf() cached at module load — no extra permission"
    - "Color sanitization: /^#[0-9a-fA-F]{6}$/ regex with COLORS[0].hex fallback applied at create/update/badge"
    - "SVG DOM construction: createElementNS with SVG_NS constant — no innerHTML, no XSS risk"

key-files:
  created: []
  modified:
    - src/background/messaging.js
    - src/background/workspaces.js
    - src/popup/popup.js

key-decisions:
  - "D-09: SVG icons constructed via makeSvgIcon helper with createElementNS — visually identical to old innerHTML version, XSS-safe"
  - "D-10: Silent rejection for non-extension senders in production — no console noise, returns Promise.resolve(null)"
  - "D-11: Dev-mode auto-detected at startup via browser.management.getSelf().then() — no manifest permission required"
  - "D-12: HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/ applied at every color entry/exit point (create, update, badge)"

patterns-established:
  - "Pattern: makeSvgIcon(pathD, pathAttrs) helper centralizes all SVG construction — single place to audit"
  - "Pattern: sanitizeColor(value) called at data entry (createWorkspace, updateWorkspace) AND data exit (updateBadge)"
  - "Pattern: isDevMode flag cached once at module load — avoids repeated async API calls per message"

requirements-completed: [SEC-02, SEC-03, SEC-04, DATA-05]

# Metrics
duration: ~1min
completed: 2026-03-21
---

# Phase 01 Plan 02: Security Hardening — Sender Validation, Color Sanitization, DOM SVG Summary

**Sender validation with dev-mode logging via browser.management.getSelf(), color hex validation with HEX_COLOR_RE regex, and SVG icon construction via createElementNS eliminating all innerHTML from the codebase**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-03-21T09:18:24Z
- **Completed:** 2026-03-21T09:20:00Z
- **Tasks:** 3 (2 code, 1 verification)
- **Files modified:** 3

## Accomplishments

- Added dev-mode detection at module startup in messaging.js via `browser.management.getSelf()` — no extra manifest permission required
- Added sender origin check: `handleMessage` now rejects any message where `sender.url` does not start with `moz-extension://`, returning `Promise.resolve(null)` silently in production, logging to console.warn in dev mode
- Added `HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/` regex and `sanitizeColor(value)` helper in workspaces.js
- Applied `sanitizeColor` at all three color entry/exit points: `createWorkspace`, `updateWorkspace`, and `updateBadge`
- Added `makeSvgIcon(pathD, pathAttrs)` helper using `document.createElementNS(SVG_NS, 'svg')` and `document.createElementNS(SVG_NS, 'path')`
- Replaced both `editBtn.innerHTML` and `deleteBtn.innerHTML` with `editBtn.appendChild(makeSvgIcon(...))` and `deleteBtn.appendChild(makeSvgIcon(...))`
- Zero `innerHTML` assignments anywhere in `src/` directory
- Cleaned up benign comment that contained word "innerHTML" to keep grep clean
- All Phase 1 success criteria verified: web-ext lint (0 errors), ESLint (0 errors), no innerHTML, no browserAction, no unlimitedStorage, sender validation present, color validation present, storage.session present

## Task Commits

Each task was committed atomically:

1. **Task 1: Add sender validation to messaging.js and color validation to workspaces.js** - `ef6848a` (feat)
2. **Task 2: Replace innerHTML SVG icons with createElementNS DOM construction in popup.js** - `7f6a3d2` (feat)
3. **Task 3: Run full Phase 1 verification suite** - verification only, no code changes

**Plan metadata:** (final commit hash — created after SUMMARY)

## Files Created/Modified

- `src/background/messaging.js` — Added isDevMode flag, browser.management.getSelf() startup call, sender.url validation guard in handleMessage
- `src/background/workspaces.js` — Added HEX_COLOR_RE constant, sanitizeColor helper; applied at createWorkspace, updateWorkspace, updateBadge
- `src/popup/popup.js` — Added SVG_NS constant, makeSvgIcon helper; replaced both innerHTML SVG assignments with appendChild + createElementNS

## Decisions Made

- D-09: makeSvgIcon helper via createElementNS — single auditable function, zero XSS risk, visually identical output
- D-10: Silent rejection in production for non-extension senders — noise-free for users, informative in dev installs
- D-11: Dev-mode via browser.management.getSelf() — no permission cost, cached once at module load
- D-12: 6-digit hex-only validation — rejects 3-digit shorthand intentionally; COLORS[0].hex fallback (Blue #3b82f6)

## Phase 1 Success Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|---------|
| web-ext lint reports zero errors on MV3 manifest | PASS | 0 errors, 0 warnings, 0 notices |
| Popup SVG icons via DOM APIs, no innerHTML anywhere | PASS | grep -rn "innerHTML" src/ → no matches |
| Background rejects non-extension messages | PASS | sender.url.startsWith('moz-extension://') check in handleMessage |
| Color values validated against hex format | PASS | HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/ applied in create/update/badge |
| In-memory state persists via storage.session | PASS | getSessionState/setSessionState in state.js with isSwitching + lastSaveTime |

## Deviations from Plan

**Minor — Comment cleanup (Rule 1):**
- **Found during:** Task 2 verification
- **Issue:** Line 43 of popup.js had comment `// Build DOM safely (no dynamic innerHTML)` — the word "innerHTML" in this comment caused `grep -rn "innerHTML" src/` to produce a match, failing the acceptance criterion
- **Fix:** Updated comment to `// Build DOM safely via createElement (no XSS risk)` — preserves intent, removes false grep match
- **Files modified:** src/popup/popup.js (comment text only)
- **Commit:** 7f6a3d2 (included in Task 2 commit)

## Issues Encountered

None — all verification checks passed cleanly after implementation.

## User Setup Required

None.

## Next Phase Readiness

- All Phase 1 requirements closed: SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, DATA-05
- Phase 2 (multi-window awareness) can begin immediately
- No blockers

## Self-Check: PASSED

- FOUND: src/background/messaging.js (contains moz-extension://, browser.management.getSelf, isDevMode, sender.url)
- FOUND: src/background/workspaces.js (contains HEX_COLOR_RE, sanitizeColor applied in 3 places)
- FOUND: src/popup/popup.js (contains SVG_NS, makeSvgIcon, createElementNS, zero innerHTML assignments)
- CONFIRMED: grep -rn "innerHTML" src/ → no matches
- CONFIRMED: npx eslint src/ → zero errors
- CONFIRMED: npx web-ext lint --source-dir=src → 0 errors, 0 notices, 0 warnings
- FOUND commit ef6848a (feat: sender validation + color sanitization)
- FOUND commit 7f6a3d2 (feat: createElementNS SVG icons)

---
*Phase: 01-mv3-and-security*
*Completed: 2026-03-21*
