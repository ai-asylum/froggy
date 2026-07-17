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
const updater = require('./update');
const apps = require('./apps/registry');
const { createPomodoro } = require('./apps/pomodoro/pomodoro');
const { createCountdown } = require('./apps/countdown/countdown');
const { createReminder } = require('./apps/water/water');
const { createShout } = require('./apps/shout/shout-main');

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
// and the semi-circle of action buttons above the frog. The window and the
// sprite scale together by the user's `scale` setting, so these are the base
// (scale = 1) dimensions; PET_W/PET_H below are the current, scaled ones.
const BASE_PET_W = 160;
// Extra transparent headroom below the frog's feet. The sprite keeps its spot
// (see pet.js `bottomMargin`) but no longer sits against the window edge, which
// avoids the artifact seen while the window scales in on spawn.
const PET_BOTTOM_PAD = 40;
const BASE_PET_H = 150 + PET_BOTTOM_PAD;
const MARGIN = 24; // gap from screen edge on first launch

// Keep the frog a sensible size on every screen.
function clampScale(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1.8, Math.max(0.6, n));
}

let petScale = clampScale(config.load().scale);
let PET_W = Math.round(BASE_PET_W * petScale);
let PET_H = Math.round(BASE_PET_H * petScale);

// Resize the pet window to match a new scale, keeping it on screen. The
// renderer scales the sprite itself when it receives the updated config.
function applyPetScale(scale) {
  petScale = clampScale(scale);
  PET_W = Math.round(BASE_PET_W * petScale);
  PET_H = Math.round(BASE_PET_H * petScale);
  REMOTE_W = Math.round(BASE_REMOTE_W * petScale);
  REMOTE_H = Math.round(BASE_REMOTE_H * petScale);

  if (petWin) {
    const [x, y] = petWin.getPosition();
    const area = screen.getDisplayNearestPoint({ x, y }).workArea;
    const nx = Math.max(area.x, Math.min(x, area.x + area.width - PET_W));
    const ny = Math.max(area.y, Math.min(y, area.y + area.height - PET_H));
    petWin.setBounds({ x: nx, y: ny, width: PET_W, height: PET_H });
    config.save({ position: { x: nx, y: ny } });
  }

  // Friends' frogs grow/shrink to match, kept on screen and told to rescale.
  for (const [id, w] of remoteWins) {
    if (w.isDestroyed()) continue;
    const [rx, ry] = w.getPosition();
    const { x: cx, y: cy } = clampToWorkArea(rx, ry, REMOTE_W, REMOTE_H);
    w.setBounds({ x: cx, y: cy, width: REMOTE_W, height: REMOTE_H });
    w.webContents.send('peer:scale', { scale: petScale });
    const cfg = config.load();
    config.save({ remotePositions: { ...(cfg.remotePositions || {}), [id]: { x: cx, y: cy } } });
  }
}

let petWin = null;
let inputWin = null;
let settingsWin = null;
let tray = null;

// Pixel-perfect click-through relies on setIgnoreMouseEvents(..., { forward:
// true }) so the renderer still receives mouse-move while the window is
// click-through. That `forward` option only works on macOS and Windows — on
// Linux the events aren't forwarded, so the frog would be stuck permanently
// click-through (no hover buttons, no dragging). Keep those windows always
// interactive on Linux instead, trading a small transparent dead-zone around
// the frog for a frog you can actually grab.
const SUPPORTS_CLICK_THROUGH = process.platform !== 'linux';

// Keep a frog window visible on every desktop/Space (so it follows you when you
// switch desktops), or pin it to its current one — driven by the `allDesktops`
// setting. `visibleOnFullScreen` lets it also float over fullscreen apps' spaces.
function applyAllDesktops(win) {
  if (!win || win.isDestroyed()) return;
  const on = config.load().allDesktops !== false;
  win.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: true });
}

// Global keyboard hooks (libuiohook) are fundamentally broken on Wayland: its
// X11 XKB queries fail (dropping keys), and some setups even segfault on load.
// Detect Wayland so we can skip the hook there and fall back to cursor polling.
const IS_WAYLAND =
  process.platform === 'linux' &&
  (String(process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland' ||
    !!process.env.WAYLAND_DISPLAY);

// --- Multiplayer state -----------------------------------------------------
// Friends' frogs scale with the same `scale` setting as your own, so these are
// the base (scale = 1) dimensions and REMOTE_W/REMOTE_H are the scaled ones.
const BASE_REMOTE_W = 120;
const BASE_REMOTE_H = 176; // frog (112) + headroom for the speech bubble
let REMOTE_W = Math.round(BASE_REMOTE_W * petScale);
let REMOTE_H = Math.round(BASE_REMOTE_H * petScale);
let netWin = null; // hidden helper renderer hosting the WebRTC mesh
let messageWin = null; // the "speak to this friend" DM composer
let nameWin = null; // first-run "name your frog" popup
let friendsWin = null; // the friends panel
let slotPickerWin = null; // the "pick an app for this frog slot" popover
let pendingSlotIndex = 0; // which slot the open picker is editing
const FROG_SLOT = 3; // slots[0..2] are the arc buttons; slots[3] is the frog
const remoteWins = new Map(); // friendId -> BrowserWindow (a friend's frog)
const presence = new Map(); // friendId -> boolean (Supabase presence)
const connected = new Set(); // friendIds with an open P2P data channel

// --- Room state --------------------------------------------------------------
// A room is a named Supabase presence channel anyone can join (no password).
// Everyone in it sees everyone else's frog on screen — they are *not* friends
// (no P2P link, no DMs), just present. One room at a time.
let currentRoom = ''; // the joined room name ('' = none)
const roomMembers = new Map(); // memberId -> { name, color } (excluding self)
const roomFrogIds = new Set(); // frogs on screen because of the room, not a friendship

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
  applyAllDesktops(petWin);

  // Track which display the pet is on so we can force a repaint when it crosses
  // to another monitor (macOS drops transparency otherwise -> white background).
  currentDisplayId = screen.getDisplayNearestPoint({ x: x + PET_W / 2, y: y + PET_H / 2 }).id;

  // Start click-through; the renderer toggles this off when the cursor is over
  // an opaque frog pixel (pixel-perfect hit testing). On Linux forwarding isn't
  // supported, so stay interactive to keep hover + dragging working.
  if (SUPPORTS_CLICK_THROUGH) petWin.setIgnoreMouseEvents(true, { forward: true });

  petWin.setOpacity(typeof cfg.opacity === 'number' ? cfg.opacity : 1);

  petWin.loadFile(path.join(__dirname, 'pet', 'index.html'));

  // If something's already notifying when the pet (re)loads, replay it so the
  // pet can hide the app buttons and flash the notifier's icon.
  petWin.webContents.on('did-finish-load', () => {
    if (frogNotifyKey && petWin) petWin.webContents.send('frog:notify', frogNotifyInfo());
  });

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
    // Discount the transparent pad below the frog so we hug its feet, not the
    // (now taller) window's edge.
    x = Math.min(Math.max(b.x + b.width / 2 - W / 2, primary.x), primary.x + primary.width - W);
    y = b.y + b.height - PET_BOTTOM_PAD - 10;
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
  inputWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  inputWin.loadFile(path.join(__dirname, 'apps', 'journal', 'index.html'));
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
// Open (or focus) settings, optionally jumping straight to a named view
// ('appearance', 'friends', 'apps', or an app id). Passed to the renderer once
// it's ready via the `settings:navigate` message.
function openSettingsWindow(initialView) {
  if (settingsWin) {
    settingsWin.show();
    settingsWin.focus();
    if (initialView) settingsWin.webContents.send('settings:navigate', initialView);
    return;
  }
  const W = 380;
  const H = 560;
  // Spawn beside the frog on whichever display it's on, falling back to the
  // primary display's center when there's no frog yet.
  const b = petUrl();
  const area = b
    ? screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea
    : screen.getPrimaryDisplay().workArea;
  let x = Math.round(area.x + (area.width - W) / 2);
  let y = Math.round(area.y + (area.height - H) / 2);
  if (b) {
    // Pop the panel up centered on the frog, its bottom edge tucked just above
    // the frog's feet, then clamp so it always stays fully on screen.
    x = Math.round(b.x + b.width / 2 - W / 2);
    x = Math.max(area.x, Math.min(x, area.x + area.width - W));
    y = Math.round(b.y + b.height - PET_BOTTOM_PAD - H - MARGIN);
    y = Math.max(area.y, Math.min(y, area.y + area.height - H));
  }
  settingsWin = new BrowserWindow({
    width: W,
    height: H,
    minWidth: 340,
    minHeight: 320,
    x,
    y,
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
  if (initialView) {
    settingsWin.webContents.once('did-finish-load', () => {
      if (settingsWin) settingsWin.webContents.send('settings:navigate', initialView);
    });
  }
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
    { label: 'Check for updates...', click: () => updater.checkForUpdates({ silent: false }) },
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

// A journal reminder. If the composer is already up, just surface it; otherwise
// grab attention like any other app: a jump + dance plus a pending notification,
// so the journal icon flashes on the frog and a tap opens the composer (which
// acknowledges the nag — see the onInteract below).
function nag() {
  if (inputWin) {
    inputWin.show();
    inputWin.focus();
    return;
  }
  frogAlert();
  notifyOnFrog('journal', () => {
    stopAttention();
    openInputWindow();
    return true;
  });
}

function startAttention() {
  // Unpinned journal stays quiet — no scheduled hop/nag cycle. (An explicit
  // preview from Settings calls nag() directly and still works.)
  if (!isAppPinned('journal')) return;
  attentionActive = true;
  sleeping = false; // an attention jump wakes the frog
  nag();
  if (snoozeTimer) clearInterval(snoozeTimer);
  // Keep reminding every 4 minutes until an entry is written or skipped, but
  // don't jump while the panel is already open and waiting.
  snoozeTimer = setInterval(() => {
    if (!attentionActive || inputWin) return;
    nag();
  }, 4 * 60 * 1000);
}

function stopAttention() {
  attentionActive = false;
  clearFrogNotification('journal');
  if (snoozeTimer) {
    clearInterval(snoozeTimer);
    snoozeTimer = null;
  }
  if (petWin) petWin.webContents.send('attention:stop');
}

function bigJump(opts) {
  if (petWin) petWin.webContents.send('anim:jump', opts);
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

// Last-known skin colour for a friend, so an offline (back-turned) frog still
// shows the right skin after a restart instead of falling back to green.
function friendColor(id) {
  const cfg = config.load();
  const f = (cfg.friends || []).find((x) => x.id === id);
  return (f && f.color) || null;
}

// The friendship state for a remote id: 'pending' | 'incoming' | 'accepted' |
// null (a stranger sharing my room). Drives the frog's "add friend" pill.
function friendStatus(id) {
  const cfg = config.load();
  const f = (cfg.friends || []).find((x) => x.id === id);
  return (f && f.status) || null;
}

// Refresh a remote frog's hover overlay (room chip + friendship state) after
// the room or the friendship changes, without respawning its window.
function updateRemoteMeta(id) {
  const w = remoteWins.get(id);
  if (!w || w.isDestroyed()) return;
  w.webContents.send('remote:meta', {
    room: roomMembers.has(id) ? currentRoom : '',
    status: friendStatus(id)
  });
}

function saveFriendColor(id, color) {
  if (!color) return;
  const cfg = config.load();
  const friends = [...(cfg.friends || [])];
  const f = friends.find((x) => x.id === id);
  if (!f || f.color === color) return;
  f.color = color;
  config.save({ friends });
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
  syncFrogNotify(); // an incoming invite hides the frog's slot badge
}

// Whether a peer is "here" — enough to face their frog forward. A person counts
// as present when they're visible over Supabase presence (a friend's pair
// channel or a shared room), or when a direct P2P link is open. The frog only
// turns its back (the sleepy, away pose) when the person is truly gone; it must
// NOT depend on the P2P data channel alone, or a connected friend whose direct
// link never establishes (common behind NATs) would look asleep forever.
function isPeerPresent(friendId) {
  return connected.has(friendId) || !!presence.get(friendId) || roomMembers.has(friendId);
}

// Push the current presence to a friend's frog window so it faces forward when
// they're around and turns away when they leave.
function refreshRemotePresence(friendId) {
  const w = remoteWins.get(friendId);
  if (w && !w.isDestroyed()) w.webContents.send('peer:presence', { online: isPeerPresent(friendId) });
}

// A friend's P2P link opened or closed: refresh their frog's pose from presence,
// update the online dot in the friends panel, and keep the connected set in sync.
function setConnected(friendId, isConnected) {
  if (isConnected) connected.add(friendId);
  else connected.delete(friendId);
  refreshRemotePresence(friendId);
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
        // Face the frog forward as soon as the person is present (over Supabase
        // presence), rather than waiting for the P2P data channel — otherwise a
        // connected friend whose direct link can't be established looks asleep.
        // A dropped presence also drops the P2P link and turns the frog away.
        if (online) refreshRemotePresence(friendId);
        else setConnected(friendId, false);
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

  // Publish my own skin and pull down friends' saved skins so their (offline,
  // back-turned) frogs already show the right color before any P2P link opens.
  signaling.publishProfile(cfg.color);
  syncFriendSkins();

  // Rejoin the room we were in last session.
  if (cfg.room) {
    currentRoom = cfg.room;
    signaling.joinRoom(cfg.room, { name: selfName(), color: cfg.color }, onRoomSync, onRoomAction);
  }

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
    roomFrogIds.delete(fromId); // their frog is now owned by the friendship
    spawnRemoteFrog(fromId);
    updateRemoteMeta(fromId); // drop the "add friend" pill now we're linked
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

  // If their frog is already on screen (a room member), flip its pill to
  // "Accept" so the invite can be taken right there.
  updateRemoteMeta(fromId);
  // No modal — the frog leaps + dances for attention, and pushFriends →
  // syncFrogNotify flashes the friend icon on it like an app notification;
  // clicking the frog opens the friends panel (see the pet:click handler)
  // where the invite can be accepted.
  frogAlert();
  notify('Friend invite', `${fromName || 'Someone'} (${fromId}) wants to be friends.`);
  pushFriends();
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
  roomFrogIds.delete(fromId); // their frog is now owned by the friendship
  spawnRemoteFrog(fromId);
  updateRemoteMeta(fromId); // drop the "add friend" pill now we're linked
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
  respawnAsRoomFrog(fromId);
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
  respawnAsRoomFrog(id);
  pushFriends();
}

// An ex-friend who shares my room keeps their (plain, room-owned) frog.
function respawnAsRoomFrog(id) {
  const m = roomMembers.get(id);
  if (!m) return;
  roomFrogIds.add(id);
  spawnRemoteFrog(id, { label: m.name, color: m.color, online: true });
}

// Pull friends' stored skins from Supabase and apply them to their frog windows
// (and remember them locally), so an offline friend shows their real color.
async function syncFriendSkins() {
  const ids = acceptedIds();
  if (!ids.length) return;
  const profiles = await signaling.fetchProfiles(ids);
  for (const [id, color] of Object.entries(profiles)) {
    if (!color) continue;
    saveFriendColor(id, color);
    sendToRemote(id, 'peer:event', { type: 'color', color });
  }
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------
function isAcceptedFriend(id) {
  const cfg = config.load();
  return (cfg.friends || []).some((f) => f.id === id && f.status === 'accepted');
}

// Push the room snapshot to any open friends UI.
function pushRoom() {
  const payload = {
    room: currentRoom,
    members: [...roomMembers.entries()].map(([id, m]) => ({ id, ...m }))
  };
  if (friendsWin) friendsWin.webContents.send('room:changed', payload);
  if (settingsWin) settingsWin.webContents.send('room:changed', payload);
  // Keep each frog's hover overlay in step with the room it's linked to.
  for (const id of remoteWins.keys()) updateRemoteMeta(id);
}

// Presence sync from the room channel: diff against what we knew — spawn a frog
// for each newcomer, drop the ones who left. Friends' frogs are left alone
// (they're owned by the friendship lifecycle, not the room).
function onRoomSync(members) {
  const cfg = config.load();
  const next = new Map();
  for (const m of members || []) {
    if (!m.id || m.id === cfg.selfId) continue;
    next.set(m.id, { name: m.name || 'Froggy', color: m.color || '' });
  }

  for (const id of [...roomMembers.keys()]) {
    if (next.has(id)) continue;
    roomMembers.delete(id);
    if (roomFrogIds.has(id)) {
      roomFrogIds.delete(id);
      if (!isAcceptedFriend(id)) despawnRemoteFrog(id);
    } else {
      // A friend who left the shared room keeps their frog; turn it away if
      // they're not still present through the friendship / a direct link.
      refreshRemotePresence(id);
    }
  }

  for (const [id, m] of next) {
    const known = roomMembers.get(id);
    roomMembers.set(id, m);
    if (!known) {
      // A friend already has a frog on screen; only spawn for strangers, but
      // still wake it — sharing a room means they're clearly here, even if the
      // direct P2P link to that friend hasn't come up.
      if (!remoteWins.has(id)) {
        roomFrogIds.add(id);
        spawnRemoteFrog(id, { label: m.name, color: m.color, online: true });
      } else {
        refreshRemotePresence(id);
      }
    } else if (roomFrogIds.has(id) && m.color && m.color !== known.color) {
      const w = remoteWins.get(id);
      if (w && !w.isDestroyed()) w.webContents.send('peer:event', { type: 'color', color: m.color });
    }
  }

  pushRoom();
}

// Shouts and frog "bounce" beats a roommate sent over the room channel. These
// are the only frog events that reach non-friends who merely share your room;
// private DMs are deliberately excluded. A friend who is also in the room
// already receives these over their P2P link, so their room copy is dropped.
const ROOM_ACTION_TYPES = new Set(['color', 'hop', 'jump', 'sleep', 'wake', 'idle', 'shout']);
function onRoomAction(fromId, msg) {
  if (!fromId || fromId === config.load().selfId) return;
  if (!roomMembers.has(fromId)) return; // only people actually in our room
  if (connected.has(fromId)) return; // a live P2P link already delivered it
  if (!msg || !ROOM_ACTION_TYPES.has(msg.type)) return;
  handlePeerData(fromId, msg);
}

function joinRoomLocal(name) {
  const cfg = config.load();
  if (!signaling.isConfigured(cfg)) {
    return { ok: false, error: 'Connect to Supabase first (Connection setup)' };
  }
  const room = String(name || '').trim().toLowerCase();
  if (!room) return { ok: false, error: 'Enter a room name' };
  if (room === currentRoom) return { ok: true, room };
  if (currentRoom) leaveRoomLocal({ silent: true }); // one room at a time
  currentRoom = room;
  config.save({ room });
  signaling.joinRoom(room, { name: selfName(), color: cfg.color }, onRoomSync, onRoomAction);
  pushRoom();
  return { ok: true, room };
}

function leaveRoomLocal(opts = {}) {
  signaling.leaveRoom();
  for (const id of [...roomFrogIds]) {
    if (!isAcceptedFriend(id)) despawnRemoteFrog(id);
  }
  roomFrogIds.clear();
  roomMembers.clear();
  currentRoom = '';
  config.save({ room: '' });
  // Kept frogs (accepted friends) may have been present only via this room —
  // refresh their pose so they turn away unless still reachable another way.
  for (const id of remoteWins.keys()) refreshRemotePresence(id);
  if (!opts.silent) pushRoom();
}

function restartNetworking() {
  try {
    signaling.stop();
  } catch {}
  for (const id of [...remoteWins.keys()]) despawnRemoteFrog(id);
  presence.clear();
  connected.clear();
  roomFrogIds.clear();
  roomMembers.clear();
  currentRoom = '';
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

// `opts` lets room members (who aren't friends, so have no config entry) supply
// their label/color from presence data, and spawn facing forward right away.
function spawnRemoteFrog(friendId, opts = {}) {
  if (remoteWins.has(friendId)) return remoteWins.get(friendId);
  const cfg = config.load();
  const label = opts.label || friendLabel(friendId);

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
  // One level below the pet's 'screen-saver' so your own frog always renders
  // on top of every remote frog, while still floating above normal windows.
  win.setAlwaysOnTop(true, 'pop-up-menu');
  applyAllDesktops(win);
  if (SUPPORTS_CLICK_THROUGH) win.setIgnoreMouseEvents(true, { forward: true });
  win.setOpacity(typeof cfg.opacity === 'number' ? cfg.opacity : 1);
  win.loadFile(path.join(__dirname, 'pet', 'remote.html'), {
    query: {
      id: friendId,
      label,
      color: opts.color || friendColor(friendId) || '',
      scale: String(petScale),
      // The room this frog is linked to (only set while it shares my room) and
      // the friendship state, so the hover overlay can show the room + an
      // "add friend" pill for strangers right away.
      room: roomMembers.has(friendId) ? currentRoom : '',
      status: friendStatus(friendId) || ''
    }
  });
  win.webContents.on('did-finish-load', () => {
    if (win.isDestroyed()) return;
    win.webContents.send('anim:enabled', { on: config.load().animations !== false });
    win.webContents.send('peer:presence', { online: !!opts.online || isPeerPresent(friendId) });
  });
  // Only forget this window if the map still points at it — a despawn followed
  // by an immediate respawn (friend -> room frog) must not lose the new window.
  win.on('closed', () => {
    if (remoteWins.get(friendId) === win) remoteWins.delete(friendId);
  });
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

  // Remember the friend's skin so their offline frog keeps it across restarts.
  if (msg.type === 'color') saveFriendColor(friendId, msg.color);

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
function danceLocal(opts) {
  markActivity();
  if (petWin) petWin.webContents.send('anim:dance', opts);
}

// First-run popup that asks the user to name their frog (sets displayName).
function openNameWindow() {
  if (nameWin) {
    nameWin.show();
    nameWin.focus();
    return;
  }
  const W = 300;
  const H = 246;
  const area = screen.getPrimaryDisplay().workArea;
  const nx = Math.round(area.x + (area.width - W) / 2);
  const ny = Math.round(area.y + (area.height - H) / 2);
  nameWin = new BrowserWindow({
    width: W,
    height: H,
    x: nx,
    y: ny,
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
  nameWin.loadFile(path.join(__dirname, 'name', 'index.html'), {
    query: { color: String(config.load().color || 'green') }
  });
  nameWin.on('closed', () => {
    nameWin = null;
    // Naming aborted/finished: hand the frog back to the user.
    unlockPetFromNaming();
  });

  // Perch the real (transparent) frog on top of the naming card as a live
  // preview — centered on the card with its feet resting on the top edge — and
  // freeze it so it can't be dragged or clicked until naming is done.
  if (petWin) {
    const feetFromTop = PET_H - PET_BOTTOM_PAD;
    petWin.setBounds({
      x: Math.round(nx + (W - PET_W) / 2),
      y: Math.round(ny - feetFromTop),
      width: PET_W,
      height: PET_H
    });
    sendPetLock(true);
    petWin.moveTop();
  }
}

// Freeze/unfreeze the frog. On first launch the pet renderer may still be
// loading when we ask to lock it, so a plain send would be dropped — wait for
// did-finish-load in that case so the lock actually lands.
function sendPetLock(on) {
  if (!petWin) return;
  const wc = petWin.webContents;
  if (wc.isLoading()) {
    wc.once('did-finish-load', () => {
      if (petWin) petWin.webContents.send('pet:lock', on);
    });
  } else {
    wc.send('pet:lock', on);
  }
}

// Return the frog to its normal home (top-right) and re-enable interaction once
// the first-run naming step is over.
function unlockPetFromNaming() {
  if (!petWin) return;
  sendPetLock(false);
  const wa = screen.getPrimaryDisplay().workArea;
  petWin.setBounds({
    x: wa.x + wa.width - PET_W - MARGIN,
    y: wa.y + MARGIN,
    width: PET_W,
    height: PET_H
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
  messageWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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

// ---------------------------------------------------------------------------
// App slots (the three quick-launch buttons around the frog)
// ---------------------------------------------------------------------------
// What clicking a filled slot does, per app id. Journal and Shout have their
// own popups; the timer/reminder apps open straight to their settings panel.
const APP_LAUNCHERS = {
  journal: () => openInputWindow(),
  shout: () => shout.open(),
  // Clicking the Pomodoro slot toggles the timer (start focus / stop the
  // cycle). Its focus/break lengths live in Settings, reached via a long-press
  // on the slot. See togglePomodoro / the Pomodoro app section below.
  pomodoro: () => togglePomodoro(),
  // Clicking the Countdown slot starts / cancels a one-shot timer; when it
  // ends a message dialog pops above the frog. Duration + message in Settings.
  countdown: () => toggleCountdown(),
  water: () => openSettingsWindow('app-water')
};

function launchApp(id) {
  const fn = APP_LAUNCHERS[id];
  if (fn) fn();
  else openSettingsWindow('apps'); // unknown/uninstalled: fall back to the list
}

// An app is "pinned" when it occupies one of the frog's slots. Only pinned apps
// are allowed to nudge you (OS notifications + frog nags); an app you've taken
// off the frog stays quiet.
function isAppPinned(id) {
  return (config.load().slots || []).includes(id);
}

// Halt an app's background activity the instant it leaves the frog, so a running
// timer or a pending nag doesn't linger after you unpin it.
function stopApp(id) {
  if (id === 'pomodoro') {
    pomodoro.stop();
    clearFrogNotification('pomodoro');
  } else if (id === 'countdown') {
    countdown.stop(); // pushes a cleared state that hides the on-frog timer overlay
  } else if (id === 'journal') {
    stopAttention();
  }
}

// The slot picker popover — a small transient window anchored under the frog,
// mirroring the journal/shout popups. It closes on blur or after any choice.
function openSlotPicker(index) {
  pendingSlotIndex = index;
  if (slotPickerWin) {
    slotPickerWin.close();
    slotPickerWin = null;
  }
  const installed = apps.list().filter((a) => a.installed);
  const count = installed.length;
  // The right-click hint line shows when at least one app has a settings screen.
  const hasSettingsHint = installed.some((a) => a.settingsView);
  const W = 250;
  // header + one row per app + (the right-click hint line when shown) + padding.
  // Clearing a slot is done by clicking its current app; app settings are
  // reached by right-clicking an app row.
  const H = 30 + count * 42 + (hasSettingsHint ? 22 : 0) + 24;
  const b = petUrl();
  const area = b
    ? screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea
    : screen.getPrimaryDisplay().workArea;
  let x = area.x + area.width - W - MARGIN;
  let y = area.y + MARGIN + PET_H;
  if (b) {
    x = Math.min(Math.max(b.x + b.width / 2 - W / 2, area.x), area.x + area.width - W);
    y = b.y + b.height - PET_BOTTOM_PAD - 10;
    if (y + H > area.y + area.height) y = b.y - H + 10; // flip above if no room
  }
  slotPickerWin = new BrowserWindow({
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
  slotPickerWin.setAlwaysOnTop(true, 'screen-saver');
  slotPickerWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  slotPickerWin.loadFile(path.join(__dirname, 'slots', 'index.html'), {
    query: { index: String(index) }
  });
  // Close when the user clicks away — but ignore the spurious blur macOS fires
  // right after a frameless, transparent, always-on-top window first appears
  // (which would otherwise slam the picker shut the instant it opened).
  let closeOnBlur = false;
  slotPickerWin.once('show', () => {
    setTimeout(() => {
      closeOnBlur = true;
    }, 300);
  });
  slotPickerWin.on('blur', () => {
    if (closeOnBlur && slotPickerWin) slotPickerWin.close();
  });
  slotPickerWin.on('closed', () => {
    slotPickerWin = null;
  });
}

// ---------------------------------------------------------------------------
// Global keyboard hook -> small hop
// ---------------------------------------------------------------------------
function startKeyboardHook() {
  // Wayland can't do global key hooks; fall back to watching the cursor so the
  // frog still reacts to activity (and we avoid libuiohook's Wayland crashes).
  if (IS_WAYLAND) {
    startMouseActivityWatch();
    return;
  }
  let uIOhook;
  try {
    ({ uIOhook } = require('uiohook-napi'));
  } catch (err) {
    console.warn('uiohook-napi not available, key hops disabled:', err.message);
    return;
  }
  try {
    // Every keystroke/click counts as activity (wakes the frog) and charges a
    // jump. Light throttle only to guard against key-repeat floods while a key
    // is held down. Suppressed while the input panel is open so typing your
    // note doesn't keep it jumping.
    const onGlobalInput = () => {
      markActivity();
      if (inputWin) return;
      const now = Date.now();
      if (now - lastHopAt < 20) return;
      lastHopAt = now;
      if (petWin) petWin.webContents.send('anim:key');
    };
    uIOhook.on('keydown', onGlobalInput);
    uIOhook.on('mousedown', onGlobalInput);
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

// Wayland fallback for the keyboard hook: there's no global key capture, but
// Electron can read the global cursor position without any native module. Poll
// it and treat movement as activity so the frog still wakes and hops.
let mouseWatchTimer = null;
let lastCursor = null;
function startMouseActivityWatch() {
  if (mouseWatchTimer) return;
  try {
    lastCursor = screen.getCursorScreenPoint();
  } catch {
    lastCursor = null;
  }
  mouseWatchTimer = setInterval(() => {
    let p;
    try {
      p = screen.getCursorScreenPoint();
    } catch {
      return;
    }
    if (lastCursor) {
      if (Math.hypot(p.x - lastCursor.x, p.y - lastCursor.y) > 6) {
        markActivity();
        if (!inputWin) {
          const now = Date.now();
          if (now - lastHopAt >= 600) {
            lastHopAt = now;
            if (petWin) petWin.webContents.send('anim:key');
          }
        }
      }
    }
    lastCursor = p;
  }, 300);
  app.on('will-quit', () => {
    if (mouseWatchTimer) clearInterval(mouseWatchTimer);
    mouseWatchTimer = null;
  });
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
// Frog notifications
// ---------------------------------------------------------------------------
// Any app (and, separately, friend requests) can "notify": the frog grabs your
// attention, and the *next* tap on the frog is delivered to whoever raised the
// notification instead of doing the frog's default thing. Newest notification
// wins. The handler returns whether it actually consumed the tap; if it didn't
// (e.g. it went stale), we fall through to the normal frog-click behavior so a
// forgotten notification never silently eats a tap.
let pendingNotification = null; // { source, onInteract }
let frogNotifyKey = ''; // identity of the state last pushed to the pet ('' = none)

// A simple person glyph for friend-invite notifications (no registry app).
const FRIEND_ICON =
  '<path fill="currentColor" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z"/>';

// What's currently grabbing the frog's attention, if anything, resolved to the
// icon/color to flash on the frog. Priority matches the pet:click handler: a
// notifying app (the journal reminder is one of these now), then a waiting
// friend invite.
function frogNotifyInfo() {
  if (pendingNotification) {
    const a = apps.get(pendingNotification.source);
    return { active: true, icon: (a && a.icon) || null, color: (a && a.color) || null, name: (a && a.name) || pendingNotification.source };
  }
  const cfg = config.load();
  if ((cfg.friends || []).some((f) => f.status === 'incoming')) {
    return { active: true, icon: FRIEND_ICON, color: '#e87fb0', name: 'Friend request' };
  }
  return { active: false };
}

// Whenever a tap would be intercepted rather than launch the frog's slot app —
// i.e. while an app is notifying, a friend invite is waiting, or the journal is
// nagging — tell the pet: it hides the app buttons and flashes the notifier's
// icon in the center to make it super clear what wants attention.
function syncFrogNotify() {
  const info = frogNotifyInfo();
  const key = info.active ? String(info.name || 'on') : '';
  if (key === frogNotifyKey) return;
  frogNotifyKey = key;
  if (petWin) petWin.webContents.send('frog:notify', info);
}

function notifyOnFrog(source, onInteract) {
  pendingNotification = { source, onInteract };
  syncFrogNotify();
}

function clearFrogNotification(source) {
  if (pendingNotification && (!source || pendingNotification.source === source)) {
    pendingNotification = null;
    syncFrogNotify();
  }
}

// ---------------------------------------------------------------------------
// Pomodoro app
// ---------------------------------------------------------------------------
// A single background timer, driven by taps on the frog. Clicking the Pomodoro
// slot starts a focus block and shows a live countdown floating above the frog;
// when the timer runs out the frog leaps + dances and the countdown waits.
// Tapping the frog then starts the break, and so on, until the slot is clicked
// again to stop. The countdown is streamed to the pet window every tick; its
// focus/break lengths are configured in Settings.
function pushPomodoro(state) {
  if (petWin) petWin.webContents.send('pomodoro:state', state);
}

// A phase's timer ran out: a big leap followed by a happy little dance to grab
// attention, inviting a tap to roll into the next phase.
function frogAlert() {
  // A personal reminder: animate our own frog only, without broadcasting the
  // beats to friends (their frogs shouldn't jump for our nag).
  bigJump({ silent: true });
  setTimeout(() => danceLocal({ silent: true }), 260);
}

const pomodoro = createPomodoro({
  getDurations: () => config.load().pomodoro || {},
  onTick: (state) => pushPomodoro(state),
  onPhaseChange: (phase) => {
    markActivity();
  },
  onComplete: (finishedPhase) => {
    markActivity();
    if (!isAppPinned('pomodoro')) return; // unpinned: finish quietly, no alert
    if (finishedPhase === 'focus') {
      notify('Pomodoro', 'Focus done — tap the frog to start your break.');
    } else {
      notify('Pomodoro', 'Break over — tap the frog to focus again.');
    }
    frogAlert();
    // The frog is now waiting for a tap to roll into the next phase.
    notifyOnFrog('pomodoro', () => pomodoro.advance());
  }
});

function togglePomodoro() {
  markActivity();
  pomodoro.toggle(); // start()/stop() each emit a tick, refreshing the overlay
  clearFrogNotification('pomodoro'); // starting/stopping resolves any pending tap
}

// ---------------------------------------------------------------------------
// Water reminder app
// ---------------------------------------------------------------------------
function waterColor() {
  const app = apps.get('water');
  return (app && app.color) || '#38bdf8';
}

function fireWaterReminder(message) {
  if (!isAppPinned('water')) return; // unpinned: no reminders
  notify('Drink water', message);
  danceLocal();
  // Float the reminder text above the frog (auto-hides), matching the timer.
  showFrogMessage({ text: message, label: 'Water', color: waterColor() });
  // Tapping the frog acknowledges it — restart the countdown from now.
  notifyOnFrog('water', () => {
    waterReminder.reschedule();
    return true;
  });
}

const waterReminder = createReminder({
  getConfig: () => config.load().water || {},
  onRemind: fireWaterReminder
});

// ---------------------------------------------------------------------------
// Countdown app
// ---------------------------------------------------------------------------
// A one-shot timer. Clicking the Countdown slot starts it and floats a live
// readout above the frog (sharing the Pomodoro overlay); clicking again cancels
// it. When it reaches zero, your message floats above the frog — tinted with
// the app's color — and auto-hides. Duration + message are set in Settings.

// The Countdown app's accent, taken from the app registry so the overlay and
// the end message match its catalog color.
function countdownColor() {
  const app = apps.get('countdown');
  return (app && app.color) || '#8b5cf6';
}

function pushCountdown(state) {
  if (petWin) petWin.webContents.send('countdown:state', state);
}

// Float a short reminder message just above the frog (in the same readout as
// the timer), tinted with the app's accent. Auto-hides in the pet renderer.
function showFrogMessage({ text, label, color } = {}) {
  if (petWin) petWin.webContents.send('frog:message', { text: String(text || ''), label: label || '', color: color || '' });
}

function fireCountdownDone(message, color) {
  markActivity();
  if (!isAppPinned('countdown')) return; // unpinned: end quietly, no message
  notify('Countdown', message);
  frogAlert();
  showFrogMessage({ text: message, label: 'Countdown', color });
}

const countdown = createCountdown({
  getConfig: () => ({ ...(config.load().countdown || {}), color: countdownColor() }),
  onTick: (state) => pushCountdown(state),
  onDone: fireCountdownDone
});

function toggleCountdown() {
  markActivity();
  countdown.toggle(); // start()/stop() each emit a tick, refreshing the overlay
}

// ---------------------------------------------------------------------------
// Shout app
// ---------------------------------------------------------------------------
// Owns the composer window; we hand it the frog's geometry and a broadcaster
// that fans the message out to every connected friend over the P2P mesh.
// Echo a shout on your own frog so you see what you just yelled (also used by
// the settings "Test shout" button to preview the bubble locally).
function showLocalShout(text) {
  const t = String(text || '').slice(0, 200).toUpperCase();
  if (!t) return;
  if (petWin) petWin.webContents.send('shout:show', { text: t });
}

const shout = createShout({
  getPetBounds: () => petUrl(),
  broadcast: (text) => {
    showLocalShout(text);
    if (netWin) netWin.webContents.send('mesh:broadcast', { type: 'shout', text });
    // Roommates aren't P2P peers, so reach them over the room channel too.
    signaling.broadcastRoom({ type: 'shout', text });
  },
  preloadPath: path.join(__dirname, 'preload.js'),
  margin: MARGIN,
  bottomPad: PET_BOTTOM_PAD
});

// Ease the pet window's opacity toward a target over a short duration. Used by
// the hover handler to fade between full opacity and the configured setting.
let petOpacityTimer = null;
function animatePetOpacity(target) {
  if (!petWin) return;
  if (petOpacityTimer) {
    clearInterval(petOpacityTimer);
    petOpacityTimer = null;
  }
  const from = petWin.getOpacity();
  if (Math.abs(target - from) < 0.001) {
    petWin.setOpacity(target);
    return;
  }
  const durationMs = 160;
  const start = Date.now();
  petOpacityTimer = setInterval(() => {
    if (!petWin) {
      clearInterval(petOpacityTimer);
      petOpacityTimer = null;
      return;
    }
    const t = Math.min(1, (Date.now() - start) / durationMs);
    const eased = t * (2 - t); // easeOutQuad
    petWin.setOpacity(from + (target - from) * eased);
    if (t >= 1) {
      clearInterval(petOpacityTimer);
      petOpacityTimer = null;
    }
  }, 16);
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.on('pet:set-ignore', (_e, ignore) => {
    if (!petWin) return;
    if (!SUPPORTS_CLICK_THROUGH) return; // stays interactive on Linux
    petWin.setIgnoreMouseEvents(!!ignore, { forward: true });
  });

  // On hover, snap the frog to full opacity (ignoring the transparency setting);
  // on leave, ease back to the user's configured opacity. Animated with a short
  // eased ramp so the change reads as a gentle fade rather than a hard toggle.
  ipcMain.on('pet:hover', (_e, on) => {
    if (!petWin) return;
    const cfg = config.load();
    const base = typeof cfg.opacity === 'number' ? cfg.opacity : 1;
    animatePetOpacity(on ? 1 : base);
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
    // If an app is notifying (e.g. a finished Pomodoro phase, a water reminder),
    // the tap is its interaction — hand it over. onInteract returns false when
    // the notification has gone stale, in which case we fall through.
    if (pendingNotification) {
      const n = pendingNotification;
      pendingNotification = null;
      syncFrogNotify();
      if (n.onInteract()) return;
    }
    // If a friend invite is waiting, clicking the frog opens the friends panel
    // so you can accept it.
    const cfg = config.load();
    if ((cfg.friends || []).some((f) => f.status === 'incoming')) {
      openFriendsWindow();
      return;
    }
    // (A waiting journal nag is handled above via the notification system —
    // it registers as a pending notification whose tap opens the composer.)
    // Otherwise the frog is itself a slot (the 4th): a tap launches the app
    // assigned to it.
    const frogApp = (cfg.slots || [])[FROG_SLOT];
    if (frogApp) launchApp(frogApp);
    // Empty frog slot: a tap does nothing on purpose. The picker is opened by
    // *holding* the frog (long-press -> pet:edit-slot), mirroring the empty arc
    // slots so the gesture is consistent everywhere.
  });
  ipcMain.on('pet:open-settings', () => openSettingsWindow());
  ipcMain.on('pet:open-apps', () => openSettingsWindow('apps'));
  ipcMain.on('pet:open-friends', () => openFriendsWindow());
  ipcMain.on('pet:open-journal', () => openInputWindow());
  ipcMain.on('pet:open-shout', () => shout.open());

  // --- App slots -----------------------------------------------------------
  // Click a filled slot -> launch its app; click an empty slot -> pick one.
  ipcMain.on('pet:launch-slot', (_e, index) => {
    markActivity();
    const id = (config.load().slots || [])[index];
    if (id) launchApp(id);
    else openSlotPicker(index);
  });
  // Long-press -> open the picker to change/clear. The frog slot (index 3) is
  // only editable while the frog button is enabled.
  ipcMain.on('pet:edit-slot', (_e, index) => {
    if (index === FROG_SLOT && config.load().frogButton === false) return;
    openSlotPicker(index);
  });
  // Right-click -> jump straight to the slotted app's settings. An empty slot
  // (or an app without a settings screen) falls back to the picker so you can
  // still add / change the app.
  ipcMain.on('pet:slot-settings', (_e, index) => {
    if (index === FROG_SLOT && config.load().frogButton === false) return;
    const id = (config.load().slots || [])[index];
    const app = id ? apps.get(id) : null;
    if (app && app.settingsView) openSettingsWindow(`app-${app.settingsView}`);
    else openSlotPicker(index);
  });

  // The picker asks for the current slots + app catalog to render itself.
  ipcMain.handle('slots:context', () => ({
    index: pendingSlotIndex,
    slots: config.load().slots || [],
    apps: apps.list()
  }));

  // Assign (or clear, when appId is null) a slot. An app can only live in one
  // slot, so if it's already elsewhere we move it. The frog re-renders live.
  ipcMain.handle('slots:set', (_e, { index, appId }) => {
    const before = config.load().slots || [null, null, null, null];
    const slots = [...before];
    while (slots.length < 4) slots.push(null); // 3 arc slots + the frog itself
    if (appId) {
      for (let i = 0; i < slots.length; i++) if (slots[i] === appId) slots[i] = null;
    }
    slots[index] = appId || null;
    const next = config.save({ slots });
    // Anything that just came off the frog goes quiet immediately.
    for (const id of before) {
      if (id && !slots.includes(id)) stopApp(id);
    }
    if (petWin) petWin.webContents.send('config:updated', next);
    return next.slots;
  });

  // Jump straight to the settings screen of the app in the slot (e.g. the
  // 'pomodoro' view). Falls back to the Applications list if unknown.
  ipcMain.on('slots:open-app-settings', (_e, settingsView) => {
    openSettingsWindow(settingsView ? `app-${settingsView}` : 'apps');
  });

  // The Applications screen in settings asks for the list of installed apps.
  ipcMain.handle('apps:list', () => apps.list());

  // --- Pomodoro app --------------------------------------------------------
  // The cycle is driven by the frog: the slot toggles it (pet:launch-slot ->
  // togglePomodoro) and a tap advances a finished phase (pet:click). The pet
  // overlay just reads the current state on load; live updates arrive via the
  // 'pomodoro:state' broadcast.
  ipcMain.handle('pomodoro:get', () => pomodoro.getState());
  ipcMain.on('pomodoro:toggle', () => togglePomodoro());

  // --- Countdown app -------------------------------------------------------
  // Slot click toggles it (pet:launch-slot -> toggleCountdown). The pet overlay
  // reads current state on load; live updates arrive via 'countdown:state'.
  ipcMain.handle('countdown:get', () => countdown.getState());
  ipcMain.on('countdown:toggle', () => toggleCountdown());

  // Shout: normalize + broadcast an all-caps message to every connected friend.
  ipcMain.on('shout:send', (_e, { text }) => shout.send(text));

  // Preview a shout on your own frog without broadcasting it to friends.
  ipcMain.handle('shout:test', () => {
    showLocalShout('This is a test shout!');
  });

  // Fire the end-of-countdown alert right now so you can preview it.
  ipcMain.handle('countdown:test', () => {
    const message = String((config.load().countdown || {}).message || '').trim() || 'Time\u2019s up!';
    fireCountdownDone(message, countdownColor());
  });

  // Fire a water reminder right now so you can preview the notification.
  ipcMain.handle('water:test', () => {
    const message = String((config.load().water || {}).message || '').trim() || 'Time to drink some water!';
    fireWaterReminder(message);
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
    if (Object.prototype.hasOwnProperty.call(p, 'scale')) applyPetScale(next.scale);
    // Keep the frogs on every desktop, or pin them to the current one.
    if (Object.prototype.hasOwnProperty.call(p, 'allDesktops')) {
      applyAllDesktops(petWin);
      for (const w of remoteWins.values()) applyAllDesktops(w);
    }
    if (Object.prototype.hasOwnProperty.call(p, 'water')) waterReminder.reschedule();
    // Share your new skin so friends' copies of your frog update, even offline.
    if (Object.prototype.hasOwnProperty.call(p, 'color')) {
      signaling.publishProfile(next.color);
      signaling.updateRoomProfile({ color: next.color });
    }
    // Roommates see your name via presence — keep it fresh too.
    if (Object.prototype.hasOwnProperty.call(p, 'displayName')) {
      signaling.updateRoomProfile({ name: selfName() });
    }
    // Reconnect the mesh if the signaling backend changed; refresh ICE servers
    // (STUN/TURN) in place if only the relay config changed.
    if (Object.prototype.hasOwnProperty.call(p, 'supabase')) {
      restartNetworking();
    } else if (Object.prototype.hasOwnProperty.call(p, 'turn') && netWin) {
      netWin.webContents.send('mesh:config', { iceServers: buildIceServers() });
    }
    if (petWin) petWin.webContents.send('config:updated', next);
    // Freeze/thaw friends' frogs too when the master animations switch flips.
    if (Object.prototype.hasOwnProperty.call(p, 'animations')) {
      for (const w of remoteWins.values()) {
        w.webContents.send('anim:enabled', { on: next.animations !== false });
      }
    }
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
  // Preview the journal reminder on demand: the frog hops + dances and flashes
  // the journal icon (a one-off notification), just like the hourly nag.
  ipcMain.on('pet:test-jump', () => nag());

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
    // Let roommates (who have no P2P link) see the frog bounce too. The per-key
    // squish pulse is skipped so we don't fire a broadcast on every keystroke —
    // the actual hops/jumps still carry the movement.
    if (msg && msg.type !== 'key') signaling.broadcastRoom(msg);
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
    if (!SUPPORTS_CLICK_THROUGH) return; // stays interactive on Linux
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
  // "Add friend" on a frog's hover overlay: invite the owner (a room member you
  // don't know yet) — or, if they already invited you, accept on the spot.
  ipcMain.on('remote:add-friend', (_e, { id }) => {
    const cfg = config.load();
    if (!id || !signaling.isConfigured(cfg) || id === cfg.selfId) return;
    const friends = [...(cfg.friends || [])];
    const existing = friends.find((f) => f.id === id);
    if (existing && existing.status === 'accepted') return;
    const label = ((roomMembers.get(id) || {}).name || friendLabel(id) || '').trim();

    // They already asked us → this is a mutual accept, link up immediately.
    if (existing && existing.status === 'incoming') {
      existing.status = 'accepted';
      if (label && (!existing.label || existing.label === 'Friend')) existing.label = label;
      config.save({ friends });
      signaling.sendAccept(id, selfName());
      signaling.addPair(id);
      roomFrogIds.delete(id);
      updateRemoteMeta(id);
      pushFriends();
      return;
    }

    // Re-sending a pending invite is harmless (e.g. they just came online).
    if (existing && existing.status === 'pending') {
      signaling.sendRequest(id, selfName());
      updateRemoteMeta(id);
      return;
    }

    friends.push({ id, label, status: 'pending' });
    config.save({ friends });
    signaling.sendRequest(id, selfName());
    updateRemoteMeta(id);
    pushFriends();
  });

  // The X on a friend's frog breaks the link (and removes you from theirs).
  // On a room-only frog it just hides the window locally — they stay in the
  // room (and in the members list) and reappear next time they rejoin.
  ipcMain.on('remote:remove', (_e, { id }) => {
    if (roomFrogIds.has(id) && !isAcceptedFriend(id)) {
      roomFrogIds.delete(id);
      despawnRemoteFrog(id);
      return;
    }
    removeFriendLocally(id);
  });

  // First-run: save the frog's name (and the color chosen in the same window).
  ipcMain.on('name:save', (_e, payload) => {
    const name = typeof payload === 'string' ? payload : payload && payload.name;
    const color = payload && payload.color;
    const n = String(name || '').trim();
    const patch = {};
    if (n) patch.displayName = n;
    if (color) patch.color = color;
    if (Object.keys(patch).length) {
      const next = config.save(patch);
      if (petWin) petWin.webContents.send('config:updated', next);
    }
  });

  // First-run: live-preview a color choice on the perched frog.
  ipcMain.on('name:color', (_e, color) => {
    if (!color) return;
    const next = config.save({ color: String(color) });
    if (petWin) petWin.webContents.send('config:updated', next);
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
    pushFriends(); // show the new pending row right away
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
    roomFrogIds.delete(id); // their frog (if in the room) is now the friendship's
    updateRemoteMeta(id); // drop the "add friend" pill on their frog
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

  // --- Rooms ---------------------------------------------------------------
  ipcMain.handle('room:status', () => ({
    room: currentRoom,
    members: [...roomMembers.entries()].map(([id, m]) => ({ id, ...m }))
  }));
  ipcMain.handle('room:join', (_e, { name }) => joinRoomLocal(name));
  ipcMain.handle('room:leave', () => {
    leaveRoomLocal();
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
  waterReminder.reschedule();
  if (!config.load().displayName) openNameWindow();

  // Quietly check GitHub for a newer release a few seconds after launch, once
  // things have settled. Stays silent when up to date or offline.
  setTimeout(() => updater.checkForUpdates({ silent: true }), 8000);

  app.on('activate', () => {
    if (!petWin) createPetWindow();
  });
});

// Keep running as a background pet even with no visible standard windows.
app.on('window-all-closed', (e) => {
  if (!quitting) e.preventDefault();
});
