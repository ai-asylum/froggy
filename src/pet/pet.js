// Local frog driver. The animation itself lives in the shared engine
// (engine.js); this file wires the local frog to the keyboard/attention events
// from main, handles dragging + the gear/quit buttons, and forwards every
// visible beat to main so it can be broadcast to friends' frogs.

const canvas = document.getElementById('frog');
const gear = document.getElementById('gear');
const quit = document.getElementById('quit');
const friendBtn = document.getElementById('friend');
const journalBtn = document.getElementById('journal');
const shoutBtn = document.getElementById('shout');
const buttons = [friendBtn, journalBtn, shoutBtn, gear, quit];

// Local beats are streamed to main, which relays them to connected peers.
const engine = window.createFrogEngine(canvas, {
  remote: false,
  onEvent: (msg) => window.api.send('net:local-event', msg)
});

// --- Messages from main ----------------------------------------------------
window.api.on('anim:key', () => engine.onKey());
window.api.on('anim:idle', () => engine.idle());
window.api.on('anim:sleep', () => engine.sleep());
window.api.on('anim:wake', () => engine.wake());
window.api.on('anim:jump', () => engine.forceJump());
window.api.on('anim:dance', () => engine.dance());
window.api.on('attention:stop', () => {});
window.api.on('entry:saved', () => engine.celebrate());
window.api.on('config:updated', (cfg) => {
  if (cfg && cfg.color) engine.setColor(cfg.color);
});

// Pick up the configured color on launch (silent: don't broadcast on boot).
window.api.invoke('settings:get').then((cfg) => {
  if (cfg && cfg.color) engine.setColor(cfg.color, { silent: true });
});

// --- Pixel-perfect click-through ------------------------------------------
let interactive = false;

function setInteractive(next) {
  if (next === interactive) return;
  interactive = next;
  window.api.send('pet:set-ignore', !next);
}

function overButtons(x, y) {
  if (!gear.classList.contains('visible')) return false;
  const pad = 6;
  return buttons.some((b) => {
    const r = b.getBoundingClientRect();
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  });
}

// --- Drag vs click ---------------------------------------------------------
let down = null;
let hideTimer = null;

function keepGear() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  buttons.forEach((b) => b.classList.add('visible'));
  setInteractive(true);
}

function releaseGear() {
  if (hideTimer) return;
  hideTimer = setTimeout(() => {
    hideTimer = null;
    buttons.forEach((b) => b.classList.remove('visible'));
    setInteractive(false);
  }, 600);
}

window.addEventListener('mousemove', (e) => {
  if (down) {
    const dx = e.screenX - down.screenX;
    const dy = e.screenY - down.screenY;
    if (!down.moved && Math.hypot(dx, dy) > 4) down.moved = true;
    if (down.moved) {
      window.api.send('pet:move', { x: down.winX + dx, y: down.winY + dy });
    }
    return;
  }
  const hot = engine.overFrog(e.clientX, e.clientY) || overButtons(e.clientX, e.clientY);
  if (hot) {
    keepGear();
  } else if (gear.classList.contains('visible')) {
    releaseGear();
  } else {
    setInteractive(false);
  }
});

function hideButtons() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  buttons.forEach((b) => b.classList.remove('visible'));
  setInteractive(false);
}

document.addEventListener('mouseleave', () => {
  if (down) return;
  hideButtons();
});
window.addEventListener('blur', () => {
  if (down) return;
  hideButtons();
});

window.addEventListener('mousedown', (e) => {
  if (buttons.some((b) => b === e.target || b.contains(e.target))) return;
  if (!engine.overFrog(e.clientX, e.clientY)) return;
  down = {
    screenX: e.screenX,
    screenY: e.screenY,
    winX: window.screenX,
    winY: window.screenY,
    moved: false
  };
});

window.addEventListener('mouseup', () => {
  if (!down) return;
  const wasDrag = down.moved;
  down = null;
  if (wasDrag) {
    window.api.send('pet:move-end');
  } else {
    window.api.send('pet:click');
  }
});

friendBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.api.send('pet:open-friends');
});
journalBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.api.send('pet:open-journal');
});
shoutBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.api.send('pet:open-shout');
});
gear.addEventListener('click', (e) => {
  e.stopPropagation();
  window.api.send('pet:open-settings');
});
quit.addEventListener('click', (e) => {
  e.stopPropagation();
  window.api.send('app:quit');
});
buttons.forEach((b) => b.addEventListener('mouseenter', () => keepGear()));
