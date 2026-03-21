# Codebase Structure

**Analysis Date:** 2026-03-20

## Directory Layout

```
simple-workspaces/
├── src/                          # Extension source code
│   ├── background.js             # Background service (state + workspace logic)
│   ├── manifest.json             # Extension metadata and permissions
│   ├── popup/                    # Popup UI
│   │   ├── popup.html            # Popup markup
│   │   ├── popup.js              # Popup logic and rendering
│   │   └── popup.css             # Popup styles (dark theme)
│   └── icons/                    # Extension icons
│       ├── icon-48.svg           # 48px icon for toolbar
│       └── icon-96.svg           # 96px icon for extension page
├── .planning/                    # Planning documents (this directory)
├── web-ext-artifacts/            # Generated extension builds (ignored)
├── package.json                  # Node.js metadata and dev scripts
├── package-lock.json             # Dependency lock file
├── web-ext.config.mjs            # web-ext tool configuration
├── eslint.config.js              # ESLint configuration
└── .gitignore                    # Git ignore rules
```

## Directory Purposes

**`src/`:**
- Purpose: Complete, ready-to-run Firefox extension source
- Contains: Manifest, background script, popup UI, icons
- Key files: `background.js` (state management), `manifest.json` (entry point)

**`src/popup/`:**
- Purpose: User-facing UI when extension icon is clicked
- Contains: HTML markup, JavaScript logic, CSS styling
- Key files: `popup.html` (DOM), `popup.js` (interactivity), `popup.css` (dark Catppuccin-inspired theme)

**`src/icons/`:**
- Purpose: Visual assets displayed in toolbar and extension listing
- Contains: SVG icons in two sizes (48px and 96px)
- Key files: `icon-48.svg`, `icon-96.svg`

## Key File Locations

**Entry Points:**

- `src/manifest.json`: Extension manifest (v2 format) — defines background script, popup, permissions, icons
- `src/background.js`: Persistent background service — initializes on install, listens for tab/runtime events, manages state
- `src/popup/popup.html`: Popup UI entry — loaded when user clicks extension icon

**Configuration:**

- `package.json`: Node.js dev dependencies and npm scripts (build, lint, start)
- `web-ext.config.mjs`: web-ext tool settings (source directory, build output, run options)
- `eslint.config.js`: ESLint rules configuration

**Core Logic:**

- `src/background.js` (330 lines): All workspace operations
  - State initialization: `initDefaultWorkspace()`
  - Tab event handlers: `debouncedSave()`, `saveCurrentWorkspace()`
  - Workspace operations: `switchWorkspace()`, `createWorkspace()`, `deleteWorkspace()`, `updateWorkspace()`
  - Utilities: `serializeTabs()`, `genId()`, `updateBadge()`
  - Message router: `browser.runtime.onMessage.addListener()` (lines 289–308)

- `src/popup/popup.js` (208 lines): All UI logic
  - Render: `renderList()`, `renderColorPicker()`
  - Interactions: `onSwitch()`, `onAdd()`, `onDelete()`, `onModalSave()`
  - Modal management: `openEditModal()`, `openCreateModal()`, `closeModal()`
  - Initialization: DOM ready listener (line 11)

**Styling:**

- `src/popup/popup.css`: All popup styles (300px width, dark theme, modal, workspace list items)

## Naming Conventions

**Files:**

- Extension source files: lowercase with extension (`.js`, `.json`, `.html`, `.css`)
- Background service: `background.js` (Firefox convention)
- Popup files: `popup.*` (popup.html, popup.js, popup.css)
- Icons: `icon-{size}.svg` (standard naming)

**Directories:**

- Functional grouping: `popup/`, `icons/` (lowercase, plural for collections)
- Build output: `web-ext-artifacts/` (generated, not committed)

**Functions:**

- Camel case: `initDefaultWorkspace()`, `debouncedSave()`, `serializeTabs()`
- Action-based names: `onSwitch()`, `onAdd()`, `onDelete()`, `onModalSave()`
- Getters: `getState()`, `getColors()` (message actions)

**Variables:**

- Camel case for all variables: `isSwitching`, `saveTimeout`, `editingId`, `selectedColor`
- Constants (UPPERCASE): `COLORS`, `SAVE_DEBOUNCE_MS`

**Types/Objects:**

- Workspace shape: `{ id, name, color, tabs, createdAt }`
- Tab shape: `{ url, title, pinned, favIconUrl }`
- Message format: `{ action, ...payload }`

## Where to Add New Code

**New Feature (e.g., workspace notes, sync):**

- Primary code: `src/background.js`
  - Add operation function (e.g., `updateWorkspaceNotes()`)
  - Add message handler case in `browser.runtime.onMessage.addListener()` (line 289)
  - Add storage structure to workspace object if needed

- UI code: `src/popup/popup.js`
  - Add interaction handler (e.g., `onEditNotes()`)
  - Add modal or UI element in `src/popup/popup.html`
  - Add CSS in `src/popup/popup.css`

- Styling: `src/popup/popup.css` (only file for UI styles)

**New Component/Module (unlikely in extension context):**

- If splitting logic: Create new `.js` file in `src/` or `src/popup/`
- Register in manifest if it's a script that needs early loading
- Example structure: `src/utils/workspace-ops.js` for workspace operations

**Utilities:**

- Shared helpers: `src/background.js` (utility functions `serializeTabs()`, `genId()` already here)
- Popup-specific helpers: `src/popup/popup.js` (DOM helpers `renderList()`, `renderColorPicker()`)
- No separate utils file needed unless code grows significantly

## Special Directories

**`web-ext-artifacts/`:**
- Purpose: Output directory for built `.xpi` files
- Generated: Yes (by `npm run build`)
- Committed: No (ignored in `.gitignore`)

**`.planning/codebase/`:**
- Purpose: GSD analysis documents
- Generated: No (manually created)
- Committed: Yes (tracks architecture/structure decisions)

## Key Patterns to Maintain

**Message Passing:**
- All popup-to-background communication via `browser.runtime.sendMessage({ action: 'X', ...payload })`
- All handlers registered in single `onMessage.addListener()` with switch statement
- Return Promises for async operations

**Storage Format:**
- Always store as `{ workspaces: [...], activeWorkspaceId: '...' }`
- Fetch complete object before modifying, then replace entirely
- Never increment/update individual fields

**Tab Filtering:**
- Always serialize via `serializeTabs()` before storage
- Filters: skip non-`about:newtab` about pages, skip moz-extension URLs
- Prevents storage bloat and invalid state

**Debounced Saves:**
- Always use `debouncedSave()` for tab event handlers, not direct `saveCurrentWorkspace()`
- 400ms debounce threshold prevents thrashing during rapid tab changes

**Modal Management:**
- Use `openEditModal()` or `openCreateModal()` to set mode and data
- Always call `closeModal()` to clean up
- Use Enter key handler in input for save (line 21–23 in popup.js)

---

*Structure analysis: 2026-03-20*
