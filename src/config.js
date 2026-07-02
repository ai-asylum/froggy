const { app } = require('electron');
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
  // Position is stored so the frog reappears where you left it.
  position: null,
  // Author handle written into note frontmatter.
  author: 'ruben.gres',
  autoLaunch: true,
  // When the destination folder is a git repo, commit + push after saving.
  autoPush: false
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

module.exports = { load, save, DEFAULTS, CONFIG_PATH };
