const COLORS = ['green', 'orange', 'pink', 'brown', 'rnbw', 'blue'];
const SWATCH = {
  green: '#5fb85f',
  orange: '#e8973c',
  pink: '#e87fb0',
  brown: '#9c6b43',
  rnbw: 'linear-gradient(135deg,#e85a5a,#e8c85a,#5fb85f,#5a8fe8)',
  blue: '#5a8fe8'
};

const destEl = document.getElementById('dest');
const colorsEl = document.getElementById('colors');
const intervalEl = document.getElementById('interval');
const opacityEl = document.getElementById('opacity');
const opacityValEl = document.getElementById('opacityVal');
const autoEl = document.getElementById('autolaunch');
const autoPushEl = document.getElementById('autopush');
const autoPushHintEl = document.getElementById('autopush-hint');
const statusEl = document.getElementById('status');

let state = {};

function flash(msg) {
  statusEl.textContent = msg;
  clearTimeout(flash._t);
  flash._t = setTimeout(() => (statusEl.textContent = ''), 1600);
}

function renderColors() {
  colorsEl.innerHTML = '';
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch' + (state.color === c ? ' sel' : '');
    b.style.background = SWATCH[c];
    b.title = c;
    b.addEventListener('click', async () => {
      state = await window.api.invoke('settings:set', { color: c });
      renderColors();
      flash('Color updated');
    });
    colorsEl.appendChild(b);
  }
}

async function refreshAutoPush() {
  autoPushEl.checked = !!state.autoPush;
  const isRepo = await window.api.invoke('settings:is-git-repo');
  const row = autoPushEl.closest('.field');
  autoPushEl.disabled = !isRepo;
  if (row) row.classList.toggle('disabled', !isRepo);
  autoPushHintEl.textContent = isRepo
    ? 'Commits & pushes after each note.'
    : 'Destination folder is not a git repo.';
}

async function load() {
  state = await window.api.invoke('settings:get');
  destEl.textContent = state.destFolder;
  destEl.title = state.destFolder;
  intervalEl.value = state.intervalMinutes;
  const op = typeof state.opacity === 'number' ? state.opacity : 1;
  opacityEl.value = op;
  opacityValEl.textContent = Math.round(op * 100) + '%';
  autoEl.checked = !!state.autoLaunch;
  renderColors();
  refreshAutoPush();
}

document.getElementById('pick').addEventListener('click', async () => {
  const res = await window.api.invoke('settings:pick-folder');
  if (res && !res.canceled) {
    state = await window.api.invoke('settings:set', { destFolder: res.path });
    destEl.textContent = state.destFolder;
    destEl.title = state.destFolder;
    refreshAutoPush();
    flash('Folder updated');
  }
});

intervalEl.addEventListener('change', async () => {
  let v = parseInt(intervalEl.value, 10);
  if (!Number.isFinite(v) || v < 1) v = 1;
  if (v > 720) v = 720;
  intervalEl.value = v;
  state = await window.api.invoke('settings:set', { intervalMinutes: v });
  flash('Interval updated');
});

opacityEl.addEventListener('input', () => {
  opacityValEl.textContent = Math.round(Number(opacityEl.value) * 100) + '%';
});
opacityEl.addEventListener('change', async () => {
  state = await window.api.invoke('settings:set', { opacity: Number(opacityEl.value) });
  flash('Transparency updated');
});

autoEl.addEventListener('change', async () => {
  state = await window.api.invoke('settings:set', { autoLaunch: autoEl.checked });
  flash('Saved');
});

autoPushEl.addEventListener('change', async () => {
  state = await window.api.invoke('settings:set', { autoPush: autoPushEl.checked });
  flash('Saved');
});

document.getElementById('test').addEventListener('click', () => {
  window.api.send('pet:test-jump');
});

document.getElementById('close').addEventListener('click', () => window.close());
document.getElementById('quit').addEventListener('click', () => window.api.send('app:quit'));

load();
