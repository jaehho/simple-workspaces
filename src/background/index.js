// ── Background Entry Point ─────────────────────────────────
// All listeners MUST be registered synchronously at the top level.
// Firefox event pages only wake for events with top-level listeners.

import { throttledSave, removeWindowEntry, getWindowMap } from './state.js'
import { initDefaultWorkspace, updateBadge, saveCurrentWorkspace, validateWorkspaceData, reclaimWorkspaces } from './workspaces.js'
import { handleMessage } from './messaging.js'

// ── Tab Event Listeners (live-save via throttle) ────────────
browser.tabs.onCreated.addListener((tab) => throttledSave(tab.windowId))
browser.tabs.onRemoved.addListener((_tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing) throttledSave(removeInfo.windowId)
})
browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.title || changeInfo.pinned !== undefined) {
    throttledSave(tab.windowId)
  }
})
browser.tabs.onMoved.addListener((_tabId, moveInfo) => throttledSave(moveInfo.windowId))
browser.tabs.onAttached.addListener((_tabId, attachInfo) => throttledSave(attachInfo.newWindowId))
browser.tabs.onDetached.addListener((_tabId, detachInfo) => throttledSave(detachInfo.oldWindowId))

// ── Window Event Listeners ────────────────────────────────
browser.windows.onRemoved.addListener(async (windowId) => {
  await removeWindowEntry(windowId)
})

browser.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === browser.windows.WINDOW_ID_NONE) return
  const windowMap = await getWindowMap()
  const workspaceId = windowMap[String(windowId)]
  if (workspaceId) {
    const raw = await browser.storage.local.get(['workspaces'])
    const { workspaces } = validateWorkspaceData(raw)
    const ws = workspaces.find(w => w.id === workspaceId)
    if (ws) updateBadge(ws, windowId)
  } else {
    updateBadge(null, windowId)
  }
})

// ── Message Handler ─────────────────────────────────────────
browser.runtime.onMessage.addListener(handleMessage)

// ── Lifecycle Listeners ─────────────────────────────────────
browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const win = await browser.windows.getCurrent()
    await initDefaultWorkspace(win.id)
  }
})

browser.runtime.onStartup.addListener(async () => {
  const raw = await browser.storage.local.get(['workspaces'])
  const data = validateWorkspaceData(raw)
  if (!data.workspaces.length) {
    const win = await browser.windows.getCurrent()
    await initDefaultWorkspace(win.id)
  } else {
    await reclaimWorkspaces()
  }
})

// ── Safety net: save all assigned windows on suspend ────────
browser.runtime.onSuspend.addListener(async () => {
  const windowMap = await getWindowMap()
  for (const wid of Object.keys(windowMap)) {
    if (windowMap[wid]) await saveCurrentWorkspace(Number(wid))
  }
})

// ── Badge init (async, after listeners) ─────────────────────
;(async () => {
  const raw = await browser.storage.local.get(['workspaces'])
  const data = validateWorkspaceData(raw)
  if (!data.workspaces.length) return
  const windowMap = await getWindowMap()
  const wins = await browser.windows.getAll()
  for (const win of wins) {
    const wsId = windowMap[String(win.id)]
    if (wsId) {
      const ws = data.workspaces.find(w => w.id === wsId)
      if (ws) updateBadge(ws, win.id)
    } else {
      updateBadge(null, win.id)
    }
  }
})()
