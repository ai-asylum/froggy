const { app, BrowserWindow, ipcMain, screen, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const notes = require('./notes');
const gitSync = require('./git');

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

// Pet window footprint. The sprite is drawn inside this with headroom for jumps.
const PET_W = 120;
const PET_H = 112;
const MARGIN = 24; // gap from screen edge on first launch

let petWin = null;
let inputWin = null;
let settingsWin = null;
let tray = null;

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
  const H = 360;
  // Center on whichever display the frog is currently on.
  const b = petUrl();
  const area = b
    ? screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea
    : screen.getPrimaryDisplay().workArea;
  settingsWin = new BrowserWindow({
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
    // Clicking acknowledges the nag: stop the attention jumping and open input.
    markActivity();
    stopAttention();
    openInputWindow();
  });
  ipcMain.on('pet:open-settings', () => openSettingsWindow());

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
    const next = config.save(patch || {});
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'autoLaunch')) applyAutoLaunch();
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'intervalMinutes')) scheduleHourly();
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'opacity') && petWin) {
      petWin.setOpacity(typeof next.opacity === 'number' ? next.opacity : 1);
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
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  registerIpc();
  createTray();
  createPetWindow();
  applyAutoLaunch();
  startKeyboardHook();
  scheduleHourly();
  startSleepWatch();

  app.on('activate', () => {
    if (!petWin) createPetWindow();
  });
});

// Keep running as a background pet even with no visible standard windows.
app.on('window-all-closed', (e) => {
  if (!quitting) e.preventDefault();
});
