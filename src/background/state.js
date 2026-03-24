// ── Session State (storage.session) ─────────────────────────
// Persists flags across background unloads (MV3 event page).
// Clears on browser restart — intentional.

const SESSION_KEY = 'bgState'
const WINDOW_MAP_KEY = 'windowMap'
const DEFAULT_STATE = { isSwitching: false, lastSaveTime: 0 }

export async function getSessionState() {
  const result = await browser.storage.session.get({ [SESSION_KEY]: DEFAULT_STATE })
  return result[SESSION_KEY]
}

export async function setSessionState(updates) {
  const current = await getSessionState()
  await browser.storage.session.set({ [SESSION_KEY]: { ...current, ...updates } })
}

// ── Window Map CRUD ──────────────────────────────────────────

export async function getWindowMap() {
  const result = await browser.storage.session.get({ [WINDOW_MAP_KEY]: {} })
  return result[WINDOW_MAP_KEY]
}

export async function setWindowEntry(windowId, workspaceId) {
  const map = await getWindowMap()
  map[String(windowId)] = workspaceId
  await browser.storage.session.set({ [WINDOW_MAP_KEY]: map })
}

export async function removeWindowEntry(windowId) {
  const map = await getWindowMap()
  delete map[String(windowId)]
  await browser.storage.session.set({ [WINDOW_MAP_KEY]: map })
}
