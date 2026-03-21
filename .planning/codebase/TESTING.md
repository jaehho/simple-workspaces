# Testing Patterns

**Analysis Date:** 2026-03-20

## Test Framework

**Status:** Not detected

**Runner:**
- No test runner configured (Jest, Vitest, Mocha, etc. not in dependencies)

**Assertion Library:**
- None configured

**Run Commands:**
- No testing scripts in `package.json`
- Available linting commands:
  ```bash
  npm run lint              # Run web-ext lint
  npm run lint:eslint       # Run ESLint only
  npm run lint:all          # Run both linters
  ```

## Test File Organization

**Current State:**
- No `.test.js` or `.spec.js` files in `src/` directory
- No test directory structure

## Manual Testing Strategy

**Current Approach:**
- Live testing via `npm run start` (web-ext run with Firefox Developer Edition)
- Android testing via `npm run start:android` (web-ext run on Firefox Android)
- Static analysis via ESLint for code quality and security

## Code Quality Assurance

**Linting:**
- File: `eslint.config.js`
- Enforced for all `.js` files in `src/`
- Security focus: Mozilla's `no-unsanitized` plugin prevents XSS vulnerabilities
- Critical rules that catch bugs:
  - No `innerHTML`/`outerHTML` with dynamic content (XSS prevention)
  - No `eval()`, implied eval, or `Function()` constructor
  - Unused variables detection (with underscore exception for ignored params)

**Security Validation:**
- `npm run lint` runs `web-ext lint` (checks WebExtension manifest and best practices)
- ESLint security rules: `no-unsanitized` enforced at error level

## Code Coverage

**Requirements:** Not applicable (no test framework)

**Current State:**
- No coverage tracking configured
- Manual verification through:
  - Browser DevTools console monitoring
  - Firefox Developer Edition runtime inspection
  - Static code analysis via ESLint

## Integration Points for Testing

**Event-Driven Architecture:**
- `browser.tabs.onCreated`, `onRemoved`, `onUpdated`, `onMoved`, `onAttached`, `onDetached` listeners
- `browser.runtime.onInstalled`, `onStartup` lifecycle hooks
- `browser.runtime.onMessage` command routing

**Testable Units:**
- `serializeTabs(tabs)` — pure function, filters and maps tab data
- `genId()` — pure function, generates unique ID from timestamp + random
- `updateBadge(workspace)` — API wrapper, updates browser action badge
- Async operations: `saveCurrentWorkspace()`, `switchWorkspace()`, `createWorkspace()`, `deleteWorkspace()`, `updateWorkspace()`

**Storage Operations:**
- All use `browser.storage.local.get()` and `.set()` — asynchronous
- No persistent database beyond Firefox's local storage

## Manual Test Scenarios (Recommended)

**Workspace Switching:**
- Create multiple workspaces with different tab sets
- Switch between them and verify tabs are preserved
- Check that badge updates correctly
- Verify tabs are unloaded (discarded flag set) on switch

**Tab Event Handling:**
- Open/close/move tabs in active workspace
- Verify changes are saved (debounced) within 400ms
- Check that closing entire window doesn't overwrite workspace

**Edge Cases:**
- Create workspace with empty tab list → should open `about:newtab`
- Delete active workspace → should switch to first available
- Attempt delete last workspace → operation should fail gracefully
- Update workspace name/color while active → badge should update

**Error Recovery:**
- Monitor console for errors during:
  - Tab creation failures (fallback to non-discarded)
  - Storage read/write operations
  - Invalid workspace IDs

**UI Interactions:**
- Click to switch workspace
- Edit modal open/close
- Color picker selection
- Delete confirmation dialog
- Keyboard: Enter key saves modal

## Security Testing Recommendations

**XSS Prevention:**
- All DOM manipulation uses `.textContent` or `.createElement()`
- No `innerHTML` used for dynamic content (blocked by ESLint rule)
- SVG icons hardcoded in `popup.js` as safe strings

**Data Validation:**
- Workspace name trimmed and validated before save
- Tab URLs filtered (internal URLs excluded)
- Workspace ID checks prevent invalid references

**Storage Safety:**
- No sensitive data stored (all user-created content)
- Storage accessed only via `browser.storage.local`
- No credentials or secrets used

## Current Limitations

- **No unit tests:** Functions not isolated for automated testing
- **No integration tests:** Message passing and storage operations tested manually
- **No E2E tests:** UI interaction verified by manual browser testing
- **No regression detection:** Relies on manual verification between builds
- **No performance benchmarks:** Debounce timeout (400ms) set empirically, not measured

## Recommended Testing Setup

**For Future Implementation:**

1. **Unit Testing Framework:**
   - Consider Vitest (modern, ESM-compatible)
   - Alternatively Jest with ESM support configured

2. **Test Structure:**
   - `src/__tests__/` directory for unit tests
   - Test helpers module: `src/__tests__/helpers.js`
   - Mirror `src/` structure: `src/__tests__/background.test.js`, `src/__tests__/popup.test.js`

3. **Mock Setup:**
   - Mock `browser.storage.local` for state tests
   - Mock `browser.tabs` API for tab operation tests
   - Mock `browser.runtime` for message routing tests

4. **Coverage Targets:**
   - `serializeTabs()`: 100% (pure function)
   - `genId()`: 100% (pure function)
   - `switchWorkspace()`: core paths, error cases
   - `saveCurrentWorkspace()`: success and error paths
   - `renderList()`: DOM structure verification

---

*Testing analysis: 2026-03-20*
