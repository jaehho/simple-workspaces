// ============================================================
// Popup Script — renders workspace list, handles interactions
// ============================================================

let allColors = [];
let editingId = null;
let selectedColor = null;
let currentWindowId = null;

// ── Init ────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Acquire window ID before any messages (RESEARCH.md Pattern 1, HIGH confidence approach)
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  currentWindowId = activeTab.windowId;

  allColors = await browser.runtime.sendMessage({ action: 'getColors' });
  await renderList();

  document.getElementById('btn-add').addEventListener('click', onAdd);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-save').addEventListener('click', onModalSave);
  document.querySelector('.modal-backdrop').addEventListener('click', closeModal);

  // Enter key saves modal
  document.getElementById('edit-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onModalSave();
  });
});

// ── Render ───────────────────────────────────────────────────

async function renderList() {
  const state = await browser.runtime.sendMessage({ action: 'getState', windowId: currentWindowId });
  if (!state || !state.workspaces) return;

  const list = document.getElementById('workspace-list');
  while (list.firstChild) list.firstChild.remove();

  const { workspaces, windowMap, activeWorkspaceId } = state;

  // Update subtitle based on window assignment state (D-07)
  const subtitle = document.getElementById('ws-subtitle')
  if (subtitle) {
    subtitle.textContent = activeWorkspaceId === null
      ? 'Click to open in new window'
      : 'Ctrl+click to open in new window'
  }

  // Build reverse lookup: workspaceId -> windowId (for detecting in-use workspaces)
  const workspaceWindowMap = {};
  for (const [wid, wsId] of Object.entries(windowMap || {})) {
    if (wsId) workspaceWindowMap[wsId] = Number(wid);
  }

  workspaces.forEach((ws) => {
    const isActive = ws.id === activeWorkspaceId;
    const isInUse = !isActive && workspaceWindowMap[ws.id] !== undefined && workspaceWindowMap[ws.id] !== currentWindowId;
    const owningWindowId = workspaceWindowMap[ws.id];
    const tabCount = ws.tabs ? ws.tabs.length : 0;

    const li = document.createElement('li');
    li.className = 'workspace-item'
      + (isActive ? ' active' : '')
      + (isInUse ? ' workspace-item--in-use' : '');
    li.style.setProperty('--ws-color', ws.color);

    // Build DOM safely via createElement (no XSS risk)
    const dot = document.createElement('div');
    dot.className = 'ws-dot';

    const info = document.createElement('div');
    info.className = 'ws-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'ws-name';
    nameEl.textContent = ws.name;
    const tabsEl = document.createElement('div');
    tabsEl.className = 'ws-tabs';
    tabsEl.textContent = `${tabCount} tab${tabCount !== 1 ? 's' : ''}${isActive ? ' · active' : ''}`;
    info.appendChild(nameEl);
    info.appendChild(tabsEl);

    // In-use indicator icon (shows when workspace is active in another window)
    if (isInUse) {
      const inUseIcon = makeSvgIcon('M2 4h10v9H2zM5 2h9v9', {
        'stroke': 'currentColor',
        'stroke-width': '1.3',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      });
      inUseIcon.setAttribute('width', '12');
      inUseIcon.setAttribute('height', '12');
      const inUseWrap = document.createElement('span');
      inUseWrap.className = 'ws-in-use-icon';
      inUseWrap.title = 'Active in another window';
      inUseWrap.appendChild(inUseIcon);
      info.appendChild(inUseWrap);
    }

    const actions = document.createElement('div');
    actions.className = 'ws-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'edit';
    editBtn.title = 'Edit';
    editBtn.appendChild(makeSvgIcon('M11.5 2.5l2 2-8 8H3.5v-2l8-8z', {
      'stroke': 'currentColor',
      'stroke-width': '1.3',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    }));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.title = 'Delete';
    deleteBtn.appendChild(makeSvgIcon('M4 4l8 8M12 4l-8 8', {
      'stroke': 'currentColor',
      'stroke-width': '1.3',
      'stroke-linecap': 'round'
    }));

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    li.appendChild(dot);
    li.appendChild(info);
    li.appendChild(actions);

    // Click to switch, focus owning window, or open in new window
    li.addEventListener('click', (e) => {
      // Don't act if clicking an action button
      if (e.target.closest('.ws-actions')) return

      // D-12: Ctrl+click opens in new window (from any window state)
      if (e.ctrlKey) {
        e.preventDefault()
        if (!isActive) onOpenInNewWindow(ws.id)  // D-13: ignore if active here
        return
      }

      // D-01: If workspace is active in another window, focus that window
      if (isInUse) {
        onFocusWindow(owningWindowId)
      } else if (activeWorkspaceId === null) {
        // D-09: Unassigned window — open in new window (WIN-01)
        if (!isActive) onOpenInNewWindow(ws.id)
      } else if (!isActive) {
        // D-10: Assigned window — switch in current window (existing behavior)
        onSwitch(ws.id)
      }
    })

    // D-11: Middle-click opens in new window (WIN-03)
    li.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return  // only middle-click
      if (e.target.closest('.ws-actions')) return
      e.preventDefault()  // suppress autoscroll (Windows) / paste (Linux/macOS)
      if (!isActive) onOpenInNewWindow(ws.id)  // D-13: ignore if active here
    })

    // Edit
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(ws);
    });

    // Delete
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onDelete(ws.id, ws.name, state.workspaces.length);
    });

    list.appendChild(li);
  });
}

// ── Actions ──────────────────────────────────────────────────

async function onSwitch(workspaceId) {
  // Visually indicate switching
  const items = document.querySelectorAll('.workspace-item');
  items.forEach(item => item.style.opacity = '0.5');

  await browser.runtime.sendMessage({ action: 'switchWorkspace', workspaceId, windowId: currentWindowId });

  // Popup will close automatically since tabs change,
  // but re-render just in case
  await renderList();
}

async function onFocusWindow(targetWindowId) {
  await browser.runtime.sendMessage({ action: 'focusWindow', targetWindowId });
  window.close();
}

async function onOpenInNewWindow(workspaceId) {
  await browser.runtime.sendMessage({ action: 'openWorkspaceInNewWindow', workspaceId })
  window.close()
}

async function onAdd() {
  const state = await browser.runtime.sendMessage({ action: 'getState', windowId: currentWindowId });
  const count = state.workspaces ? state.workspaces.length : 0;
  const color = allColors[count % allColors.length];

  openCreateModal(color);
}

async function onDelete(workspaceId, name, totalCount) {
  if (totalCount <= 1) {
    // Can't delete last workspace — just flash the item
    return;
  }

  const confirmed = confirm(`Delete workspace "${name}"?\n\nAll saved tabs in this workspace will be lost.`);
  if (!confirmed) return;

  await browser.runtime.sendMessage({ action: 'deleteWorkspace', workspaceId, windowId: currentWindowId });
  await renderList();
}

// ── Modal ────────────────────────────────────────────────────

function openEditModal(workspace) {
  document.body.classList.add('modal-open');
  editingId = workspace.id;
  selectedColor = workspace.color;

  document.getElementById('modal-title').textContent = 'Edit Workspace';
  document.getElementById('edit-name').value = workspace.name;
  renderColorPicker(workspace.color);
  document.getElementById('edit-modal').classList.remove('hidden');

  setTimeout(() => document.getElementById('edit-name').select(), 50);
}

function openCreateModal(defaultColor) {
  document.body.classList.add('modal-open');
  editingId = null;
  selectedColor = defaultColor.hex;

  document.getElementById('modal-title').textContent = 'New Workspace';
  document.getElementById('edit-name').value = '';
  renderColorPicker(defaultColor.hex);
  document.getElementById('edit-modal').classList.remove('hidden');

  setTimeout(() => document.getElementById('edit-name').focus(), 50);
}

function closeModal() {
  document.getElementById('edit-modal').classList.add('hidden');
  document.body.classList.remove('modal-open');
  editingId = null;
}

async function onModalSave() {
  const name = document.getElementById('edit-name').value.trim();

  if (editingId) {
    // Update existing
    await browser.runtime.sendMessage({
      action: 'updateWorkspace',
      workspaceId: editingId,
      updates: { name: name || 'Untitled', color: selectedColor },
      windowId: currentWindowId,
    });
  } else {
    // Create new
    await browser.runtime.sendMessage({
      action: 'createWorkspace',
      name: name || `Workspace`,
      color: selectedColor,
      windowId: currentWindowId,
    });
  }

  closeModal();
  await renderList();
}

function renderColorPicker(activeColor) {
  const picker = document.getElementById('color-picker');
  while (picker.firstChild) picker.firstChild.remove();

  allColors.forEach((c) => {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch' + (c.hex === activeColor ? ' selected' : '');
    swatch.style.background = c.hex;
    swatch.title = c.name;
    swatch.addEventListener('click', () => {
      selectedColor = c.hex;
      picker.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
    });
    picker.appendChild(swatch);
  });
}

// ── SVG Helpers ────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeSvgIcon(pathD, pathAttrs) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', pathD);
  for (const [k, v] of Object.entries(pathAttrs)) {
    path.setAttribute(k, v);
  }

  svg.appendChild(path);
  return svg;
}
