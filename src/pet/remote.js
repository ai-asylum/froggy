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
const meta = document.getElementById('meta');
const nametag = document.getElementById('nametag');
const roomtag = document.getElementById('roomtag');
const addFriendBtn = document.getElementById('addfriend');
const closeBtn = document.getElementById('close');
nametag.textContent = friendLabel;

// Room + friendship state drive the hover overlay: the room chip shows which
// room this frog is linked to, and the "add friend" pill lets you befriend a
// stranger (a room member you're not friends with yet). main keeps both fresh
// via `remote:meta` as the room changes or the friendship progresses.
function applyMeta({ room, status } = {}) {
  const inRoom = !!(room && String(room).trim());
  roomtag.textContent = inRoom ? `#${room}` : '';
  roomtag.classList.toggle('visible', inRoom);

  // Icon-only pill: convey the state through color (the .pending / .incoming
  // classes) and the tooltip, since there's no longer a text label.
  addFriendBtn.classList.remove('pending', 'incoming');
  const setTip = (t) => {
    addFriendBtn.title = t;
    addFriendBtn.setAttribute('aria-label', t);
  };
  if (status === 'accepted') {
    addFriendBtn.classList.remove('visible');
  } else if (status === 'pending') {
    addFriendBtn.classList.add('visible', 'pending');
    setTip('Invited');
  } else if (status === 'incoming') {
    addFriendBtn.classList.add('visible', 'incoming');
    setTip('Accept friend request');
  } else {
    addFriendBtn.classList.add('visible');
    setTip('Add friend');
  }
}
applyMeta({ room: params.get('room') || '', status: params.get('status') || '' });
window.api.on('remote:meta', applyMeta);

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

// Master animations switch — freeze/thaw this friend's frog to a static pose.
window.api.on('anim:enabled', ({ on }) => engine.setAnimationsEnabled(on));

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

// The "add friend" pill is only interactive while it's actually shown.
function overAddFriend(x, y) {
  if (!addFriendBtn.classList.contains('visible')) return false;
  const r = addFriendBtn.getBoundingClientRect();
  if (!r.width) return false;
  const pad = 6;
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
  meta.classList.toggle('visible', on);
  closeBtn.classList.toggle('visible', on);
}

// Keep the controls up (and the window clickable) once revealed.
function keepControls() {
  showControls(true);
  setInteractive(true);
}
function hideControlsNow() {
  showControls(false);
  setInteractive(false);
  addFriendBtn.classList.remove('hot');
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
  const onAdd = overAddFriend(e.clientX, e.clientY);
  // Reliable hover feedback: CSS `:hover` is flaky on the click-through overlay,
  // so mirror the hit-test result onto a `.hot` class the styles also key off.
  addFriendBtn.classList.toggle('hot', onAdd);
  const hot =
    engine.overFrog(c.x, c.y) ||
    overClose(e.clientX, e.clientY) ||
    onAdd ||
    overBubble(e.clientX, e.clientY);
  // Once the hover controls are up, keep the whole window interactive while the
  // pointer stays inside it — so the small overlay buttons (add friend / remove)
  // are reliable click targets instead of a race against the click-through
  // toggle. It's released the moment the pointer leaves (mouseleave / blur).
  if (hot || closeBtn.classList.contains('visible')) {
    keepControls();
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

// Add the frog's owner as a friend (or accept them if they already asked). The
// pill flips to "Invited"/"Accept"/hidden once main echoes the new state back.
addFriendBtn.addEventListener('mouseenter', keepControls);
addFriendBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (addFriendBtn.classList.contains('pending')) return; // already invited
  // Quick pop so the click registers even before main echoes the state flip.
  addFriendBtn.classList.add('sent');
  addFriendBtn.addEventListener('animationend', () => addFriendBtn.classList.remove('sent'), { once: true });
  window.api.send('remote:add-friend', { id: friendId });
});

// Whether this frog is a non-friend we can still invite (or accept): the pill
// is showing and it isn't an already-sent ("pending") invite. Used so a plain
// click anywhere on the frog body invites them — a far bigger, more reliable
// target than the small pill on a click-through overlay.
function canInvite() {
  return addFriendBtn.classList.contains('visible') && !addFriendBtn.classList.contains('pending');
}

window.addEventListener('mousedown', (e) => {
  if (e.target === closeBtn || closeBtn.contains(e.target)) return;
  if (e.target === addFriendBtn || addFriendBtn.contains(e.target)) return;
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
  } else if (canInvite()) {
    // Not friends yet: a tap anywhere on the frog invites them (or accepts a
    // pending invite from them) — same as the pill, just an easier target.
    window.api.send('remote:add-friend', { id: friendId });
  } else {
    // A plain click on a friend's frog opens the message composer.
    window.api.send('remote:click', { id: friendId });
  }
});
