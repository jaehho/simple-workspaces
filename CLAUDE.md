<!-- GSD:project-start source:PROJECT.md -->
## Project

**Simple Workspaces**

A Firefox extension that lets users organize browser tabs into named, color-coded workspaces they can switch between. Currently functional but fragile — this milestone hardens the extension, adds multi-window awareness, migrates storage to sync with the user's Firefox account, and fixes known bugs including data loss risks.

**Core Value:** Workspaces reliably preserve and restore tab groups without losing data — even across windows, restarts, and reinstalls.

### Constraints

- **Platform**: Firefox WebExtension APIs only
- **Storage**: Must use `browser.storage.sync` as primary, `browser.storage.local` as fallback
- **Manifest**: Must be Manifest V3 compatible for AMO publishing
- **Security**: No innerHTML, validate all data from storage and messages
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- JavaScript (ES6+ modules) - Used for all extension logic and UI
- HTML5 - Used for popup interface (`src/popup/popup.html`)
- CSS3 - Used for popup styling (`src/popup/popup.css`)
- SVG - Embedded in HTML/JS for icons and UI elements
## Runtime
- Firefox Browser (WebExtensions API)
- Minimum version: Firefox 142.0 (specified in `src/manifest.json`)
- Also supports Firefox Android (mobile)
- npm
- Lockfile: `package-lock.json` (present)
## Frameworks
- WebExtensions API - Firefox extension framework (built-in, no npm package)
- web-ext ^8.0.0 - Official Mozilla Firefox extension build and run tool
- ESLint ^9.0.0 - JavaScript code quality
- eslint-plugin-no-unsanitized ^4.1.0 - Security plugin to prevent XSS
- globals ^15.0.0 - ESLint globals for browser and WebExtensions APIs
- addons-linter ^7.0.0 - Mozilla add-on manifest and code linter
## Key Dependencies
- web-ext ^8.0.0 - Enables development workflow (start, build, sign)
- ESLint ^9.0.0 - Enforces code quality and security patterns
- eslint-plugin-no-unsanitized ^4.1.0 - Prevents XSS vulnerabilities in WebExtensions
- globals ^15.0.0 - Provides ESLint awareness of browser/WebExtensions globals
- addons-linter ^7.0.0 - Validates against Mozilla add-on guidelines
## Configuration
- No .env file (extension is self-contained)
- All configuration is in extension manifest
- No secrets or environment variables required
- `web-ext.config.mjs` - web-ext configuration
- `eslint.config.js` - ESLint flat config (ESLint v9 format)
- `src/manifest.json` - Firefox WebExtension manifest (v2)
## Platform Requirements
- Node.js >= 18.0.0 (specified in `package.json` engines)
- Firefox Developer Edition recommended for debugging (or standard Firefox 142+)
- Deployment target: Mozilla Firefox Add-ons (AMO)
- Installation: Browser add-on (.xpi file)
- No backend server or cloud infrastructure required
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- Kebab-case with no extension variation: `background.js`, `popup.js`
- Directory names lowercase: `popup/`, `icons/`
- Configuration files: `manifest.json`, `package.json`, `eslint.config.js`
- camelCase: `initDefaultWorkspace()`, `serializeTabs()`, `updateBadge()`, `openEditModal()`
- Descriptive verb-noun patterns: `saveCurrentWorkspace()`, `switchWorkspace()`, `debouncedSave()`
- Handler functions prefixed with `on`: `onSwitch()`, `onAdd()`, `onDelete()`, `onModalSave()`
- Private helper functions at end of file, no underscore prefix
- camelCase for standard variables: `allColors`, `editingId`, `selectedColor`, `saveTimeout`
- SCREAMING_SNAKE_CASE for constants: `COLORS`, `SAVE_DEBOUNCE_MS`
- Prefix state flags with `is`: `isSwitching`, `isActive`, `isAbout`, `isWindowClosing`
- Underscore prefix for deliberately unused parameters: `_tabId`, `_sender`, `_changeInfo` (ESLint rule: `argsIgnorePattern: "^_"`)
- Object properties use camelCase: `favIconUrl`, `createdAt`, `activeWorkspaceId`
- Workspace objects follow consistent schema: `{ id, name, color, tabs, createdAt }`
- Tab data objects: `{ url, title, pinned, favIconUrl }`
## Code Style
- No automatic formatter configured (no Prettier)
- Manual enforcement through ESLint static analysis
- 2-space indentation (consistent throughout codebase)
- No semicolons enforced by linter rules
- ESLint 9.0.0 with flat config (`eslint.config.js`)
- Target: browser + WebExtensions globals (`globals.browser`, `globals.webextensions`)
- Security-focused: Mozilla's `no-unsanitized` plugin for XSS prevention
- Key enforced rules:
## Import Organization
- No explicit import/export system (vanilla WebExtension scripts)
- Global scope: all functions and variables accessible to other scripts via `browser.runtime`
- Script loading order defined in `manifest.json`: background script loads first, popup script loads on-demand
- Background script (`src/background.js`): manages state, persistence, tab operations
- Popup script (`src/popup/popup.js`): renders UI, handles user interactions
- Both scripts communicate via `browser.runtime.sendMessage()` with action-based routing
## Error Handling
- Try-catch blocks around async operations: `saveCurrentWorkspace()`, `switchWorkspace()`
- Error logging with context prefix: `console.error('[Workspaces] Save error:', e)`
- Warning logs for expected fallbacks: `console.warn('[Workspaces] Tab create fallback for:', t.url, err)`
- Graceful degradation in tab creation: nested try-catch for fallback without `discarded` flag
- Return error objects: `{ success: false, error: 'message' }`
- Error objects thrown when preconditions fail: `throw new Error('No workspaces found')`
- Early returns for invalid states: `if (!data.workspaces || !data.activeWorkspaceId) return`
- Consistent `[Workspaces]` prefix for all extension logs to identify source in browser console
- Different severity: `console.error()` for exceptions, `console.warn()` for recoverable issues
## Logging
- Direct `console.error()` and `console.warn()` usage
- Context-prefixed messages: `[Workspaces]` prefix for all logs
- Error object passed as second argument: `console.error('[Workspaces] Save error:', e)`
- Warn logs include original error: `console.warn('[Workspaces] Tab create fallback for:', t.url, err)`
- No structured logging (JSON) — strings only
## Comments
- Section headers with horizontal rules: `// ── Initialization ──────────────────────────────────────────`
- Inline explanations for non-obvious logic:
- No comments for obvious code like simple assignments or standard operations
- Not used (vanilla JavaScript, no TypeScript)
- Function signatures are self-documenting through clear naming
## Function Design
- Range: 10-50 lines typical
- Larger functions like `switchWorkspace()` (87 lines) reserved for complex multi-step operations
- Functions grouped by responsibility: initialization, event handling, persistence, UI rendering, actions, modal, helpers
- Positional for primary parameters: `switchWorkspace(targetId)`, `createWorkspace(name, color)`
- Message objects for command routing: `{ action, workspaceId, ...payload }`
- Underscore prefix for optional/unused parameters: `(_tabId, removeInfo)`
- Promises returned from async functions (implicitly): `async function saveCurrentWorkspace()`
- Objects for result codes: `{ success: true }` or `{ success: false, error: string }`
- Direct values for synchronous helpers: `genId()` returns string, `serializeTabs()` returns array
- `Promise.resolve(null)` for no-op message handlers
## Module Design
- No explicit exports (WebExtension messaging system)
- All operations exposed via `browser.runtime.onMessage` handler
- Message actions: `getState`, `switchWorkspace`, `createWorkspace`, `deleteWorkspace`, `updateWorkspace`, `getColors`, `forceSave`
- Not used (single script per component)
- Popup script and background script kept separate for independent functionality
- Constants (`COLORS`) shared through message handler return values
## Miscellaneous Patterns
- Browser storage API (`browser.storage.local`) as single source of truth
- Schema: `{ workspaces: Array, activeWorkspaceId: string }`
- Debounced saves via `setTimeout` with guard flag `isSwitching`
- Safe construction: creates elements via `document.createElement()`, text content via `.textContent` property
- Avoids `innerHTML` for dynamic content (ESLint rule enforced)
- Event delegation for list items: `.closest('.ws-actions')` for button detection
- Event propagation control: `e.stopPropagation()` to prevent unwanted switching
- Flag-based coordination: `isSwitching` prevents saves during workspace transitions
- Debounce pattern: `debouncedSave()` with `clearTimeout()` and `SAVE_DEBOUNCE_MS` constant
- Parallel tab creation: loop creates all tabs before closing old ones
- Filter unsafe URLs: skip internal `about:` pages except `about:newtab`, skip `moz-extension:` URLs
- Preserve essential fields: extract `url`, `title`, `pinned`, `favIconUrl` from tab API
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Decoupled background service (persistent state manager) and popup UI (stateless renderer)
- Message-based communication via `browser.runtime.onMessage` / `browser.runtime.sendMessage`
- Debounced auto-save on tab events with live-persistence to browser storage
- No external dependencies—pure Firefox WebExtensions API
## Layers
- Purpose: Manages workspace state, orchestrates tab operations, persists data
- Location: `src/background.js`
- Contains: Core business logic (workspace CRUD, tab serialization, save/switch operations)
- Depends on: Firefox `browser.tabs.*`, `browser.storage.local`, `browser.runtime.*` APIs
- Used by: Popup UI via message passing
- Purpose: Renders workspace list, handles user interactions, dispatches messages to background
- Location: `src/popup/popup.js` and `src/popup/popup.html`
- Contains: DOM rendering, event listeners, modal management
- Depends on: Background service via `browser.runtime.sendMessage()`
- Used by: User interaction (clicking workspaces, editing, creating)
- Purpose: Persists workspace definitions and active workspace ID
- Location: Implicit via `browser.storage.local`
- Contains: `workspaces` array, `activeWorkspaceId` string
- Data structure:
## Data Flow
- State stored in `browser.storage.local` (synchronous in-memory access)
- No global state objects—data fetched from storage on each operation
- `isSwitching` flag prevents save operations during workspace switch
- `saveTimeout` debounces rapid tab changes
## Key Abstractions
- Purpose: Represents a named, colored collection of tabs
- Examples: Created in `initDefaultWorkspace()`, `createWorkspace()`, retrieved from `browser.storage.local`
- Pattern: Plain object with properties `{ id, name, color, tabs[], createdAt }`
- Purpose: Filter and normalize browser tab objects for storage
- Examples: `serializeTabs()` in `src/background.js`
- Pattern: Maps browser tab to `{ url, title, pinned, favIconUrl }`, filters out internal/extension tabs
- Purpose: Single entry point for popup-to-background communication
- Examples: `browser.runtime.onMessage.addListener()` in `src/background.js` (lines 289–308)
- Pattern: Switch statement on `msg.action`, dispatches to handler function, returns Promise
- Purpose: Batch tab changes before persisting
- Examples: `debouncedSave()`, `saveTimeout` variable in `src/background.js`
- Pattern: Clears previous timeout, sets new 400ms timeout, prevents save during switch
## Entry Points
- Location: `src/background.js` (registered in manifest)
- Triggers: Extension startup, tab events, message from popup
- Responsibilities: Initialize state, listen for tab/runtime events, handle workspace operations, save data
- Location: `src/popup/popup.html` → `src/popup/popup.js`
- Triggers: User clicks extension icon
- Responsibilities: Query background state, render workspace list, handle user interactions (switch, create, edit, delete)
- Location: `src/manifest.json`
- Defines: Background script (persistent), popup HTML, permissions (tabs, storage, unlimitedStorage), browser action
## Error Handling
- **Tab creation failure:** Attempts with `discarded` flag first, falls back to normal creation if it fails (lines 163–177 in `src/background.js`)
- **Storage failures:** Returns early or error object if `browser.storage.local` operations fail
- **Missing workspace:** Error handling in `switchWorkspace()` and `deleteWorkspace()` (checks if workspace exists)
- **Delete last workspace:** Prevents deletion with `{ success: false, error: '...' }` response
## Cross-Cutting Concerns
- Null/empty checks before operations (e.g., `if (!data.workspaces)`)
- Filter invalid tabs (skip `about:` pages except `about:newtab`, skip extension tabs)
- Prevent empty state saves (skip if `tabData.length === 0`)
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
