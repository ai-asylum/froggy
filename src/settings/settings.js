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
const scaleEl = document.getElementById('scale');
const scaleValEl = document.getElementById('scaleVal');
const autoEl = document.getElementById('autolaunch');
const autoPushEl = document.getElementById('autopush');
const autoPushHintEl = document.getElementById('autopush-hint');
const frogButtonEl = document.getElementById('frogbutton');
const statusEl = document.getElementById('status');

let state = {};

function flash(msg) {
  statusEl.textContent = msg;
  clearTimeout(flash._t);
  flash._t = setTimeout(() => (statusEl.textContent = ''), 1600);
}

// --- View navigation (with a small back stack) -----------------------------
const TITLES = {
  main: 'Froggy settings',
  apps: 'Applications',
  appearance: 'Appearance',
  friends: 'Manage friends',
  'app-journal': 'Micro journal',
  'app-shout': 'Shout',
  'app-pomodoro': 'Pomodoro',
  'app-countdown': 'Countdown',
  'app-water': 'Drink water'
};
const titleEl = document.getElementById('title');
const backEl = document.getElementById('back');
let stack = ['main'];

function showView(name, { push = true } = {}) {
  const id = `view-${name}`;
  if (!document.getElementById(id)) return;
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== id;
  titleEl.textContent = TITLES[name] || 'Froggy settings';
  if (push) stack.push(name);
  backEl.hidden = stack.length <= 1;
  document.getElementById('scroll').scrollTop = 0;
  if (name === 'apps') loadApps();
  if (name === 'friends') loadFriends();
  if (name === 'app-pomodoro') loadPomodoro();
  if (name === 'app-countdown') loadCountdown();
  if (name === 'app-water') loadWater();
}

function goBack() {
  if (stack.length <= 1) return;
  stack.pop();
  showView(stack[stack.length - 1], { push: false });
}

document.querySelectorAll('.nav[data-goto]').forEach((b) => {
  b.addEventListener('click', () => showView(b.dataset.goto));
});
backEl.addEventListener('click', goBack);

// Jump to a view when opened from the frog (e.g. the + button -> Applications).
window.api.on('settings:navigate', (view) => {
  stack = ['main'];
  showView(view);
});

// --- Applications ----------------------------------------------------------
const appGridEl = document.getElementById('appgrid');
let appsLoaded = false;

async function loadApps() {
  if (appsLoaded) return;
  appsLoaded = true;
  const list = await window.api.invoke('apps:list');
  appGridEl.innerHTML = '';
  for (const app of list || []) {
    if (app.settingsView) TITLES[`app-${app.settingsView}`] = app.name;

    const tile = document.createElement('button');
    tile.className = 'apptile';
    tile.disabled = !app.settingsView;

    const icon = document.createElement('span');
    icon.className = 'appicon';
    icon.style.background = app.color || '#4caf50';
    icon.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">${app.icon || ''}</svg>`;

    const meta = document.createElement('span');
    meta.className = 'appmeta';
    const name = document.createElement('span');
    name.className = 'appname';
    name.textContent = app.name;
    const status = document.createElement('span');
    status.className = 'appstatus';
    status.textContent = app.installed ? 'installed' : 'not installed';
    meta.append(name, status);

    tile.append(icon, meta);
    if (app.settingsView) {
      tile.addEventListener('click', () => showView(`app-${app.settingsView}`));
    }
    appGridEl.appendChild(tile);
  }
}

// --- Appearance: skin ------------------------------------------------------
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
      flash('Skin updated');
    });
    colorsEl.appendChild(b);
  }
}

// --- Micro journal: settings -----------------------------------------------
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

  const sc = typeof state.scale === 'number' ? state.scale : 1;
  scaleEl.value = sc;
  scaleValEl.textContent = Math.round(sc * 100) + '%';

  autoEl.checked = !!state.autoLaunch;
  frogButtonEl.checked = state.frogButton !== false;
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

scaleEl.addEventListener('input', () => {
  scaleValEl.textContent = Math.round(Number(scaleEl.value) * 100) + '%';
});
scaleEl.addEventListener('change', async () => {
  state = await window.api.invoke('settings:set', { scale: Number(scaleEl.value) });
  flash('Size updated');
});

autoEl.addEventListener('change', async () => {
  state = await window.api.invoke('settings:set', { autoLaunch: autoEl.checked });
  flash('Saved');
});

autoPushEl.addEventListener('change', async () => {
  state = await window.api.invoke('settings:set', { autoPush: autoPushEl.checked });
  flash('Saved');
});

frogButtonEl.addEventListener('change', async () => {
  state = await window.api.invoke('settings:set', { frogButton: frogButtonEl.checked });
  flash('Saved');
});

document.getElementById('test').addEventListener('click', () => {
  window.api.send('pet:test-jump');
});

document.getElementById('close').addEventListener('click', () => window.close());
document.getElementById('quit').addEventListener('click', () => window.api.send('app:quit'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (stack.length > 1) goBack();
    else window.close();
  }
});

// --- Friends (embedded panel) ----------------------------------------------
const selfCodeEl = document.getElementById('selfcode');
const friendsEl = document.getElementById('friends');
const requestsEl = document.getElementById('requests');
const friendCodeEl = document.getElementById('friendcode');
const displayNameEl = document.getElementById('displayname');
const netStatusEl = document.getElementById('netstatus');

function makeFriendRow(f) {
  const row = document.createElement('div');
  row.className = 'friend';
  row.dataset.id = f.id;

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = f.label || 'Friend';

  const id = document.createElement('span');
  id.className = 'id';
  id.textContent = f.id;
  id.title = f.id;

  row.append(name, id);
  return row;
}

function renderFriends(friends) {
  const incoming = friends.filter((f) => f.status === 'incoming');
  const others = friends.filter((f) => f.status !== 'incoming');

  requestsEl.innerHTML = '';
  for (const f of incoming) {
    const row = makeFriendRow(f);
    const accept = document.createElement('button');
    accept.className = 'accept';
    accept.textContent = 'Accept';
    accept.addEventListener('click', () => window.api.invoke('friends:accept', { id: f.id }));
    const decline = document.createElement('button');
    decline.className = 'rm';
    decline.textContent = 'Decline';
    decline.addEventListener('click', () => window.api.invoke('friends:decline', { id: f.id }));
    row.append(accept, decline);
    requestsEl.appendChild(row);
  }

  friendsEl.innerHTML = '';
  for (const f of others) {
    const row = makeFriendRow(f);
    if (f.status === 'accepted') {
      const dot = document.createElement('span');
      dot.className = 'dot' + (f.online ? ' online' : '');
      row.prepend(dot);
    } else if (f.status === 'pending') {
      const tag = document.createElement('span');
      tag.className = 'pendtag';
      tag.textContent = 'pending';
      row.append(tag);
    }
    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.textContent = f.status === 'pending' ? 'Cancel' : 'Remove';
    rm.addEventListener('click', () => window.api.invoke('friends:remove', { id: f.id }));
    row.append(rm);
    friendsEl.appendChild(row);
  }
}

async function loadFriends() {
  const { selfId, friends } = await window.api.invoke('friends:list');
  selfCodeEl.textContent = selfId || '(generating...)';
  selfCodeEl.title = selfId || '';
  renderFriends(friends || []);
  displayNameEl.value = state.displayName || '';

  const s = await window.api.invoke('net:status');
  if (s && s.configured) {
    netStatusEl.textContent = 'Connected. Invites and messages will be delivered.';
    netStatusEl.className = 'netstatus on';
  } else {
    netStatusEl.textContent = 'Offline: multiplayer is not connected.';
    netStatusEl.className = 'netstatus off';
  }
}

document.getElementById('copycode').addEventListener('click', async () => {
  const code = selfCodeEl.textContent.trim();
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    flash('Code copied');
  } catch {
    flash('Copy failed');
  }
});

document.getElementById('addfriend').addEventListener('click', async () => {
  const code = friendCodeEl.value.trim();
  if (!code) {
    friendCodeEl.focus();
    return;
  }
  const res = await window.api.invoke('friends:add', { code });
  if (res && res.ok) {
    friendCodeEl.value = '';
    flash('Invite sent');
  } else {
    flash((res && res.error) || 'Could not send');
  }
});

displayNameEl.addEventListener('change', async () => {
  state = await window.api.invoke('settings:set', { displayName: displayNameEl.value.trim() });
});

window.api.on('friends:changed', ({ friends }) => renderFriends(friends || []));
window.api.on('friends:presence', ({ id, online }) => {
  const dot = friendsEl.querySelector(`.friend[data-id="${CSS.escape(id)}"] .dot`);
  if (dot) dot.classList.toggle('online', !!online);
});

// --- Pomodoro (app) --------------------------------------------------------
// The timer itself is driven from the frog (click the Pomodoro slot to start /
// stop; tap the frog to advance a finished phase). This screen only configures
// the focus and break lengths.
const pomoWorkEl = document.getElementById('pomo-work');
const pomoBreakEl = document.getElementById('pomo-break');

function loadPomodoro() {
  const p = state.pomodoro || {};
  pomoWorkEl.value = Math.max(1, Number(p.workMinutes) || 25);
  pomoBreakEl.value = Math.max(1, Number(p.breakMinutes) || 5);
}

async function savePomodoro() {
  let w = parseInt(pomoWorkEl.value, 10);
  let b = parseInt(pomoBreakEl.value, 10);
  if (!Number.isFinite(w) || w < 1) w = 1;
  if (w > 180) w = 180;
  if (!Number.isFinite(b) || b < 1) b = 1;
  if (b > 60) b = 60;
  pomoWorkEl.value = w;
  pomoBreakEl.value = b;
  state = await window.api.invoke('settings:set', {
    pomodoro: { workMinutes: w, breakMinutes: b }
  });
  flash('Pomodoro updated');
}
pomoWorkEl.addEventListener('change', savePomodoro);
pomoBreakEl.addEventListener('change', savePomodoro);

// --- Countdown (app) -------------------------------------------------------
// Click the Countdown slot to start / cancel; the message dialog pops when it
// ends. This screen sets the duration and that message.
const countdownMinsEl = document.getElementById('countdown-minutes');
const countdownMsgEl = document.getElementById('countdown-message');

function loadCountdown() {
  const c = state.countdown || {};
  countdownMinsEl.value = Math.max(1, Number(c.minutes) || 10);
  countdownMsgEl.value = c.message || '';
}

async function saveCountdown() {
  let mins = parseInt(countdownMinsEl.value, 10);
  if (!Number.isFinite(mins) || mins < 1) mins = 1;
  if (mins > 600) mins = 600;
  countdownMinsEl.value = mins;
  const message = countdownMsgEl.value.trim() || 'Time\u2019s up!';
  state = await window.api.invoke('settings:set', {
    countdown: { minutes: mins, message }
  });
  flash('Countdown updated');
}
countdownMinsEl.addEventListener('change', saveCountdown);
countdownMsgEl.addEventListener('change', saveCountdown);

document.getElementById('countdown-test').addEventListener('click', async () => {
  await saveCountdown();
  await window.api.invoke('countdown:test');
});

// --- Drink water (app) -----------------------------------------------------
const waterIntervalEl = document.getElementById('water-interval');
const waterMessageEl = document.getElementById('water-message');

function loadWater() {
  const w = state.water || {};
  waterIntervalEl.value = Number(w.intervalMinutes) || 60;
  waterMessageEl.value = w.message || '';
}

async function saveWater() {
  let mins = parseInt(waterIntervalEl.value, 10);
  if (!Number.isFinite(mins) || mins < 1) mins = 1;
  if (mins > 720) mins = 720;
  waterIntervalEl.value = mins;
  const message = waterMessageEl.value.trim() || 'Time to drink some water!';
  state = await window.api.invoke('settings:set', {
    water: { intervalMinutes: mins, message }
  });
  flash('Reminder updated');
}
waterIntervalEl.addEventListener('change', saveWater);
waterMessageEl.addEventListener('change', saveWater);

document.getElementById('water-test').addEventListener('click', async () => {
  await saveWater();
  await window.api.invoke('water:test');
});

// --- Shout (app) -----------------------------------------------------------
document.getElementById('shout-test').addEventListener('click', () => {
  window.api.invoke('shout:test');
});

load();
