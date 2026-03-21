# Coding Conventions

**Analysis Date:** 2026-03-20

## Naming Patterns

**Files:**
- Kebab-case with no extension variation: `background.js`, `popup.js`
- Directory names lowercase: `popup/`, `icons/`
- Configuration files: `manifest.json`, `package.json`, `eslint.config.js`

**Functions:**
- camelCase: `initDefaultWorkspace()`, `serializeTabs()`, `updateBadge()`, `openEditModal()`
- Descriptive verb-noun patterns: `saveCurrentWorkspace()`, `switchWorkspace()`, `debouncedSave()`
- Handler functions prefixed with `on`: `onSwitch()`, `onAdd()`, `onDelete()`, `onModalSave()`
- Private helper functions at end of file, no underscore prefix

**Variables:**
- camelCase for standard variables: `allColors`, `editingId`, `selectedColor`, `saveTimeout`
- SCREAMING_SNAKE_CASE for constants: `COLORS`, `SAVE_DEBOUNCE_MS`
- Prefix state flags with `is`: `isSwitching`, `isActive`, `isAbout`, `isWindowClosing`
- Underscore prefix for deliberately unused parameters: `_tabId`, `_sender`, `_changeInfo` (ESLint rule: `argsIgnorePattern: "^_"`)

**Types/Objects:**
- Object properties use camelCase: `favIconUrl`, `createdAt`, `activeWorkspaceId`
- Workspace objects follow consistent schema: `{ id, name, color, tabs, createdAt }`
- Tab data objects: `{ url, title, pinned, favIconUrl }`

## Code Style

**Formatting:**
- No automatic formatter configured (no Prettier)
- Manual enforcement through ESLint static analysis
- 2-space indentation (consistent throughout codebase)
- No semicolons enforced by linter rules

**Linting:**
- ESLint 9.0.0 with flat config (`eslint.config.js`)
- Target: browser + WebExtensions globals (`globals.browser`, `globals.webextensions`)
- Security-focused: Mozilla's `no-unsanitized` plugin for XSS prevention
- Key enforced rules:
  - `no-unsanitized/method`: error — prevents `innerHTML`, `outerHTML` with dynamic content
  - `no-unsanitized/property`: error — prevents unsafe DOM property assignment
  - `no-eval`: error — no dynamic code evaluation
  - `no-implied-eval`: error — no setTimeout with string functions
  - `no-new-func`: error — no Function constructor
  - `no-unused-vars`: warning with underscore exception pattern
  - `no-var`: warning (promote `const`/`let`)
  - `prefer-const`: warning
  - `eqeqeq`: warning with smart mode (allows `== null`)

## Import Organization

**Pattern:**
- No explicit import/export system (vanilla WebExtension scripts)
- Global scope: all functions and variables accessible to other scripts via `browser.runtime`
- Script loading order defined in `manifest.json`: background script loads first, popup script loads on-demand

**Scope Management:**
- Background script (`src/background.js`): manages state, persistence, tab operations
- Popup script (`src/popup/popup.js`): renders UI, handles user interactions
- Both scripts communicate via `browser.runtime.sendMessage()` with action-based routing

## Error Handling

**Patterns:**
- Try-catch blocks around async operations: `saveCurrentWorkspace()`, `switchWorkspace()`
- Error logging with context prefix: `console.error('[Workspaces] Save error:', e)`
- Warning logs for expected fallbacks: `console.warn('[Workspaces] Tab create fallback for:', t.url, err)`
- Graceful degradation in tab creation: nested try-catch for fallback without `discarded` flag
- Return error objects: `{ success: false, error: 'message' }`
- Error objects thrown when preconditions fail: `throw new Error('No workspaces found')`
- Early returns for invalid states: `if (!data.workspaces || !data.activeWorkspaceId) return`

**Logging Prefixes:**
- Consistent `[Workspaces]` prefix for all extension logs to identify source in browser console
- Different severity: `console.error()` for exceptions, `console.warn()` for recoverable issues

## Logging

**Framework:** `console` (native browser API)

**Patterns:**
- Direct `console.error()` and `console.warn()` usage
- Context-prefixed messages: `[Workspaces]` prefix for all logs
- Error object passed as second argument: `console.error('[Workspaces] Save error:', e)`
- Warn logs include original error: `console.warn('[Workspaces] Tab create fallback for:', t.url, err)`
- No structured logging (JSON) — strings only

## Comments

**When to Comment:**
- Section headers with horizontal rules: `// ── Initialization ──────────────────────────────────────────`
- Inline explanations for non-obvious logic:
  - Why a condition exists: `// Don't save if the entire window is closing`
  - Why a workaround is needed: `// about: URLs can't be set directly, omit url to get default new tab`
  - Why behavior differs: `// Discarded tabs save RAM — only for non-active, non-about tabs`
- No comments for obvious code like simple assignments or standard operations

**JSDoc/TSDoc:**
- Not used (vanilla JavaScript, no TypeScript)
- Function signatures are self-documenting through clear naming

## Function Design

**Size:**
- Range: 10-50 lines typical
- Larger functions like `switchWorkspace()` (87 lines) reserved for complex multi-step operations
- Functions grouped by responsibility: initialization, event handling, persistence, UI rendering, actions, modal, helpers

**Parameters:**
- Positional for primary parameters: `switchWorkspace(targetId)`, `createWorkspace(name, color)`
- Message objects for command routing: `{ action, workspaceId, ...payload }`
- Underscore prefix for optional/unused parameters: `(_tabId, removeInfo)`

**Return Values:**
- Promises returned from async functions (implicitly): `async function saveCurrentWorkspace()`
- Objects for result codes: `{ success: true }` or `{ success: false, error: string }`
- Direct values for synchronous helpers: `genId()` returns string, `serializeTabs()` returns array
- `Promise.resolve(null)` for no-op message handlers

## Module Design

**Exports:**
- No explicit exports (WebExtension messaging system)
- All operations exposed via `browser.runtime.onMessage` handler
- Message actions: `getState`, `switchWorkspace`, `createWorkspace`, `deleteWorkspace`, `updateWorkspace`, `getColors`, `forceSave`

**Barrel Files:**
- Not used (single script per component)
- Popup script and background script kept separate for independent functionality
- Constants (`COLORS`) shared through message handler return values

## Miscellaneous Patterns

**State Management:**
- Browser storage API (`browser.storage.local`) as single source of truth
- Schema: `{ workspaces: Array, activeWorkspaceId: string }`
- Debounced saves via `setTimeout` with guard flag `isSwitching`

**DOM Manipulation:**
- Safe construction: creates elements via `document.createElement()`, text content via `.textContent` property
- Avoids `innerHTML` for dynamic content (ESLint rule enforced)
- Event delegation for list items: `.closest('.ws-actions')` for button detection
- Event propagation control: `e.stopPropagation()` to prevent unwanted switching

**Async Coordination:**
- Flag-based coordination: `isSwitching` prevents saves during workspace transitions
- Debounce pattern: `debouncedSave()` with `clearTimeout()` and `SAVE_DEBOUNCE_MS` constant
- Parallel tab creation: loop creates all tabs before closing old ones

**Data Filtering:**
- Filter unsafe URLs: skip internal `about:` pages except `about:newtab`, skip `moz-extension:` URLs
- Preserve essential fields: extract `url`, `title`, `pinned`, `favIconUrl` from tab API

---

*Convention analysis: 2026-03-20*
