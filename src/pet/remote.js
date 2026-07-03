// Remote frog driver: one of these runs per online friend. It replays the
// animation beats received from that peer (over the P2P data channel, relayed
// here by main) and lets you drag it around or click it to send a message.

const params = new URLSearchParams(location.search);
const friendId = params.get('id') || '';
const friendLabel = params.get('label') || 'Friend';
const friendColor = params.get('color') || 'green';

const canvas = document.getElementById('frog');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubbletext');
const bubbleClose = document.getElementById('bubbleclose');
const nametag = document.getElementById('nametag');
const closeBtn = document.getElementById('close');
nametag.textContent = friendLabel;

const initialScale = Number(params.get('scale')) > 0 ? Number(params.get('scale')) : 1;
const engine = window.createFrogEngine(canvas, { remote: true, scale: initialScale });

// Grow/shrink the whole frog with the shared `scale` setting (the window is
// resized to match by main; the engine needs the factor for hit testing).
function applyScale(scale) {
  const s = Number(scale) > 0 ? Number(scale) : 1;
  document.documentElement.style.setProperty('--scale', String(s));
  engine.setScale(s);
}
applyScale(initialScale);

// Show the friend's last-known skin right away (falls back to green for a brand
// new friend); the live color still arrives via a peer event once connected.
engine.setColor(friendColor, { silent: true });
// Start turned away until we learn the peer is actually connected.
engine.setAway(true);

// Beats from the peer (color, key, hop, jump, sleep, wake, idle).
window.api.on('peer:event', (msg) => engine.applyRemote(msg));

// The shared size setting changed.
window.api.on('peer:scale', ({ scale }) => applyScale(scale));

// Online/offline (P2P) — turn the frog's back when it's not connected.
window.api.on('peer:presence', ({ online }) => engine.setAway(!online));

let bubbleTimer = null;
function hideBubble() {
  bubble.classList.remove('visible');
}

// A direct message (DM): regular bubble that stays until closed with the X.
window.api.on('msg:show', ({ text }) => {
  clearTimeout(bubbleTimer);
  bubbleText.textContent = text;
  bubble.classList.remove('shout');
  bubble.classList.add('dm', 'visible');
});

// A shout: red-outlined, all caps, auto-hides after a few seconds.
window.api.on('shout:show', ({ text }) => {
  clearTimeout(bubbleTimer);
  bubbleText.textContent = String(text || '').toUpperCase();
  bubble.classList.remove('dm');
  bubble.classList.add('shout', 'visible');
  bubbleTimer = setTimeout(hideBubble, 8000);
});

bubbleClose.addEventListener('click', (e) => {
  e.stopPropagation();
  hideBubble();
});

// --- Hit testing ----------------------------------------------------------
// The canvas is offset from the window top, so convert to canvas-local coords.
function toCanvas(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// Geometry-based (works even while the button is faded out) so the corner acts
// as a hot zone that can re-reveal the controls once they've hidden.
function overClose(x, y) {
  const r = closeBtn.getBoundingClientRect();
  if (!r.width) return false;
  const pad = 8;
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}

// Only DM bubbles are interactive (they hold the close X).
function overBubble(x, y) {
  if (!bubble.classList.contains('dm') || !bubble.classList.contains('visible')) return false;
  const r = bubble.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

let interactive = false;
function setInteractive(next) {
  if (next === interactive) return;
  interactive = next;
  window.api.send('remote:set-ignore', { id: friendId, ignore: !next });
}

function showControls(on) {
  nametag.classList.toggle('visible', on);
  closeBtn.classList.toggle('visible', on);
}

// Keep the controls up (and the window clickable) with a short grace period so
// they don't vanish while the cursor crosses from the frog toward the button.
let hideTimer = null;
function keepControls() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  showControls(true);
  setInteractive(true);
}
function releaseControls() {
  if (hideTimer) return;
  hideTimer = setTimeout(() => {
    hideTimer = null;
    showControls(false);
    setInteractive(false);
  }, 400);
}
function hideControlsNow() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  showControls(false);
  setInteractive(false);
}

// --- Drag vs click --------------------------------------------------------
let down = null;

window.addEventListener('mousemove', (e) => {
  if (down) {
    const dx = e.screenX - down.screenX;
    const dy = e.screenY - down.screenY;
    if (!down.moved && Math.hypot(dx, dy) > 4) down.moved = true;
    if (down.moved) {
      window.api.send('remote:move', { id: friendId, x: down.winX + dx, y: down.winY + dy });
    }
    return;
  }
  const c = toCanvas(e);
  const hot =
    engine.overFrog(c.x, c.y) || overClose(e.clientX, e.clientY) || overBubble(e.clientX, e.clientY);
  if (hot) {
    keepControls();
  } else if (closeBtn.classList.contains('visible')) {
    releaseControls();
  } else {
    setInteractive(false);
  }
});

document.addEventListener('mouseleave', () => {
  if (down) return;
  hideControlsNow();
});
window.addEventListener('blur', () => {
  if (down) return;
  hideControlsNow();
});

closeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.api.send('remote:remove', { id: friendId });
});
closeBtn.addEventListener('mouseenter', keepControls);

window.addEventListener('mousedown', (e) => {
  if (e.target === closeBtn || closeBtn.contains(e.target)) return;
  const c = toCanvas(e);
  if (!engine.overFrog(c.x, c.y)) return;
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
    window.api.send('remote:move-end', { id: friendId });
  } else {
    // A plain click opens the message composer aimed at this friend.
    window.api.send('remote:click', { id: friendId });
  }
});
