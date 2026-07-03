const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
  // Pomodoro app: focus / break lengths in minutes.
  pomodoro: { workMinutes: 25, breakMinutes: 5 },
  // Water reminder app: how often to nudge, and what to say.
  water: { intervalMinutes: 60, message: 'Time to drink some water!' },
  // Countdown app: a one-shot timer length + the message shown when it ends.
  countdown: { minutes: 10, message: 'Time\u2019s up!' },
  // Quick-launch slots. The first three are the arc buttons around the frog
  // (left / top / right); the fourth is the frog itself, shown as a badge on its
  // body. Each entry is an app id (from src/apps/registry.js) or null for an
  // empty "+" slot.
  slots: [null, 'journal', 'shout', null],
  // Whether the frog itself acts as the 4th quick-launch slot. When off, the
  // frog shows no badge and a tap falls back to opening the journal.
  frogButton: true,
  // Position is stored so the frog reappears where you left it.
  position: null,
  // Author handle written into note frontmatter.
  author: 'ruben.gres',
  autoLaunch: true,
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
  supabase: { url: '', anonKey: '' },
  // TURN relay used only when a direct P2P connection can't be established.
  turn: { urls: '', username: '', credential: '' }
};

function load() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
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
  ensureIdentity,
  generateCode,
  normalizeCode,
  isValidCode: (c) => CODE_RE.test(String(c || '')),
  DEFAULTS,
  CONFIG_PATH
};
