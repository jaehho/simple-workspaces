# Phase 1: MV3 and Security - Research

**Researched:** 2026-03-21
**Domain:** Firefox WebExtension MV3 migration, security hardening, non-persistent background state
**Confidence:** HIGH

## Summary

Phase 1 converts a functional but MV2/persistent-background extension into an AMO-ready MV3 extension. The technical surface is well-defined: manifest key renames, background script restructure to ES modules with non-persistent event page semantics, `storage.session` for in-memory state that survives background unloads, and three targeted security fixes (innerHTML elimination, message sender validation, color hex validation).

Firefox's MV3 implementation differs from Chrome in one critical way: Firefox uses **event pages** (non-persistent DOM-based background scripts), not service workers. This means ES module `import`/`export` syntax works in background scripts, `browser.*` APIs remain available, and the `window` global context exists — eliminating the Chrome service worker gotchas. `browser.storage.session` was introduced in Firefox 115 and is verified stable; since `strict_min_version: "142.0"` is locked, this API is unconditionally available.

The throttle-over-debounce decision (D-01) is the most architecturally significant change: it replaces the fragile `setTimeout`-based debounce (which can silently drop saves if background unloads during the 400ms window) with a save-immediately-then-suppress pattern. The `isSwitching` lock migrates to `storage.session` (D-02) so it survives mid-switch background unloads.

**Primary recommendation:** Migrate manifest first, then state management (storage.session), then security fixes in order. Each change is independently testable via `web-ext lint` and manual inspection.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Background state management (DATA-05)**
- D-01: Replace `setTimeout` debounce with throttle pattern — save immediately on first tab event, suppress subsequent events for a window. Zero risk of dropped saves on background unload.
- D-02: Persist `isSwitching` lock in `storage.session` so it survives background unloads mid-switch.
- D-03: Use structured state object in `storage.session` (not bare flags) — e.g., `{ isSwitching: bool, lastSaveTime: number }` so state is inspectable and extensible for later phases.
- D-04: `saveTimeout` timer ID is not persisted. Throttle logic reconstructs from `lastSaveTime` on wake.

**MV3 manifest migration (SEC-01)**
- D-05: `manifest_version: 3`, `browser.action` replaces `browser.browserAction`, non-persistent event page background.
- D-06: Drop `unlimitedStorage` permission now (not needed until Phase 4 storage decision, cleaner for AMO review).
- D-07: Keep `strict_min_version: "142.0"` — no need to broaden compatibility.

**Background script structure**
- D-08: Split `background.js` into ES modules (`"type": "module"` in manifest). Separate concerns: storage/state, tab operations, messaging. Sets up cleaner boundaries for Phases 2-4.

**Security: SVG icons (SEC-02)**
- D-09: Replace `innerHTML` SVG assignments in popup.js (lines 64, 69) with DOM API (`document.createElementNS` for SVG elements). No innerHTML anywhere in codebase.

**Security: Message sender validation (SEC-03)**
- D-10: Reject messages from non-extension origins (sender URL not `moz-extension://`). Silent rejection in production — no response, no console output.
- D-11: In development mode (detected via `browser.management.getSelf()` returning `installType: "development"`), log rejected messages to console for debugging. Automatic — no manual toggle.

**Security: Color validation (SEC-04)**
- D-12: Validate color values against hex format before CSS application. Invalid colors fall back to a default from the COLORS array rather than rejecting the operation.

**Extension identity (SEC-05)**
- D-13: Extension ID already set in manifest (`simple-workspaces@jaehho`). Verify it's preserved correctly through MV3 migration.

### Claude's Discretion

- Throttle suppression window duration (currently 400ms debounce — Claude picks appropriate throttle interval)
- Whether to add `onSuspend` listener as final-save safety net
- How to handle unknown message actions (current: silent null return)
- Console log prefix style for security warnings in dev mode
- Exact module split boundaries for background.js
- SVG DOM construction approach details

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEC-01 | Extension uses Manifest V3 (`manifest_version: 3`, `browser.action`, non-persistent background) | MV3 manifest syntax verified via MDN + Extension Workshop; Firefox event page model confirmed |
| SEC-02 | Popup uses DOM APIs for SVG icons instead of innerHTML | `document.createElementNS` SVG namespace pattern documented; attribute setting via `setAttribute` confirmed |
| SEC-03 | Background script validates message sender origin before processing | `browser.runtime.onMessage` sender object structure confirmed; `management.getSelf()` for dev-mode detection needs no extra permission |
| SEC-04 | Workspace color values validated against hex format before CSS injection | Regex hex validation pattern identified; fallback to COLORS array pattern documented |
| SEC-05 | Extension ID set in `browser_specific_settings.gecko.id` for stable sync identity | Already present in manifest; verified preserved through MV3 migration |
| DATA-05 | In-memory state (`isSwitching`, debounce timers) moved to `storage.session` for MV3 non-persistent background compatibility | `storage.session` introduced in Firefox 115 (confirmed); available unconditionally given `strict_min_version: "142.0"` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Firefox WebExtensions API | built-in (FF 142+) | All browser interaction | Platform requirement |
| browser.storage.session | built-in (FF 115+) | In-memory cross-unload state | MV3 canonical solution for event page state |
| browser.management.getSelf() | built-in | Dev/prod mode detection | No extra permission required; `installType: "development"` covers temporary installs |

### Supporting (dev tools — no version change needed)
| Library | Version (installed) | Latest | Purpose |
|---------|---------------------|--------|---------|
| web-ext | 8.10.0 (installed) | 10.0.0 | Lint, run, build — `web-ext lint` is phase success gate |
| addons-linter | 7.20.0 (installed) | 10.1.0 | AMO manifest validation |

**Note on tool versions:** The installed `web-ext@8.10.0` fully supports MV3 validation — MV3 linting was enabled by default in web-ext and does not require `--firefox-preview=mv3` flags in current versions. Upgrading to 10.x is not required for this phase.

**Installation:** No new packages needed. All dependencies are already present.

## Architecture Patterns

### Recommended Module Split (D-08)

Decision D-08 directs splitting `background.js` into ES modules. Recommended boundaries:

```
src/
├── background/
│   ├── index.js          # Entry point — registers all top-level listeners
│   ├── state.js          # storage.session read/write helpers (isSwitching, lastSaveTime)
│   ├── workspaces.js     # Workspace CRUD: create, delete, update, switch
│   └── messaging.js      # onMessage handler with sender validation
├── popup/
│   ├── popup.html
│   └── popup.js          # SEC-02 SVG fix applied here
├── icons/
│   └── ...
└── manifest.json
```

Manifest `background` key with ES modules:
```json
"background": {
  "scripts": ["background/index.js"],
  "type": "module"
}
```

### Pattern 1: MV3 Manifest Structure
**What:** Required key changes from MV2 to MV3
**When to use:** The manifest is the migration anchor — get this right first, then lint confirms correctness

```json
{
  "manifest_version": 3,
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "Simple Workspaces",
    "default_icon": {
      "48": "icons/icon-48.svg",
      "96": "icons/icon-96.svg"
    }
  },
  "background": {
    "scripts": ["background/index.js"],
    "type": "module"
  },
  "permissions": [
    "tabs",
    "storage"
  ],
  "browser_specific_settings": {
    "gecko": {
      "id": "simple-workspaces@jaehho",
      "strict_min_version": "142.0",
      "data_collection_permissions": {
        "required": ["none"]
      }
    }
  }
}
```

Key changes from current V2 manifest:
- `manifest_version: 2` → `3`
- `browser_action` → `action`
- `"background": { "scripts": [...], "persistent": true }` → `"background": { "scripts": [...], "type": "module" }` (persistent removed; type module added)
- `"unlimitedStorage"` removed from permissions (D-06)

### Pattern 2: storage.session Structured State (D-02, D-03)
**What:** Replace in-memory `let isSwitching = false` and `let saveTimeout = null` with `storage.session` reads/writes
**When to use:** Any state that must survive background unload but should not persist across browser restarts

```javascript
// Source: MDN storage.session + background scripts docs

const SESSION_KEY = 'bgState'
const DEFAULT_STATE = { isSwitching: false, lastSaveTime: 0 }

async function getState() {
  const result = await browser.storage.session.get({ [SESSION_KEY]: DEFAULT_STATE })
  return result[SESSION_KEY]
}

async function setState(updates) {
  const current = await getState()
  await browser.storage.session.set({ [SESSION_KEY]: { ...current, ...updates } })
}
```

### Pattern 3: Throttle-Over-Debounce (D-01, D-04)
**What:** Save immediately on first tab event, suppress subsequent saves for a suppression window
**Why:** Debounce delays the save by the full window — if background unloads during that window, save never fires. Throttle saves immediately, so the first event always persists.

```javascript
// Throttle: save immediately, then suppress for THROTTLE_MS
const THROTTLE_MS = 500  // Claude's discretion: 500ms covers rapid tab changes

async function throttledSave() {
  const state = await getState()
  if (state.isSwitching) return

  const now = Date.now()
  if (now - state.lastSaveTime < THROTTLE_MS) return  // suppressed

  await setState({ lastSaveTime: now })
  await saveCurrentWorkspace()
}
```

**Throttle interval recommendation (Claude's discretion):** 500ms. This is slightly longer than the current 400ms debounce, providing the same debounce-equivalent smoothing while guaranteeing the first event saves immediately. Browser tab event bursts (e.g., opening 5 tabs rapidly) complete within 200-300ms, so 500ms suppression catches duplicates without losing the save.

### Pattern 4: Message Sender Validation (SEC-03, D-10, D-11)
**What:** Check `sender.url` starts with `moz-extension://` before dispatching message
**When to use:** Top of the `onMessage` listener, before any switch statement

```javascript
// Source: MDN runtime.onMessage docs — sender object structure

// Dev-mode detection (cached at startup to avoid repeated async calls)
let isDevMode = false
browser.management.getSelf().then(info => {
  isDevMode = (info.installType === 'development')
})

browser.runtime.onMessage.addListener((msg, sender) => {
  // Validate sender origin — reject non-extension messages
  if (!sender.url || !sender.url.startsWith('moz-extension://')) {
    if (isDevMode) {
      console.warn('[Workspaces] Rejected message from non-extension origin:', sender.url)
    }
    return Promise.resolve(null)  // silent rejection
  }

  switch (msg.action) {
    // ... existing cases
  }
})
```

**Important:** `browser.management.getSelf()` requires NO extra manifest permission. The `management` permission is NOT needed for `getSelf()` — this is verified by MDN documentation.

### Pattern 5: SVG DOM Construction (SEC-02, D-09)
**What:** Replace `element.innerHTML = '<svg...>'` with `document.createElementNS`
**Why:** `innerHTML` can execute injected scripts and is blocked by CSP; DOM construction is immune

```javascript
// Source: MDN createElementNS, UI-SPEC SVG contract

const SVG_NS = 'http://www.w3.org/2000/svg'

function makeSvgIcon(pathD, pathAttrs = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')

  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', pathD)
  Object.entries(pathAttrs).forEach(([k, v]) => path.setAttribute(k, v))

  svg.appendChild(path)
  return svg
}

// Pencil (edit):
editBtn.appendChild(makeSvgIcon('M11.5 2.5l2 2-8 8H3.5v-2l8-8z', {
  'stroke': 'currentColor', 'stroke-width': '1.3',
  'stroke-linecap': 'round', 'stroke-linejoin': 'round'
}))

// Cross (delete):
deleteBtn.appendChild(makeSvgIcon('M4 4l8 8M12 4l-8 8', {
  'stroke': 'currentColor', 'stroke-width': '1.3',
  'stroke-linecap': 'round'
}))
```

**Important:** SVG elements MUST use `createElementNS` with `http://www.w3.org/2000/svg`. Using `document.createElement('svg')` creates an HTML element, not a true SVG element — it will not render correctly.

### Pattern 6: Color Hex Validation (SEC-04, D-12)
**What:** Validate color string before CSS injection; fall back to `COLORS[0].hex` if invalid
**When to use:** In `updateWorkspace()` before storing color; in any CSS `setProperty` call

```javascript
// Simple, strict hex validation
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

function sanitizeColor(value) {
  if (HEX_COLOR_RE.test(value)) return value
  return COLORS[0].hex  // fallback to first preset color (Blue: #3b82f6)
}

// In updateWorkspace():
if (updates.color !== undefined) {
  workspaces[idx].color = sanitizeColor(updates.color)
}
```

**Note:** The COLORS array (background.js lines 7-16) contains only 6-digit hex values. The regex `/^#[0-9a-fA-F]{6}$/` accepts the exact same format. 3-digit shorthand (`#fff`) is intentionally rejected for strict consistency.

### Pattern 7: browser.action Badge (SEC-01)
**What:** Replace `browser.browserAction` API calls with `browser.action`
**When to use:** Wherever badge text or badge color is set

```javascript
// OLD (MV2):
browser.browserAction.setBadgeText({ text: initial })
browser.browserAction.setBadgeBackgroundColor({ color: workspace.color })

// NEW (MV3):
browser.action.setBadgeText({ text: initial })
browser.action.setBadgeBackgroundColor({ color: workspace.color })
```

### Anti-Patterns to Avoid

- **Registering listeners inside async functions or callbacks.** All `browser.*` event listeners MUST be registered synchronously at the top level of the background entry module (`index.js`). If a listener is registered inside an `async` function or a `.then()`, Firefox may not wake the background page for that event.

- **Using `setTimeout` for critical saves.** In non-persistent backgrounds, `setTimeout` IDs don't survive unloads. The throttle pattern (Pattern 3) avoids this entirely.

- **Using `document.createElement` for SVG elements.** Always use `document.createElementNS` with the SVG namespace for SVG elements.

- **Caching `browser.management.getSelf()` inside a listener.** The initial `isDevMode` check should run at startup (top-level async IIFE or `onInstalled`/`onStartup`), not inside each message handler invocation.

- **Leaving `"persistent": false` in MV3 manifest.** In MV3, the `persistent` key is not valid — omit it entirely. `web-ext lint` may warn on extraneous keys.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-unload in-memory state | Custom message-passing or serialization | `browser.storage.session` | Platform-native, 10MB quota, survives unload, clears on restart |
| Dev/prod detection | `process.env`, build flags, manual toggle | `browser.management.getSelf().installType` | Built-in, automatic, no manifest changes, no build step |
| SVG rendering | String templates + innerHTML | `document.createElementNS` | XSS prevention, proper SVG namespace, ESLint rule compliance |
| Hex color validation | Custom CSS parsing | `/^#[0-9a-fA-F]{6}$/` regex | COLORS array only contains 6-digit hex; simple regex is sufficient and clear |
| MV3 linting | Custom validation scripts | `web-ext lint` | AMO canonical validator — if lint passes, AMO accepts |

**Key insight:** Every "don't hand-roll" item here is either a built-in browser API or a one-liner. Complexity signals the wrong approach.

## Common Pitfalls

### Pitfall 1: Top-Level Listener Requirement
**What goes wrong:** Event page doesn't wake up for events — extension appears broken after background unloads.
**Why it happens:** Firefox event pages only wake for events if the listener was registered synchronously at the top level of the module. Async registration (inside `.then()`, `async` functions, or `DOMContentLoaded`) is missed.
**How to avoid:** In `index.js` (entry point), register all listeners at the module's top level. Import handler functions from other modules, but the `.addListener()` call must be top-level.
**Warning signs:** Extension works immediately after install or page reload but stops responding after a few seconds of inactivity.

### Pitfall 2: ES Module Top-Level Await
**What goes wrong:** `await browser.storage.session.get(...)` at the top level of a module blocks listener registration.
**Why it happens:** Top-level `await` in ES modules is valid syntax, but if the first `await` occurs before `addListener()` calls, the background page may unload before listeners are registered.
**How to avoid:** Register all listeners synchronously first, then use async IIFEs or `onInstalled`/`onStartup` listeners for initialization that requires async calls.
**Warning signs:** Listeners registered after any `await` at module top level may not be registered in time.

### Pitfall 3: isSwitching State Not Persisted
**What goes wrong:** Background unloads mid-switch; on wake, `isSwitching` is `false` again; save runs over the in-progress switch; data corruption or duplicate tab creation.
**Why it happens:** In-memory `let isSwitching = false` resets on every background page wake.
**How to avoid:** Read `isSwitching` from `storage.session` at the start of every save operation and every switch operation. Always write updated state back to `storage.session` before yielding control (before any `await`).
**Warning signs:** Occasional duplicate saves or partial switch states in storage.

### Pitfall 4: Stale isDevMode Cache
**What goes wrong:** `isDevMode` is always `false` because `management.getSelf()` is async and not awaited before the first message arrives.
**Why it happens:** The `getSelf()` promise hasn't resolved when the first message handler fires.
**How to avoid:** Initialize `isDevMode` in an `onInstalled`/`onStartup` listener or a top-level async IIFE, so it's set before the popup opens. Since popup only opens on user action, this window is large enough in practice.
**Warning signs:** Dev-mode logging never appears in the browser console even for temporary installs.

### Pitfall 5: SVG createElement vs createElementNS
**What goes wrong:** SVG icon buttons appear empty or render as text.
**Why it happens:** `document.createElement('svg')` creates an HTMLUnknownElement in the HTML namespace, not an SVGSVGElement. The browser doesn't render it as SVG.
**How to avoid:** Always use `document.createElementNS('http://www.w3.org/2000/svg', 'svg')` and `document.createElementNS('http://www.w3.org/2000/svg', 'path')`.
**Warning signs:** Icon buttons appear but are invisible or show a box; DevTools shows element type as `HTMLElement` not `SVGSVGElement`.

### Pitfall 6: browser.action vs browser.browserAction
**What goes wrong:** Badge does not update; `TypeError: browser.browserAction is undefined` in the console.
**Why it happens:** `browser.browserAction` is removed in MV3. Both the manifest key (`action` vs `browser_action`) and the JS API (`browser.action` vs `browser.browserAction`) must change together.
**How to avoid:** Search codebase for `browserAction` — there are exactly 2 occurrences in `background.js` (lines 274-275). Both must become `browser.action`.
**Warning signs:** `web-ext lint` will catch the manifest issue; runtime errors catch the JS issue.

### Pitfall 7: web-ext lint MV3 False Positives
**What goes wrong:** `web-ext lint` reports errors about APIs that ARE supported in Firefox 142+, because the linter evaluates against a lower baseline.
**Why it happens:** `addons-linter` uses `strict_min_version` to scope its API availability checks. With `strict_min_version: "142.0"`, all APIs available in Firefox 142 pass.
**How to avoid:** Keep `strict_min_version: "142.0"` in the manifest (D-07). Do not broaden it.
**Warning signs:** Unexpected lint errors for standard MV3 APIs — verify the `strict_min_version` is set.

## Code Examples

Verified patterns from official sources:

### ES Module Background Entry (index.js)
```javascript
// Source: MDN Background scripts - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts

// All imports at top — synchronous
import { throttledSave } from './state.js'
import { switchWorkspace, createWorkspace, deleteWorkspace, updateWorkspace } from './workspaces.js'
import { handleMessage } from './messaging.js'
import { updateBadge } from './workspaces.js'

// All listeners registered synchronously at top level
browser.tabs.onCreated.addListener(() => throttledSave())
browser.tabs.onRemoved.addListener((_tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing) throttledSave()
})
browser.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.title || changeInfo.pinned !== undefined) {
    throttledSave()
  }
})
browser.tabs.onMoved.addListener(() => throttledSave())
browser.tabs.onAttached.addListener(() => throttledSave())
browser.tabs.onDetached.addListener(() => throttledSave())

browser.runtime.onMessage.addListener(handleMessage)

browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') await initDefaultWorkspace()
})

browser.runtime.onStartup.addListener(async () => {
  const { workspaces } = await browser.storage.local.get('workspaces')
  if (!workspaces || workspaces.length === 0) await initDefaultWorkspace()
})

// Badge init — async IIFE after listener registration
;(async () => {
  const data = await browser.storage.local.get(['workspaces', 'activeWorkspaceId'])
  if (data.workspaces && data.activeWorkspaceId) {
    const active = data.workspaces.find(w => w.id === data.activeWorkspaceId)
    if (active) updateBadge(active)
  }
})()
```

### storage.session State Module (state.js)
```javascript
// Source: MDN storage.session - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session

const SESSION_KEY = 'bgState'
const DEFAULT_STATE = { isSwitching: false, lastSaveTime: 0 }
const THROTTLE_MS = 500

export async function getSessionState() {
  const result = await browser.storage.session.get({ [SESSION_KEY]: DEFAULT_STATE })
  return result[SESSION_KEY]
}

export async function setSessionState(updates) {
  const current = await getSessionState()
  await browser.storage.session.set({ [SESSION_KEY]: { ...current, ...updates } })
}

export async function throttledSave() {
  const state = await getSessionState()
  if (state.isSwitching) return

  const now = Date.now()
  if (now - state.lastSaveTime < THROTTLE_MS) return

  await setSessionState({ lastSaveTime: now })
  await saveCurrentWorkspace()
}
```

### Dev Mode Detection (messaging.js)
```javascript
// Source: MDN management.getSelf - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/management/getSelf

let isDevMode = false

// Resolve at startup — before any user interaction
browser.management.getSelf().then(info => {
  isDevMode = (info.installType === 'development')
})

export function handleMessage(msg, sender) {
  if (!sender.url || !sender.url.startsWith('moz-extension://')) {
    if (isDevMode) {
      console.warn('[Workspaces] Rejected message from non-extension origin:', sender.url)
    }
    return Promise.resolve(null)
  }

  switch (msg.action) {
    case 'getState':
      return browser.storage.local.get(['workspaces', 'activeWorkspaceId'])
    // ... etc
    default:
      return Promise.resolve(null)
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `persistent: true` background page | Non-persistent event page | MV3 (FF 109+) | Background unloads after idle; state must use storage |
| `browser_action` manifest key | `action` key | MV3 | Manifest lint error if old key used |
| `browser.browserAction` JS API | `browser.action` JS API | MV3 | Runtime error if old API used |
| `unlimitedStorage` permission | Not needed for `storage.local` < 5MB | Best practice | Reduces permission surface for AMO review |
| In-memory `let isSwitching = false` | `storage.session` structured state | MV3 + FF 115 | Survives background unload |
| `setTimeout` debounce | Throttle from `lastSaveTime` | MV3 migration | Eliminates dropped saves on unload |
| `innerHTML` for SVG icons | `document.createElementNS` DOM construction | Security hardening | Passes `eslint-plugin-no-unsanitized` |
| Unchecked `_sender` in onMessage | Sender URL validation | Security hardening | Rejects external messages |

**Deprecated/outdated:**
- `"persistent": true` background: Not valid in MV3. Omit the key entirely.
- `browser.browserAction.*`: Removed in MV3. Use `browser.action.*`.
- `unlimitedStorage`: Not a valid MV3 permission per AMO guidelines (request only what you need).

## Open Questions

1. **`onSuspend` listener as safety net (Claude's discretion)**
   - What we know: Firefox event pages fire `runtime.onSuspend` before unloading; this gives a synchronous opportunity to save.
   - What's unclear: Whether `onSuspend` fires reliably in Firefox vs Chrome, and whether it fires during crash (not just idle unload).
   - Recommendation: Add `browser.runtime.onSuspend` listener that calls `saveCurrentWorkspace()` directly (bypassing throttle). Low cost, high safety. If `onSuspend` fires in time, it guarantees the save. If background crashes (no `onSuspend`), throttle already saved on the first tab event.

2. **`isSwitching` lock read-before-write race**
   - What we know: `storage.session` operations are async. A rapid double-switch could pass the `isSwitching` check before the first switch sets it.
   - What's unclear: How concurrent messages are processed in Firefox event pages.
   - Recommendation: Set `isSwitching: true` as the first `await` in `switchWorkspace()`, before any other operations. Accept that double-switch is unlikely in a popup UI (user must click twice before first response returns).

## Sources

### Primary (HIGH confidence)
- MDN Background scripts - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts
- MDN storage.session - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session
- MDN background manifest key - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background
- MDN management.getSelf - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/management/getSelf
- MDN ExtensionInfo - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/management/ExtensionInfo
- MDN Firefox 115 release notes - https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/115 (confirms `storage.session` added in FF 115)
- Firefox Extension Workshop MV3 Migration Guide - https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/

### Secondary (MEDIUM confidence)
- Mozilla Addons Blog MV3 July 2024 - https://blog.mozilla.org/addons/2024/07/10/manifest-v3-updates-landed-in-firefox-128/ (confirms FF 128 MV3 status)
- MDN createElementNS - https://developer.mozilla.org/en-US/docs/Web/API/Document/createElementNS (SVG namespace DOM pattern)

### Tertiary (LOW confidence)
- Mozilla Discourse MV3 event page behavior thread - https://discourse.mozilla.org/t/mv3-event-page-behavior-clarification/97738 (2022, pre-stable MV3; general patterns only)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — All APIs verified against MDN and release notes; `storage.session` Firefox 115 confirmed
- Architecture (MV3 manifest): HIGH — Verified against Extension Workshop migration guide
- Architecture (ES modules): HIGH — `"type": "module"` syntax confirmed from MDN background key docs
- Architecture (throttle pattern): MEDIUM — Throttle-over-debounce logic is sound but exact unload timing in Firefox event pages not empirically verified
- Pitfalls: HIGH — Most pitfalls derived from official docs (top-level listener requirement, createElementNS requirement)
- `management.getSelf()` no extra permission: HIGH — MDN explicitly states "This API does not require the management permission"

**Research date:** 2026-03-21
**Valid until:** 2026-04-21 (stable Firefox APIs; MV3 ecosystem is settled as of FF 142)
