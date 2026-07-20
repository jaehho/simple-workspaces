# CLAUDE.md

## Project

**Simple Workspaces** — a Firefox extension that organizes browser tabs into named, color-coded workspaces users can switch between. Currently functional but being hardened for multi-window awareness, sync storage migration, and data-loss bug fixes.

**Core value:** Workspaces reliably preserve and restore tab groups without losing data — across windows, restarts, and reinstalls.

**Constraints:**

- Platform: Firefox WebExtension APIs only
- Manifest V3 for AMO publishing
- Storage: `browser.storage.sync` as primary, `browser.storage.local` as fallback
- Security: No innerHTML, validate all data from storage and messages

## Architecture

Decoupled background service (persistent state manager) and popup UI (stateless renderer) communicating via `browser.runtime.sendMessage` with action-based routing.

- **Background** (`src/background.js`) — workspace state, tab operations, persistence via `browser.storage`
- **Popup UI** (`src/popup/popup.js` + `popup.html`) — renders workspace list, handles user interactions, dispatches messages to background
- **Storage schema** — see the `const` declarations at the top of `background.js` for the current shape
- **Save flow** — debounced saves on tab events; `isSwitching` flag guards against saves during workspace transitions

## Commands

Run `npm run` (no args) to list all scripts. See `package.json` for dependencies, `web-ext.config.mjs` for build config, and `eslint.config.js` for lint rules.
