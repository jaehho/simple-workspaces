# Pitfalls Research

**Domain:** Firefox WebExtension — tab/workspace management with MV3 migration, storage.sync, multi-window tracking
**Researched:** 2026-03-21
**Confidence:** HIGH (critical pitfalls verified against MDN, Extension Workshop, and Bugzilla; medium pitfalls from official docs + community sources)

---

## Critical Pitfalls

### Pitfall 1: Global in-memory state silently resets in MV3 non-persistent background

**What goes wrong:**
After migrating to MV3, the background script becomes non-persistent (an "event page"). It is loaded on demand and unloaded after a few seconds of inactivity. Any in-memory variable — `isSwitching`, `saveTimeout`, the active window ID — is wiped on unload. When the next tab event fires and reloads the background, all those variables start from their initial values. This means a switch in progress when the background unloads will leave `isSwitching` stuck at `false` on reload, allowing a concurrent save to corrupt the partial switch state.

**Why it happens:**
MV2 persistent background pages never unload, so global variables work fine. Developers port the code 1:1 to MV3 and assume the same lifetime. Firefox does not warn when a variable is reset — the extension continues to run silently with corrupted state.

**How to avoid:**
- Move all cross-event state to `browser.storage.session` (cleared on browser shutdown, 10 MB limit, synchronous-feeling API). This is the correct MV3 replacement for in-memory state.
- The `isSwitching` flag and `saveTimeout` replacement must be stored in `storage.session` or a per-message lock pattern, not module-scope variables.
- Replace `setTimeout` / `clearTimeout` with `browser.alarms` API. Alarms survive background unloading; `setTimeout` does not.
- Register all event listeners at the top level synchronously so they survive script reload.

**Warning signs:**
- Tab saves fire during an active workspace switch (indicates `isSwitching` was reset mid-operation).
- Workspace switch partially completes, leaving old and new tabs mixed.
- Any state visible via `getBackgroundPage()` returns stale or default values after a period of inactivity.

**Phase to address:** MV3 migration phase, before storage.sync or multi-window work. All state-holding variables must be audited before any other changes are made on top of MV3.

---

### Pitfall 2: storage.sync QUOTA_BYTES_PER_ITEM (8,192 bytes) breaks tab-rich workspaces

**What goes wrong:**
The current extension stores all workspaces as a single `workspaces` array key under `storage.local`. Migrating to `storage.sync` naively (replacing `.local` with `.sync`) will immediately hit the per-item limit of 8,192 bytes for any workspace with more than ~20-30 tabs (each tab serializes to roughly 200-400 bytes depending on URL and title length). The `storage.sync.set()` call fails with a quota error. The extension silently stops saving that workspace's state.

**Why it happens:**
Developers check the 102,400-byte total quota (generous) without noticing the 8,192-byte _per-item_ limit. Storing all workspaces as one key violates per-item limits with realistic usage.

**How to avoid:**
- Store each workspace as a separate key (`workspace:{id}`) instead of one `workspaces` array. This distributes data across items.
- Keep a lightweight index key (`workspace:index`) with just IDs, names, colors, and createdAt — not tabs.
- Enforce a tab URL + title truncation (e.g., 200 bytes per tab) before storage to create a hard ceiling per workspace.
- Call `storage.sync.getBytesInUse()` on startup and log a warning if usage exceeds 70% of the 102,400-byte total.
- Keep `storage.local` as a confirmed-write fallback when `storage.sync.set()` rejects.

**Warning signs:**
- `storage.sync.set()` throws `QuotaExceededError` for any workspace.
- Workspace state is not restored after reinstall despite "sync" being active.
- Workspaces with more than 25 tabs silently stop persisting tab changes.

**Phase to address:** storage.sync migration phase. The data model must change before migrating — do not attempt a 1:1 storage area swap.

---

### Pitfall 3: `browser_specific_settings` with explicit gecko ID omitted — storage.sync silently fails to sync

**What goes wrong:**
`browser.storage.sync` in Firefox relies on the extension's Add-on ID to key sync data. If `browser_specific_settings.gecko.id` is not set in `manifest.json`, the extension has an auto-generated ephemeral ID. Data "syncs" locally into `storage-sync2.sqlite` but is never associated with a stable identity across devices or reinstalls — defeating the entire purpose of `storage.sync`.

**Why it happens:**
The extension currently has no `browser_specific_settings` key (common for extensions not yet published to AMO). Developers assume sync "just works" after switching from `.local` to `.sync`.

**How to avoid:**
- Add `browser_specific_settings.gecko.id` to `manifest.json` with a stable, unique identifier (e.g., `simple-workspaces@yourname.example`) before writing any production data to `storage.sync`.
- Set this before migration — data written without a stable ID cannot be retroactively attributed to that ID.

**Warning signs:**
- Workspace data does not appear on a second Firefox instance logged into the same account.
- After reinstall, workspaces are not restored despite sync being enabled.
- `browser.storage.sync.getBytesInUse()` returns 0 on a fresh profile despite data having been written.

**Phase to address:** storage.sync migration phase, as the very first step before any storage write logic changes.

---

### Pitfall 4: `tabs.query({ currentWindow: true })` uses the last-focused window, not the workspace's window

**What goes wrong:**
The current code uses `{ currentWindow: true }` throughout to identify which tabs belong to the active workspace. In a single-window world this works. With multi-window support, "current window" in a background script resolves to the last window the user focused — not necessarily the window whose workspace is being operated on. If the user briefly focuses a second window and then an auto-save debounce fires, the save captures tabs from the wrong window and overwrites the correct workspace's tab list.

**Why it happens:**
`currentWindow: true` is documented as the window that was last focused. In popup scripts it refers to the window containing the popup. In background scripts it refers to the last-focused window, which changes with every `windows.onFocusChanged` event. Without per-window workspace tracking, there is no way to know which window a save should target.

**How to avoid:**
- Add a `windowWorkspaces` map in `storage.session`: `{ [windowId]: workspaceId }`.
- All tab event listeners must capture the tab's `windowId` and resolve the correct workspace from the map.
- Replace all `tabs.query({ currentWindow: true })` calls with `tabs.query({ windowId: specificWindowId })` where `specificWindowId` is the window the operation targets.
- Listen to `windows.onCreated`, `windows.onRemoved`, and `windows.onFocusChanged` to maintain the map.

**Warning signs:**
- Tabs from Window B appear in Workspace A's saved state.
- Switching workspace in one window also changes the visible tabs in another window.
- After focusing a different window and waiting 400ms, the previously-focused window's workspace tab list is overwritten.

**Phase to address:** Multi-window tracking phase. This is the architectural core of that feature and must be solved before the auto-save is changed.

---

### Pitfall 5: No rollback when tab creation partially fails during workspace switch

**What goes wrong:**
`switchWorkspace()` saves the current workspace's tabs first, then creates new tabs, then removes old tabs. If tab creation fails for several tabs (e.g., browser tab limit, invalid URLs, browser resource exhaustion), the current code still removes old tabs with `browser.tabs.remove(oldTabIds)`. The saved workspace data for the original workspace is already written and the new tabs are partially created — the user ends up in an inconsistent state with no recovery path.

**Why it happens:**
The current approach optimistically proceeds and treats partial failures as acceptable. The try/catch wraps individual tab creation but not the full atomic operation. There is no rollback to the pre-switch state.

**How to avoid:**
- Capture a snapshot of the current workspace's tab list _before_ any mutation (already done partially, but must be committed to storage only after confirming success).
- Do not overwrite the current workspace's persisted tabs until new tabs are confirmed created.
- If fewer than all tabs are created, close any partially-created tabs and restore the original window state.
- Report failure to the popup via the `{ success: false, error }` return value and let the popup show a user-visible error.
- Consider implementing a staged commit: `pendingSwitch` stored in `storage.session`, committed to `storage.local/sync` only after tab creation completes.

**Warning signs:**
- After a failed switch, `browser.storage.local.get('workspaces')` shows the target workspace as active but the window has mixed tabs from both workspaces.
- Users report "workspace disappeared" after a switch that was interrupted.
- `console.error('[Workspaces] Tab create failed entirely')` appears but the extension continues switching anyway.

**Phase to address:** Race condition / data loss fix phase, before any other storage or multi-window changes. This is the most acute data loss risk in the current codebase.

---

### Pitfall 6: `windows.onFocusChanged` fires WINDOW_ID_NONE spuriously on Windows/Linux before every window switch

**What goes wrong:**
On Windows and many Linux window managers, `windows.onFocusChanged` always fires `WINDOW_ID_NONE` immediately before firing the new window's ID when the user switches between two browser windows. If the multi-window tracking code treats `WINDOW_ID_NONE` as "no window active" and triggers an auto-save at that moment, it saves against whatever window was previously tracked — which is the correct window, but with stale state captured at the wrong moment. More critically, if a debounced save is in progress and the `WINDOW_ID_NONE` event cancels or redirects the save, the workspace's tabs are written incorrectly.

**Why it happens:**
This is a platform-specific quirk documented in MDN but easy to miss. Developers test on macOS where the spurious `WINDOW_ID_NONE` does not occur, then the extension misbehaves on Windows.

**How to avoid:**
- Treat `WINDOW_ID_NONE` as transient. Never trigger a save or state change when the new window ID is `WINDOW_ID_NONE`.
- Buffer focus changes: wait for a non-`WINDOW_ID_NONE` window ID before updating `windowWorkspaces`.
- The focus-change handler should only update the "last focused window" pointer, not immediately trigger saves.

**Warning signs:**
- On Windows, workspaces get scrambled after rapid window switching.
- Auto-save fires twice in quick succession during a window focus change.
- The extension works correctly on macOS/Linux GNOME but fails on Windows.

**Phase to address:** Multi-window tracking phase, as part of implementing the `windows.onFocusChanged` listener.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store all workspaces as single `workspaces` array key in storage.sync | Minimal refactor from storage.local migration | Hits QUOTA_BYTES_PER_ITEM (8,192 bytes) with 20+ tabs; set() silently fails | Never — data model must change for storage.sync |
| Keep `isSwitching` as a module-scope variable after MV3 migration | No change required | Variable resets when background unloads, causing concurrent save/switch corruption | Never — must move to storage.session |
| Omit `browser_specific_settings.gecko.id` from manifest | Simplifies manifest | storage.sync data is anonymous and does not sync across devices or reinstalls | Never — must be set before any storage.sync use |
| Use `currentWindow: true` for all tab queries in multi-window code | Simple, matches current single-window code | Resolves to wrong window when user has multiple windows open | Never — replace with explicit windowId targeting |
| Replace `browserAction` with `action` only in API calls, not in manifest | Fewer changes | MV3 extension fails manifest validation — `browser_action` key is rejected in MV3 | Never — both manifest key and API must be updated together |
| Skip rollback logic on partial tab creation failure | Simpler switch implementation | User loses workspace tab list permanently on browser resource exhaustion | Never for primary path; acceptable to log and surface error only at extreme edge cases |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `browser.storage.sync` | Write all workspace data under one `workspaces` key | Write each workspace as `workspace:{id}` key; keep separate index key |
| `browser.storage.sync` | Assume sync is active without checking Firefox Sync is enabled and "Add-ons" sync is selected | Document that sync requires Firefox account + Add-ons sync enabled; fall back to storage.local silently when sync fails |
| `browser.alarms` | Use `setTimeout` for debounce in MV3 | Use `browser.alarms.create()` with a name; `alarms.onAlarm` fires even after background reload |
| `browser.action` (MV3) | Call `browser.browserAction.setBadgeText()` — silently undefined | Update both manifest key (`action`) and all API calls (`browser.action.setBadgeText`) together |
| `tabs.query` | Pass `{ currentWindow: true }` from background in multi-window context | Pass explicit `{ windowId: targetWindowId }` captured from the originating event |
| `windows.onFocusChanged` | Treat WINDOW_ID_NONE as a valid "no window" state and update tracking state | Ignore WINDOW_ID_NONE; only update tracking state on real window IDs |
| `storage.session` | Use as MV3 state store without checking Firefox version support | `browser.storage.session` is available in Firefox 102+; add version check or use storage.local with cleanup for earlier versions |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Storing full tab objects (with favIconUrl data URLs) in storage.sync | storage.sync quota consumed rapidly; favicons are often 2-5 KB base64 data URLs | Strip favIconUrl before storage.sync write, or store only the URL for later re-fetch | At 5+ workspaces with favicon-heavy tabs |
| Full workspace list DOM re-render on every popup open | Popup open feels sluggish at 15+ workspaces | Already noted in codebase concerns; use DOM diffing or DocumentFragment batching | At 20+ workspaces |
| `tabs.query` on every debounced save without windowId scoping | Background processes tabs from all windows when only one window changed | Always pass `windowId` filter to tabs.query in save handlers once multi-window is active | As soon as user opens a second window |
| Calling `storage.sync.getBytesInUse()` on every save | Unnecessary async overhead on every tab change | Call `getBytesInUse()` only on startup and on storage.sync write errors | At high tab event frequency (rapid URL loading) |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Using `innerHTML` for SVG icons in popup buttons (lines 64, 69 of popup.js) | XSS if any stored workspace data reaches template rendering; violates Mozilla content security policy | Replace with `document.createElementNS('http://www.w3.org/2000/svg', 'svg')` construction or use `textContent` where SVG is not needed |
| No sender validation in `onMessage` handler | Any content script or injected code could call `switchWorkspace` or `deleteWorkspace` | Check `sender.id === browser.runtime.id` before processing messages; whitelist valid action names |
| Setting CSS custom property `--ws-color` directly from stored `ws.color` without validation | CSS injection if color value is manipulated in storage | Validate `color` field against `/^#[0-9a-f]{6}$/i` before any CSS or storage use |
| Storing `activeWorkspaceId` and `workspaces` as unsanitized objects read from storage.sync | If sync data is tampered (unlikely but possible on shared devices), malformed data crashes background | Add a validation function called on all storage reads: check required fields (`id`, `name`, `color`, `tabs` array), reject and reset to default on failure |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent failure when workspace switch fails mid-operation | User sees mixed tab state with no explanation; appears as a browser glitch | Return `{ success: false, error }` from `switchWorkspace`; popup should display an error toast before closing |
| No indication that storage.sync is not syncing (e.g., user not logged in to Firefox account) | User expects cross-device sync, does not get it, loses trust | Show sync status in popup footer: "Synced" / "Sync unavailable — check Firefox account" |
| Popup shows workspace count without window context in multi-window mode | User opens popup in Window B and sees all workspaces including those assigned to Window A; switching is confusing | Show per-window workspace assignment; dim or separate workspaces owned by other windows |
| Badge text breaks on emoji workspace names (first char of emoji is garbage) | Badge shows empty or garbled character | Use `[...name][0]` (spread to grapheme array) or a grapheme cluster library for badge initial |
| Workspace switch leaves the window in the wrong state if tab creation fails and is silently ignored | User is left with a partially restored workspace with no way to trigger a retry | Show error state in badge (e.g., "!" badge color) and expose a "retry switch" action |

---

## "Looks Done But Isn't" Checklist

- [ ] **MV3 migration:** `browser_action` renamed to `action` in manifest AND all `browser.browserAction.*` API calls updated to `browser.action.*` — verify both; only changing the manifest or only the API is a common partial migration.
- [ ] **MV3 migration:** `"persistent": true` removed from background declaration — verify the background does not re-add persistence; non-persistence must be intentional.
- [ ] **storage.sync:** `browser_specific_settings.gecko.id` set in manifest — verify data actually syncs to a second device/profile before declaring migration complete.
- [ ] **storage.sync:** Per-item quota respected — verify workspaces with 30+ tabs do not trigger `QuotaExceededError` silently; test by creating a workspace with 40 tabs.
- [ ] **Multi-window:** `tabs.query({ currentWindow: true })` replaced everywhere with explicit `windowId` — search codebase for `currentWindow: true` after implementation and confirm zero remaining usages in background.js.
- [ ] **Multi-window:** `windows.onFocusChanged` handler ignores `WINDOW_ID_NONE` — unit test the handler with `WINDOW_ID_NONE` input and confirm no state mutation occurs.
- [ ] **Race condition fix:** Workspace tabs are not written to storage until new tab creation succeeds — verify by simulating a tab creation failure and checking storage state before and after.
- [ ] **Security:** No `innerHTML` usage in popup — run `grep -r innerHTML src/` and confirm zero results after fix.
- [ ] **storage.session availability:** Code using `browser.storage.session` is guarded for Firefox 102+ — verify the extension does not crash on older Firefox versions if that is a supported target.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Non-persistent state reset causes stuck `isSwitching` flag | LOW | On next user action, the flag is `false` (default), unblocking saves; the cost is a possibly corrupted workspace that the user will overwrite naturally |
| storage.sync quota exceeded — new writes blocked | MEDIUM | Implement a "storage cleanup" function: delete workspaces not accessed in 30+ days; strip favIconUrl from all tabs; rebuild index; manual recovery possible via about:debugging |
| Partial tab creation leaves mixed workspace state | HIGH | Without rollback: user must manually close stray tabs. With rollback: re-close any created tabs and restore from pre-switch snapshot. Implement the pre-switch snapshot before shipping multi-tab workspaces. |
| storage.sync data lost due to server-wins overwrite across devices | HIGH | No automatic recovery without explicit conflict detection; mitigate by surfacing `storage.onChanged` events and prompting user when a remote change overwrites local state |
| Extension ID not set before first storage.sync write | HIGH | All sync data written under ephemeral ID is orphaned. Recovery requires the user to recreate workspaces on each device. Set the ID in the first commit that touches storage.sync — it cannot be fixed retroactively. |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Non-persistent state reset (`isSwitching`, `saveTimeout`) | MV3 migration phase | After migration, trigger a workspace switch, wait 5+ seconds for background to unload, trigger another event, verify no state corruption |
| `browser_action` → `action` (manifest + API) | MV3 migration phase | Validate manifest with `web-ext lint`; confirm badge updates work after migration |
| `browser_specific_settings.gecko.id` missing | storage.sync migration phase (first step) | Verify sync works between two Firefox profiles using the same account |
| QUOTA_BYTES_PER_ITEM exceeded by large workspaces | storage.sync migration phase | Test with a workspace containing 40 tabs; confirm no QuotaExceededError; check `getBytesInUse()` |
| Server-wins overwrite on multi-device sync | storage.sync migration phase | Test with two devices: modify a workspace on each before sync; verify the expected winner wins and no silent data loss |
| `currentWindow: true` resolves to wrong window | Multi-window tracking phase | Open two windows with different workspaces; switch focus to Window B; wait for debounce; confirm Window A's workspace was not overwritten |
| WINDOW_ID_NONE spurious events on focus change | Multi-window tracking phase | Test on Windows; switch windows rapidly 10 times; confirm workspace assignments are stable |
| No rollback on partial tab creation failure | Race condition fix phase | Mock `browser.tabs.create` to fail on the 3rd tab; confirm storage state is unchanged and old tabs are not removed |
| `innerHTML` in popup SVG buttons | Security fixes phase | `web-ext lint` + grep; confirm no innerHTML usages post-fix |
| No message sender validation | Security fixes phase | Attempt to call `switchWorkspace` from a content script; confirm it is rejected |

---

## Sources

- [Manifest V3 migration guide — Firefox Extension Workshop](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/) — HIGH confidence
- [background — MDN (non-persistent event pages)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background) — HIGH confidence
- [Background scripts — MDN (MV3 state management patterns)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts) — HIGH confidence
- [storage.sync — MDN (quota limits, browser_specific_settings requirement)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync) — HIGH confidence
- [Changes to storage.sync in Firefox 79 — Mozilla Add-ons Blog](https://blog.mozilla.org/addons/2020/07/09/changes-to-storage-sync-in-firefox-79/) — HIGH confidence (quota enforcement, automatic migration)
- [windows.onFocusChanged — MDN (WINDOW_ID_NONE platform caveat)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/onFocusChanged) — HIGH confidence
- [tabs.query() — MDN (currentWindow behavior)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/query) — HIGH confidence
- [MV3 event page behavior clarification — Mozilla Discourse](https://discourse.mozilla.org/t/mv3-event-page-behavior-clarification/97738) — MEDIUM confidence (community discussion, aligns with official docs)
- [Bugzilla #1656947 — QuotaExceededError on storage.sync delete when quota exceeded](https://bugzilla.mozilla.org/show_bug.cgi?id=1656947) — MEDIUM confidence (specific bug report)
- [Bugzilla #1378647 — Support discarded property in tabs.create()](https://bugzilla.mozilla.org/show_bug.cgi?id=1378647) — MEDIUM confidence (feature implementation history)
- [Codebase concerns audit — .planning/codebase/CONCERNS.md](../.planning/codebase/CONCERNS.md) — HIGH confidence (direct code analysis of this codebase)

---

*Pitfalls research for: Firefox WebExtension workspace/tab management — MV3 migration, storage.sync, multi-window, tab atomicity*
*Researched: 2026-03-21*
