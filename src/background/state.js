// ── Session State (storage.session) ─────────────────────────
// Persists flags across background unloads (MV3 event page).
// Clears on browser restart — intentional.

import { saveCurrentWorkspace } from './workspaces.js'

const SESSION_KEY = 'bgState'
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

export async function throttledSave() {
  const state = await getSessionState()
  if (state.isSwitching) return

  const now = Date.now()
  if (now - state.lastSaveTime < THROTTLE_MS) return

  await setSessionState({ lastSaveTime: now })
  await saveCurrentWorkspace()
}
