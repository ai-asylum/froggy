const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const apps = require('./apps/registry');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

const DEFAULT_DEST = path.join(os.homedir(), '.froggy');

const DEFAULTS = {
  destFolder: DEFAULT_DEST,
  color: 'green',
  intervalMinutes: 60,
  opacity: 1,
  // Visual size of your own frog (1 = default). Applied to the pet window and
  // the sprite so the whole thing grows/shrinks together.
  scale: 1,
  // When off, the frog stops charging/squishing (and hopping) as you type.
  typingSquish: true,
  // Master switch: when off, every frog freezes to a static pose (no idle bob,
  // hops, dances, sleep, or squish) — both your frog and friends'.
  animations: true,
  // When on, clicking your frog makes it squish — the same little charge/hop
  // beat as typing. Purely local flair and stacks with whatever the tap does.
  squishOnClick: false,
  // macOS: keep your frog (and friends' frogs) visible on every desktop/Space,
  // so they follow you when you switch desktops. When off, each frog stays on
  // the desktop it's currently on. macOS-only in the UI; harmless elsewhere.
  allDesktops: false,
  // Per-app settings, keyed by app id (e.g. `apps.pomodoro`). Each app declares
  // its own defaults in src/apps/<id>/settings.js and reads/writes them via
  // config.loadApp(id) / config.saveApp(id, patch); only overrides are stored
  // here, so this stays empty until an app's settings are changed.
  apps: {},
  // Quick-launch slots. The first three are the arc buttons around the frog
  // (left / top / right); the fourth is the frog itself, shown as a badge on its
  // body. Each entry is an app id (from src/apps/registry.js) or null for an
  // empty "+" slot.
  slots: [null, 'journal', 'shout', null],
  // Whether the frog itself acts as the 4th quick-launch slot. When off, the
  // frog shows no badge and a tap falls back to opening the journal.
  frogButton: false,
  // Position is stored so the frog reappears where you left it.
  position: null,
  // Author handle written into note frontmatter.
  author: 'ruben.gres',
  autoLaunch: true,
  // Whether we've already shown the macOS Accessibility permission card. Keeps
  // the ask to a single, one-time prompt instead of every launch.
  askedAccessibility: false,
  // When the destination folder is a git repo, commit + push after saving.
  autoPush: false,

  // --- Multiplayer ---------------------------------------------------------
  // A short, shareable friend code (e.g. "7K2Q-9XPN"), also used as the id.
  selfId: null,
  // The name friends see on a request. Falls back to `author` when empty.
  displayName: '',
  // Friends: [{ id, label, status }] where status is one of
  // 'pending' (you asked, awaiting them), 'incoming' (they asked you),
  // 'accepted' (mutual — their frog spawns when online).
  friends: [],
  // Last-known window position for each remote frog, keyed by friend id.
  remotePositions: {},
  // The room currently joined ('' = none). A frog can only be in one room at a
  // time; persisted so we rejoin it on the next launch.
  room: '',
  // Supabase is used only to link peers (signaling + presence). No frog
  // state or messages ever pass through it — those go P2P over WebRTC.
  // Ships with a shared default project so multiplayer works out of the box;
  // the anon key is public by design (row-level security guards the data) and
  // can be overridden in Settings → Connection setup.
  supabase: {
    url: 'https://aqifzekdejwwsaptupem.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxaWZ6ZWtkZWp3d3NhcHR1cGVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwMTE3MjgsImV4cCI6MjA5ODU4NzcyOH0.QdPNyzA59agtjurIHP_7cKVUw45sTm9bz4_Ln1RBRug'
  },
  // TURN relay used only when a direct P2P connection can't be established.
  turn: { urls: '', username: '', credential: '' }
};

// The defaults an app declares in src/apps/<id>/settings.js, surfaced via the
// registry. Empty for apps that don't persist any settings.
function appDefaults(id) {
  const a = apps.get(id);
  return a && a.settings && a.settings.defaults ? { ...a.settings.defaults } : {};
}

// Older builds stored each app's settings as a top-level key (e.g. `pomodoro`).
// Fold any of those into the namespaced `apps` section and drop the old keys, so
// on disk every app's settings live together under one `apps` object. Existing
// (namespaced) values win over the legacy ones.
const LEGACY_APP_KEYS = ['pomodoro', 'countdown', 'water'];
function normalizeApps(cfg) {
  const appsCfg = { ...(cfg.apps || {}) };
  for (const id of LEGACY_APP_KEYS) {
    if (cfg[id] && typeof cfg[id] === 'object') {
      appsCfg[id] = { ...cfg[id], ...(appsCfg[id] || {}) };
    }
    delete cfg[id];
  }
  cfg.apps = appsCfg;
  return cfg;
}

function load() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const cfg = { ...DEFAULTS, ...JSON.parse(raw) };
    // Backfill the shared Supabase project for configs saved by older builds
    // (which persisted empty credentials) so multiplayer works without setup.
    const sb = cfg.supabase || {};
    if (!sb.url || !sb.anonKey) {
      cfg.supabase = {
        url: sb.url || DEFAULTS.supabase.url,
        anonKey: sb.anonKey || DEFAULTS.supabase.anonKey
      };
    }
    return normalizeApps(cfg);
  } catch {
    return normalizeApps({ ...DEFAULTS });
  }
}

function save(patch) {
  const next = { ...load(), ...patch };
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save config:', err);
  }
  return next;
}

// One app's settings, its declared defaults filled in for anything unset.
function loadApp(id) {
  const cfg = load();
  return { ...appDefaults(id), ...((cfg.apps || {})[id] || {}) };
}

// Persist a patch for a single app's settings, leaving every other app (and the
// global settings) untouched. Returns the full, normalized config.
function saveApp(id, patch) {
  const cfg = load();
  const appsCfg = { ...(cfg.apps || {}) };
  appsCfg[id] = { ...(appsCfg[id] || {}), ...(patch || {}) };
  return save({ apps: appsCfg });
}

// Rewrite the config once in the normalized shape, folding any legacy top-level
// per-app keys into `apps`. Safe to call on every launch; a no-op once migrated.
function migrate() {
  return save({});
}

// Crockford-style base32 without ambiguous characters (no I, L, O, U).
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

// A short, readable friend code like "7K2Q-9XPN".
function generateCode() {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[bytes[i] % 32];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

// Normalize user-typed codes: uppercase, drop spaces, re-insert the dash.
function normalizeCode(input) {
  const raw = String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (raw.length === 8) return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
  return String(input || '').trim().toUpperCase();
}

// Generate and persist a short friend code on first run (migrating any older
// uuid-style id to the new short format).
function ensureIdentity() {
  const cfg = load();
  if (!CODE_RE.test(cfg.selfId || '')) return save({ selfId: generateCode() });
  return cfg;
}

module.exports = {
  load,
  save,
  loadApp,
  saveApp,
  migrate,
  ensureIdentity,
  generateCode,
  normalizeCode,
  isValidCode: (c) => CODE_RE.test(String(c || '')),
  DEFAULTS,
  CONFIG_PATH
};
