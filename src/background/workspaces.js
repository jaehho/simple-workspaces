// ── Workspace CRUD and Tab Operations ───────────────────────

import { getSessionState, setSessionState } from './state.js'

export const COLORS = [
  { name: 'Blue',   hex: '#3b82f6' },
  { name: 'Red',    hex: '#ef4444' },
  { name: 'Green',  hex: '#22c55e' },
  { name: 'Purple', hex: '#a855f7' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Teal',   hex: '#14b8a6' },
  { name: 'Pink',   hex: '#ec4899' },
]

// ── Initialization ──────────────────────────────────────────

export async function initDefaultWorkspace() {
  const tabs = await browser.tabs.query({ currentWindow: true })
  const tabData = serializeTabs(tabs)

  const defaultWorkspace = {
    id: genId(),
    name: 'Default',
    color: COLORS[0].hex,
    tabs: tabData,
    createdAt: Date.now(),
  }

  await browser.storage.local.set({
    workspaces: [defaultWorkspace],
    activeWorkspaceId: defaultWorkspace.id,
  })

  updateBadge(defaultWorkspace)
}

// ── Save Current Workspace ──────────────────────────────────

export async function saveCurrentWorkspace() {
  const state = await getSessionState()
  if (state.isSwitching) return

  try {
    const data = await browser.storage.local.get(['workspaces', 'activeWorkspaceId'])
    if (!data.workspaces || !data.activeWorkspaceId) return

    const tabs = await browser.tabs.query({ currentWindow: true })
    const tabData = serializeTabs(tabs)

    // Don't save empty state (could be mid-switch or window closing)
    if (tabData.length === 0) return

    const idx = data.workspaces.findIndex(w => w.id === data.activeWorkspaceId)
    if (idx !== -1) {
      data.workspaces[idx].tabs = tabData
      await browser.storage.local.set({ workspaces: data.workspaces })
    }
  } catch (e) {
    console.error('[Workspaces] Save error:', e)
  }
}

// ── Switch Workspace ────────────────────────────────────────

export async function switchWorkspace(targetId) {
  await setSessionState({ isSwitching: true })

  try {
    const data = await browser.storage.local.get(['workspaces', 'activeWorkspaceId'])
    if (!data.workspaces) throw new Error('No workspaces found')

    if (targetId === data.activeWorkspaceId) return

    const currentTabs = await browser.tabs.query({ currentWindow: true })

    // Save current workspace's tabs
    const currentIdx = data.workspaces.findIndex(w => w.id === data.activeWorkspaceId)
    if (currentIdx !== -1) {
      data.workspaces[currentIdx].tabs = serializeTabs(currentTabs)
    }

    // Find target workspace
    const target = data.workspaces.find(w => w.id === targetId)
    if (!target) throw new Error('Target workspace not found')

    // Determine tabs to open
    const tabsToCreate = target.tabs.length > 0
      ? target.tabs
      : [{ url: 'about:newtab', title: 'New Tab', pinned: false }]

    // Create new tabs (first one active, rest discarded to save RAM)
    const createdTabIds = []
    for (let i = 0; i < tabsToCreate.length; i++) {
      const t = tabsToCreate[i]
      const isAbout = !t.url || t.url.startsWith('about:')
      const createProps = {
        active: i === 0,
        pinned: t.pinned || false,
      }

      // about: URLs can't be set directly, omit url to get default new tab
      if (!isAbout) {
        createProps.url = t.url
        // Discarded tabs save RAM — only for non-active, non-about tabs
        if (i > 0) {
          createProps.discarded = true
          createProps.title = t.title || t.url
        }
      }

      try {
        const created = await browser.tabs.create(createProps)
        createdTabIds.push(created.id)
      } catch (err) {
        // Fallback: create without discarded if it fails
        console.warn('[Workspaces] Tab create fallback for:', t.url, err)
        try {
          delete createProps.discarded
          delete createProps.title
          const created = await browser.tabs.create(createProps)
          createdTabIds.push(created.id)
        } catch (err2) {
          console.error('[Workspaces] Tab create failed entirely:', err2)
        }
      }
    }

    // Close old tabs (only after new ones are created)
    const oldTabIds = currentTabs.map(t => t.id)
    if (createdTabIds.length > 0 && oldTabIds.length > 0) {
      await browser.tabs.remove(oldTabIds)
    }

    // Persist
    data.activeWorkspaceId = targetId
    await browser.storage.local.set({
      workspaces: data.workspaces,
      activeWorkspaceId: targetId,
    })

    updateBadge(target)

    return { success: true }

  } catch (e) {
    console.error('[Workspaces] Switch error:', e)
    return { success: false, error: e.message }
  } finally {
    await setSessionState({ isSwitching: false })
  }
}

// ── Create Workspace ────────────────────────────────────────

export async function createWorkspace(name, color) {
  const { workspaces } = await browser.storage.local.get('workspaces')

  const newWorkspace = {
    id: genId(),
    name: name || `Workspace ${workspaces.length + 1}`,
    color: color || COLORS[workspaces.length % COLORS.length].hex,
    tabs: [],
    createdAt: Date.now(),
  }

  workspaces.push(newWorkspace)
  await browser.storage.local.set({ workspaces })

  // Switch to the new (empty) workspace
  await switchWorkspace(newWorkspace.id)

  return newWorkspace
}

// ── Delete Workspace ────────────────────────────────────────

export async function deleteWorkspace(workspaceId) {
  const data = await browser.storage.local.get(['workspaces', 'activeWorkspaceId'])
  if (data.workspaces.length <= 1) {
    return { success: false, error: 'Cannot delete the last workspace' }
  }

  const idx = data.workspaces.findIndex(w => w.id === workspaceId)
  if (idx === -1) return { success: false, error: 'Workspace not found' }

  data.workspaces.splice(idx, 1)
  await browser.storage.local.set({ workspaces: data.workspaces })

  // If we deleted the active workspace, switch to the first available
  if (data.activeWorkspaceId === workspaceId) {
    await switchWorkspace(data.workspaces[0].id)
  }

  return { success: true }
}

// ── Update Workspace (rename / recolor) ─────────────────────

export async function updateWorkspace(workspaceId, updates) {
  const { workspaces } = await browser.storage.local.get('workspaces')
  const idx = workspaces.findIndex(w => w.id === workspaceId)
  if (idx === -1) return { success: false, error: 'Not found' }

  if (updates.name !== undefined) workspaces[idx].name = updates.name
  if (updates.color !== undefined) workspaces[idx].color = updates.color

  await browser.storage.local.set({ workspaces })

  // Update badge if this is the active workspace
  const { activeWorkspaceId } = await browser.storage.local.get('activeWorkspaceId')
  if (activeWorkspaceId === workspaceId) {
    updateBadge(workspaces[idx])
  }

  return { success: true }
}

// ── Badge ───────────────────────────────────────────────────

export function updateBadge(workspace) {
  const initial = workspace.name.charAt(0).toUpperCase()
  browser.action.setBadgeText({ text: initial })
  browser.action.setBadgeBackgroundColor({ color: workspace.color })
}

// ── Helpers ─────────────────────────────────────────────────

export function serializeTabs(tabs) {
  return tabs
    .filter(t => {
      // Keep about:newtab but skip other internal pages
      if (t.url.startsWith('about:') && t.url !== 'about:newtab') return false
      if (t.url.startsWith('moz-extension:')) return false
      return true
    })
    .map(t => ({
      url: t.url,
      title: t.title || t.url,
      pinned: t.pinned,
      favIconUrl: t.favIconUrl || '',
    }))
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
}
