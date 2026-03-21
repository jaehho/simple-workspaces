# Architecture

**Analysis Date:** 2026-03-20

## Pattern Overview

**Overall:** Event-driven background worker with message-passing UI communication

**Key Characteristics:**
- Decoupled background service (persistent state manager) and popup UI (stateless renderer)
- Message-based communication via `browser.runtime.onMessage` / `browser.runtime.sendMessage`
- Debounced auto-save on tab events with live-persistence to browser storage
- No external dependencies—pure Firefox WebExtensions API

## Layers

**Background Service Layer:**
- Purpose: Manages workspace state, orchestrates tab operations, persists data
- Location: `src/background.js`
- Contains: Core business logic (workspace CRUD, tab serialization, save/switch operations)
- Depends on: Firefox `browser.tabs.*`, `browser.storage.local`, `browser.runtime.*` APIs
- Used by: Popup UI via message passing

**Popup UI Layer:**
- Purpose: Renders workspace list, handles user interactions, dispatches messages to background
- Location: `src/popup/popup.js` and `src/popup/popup.html`
- Contains: DOM rendering, event listeners, modal management
- Depends on: Background service via `browser.runtime.sendMessage()`
- Used by: User interaction (clicking workspaces, editing, creating)

**Storage Layer:**
- Purpose: Persists workspace definitions and active workspace ID
- Location: Implicit via `browser.storage.local`
- Contains: `workspaces` array, `activeWorkspaceId` string
- Data structure:
  ```
  {
    workspaces: [
      {
        id: string (generated timestamp + random),
        name: string,
        color: hex color,
        tabs: [{ url, title, pinned, favIconUrl }],
        createdAt: timestamp
      }
    ],
    activeWorkspaceId: string
  }
  ```

## Data Flow

**Workspace Switch Flow:**

1. User clicks workspace in popup → `onSwitch(workspaceId)` in `src/popup/popup.js`
2. Popup sends message: `{ action: 'switchWorkspace', workspaceId }`
3. Background receives message → `switchWorkspace(targetId)` in `src/background.js`
4. Background saves current workspace tabs to storage
5. Background creates new tabs from target workspace (first active, rest discarded for RAM)
6. Background closes old tabs
7. Background updates storage with new `activeWorkspaceId`
8. Background updates icon badge via `updateBadge()`
9. Popup closes automatically (Firefox behavior when tabs change)
10. User sees new workspace tabs

**Live-Save Flow:**

1. User manipulates tabs (create, remove, update URL, etc.)
2. Browser fires tab event listener (onCreated, onRemoved, onUpdated, etc.)
3. Event triggers `debouncedSave()` → clears timeout, sets new 400ms timeout
4. After 400ms of inactivity: `saveCurrentWorkspace()` serializes current tabs and persists to storage
5. Guards: skips save if `isSwitching` is true or if resulting tab list is empty

**Startup/Initialization Flow:**

1. Extension installed → `onInstalled` listener
2. Check storage for existing workspaces
3. If none exist: create default workspace with current browser tabs
4. On runtime startup: `onStartup` listener ensures state is initialized
5. Set icon badge to current workspace

**State Management:**

- State stored in `browser.storage.local` (synchronous in-memory access)
- No global state objects—data fetched from storage on each operation
- `isSwitching` flag prevents save operations during workspace switch
- `saveTimeout` debounces rapid tab changes

## Key Abstractions

**Workspace Object:**
- Purpose: Represents a named, colored collection of tabs
- Examples: Created in `initDefaultWorkspace()`, `createWorkspace()`, retrieved from `browser.storage.local`
- Pattern: Plain object with properties `{ id, name, color, tabs[], createdAt }`

**Tab Serialization:**
- Purpose: Filter and normalize browser tab objects for storage
- Examples: `serializeTabs()` in `src/background.js`
- Pattern: Maps browser tab to `{ url, title, pinned, favIconUrl }`, filters out internal/extension tabs

**Message Router:**
- Purpose: Single entry point for popup-to-background communication
- Examples: `browser.runtime.onMessage.addListener()` in `src/background.js` (lines 289–308)
- Pattern: Switch statement on `msg.action`, dispatches to handler function, returns Promise

**Debounced Save:**
- Purpose: Batch tab changes before persisting
- Examples: `debouncedSave()`, `saveTimeout` variable in `src/background.js`
- Pattern: Clears previous timeout, sets new 400ms timeout, prevents save during switch

## Entry Points

**Background Service:**
- Location: `src/background.js` (registered in manifest)
- Triggers: Extension startup, tab events, message from popup
- Responsibilities: Initialize state, listen for tab/runtime events, handle workspace operations, save data

**Popup UI:**
- Location: `src/popup/popup.html` → `src/popup/popup.js`
- Triggers: User clicks extension icon
- Responsibilities: Query background state, render workspace list, handle user interactions (switch, create, edit, delete)

**Manifest Entry:**
- Location: `src/manifest.json`
- Defines: Background script (persistent), popup HTML, permissions (tabs, storage, unlimitedStorage), browser action

## Error Handling

**Strategy:** Try/catch with console.error logging, graceful fallbacks

**Patterns:**

- **Tab creation failure:** Attempts with `discarded` flag first, falls back to normal creation if it fails (lines 163–177 in `src/background.js`)
- **Storage failures:** Returns early or error object if `browser.storage.local` operations fail
- **Missing workspace:** Error handling in `switchWorkspace()` and `deleteWorkspace()` (checks if workspace exists)
- **Delete last workspace:** Prevents deletion with `{ success: false, error: '...' }` response

## Cross-Cutting Concerns

**Logging:** Simple `console.error()` prefixed with `[Workspaces]` tag for debugging. Example: `console.error('[Workspaces] Save error:', e)` at line 109.

**Validation:**
- Null/empty checks before operations (e.g., `if (!data.workspaces)`)
- Filter invalid tabs (skip `about:` pages except `about:newtab`, skip extension tabs)
- Prevent empty state saves (skip if `tabData.length === 0`)

**Authentication:** Not applicable (local extension, no auth required)

**Permissions:** Minimal — only `tabs`, `storage`, `unlimitedStorage` (line 6–10 in manifest)

---

*Architecture analysis: 2026-03-20*
