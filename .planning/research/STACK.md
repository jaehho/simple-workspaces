# Stack Research

**Domain:** Firefox WebExtension — tab/workspace management (milestone hardening)
**Researched:** 2026-03-21
**Confidence:** HIGH (core APIs verified against MDN and Extension Workshop)

---

## Context

This is a subsequent-milestone stack document, not a greenfield recommendation. The existing extension is
plain vanilla JavaScript, no build pipeline beyond `web-ext`, and that is the right choice for a Firefox
extension of this scope. The research below focuses exclusively on the five change areas the milestone
targets: MV3 migration, storage.sync, per-window tracking, race-condition hardening, and storage validation.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Firefox WebExtensions API | MV3 (manifest_version: 3) | Extension runtime | Required for AMO publishing; MV2 is still supported by Firefox but blocks new submissions |
| `browser.action` API | Built-in MV3 | Toolbar button and badge | Replaces `browser.browserAction` in MV3; functionally identical for this use case |
| `browser.storage.sync` | Built-in | Cross-device workspace persistence | Survives reinstalls, ties to Firefox account, quota (102 KB total, 8 KB/item, 512 items) is sufficient for workspace metadata |
| `browser.storage.local` | Built-in | Fallback when sync quota exceeded | Unlimited with permission already declared; stays as safety net |
| `browser.storage.session` | Built-in (Firefox 112+) | Per-window in-memory state (`windowId → workspaceId` map) | 10 MB in-memory, cleared on browser close, no disk I/O, exactly the right lifetime for volatile window-tracking data |
| `browser.sessions` API | Built-in | Per-window workspace assignment that survives window close/restore | `sessions.setWindowValue` / `sessions.getWindowValue` persist across close-and-restore within a session; requires `"sessions"` permission |
| `browser.windows` API | Built-in | Window lifecycle events (`onCreated`, `onRemoved`, `onFocusChanged`) | Only source of windowId events; use `windows.getAll({ populate: true })` at startup to rebuild window-to-workspace map |
| `browser.tabs` API | Built-in | Tab CRUD, serialization, querying by windowId | `tabs.query({ windowId })` is the correct scope for per-window operations; replace `currentWindow: true` with explicit `windowId` parameter |
| `crypto.randomUUID()` | Web API (Firefox 95+, project requires Firefox 142+) | Collision-free workspace ID generation | Cryptographically secure, returns RFC 4122 v4 UUID, no external dependency, available in extension background scripts in Firefox 142+ |

### Supporting Libraries

None required. The existing stack (vanilla JS, `web-ext`, ESLint) is appropriate. Adding a framework
dependency to a ~1000-line extension would add more surface area than value.

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `web-ext` | ^8.0.0 | Build, lint, sign, run dev server | Already present; no change needed |
| `addons-linter` | ^7.0.0 | Validates MV3 manifest against AMO rules | Already present; will catch MV3-specific issues during migration |
| `eslint-plugin-no-unsanitized` | ^4.1.0 | Prevent innerHTML XSS | Already present; critical for the innerHTML fix |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `web-ext lint` | Validates manifest and code against AMO standards | Run before every commit; catches MV3 manifest errors |
| `web-ext run` | Live-reload dev server | Unchanged from current workflow |
| `about:debugging#/runtime/this-firefox` | Inspect background script, view console logs, check storage | The only reliable way to inspect `browser.storage.sync` during development |
| Firefox Sync dev setup | Test cross-device sync behavior | Requires two Firefox profiles signed into the same account; can simulate with `about:sync-log` |

---

## API Decisions by Change Area

### 1. Manifest V3 Migration

**What changes in `manifest.json`:**

```json
{
  "manifest_version": 3,
  "background": {
    "scripts": ["background.js"]
  },
  "action": {
    "default_popup": "popup/popup.html"
  },
  "permissions": ["tabs", "storage", "sessions"],
  "host_permissions": []
}
```

Key points:
- Firefox MV3 uses `background.scripts` (NOT `background.service_worker`). Firefox does not run
  background scripts as service workers — it uses non-persistent event pages instead. Do not use
  `service_worker` unless targeting Chrome cross-compatibility; this extension is Firefox-only.
- `browser_action` → `action`. The API call changes from `browser.browserAction.*` to `browser.action.*`.
  Specifically: `browser.browserAction.setBadgeText()` → `browser.action.setBadgeText()`.
- Host permissions go in a separate `host_permissions` key. This extension has none, so this is a no-op.
- `"persistent": true` must be removed from `background`. Firefox MV3 background scripts are always
  non-persistent (event pages). This means in-memory variables (`isSwitching`, `saveTimeout`) still
  work but are reset if Firefox unloads the background page between events.
- `"unlimitedStorage"` permission is no longer needed once storage migrates to `storage.sync` (which
  has a fixed quota). Keep it for the `storage.local` fallback path.
- CSP: the default `extension_pages` CSP in MV3 is `"script-src 'self'; object-src 'self'"`. This
  extension has no inline scripts or eval, so no CSP override is needed.

**Confidence: HIGH** — Verified against Extension Workshop MV3 migration guide and MDN background manifest key docs.

---

### 2. Storage Migration: `storage.local` → `storage.sync`

**Quota constraints (hard limits):**

| Constraint | Value |
|-----------|-------|
| Total storage | 102,400 bytes |
| Per-item size | 8,192 bytes |
| Item count | 512 items |

**Storage key design for quota management:**

Store each workspace as its own key, not as a monolithic array. This avoids hitting the 8,192-byte
per-item limit and enables surgical updates:

```javascript
// Key per workspace
browser.storage.sync.set({ [`workspace:${id}`]: workspaceData });

// Workspace index (small — just IDs and display metadata)
browser.storage.sync.set({ workspaceIndex: ['id1', 'id2', ...] });

// Per-window active workspace (keyed by windowId, volatile — use storage.session)
browser.storage.session.set({ windowWorkspaces: { [windowId]: workspaceId } });
```

A monolithic `workspaces: [...]` array risks exceeding 8,192 bytes per item as the workspace count
grows. Splitting into one key per workspace keeps each item small and allows individual updates
without rewriting the full list.

**Fallback pattern when sync quota is exceeded:**

```javascript
async function storageSet(key, value) {
  try {
    await browser.storage.sync.set({ [key]: value });
  } catch (e) {
    if (e.message?.includes('QuotaExceeded')) {
      await browser.storage.local.set({ [key]: value });
      console.warn('[Workspaces] sync quota exceeded, fell back to local for key:', key);
    } else {
      throw e;
    }
  }
}
```

**Migration on install/update:**

On `runtime.onInstalled` with reason `'update'`, read from `storage.local`, write to `storage.sync`,
verify the write succeeded, then clear the `storage.local` key. Do not delete local data until sync
write is confirmed.

**Firefox-specific gotcha:** `storage.sync` requires the extension to have an ID set in
`browser_specific_settings.gecko.id` — which this extension already has (`simple-workspaces@jaehho`).

**Confidence: HIGH** — Quota numbers and error behavior verified against MDN storage.sync documentation.

---

### 3. Per-Window Workspace Tracking

**The problem:** Global `activeWorkspaceId` is a single value shared across all windows. Opening a
second browser window silently corrupts workspace state.

**Recommended approach: `storage.session` as the source of truth for the window→workspace map.**

`storage.session` is in-memory only, cleared when Firefox closes, and has a 10 MB quota. This is
exactly the right lifetime and scope for window-to-workspace mappings: window IDs are session-scoped
and don't survive browser restarts either.

```javascript
// Map structure stored in storage.session
// { windowWorkspaces: { "42": "workspace-id-abc", "99": "workspace-id-def" } }

async function getActiveWorkspaceForWindow(windowId) {
  const { windowWorkspaces = {} } = await browser.storage.session.get('windowWorkspaces');
  return windowWorkspaces[windowId] ?? null;
}

async function setActiveWorkspaceForWindow(windowId, workspaceId) {
  const { windowWorkspaces = {} } = await browser.storage.session.get('windowWorkspaces');
  windowWorkspaces[windowId] = workspaceId;
  await browser.storage.session.set({ windowWorkspaces });
}
```

**Startup rebuild:** On `runtime.onStartup` and `runtime.onInstalled`, call
`browser.windows.getAll({ populate: false })` to discover all open windowIds, then initialize any
that don't have a session entry — assign the first available workspace or create a default.

**Window lifecycle:** Listen to `browser.windows.onRemoved` to clean up orphaned entries from the
session map:

```javascript
browser.windows.onRemoved.addListener(async (windowId) => {
  const { windowWorkspaces = {} } = await browser.storage.session.get('windowWorkspaces');
  delete windowWorkspaces[windowId];
  await browser.storage.session.set({ windowWorkspaces });
});
```

**sessions API as a backup:** `browser.sessions.setWindowValue(windowId, 'workspaceId', id)` /
`browser.sessions.getWindowValue(windowId, 'workspaceId')` persist the association across window
close-and-restore within a Firefox session. Use this as a secondary record so that if a user closes
a workspace window and reopens it via ctrl+shift+T, the extension can reassign the correct workspace.
Requires the `"sessions"` permission.

**Confidence: HIGH** — storage.session behavior and windows API verified against MDN.

---

### 4. Race Condition Fix in `switchWorkspace()`

**The problem:** Tabs are saved before new tabs are confirmed created. If tab creation fails
mid-loop, the old workspace state is already overwritten.

**Pattern: snapshot-before-write with rollback capability.**

```javascript
async function switchWorkspace(windowId, targetId) {
  // 1. Capture rollback snapshot BEFORE any mutations
  const snapshot = await readWorkspaceState();

  // 2. Set isSwitching to block debounced saves
  isSwitching = true;

  try {
    // 3. Create ALL new tabs first, collect IDs
    const createdTabIds = await createTabsForWorkspace(target.tabs, windowId);

    // 4. Only remove old tabs after ALL new tabs confirmed created
    if (createdTabIds.length > 0) {
      await browser.tabs.remove(oldTabIds);
    } else {
      throw new Error('No tabs created — aborting switch to prevent data loss');
    }

    // 5. Persist new state only after browser tabs are correct
    await persistActiveWorkspace(windowId, targetId, updatedWorkspaces);

  } catch (e) {
    // Rollback: restore snapshot to storage (tabs already in browser are the user's problem,
    // but at minimum workspace metadata is uncorrupted)
    await restoreWorkspaceSnapshot(snapshot);
    throw e;
  } finally {
    isSwitching = false;
  }
}
```

**Key discipline:** Never write workspace state to storage until the tab operations succeed. The
snapshot exists so that if a partial failure leaves the browser in a mixed state, the stored
workspace data reflects the last known good state, not a half-completed switch.

**Confidence: MEDIUM** — This is a standard transactional pattern applied to the tabs API. The tabs
API itself provides no atomicity guarantee, but this sequence minimizes the data-loss window.

---

### 5. Storage Validation and Corruption Recovery

**Schema validation on every read:**

```javascript
function isValidWorkspace(obj) {
  return (
    obj &&
    typeof obj.id === 'string' && obj.id.length > 0 &&
    typeof obj.name === 'string' && obj.name.length > 0 &&
    typeof obj.color === 'string' && /^#[0-9a-f]{6}$/i.test(obj.color) &&
    Array.isArray(obj.tabs) &&
    obj.tabs.every(t =>
      typeof t.url === 'string' &&
      typeof t.title === 'string' &&
      typeof t.pinned === 'boolean'
    )
  );
}

async function readWorkspaces() {
  const keys = await browser.storage.sync.get(null);  // get all keys
  const workspaceKeys = Object.keys(keys).filter(k => k.startsWith('workspace:'));
  const workspaces = workspaceKeys.map(k => keys[k]).filter(isValidWorkspace);

  if (workspaces.length === 0) {
    // Recovery: create default workspace
    console.warn('[Workspaces] All data invalid or missing — resetting to default');
    await initDefaultWorkspace();
    return readWorkspaces();
  }

  return workspaces;
}
```

**Color validation specifically** — prevent CSS injection by validating colors at read time and
at write time (not just at the UI layer):

```javascript
const VALID_COLOR = /^#[0-9a-f]{6}$/i;
function sanitizeColor(color) {
  return VALID_COLOR.test(color) ? color : '#3b82f6';  // fallback to default blue
}
```

**Confidence: HIGH** — Pattern is standard defensive coding applied to the existing data model.

---

### 6. Security: Message Sender Validation

**Use `sender.url` to restrict message handling to the extension's own popup:**

```javascript
browser.runtime.onMessage.addListener((msg, sender) => {
  // Only accept messages from extension pages (popup, options)
  // sender.url is moz-extension://{uuid}/popup/popup.html for the popup
  if (!sender.url?.startsWith('moz-extension://')) {
    console.warn('[Workspaces] Rejected message from non-extension sender:', sender.url);
    return Promise.resolve(null);
  }

  // Explicit whitelist of valid actions
  const VALID_ACTIONS = new Set([
    'getState', 'switchWorkspace', 'createWorkspace',
    'deleteWorkspace', 'updateWorkspace', 'getColors', 'forceSave'
  ]);
  if (!VALID_ACTIONS.has(msg.action)) {
    return Promise.resolve(null);
  }

  // ... dispatch
});
```

**Confidence: HIGH** — MessageSender structure verified against MDN runtime.MessageSender documentation.

---

## Installation

No new npm packages are required. The existing devDependencies cover everything:

```bash
# Verify existing tools are current
npm install

# Run addons-linter to check MV3 manifest after migration
npx addons-linter src/

# Run web-ext lint
npx web-ext lint --source-dir src/
```

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `storage.session` for window→workspace map | `storage.local` with windowId keys | Local storage persists across restarts; windowIds do not. Stale window entries accumulate. Session storage has the correct lifetime. |
| `storage.session` for window→workspace map | `sessions.setWindowValue` as primary | sessions API requires `"sessions"` permission and adds complexity for the primary fast path. Use it as a secondary record only. |
| Per-key storage (one key per workspace) | Monolithic `workspaces: [...]` array | Monolithic array hits 8,192-byte per-item limit with many workspaces. Per-key approach enables surgical updates. |
| Plain JS schema validation function | Zod or other schema library | Adding a 30 KB schema library for a ~20-line validation function is disproportionate. |
| `crypto.randomUUID()` | `Date.now() + Math.random()` | The existing genId() pattern has theoretical collision risk. randomUUID() is cryptographically secure, zero-dependency, available in Firefox 95+ (well within the project's Firefox 142+ minimum). |
| Firefox `background.scripts` (event page) | `background.service_worker` | This extension is Firefox-only. Firefox uses event pages for background scripts in MV3, not service workers. Using service_worker would cause it to fail to load in Firefox < 121. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `browser.browserAction.*` | Removed in MV3 | `browser.action.*` |
| `"persistent": true` in background | Not valid in MV3 | Remove the property entirely |
| `"browser_action"` manifest key | MV3 renamed it | `"action"` |
| `tabs.query({ currentWindow: true })` for per-window ops | Returns tabs for whichever window is focused at query time — nondeterministic in multi-window scenarios | `tabs.query({ windowId: specificWindowId })` using the windowId you explicitly track |
| Monolithic `workspaces` array as single storage key | Risks exceeding the 8,192-byte per-item limit in storage.sync as workspace count grows | Per-workspace keys: `workspace:{id}` |
| `setTimeout` / `setInterval` in background (if ever needing periodic tasks) | Non-persistent background page: timers are lost when the page is unloaded | `browser.alarms` API (not needed for this milestone, but relevant if periodic tasks are added) |
| `innerHTML` for SVG icons | XSS risk, violates AMO security guidelines | `document.createElementNS('http://www.w3.org/2000/svg', ...)` or embed SVGs in HTML directly as static content |
| Assertion that `storage.sync` is always available | Firefox sync requires user opt-in to "Add-ons" in sync settings; can be disabled | Always wrap storage.sync operations in try/catch with storage.local fallback |

---

## Version Compatibility

| API / Feature | Firefox Version | Notes |
|---------------|-----------------|-------|
| Manifest V3 (`manifest_version: 3`) | Firefox 109+ | Required for AMO; project min is 142, so this is satisfied |
| `browser.action` (replaces browserAction) | Firefox 109+ | Renamed in MV3; project min is 142 |
| `browser.storage.session` | Firefox 112+ | In-memory session storage; project min is 142 |
| `browser.storage.sync` | Firefox 53+ | Requires extension ID in browser_specific_settings; already set |
| `crypto.randomUUID()` | Firefox 95+ | Available in background scripts; project min is 142 |
| `sessions.setWindowValue` | Firefox 57+ | Requires `"sessions"` permission |
| Non-persistent background (event page) | Firefox 106+ (non-persistent MV3) | Below 106, event pages behaved as persistent; project min is 142 |
| `tabs.query({ windowId })` | All supported Firefox versions | Stable, well-documented |

All APIs are within the project's declared minimum of Firefox 142.0 — no compatibility gaps.

---

## Sources

- [MDN: manifest.json/background](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background) — Verified MV3 `scripts` vs `service_worker` behavior, Firefox-only event page model
- [Extension Workshop: MV3 Migration Guide](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/) — Authoritative MV2→MV3 change list: browser_action→action, persistent removal, permissions restructuring
- [MDN: storage.sync](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync) — Quota constants (102 KB total, 8 KB/item, 512 items), error-on-exceed behavior, Firefox extension ID requirement
- [MDN: storage.session](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session) — In-memory, session-lifetime, 10 MB quota, setAccessLevel behavior
- [MDN: sessions API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sessions) — setWindowValue/getWindowValue, tab/window value persistence across close-restore
- [MDN: windows API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows) — onCreated/onRemoved/onFocusChanged events, window ID scope
- [MDN: runtime.MessageSender](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/MessageSender) — sender.url pattern for popup origin validation
- [MDN: Background scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts) — Event page lifetime, storage.session pattern for state across unloads, onSuspend limitations
- [Mozilla Add-ons Blog: MV3 March 2024 Update](https://blog.mozilla.org/addons/2024/03/13/manifest-v3-manifest-v2-march-2024-update/) — Confirmed MV2 not deprecated in Firefox; Firefox retains event pages (not service workers)
- [MDN: crypto.randomUUID](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID) — Baseline widely available since March 2022, Firefox 95+

---

*Stack research for: Firefox WebExtension tab/workspace management (milestone hardening)*
*Researched: 2026-03-21*
