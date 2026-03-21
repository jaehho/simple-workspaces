// ============================================================
// Popup Script — renders workspace list, handles interactions
// ============================================================

let allColors = [];
let editingId = null;
let selectedColor = null;

// ── Init ────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
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
  const state = await browser.runtime.sendMessage({ action: 'getState' });
  if (!state || !state.workspaces) return;

  const list = document.getElementById('workspace-list');
  while (list.firstChild) list.firstChild.remove();

  state.workspaces.forEach((ws) => {
    const isActive = ws.id === state.activeWorkspaceId;
    const tabCount = ws.tabs ? ws.tabs.length : 0;

    const li = document.createElement('li');
    li.className = 'workspace-item' + (isActive ? ' active' : '');
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

    // Click to switch
    li.addEventListener('click', (e) => {
      // Don't switch if clicking an action button
      if (e.target.closest('.ws-actions')) return;
      if (!isActive) onSwitch(ws.id);
    });

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

  await browser.runtime.sendMessage({ action: 'switchWorkspace', workspaceId });

  // Popup will close automatically since tabs change,
  // but re-render just in case
  await renderList();
}

async function onAdd() {
  const state = await browser.runtime.sendMessage({ action: 'getState' });
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

  await browser.runtime.sendMessage({ action: 'deleteWorkspace', workspaceId });
  await renderList();
}

// ── Modal ────────────────────────────────────────────────────

function openEditModal(workspace) {
  editingId = workspace.id;
  selectedColor = workspace.color;

  document.getElementById('modal-title').textContent = 'Edit Workspace';
  document.getElementById('edit-name').value = workspace.name;
  renderColorPicker(workspace.color);
  document.getElementById('edit-modal').classList.remove('hidden');

  setTimeout(() => document.getElementById('edit-name').select(), 50);
}

function openCreateModal(defaultColor) {
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
    });
  } else {
    // Create new
    await browser.runtime.sendMessage({
      action: 'createWorkspace',
      name: name || `Workspace`,
      color: selectedColor,
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

