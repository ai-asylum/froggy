// Shout app — main-process side.
//
// A self-contained app (like pomodoro.js / water.js): main.js owns the peer
// mesh and the frog's geometry, and hands those in; this module owns the shout
// composer window and turns raw input into a normalized all-caps broadcast.
//
//   const shout = createShout({
//     getPetBounds: () => frogWindowBounds,   // or null when the frog is gone
//     broadcast: (text) => mesh.send(text),   // deliver to every friend
//     preloadPath: '/abs/path/to/preload.js'
//   });
//   shout.open();          // pop the composer above the frog
//   shout.send(rawText);   // normalize + broadcast (returns the sent text)

const path = require('path');
const { BrowserWindow, screen } = require('electron');

const MAX_LEN = 200;

// Everything a shout is: trimmed, capped, and SHOUTED IN CAPS.
function normalize(text) {
  return String(text || '')
    .trim()
    .toUpperCase()
    .slice(0, MAX_LEN);
}

function createShout({ getPetBounds, broadcast, preloadPath, margin = 24, bottomPad = 40 } = {}) {
  const petBounds = typeof getPetBounds === 'function' ? getPetBounds : () => null;
  const doBroadcast = typeof broadcast === 'function' ? broadcast : () => {};
  let win = null;

  // Pop the composer up like a speech bubble above the frog's head, flipping
  // below its feet only when there isn't room above.
  function open() {
    if (win) {
      win.show();
      win.focus();
      return;
    }
    const W = 280;
    const H = 150;
    const b = petBounds();
    const area = b
      ? screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea
      : screen.getPrimaryDisplay().workArea;
    let x = area.x + area.width - W - margin;
    let y = area.y + margin;
    if (b) {
      x = Math.min(Math.max(b.x + b.width / 2 - W / 2, area.x), area.x + area.width - W);
      y = b.y - H + 24;
      if (y < area.y) y = b.y + b.height - bottomPad - 10; // flip below if no room above
    }
    win = new BrowserWindow({
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
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(path.join(__dirname, 'index.html'));
    win.on('closed', () => {
      win = null;
    });
  }

  // Normalize raw input and broadcast it. Returns the sent text, or null when
  // the message was empty.
  function send(text) {
    const t = normalize(text);
    if (!t) return null;
    doBroadcast(t);
    return t;
  }

  return { open, send, normalize };
}

module.exports = { createShout, normalize };
