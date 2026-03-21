# External Integrations

**Analysis Date:** 2026-03-20

## APIs & External Services

**None detected.**

The extension uses no external APIs, SDKs, or third-party services. It is entirely self-contained.

## Data Storage

**Databases:**
- Not applicable - extension uses browser storage only

**Browser Storage:**
- Type: Firefox browser.storage.local (encrypted local storage)
- Client: Native WebExtensions `browser.storage.local` API
- Purpose: Persists workspace metadata and tab state
- Implementation: `src/background.js`
  - `browser.storage.local.get(['workspaces', 'activeWorkspaceId'])` - Read state
  - `browser.storage.local.set({...})` - Write state
- Data structure:
  ```
  {
    workspaces: [
      {
        id: string,           // Generated ID
        name: string,         // User-defined workspace name
        color: hex string,    // Color code (e.g., "#3b82f6")
        tabs: [
          {
            url: string,
            title: string,
            pinned: boolean,
            favIconUrl: string
          }
        ],
        createdAt: timestamp
      }
    ],
    activeWorkspaceId: string // ID of currently active workspace
  }
  ```

**File Storage:**
- Not applicable - extension does not access file system

**Caching:**
- Not applicable - no caching layer

## Authentication & Identity

**Auth Provider:**
- Not applicable - extension is self-contained, no user accounts or authentication

## Monitoring & Observability

**Error Tracking:**
- Not detected - no external error reporting service

**Logs:**
- Browser console only via `console.error()` and `console.warn()`
- Used at:
  - `src/background.js` lines 109, 168, 175, 198 - error logging
  - `src/background.js` line 168 - warning for tab creation fallbacks

## CI/CD & Deployment

**Hosting:**
- Mozilla Firefox Add-ons (AMO) - official distribution channel
- No server infrastructure required

**CI Pipeline:**
- Not detected - no GitHub Actions, GitLab CI, or other CI service configured
- Manual build and sign process using `npm run build` and `npm run sign`

## Environment Configuration

**Required env vars:**
- None - extension is not environment-dependent

**Secrets location:**
- No secrets storage - extension contains no API keys, tokens, or credentials

## Webhooks & Callbacks

**Incoming:**
- None - extension does not expose webhooks

**Outgoing:**
- None - extension does not call external webhooks

## Browser APIs Used

**Core WebExtensions APIs:**
- `browser.runtime` - Extension lifecycle, messaging
  - `onInstalled` - Init on first install (line 24)
  - `onStartup` - Init on browser restart (line 30)
  - `onMessage` - Message routing (line 289)
  - `sendMessage` - IPC between background and popup (popup.js)

- `browser.tabs` - Tab management
  - `query()` - Get current tabs (background.js lines 39, 97, 126)
  - `create()` - Create new tabs (line 164)
  - `remove()` - Close tabs (line 183)
  - `onCreated` - Detect new tabs (line 60)
  - `onRemoved` - Detect closed tabs (line 62)
  - `onUpdated` - Detect URL/title changes (line 71)
  - `onMoved` - Detect tab reorder (line 78)
  - `onAttached` - Detect tab attach from other window (line 79)
  - `onDetached` - Detect tab detach to other window (line 80)

- `browser.browserAction` - Popup UI and badge
  - `setBadgeText()` - Set badge text (line 274)
  - `setBadgeBackgroundColor()` - Set badge color (line 275)

- `browser.storage` - Local storage (documented above)

**Manifest Permissions:**
- `tabs` - Required for tab manipulation and monitoring
- `storage` - Required for persistent workspace state
- `unlimitedStorage` - Allows larger storage quotas for workspaces

---

*Integration audit: 2026-03-20*
