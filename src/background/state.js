// ── Session State (storage.session) ─────────────────────────
// Persists flags across background unloads (MV3 event page).
// Clears on browser restart — intentional.

import { saveCurrentWorkspace } from './workspaces.js'

const SESSION_KEY = 'bgState'
const WINDOW_MAP_KEY = 'windowMap'
const DEFAULT_STATE = { isSwitching: false, lastSaveTime: 0 }
const THROTTLE_MS = 500

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

// ── Throttled Save ───────────────────────────────────────────

export async function throttledSave(windowId) {
  if (windowId === undefined) return

  // Skip if this window has no workspace assignment (D-08, Pitfall 2)
  const windowMap = await getWindowMap()
  if (!windowMap[String(windowId)]) return

  const state = await getSessionState()
  if (state.isSwitching) return

  const now = Date.now()
  if (now - state.lastSaveTime < THROTTLE_MS) return

  await setSessionState({ lastSaveTime: now })
  await saveCurrentWorkspace(windowId)
}
