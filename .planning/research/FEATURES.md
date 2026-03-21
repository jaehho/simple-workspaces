# Feature Research

**Domain:** Firefox WebExtension — tab/workspace management
**Researched:** 2026-03-21
**Confidence:** HIGH (core feature categories verified against competitor extensions, MDN docs, and OWASP)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Named, color-coded workspaces | Every competitor offers this; it is the product's identity | LOW | Already exists in codebase |
| Switch workspace (save current, restore target) | Without this the extension has no purpose | MEDIUM | Already exists but has race condition |
| Toolbar badge showing active workspace | Immediate visual feedback without opening popup | LOW | Already exists; has emoji truncation bug |
| Persist workspaces across restarts | Users expect saved state to survive a browser restart | LOW | Already works via storage.local |
| Auto-save tab changes to active workspace | Manual save is too error-prone; users expect it silently | MEDIUM | Already exists with 400ms debounce |
| Prevent deleting the last workspace | Users expect a safety net against an empty-state crash | LOW | Already exists |
| Popup list of all workspaces with active indicator | Core UI affordance for all competitors | LOW | Already exists |
| Error-free operation when storage is corrupt | Silent crashes destroy trust | MEDIUM | Not implemented — schema validation missing |
| Survive reinstall (not just restart) | Users expect data to persist like a bookmark does | MEDIUM | Requires storage.sync migration |
| Correct operation when multiple windows are open | Users open multiple windows; incorrect behavior looks like a bug | HIGH | Critical gap — global activeWorkspaceId causes silent corruption |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required by default expectations, but strongly valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Per-window workspace assignment | Each window tracks its own active workspace independently — enabling true parallel work contexts | HIGH | Core goal of this milestone; requires windowId tracking in storage and all switch logic |
| Firefox Sync integration (storage.sync) | Workspaces follow the user across devices via their Firefox account — zero setup required | MEDIUM | Quota is 100 KB total, 8 KB per item; needs getBytesInUse() monitoring + local fallback |
| Rollback on failed workspace switch | Data is never lost even if tab creation fails mid-switch | HIGH | Requires saving pre-switch snapshot and restoring on error; no competitor documents this |
| Storage corruption recovery | Detects bad data and auto-resets to a safe default rather than crashing | MEDIUM | Schema validation on every storage read; competing extensions crash silently |
| User-visible error notifications | When something goes wrong, tell the user — not just console.error | LOW | Status message in popup or browser.notifications; no current competitor does this well |
| Quota-aware sync with graceful fallback | Proactively checks storage.sync quota and silently falls back to storage.local before writes fail | MEDIUM | getBytesInUse() + threshold check before every set(); graceful degradation rather than hard failure |
| Cross-device sync via Firefox account | Workspaces appear on other Firefox installs automatically | MEDIUM | Depends on storage.sync migration; users with Firefox accounts get this for free |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create maintenance burden or undermine the extension's core value.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| tabs.hide/show instead of create/remove | "More elegant" — no tab reload on switch; preserves history | Requires `tabHide` permission (Firefox shows a browser-level warning to users on first use), pinned tabs cannot be hidden, currently active tab cannot be hidden — creates many edge cases that complicate the switch logic and erode trust | Keep the create/remove approach; fix the race condition instead |
| Real-time sync conflict resolution | Users editing workspaces on two devices simultaneously | storage.sync fires onChanged but last-write-wins; building merge logic is hard, fragile, and rarely needed for personal tab sets | Accept last-write-wins semantics; warn the user if onChanged fires unexpectedly while they are actively working |
| Drag-and-drop tab movement between workspaces | Polished UX, frequently requested | High implementation cost, no stable DnD API in WebExtensions popups; context-menu approach is simpler and already available via browser.contextMenus | Right-click context menu on a tab: "Move to workspace..." — simpler, lower risk |
| Import/export JSON backup | Recovery from catastrophic data loss | Adds UI complexity and a serialization contract to maintain; Firefox Sync already covers the reinstall case if storage.sync is implemented | Let storage.sync handle cross-device and cross-install persistence |
| Keyboard shortcuts | Power user demand | Every keyboard shortcut needs a distinct binding; collisions with user-defined shortcuts are common; adds an untested input path | Keep popup as primary UI; add a single optional command for "open workspace switcher" via manifest.json commands only if explicitly requested |
| Cloud sync beyond Firefox Sync | Users want Notion-like cloud backup | Requires auth, a backend, ongoing infrastructure cost, and data security responsibilities far beyond this extension's scope | storage.sync through Firefox account is sufficient for this class of tool |
| Tab grouping within workspaces | Sub-organization within a workspace | Flat workspaces are the product's differentiating simplicity; nesting creates UI debt and competes with Firefox's native tab groups feature | Recommend users use Firefox native Tab Groups for within-workspace organization |

---

## Feature Dependencies

```
[Per-window workspace assignment]
    └──requires──> [Per-window state in storage]
                       └──requires──> [windowId tracked on every switch/save]
                                          └──requires──> [windows.onFocusChanged listener]

[Rollback on failed workspace switch]
    └──requires──> [Pre-switch snapshot in memory or session storage]
                       └──requires──> [Atomic: snapshot → create tabs → verify → delete old tabs → commit]

[Firefox Sync integration]
    └──requires──> [Extension ID in manifest (browser_specific_settings.gecko.id)]
    └──requires──> [Quota monitoring via getBytesInUse()]
                       └──requires──> [Local fallback write path]

[Storage corruption recovery]
    └──requires──> [Schema validation function called on every storage read]

[Quota-aware sync fallback]
    ──enhances──> [Firefox Sync integration]
    ──requires──> [Storage corruption recovery] (both touch the storage read/write paths)

[Manifest V3 migration]
    └──requires──> [Service worker replaces persistent background page]
                       └──requires──> [No in-memory state — all state from storage on wakeup]
                       └──requires──> [Top-level event listener registration]
                       └──requires──> [Alarms API instead of setTimeout for long-running timers]

[User-visible error notifications]
    ──enhances──> [Rollback on failed workspace switch]
    ──enhances──> [Storage corruption recovery]
```

### Dependency Notes

- **Per-window workspace requires windowId tracking everywhere:** The single global `activeWorkspaceId` must become a map of `windowId → workspaceId`. Every save, switch, badge update, and popup render must pass the relevant windowId. This is a foundational change that touches most of the background script.

- **Rollback requires snapshot-before-switch:** Currently tabs are saved (overwriting the previous snapshot) before new tabs are created. The fix is to hold the snapshot in a temporary variable (or `storage.session`) and only commit it after new tabs are confirmed created. Only then delete old tabs.

- **MV3 migration requires storage-backed state:** The non-persistent background worker cannot retain in-memory variables between events. `isSwitching` and `saveTimeout` must become storage.session entries, or the logic must be restructured so they are not needed across event boundaries.

- **storage.sync requires a stable extension ID:** Without `browser_specific_settings.gecko.id` in manifest.json, Firefox cannot associate sync data with the extension consistently across installs.

---

## MVP Definition (This Milestone)

This is an existing extension being hardened, not a greenfield product. "MVP" here means: what must ship together to produce a publishable, trustworthy extension.

### Ship Together (Non-negotiable for AMO publishing)

- [ ] Manifest V3 migration — AMO will not accept MV2 extensions
- [ ] Fix innerHTML XSS in popup SVG buttons — blocks Mozilla review
- [ ] Add message sender validation — blocks Mozilla security review
- [ ] Add color value validation to prevent CSS injection

### Ship Together (Data integrity — users trust us with their data)

- [ ] Fix race condition in workspace switching (snapshot → create → verify → delete → commit)
- [ ] Fix data loss on failed switch (rollback to snapshot if creation fails)
- [ ] Add storage schema validation and corruption recovery

### Ship Together (Multi-window — correctness)

- [ ] Per-window activeWorkspaceId tracking (windowId map in storage)
- [ ] windows.onFocusChanged updates badge and popup context to focused window
- [ ] Popup shows workspace belonging to its window, not a global workspace

### Ship After Core Hardening (v1.x)

- [ ] storage.sync migration with getBytesInUse() quota monitoring and local fallback
- [ ] User-visible error notification when switch fails
- [ ] crypto.getRandomValues() for ID generation

### Future Consideration (v2+)

- [ ] Right-click context menu "Move tab to workspace..." — useful once per-window is solid
- [ ] Workspace search/quick-switch via address bar — useful only with 10+ workspaces

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Manifest V3 migration | HIGH (publishing gate) | HIGH | P1 |
| Fix innerHTML / message validation / color validation | HIGH (security gate) | LOW | P1 |
| Race condition + data loss fix | HIGH (trust) | MEDIUM | P1 |
| Storage schema validation | HIGH (crash prevention) | MEDIUM | P1 |
| Per-window workspace tracking | HIGH (correctness) | HIGH | P1 |
| storage.sync migration | HIGH (survive reinstall, cross-device) | MEDIUM | P1 |
| Quota monitoring + local fallback | MEDIUM (graceful degradation) | MEDIUM | P2 |
| User-visible error notifications | MEDIUM (UX polish) | LOW | P2 |
| crypto.getRandomValues() for IDs | LOW (theoretical edge case) | LOW | P2 |
| Right-click "Move to workspace" | MEDIUM (power users) | MEDIUM | P3 |
| Address bar workspace search | LOW (niche) | HIGH | P3 |

---

## Competitor Feature Analysis

| Feature | Tab Workspaces (AMO) | Workspaces for Firefox (AMO) | Simple Workspaces (this project) |
|---------|----------------------|-------------------------------|----------------------------------|
| Named workspaces | Yes | Yes | Yes |
| Color coding | Not mentioned | Not mentioned | Yes (differentiator) |
| Per-window workspace isolation | Yes — "each window has its own set" | Not mentioned | Gap to fix |
| Tab hide/show approach | Yes | Not confirmed | No — create/remove |
| Keyboard shortcuts | Yes (Ctrl+E, 1-9) | Yes (Alt+Space) | No (out of scope) |
| Address bar search | Yes ("ws [text]") | Yes (cross-workspace) | No |
| Firefox Sync integration | Not mentioned | Not mentioned | Planned (differentiator) |
| Rollback on failed switch | Not documented by any | Not documented by any | Planned (differentiator) |
| storage.sync with quota fallback | Not documented by any | Not documented by any | Planned (differentiator) |
| Open source | Yes (GitHub) | Yes (GitHub) | Yes |

---

## Sources

- [Tab Workspaces — Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/tab-workspaces/)
- [Workspaces for Firefox — Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/workspaces-for-firefox/)
- [Workspaces (firefox-workspaces) — Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/firefox-workspaces/)
- [browser.storage.sync — MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync)
- [StorageArea.getBytesInUse() — MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/StorageArea/getBytesInUse)
- [tabs.hide() — MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/hide)
- [windows.onFocusChanged — MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/onFocusChanged)
- [Manifest V3 migration guide — Firefox Extension Workshop](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/)
- [Browser Extension Vulnerabilities Cheat Sheet — OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html)
- [fm-sys/firefox-workspaces — GitHub](https://github.com/fm-sys/firefox-workspaces)
- [hongde88/firefox-workspace-manager — GitHub](https://github.com/hongde88/firefox-workspace-manager)

---

*Feature research for: Firefox WebExtension tab/workspace management*
*Researched: 2026-03-21*
