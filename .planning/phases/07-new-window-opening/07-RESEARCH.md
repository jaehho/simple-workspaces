# Phase 7: New-Window Opening - Research

**Researched:** 2026-03-24
**Domain:** Firefox WebExtension `browser.windows` API, popup event handling (ctrlKey, auxclick), UI cleanup
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Already-open workspace conflict**
- D-01: If a workspace is already active in another window, always focus that window — regardless of how the user clicked (regular click, middle-click, Ctrl+click, or from unassigned window)
- D-02: No new window is created for already-active workspaces. Exclusive ownership rule stays intact.
- D-03: Popup closes naturally when focusing the existing window — no extra visual feedback

**Unassigned window popup appearance**
- D-04: Remove the "No workspace assigned" banner entirely (WIN-02)
- D-05: Remove all "Assign Here" buttons from the popup (WIN-02)
- D-06: Keep "Workspaces" as the popup title in both assigned and unassigned windows
- D-07: Add a subtitle line below the title that varies by window state:
  - Unassigned window: "Click to open in new window"
  - Assigned window: "Ctrl+click to open in new window"
- D-08: Subtitle is the sole discoverability mechanism — no tooltips on workspace items

**Click behavior by window state**
- D-09: From unassigned window: regular click opens workspace in a new window (WIN-01). Current window left untouched.
- D-10: From assigned window: regular click switches workspace in current window (existing behavior, unchanged)
- D-11: From any window: middle-click opens workspace in a new window (WIN-03)
- D-12: From any window: Ctrl+click opens workspace in a new window (WIN-04)
- D-13: Ctrl+clicking or middle-clicking the workspace that is active in the current window does nothing (ignored)

**Feedback and UX**
- D-14: No extra feedback for new-window open — popup closes, new window appears naturally
- D-15: Subtitle mentions only Ctrl+click, not middle-click — middle-click is a power user affordance

### Claude's Discretion
- New window size/state (maximized, normal, inherit from current)
- Tab creation order and discarded-tab optimization in new window
- Whether to focus the new window or keep focus on the current one
- Error handling if window creation fails
- How to handle the default about:newtab tab that Firefox creates in new windows

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WIN-01 | Clicking a workspace from an unassigned window opens it in a new window instead of overriding the current window | `browser.windows.create()` + unassigned-window detection via `activeWorkspaceId === null` |
| WIN-02 | "Assign Here" buttons and unassigned-window banner are removed from the popup UI | Direct DOM removal in `popup.js` + CSS class cleanup |
| WIN-03 | User can middle-click a workspace to open it in a new window (from any window state) | `auxclick` event with `event.button === 1` check |
| WIN-04 | User can Ctrl+click a workspace to open it in a new window (from any window state) | `click` event with `event.ctrlKey === true` check |
</phase_requirements>

---

## Summary

Phase 7 introduces new-window opening as the primary action for modifier clicks and unassigned-window clicks. The core new API surface is `browser.windows.create()`, which Firefox extensions can call without any extra manifest permission beyond what is already declared. The existing tab-creation pattern from `switchWorkspace()` — create first tab active, rest discarded — transfers directly into the new window scenario by using `browser.tabs.create({ windowId: newWindow.id, ... })` after window creation, then closing the default blank tab Firefox injects.

The popup UI changes are surgical: remove the banner rendering block (lines 52-84), remove the "Assign Here" button block (lines 133-143), and replace the conditional banner removal with a subtitle element whose text varies by `activeWorkspaceId`. The click handler in the `forEach` loop gains modifier detection: `e.ctrlKey` on the existing `click` listener, plus a new `auxclick` listener on each `<li>` for middle-click (`e.button === 1`). Both route to a new `onOpenInNewWindow(workspaceId)` popup function that sends an `openWorkspaceInNewWindow` message.

On the background side, a new `openWorkspaceInNewWindow(targetId, callerWindowId)` function in `workspaces.js` performs the exclusive-ownership check first (focus existing window if already active), then calls `browser.windows.create()` with no `url` parameter (produces one blank tab), then immediately replicates the tab-creation loop from `switchWorkspace()` into the new window, and finally removes the blank initial tab. After success it calls `setWindowEntry(newWindowId, targetId)` and `updateBadge(target, newWindowId)`.

**Primary recommendation:** Use `browser.windows.create()` with no URL, then replicate the existing discarded-tab creation loop, then close the auto-created blank tab. No new manifest permission required.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `browser.windows.create()` | Built-in WebExtensions API | Create a new browser window | Only Firefox API for this; returns the new window object with `tabs` always populated |
| `browser.windows.update()` | Built-in WebExtensions API | Focus an existing window | Already used in `moveTabsToWorkspace()` — proven pattern |
| `browser.tabs.create()` | Built-in WebExtensions API | Add tabs to the new window | Already used in `switchWorkspace()` — reuse exact same discarded-tab loop |
| `browser.tabs.remove()` | Built-in WebExtensions API | Close the auto-created blank tab | Already used in `switchWorkspace()` |

### No New Packages Needed
This phase uses zero npm additions. All APIs are existing WebExtension built-ins already in use elsewhere in the codebase.

### Manifest Permission Analysis
The `windows` permission is **not listed** in the Firefox manifest permissions API reference. Firefox's `browser.windows.*` API does not require a separate manifest permission — it is available to all extensions without declaration.

- `browser.windows.create()` — no extra permission needed (MEDIUM confidence — MDN permissions page does not list "windows" as a required key; existing `browser.windows.update()` already called in Phase 6 without adding any permission)
- `browser.windows.update()` — already in use, confirmed no permission needed

**Conclusion:** `manifest.json` does not need changes for this phase.

---

## Architecture Patterns

### Recommended Call Flow

```
popup.js click/auxclick
  → browser.runtime.sendMessage({ action: 'openWorkspaceInNewWindow', workspaceId, windowId })
  → messaging.js case 'openWorkspaceInNewWindow'
  → workspaces.js openWorkspaceInNewWindow(targetId, callerWindowId)
```

### Pattern 1: Exclusive-Ownership Check Before Create

**What:** Before calling `browser.windows.create()`, iterate the `windowMap` to detect if `targetId` is already active in another window. If found, focus that window instead and return.

**When to use:** Every new-window open path, without exception (D-01, D-02).

```javascript
// Source: established pattern from switchWorkspace() lines 110-117
const windowMap = await getWindowMap()
for (const [wid, wsId] of Object.entries(windowMap)) {
  if (wsId === targetId && wid !== String(callerWindowId)) {
    await browser.windows.update(Number(wid), { focused: true })
    return { success: true, focusedExisting: true }
  }
}
```

### Pattern 2: Window Create Then Tab Loop

**What:** Create the window with no URL (produces one blank tab Firefox adds automatically), then replicate the exact discarded-tab creation loop from `switchWorkspace()` targeting `newWindow.id`, then remove the initial blank tab.

**When to use:** Any new-window open where the workspace has tabs to restore.

```javascript
// Source: browser.windows.create() MDN docs + switchWorkspace() lines 147-178
const newWindow = await browser.windows.create({ focused: true })
const blankTabId = newWindow.tabs[0].id  // always populated per MDN

// Reuse the exact tab creation loop from switchWorkspace()
const tabsToCreate = target.tabs.length > 0
  ? target.tabs
  : [{ url: 'about:newtab', title: 'New Tab', pinned: false }]

const createdTabIds = []
for (let i = 0; i < tabsToCreate.length; i++) {
  const t = tabsToCreate[i]
  const isAbout = !t.url || t.url.startsWith('about:')
  const createProps = {
    windowId: newWindow.id,
    active: i === 0,
    pinned: t.pinned || false,
  }
  if (!isAbout) {
    createProps.url = t.url
    if (i > 0) {
      createProps.discarded = true
      createProps.title = t.title || t.url
    }
  }
  try {
    const created = await browser.tabs.create(createProps)
    createdTabIds.push(created.id)
  } catch (err) {
    // fallback without discarded flag (same as switchWorkspace pattern)
    console.warn('[Workspaces] Tab create fallback for:', t.url, err)
    try {
      delete createProps.discarded
      delete createProps.title
      const created = await browser.tabs.create(createProps)
      createdTabIds.push(created.id)
    } catch (err2) {
      console.error('[Workspaces] Tab create failed entirely:', err2)
    }
  }
}

// Remove the auto-created blank tab after real tabs are loaded
await browser.tabs.remove(blankTabId)
```

### Pattern 3: Popup Click Handler Modifier Detection

**What:** Detect `e.ctrlKey` on the `click` listener, and attach a separate `auxclick` listener for middle-click (`e.button === 1`). Both call the same `onOpenInNewWindow()` function.

**When to use:** On each workspace `<li>` element in `renderList()`.

```javascript
// Source: MDN MouseEvent.ctrlKey + MDN auxclick event
li.addEventListener('click', (e) => {
  if (e.target.closest('.ws-actions')) return

  if (e.ctrlKey) {
    // D-12: Ctrl+click → open in new window
    if (!isActive) onOpenInNewWindow(ws.id)  // D-13: ignore if active here
    return
  }
  if (isInUse) {
    onFocusWindow(owningWindowId)
  } else if (activeWorkspaceId === null) {
    // D-09: unassigned window → open in new window
    onOpenInNewWindow(ws.id)
  } else if (!isActive) {
    // D-10: assigned window → switch
    onSwitch(ws.id)
  }
})

li.addEventListener('auxclick', (e) => {
  if (e.button !== 1) return  // only middle-click
  if (e.target.closest('.ws-actions')) return
  e.preventDefault()  // prevent autoscroll on Windows / paste on macOS+Linux
  if (!isActive) onOpenInNewWindow(ws.id)  // D-13: ignore if active here
})
```

### Pattern 4: Subtitle Element Injection

**What:** Add a `<p class="ws-subtitle">` (or `<span>`) to the `.header` element in `popup.html`, and update its `textContent` in `renderList()` based on `activeWorkspaceId`.

**When to use:** Once during `renderList()`, after the state response arrives.

```javascript
// popup.js — update subtitle after fetching state
const subtitle = document.getElementById('ws-subtitle')
if (subtitle) {
  subtitle.textContent = activeWorkspaceId === null
    ? 'Click to open in new window'
    : 'Ctrl+click to open in new window'
}
```

```html
<!-- popup.html — add after <h1> -->
<p id="ws-subtitle" class="ws-subtitle"></p>
```

### Anti-Patterns to Avoid

- **Passing URL array to `windows.create()`:** The docs allow it but this bypasses the discarded-tab optimization. An array of real URLs produces fully-loaded tabs immediately. Use `windows.create()` with no URL, then `tabs.create()` with the discarded flag.
- **Using `tabId` in `windows.create()`:** That moves an existing tab from the current window into the new one — the wrong semantic here.
- **Calling `onOpenInNewWindow()` when `isActive`:** D-13 says to do nothing. Must guard with `if (!isActive)` before dispatching.
- **Skipping `isSwitching` guard:** The new `openWorkspaceInNewWindow()` must set `isSwitching: true` for the duration so tab-event listeners don't trigger a save against partially-populated state in the new window.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Opening a new browser window | Custom approach | `browser.windows.create()` | Single async call; returns Window with tabs populated |
| Focusing an existing window | Re-implementing | `browser.windows.update(id, { focused: true })` | Already proven in `moveTabsToWorkspace()` |
| Middle-click detection | `mousedown` + `button` tracking | `auxclick` event + `e.button === 1` | `auxclick` fires after press+release on same element — correct semantic; `click` does not fire for non-primary buttons |

**Key insight:** The tab population loop for the new window is identical to `switchWorkspace()`. Extract it into a shared helper function rather than duplicating the 30-line loop.

---

## Common Pitfalls

### Pitfall 1: Auto-Created Blank Tab Not Removed

**What goes wrong:** `browser.windows.create()` always creates one tab (about:newtab or about:blank). If not removed after the workspace tabs are created, the user sees an extra blank tab in the new window.

**Why it happens:** Firefox cannot open a window with zero tabs. The API always creates one initial tab.

**How to avoid:** Capture `newWindow.tabs[0].id` immediately after `browser.windows.create()` resolves (the `tabs` property is always populated on the returned Window object per MDN). After all workspace tabs are created successfully, call `browser.tabs.remove(blankTabId)`.

**Warning signs:** New window has one extra blank/newtab tab at the end or beginning of the tab strip.

### Pitfall 2: isSwitching Flag Not Set

**What goes wrong:** While tabs are being created in the new window, the `tabs.onCreated` event fires for each new tab. `throttledSave()` is invoked for the new window. The new window has no `windowMap` entry yet, so `throttledSave` skips it correctly — but if `isSwitching` isn't set, there is a race: if the new window somehow gets a map entry before all tabs are created, partial state could be saved.

**Why it happens:** `switchWorkspace()` sets `isSwitching` for this exact reason. New-window creation is an analogous operation.

**How to avoid:** Set `isSwitching: true` at the start of `openWorkspaceInNewWindow()` and clear it in a `finally` block, matching the `switchWorkspace()` pattern exactly.

**Warning signs:** Saved workspace tab list is shorter than expected after a new-window open.

### Pitfall 3: Middle-Click Opens New Browser Tab

**What goes wrong:** On list items with `href` attributes (none here) or certain system configurations, middle-click opens a new browser tab instead of triggering `auxclick` on the element.

**Why it happens:** Middle-click's default browser behavior is URL-open (for links) or autoscroll (Windows) or clipboard paste (Linux/macOS). The popup items are `<li>` elements with no `href`, so URL-open is not a concern. Autoscroll/paste can be prevented with `e.preventDefault()` on the `auxclick` event.

**How to avoid:** Call `e.preventDefault()` at the top of the `auxclick` handler, before any logic. This is safe because the `<li>` elements have no default middle-click meaning.

**Warning signs:** Middle-click causes page scroll initiation (Windows autoscroll mode) instead of opening workspace.

### Pitfall 4: Ctrl+Click on macOS Becomes Right-Click

**What goes wrong:** On macOS, Ctrl+click is intercepted by the OS as a right-click (context menu trigger). The `click` event's `ctrlKey` property may be `true` on macOS but the context menu also opens.

**Why it happens:** macOS system-level interception of Ctrl+left-click.

**How to avoid:** The extension popup runs in a Firefox chrome context, not a regular web page. macOS Ctrl+click in Firefox popups fires the contextmenu event but also fires `click` with `ctrlKey: true`. Adding `e.preventDefault()` on the `click` handler suppresses the context menu in the popup context. This is acceptable since the popup does not use a context menu.

**Warning signs:** On macOS test, Ctrl+click opens a context menu instead of opening workspace in new window.

### Pitfall 5: Ctrl+Click Opens New Firefox Tab

**What goes wrong:** Ctrl+click on links (and sometimes other interactive elements) in Firefox normally opens them in a new tab. Inside an extension popup, this behavior should be suppressed.

**Why it happens:** Extension popups run in a special chrome window context. Ctrl+click on non-link elements inside the popup does NOT trigger the new-tab behavior because there is no URL to navigate to. This pitfall is not a real concern for `<li>` items with no `href`.

**How to avoid:** No action needed — the `<li>` elements are not anchors.

### Pitfall 6: `isActive` Guard Missed for Modifier Clicks

**What goes wrong:** D-13 says Ctrl+click or middle-click on the currently active workspace should do nothing. If the guard is omitted, clicking the active workspace would attempt to open a new window of the already-active workspace, which then hits the exclusive-ownership check in the background and returns an error — but the popup has already closed or shown a stale state.

**Why it happens:** Easy to miss in the click handler branching logic.

**How to avoid:** In the `click` handler Ctrl branch and the `auxclick` handler, add `if (!isActive) { onOpenInNewWindow(ws.id) }` — identical to how the existing regular-click handler guards with `else if (!isActive)`.

---

## Code Examples

### openWorkspaceInNewWindow function skeleton

```javascript
// workspaces.js — new exported function
// Source: windows.create() MDN + switchWorkspace() lines 100-214
export async function openWorkspaceInNewWindow(targetId) {
  await setSessionState({ isSwitching: true })
  try {
    const workspaces = await getWorkspaces()
    if (!workspaces.length) throw new Error('No workspaces found')

    // D-01/D-02: If already active in another window, focus it instead
    const windowMap = await getWindowMap()
    for (const [wid, wsId] of Object.entries(windowMap)) {
      if (wsId === targetId) {
        await browser.windows.update(Number(wid), { focused: true })
        return { success: true, focusedExisting: true }
      }
    }

    const target = workspaces.find(w => w.id === targetId)
    if (!target) throw new Error('Target workspace not found')

    // Create new empty window — Firefox always injects one blank tab
    const newWindow = await browser.windows.create({ focused: true })
    const blankTabId = newWindow.tabs[0].id

    const tabsToCreate = target.tabs.length > 0
      ? target.tabs
      : [{ url: 'about:newtab', title: 'New Tab', pinned: false }]

    const createdTabIds = []
    for (let i = 0; i < tabsToCreate.length; i++) {
      // ... identical to switchWorkspace tab-creation loop
    }

    // Remove the auto-injected blank tab
    await browser.tabs.remove(blankTabId)

    target.lastUsedAt = Date.now()
    await saveWorkspaces(workspaces)
    await setWindowEntry(newWindow.id, targetId)
    updateBadge(target, newWindow.id)

    return { success: true }
  } catch (e) {
    console.error('[Workspaces] Open in new window error:', e)
    return { success: false, error: e.message }
  } finally {
    await setSessionState({ isSwitching: false })
  }
}
```

### popup.js subtitle update

```javascript
// Inside renderList(), after destructuring state
const subtitle = document.getElementById('ws-subtitle')
if (subtitle) {
  subtitle.textContent = activeWorkspaceId === null
    ? 'Click to open in new window'
    : 'Ctrl+click to open in new window'
}
```

### popup.html header addition

```html
<div class="header">
  <div class="header-text">
    <h1>Workspaces</h1>
    <p id="ws-subtitle" class="ws-subtitle"></p>
  </div>
  <button id="btn-add" ...>...</button>
</div>
```

### popup.css subtitle style

```css
.ws-subtitle {
  font-size: 10px;
  color: #6c7086;
  font-weight: 400;
  margin-top: 1px;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Banner + "Assign Here" button for unassigned windows | Subtitle-only discoverability | Phase 7 | Simpler popup; no more dual-mode UI |
| All clicks from unassigned window attempted "assign here" | All clicks open workspace in a new window | Phase 7 | Unassigned window is now a neutral launcher, not overridden |

**Deprecated in this phase:**
- `onAssign()` function in `popup.js` — removed; `assignWorkspace` background action no longer called from popup
- `.ws-unassigned-banner` and related CSS classes — removed
- `.ws-actions button.assign` CSS — removed
- `workspace-list--unassigned` CSS class and its rule `.workspace-list--unassigned .ws-actions { opacity: 1 }` — removed

---

## Open Questions

1. **`windows` permission in manifest**
   - What we know: The Firefox permissions reference does not list "windows" as a required permission. `browser.windows.update()` already works in Phase 6 without it declared.
   - What's unclear: Whether Firefox silently allows `windows.create()` without declaration or whether addons-linter will warn.
   - Recommendation: Do not add "windows" permission initially. Run `npm run lint` after implementation; if addons-linter reports a violation, add it then.

2. **New window focus behavior**
   - What we know: `browser.windows.create({ focused: true })` focuses the new window per the API parameter.
   - What's unclear: Whether keeping focus on the current window (caller's window) is preferable UX. The CONTEXT.md lists this as Claude's Discretion.
   - Recommendation: Use `focused: true` (default). The user explicitly acted to open a workspace — bringing the new window forward is the natural affordance.

3. **Window state/size**
   - What we know: `browser.windows.create()` supports `state: 'maximized' | 'normal'` and `width`/`height` parameters.
   - What's unclear: Whether to inherit the size of the current window or let Firefox decide.
   - Recommendation: Pass no `state`, `width`, or `height` parameters. Firefox will use its default new-window size. Attempting to inherit size adds complexity and `browser.windows.getCurrent()` adds a round-trip. The CONTEXT.md lists this as Claude's Discretion and the current pattern in `switchWorkspace()` does not manage window geometry.

4. **Rollback on partial tab creation failure**
   - What we know: `switchWorkspace()` has a full rollback that closes created tabs and restores storage snapshots. For new-window creation, if tab creation fails mid-loop, the new window exists with partial tabs.
   - What's unclear: Whether to close the entire new window on failure or leave partial state for user recovery.
   - Recommendation: On failure, close the new window entirely (`browser.windows.remove(newWindow.id)`) and return `{ success: false, error }`. The window was created by the extension — closing it is less surprising than leaving it partially populated.

---

## Sources

### Primary (HIGH confidence)
- [MDN windows.create()](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/create) — full parameter list, return value shape (`tabs` always set), URL array behavior
- [MDN auxclick event](https://developer.mozilla.org/en-US/docs/Web/API/Element/auxclick_event) — event semantics, `button === 1` for middle-click, `preventDefault()` guidance
- [MDN MouseEvent.ctrlKey](https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/ctrlKey) — boolean flag on click events, macOS caveat
- Existing codebase `switchWorkspace()` (lines 100-214) — tab creation loop, isSwitching guard, rollback pattern — verified by reading source

### Secondary (MEDIUM confidence)
- [MDN permissions reference](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/permissions) — "windows" not listed as a required permission keyword; existing `browser.windows.update()` usage in Phase 6 without permission as corroborating evidence
- [MDN windows API overview](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows) — confirms available methods and constants

### Tertiary (LOW confidence)
- Web search results on "windows permission not required" — no single definitive source found; conclusion inferred from absence in permission list and existing codebase behavior

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `browser.windows.create()` documented on MDN; tab-creation loop is existing proven code
- Architecture: HIGH — patterns derived directly from existing `switchWorkspace()` and `moveTabsToWorkspace()` in the codebase
- Pitfalls: HIGH for blank-tab removal, isSwitching guard, auxclick preventDefault (documented behavior); MEDIUM for macOS Ctrl+click (browser behavior, not extension-specific test performed)
- Permission requirement: MEDIUM — no explicit "windows" permission key exists in Firefox manifest spec; absence is not absolute proof

**Research date:** 2026-03-24
**Valid until:** 2026-06-24 (stable Firefox WebExtensions API — changes infrequently)
