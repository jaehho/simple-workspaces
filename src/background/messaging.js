// ── Message Router ──────────────────────────────────────────

import { switchWorkspace, createWorkspace, deleteWorkspace, updateWorkspace, saveCurrentWorkspace, assignWorkspace, openWorkspaceInNewWindow, COLORS } from './workspaces.js'
import { getWindowMap } from './state.js'
import { getWorkspaces } from './sync.js'

// Dev-mode detection — cached at startup (per D-11)
let isDevMode = false
browser.management.getSelf().then(info => {
  isDevMode = (info.installType === 'development')
})

export function handleMessage(msg, sender) {
  // Validate sender origin — reject non-extension messages (per D-10)
  if (!sender.url || !sender.url.startsWith('moz-extension://')) {
    if (isDevMode) {
      console.warn('[Workspaces] Rejected message from non-extension origin:', sender.url)
    }
    return Promise.resolve(null)
  }

  switch (msg.action) {
    case 'getState': {
      return (async () => {
        const workspaces = await getWorkspaces()
        const windowMap = await getWindowMap()
        return {
          workspaces,
          windowMap,
          currentWindowId: msg.windowId,
          activeWorkspaceId: windowMap[String(msg.windowId)] || null,
        }
      })()
    }
    case 'switchWorkspace':
      return switchWorkspace(msg.workspaceId, msg.windowId)
    case 'createWorkspace':
      return createWorkspace(msg.name, msg.color, msg.windowId)
    case 'deleteWorkspace':
      return deleteWorkspace(msg.workspaceId, msg.windowId)
    case 'updateWorkspace':
      return updateWorkspace(msg.workspaceId, msg.updates, msg.windowId)
    case 'getColors':
      return Promise.resolve(COLORS)
    case 'forceSave':
      return saveCurrentWorkspace(msg.windowId).then(() => ({ success: true }))
    case 'focusWindow':
      return (async () => {
        try {
          await browser.windows.update(msg.targetWindowId, { focused: true })
          return { success: true }
        } catch (e) {
          console.error('[Workspaces] Focus window error:', e)
          return { success: false, error: e.message }
        }
      })()
    case 'assignWorkspace':
      return assignWorkspace(msg.workspaceId, msg.windowId)
    case 'openWorkspaceInNewWindow':
      return openWorkspaceInNewWindow(msg.workspaceId)
    default:
      return Promise.resolve(null)
  }
}
