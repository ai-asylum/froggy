// App registry.
//
// Froggy is a little desktop platform: each "app" lives in its own folder under
// src/apps/<id>/ and is described by one entry here. The settings window reads
// this list (over the `apps:list` IPC) to draw the Applications screen, and the
// main process uses `dir`/`window` to know which HTML to load.
//
// To add your own app:
//   1. Create src/apps/<your-id>/ with an index.html (+ css/js) for any window
//      it needs, mirroring `journal` or `shout`.
//   2. Add an entry below: a name, a one-line tagline, an accent color, and an
//      inline SVG icon (a single <path> is easiest).
//   3. Wire up whatever windows / IPC / behaviour it needs in main.js.
//   4. If it has settings, add `settingsView: '<id>'` and a matching view in
//      the settings window, plus a `settings: require('./<id>/settings')`
//      module declaring its defaults (see pomodoro/settings.js). Its values are
//      persisted under `apps.<id>` in the config; read/write them with
//      config.loadApp('<id>') / config.saveApp('<id>', patch).
//
// `icon` is raw SVG markup rendered inside a 24x24 viewBox tile.

const APPS = [
  {
    id: 'journal',
    name: 'Micro journal',
    tagline: 'Hops over to nudge you to jot down what you\u2019re up to.',
    color: '#22c55e',
    dir: 'journal',
    installed: true,
    settingsView: 'journal',
    icon: '<path fill="currentColor" d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H6zm0 2h1v16H6a0 0 0 0 1 0 0V4zm3 0h9v12H9V4zm2 2v2h5V6h-5zm0 3v2h5V9h-5z"/>'
  },
  {
    id: 'shout',
    name: 'Shout',
    tagline: 'Blast an all-caps message to every friend at once.',
    color: '#f59e0b',
    dir: 'shout',
    installed: true,
    settingsView: 'shout',
    icon: '<path fill="currentColor" d="M18 8v8l4 3V5l-4 3zM3 9v6a2 2 0 0 0 2 2h1v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3h1l5 4V5l-5 4H5a2 2 0 0 0-2 2v-2z"/>'
  },
  {
    id: 'pomodoro',
    name: 'Pomodoro',
    tagline: 'Focus / break timer that runs in the background.',
    color: '#ef4444',
    dir: 'pomodoro',
    installed: true,
    settingsView: 'pomodoro',
    settings: require('./pomodoro/settings'),
    icon: '<path fill="none" stroke="currentColor" stroke-width="2" d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 9v4l2.5 2.5M9 3h6"/>'
  },
  {
    id: 'water',
    name: 'Drink water',
    tagline: 'A gentle nudge to hydrate on your own schedule.',
    color: '#38bdf8',
    dir: 'water',
    installed: true,
    settingsView: 'water',
    settings: require('./water/settings'),
    icon: '<path fill="currentColor" d="M12 2.5S5.5 10 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10 12 2.5 12 2.5z"/>'
  },
  {
    id: 'countdown',
    name: 'Countdown',
    tagline: 'A one-shot timer that pops your message when it ends.',
    color: '#8b5cf6',
    dir: 'countdown',
    installed: true,
    settingsView: 'countdown',
    settings: require('./countdown/settings'),
    icon: '<path fill="currentColor" d="M6 2a1 1 0 0 0 0 2h1v3.6a4 4 0 0 0 1.79 3.33L11 12l-2.21 1.07A4 4 0 0 0 7 16.4V20H6a1 1 0 1 0 0 2h12a1 1 0 1 0 0-2h-1v-3.6a4 4 0 0 0-1.79-3.33L13 12l2.21-1.07A4 4 0 0 0 17 7.6V4h1a1 1 0 1 0 0-2H6zm3 2h6v3.6a2 2 0 0 1-.9 1.67L12 10.6l-2.1-1.33A2 2 0 0 1 9 7.6V4z"/>'
  }
];

// Everything the settings renderer needs to draw the Applications screen.
function list() {
  return APPS.map((a) => ({
    id: a.id,
    name: a.name,
    tagline: a.tagline,
    color: a.color,
    installed: !!a.installed,
    settingsView: a.settingsView || null,
    icon: a.icon
  }));
}

function get(id) {
  return APPS.find((a) => a.id === id) || null;
}

module.exports = { list, get, APPS };
