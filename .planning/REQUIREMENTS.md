# Requirements: Simple Workspaces

**Defined:** 2026-03-21
**Core Value:** Workspaces reliably preserve and restore tab groups without losing data — even across windows, restarts, and reinstalls.

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Security & Manifest

- [x] **SEC-01**: Extension uses Manifest V3 (`manifest_version: 3`, `browser.action`, non-persistent background)
- [x] **SEC-02**: Popup uses DOM APIs for SVG icons instead of innerHTML
- [x] **SEC-03**: Background script validates message sender origin before processing
- [x] **SEC-04**: Workspace color values validated against hex format before CSS injection
- [x] **SEC-05**: Extension ID set in `browser_specific_settings.gecko.id` for stable sync identity

### Data Integrity

- [x] **DATA-01**: Workspace switch is atomic — all new tabs created successfully before any old tabs removed
- [x] **DATA-02**: Failed switch rolls back: pre-switch snapshot restored, no data loss
- [x] **DATA-03**: Storage reads validated against schema; corrupted data triggers recovery to safe default
- [x] **DATA-04**: ID generation uses `crypto.randomUUID()` instead of `Date.now()` + `Math.random()`
- [x] **DATA-05**: In-memory state (`isSwitching`, debounce timers) moved to `storage.session` for MV3 non-persistent background compatibility

### Multi-Window

- [x] **WIN-01**: Each window tracks its own active workspace independently via `windowId → workspaceId` mapping
- [x] **WIN-02**: Popup shows which workspaces are active in other windows
- [x] **WIN-03**: User can switch to the window that owns a workspace (or close it) from the popup
- [x] **WIN-04**: Tab queries use explicit `windowId` from event context instead of `currentWindow: true`
- [x] **WIN-05**: `windows.onFocusChanged` handler filters out `WINDOW_ID_NONE` events
- [x] **WIN-06**: Per-window badge text shows each window's active workspace initial

### Storage Sync

- [ ] **SYNC-01**: Primary storage is `browser.storage.sync` tied to Firefox account
- [ ] **SYNC-02**: Workspace data split into per-workspace keys (`ws:{id}`) to respect 8KB per-item limit
- [ ] **SYNC-03**: Proactive quota monitoring via `getBytesInUse()` before writes
- [ ] **SYNC-04**: Graceful fallback to `browser.storage.local` when sync quota exceeded
- [ ] **SYNC-05**: Migration path from existing `storage.local` data to new sync schema on first run

## v2 Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### UX Polish

- **UX-01**: User-visible error notifications (popup status or browser.notifications) instead of console-only errors
- **UX-02**: Keyboard shortcut to open workspace switcher via manifest.json commands
- **UX-03**: Context menu on tabs: "Move to workspace..." for cross-workspace tab movement

### Performance

- **PERF-01**: Incremental DOM updates in popup instead of full rerender on every state change
- **PERF-02**: Dynamic popup height for large workspace counts (50+)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| tabs.hide/show instead of create/remove | Requires `tabHide` permission with browser-level warning; many edge cases with pinned/active tabs |
| Real-time sync conflict resolution | Last-write-wins is acceptable for personal tab sets; merge logic is fragile |
| Drag-and-drop tab reordering | No stable DnD API in WebExtension popups; high cost, low value |
| Import/export JSON backup | storage.sync covers the reinstall/cross-device case |
| Cloud sync beyond Firefox Sync | Requires backend infrastructure far beyond extension scope |
| Tab grouping within workspaces | Flat workspaces are the product's simplicity; Firefox has native tab groups |
| Cross-browser support | Firefox-only for this milestone |
| Automated test suite | Valuable but not in scope for this hardening milestone |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 1 | Complete |
| SEC-02 | Phase 1 | Complete |
| SEC-03 | Phase 1 | Complete |
| SEC-04 | Phase 1 | Complete |
| SEC-05 | Phase 1 | Complete |
| DATA-01 | Phase 2 | Complete |
| DATA-02 | Phase 2 | Complete |
| DATA-03 | Phase 2 | Complete |
| DATA-04 | Phase 2 | Complete |
| DATA-05 | Phase 1 | Complete |
| WIN-01 | Phase 3 | Complete |
| WIN-02 | Phase 3 | Complete |
| WIN-03 | Phase 3 | Complete |
| WIN-04 | Phase 3 | Complete |
| WIN-05 | Phase 3 | Complete |
| WIN-06 | Phase 3 | Complete |
| SYNC-01 | Phase 4 | Pending |
| SYNC-02 | Phase 4 | Pending |
| SYNC-03 | Phase 4 | Pending |
| SYNC-04 | Phase 4 | Pending |
| SYNC-05 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0

---
*Requirements defined: 2026-03-21*
*Last updated: 2026-03-21 after roadmap creation*
