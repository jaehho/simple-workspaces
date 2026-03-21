// ── Message Router ──────────────────────────────────────────

import { switchWorkspace, createWorkspace, deleteWorkspace, updateWorkspace, saveCurrentWorkspace, COLORS } from './workspaces.js'

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
    case 'getState':
      return browser.storage.local.get(['workspaces', 'activeWorkspaceId'])
    case 'switchWorkspace':
      return switchWorkspace(msg.workspaceId)
    case 'createWorkspace':
      return createWorkspace(msg.name, msg.color)
    case 'deleteWorkspace':
      return deleteWorkspace(msg.workspaceId)
    case 'updateWorkspace':
      return updateWorkspace(msg.workspaceId, msg.updates)
    case 'getColors':
      return Promise.resolve(COLORS)
    case 'forceSave':
      return saveCurrentWorkspace().then(() => ({ success: true }))
    default:
      return Promise.resolve(null)
  }
}
