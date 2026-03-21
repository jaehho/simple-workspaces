# Technology Stack

**Analysis Date:** 2026-03-20

## Languages

**Primary:**
- JavaScript (ES6+ modules) - Used for all extension logic and UI

**Secondary:**
- HTML5 - Used for popup interface (`src/popup/popup.html`)
- CSS3 - Used for popup styling (`src/popup/popup.css`)
- SVG - Embedded in HTML/JS for icons and UI elements

## Runtime

**Environment:**
- Firefox Browser (WebExtensions API)
- Minimum version: Firefox 142.0 (specified in `src/manifest.json`)
- Also supports Firefox Android (mobile)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- WebExtensions API - Firefox extension framework (built-in, no npm package)
  - No external framework dependency; uses native browser APIs

**Development & Build:**
- web-ext ^8.0.0 - Official Mozilla Firefox extension build and run tool
  - Used for development server, building .xpi packages, linting, and signing

**Linting:**
- ESLint ^9.0.0 - JavaScript code quality
  - Config: `eslint.config.js` (flat config format)
- eslint-plugin-no-unsanitized ^4.1.0 - Security plugin to prevent XSS
  - Enforces safe DOM handling in WebExtensions

**Utilities:**
- globals ^15.0.0 - ESLint globals for browser and WebExtensions APIs
  - Provides type definitions for `browser` object and WebExtensions globals

**Add-on Quality:**
- addons-linter ^7.0.0 - Mozilla add-on manifest and code linter
  - Validates extension manifest and code against Mozilla standards

## Key Dependencies

**Critical:**
- web-ext ^8.0.0 - Enables development workflow (start, build, sign)
- ESLint ^9.0.0 - Enforces code quality and security patterns

**Infrastructure:**
- eslint-plugin-no-unsanitized ^4.1.0 - Prevents XSS vulnerabilities in WebExtensions
- globals ^15.0.0 - Provides ESLint awareness of browser/WebExtensions globals
- addons-linter ^7.0.0 - Validates against Mozilla add-on guidelines

## Configuration

**Environment:**
- No .env file (extension is self-contained)
- All configuration is in extension manifest
- No secrets or environment variables required

**Build:**
- `web-ext.config.mjs` - web-ext configuration
  - Source directory: `src/`
  - Build artifacts directory: `web-ext-artifacts/`
  - Runs browser console during development
  - Opens debugging UI on `about:debugging#/runtime/this-firefox`

**Code Quality:**
- `eslint.config.js` - ESLint flat config (ESLint v9 format)
  - Target: `src/**/*.js` files
  - Language: ES6+ (latest ECMAVersion)
  - Globals: browser and WebExtensions APIs
  - Security rules: no innerHTML/outerHTML XSS, no eval, no Function constructor
  - Quality rules: no unused vars, no var keyword, prefer const, strict equality

**Extension Manifest:**
- `src/manifest.json` - Firefox WebExtension manifest (v2)
  - Declares permissions: tabs, storage, unlimitedStorage
  - Registers background script: `src/background.js`
  - Registers popup: `src/popup/popup.html`
  - Mozilla-specific settings: extension ID, min version, data collection policy

## Platform Requirements

**Development:**
- Node.js >= 18.0.0 (specified in `package.json` engines)
- Firefox Developer Edition recommended for debugging (or standard Firefox 142+)

**Production:**
- Deployment target: Mozilla Firefox Add-ons (AMO)
- Installation: Browser add-on (.xpi file)
- No backend server or cloud infrastructure required

---

*Stack analysis: 2026-03-20*
