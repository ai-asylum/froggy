const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  dialog,
  Tray,
  Menu,
  nativeImage,
  Notification
} = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const notes = require('./notes');
const gitSync = require('./git');
const signaling = require('./net/signaling');

const COLORS = ['green', 'orange', 'pink', 'brown', 'rnbw', 'blue'];

function spriteDataUrl(color) {
  const safe = COLORS.includes(color) ? color : 'green';
  const file = path.join(__dirname, '..', 'assets', `froggy-${safe}.png`);
  const b64 = fs.readFileSync(file).toString('base64');
  return `data:image/png;base64,${b64}`;
}

// Commit + push new notes in the background when auto-push is enabled.
// Failures are logged but never block or surface an error to note saving.
function maybeAutoPush(destFolder) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  gitSync
    .commitAndPush(destFolder, `microblog: ${stamp}`)
    .then((res) => {
      if (!res.ok) console.error('Auto-push failed:', res.error);
    })
    .catch((err) => console.error('Auto-push error:', err.message));
}

// Pet window footprint. The sprite is drawn inside this with headroom for jumps
// and the semi-circle of action buttons above the frog.
const PET_W = 160;
const PET_H = 150;
const MARGIN = 24; // gap from screen edge on first launch

let petWin = null;
let inputWin = null;
let settingsWin = null;
let tray = null;

// --- Multiplayer state -----------------------------------------------------
const REMOTE_W = 120;
const REMOTE_H = 176; // frog (112) + headroom for the speech bubble
let netWin = null; // hidden helper renderer hosting the WebRTC mesh
let messageWin = null; // the "speak to this friend" DM composer
let nameWin = null; // first-run "name your frog" popup
let friendsWin = null; // the friends panel
let shoutWin = null; // the "shout to everyone" composer
const remoteWins = new Map(); // friendId -> BrowserWindow (a friend's frog)
const presence = new Map(); // friendId -> boolean (Supabase presence)
const connected = new Set(); // friendIds with an open P2P data channel

let lastHopAt = 0;
let currentDisplayId = null;
let hourlyTimer = null;
let lastActivity = Date.now();
let sleeping = false;
let sleepCheckTimer = null;
const SLEEP_MS = 5 * 60 * 1000; // doze off after 5 minutes with no activity
let snoozeTimer = null;
let attentionActive = false;

// ---------------------------------------------------------------------------
// Pet window
// ---------------------------------------------------------------------------
function createPetWindow() {
  const cfg = config.load();
  const primary = screen.getPrimaryDisplay();
  const wa = primary.workArea;

  // Default: top-right corner. Otherwise restore saved position (clamped).
  let x = wa.x + wa.width - PET_W - MARGIN;
  let y = wa.y + MARGIN;
  if (cfg.position && Number.isFinite(cfg.position.x) && Number.isFinite(cfg.position.y)) {
    x = Math.max(wa.x, Math.min(cfg.position.x, wa.x + wa.width - PET_W));
    y = Math.max(wa.y, Math.min(cfg.position.y, wa.y + wa.height - PET_H));
  }

  petWin = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000', // fully transparent; avoids white flash across displays
    resizable: false,
    movable: false, // we move it manually so we can tell clicks from drags
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    focusable: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Float above almost everything, including full-screen apps and other spaces.
  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreenScreen: true });

  // Track which display the pet is on so we can force a repaint when it crosses
  // to another monitor (macOS drops transparency otherwise -> white background).
  currentDisplayId = screen.getDisplayNearestPoint({ x: x + PET_W / 2, y: y + PET_H / 2 }).id;

  // Start click-through; the renderer toggles this off when the cursor is over
  // an opaque frog pixel (pixel-perfect hit testing).
  petWin.setIgnoreMouseEvents(true, { forward: true });

  petWin.setOpacity(typeof cfg.opacity === 'number' ? cfg.opacity : 1);

  petWin.loadFile(path.join(__dirname, 'pet', 'index.html'));

  petWin.on('closed', () => {
    petWin = null;
  });
}

function petUrl() {
  return petWin ? petWin.getBounds() : null;
}

// ---------------------------------------------------------------------------
// Input popup (write an entry)
// ---------------------------------------------------------------------------
function openInputWindow() {
  // While you're writing, the frog stops reacting and rests.
  if (petWin) petWin.webContents.send('anim:idle');
  if (inputWin) {
    inputWin.show();
    inputWin.focus();
    return;
  }
  const b = petUrl();
  const W = 320;
  const H = 168;
  // Anchor to the display the frog is on (not always the primary one).
  const primary = (b
    ? screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
    : screen.getPrimaryDisplay()
  ).workArea;
  let x = primary.x + primary.width - W - MARGIN;
  let y = primary.y + MARGIN + PET_H;
  if (b) {
    // Prefer to sit just below the frog, nudged so it stays on screen.
    x = Math.min(Math.max(b.x + b.width / 2 - W / 2, primary.x), primary.x + primary.width - W);
    y = b.y + b.height - 10;
    if (y + H > primary.y + primary.height) y = b.y - H + 10; // flip above if no room
  }

  inputWin = new BrowserWindow({
    width: W,
    height: H,
    x: Math.round(x),
    y: Math.round(y),
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  inputWin.setAlwaysOnTop(true, 'screen-saver');
  inputWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreenScreen: true });
  inputWin.loadFile(path.join(__dirname, 'input', 'index.html'));
  inputWin.once('ready-to-show', () => {
    inputWin.webContents.send('input:init', { attention: attentionActive });
  });
  inputWin.on('closed', () => {
    inputWin = null;
  });
}

function closeInputWindow() {
  if (inputWin) inputWin.close();
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function openSettingsWindow() {
  if (settingsWin) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  const W = 380;
  const H = 560;
  // Center on whichever display the frog is currently on.
  const b = petUrl();
  const area = b
    ? screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea
    : screen.getPrimaryDisplay().workArea;
  settingsWin = new BrowserWindow({
    width: W,
    height: H,
    minWidth: 340,
    minHeight: 320,
    x: Math.round(area.x + (area.width - W) / 2),
    y: Math.round(area.y + (area.height - H) / 2),
    frame: false,
    transparent: true,
    resizable: true,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWin.setAlwaysOnTop(true, 'screen-saver');
  settingsWin.loadFile(path.join(__dirname, 'settings', 'index.html'));
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

// ---------------------------------------------------------------------------
// Tray (the only always-available handle to quit / act)
// ---------------------------------------------------------------------------
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Froggy micro-blog');
  const menu = Menu.buildFromTemplate([
    { label: 'Write an entry...', click: () => openInputWindow() },
    { label: 'Make it jump', click: () => bigJump() },
    { type: 'separator' },
    { label: 'Settings...', click: () => openSettingsWindow() },
    { type: 'separator' },
    { label: 'Quit Froggy', click: () => quitApp() }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => openInputWindow());
}

let quitting = false;
function quitApp() {
  quitting = true;
  app.quit();
}

// ---------------------------------------------------------------------------
// Hourly attention loop
// ---------------------------------------------------------------------------
function msUntilNextInterval(intervalMinutes) {
  const now = new Date();
  if (intervalMinutes >= 60 && intervalMinutes % 60 === 0) {
    // Align to the top of the hour.
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(now.getHours() + intervalMinutes / 60);
    return next.getTime() - now.getTime();
  }
  // Otherwise a rolling interval from now.
  return intervalMinutes * 60 * 1000;
}

function scheduleHourly() {
  if (hourlyTimer) clearTimeout(hourlyTimer);
  const cfg = config.load();
  const delay = msUntilNextInterval(cfg.intervalMinutes);
  hourlyTimer = setTimeout(() => {
    startAttention();
    scheduleHourly();
  }, delay);
}

// Grab attention with a jump, then bring up the panel once it lands (opening
// the panel settles the frog back to idle).
function nag() {
  if (inputWin) {
    inputWin.show();
    inputWin.focus();
    return;
  }
  bigJump();
  setTimeout(() => {
    if (attentionActive) openInputWindow();
  }, 850);
}

function startAttention() {
  attentionActive = true;
  sleeping = false; // an attention jump wakes the frog
  nag();
  if (snoozeTimer) clearInterval(snoozeTimer);
  // Keep nagging every 4 minutes until an entry is written or skipped, but
  // don't jump while the panel is already open and waiting.
  snoozeTimer = setInterval(() => {
    if (!attentionActive || inputWin) return;
    nag();
  }, 4 * 60 * 1000);
}

function stopAttention() {
  attentionActive = false;
  if (snoozeTimer) {
    clearInterval(snoozeTimer);
    snoozeTimer = null;
  }
  if (petWin) petWin.webContents.send('attention:stop');
}

function bigJump() {
  if (petWin) petWin.webContents.send('anim:jump');
}

// Any user activity resets the snooze timer and wakes the frog if it dozed off.
function markActivity() {
  lastActivity = Date.now();
  if (sleeping) {
    sleeping = false;
    if (petWin) petWin.webContents.send('anim:wake');
  }
}

function startSleepWatch() {
  if (sleepCheckTimer) clearInterval(sleepCheckTimer);
  sleepCheckTimer = setInterval(() => {
    if (sleeping || inputWin || attentionActive) return;
    if (Date.now() - lastActivity >= SLEEP_MS) {
      sleeping = true;
      if (petWin) petWin.webContents.send('anim:sleep');
    }
  }, 15 * 1000);
}

// macOS can drop a transparent window's alpha when it moves to another display.
// A 1px resize round-trip forces the compositor to redraw it transparent again.
function refreshTransparency() {
  if (!petWin) return;
  const [w, h] = petWin.getSize();
  petWin.setSize(w, h + 1);
  petWin.setSize(w, h);
}

// ---------------------------------------------------------------------------
// Multiplayer: signaling (Supabase) + WebRTC mesh (hidden renderer) + friends
// ---------------------------------------------------------------------------
function friendLabel(id) {
  const cfg = config.load();
  const f = (cfg.friends || []).find((x) => x.id === id);
  return (f && f.label) || 'Friend';
}

function selfName() {
  const cfg = config.load();
  return (cfg.displayName || cfg.author || 'A froggy friend').trim();
}

function acceptedIds() {
  const cfg = config.load();
  return (cfg.friends || []).filter((f) => f.status === 'accepted').map((f) => f.id);
}

// Push the current friends + requests snapshot to any open friend UI.
function pushFriends() {
  const cfg = config.load();
  const friends = (cfg.friends || []).map((f) => ({ ...f, online: connected.has(f.id) }));
  const payload = { selfId: cfg.selfId, friends };
  if (settingsWin) settingsWin.webContents.send('friends:changed', payload);
  if (friendsWin) friendsWin.webContents.send('friends:changed', payload);
}

// A friend's P2P link opened or closed: flip their frog (away <-> alive), update
// the online dot in the friends panel, and keep the connected set in sync.
function setConnected(friendId, isConnected) {
  if (isConnected) connected.add(friendId);
  else connected.delete(friendId);
  const w = remoteWins.get(friendId);
  if (w && !w.isDestroyed()) w.webContents.send('peer:presence', { online: isConnected });
  const payload = { id: friendId, online: isConnected };
  if (settingsWin) settingsWin.webContents.send('friends:presence', payload);
  if (friendsWin) friendsWin.webContents.send('friends:presence', payload);
}

function notify(title, body) {
  try {
    new Notification({ title, body }).show();
  } catch {}
}

// STUN is always available; TURN is added only when configured (fallback for
// peers that can't connect directly).
function buildIceServers() {
  const cfg = config.load();
  const servers = [{ urls: 'stun:stun.l.google.com:19302' }];
  const t = cfg.turn || {};
  if (t.urls) {
    servers.push({
      urls: t.urls,
      username: t.username || undefined,
      credential: t.credential || undefined
    });
  }
  return servers;
}

function createNetWindow() {
  if (netWin) return;
  netWin = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  netWin.loadFile(path.join(__dirname, 'net', 'index.html'));
  netWin.webContents.on('did-finish-load', () => {
    if (netWin) netWin.webContents.send('mesh:config', { iceServers: buildIceServers() });
  });
  netWin.on('closed', () => {
    netWin = null;
  });
}

function startNetworking() {
  const cfg = config.load();
  if (!signaling.isConfigured(cfg)) return; // stays single-player until set up
  createNetWindow();
  signaling.start(
    cfg,
    {
      onPresence: (friendId, online) => {
        presence.set(friendId, online);
        if (netWin) {
          netWin.webContents.send('mesh:peer-present', {
            friendId,
            online,
            initiator: String(cfg.selfId) < String(friendId)
          });
        }
        // Their frog stays on screen (turned away) even when offline; the P2P
        // data channel opening/closing is what flips it back to life.
        if (!online) setConnected(friendId, false);
      },
      onSignal: (friendId, kind, data) => {
        if (netWin) netWin.webContents.send('mesh:signal-in', { friendId, kind, data });
      },
      onFriendRequest: (fromId, fromName) => handleIncomingRequest(fromId, fromName),
      onFriendAccept: (fromId, fromName) => handleFriendAccepted(fromId, fromName),
      onFriendRemove: (fromId) => handleFriendRemoved(fromId)
    },
    acceptedIds()
  );

  // Show every accepted friend right away — turned away until their P2P link opens.
  for (const id of acceptedIds()) spawnRemoteFrog(id);

  // Invite broadcasts are ephemeral, so a request sent while the other frog was
  // offline (or before Supabase was configured) never arrived. Re-send any still
  // pending outgoing invites once we're connected.
  const pending = (cfg.friends || []).filter((f) => f.status === 'pending');
  if (pending.length) {
    setTimeout(() => {
      for (const f of pending) signaling.sendRequest(f.id, selfName());
    }, 2500);
  }
}

// Someone invited me. The frog does a little dance and the invite pops up in
// its own window. If I'd already invited *them* (mutual), we just become friends.
function handleIncomingRequest(fromId, fromName) {
  const cfg = config.load();
  const friends = [...(cfg.friends || [])];
  const existing = friends.find((f) => f.id === fromId);
  if (existing && existing.status === 'accepted') return;

  // Mutual invite: we both asked → link up immediately, no manual accept needed.
  if (existing && existing.status === 'pending') {
    existing.status = 'accepted';
    if (fromName && (!existing.label || existing.label === 'Friend')) existing.label = fromName;
    config.save({ friends });
    signaling.sendAccept(fromId, selfName());
    signaling.addPair(fromId);
    spawnRemoteFrog(fromId);
    danceLocal();
    notify('Friend added', `${existing.label || fromName || 'Your friend'} — say hi!`);
    pushFriends();
    return;
  }

  if (!existing) {
    friends.push({ id: fromId, label: fromName || 'Friend', status: 'incoming' });
    config.save({ friends });
  } else if (fromName && !existing.label) {
    existing.label = fromName;
    config.save({ friends });
  }

  // No modal — the frog dances for attention; clicking it opens the friends
  // panel (see the pet:click handler) where the invite can be accepted.
  danceLocal();
  notify('Friend invite', `${fromName || 'Someone'} (${fromId}) wants to be friends.`);
}

// They accepted my request → mutual. Their frog appears when they're online.
function handleFriendAccepted(fromId, fromName) {
  const cfg = config.load();
  const friends = [...(cfg.friends || [])];
  const existing = friends.find((f) => f.id === fromId);
  if (!existing) return;
  existing.status = 'accepted';
  if ((!existing.label || existing.label === 'Friend') && fromName) existing.label = fromName;
  config.save({ friends });
  signaling.addPair(fromId);
  spawnRemoteFrog(fromId);
  notify('Friend added', `${existing.label || 'Your friend'} accepted — say hi!`);
  pushFriends();
}

// They removed me (or declined) → break the link and remove their frog.
function handleFriendRemoved(fromId) {
  const cfg = config.load();
  config.save({ friends: (cfg.friends || []).filter((f) => f.id !== fromId) });
  signaling.removePair(fromId);
  despawnRemoteFrog(fromId);
  presence.delete(fromId);
  connected.delete(fromId);
  pushFriends();
}

// Local-initiated removal: break the link and tell the other side to drop me.
function removeFriendLocally(id) {
  const cfg = config.load();
  config.save({ friends: (cfg.friends || []).filter((f) => f.id !== id) });
  signaling.sendRemove(id);
  signaling.removePair(id);
  despawnRemoteFrog(id);
  presence.delete(id);
  connected.delete(id);
  pushFriends();
}

function restartNetworking() {
  try {
    signaling.stop();
  } catch {}
  for (const id of [...remoteWins.keys()]) despawnRemoteFrog(id);
  presence.clear();
  connected.clear();
  if (netWin) {
    netWin.close();
    netWin = null;
  }
  startNetworking();
}

// Keep a remote frog on the same display as your own, clamped on screen.
function clampToWorkArea(x, y, w, h) {
  const area = screen.getDisplayNearestPoint({ x, y }).workArea;
  return {
    x: Math.max(area.x, Math.min(x, area.x + area.width - w)),
    y: Math.max(area.y, Math.min(y, area.y + area.height - h))
  };
}

function spawnRemoteFrog(friendId) {
  if (remoteWins.has(friendId)) return remoteWins.get(friendId);
  const cfg = config.load();
  const label = friendLabel(friendId);

  const saved = (cfg.remotePositions || {})[friendId];
  let x;
  let y;
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    ({ x, y } = clampToWorkArea(saved.x, saved.y, REMOTE_W, REMOTE_H));
  } else {
    const b = petUrl();
    const baseX = b ? b.x : 100;
    const baseY = b ? b.y : 100;
    const i = remoteWins.size;
    ({ x, y } = clampToWorkArea(baseX - 140 - i * 130, baseY, REMOTE_W, REMOTE_H));
  }

  const win = new BrowserWindow({
    width: REMOTE_W,
    height: REMOTE_H,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    focusable: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreenScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setOpacity(typeof cfg.opacity === 'number' ? cfg.opacity : 1);
  win.loadFile(path.join(__dirname, 'pet', 'remote.html'), {
    query: { id: friendId, label }
  });
  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed()) win.webContents.send('peer:presence', { online: connected.has(friendId) });
  });
  win.on('closed', () => remoteWins.delete(friendId));
  remoteWins.set(friendId, win);
  return win;
}

function despawnRemoteFrog(friendId) {
  const w = remoteWins.get(friendId);
  if (w) {
    try {
      w.close();
    } catch {}
  }
  remoteWins.delete(friendId);
}

// A packet arrived from a peer over their data channel: either an animation
// beat (replayed on their frog) or a chat message (bubble + notification).
function handlePeerData(friendId, msg) {
  if (!msg || !msg.type) return;

  // A DM: persistent bubble with a close X on this friend's frog.
  if (msg.type === 'message') {
    const text = String(msg.text || '').slice(0, 500);
    sendToRemote(friendId, 'msg:show', { text });
    try {
      new Notification({ title: `${friendLabel(friendId)} says`, body: text }).show();
    } catch {}
    return;
  }

  // A shout: red, all-caps bubble that auto-hides.
  if (msg.type === 'shout') {
    const text = String(msg.text || '').slice(0, 200).toUpperCase();
    sendToRemote(friendId, 'shout:show', { text });
    try {
      new Notification({ title: `${friendLabel(friendId)} shouts`, body: text }).show();
    } catch {}
    return;
  }

  const w = remoteWins.get(friendId);
  if (w) w.webContents.send('peer:event', msg);
}

// Send an event to a friend's frog window, spawning/awaiting it as needed.
function sendToRemote(friendId, channel, payload) {
  let w = remoteWins.get(friendId);
  if (!w) w = spawnRemoteFrog(friendId);
  if (!w) return;
  if (w.webContents.isLoading()) {
    w.webContents.once('did-finish-load', () => {
      if (!w.isDestroyed()) w.webContents.send(channel, payload);
    });
  } else {
    w.webContents.send(channel, payload);
  }
}

// The local frog does a happy little dance (a few hops).
function danceLocal() {
  markActivity();
  if (petWin) petWin.webContents.send('anim:dance');
}

// First-run popup that asks the user to name their frog (sets displayName).
function openNameWindow() {
  if (nameWin) {
    nameWin.show();
    nameWin.focus();
    return;
  }
  const W = 300;
  const H = 190;
  const area = screen.getPrimaryDisplay().workArea;
  nameWin = new BrowserWindow({
    width: W,
    height: H,
    x: Math.round(area.x + (area.width - W) / 2),
    y: Math.round(area.y + (area.height - H) / 2),
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  nameWin.setAlwaysOnTop(true, 'screen-saver');
  nameWin.loadFile(path.join(__dirname, 'name', 'index.html'));
  nameWin.on('closed', () => {
    nameWin = null;
  });
}

function openMessageWindow(friendId) {
  const label = friendLabel(friendId);
  if (messageWin) {
    messageWin.close();
    messageWin = null;
  }
  const W = 240;
  const H = 132;
  const rw = remoteWins.get(friendId);
  let x;
  let y;
  if (rw) {
    const b = rw.getBounds();
    ({ x, y } = clampToWorkArea(b.x, b.y - H + 24, W, H));
  } else {
    const area = screen.getPrimaryDisplay().workArea;
    x = Math.round(area.x + (area.width - W) / 2);
    y = Math.round(area.y + (area.height - H) / 2);
  }
  messageWin = new BrowserWindow({
    width: W,
    height: H,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  messageWin.setAlwaysOnTop(true, 'screen-saver');
  messageWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreenScreen: true });
  messageWin.loadFile(path.join(__dirname, 'message', 'index.html'), {
    query: { id: friendId, label }
  });
  messageWin.on('blur', () => {
    if (messageWin) messageWin.close();
  });
  messageWin.on('closed', () => {
    messageWin = null;
  });
}

// The friends panel (opened by the left button over the frog).
function openFriendsWindow() {
  if (friendsWin) {
    friendsWin.show();
    friendsWin.focus();
    return;
  }
  const W = 340;
  const H = 460;
  const b = petUrl();
  const area = b
    ? screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea
    : screen.getPrimaryDisplay().workArea;
  friendsWin = new BrowserWindow({
    width: W,
    height: H,
    minWidth: 300,
    minHeight: 320,
    x: Math.round(area.x + (area.width - W) / 2),
    y: Math.round(area.y + (area.height - H) / 2),
    frame: false,
    transparent: true,
    resizable: true,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  friendsWin.setAlwaysOnTop(true, 'screen-saver');
  friendsWin.loadFile(path.join(__dirname, 'friends', 'index.html'));
  friendsWin.on('closed', () => {
    friendsWin = null;
  });
}

// The shout composer (right button over the frog): all-caps to everyone.
function openShoutWindow() {
  if (shoutWin) {
    shoutWin.show();
    shoutWin.focus();
    return;
  }
  const W = 280;
  const H = 150;
  const b = petUrl();
  const area = b
    ? screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea
    : screen.getPrimaryDisplay().workArea;
  let x = Math.round(area.x + (area.width - W) / 2);
  let y = Math.round(area.y + (area.height - H) / 2);
  if (b) {
    x = Math.min(Math.max(b.x + b.width / 2 - W / 2, area.x), area.x + area.width - W);
    y = Math.min(b.y + b.height - 10, area.y + area.height - H);
  }
  shoutWin = new BrowserWindow({
    width: W,
    height: H,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  shoutWin.setAlwaysOnTop(true, 'screen-saver');
  shoutWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreenScreen: true });
  shoutWin.loadFile(path.join(__dirname, 'shout', 'index.html'));
  shoutWin.on('closed', () => {
    shoutWin = null;
  });
}

// ---------------------------------------------------------------------------
// Global keyboard hook -> small hop
// ---------------------------------------------------------------------------
function startKeyboardHook() {
  let uIOhook;
  try {
    ({ uIOhook } = require('uiohook-napi'));
  } catch (err) {
    console.warn('uiohook-napi not available, key hops disabled:', err.message);
    return;
  }
  try {
    uIOhook.on('keydown', () => {
      // Every keystroke counts as activity (wakes the frog) and charges a jump.
      markActivity();
      // Light throttle only to guard against key-repeat floods while a key is
      // held down. Suppressed while the input panel is open so typing your note
      // doesn't keep it jumping.
      if (inputWin) return;
      const now = Date.now();
      if (now - lastHopAt < 20) return;
      lastHopAt = now;
      if (petWin) petWin.webContents.send('anim:key');
    });
    uIOhook.start();
    app.on('will-quit', () => {
      try {
        uIOhook.stop();
      } catch {}
    });
  } catch (err) {
    console.warn('Failed to start keyboard hook (grant Accessibility permission):', err.message);
  }
}

// ---------------------------------------------------------------------------
// Auto launch
// ---------------------------------------------------------------------------
function applyAutoLaunch() {
  const cfg = config.load();
  try {
    app.setLoginItemSettings({ openAtLogin: !!cfg.autoLaunch });
  } catch (err) {
    console.warn('Failed to set login item:', err.message);
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.on('pet:set-ignore', (_e, ignore) => {
    if (petWin) petWin.setIgnoreMouseEvents(!!ignore, { forward: true });
  });

  ipcMain.on('pet:move', (_e, pos) => {
    if (!petWin || !pos) return;
    markActivity();
    const x = Math.round(pos.x);
    const y = Math.round(pos.y);
    petWin.setPosition(x, y);
    const id = screen.getDisplayNearestPoint({ x: x + PET_W / 2, y: y + PET_H / 2 }).id;
    if (currentDisplayId !== null && id !== currentDisplayId) refreshTransparency();
    currentDisplayId = id;
  });

  ipcMain.on('pet:move-end', () => {
    if (!petWin) return;
    const [x, y] = petWin.getPosition();
    config.save({ position: { x, y } });
  });

  ipcMain.on('pet:click', () => {
    markActivity();
    // If a friend invite is waiting, clicking the frog opens the friends panel
    // so you can accept it.
    const cfg = config.load();
    if ((cfg.friends || []).some((f) => f.status === 'incoming')) {
      openFriendsWindow();
      return;
    }
    // Otherwise clicking acknowledges the nag: stop jumping and open the journal.
    stopAttention();
    openInputWindow();
  });
  ipcMain.on('pet:open-settings', () => openSettingsWindow());
  ipcMain.on('pet:open-friends', () => openFriendsWindow());
  ipcMain.on('pet:open-journal', () => openInputWindow());
  ipcMain.on('pet:open-shout', () => openShoutWindow());

  // Shout: broadcast an all-caps message to every connected friend.
  ipcMain.on('shout:send', (_e, { text }) => {
    const t = String(text || '').trim().toUpperCase().slice(0, 200);
    if (!t) return;
    if (netWin) netWin.webContents.send('mesh:broadcast', { type: 'shout', text: t });
  });

  ipcMain.handle('note:save', (_e, text) => {
    const cfg = config.load();
    const trimmed = String(text || '').trim();
    if (!trimmed) return { ok: false, error: 'empty' };
    try {
      const file = notes.writeEntry({
        text: trimmed,
        destFolder: cfg.destFolder,
        author: cfg.author
      });
      stopAttention();
      if (petWin) petWin.webContents.send('entry:saved');
      closeInputWindow();
      if (cfg.autoPush) maybeAutoPush(cfg.destFolder);
      return { ok: true, file };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.on('attention:skip', () => {
    stopAttention();
    closeInputWindow();
  });

  ipcMain.on('input:close', () => closeInputWindow());

  ipcMain.handle('settings:get', () => config.load());

  ipcMain.handle('settings:set', (_e, patch) => {
    const p = patch || {};
    const next = config.save(p);
    if (Object.prototype.hasOwnProperty.call(p, 'autoLaunch')) applyAutoLaunch();
    if (Object.prototype.hasOwnProperty.call(p, 'intervalMinutes')) scheduleHourly();
    if (Object.prototype.hasOwnProperty.call(p, 'opacity')) {
      const op = typeof next.opacity === 'number' ? next.opacity : 1;
      if (petWin) petWin.setOpacity(op);
      for (const w of remoteWins.values()) w.setOpacity(op);
    }
    // Reconnect the mesh if the signaling backend changed; refresh ICE servers
    // (STUN/TURN) in place if only the relay config changed.
    if (Object.prototype.hasOwnProperty.call(p, 'supabase')) {
      restartNetworking();
    } else if (Object.prototype.hasOwnProperty.call(p, 'turn') && netWin) {
      netWin.webContents.send('mesh:config', { iceServers: buildIceServers() });
    }
    if (petWin) petWin.webContents.send('config:updated', next);
    return next;
  });

  ipcMain.handle('settings:is-git-repo', async () => {
    const cfg = config.load();
    return gitSync.isGitRepo(cfg.destFolder);
  });

  ipcMain.handle('settings:pick-folder', async () => {
    const cfg = config.load();
    const res = await dialog.showOpenDialog(settingsWin || undefined, {
      title: 'Choose micro-blog destination folder',
      defaultPath: cfg.destFolder,
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    return { canceled: false, path: res.filePaths[0] };
  });

  // Manual trigger (used by settings "test" button) to preview the big jump.
  ipcMain.on('pet:test-jump', () => bigJump());

  ipcMain.on('app:quit', () => quitApp());

  ipcMain.handle('sprite:get', (_e, color) => {
    try {
      return spriteDataUrl(color);
    } catch (err) {
      console.error('Failed to load sprite:', err.message);
      return null;
    }
  });

  // --- Multiplayer IPC -----------------------------------------------------
  // A local animation beat -> broadcast to every connected friend.
  ipcMain.on('net:local-event', (_e, msg) => {
    if (netWin) netWin.webContents.send('mesh:broadcast', msg);
  });

  // Signaling relay from the mesh renderer out to the right peer.
  ipcMain.on('mesh:signal-out', (_e, { friendId, kind, data }) => {
    signaling.sendSignal(friendId, kind, data);
  });

  // A peer's data channel opened: wake their frog + push our color to them.
  ipcMain.on('mesh:peer-connected', (_e, { friendId }) => {
    spawnRemoteFrog(friendId);
    setConnected(friendId, true);
    const cfg = config.load();
    if (netWin) {
      netWin.webContents.send('mesh:send', {
        friendId,
        msg: { type: 'color', color: cfg.color }
      });
    }
  });
  // Link dropped: keep the frog on screen but turn its back (offline).
  ipcMain.on('mesh:peer-disconnected', (_e, { friendId }) => setConnected(friendId, false));
  ipcMain.on('mesh:peer-data', (_e, { friendId, msg }) => handlePeerData(friendId, msg));

  // Remote frog window: click-through, dragging, and click-to-message.
  ipcMain.on('remote:set-ignore', (_e, { id, ignore }) => {
    const w = remoteWins.get(id);
    if (w) w.setIgnoreMouseEvents(!!ignore, { forward: true });
  });
  ipcMain.on('remote:move', (_e, { id, x, y }) => {
    const w = remoteWins.get(id);
    if (w) w.setPosition(Math.round(x), Math.round(y));
  });
  ipcMain.on('remote:move-end', (_e, { id }) => {
    const w = remoteWins.get(id);
    if (!w) return;
    const [x, y] = w.getPosition();
    const cfg = config.load();
    config.save({ remotePositions: { ...(cfg.remotePositions || {}), [id]: { x, y } } });
  });
  // Clicking a connected frog opens the "speak" (DM) composer aimed at it.
  // Offline frogs (turned away) ignore clicks.
  ipcMain.on('remote:click', (_e, { id }) => {
    if (connected.has(id)) openMessageWindow(id);
  });
  // The X on a friend's frog breaks the link (and removes you from theirs).
  ipcMain.on('remote:remove', (_e, { id }) => removeFriendLocally(id));

  // First-run: save the frog's name.
  ipcMain.on('name:save', (_e, name) => {
    const n = String(name || '').trim();
    if (n) config.save({ displayName: n });
  });

  // Send a chat message to one friend over their data channel.
  ipcMain.on('msg:send', (_e, { toId, text }) => {
    const t = String(text || '').trim();
    if (!t || !toId) return;
    if (netWin) {
      netWin.webContents.send('mesh:send', { friendId: toId, msg: { type: 'message', text: t } });
    }
  });

  // Friend management (from settings).
  ipcMain.handle('friends:list', () => {
    const cfg = config.load();
    const friends = (cfg.friends || []).map((f) => ({ ...f, online: !!presence.get(f.id) }));
    return { selfId: cfg.selfId, friends };
  });

  // Whether multiplayer is actually connected (Supabase configured).
  ipcMain.handle('net:status', () => ({ configured: signaling.isConfigured(config.load()) }));

  // Send a friend request to a code.
  ipcMain.handle('friends:add', (_e, { code, label }) => {
    const cfg = config.load();
    if (!signaling.isConfigured(cfg)) {
      return { ok: false, error: 'Connect to Supabase first (Connection setup)' };
    }
    const id = config.normalizeCode(code);
    if (!id) return { ok: false, error: 'Enter a friend code' };
    if (!config.isValidCode(id)) return { ok: false, error: 'Codes look like ABCD-1234' };
    if (id === cfg.selfId) return { ok: false, error: "That's your own code" };
    const existing = (cfg.friends || []).find((f) => f.id === id);
    if (existing && existing.status === 'accepted') return { ok: false, error: 'Already friends' };

    // Re-sending a pending invite is fine (e.g. the friend just came online).
    if (existing && existing.status === 'pending') {
      signaling.sendRequest(id, selfName());
      return { ok: true };
    }

    const friends = [...(cfg.friends || [])];
    if (!existing) friends.push({ id, label: String(label || '').trim(), status: 'pending' });
    config.save({ friends });
    signaling.sendRequest(id, selfName());
    return { ok: true };
  });

  // Accept an incoming friend request.
  ipcMain.handle('friends:accept', (_e, { id }) => {
    const cfg = config.load();
    const friends = [...(cfg.friends || [])];
    const f = friends.find((x) => x.id === id);
    if (!f) return { ok: false, error: 'No such request' };
    f.status = 'accepted';
    config.save({ friends });
    signaling.sendAccept(id, selfName());
    signaling.addPair(id);
    pushFriends();
    return { ok: true };
  });

  // Decline an incoming request (tells them so their pending clears).
  ipcMain.handle('friends:decline', (_e, { id }) => {
    removeFriendLocally(id);
    return { ok: true };
  });

  // Remove a friend / cancel a request (mutual).
  ipcMain.handle('friends:remove', (_e, { id }) => {
    removeFriendLocally(id);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  config.ensureIdentity();
  registerIpc();
  createTray();
  createPetWindow();
  applyAutoLaunch();
  startKeyboardHook();
  scheduleHourly();
  startSleepWatch();
  startNetworking();
  if (!config.load().displayName) openNameWindow();

  app.on('activate', () => {
    if (!petWin) createPetWindow();
  });
});

// Keep running as a background pet even with no visible standard windows.
app.on('window-all-closed', (e) => {
  if (!quitting) e.preventDefault();
});
