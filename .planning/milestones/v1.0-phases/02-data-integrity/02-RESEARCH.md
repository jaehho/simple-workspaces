# Phase 2: Data Integrity - Research

**Researched:** 2026-03-21
**Domain:** Firefox WebExtension tab atomicity, schema validation, UUID generation
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-01 | Workspace switch is atomic — all new tabs created successfully before any old tabs removed | Switch already does create-then-delete; need failure tracking to detect partial creation and skip old-tab removal |
| DATA-02 | Failed switch rolls back: pre-switch snapshot restored, no data loss | Need snapshot captured before any mutation, and cleanup path that closes all newly-created tab IDs then re-opens snapshot |
| DATA-03 | Storage reads validated against schema; corrupted data triggers recovery to safe default | Need validateWorkspaceData() that checks structural invariants and returns canonical defaults on failure |
| DATA-04 | ID generation uses `crypto.randomUUID()` instead of `Date.now()` + `Math.random()` patterns | `crypto.randomUUID()` available since Firefox 95; manifest requires 142+; moz-extension:// is a secure context |
</phase_requirements>

---

## Summary

Phase 2 hardens the workspace switch operation against partial failures and storage corruption. The current `switchWorkspace()` in `workspaces.js` already follows a create-then-delete ordering, which satisfies the spirit of DATA-01, but it does not handle mid-loop `tabs.create` failures — it silently accumulates whatever IDs were created, then removes old tabs regardless of how many new tabs actually landed. A single `tabs.create` failure during a 20-tab workspace switch would leave the user with a partially populated workspace and the original tabs gone.

The fix for DATA-01 and DATA-02 follows a compensation pattern: snapshot the pre-switch state before any mutation, detect when created tab count is short of expected tab count, close all partially-created tab IDs (compensation), and restore the snapshot to storage. This requires no external library — it is pure `browser.tabs.*` and `browser.storage.local.*` calls.

DATA-03 requires a `validateWorkspaceData(data)` function called immediately after every `storage.local.get`. The function checks structural invariants (arrays, required fields, field types) and either returns the valid data or a canonical safe default. This is hand-rolled — no schema library belongs in a Firefox extension bundle.

DATA-04 is the simplest change: replace the single `genId()` function in `workspaces.js` with `crypto.randomUUID()`. The `Date.now()` call on `createdAt` is metadata, not an ID, and is unchanged. `crypto.randomUUID()` has been available since Firefox 95 and the project mandates Firefox 142+, so there is no compatibility concern.

**Primary recommendation:** Implement compensation-based rollback in `switchWorkspace()`, a `validateWorkspaceData()` guard applied at all `storage.local.get` call sites, and replace `genId()` with `crypto.randomUUID()`.

---

## Standard Stack

No new npm dependencies are introduced by this phase. All required capabilities are native Firefox WebExtensions APIs.

### Core
| Capability | Source | Purpose | Why Standard |
|------------|--------|---------|--------------|
| `browser.tabs.create()` | Firefox WebExtensions API | Create new tabs during switch | Already in use; returns Promise resolving to `tabs.Tab` |
| `browser.tabs.remove(ids[])` | Firefox WebExtensions API | Remove old tabs after successful creation | Already in use; accepts array of IDs |
| `browser.storage.local.get/set` | Firefox WebExtensions API | Persist workspace snapshots and recovered data | Already in use |
| `crypto.randomUUID()` | Web Crypto API (built-in) | Generate standards-compliant v4 UUID | Available Firefox 95+; no library needed |

### No New Libraries
This phase requires zero new npm packages. Adding a validation library (Zod, Ajv, Yup) would be overkill for a schema with four known fields. Adding a UUID library is unnecessary because `crypto.randomUUID()` is natively available at the project's minimum Firefox version (142, well above the 95 threshold).

**Installation:** No `npm install` needed.

---

## Architecture Patterns

### Current switchWorkspace() Flow (Phase 1 output)

```
1. setSessionState({ isSwitching: true })
2. Load data from storage
3. Save current workspace tabs
4. Find target workspace
5. Loop: tabs.create() for each target tab → push to createdTabIds[]
   └─ On failure: fallback without `discarded`, or console.error and continue
6. Remove old tab IDs
7. Persist new activeWorkspaceId
8. setSessionState({ isSwitching: false })
```

**Gap:** If step 5 partially fails, `createdTabIds.length < tabsToCreate.length` but the code still removes old tabs in step 6. No snapshot is taken before mutations begin.

### Pattern 1: Snapshot-Before-Mutation

**What:** Capture a point-in-time snapshot of current workspace tabs and activeWorkspaceId before any `tabs.create` calls. This snapshot is the rollback target.

**When to use:** Always at the start of `switchWorkspace()`, before saving current tabs to storage.

```javascript
// Source: pattern derived from Firefox WebExtensions API semantics
// Snapshot state BEFORE any mutation
const snapshot = {
  workspaces: JSON.parse(JSON.stringify(data.workspaces)), // deep copy
  activeWorkspaceId: data.activeWorkspaceId,
}
```

The snapshot must be a deep copy because `data.workspaces` is mutated in place when saving current tabs (`data.workspaces[currentIdx].tabs = serializeTabs(currentTabs)`).

### Pattern 2: Count-Based Failure Detection

**What:** After the tab creation loop, compare `createdTabIds.length` to `tabsToCreate.length`. A shortfall means at least one tab creation failed entirely (both primary and fallback path failed).

**When to use:** Immediately after the tab creation loop, before any old-tab removal.

```javascript
// Source: derived from tabs.create() API rejection semantics (MDN)
const allCreated = createdTabIds.length === tabsToCreate.length
if (!allCreated) {
  // Compensation: close partial tabs, restore snapshot
  await rollbackSwitch(createdTabIds, snapshot)
  return { success: false, error: 'Switch failed: tab creation incomplete' }
}
```

`tabs.create()` rejects (throws) for privileged URL schemes. The existing fallback pattern (try with `discarded`, retry without) catches those rejections. If both attempts throw, the tab ID is never pushed to `createdTabIds`. Count comparison therefore detects the failure without needing to track per-tab error state.

### Pattern 3: Compensation Rollback Function

**What:** A dedicated `rollbackSwitch(createdTabIds, snapshot)` function that (1) closes all partially-created tabs and (2) restores the pre-switch snapshot to storage.

**Why separate function:** Rollback must also run in the `catch` block. Extracting it prevents duplication.

```javascript
// Source: derived from browser.tabs.remove() API (MDN) + browser.storage.local.set()
async function rollbackSwitch(createdTabIds, snapshot) {
  // Close any tabs that were opened before failure
  if (createdTabIds.length > 0) {
    try {
      await browser.tabs.remove(createdTabIds)
    } catch (e) {
      console.warn('[Workspaces] Rollback tab removal failed:', e)
    }
  }
  // Restore the pre-switch workspace snapshot
  try {
    await browser.storage.local.set({
      workspaces: snapshot.workspaces,
      activeWorkspaceId: snapshot.activeWorkspaceId,
    })
  } catch (e) {
    console.error('[Workspaces] Rollback storage restore failed:', e)
  }
}
```

The `tabs.remove()` call during rollback is wrapped in its own try-catch because we cannot let a rollback failure mask the original error.

### Pattern 4: Validate-on-Read

**What:** A `validateWorkspaceData(data)` function that accepts the raw result of `storage.local.get()` and either returns the validated data or a canonical safe default.

**When to use:** Immediately after every `storage.local.get(['workspaces', 'activeWorkspaceId'])` call, before any code that assumes valid structure.

```javascript
// Source: hand-rolled schema validation — no external library
const DEFAULT_WORKSPACE_DATA = () => ({
  workspaces: [],
  activeWorkspaceId: null,
})

function validateWorkspaceData(data) {
  if (!data || typeof data !== 'object') return DEFAULT_WORKSPACE_DATA()
  if (!Array.isArray(data.workspaces)) return DEFAULT_WORKSPACE_DATA()
  if (typeof data.activeWorkspaceId !== 'string') return DEFAULT_WORKSPACE_DATA()

  // Validate each workspace object
  const validWorkspaces = data.workspaces.filter(ws =>
    ws &&
    typeof ws.id === 'string' &&
    typeof ws.name === 'string' &&
    typeof ws.color === 'string' &&
    Array.isArray(ws.tabs)
  )

  // If all workspaces invalid, return safe default
  if (validWorkspaces.length === 0) return DEFAULT_WORKSPACE_DATA()

  // Ensure activeWorkspaceId references a valid workspace
  const activeExists = validWorkspaces.some(ws => ws.id === data.activeWorkspaceId)
  return {
    workspaces: validWorkspaces,
    activeWorkspaceId: activeExists ? data.activeWorkspaceId : validWorkspaces[0].id,
  }
}
```

**Recovery trigger:** If `validateWorkspaceData` returns the default (empty array), the caller must detect `workspaces.length === 0` and call `initDefaultWorkspace()`. This is the "safe default" recovery path for DATA-03.

### Pattern 5: UUID Replacement (DATA-04)

**What:** Replace the `genId()` helper function with `crypto.randomUUID()` inline.

**Why `crypto.randomUUID()` is safe here:**
- Available since Firefox 95; manifest requires Firefox 142+ (confirmed HIGH confidence)
- `moz-extension://` pages are treated as secure contexts by Firefox (privileged extension origin)
- Returns a standards-compliant v4 UUID string: `"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"` format
- `Date.now()` on `createdAt` is metadata (a timestamp), not an ID — it stays as-is

```javascript
// Source: MDN Web API – Crypto.randomUUID() (Firefox 95+)
// BEFORE:
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
}

// AFTER: delete genId(), use inline
const newWorkspace = {
  id: crypto.randomUUID(),
  // ...
}
```

### Recommended Change Scope

All changes confined to `src/background/workspaces.js`:

1. Add `validateWorkspaceData()` and `DEFAULT_WORKSPACE_DATA()` helper
2. Add `rollbackSwitch()` helper
3. Modify `switchWorkspace()` to: take snapshot → detect creation failures → call rollback
4. Modify `saveCurrentWorkspace()` to: call `validateWorkspaceData()` after get
5. Replace `genId()` with `crypto.randomUUID()` at both call sites
6. Apply `validateWorkspaceData()` in `initDefaultWorkspace()` on-startup check (in `index.js`)

`popup.js`, `messaging.js`, `state.js` require no changes.

### Anti-Patterns to Avoid

- **Partial count acceptance:** Never proceed with removing old tabs unless `createdTabIds.length === tabsToCreate.length`. Even one missing tab means the user's workspace is incomplete.
- **Rollback inside `finally` block:** The `finally` block runs even on success. Rollback must only run in the failure path and the `catch` block, not `finally`.
- **Throwing from rollbackSwitch:** Errors during rollback should be logged but must not propagate — the function is already a recovery path, not a normal operation.
- **Mutating snapshot:** The snapshot must be a deep copy made before any array/object mutations. Shallow copy (`{ ...data }`) is wrong because `data.workspaces` is the same array reference.
- **Using `String` type for `activeWorkspaceId` check only:** Also check that it matches a workspace `id` in the array; a valid string pointing to a deleted workspace is corrupt data.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUID generation | Custom base-36 encoding of timestamp + random | `crypto.randomUUID()` | Collision-resistant by construction; standard v4 format; already in browser |
| Schema validation | JSON Schema library (Ajv, Zod) | Custom `validateWorkspaceData()` | No build step in this extension; adding a library requires bundling infrastructure that doesn't exist; schema has exactly 4 top-level fields |
| Tab operation transactions | Mutex / lock library | `isSwitching` session flag (already present) + snapshot/rollback | WebExtensions are single-threaded; no concurrent access to worry about |

**Key insight:** This extension has no bundler. Scripts are loaded as raw ES modules via the manifest. Any "library" would need to be vendored as a raw `.js` file in `src/`. The validation schema is simple enough that a 15-line `validateWorkspaceData()` function is more maintainable than a vendored library.

---

## Common Pitfalls

### Pitfall 1: Shallow Copy of Snapshot
**What goes wrong:** `const snapshot = { ...data }` copies the object reference, not the `workspaces` array. Subsequent mutations to `data.workspaces[currentIdx].tabs` also mutate `snapshot.workspaces`.
**Why it happens:** JavaScript object spread is shallow.
**How to avoid:** Use `JSON.parse(JSON.stringify(data))` for a full deep copy before any mutation. Both `workspaces` (array of objects containing arrays) and `activeWorkspaceId` (string, primitively copied) need this treatment. Alternatively, only deep-copy `workspaces` and separately copy `activeWorkspaceId` as a string.
**Warning signs:** Rollback restores the already-mutated (partially-updated) workspace instead of the original.

### Pitfall 2: Rollback Leaves User With No Tabs
**What goes wrong:** Rollback closes all newly-created tab IDs. If creation partially succeeded, all new tabs are gone. But the original tabs were not yet removed (the whole point of create-then-delete). The original tabs are still open — rollback just needs to ensure the window still has at least one tab.
**Why it happens:** Forgetting that the original tabs are still in the window during rollback — they haven't been removed yet because removal is guarded by the success check.
**How to avoid:** The rollback only closes `createdTabIds`. It does NOT touch the original tabs. The user's pre-switch window state survives.
**Warning signs:** After rollback, the window shows a blank "New Tab" — this means the original tabs were removed before rollback ran.

### Pitfall 3: tabs.create() Failure Count Is Wrong
**What goes wrong:** The existing fallback path (primary → fallback-without-discarded → console.error) never pushes to `createdTabIds` when both attempts fail. But if the fallback succeeds, it pushes one ID. The count check `createdTabIds.length === tabsToCreate.length` correctly handles this because only successfully-created tab IDs are counted.
**Why it happens:** Mistakenly counting "attempts" rather than "successes."
**How to avoid:** Only push to `createdTabIds` inside the success path of `tabs.create()`. Never push on a catch branch.
**Warning signs:** Rollback triggers even when all tabs were created (false negative).

### Pitfall 4: validateWorkspaceData Triggers Unnecessary Re-initialization
**What goes wrong:** If `validateWorkspaceData` returns the empty default on every call, `initDefaultWorkspace()` is called repeatedly, wiping user data.
**Why it happens:** Calling `validateWorkspaceData` before `initDefaultWorkspace` has written initial data (e.g., on very first run).
**How to avoid:** Only trigger `initDefaultWorkspace` when `workspaces.length === 0`. The `onInstalled` and `onStartup` handlers already have explicit checks — the validator's empty default simply propagates through those same checks cleanly.
**Warning signs:** Each browser restart creates a new default workspace.

### Pitfall 5: isSwitching Lock Not Released After Rollback
**What goes wrong:** If rollback throws or takes a code path that bypasses `finally`, `isSwitching` stays `true` in `storage.session`. Subsequent tab events are suppressed indefinitely.
**Why it happens:** The `isSwitching: false` reset is in `finally`, so it does run — but only if `rollbackSwitch` itself doesn't throw. Since `rollbackSwitch` catches its own errors internally, `finally` always runs correctly.
**How to avoid:** Confirm that `rollbackSwitch` never throws (swallows errors internally). The existing `finally { setSessionState({ isSwitching: false }) }` pattern is correct.
**Warning signs:** After a failed switch, workspaces stop live-saving (tabs changes are silently dropped).

---

## Code Examples

### Complete Revised switchWorkspace() Skeleton
```javascript
// Source: derived from browser.tabs.create/remove MDN docs + compensation pattern
export async function switchWorkspace(targetId) {
  await setSessionState({ isSwitching: true })
  let snapshot = null
  const createdTabIds = []

  try {
    const raw = await browser.storage.local.get(['workspaces', 'activeWorkspaceId'])
    const data = validateWorkspaceData(raw)
    if (!data.workspaces.length) throw new Error('No workspaces found')

    if (targetId === data.activeWorkspaceId) return { success: true }

    const currentTabs = await browser.tabs.query({ currentWindow: true })

    // Save current workspace tabs into data (mutates data.workspaces in memory)
    const currentIdx = data.workspaces.findIndex(w => w.id === data.activeWorkspaceId)
    if (currentIdx !== -1) {
      data.workspaces[currentIdx].tabs = serializeTabs(currentTabs)
    }

    // Snapshot AFTER updating current tabs, BEFORE opening new ones
    snapshot = {
      workspaces: JSON.parse(JSON.stringify(data.workspaces)),
      activeWorkspaceId: data.activeWorkspaceId,
    }

    const target = data.workspaces.find(w => w.id === targetId)
    if (!target) throw new Error('Target workspace not found')

    const tabsToCreate = target.tabs.length > 0
      ? target.tabs
      : [{ url: 'about:newtab', title: 'New Tab', pinned: false }]

    for (let i = 0; i < tabsToCreate.length; i++) {
      // ... build createProps (existing logic) ...
      try {
        const created = await browser.tabs.create(createProps)
        createdTabIds.push(created.id)
      } catch (err) {
        try {
          delete createProps.discarded
          delete createProps.title
          const created = await browser.tabs.create(createProps)
          createdTabIds.push(created.id)
        } catch (err2) {
          console.error('[Workspaces] Tab create failed entirely:', err2)
          // createdTabIds count is now short — triggers rollback below
        }
      }
    }

    // Atomicity check: all tabs must be created before removing old ones
    if (createdTabIds.length !== tabsToCreate.length) {
      await rollbackSwitch(createdTabIds, snapshot)
      return { success: false, error: 'Switch aborted: not all tabs could be created' }
    }

    // All tabs created — safe to remove old ones
    const oldTabIds = currentTabs.map(t => t.id)
    if (oldTabIds.length > 0) await browser.tabs.remove(oldTabIds)

    data.activeWorkspaceId = targetId
    await browser.storage.local.set({
      workspaces: data.workspaces,
      activeWorkspaceId: targetId,
    })

    updateBadge(target)
    return { success: true }

  } catch (e) {
    console.error('[Workspaces] Switch error:', e)
    if (snapshot) await rollbackSwitch(createdTabIds, snapshot)
    return { success: false, error: e.message }
  } finally {
    await setSessionState({ isSwitching: false })
  }
}
```

### validateWorkspaceData() — Full Implementation
```javascript
// Source: hand-rolled; no external dependencies
const DEFAULT_WORKSPACE_DATA = () => ({
  workspaces: [],
  activeWorkspaceId: null,
})

function validateWorkspaceData(data) {
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

### rollbackSwitch() — Full Implementation
```javascript
// Source: compensation pattern using browser.tabs.remove + browser.storage.local.set
async function rollbackSwitch(createdTabIds, snapshot) {
  if (createdTabIds.length > 0) {
    try {
      await browser.tabs.remove(createdTabIds)
    } catch (e) {
      console.warn('[Workspaces] Rollback: tab removal failed:', e)
    }
  }
  if (snapshot) {
    try {
      await browser.storage.local.set({
        workspaces: snapshot.workspaces,
        activeWorkspaceId: snapshot.activeWorkspaceId,
      })
    } catch (e) {
      console.error('[Workspaces] Rollback: storage restore failed:', e)
    }
  }
}
```

### crypto.randomUUID() — Replacement for genId()
```javascript
// Source: MDN Web API – Crypto.randomUUID() — Firefox 95+ (project requires 142+)
// Delete genId() entirely. At each call site:

// initDefaultWorkspace():
const defaultWorkspace = {
  id: crypto.randomUUID(),
  name: 'Default',
  color: COLORS[0].hex,
  tabs: tabData,
  createdAt: Date.now(),   // Date.now() for createdAt is correct — it's a timestamp, not an ID
}

// createWorkspace():
const newWorkspace = {
  id: crypto.randomUUID(),
  name: name || `Workspace ${workspaces.length + 1}`,
  // ...
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Date.now() + Math.random()` for IDs | `crypto.randomUUID()` (v4 UUID) | This phase | Collision-proof, standards-compliant, importable/exportable identity |
| No storage validation on read | `validateWorkspaceData()` before every use | This phase | Corrupted/partial storage triggers recovery instead of runtime crash |
| Best-effort tab creation (silent partial success) | Atomic create-then-check with rollback | This phase | No tab loss on creation failure |

**Deprecated/outdated in this codebase:**
- `genId()` function in `workspaces.js` lines 252–254: replaced by `crypto.randomUUID()`

---

## Open Questions

1. **Rollback UX: what does the user see?**
   - What we know: rollback closes partial tabs and restores storage. The original workspace tabs remain in the window.
   - What's unclear: should the popup show an error message, or just silently stay on the current workspace?
   - Recommendation: Return `{ success: false, error: '...' }` from `switchWorkspace()`. The popup's `onSwitch()` handler already receives this — it can add a `console.warn` or a visual indicator. Full UX notifications are deferred to v2 (UX-01). For this phase, silent console warning is acceptable.

2. **Snapshot timing: before or after saving current tabs?**
   - What we know: the current code saves the live tab list for the current workspace into `data.workspaces` before switching. This mutated state is what we want to snapshot.
   - What's unclear: if we snapshot before saving current tabs, rollback restores the stale tab list. If we snapshot after, rollback restores the most recent tab list.
   - Recommendation: Snapshot AFTER updating `data.workspaces[currentIdx].tabs` but BEFORE calling `tabs.create()`. The user's most recent tab state is preserved. (Shown in code skeleton above.)

3. **tabs.remove() during rollback: what if a created tab was already closed by the user?**
   - What we know: `tabs.remove()` for a non-existent ID may silently succeed or throw. MDN does not specify the exact behavior for missing IDs.
   - Recommendation: Wrap `tabs.remove(createdTabIds)` in try-catch (shown in rollback implementation above). A user closing one of the newly-created tabs in the ~100ms between creation and rollback is an edge case that should not break rollback.

---

## Sources

### Primary (HIGH confidence)
- MDN Web Docs — `browser.tabs.create()`: Returns Promise resolving to `tabs.Tab` after tab creation; rejects for privileged URL schemes (`chrome:`, `javascript:`, `data:`, `file:`, privileged `about:` pages)
- MDN Web Docs — `browser.tabs.remove()`: Accepts single ID or array; fulfills with no arguments when tabs removed; rejects on any error
- MDN Web Docs / caniuse.com — `crypto.randomUUID()`: Firefox 95+ support, baseline widely available since March 2022; available in Web Workers and secure contexts
- Source code inspection — `src/background/workspaces.js`: `genId()` at lines 252–254 confirmed as only ID generation site; `Date.now()` at lines 34, 171 confirmed as `createdAt` timestamps (not IDs)

### Secondary (MEDIUM confidence)
- Search results + MDN context — `moz-extension://` is treated as a secure context (privileged extension origin), making `crypto.randomUUID()` available in background scripts
- Firefox bug tracker (Bugzilla #1723674) — `crypto.randomUUID()` implemented in Firefox 95; older versions lack it but project requires 142+

### Tertiary (LOW confidence)
- Web search findings — `tabs.remove()` behavior for non-existent IDs is unspecified in MDN; likely silent but empirical test is recommended

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all capabilities are native browser APIs already in use
- Architecture patterns (atomicity, rollback): HIGH — derived directly from `tabs.create`/`tabs.remove` API contracts on MDN
- `validateWorkspaceData` pattern: HIGH — straightforward structural validation with no external dependencies
- `crypto.randomUUID()` availability: HIGH — Firefox 95+, project requires 142+, confirmed on caniuse.com
- `tabs.remove()` behavior for missing IDs: LOW — not specified in MDN docs; safe to wrap in try-catch

**Research date:** 2026-03-21
**Valid until:** 2026-09-21 (stable WebExtensions API; Firefox 142+ minimum locks the crypto.randomUUID compatibility forever)
