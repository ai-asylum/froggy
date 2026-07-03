// The slot picker popover. Opened by clicking an empty slot on the frog, or by
// long-pressing / right-clicking any slot. It lists every installed app so you
// can drop one into the slot, clear the slot, or jump straight to the settings
// of the app currently in the slot. Closes on blur (handled in main), and after
// any choice.

const params = new URLSearchParams(location.search);
const slotIndex = Number(params.get('index') || 0);

const listEl = document.getElementById('list');
const manageEl = document.getElementById('manage');
const titleEl = document.getElementById('title');

function iconTile(app) {
  const icon = document.createElement('span');
  icon.className = 'appicon';
  icon.style.background = app.color || '#4caf50';
  icon.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${app.icon || ''}</svg>`;
  return icon;
}

// The app whose settings the "App settings" row opens (the one in this slot).
let currentApp = null;

async function render() {
  const { slots, apps } = await window.api.invoke('slots:context');
  const currentId = slots[slotIndex] || null;
  currentApp = (apps || []).find((a) => a.id === currentId) || null;
  titleEl.textContent = currentId ? 'Change slot app' : 'Add an app to this slot';

  listEl.innerHTML = '';
  for (const app of (apps || []).filter((a) => a.installed)) {
    const otherSlot = slots.findIndex((id, i) => id === app.id && i !== slotIndex);

    const row = document.createElement('button');
    row.className = 'row' + (app.id === currentId ? ' selected' : '');

    const meta = document.createElement('span');
    meta.className = 'appmeta';
    const name = document.createElement('span');
    name.className = 'appname';
    name.textContent = app.name;
    const tag = document.createElement('span');
    tag.className = 'apptag';
    tag.textContent = app.tagline || '';
    meta.append(name, tag);

    const spacer = document.createElement('span');
    spacer.className = 'spacer';

    row.append(iconTile(app), meta, spacer);

    if (app.id === currentId) {
      // The app already in this slot: clicking it removes it (clears the slot).
      const check = document.createElement('span');
      check.className = 'check';
      check.textContent = '\u2713';
      row.append(check);
      row.title = 'Click to remove from slot';
    } else if (otherSlot !== -1) {
      const badge = document.createElement('span');
      badge.className = 'onfrog';
      badge.textContent = 'on frog';
      row.append(badge);
    }

    // Clicking the current app clears the slot; any other app fills it.
    row.addEventListener('click', () => choose(app.id === currentId ? null : app.id));
    listEl.appendChild(row);
  }

  // "App settings" only makes sense when the slot holds an app that has a
  // settings screen; otherwise there's nothing to configure.
  manageEl.hidden = !(currentApp && currentApp.settingsView);
}

function choose(appId) {
  window.api.invoke('slots:set', { index: slotIndex, appId }).then(() => window.close());
}

manageEl.addEventListener('click', () => {
  if (!currentApp || !currentApp.settingsView) return;
  window.api.send('slots:open-app-settings', currentApp.settingsView);
  window.close();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
});

render();
