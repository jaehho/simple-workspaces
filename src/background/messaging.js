// ── Message Router ──────────────────────────────────────────

import { switchWorkspace, createWorkspace, deleteWorkspace, updateWorkspace, saveCurrentWorkspace, COLORS } from './workspaces.js'

// TODO: sender validation (SEC-03) added in plan 02

export function handleMessage(msg, sender) {
  // TODO: sender validation (SEC-03) added in plan 02
  void sender

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
