# Phase 5: Module Integrity - Research

**Researched:** 2026-03-23
**Domain:** JavaScript ES module dependency graph + WebExtension storage validation
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEBT-01 | Storage validation is applied on the `readFromLocal()` fallback path, preventing corrupted data from reaching callers | `validateWorkspaceData()` already exists in `workspaces.js` but is never called on the local path — moving it to `sync.js` closes the gap without adding cross-module imports |
| DEBT-02 | Circular dependency between `state.js` and `workspaces.js` is eliminated without behavior change | `throttledSave()` in `state.js` is the sole cause — it imports `saveCurrentWorkspace` from `workspaces.js`; moving `throttledSave` to `workspaces.js` breaks the cycle cleanly |

</phase_requirements>

## Summary

Phase 5 addresses two distinct structural defects in the background module graph. Neither defect causes visible breakage today, but both create risk surface that makes future work on Phase 6 and Phase 7 unsafe: the circular dependency can cause initialization-order bugs when new imports are added, and the validation gap allows corrupted local storage data to reach callers silently.

The circular dependency is confined to a single import statement in `state.js` line 5: `import { saveCurrentWorkspace } from './workspaces.js'`. This import exists only to support `throttledSave()`, a function that conceptually belongs in `workspaces.js` (it coordinates workspace persistence) rather than in `state.js` (which manages session state flags). Moving `throttledSave()` from `state.js` to `workspaces.js` eliminates the cycle entirely.

The validation gap is equally localized. `readFromLocal()` in `sync.js` lines 218-221 returns raw storage data with only an `Array.isArray` check. The full structural validator `validateWorkspaceData()` exists in `workspaces.js` but is never applied to the local fallback path. The correct fix is to move `validateWorkspaceData()` and its companion `DEFAULT_WORKSPACE_DATA` factory to `sync.js` — the module that owns all storage read/write contracts — and apply it inside `readFromLocal()`. `workspaces.js` re-exports both symbols for callers that already use them.

**Primary recommendation:** Move `throttledSave` to `workspaces.js` (breaks the cycle); move `validateWorkspaceData` to `sync.js` and apply it in `readFromLocal()` (closes the validation gap). Both changes together require edits to exactly three files: `state.js`, `workspaces.js`, `sync.js`.

## Standard Stack

No new libraries are required for this phase. The work is pure refactor using the existing stack.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Firefox WebExtensions API | built-in | `browser.storage.session`, `browser.storage.local`, `browser.storage.sync` | Project-constrained; no alternative |
| ES6 Modules (`import`/`export`) | native | Static dependency graph | Already in use across all background files |

### Supporting
None — this phase involves no new dependencies.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Moving `throttledSave` to `workspaces.js` | Moving it to `index.js` | `index.js` is an entry point, not a logic module. Putting business-logic functions there makes it harder to test and review. `workspaces.js` is the correct semantic home. |
| Moving `validateWorkspaceData` to `sync.js` | Inline duplicate validation in `readFromLocal()` | Duplication violates DRY; two validators would diverge over time. Moving to `sync.js` keeps one canonical source of truth. |
| Moving `validateWorkspaceData` to `sync.js` | Calling it from a wrapper in `workspaces.js` after every `getWorkspaces()` call | Fragile — callers could bypass the wrapper; every new caller must remember to wrap. Applying it inside `sync.js` makes it impossible to skip. |

## Architecture Patterns

### Current Module Graph (with cycle)

```
index.js → state.js, workspaces.js, messaging.js, sync.js
state.js → workspaces.js          ← CYCLE: state.js needs saveCurrentWorkspace
workspaces.js → state.js, sync.js
messaging.js → workspaces.js, state.js, sync.js
sync.js → (no project imports)
```

### Target Module Graph (acyclic)

```
index.js → state.js, workspaces.js, messaging.js, sync.js
state.js → (no project imports)   ← cycle eliminated
workspaces.js → state.js, sync.js
messaging.js → workspaces.js, state.js, sync.js
sync.js → (no project imports)    ← validateWorkspaceData lives here
```

### Pattern 1: Move `throttledSave` to `workspaces.js`

**What:** Remove `import { saveCurrentWorkspace } from './workspaces.js'` from `state.js`. Move the entire `throttledSave` function body into `workspaces.js`. Export it from `workspaces.js`. Update `index.js` import to pull `throttledSave` from `workspaces.js` instead of `state.js`.

**When to use:** Any time a function in module A needs functions from module B but module B already imports from module A — move the function to module B.

**Example (before — `state.js`):**
```javascript
// BEFORE: state.js imports from workspaces.js, creating cycle
import { saveCurrentWorkspace } from './workspaces.js'

export async function throttledSave(windowId) {
  if (windowId === undefined) return
  const windowMap = await getWindowMap()
  if (!windowMap[String(windowId)]) return
  const state = await getSessionState()
  if (state.isSwitching) return
  const now = Date.now()
  if (now - state.lastSaveTime < THROTTLE_MS) return
  await setSessionState({ lastSaveTime: now })
  await saveCurrentWorkspace(windowId)
}
```

**Example (after — `workspaces.js`):**
```javascript
// AFTER: throttledSave lives in workspaces.js alongside saveCurrentWorkspace
// state.js no longer imports from workspaces.js
export async function throttledSave(windowId) {
  if (windowId === undefined) return
  const windowMap = await getWindowMap()
  if (!windowMap[String(windowId)]) return
  const state = await getSessionState()
  if (state.isSwitching) return
  const now = Date.now()
  if (now - state.lastSaveTime < THROTTLE_MS) return
  await setSessionState({ lastSaveTime: now })
  await saveCurrentWorkspace(windowId)
}
```

**`state.js` after:** Remove line 5 (`import { saveCurrentWorkspace } from './workspaces.js'`) and the `THROTTLE_MS` constant if it is only used by `throttledSave`. Verify `THROTTLE_MS` is not used elsewhere in `state.js` before removing.

**`index.js` after:** Change `import { throttledSave, removeWindowEntry, getWindowMap } from './state.js'` to `import { throttledSave } from './workspaces.js'` and keep the rest of the `state.js` import for `removeWindowEntry` and `getWindowMap`.

### Pattern 2: Move `validateWorkspaceData` to `sync.js` and apply in `readFromLocal()`

**What:** Move `validateWorkspaceData()` and `DEFAULT_WORKSPACE_DATA` from `workspaces.js` to `sync.js`. Apply `validateWorkspaceData()` inside `readFromLocal()` before returning. Re-export both from `workspaces.js` for backward compatibility (any callers importing from there continue to work).

**When to use:** Validation that guards a storage read contract belongs in the storage module, not in the business-logic module that consumes the data.

**Example (before — `sync.js` `readFromLocal`):**
```javascript
// BEFORE: only checks Array.isArray — structural corruption passes through
async function readFromLocal() {
  const result = await browser.storage.local.get('workspaces')
  return Array.isArray(result.workspaces) ? result.workspaces : []
}
```

**Example (after — `sync.js` `readFromLocal`):**
```javascript
// AFTER: validateWorkspaceData rejects corrupted or partial data
async function readFromLocal() {
  const result = await browser.storage.local.get({ workspaces: null, activeWorkspaceId: null })
  const raw = { workspaces: result.workspaces, activeWorkspaceId: result.activeWorkspaceId }
  return validateWorkspaceData(raw).workspaces
}
```

**Note on return type:** `getWorkspaces()` currently returns a plain `workspaces` array. `validateWorkspaceData()` returns `{ workspaces, activeWorkspaceId }`. The `readFromLocal()` function must return only `.workspaces` to maintain the existing API contract. Callers of `getWorkspaces()` expect an array, not an object.

**Alternative approach** — if `activeWorkspaceId` is not stored in `browser.storage.local` (only in sync storage), then `readFromLocal()` should pass a minimal object to `validateWorkspaceData`. Check the actual local storage schema before writing code: the fallback path stores `{ workspaces, syncFailed }` via `activateFallback()` — it does NOT store `activeWorkspaceId` separately. This means `validateWorkspaceData` receives `{ workspaces: [...], activeWorkspaceId: null }` which is valid — it will fall back to `validWorkspaces[0].id` for `activeWorkspaceId`. The `.workspaces` slice of the validated result is what gets returned.

### Anti-Patterns to Avoid

- **Inlining a second validator in `sync.js`:** Duplicate logic that diverges from the canonical `validateWorkspaceData` over time. One source of truth.
- **Calling `validateWorkspaceData` only at the `workspaces.js` call site:** Any new module that calls `getWorkspaces()` directly bypasses validation. Validation must be inside `sync.js`.
- **Moving `throttledSave` to `index.js`:** Entry points should not contain business logic. `index.js` registers listeners and delegates — it should not coordinate save timing.
- **Passing `saveCurrentWorkspace` as a callback parameter to `throttledSave` in `state.js`:** Solves the import cycle but creates implicit coupling and makes the function harder to test.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detecting circular imports | Custom dependency scanner | The module graph is small and fully visible — a manual audit is sufficient | Only 5 modules; a tool would be over-engineering |
| Schema migration for `activeWorkspaceId` in local storage | New migration function | No migration needed — `readFromLocal()` never stored or returned `activeWorkspaceId`, and callers don't expect it from local fallback | Adding migration scope risks data loss |

**Key insight:** Both problems are surgical — two function moves and one validation call insertion. No new abstractions, no new libraries, no schema changes.

## Common Pitfalls

### Pitfall 1: Breaking the `getWorkspaces()` return type
**What goes wrong:** `validateWorkspaceData()` returns `{ workspaces, activeWorkspaceId }`. If `readFromLocal()` returns this object instead of just the `.workspaces` array, every caller of `getWorkspaces()` breaks silently (they'd iterate the object, getting `undefined` for workspace operations).
**Why it happens:** Caller forgets to extract `.workspaces` from the validated result.
**How to avoid:** `readFromLocal()` must return `validateWorkspaceData(raw).workspaces` — the `.workspaces` slice only.
**Warning signs:** `workspaces.length` returns `undefined` instead of a number; `workspaces.find(...)` throws "not a function".

### Pitfall 2: Forgetting `THROTTLE_MS` constant
**What goes wrong:** `THROTTLE_MS` is defined in `state.js` and used only by `throttledSave`. If `throttledSave` is moved to `workspaces.js` without moving `THROTTLE_MS`, the build fails with a reference error.
**Why it happens:** Constants defined at the top of `state.js` are easy to overlook when extracting a function.
**How to avoid:** Move `THROTTLE_MS` to `workspaces.js` alongside `throttledSave`. Remove it from `state.js`.
**Warning signs:** `ReferenceError: THROTTLE_MS is not defined` at runtime.

### Pitfall 3: `index.js` import for `throttledSave` still pointing at `state.js`
**What goes wrong:** After moving `throttledSave` to `workspaces.js`, `index.js` still imports it from `state.js`. The import silently returns `undefined` (dead export), and all tab events stop triggering saves.
**Why it happens:** Two separate import lines need updating; it is easy to update one and miss the other.
**How to avoid:** After the move, verify `state.js` no longer exports `throttledSave`, and `index.js` imports it from `workspaces.js`.
**Warning signs:** Tabs stop being saved on switch; no console errors (the tab event listeners fire but `throttledSave(undefined)` returns early).

### Pitfall 4: Circular dependency not actually removed
**What goes wrong:** After editing `state.js`, the developer adds a different import from `workspaces.js` to `state.js` in the same commit (e.g., to share a constant), recreating the cycle.
**Why it happens:** The cycle fix is in the same changeset as other edits.
**How to avoid:** After the change, verify `state.js` has zero imports from `./workspaces.js`. The module graph target is: `state.js` has no project-module imports at all.
**Warning signs:** ESLint or browser console shows a module-loading error on extension startup.

### Pitfall 5: `validateWorkspaceData` re-export from `workspaces.js` is missed
**What goes wrong:** `validateWorkspaceData` is used by callers that import it from `workspaces.js`. If the function is moved to `sync.js` without a re-export, those callers break.
**Why it happens:** Audit of callers is skipped.
**How to avoid:** Check all current import sites of `validateWorkspaceData`. Currently it is only defined in `workspaces.js` and used locally — no external callers exist (confirmed by grep). However, defensive re-export from `workspaces.js` is still good practice for future callers.
**Warning signs:** Import errors at extension startup pointing to `workspaces.js`.

## Code Examples

Verified from direct source file inspection:

### Current `throttledSave` in `state.js` (the function to move)
```javascript
// Source: src/background/state.js lines 43-58
// THROTTLE_MS constant (line 10) must move with it
const THROTTLE_MS = 500

export async function throttledSave(windowId) {
  if (windowId === undefined) return
  const windowMap = await getWindowMap()
  if (!windowMap[String(windowId)]) return
  const state = await getSessionState()
  if (state.isSwitching) return
  const now = Date.now()
  if (now - state.lastSaveTime < THROTTLE_MS) return
  await setSessionState({ lastSaveTime: now })
  await saveCurrentWorkspace(windowId)
}
```

### Current `readFromLocal` in `sync.js` (the function to fix)
```javascript
// Source: src/background/sync.js lines 218-221
async function readFromLocal() {
  const result = await browser.storage.local.get('workspaces')
  return Array.isArray(result.workspaces) ? result.workspaces : []
}
```

### Current `validateWorkspaceData` in `workspaces.js` (the function to move to `sync.js`)
```javascript
// Source: src/background/workspaces.js lines 32-53
export const DEFAULT_WORKSPACE_DATA = () => ({
  workspaces: [],
  activeWorkspaceId: null,
})

export function validateWorkspaceData(data) {
  if (!data || typeof data !== 'object') return DEFAULT_WORKSPACE_DATA()
  if (!Array.isArray(data.workspaces)) return DEFAULT_WORKSPACE_DATA()
  if (data.workspaces.length === 0) return DEFAULT_WORKSPACE_DATA()

  const validWorkspaces = data.workspaces.filter(ws =>
    ws !== null &&
    typeof ws === 'object' &&
    typeof ws.id === 'string' && ws.id.length > 0 &&
    typeof ws.name === 'string' &&
    typeof ws.color === 'string' &&
    Array.isArray(ws.tabs)
  )

  if (validWorkspaces.length === 0) return DEFAULT_WORKSPACE_DATA()

  const activeValid = validWorkspaces.some(ws => ws.id === data.activeWorkspaceId)
  return {
    workspaces: validWorkspaces,
    activeWorkspaceId: activeValid ? data.activeWorkspaceId : validWorkspaces[0].id,
  }
}
```

### Current `index.js` import for `throttledSave` (line to update)
```javascript
// Source: src/background/index.js line 5
import { throttledSave, removeWindowEntry, getWindowMap } from './state.js'
```

### Local storage schema used by `activateFallback` (context for validation)
```javascript
// Source: src/background/sync.js line 210
async function activateFallback(workspaces) {
  await browser.storage.local.set({ [SYNC_FAILED_KEY]: true, workspaces })
}
// Note: activeWorkspaceId is NOT stored in local fallback — only workspaces array
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Monolithic `background.js` | Modular `background/` with `state.js`, `workspaces.js`, `sync.js`, `messaging.js`, `index.js` | Phase 4 refactor (v1.0 MVP) | Introduced the circular dependency as a side effect of splitting |
| No validation on local fallback | No change yet (DEBT-01) | — | Corrupted local storage passes through silently |

## Open Questions

1. **Does anything outside `workspaces.js` currently import `validateWorkspaceData` directly?**
   - What we know: No other file imports it by name (confirmed by reading all four files).
   - What's unclear: Nothing — confirmed no external callers.
   - Recommendation: Re-export from `workspaces.js` after moving to `sync.js` anyway, as defensive practice.

2. **Is `activeWorkspaceId` ever stored in `browser.storage.local` on the fallback path?**
   - What we know: `activateFallback()` in `sync.js` line 210 stores only `{ syncFailed: true, workspaces }`. No `activeWorkspaceId`.
   - What's unclear: Nothing — confirmed by direct inspection.
   - Recommendation: `readFromLocal()` passes `{ workspaces: result.workspaces, activeWorkspaceId: null }` to `validateWorkspaceData`. The validator handles `null` `activeWorkspaceId` by falling back to `validWorkspaces[0].id`.

3. **Are there any other callers of `readFromLocal()` beyond the two paths in `getWorkspaces()`?**
   - What we know: `readFromLocal` is a private (non-exported) function in `sync.js`. It is called only at line 21 (sync-failed branch) and line 32 (sync-read-failed branch).
   - What's unclear: Nothing — confirmed private.
   - Recommendation: No change needed to call sites; fix the function body only.

## Sources

### Primary (HIGH confidence)
- Direct source inspection: `src/background/state.js` — confirms circular import at line 5 and `throttledSave` definition at lines 43-58
- Direct source inspection: `src/background/sync.js` — confirms `readFromLocal()` at lines 218-221 and `activateFallback()` at lines 209-211
- Direct source inspection: `src/background/workspaces.js` — confirms `validateWorkspaceData()` at lines 32-53
- Direct source inspection: `src/background/index.js` — confirms `throttledSave` import from `state.js` at line 5
- Direct source inspection: `src/background/messaging.js` — confirms no imports of `validateWorkspaceData`

### Secondary (MEDIUM confidence)
- ES module circular dependency behavior in Firefox: confirmed by WebExtensions documentation that static import cycles are resolved at load time and can cause initialization-order problems when module A depends on module B's exported bindings before B has finished evaluating

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all existing
- Architecture: HIGH — both problems and solutions verified by direct source inspection; module graph fully mapped
- Pitfalls: HIGH — derived from direct code reading, not speculation

**Research date:** 2026-03-23
**Valid until:** No expiry — this is a pure structural analysis of static source files
