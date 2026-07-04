// The slot picker popover. Opened by clicking an empty slot on the frog, or by
// long-pressing any slot. It lists every installed app so you can drop one into
// the slot or clear it. Right-clicking an app row jumps straight to that app's
// settings screen (for apps that have one). Closes on blur (handled in main),
// and after any choice.

const params = new URLSearchParams(location.search);
const slotIndex = Number(params.get('index') || 0);

const listEl = document.getElementById('list');
const hintEl = document.getElementById('hint');
const titleEl = document.getElementById('title');

// Open an app's settings screen from a right-click, then dismiss the picker.
function openAppSettings(app) {
  if (!app || !app.settingsView) return;
  window.api.send('slots:open-app-settings', app.settingsView);
  window.close();
}

function iconTile(app) {
  const icon = document.createElement('span');
  icon.className = 'appicon';
  icon.style.background = app.color || '#4caf50';
  icon.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${app.icon || ''}</svg>`;
  return icon;
}

async function render() {
  const { slots, apps } = await window.api.invoke('slots:context');
  const currentId = slots[slotIndex] || null;
  titleEl.textContent = currentId ? 'Change slot app' : 'Add an app to this slot';

  const installed = (apps || []).filter((a) => a.installed);

  listEl.innerHTML = '';
  for (const app of installed) {
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
    } else if (otherSlot !== -1) {
      const badge = document.createElement('span');
      badge.className = 'onfrog';
      badge.textContent = 'on frog';
      row.append(badge);
    }

    const removeHint = app.id === currentId ? 'Click to remove from slot' : 'Click to add to slot';
    row.title = app.settingsView ? `${removeHint} \u00b7 right-click for settings` : removeHint;

    // Clicking the current app clears the slot; any other app fills it.
    row.addEventListener('click', () => choose(app.id === currentId ? null : app.id));
    // Right-click opens the app's own settings screen (if it has one).
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openAppSettings(app);
    });
    listEl.appendChild(row);
  }

  // Show the right-click hint only when at least one listed app has settings.
  hintEl.hidden = !installed.some((a) => a.settingsView);
}

function choose(appId) {
  window.api.invoke('slots:set', { index: slotIndex, appId }).then(() => window.close());
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
});

render();
