// ── Background Entry Point ─────────────────────────────────
// All listeners MUST be registered synchronously at the top level.
// Firefox event pages only wake for events with top-level listeners.

import { throttledSave } from './state.js'
import { initDefaultWorkspace, updateBadge, saveCurrentWorkspace } from './workspaces.js'
import { handleMessage } from './messaging.js'

// ── Tab Event Listeners (live-save via throttle) ────────────
browser.tabs.onCreated.addListener(() => throttledSave())
browser.tabs.onRemoved.addListener((_tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing) throttledSave()
})
browser.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.title || changeInfo.pinned !== undefined) {
    throttledSave()
  }
})
browser.tabs.onMoved.addListener(() => throttledSave())
browser.tabs.onAttached.addListener(() => throttledSave())
browser.tabs.onDetached.addListener(() => throttledSave())

// ── Message Handler ─────────────────────────────────────────
browser.runtime.onMessage.addListener(handleMessage)

// ── Lifecycle Listeners ─────────────────────────────────────
browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') await initDefaultWorkspace()
})

browser.runtime.onStartup.addListener(async () => {
  const { workspaces } = await browser.storage.local.get('workspaces')
  if (!workspaces || workspaces.length === 0) await initDefaultWorkspace()
})

// ── Safety net: save on suspend ─────────────────────────────
browser.runtime.onSuspend.addListener(() => {
  saveCurrentWorkspace()
})

// ── Badge init (async, after listeners) ─────────────────────
;(async () => {
  const data = await browser.storage.local.get(['workspaces', 'activeWorkspaceId'])
  if (data.workspaces && data.activeWorkspaceId) {
    const active = data.workspaces.find(w => w.id === data.activeWorkspaceId)
    if (active) updateBadge(active)
  }
})()
