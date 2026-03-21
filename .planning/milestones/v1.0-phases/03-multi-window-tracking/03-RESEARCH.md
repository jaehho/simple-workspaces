# Phase 3: Multi-Window Tracking - Research

**Researched:** 2026-03-21
**Domain:** Firefox WebExtensions multi-window state management
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Exclusive ownership — one workspace per window. Two windows cannot have the same workspace active simultaneously.
- **D-02:** Clicking a workspace that's active in another window focuses that window (no "take over" or "steal" option).
- **D-03:** No detection of duplicate tabs across windows — if a user manually opens the same tabs in two windows, that's their responsibility.
- **D-04:** Closing a window releases its workspace — the workspace becomes available for any window to claim.
- **D-05:** In-use workspaces appear in the same list (not grouped separately, not dimmed). A subtle icon indicator marks them as in use by another window.
- **D-06:** Clicking an in-use workspace focuses the owning window and closes the popup.
- **D-07:** The current window's active workspace is visually highlighted (beyond just a text label — visual treatment like background color or border, not just "active" text).
- **D-08:** New windows start unassigned — no workspace, tabs are not tracked until the user explicitly assigns one.
- **D-09:** Popup in an unassigned window shows: full workspace list (with in-use indicators), option to create a new workspace, and option to move all currently open tabs in that window into a workspace.
- **D-10:** On browser restart (new `windowId` values), each window attempts to reclaim its previous workspace by matching its open tabs against saved workspace tab URLs. If no match is found, the window stays unassigned.

### Claude's Discretion

- Badge display for unassigned windows (empty, "?", or nothing)
- Tab-URL matching algorithm for restart reclaim (exact match, fuzzy, threshold)
- Icon choice for "in use by another window" indicator
- Visual highlight style for current workspace (background, border, accent)
- Storage location for window-workspace mapping (storage.session vs in-memory with session backup)
- How "move tabs to workspace" works in the popup (dropdown, modal, inline action)
- Whether `windows.onFocusChanged` triggers a save or just updates badge
- Exact message actions added to the messaging router

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WIN-01 | Each window tracks its own active workspace independently via `windowId → workspaceId` mapping | storage.session is the right store for this map; clears on restart (intentional, reclaim handles it) |
| WIN-02 | Popup shows which workspaces are active in other windows | `getState` message must return `windowWorkspaceMap` so popup can compare; `getAll` on windows not needed — the map itself is the answer |
| WIN-03 | User can switch to the window that owns a workspace (or close it) from the popup | `windows.update({ focused: true })` with the owning windowId is the mechanism |
| WIN-04 | Tab queries use explicit `windowId` from event context instead of `currentWindow: true` | Every tab event callback receives `tab.windowId` or `removeInfo.windowId`; pass it explicitly to save/switch functions |
| WIN-05 | `windows.onFocusChanged` handler filters out `WINDOW_ID_NONE` events | `WINDOW_ID_NONE` (-1) is always fired before a real window focus on Windows OS; guard with `if (windowId === browser.windows.WINDOW_ID_NONE) return` |
| WIN-06 | Per-window badge text shows each window's active workspace initial | `browser.action.setBadgeText({ text, windowId })` and `browser.action.setBadgeBackgroundColor({ color, windowId })` both accept `windowId` |
</phase_requirements>

---

## Summary

This phase replaces the global `activeWorkspaceId` in `browser.storage.local` with a per-window `windowId → workspaceId` map stored in `browser.storage.session`. Session storage is the correct choice: it survives background-script unloads (MV3 event page), clears automatically on browser restart (enabling the reclaim-on-restart flow), and keeps the local storage schema stable for Phase 4's sync migration.

The critical API insight for this phase is that **popup scripts cannot determine their own window ID from the message `sender` object**. When a popup calls `browser.runtime.sendMessage()`, `sender.tab` is `null` because the popup is not a content script. The popup must call `browser.windows.getCurrent()` from within the popup script to get its window ID and include it explicitly in every message payload.

The second key insight is that **all tab event callbacks already provide `windowId`** — either as `tab.windowId` on the `Tab` object (onCreated, onUpdated) or as `removeInfo.windowId` (onRemoved). The `currentWindow: true` approach used by the current `saveCurrentWorkspace()` and `switchWorkspace()` is what must be replaced (WIN-04). Both functions need an explicit `windowId` parameter.

**Primary recommendation:** Store `windowWorkspaceMap` as a single object (`{ [windowId]: workspaceId }`) under a dedicated key in `storage.session`. Merge it into the existing `bgState` session key or keep it separate — separate key is cleaner since the two concerns have different update frequencies.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `browser.windows` API | Built-in (Firefox 45+) | Window enumeration, focus, lifecycle events | Only API for window management in WebExtensions |
| `browser.storage.session` | Built-in (Firefox 112+) | In-memory per-session state, survives background unload | Correct store for ephemeral window→workspace map |
| `browser.action.setBadgeText` | Built-in (MV3) | Per-window badge text via `{ text, windowId }` | Accepts `windowId` parameter — no workaround needed |

### No New npm Dependencies

This phase adds no new npm packages. All required APIs are Firefox built-ins already covered by the extension's existing permissions (`tabs`, `storage`).

**Version verification:** No npm packages to verify. The `browser.windows` API and `storage.session` are available since Firefox 112 (well below the manifest's `strict_min_version: 142.0`).

---

## Architecture Patterns

### Recommended Storage Schema

Two session keys, kept separate from each other and from local storage:

```
storage.session:
  bgState: { isSwitching: boolean, lastSaveTime: number }   ← existing (Phase 1)
  windowMap: { [windowId: string]: string | null }           ← new (Phase 3)
    // windowId is the integer window ID coerced to string for object keys
    // value is workspaceId string, or null if window is unassigned
```

`storage.local` schema **does not change** this phase. The `activeWorkspaceId` field is deprecated but may remain for Phase 4 migration compatibility — the planner should decide whether to remove it now or leave it for Phase 4's migration task.

### Recommended Project Structure Changes

No new files required. Changes are contained within the existing modules:

```
src/background/
  index.js       ← add windows.onCreated, windows.onRemoved, windows.onFocusChanged listeners
  state.js       ← add getWindowMap(), setWindowMap(), updateWindowEntry() helpers
  workspaces.js  ← saveCurrentWorkspace(windowId), switchWorkspace(targetId, windowId),
                    updateBadge(workspace, windowId), initWindowWorkspace(windowId)
  messaging.js   ← update getState to accept windowId, add focusWindow action
src/popup/
  popup.js       ← getCurrent() at init, pass windowId in all messages, render in-use indicators
```

### Pattern 1: Popup Window-ID Acquisition

The popup cannot rely on `sender` for window identity. It must call `windows.getCurrent()` at startup and pass the ID forward.

```javascript
// src/popup/popup.js — at DOMContentLoaded
// Source: MDN windows.getCurrent (confirmed: returns the window the popup
// belongs to when called from a popup script associated with a browser window)
let currentWindowId = null

document.addEventListener('DOMContentLoaded', async () => {
  const win = await browser.windows.getCurrent()
  currentWindowId = win.id
  // all subsequent messages include { windowId: currentWindowId }
  allColors = await browser.runtime.sendMessage({ action: 'getColors' })
  await renderList()
  // ...
})
```

**Confidence note:** MDN states "if it is called from a script whose document is associated with a particular browser window, then it returns that browser window." A popup IS associated with the window whose toolbar button was clicked. MEDIUM confidence on the exact wording, but the pattern is well-established in community examples. Alternative: have the popup call `browser.tabs.query({ active: true, currentWindow: true })` and use the returned tab's `windowId` — this is HIGH confidence since `tabs` permission is already granted.

**Recommended approach (HIGH confidence):** Use `browser.tabs.query({ active: true, currentWindow: true })` from the popup. The `currentWindow: true` flag is reliable in popup context (it refers to the window the popup is opened in). Extract `tabs[0].windowId`.

```javascript
// HIGH confidence: tabs permission already granted, currentWindow is reliable in popup context
const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true })
currentWindowId = activeTab.windowId
```

### Pattern 2: Window Map Helpers (state.js additions)

```javascript
// src/background/state.js
const WINDOW_MAP_KEY = 'windowMap'

export async function getWindowMap() {
  const result = await browser.storage.session.get({ [WINDOW_MAP_KEY]: {} })
  return result[WINDOW_MAP_KEY]
}

export async function setWindowEntry(windowId, workspaceId) {
  const map = await getWindowMap()
  map[String(windowId)] = workspaceId  // null means unassigned
  await browser.storage.session.set({ [WINDOW_MAP_KEY]: map })
}

export async function removeWindowEntry(windowId) {
  const map = await getWindowMap()
  delete map[String(windowId)]
  await browser.storage.session.set({ [WINDOW_MAP_KEY]: map })
}
```

### Pattern 3: Tab Event Listeners with Explicit windowId (index.js)

The current listeners call `throttledSave()` with no arguments. After this phase, they must pass the `windowId` extracted from the event's tab or info object.

```javascript
// Source: MDN tabs.onCreated — tab parameter is a tabs.Tab object with .windowId
browser.tabs.onCreated.addListener((tab) => throttledSave(tab.windowId))

// Source: MDN tabs.onRemoved — removeInfo has .windowId and .isWindowClosing
browser.tabs.onRemoved.addListener((_tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing) throttledSave(removeInfo.windowId)
})

// Source: MDN tabs.onUpdated — tab parameter has .windowId
browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.title || changeInfo.pinned !== undefined) {
    throttledSave(tab.windowId)
  }
})

// Source: MDN tabs.onMoved — moveInfo has .windowId
browser.tabs.onMoved.addListener((_tabId, moveInfo) => throttledSave(moveInfo.windowId))

// tabs.onAttached — attachInfo has .newWindowId (and detached has .oldWindowId)
browser.tabs.onAttached.addListener((_tabId, attachInfo) => throttledSave(attachInfo.newWindowId))
browser.tabs.onDetached.addListener((_tabId, detachInfo) => throttledSave(detachInfo.oldWindowId))
```

### Pattern 4: Per-Window Badge Update

```javascript
// Source: MDN browser.action.setBadgeText — windowId parameter confirmed
// Source: MDN browser.action.setBadgeBackgroundColor — windowId parameter confirmed
export function updateBadge(workspace, windowId) {
  const opts = windowId !== undefined ? { windowId } : {}
  const initial = workspace ? workspace.name.charAt(0).toUpperCase() : '?'
  const color = workspace ? sanitizeColor(workspace.color) : '#888888'
  browser.action.setBadgeText({ text: initial, ...opts })
  browser.action.setBadgeBackgroundColor({ color, ...opts })
}
```

For unassigned windows: recommend badge text `'?'` with neutral gray `#888888`. This makes it clear the window has no workspace without being alarming.

### Pattern 5: Window Focus Action (WIN-03)

```javascript
// Source: MDN windows.update — { focused: true } brings window to front
export async function focusWindow(windowId) {
  try {
    await browser.windows.update(windowId, { focused: true })
    return { success: true }
  } catch (e) {
    console.error('[Workspaces] Focus window error:', e)
    return { success: false, error: e.message }
  }
}
```

In the popup: after sending `focusWindow` message, call `window.close()` to dismiss the popup (D-06).

### Pattern 6: windows.onFocusChanged Filtering (WIN-05)

```javascript
// Source: MDN windows.onFocusChanged — WINDOW_ID_NONE always precedes window switch on Windows OS
browser.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === browser.windows.WINDOW_ID_NONE) return
  // Optional: update badge for the newly focused window
  // No save needed — saves happen on tab events
})
```

**Decision for planner (Claude's Discretion):** `onFocusChanged` does NOT trigger a save. Tab events already handle saves. Focus change only needs to update the badge if needed, or can be a no-op that just filters `WINDOW_ID_NONE`. Recommend: update badge on focus change to ensure badge reflects the correct workspace after the user focuses a window that was opened during a previous session.

### Pattern 7: Restart Reclaim (D-10)

On `browser.runtime.onStartup`, the windowMap is empty (session cleared). Windows must reclaim their previous workspaces by URL matching.

**Recommended algorithm (URL-intersection scoring):**

```javascript
// For each open window, score each workspace by counting URL matches
// A workspace is claimed if intersection / total_workspace_tabs >= THRESHOLD
// Use THRESHOLD = 0.5 (more than half the workspace tabs found in the window)
const RECLAIM_THRESHOLD = 0.5

async function reclaimWorkspaces() {
  const raw = await browser.storage.local.get(['workspaces'])
  const { workspaces } = validateWorkspaceData(raw)
  if (!workspaces.length) return

  const windows = await browser.windows.getAll({ populate: true })
  const claimed = new Set()  // workspaceIds already claimed by a window

  for (const win of windows) {
    const winUrls = new Set(
      (win.tabs || [])
        .map(t => t.url)
        .filter(u => u && !u.startsWith('about:') && !u.startsWith('moz-extension:'))
    )

    let bestScore = 0
    let bestWorkspace = null

    for (const ws of workspaces) {
      if (claimed.has(ws.id)) continue
      const wsUrls = ws.tabs.map(t => t.url)
      if (wsUrls.length === 0) continue
      const matches = wsUrls.filter(u => winUrls.has(u)).length
      const score = matches / wsUrls.length
      if (score > bestScore && score >= RECLAIM_THRESHOLD) {
        bestScore = score
        bestWorkspace = ws
      }
    }

    if (bestWorkspace) {
      await setWindowEntry(win.id, bestWorkspace.id)
      updateBadge(bestWorkspace, win.id)
      claimed.add(bestWorkspace.id)
    }
    // else: window stays unassigned
  }
}
```

**Why 50% threshold:** Exact matching (100%) is fragile — users may have navigated a few tabs since last session. Fuzzy (< 50%) risks false matches when two workspaces share common tabs. 50% balances correctness and robustness.

### Pattern 8: getState Response (messaging.js)

The popup needs to know the window map to render in-use indicators. Update `getState`:

```javascript
case 'getState': {
  const raw = await browser.storage.local.get(['workspaces'])
  const { workspaces } = validateWorkspaceData(raw)
  const windowMap = await getWindowMap()
  return {
    workspaces,
    windowMap,               // { [windowId]: workspaceId }
    currentWindowId: msg.windowId,  // echo back for convenience
    activeWorkspaceId: windowMap[String(msg.windowId)] || null,
  }
}
```

### Anti-Patterns to Avoid

- **Using `currentWindow: true` in background tab queries after WIN-04:** Background scripts have no reliable "current window" concept. Always use explicit `windowId`.
- **Storing window-workspace map in `storage.local`:** This would persist across restarts and block the reclaim flow. Session storage is intentional.
- **Sending `getState` without `windowId` from the popup:** Without `windowId`, the background cannot determine which window is asking and cannot return the correct `activeWorkspaceId`.
- **Checking `sender.tab.windowId` in `handleMessage`:** Popups are extension pages — `sender.tab` is `null`. Never rely on this for window identity.
- **Setting global badge (no `windowId`) after per-window map is established:** After Phase 3, all badge updates must use `{ windowId }`. A global badge set would override all per-window badges.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bringing window to front | Custom z-order logic | `browser.windows.update(id, { focused: true })` | API handles OS-level window focusing |
| Per-window badge | Tab-level hacks or CSS tricks | `browser.action.setBadgeText({ text, windowId })` | Native API, single call |
| Window lifecycle tracking | Polling with `getAll()` | `windows.onCreated`, `windows.onRemoved` | Push events, no polling |
| Persistent session state | Custom IDB or localStorage | `browser.storage.session` | Built-in, survives background unload |

**Key insight:** The Firefox WebExtension API has first-class support for per-window badge text and background color via the `windowId` parameter in `browser.action` methods. No workarounds needed.

---

## Common Pitfalls

### Pitfall 1: WINDOW_ID_NONE Firing Before Every Focus Switch

**What goes wrong:** `windows.onFocusChanged` fires `WINDOW_ID_NONE` immediately before the real focused window ID on Windows OS and some Linux window managers. If the handler triggers saves or state updates on every event, it will fire twice per window switch — once with -1, once with the real ID.

**Why it happens:** OS-level event sequence exposes a transient "no window focused" state between switching.

**How to avoid:** Guard at the top of the handler — `if (windowId === browser.windows.WINDOW_ID_NONE) return`.

**Warning signs:** Badge flickering, double-save logs, or "window not found" errors on every focus change.

### Pitfall 2: Race Between Window Close and Tab Events

**What goes wrong:** When a window closes, `tabs.onRemoved` fires for each tab with `isWindowClosing: true`, AND `windows.onRemoved` fires. The ordering is not guaranteed. If `windows.onRemoved` removes the map entry before a tab event handler tries to use it, `getWindowMap()` returns no entry and the throttled save tries to save "unknown window's" workspace.

**Why it happens:** Multiple event listeners run concurrently; storage reads are async.

**How to avoid:** In `throttledSave(windowId)`, skip the save if the windowId has no entry in the map (i.e., if it's already been cleaned up). The `isWindowClosing` guard already prevents the tab save — add the map-entry check as a secondary guard.

### Pitfall 3: Popup Gets Wrong Window ID

**What goes wrong:** Using `browser.windows.getCurrent()` from a background context returns the focused window, not the window that triggered the popup. If background processes `getState` and calls `getCurrent()` server-side, it may return the wrong window.

**Why it happens:** `getCurrent()` is context-dependent. In background, it returns the focused window.

**How to avoid:** Always determine window ID in the popup script (not the background), then pass it in the message. The background echo-pattern (accepting `msg.windowId`) is the correct design.

### Pitfall 4: Exclusive Ownership Violated by Concurrent Switches

**What goes wrong:** User opens popup in Window A and Window B simultaneously and both try to switch to the same workspace. Both check the map before either updates it, so both see the workspace as unclaimed.

**Why it happens:** The `isSwitching` lock in `storage.session` is global, not per-workspace. Two windows can start a switch to the same workspace concurrently.

**How to avoid:** When beginning a switch, check the windowMap atomically: if `targetId` is already a value in the map (and the owning windowId is not this window), reject the switch with an error. Do this check inside the `isSwitching` lock window after setting `isSwitching: true`.

### Pitfall 5: Stale windowMap After Restart

**What goes wrong:** Developer tests with persistent `storage.local` state but expects session state to survive restart. Session storage clears on every browser restart — the windowMap will always be empty on startup, requiring the reclaim flow.

**Why it happens:** `storage.session` is in-memory only; this is intentional and documented behavior.

**How to avoid:** Always wire `runtime.onStartup` to `reclaimWorkspaces()`. Do not assume `windowMap` has entries on startup.

### Pitfall 6: tabs.onMoved / tabs.onAttached / tabs.onDetached Window Attribution

**What goes wrong:** When a tab is dragged from one window to another, `onDetached` fires for the old window and `onAttached` fires for the new window. If `throttledSave(windowId)` saves the old window (now missing that tab), the workspace loses the tab. If the new window has no workspace yet, the save is skipped but the old window's workspace now has a stale tab.

**Why it happens:** Tab movement between windows is a partial state — the tab is in neither window for a moment.

**How to avoid:** On `onDetached`, save the old window's workspace (it now has fewer tabs). On `onAttached`, save the new window's workspace (it now has more tabs). Both `windowId` values are available in `detachInfo.oldWindowId` and `attachInfo.newWindowId`.

---

## Code Examples

Verified patterns from official MDN sources:

### windows.onFocusChanged — WINDOW_ID_NONE Filter (WIN-05)

```javascript
// Source: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/onFocusChanged
browser.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === browser.windows.WINDOW_ID_NONE) return
  // handle focus change
})
```

### Per-Window Badge (WIN-06)

```javascript
// Source: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/action/setBadgeText
browser.action.setBadgeText({ text: 'W', windowId: 42 })
// Source: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/action/setBadgeBackgroundColor
browser.action.setBadgeBackgroundColor({ color: '#3b82f6', windowId: 42 })
```

### Focus Window (WIN-03)

```javascript
// Source: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/update
await browser.windows.update(windowId, { focused: true })
```

### Tab Event windowId Extraction

```javascript
// Source: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/onCreated
// tab is a tabs.Tab object — .windowId is always present
browser.tabs.onCreated.addListener((tab) => throttledSave(tab.windowId))

// Source: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/onRemoved
// removeInfo.windowId and removeInfo.isWindowClosing both available
browser.tabs.onRemoved.addListener((_tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing) throttledSave(removeInfo.windowId)
})

// Source: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/onAttached
// attachInfo.newWindowId is the window the tab was moved to
browser.tabs.onAttached.addListener((_tabId, attachInfo) => throttledSave(attachInfo.newWindowId))
```

### windows.onRemoved — Release Workspace

```javascript
// Source: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/onRemoved
browser.windows.onRemoved.addListener(async (windowId) => {
  await removeWindowEntry(windowId)
  // D-04: closing a window releases its workspace — no further action needed
})
```

### Popup Window ID via tabs.query (HIGH confidence)

```javascript
// Source: MDN tabs.query — currentWindow: true is reliable in popup context
// tabs permission already granted in manifest
const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true })
const currentWindowId = activeTab.windowId
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Global `activeWorkspaceId` in `storage.local` | Per-window `windowMap` in `storage.session` | Phase 3 | Multiple windows can each have different workspaces |
| `browser.tabs.query({ currentWindow: true })` | Explicit `windowId` parameter | Phase 3 (WIN-04) | Correct multi-window attribution |
| Global badge (no windowId) | Per-window badge with `{ windowId }` | Phase 3 (WIN-06) | Each window shows its own workspace |
| `initDefaultWorkspace()` on install assigns to current window | `initWindowWorkspace(windowId)` for explicit window context | Phase 3 | New windows start unassigned (D-08) |

**Deprecated after this phase:**
- `activeWorkspaceId` in `storage.local`: deprecated as the runtime source of truth (replaced by `windowMap`). May remain in local storage as the "last saved" default for Phase 4 migration — planner should decide.
- `currentWindow: true` in background tab queries: replace entirely with explicit `windowId`.

---

## Open Questions

1. **`activeWorkspaceId` in `storage.local` — keep or remove?**
   - What we know: Phase 4 sync migration will need to read existing `storage.local` data. Removing `activeWorkspaceId` now means Phase 4 migration has no default workspace to assign.
   - What's unclear: Whether Phase 4 needs it or can derive the default from another source.
   - Recommendation: Keep `activeWorkspaceId` in local storage as a legacy field (do not write to it in Phase 3), remove in Phase 4 after migration.

2. **`throttledSave` per-window throttle — one global throttle or per-window?**
   - What we know: Current implementation uses a single `lastSaveTime` for all windows. If Window A triggers a save and Window B's tabs change within 500ms, Window B's save is suppressed.
   - What's unclear: Is this a real problem in practice? Users rarely change tabs in two windows within 500ms.
   - Recommendation: Keep a single global `lastSaveTime` for simplicity. The throttle window is 500ms — acceptable collision risk. If Phase 3 proves this a problem, upgrade to per-window throttle via `{ lastSaveTimes: { [windowId]: number } }` in session state.

3. **"Move tabs to workspace" UI in unassigned window popup (D-09)**
   - What we know: D-09 requires this option but doesn't specify UI. Claude's discretion.
   - What's unclear: Modal vs inline action vs dropdown.
   - Recommendation: Inline action button per workspace item — "Assign here" button appears in the actions area. Clicking saves the current window's tabs into that workspace and activates it. Avoids a second modal.

4. **Badge for unassigned windows (Claude's Discretion)**
   - Recommendation: Use `'?'` with a gray background (`#888888`). Empty string `''` hides the badge entirely (less discoverable). `'?'` signals the window is untracked without being alarming.

---

## Sources

### Primary (HIGH confidence)

- MDN `windows.onFocusChanged` — WINDOW_ID_NONE behavior, event signature
- MDN `windows.update` — `{ focused: true }` for focus switching
- MDN `windows.onRemoved` — `windowId` parameter in listener
- MDN `action.setBadgeText` — `windowId` parameter confirmed
- MDN `action.setBadgeBackgroundColor` — `windowId` parameter confirmed
- MDN `tabs.onCreated` — listener receives `Tab` object with `windowId`
- MDN `tabs.onRemoved` — `removeInfo.windowId` and `removeInfo.isWindowClosing` confirmed
- MDN `tabs.onAttached` — `attachInfo.newWindowId` confirmed
- MDN `storage.session` — 10MB limit, survives background unload, clears on browser restart
- MDN `runtime.MessageSender` — `sender.tab` is null for popup/extension page messages (confirmed)
- MDN `tabs.getCurrent` — returns `undefined` from popup context (confirmed)

### Secondary (MEDIUM confidence)

- MDN `windows.getCurrent` — behavior from popup context is documented but the popup/window association is implicit in the docs; alternative `tabs.query({ currentWindow: true })` preferred for clarity.

### Tertiary (LOW confidence)

- None — all critical claims verified against official MDN documentation.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all APIs are official Firefox WebExtension built-ins, MDN verified
- Architecture: HIGH — patterns derived directly from API signatures and MDN documentation
- Pitfalls: HIGH — WINDOW_ID_NONE explicitly documented; concurrency pitfall is logical from the API design; others are empirically obvious from async storage patterns
- Restart reclaim algorithm: MEDIUM — threshold of 0.5 is a judgment call; no official guidance exists on URL matching heuristics

**Research date:** 2026-03-21
**Valid until:** 2026-09-21 (stable APIs — Firefox WebExtension API surface changes rarely)
