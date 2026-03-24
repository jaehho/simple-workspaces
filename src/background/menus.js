// ── Context Menu: "Move to Workspace" ───────────────────────
// Dynamic submenu rebuilt on every open via menus.onShown.
// Child items are non-persistent (exist only while menu is open).

import { getWorkspaces } from './sync.js'
import { getWindowMap } from './state.js'
import { moveTabsToWorkspace } from './workspaces.js'

export const PARENT_MENU_ID = 'move-to-workspace'
const CHILD_ID_PREFIX = 'move-to-ws-'

// Track child IDs for removal on next onShown
const currentChildIds = new Set()

// Instance ID guard: prevents stale async results from overwriting
// a newer menu open (Research Pattern 2)
let lastMenuInstanceId = 0
let nextMenuInstanceId = 1

// ── onShown Handler ──────────────────────────────────────────

export async function handleMenuShown(info, tab) {
  if (!info.contexts.includes('tab')) return

  const menuInstanceId = nextMenuInstanceId++
  lastMenuInstanceId = menuInstanceId

  const [workspaces, windowMap] = await Promise.all([
    getWorkspaces(),
    getWindowMap(),
  ])

  // Guard: menu may have closed during async fetch
  if (menuInstanceId !== lastMenuInstanceId) return

  const activeWsId = windowMap[String(tab.windowId)]

  // Remove stale child items from previous open
  for (const id of currentChildIds) {
    try {
      await browser.menus.remove(id)
    } catch {
      // Item may not exist if menu was closed — safe to ignore
    }
  }
  currentChildIds.clear()

  // Build sorted candidate list: exclude active workspace (D-15),
  // sort by lastUsedAt descending (D-12), fall back to createdAt
  const candidates = workspaces
    .filter(ws => ws.id !== activeWsId)
    .sort((a, b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt))

  for (const ws of candidates) {
    const isOpenElsewhere = Object.values(windowMap).includes(ws.id)
    const tabCount = ws.tabs.length
    const tabWord = tabCount === 1 ? 'tab' : 'tabs'
    // D-10: "Work (12 tabs)" / D-11: "Work (12 tabs) [open]"
    const label = isOpenElsewhere
      ? `${ws.name} (${tabCount} ${tabWord}) [open]`
      : `${ws.name} (${tabCount} ${tabWord})`

    const childId = CHILD_ID_PREFIX + ws.id
    browser.menus.create({
      id: childId,
      parentId: PARENT_MENU_ID,
      title: label,
      contexts: ['tab'],
    })
    currentChildIds.add(childId)
  }

  browser.menus.refresh()
}

// ── onClicked Handler ────────────────────────────────────────

export async function handleMenuClicked(info, tab) {
  if (!info.menuItemId.startsWith(CHILD_ID_PREFIX)) return

  const targetWsId = info.menuItemId.slice(CHILD_ID_PREFIX.length)

  // MENU-04 + Pitfall 4: multi-tab selection logic
  // If the right-clicked tab is highlighted, move ALL highlighted tabs.
  // If not highlighted (user right-clicked a non-selected tab), move only that one.
  let tabsToMove
  if (tab.highlighted) {
    tabsToMove = await browser.tabs.query({
      windowId: tab.windowId,
      highlighted: true,
    })
  } else {
    tabsToMove = [tab]
  }

  const result = await moveTabsToWorkspace(tabsToMove, targetWsId, tab.windowId)
  if (!result.success) {
    console.error('[Workspaces] Move via context menu failed:', result.error)
  }
}
