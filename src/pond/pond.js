// Renderer for the pond window. Main sends the pond art + furniture catalog
// (spritesheets inlined as data URLs — file:// is blocked by CSP) once, then
// streams furniture updates as people place, move, resize, or remove pieces.
// Everything here works in *pond coordinates*: the window is the pond, so
// client coords are pond coords, and main translates them for roommates.
//
// Your own pieces drag with the pointer (position broadcast on release), resize
// on scroll, and remove via the × or a right-click. A roommate's piece is
// view-only. Frogs are separate OS windows floating above this one; main keeps
// them glued to the pond.

const stageEl = document.getElementById('stage');
const bgEl = document.getElementById('bg');
const piecesEl = document.getElementById('pieces');
const chipEl = document.getElementById('chip');

const MIN_SCALE = 1;
const MAX_SCALE = 12;

let sheets = {}; // sheetId -> { dataUrl, w, h }
let itemsById = new Map(); // itemId -> catalog item ({ sheet, x, y, w, h, ... })
const pieces = new Map(); // uid -> { el, entry }
let dragging = null; // { uid, entry, offX, offY } while a piece is being dragged

// The pond's coordinate space is the water itself (#stage), which is inset from
// the window by the transparent margin — not the full window.
function pondW() {
  return stageEl.clientWidth || window.innerWidth;
}
function pondH() {
  return stageEl.clientHeight || window.innerHeight;
}

function clampPos(entry, w, h) {
  entry.px = Math.max(0, Math.min(Math.round(entry.px), pondW() - w));
  entry.py = Math.max(0, Math.min(Math.round(entry.py), pondH() - h));
}

// Paint one piece: its slice of the spritesheet at its scale and position.
// z-order follows the piece's baseline so lower pieces draw in front (painter's
// order), keeping overlaps looking right.
function renderPiece(p) {
  const item = itemsById.get(p.entry.itemId);
  const sheet = item && sheets[item.sheet];
  if (!item || !sheet || !sheet.dataUrl) return;
  const s = p.entry.scale;
  const w = item.w * s;
  const h = item.h * s;
  clampPos(p.entry, w, h);
  p.el.style.width = w + 'px';
  p.el.style.height = h + 'px';
  p.el.style.left = p.entry.px + 'px';
  p.el.style.top = p.entry.py + 'px';
  p.el.style.backgroundImage = `url(${sheet.dataUrl})`;
  p.el.style.backgroundSize = `${sheet.w * s}px ${sheet.h * s}px`;
  p.el.style.backgroundPosition = `-${item.x * s}px -${item.y * s}px`;
  p.el.style.zIndex = String(100 + Math.round(p.entry.py + h));
}

// The largest scale at which this item still fits inside the pond.
function maxFittingScale(item) {
  return Math.max(
    MIN_SCALE,
    Math.min(MAX_SCALE, Math.floor(pondW() / item.w), Math.floor(pondH() / item.h))
  );
}

function wireOwnedPiece(p) {
  const el = p.el;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove';
  removeBtn.title = 'Remove';
  removeBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.api.send('pond:furn-remove', { uid: p.entry.uid });
  });
  el.appendChild(removeBtn);

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.api.send('pond:furn-remove', { uid: p.entry.uid });
  });

  // Drag within the pond. Position updates live locally; the final resting
  // spot is sent to main on release (persist + broadcast to the room).
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target === removeBtn || removeBtn.contains(e.target)) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    dragging = { uid: p.entry.uid, p, offX: e.clientX - p.entry.px, offY: e.clientY - p.entry.py };
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging || dragging.uid !== p.entry.uid) return;
    p.entry.px = e.clientX - dragging.offX;
    p.entry.py = e.clientY - dragging.offY;
    renderPiece(p);
  });
  const endDrag = () => {
    if (!dragging || dragging.uid !== p.entry.uid) return;
    dragging = null;
    window.api.send('pond:furn-move', { uid: p.entry.uid, px: p.entry.px, py: p.entry.py });
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  // Scroll to resize (around the piece's centre), clamped to fit the pond.
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const item = itemsById.get(p.entry.itemId);
      if (!item) return;
      const step = e.deltaY < 0 ? 1 : -1;
      const next = Math.min(maxFittingScale(item), Math.max(MIN_SCALE, p.entry.scale + step));
      if (next === p.entry.scale) return;
      const cx = p.entry.px + (item.w * p.entry.scale) / 2;
      const cy = p.entry.py + (item.h * p.entry.scale) / 2;
      p.entry.scale = next;
      p.entry.px = Math.round(cx - (item.w * next) / 2);
      p.entry.py = Math.round(cy - (item.h * next) / 2);
      renderPiece(p);
      window.api.send('pond:furn-scale', {
        uid: p.entry.uid,
        scale: p.entry.scale,
        px: p.entry.px,
        py: p.entry.py
      });
    },
    { passive: false }
  );
}

function upsertPiece(entry) {
  let p = pieces.get(entry.uid);
  if (!p) {
    const el = document.createElement('div');
    el.className = 'piece' + (entry.owned ? ' owned' : '');
    piecesEl.appendChild(el);
    p = { el, entry };
    pieces.set(entry.uid, p);
    if (entry.owned) wireOwnedPiece(p);
  } else {
    // Never yank a piece out from under the pointer mid-drag; keep the local
    // position and only take the rest of the update.
    if (dragging && dragging.uid === entry.uid) {
      entry = { ...entry, px: p.entry.px, py: p.entry.py };
    }
    p.entry = entry;
  }
  renderPiece(p);
}

// Reconcile the full furniture list (mine + roommates') in place, so a piece
// being dragged isn't recreated by an unrelated update.
function applyFurniture(list) {
  const seen = new Set();
  for (const entry of list || []) {
    if (!entry || !entry.uid) continue;
    seen.add(entry.uid);
    upsertPiece(entry);
  }
  for (const [uid, p] of [...pieces]) {
    if (seen.has(uid)) continue;
    p.el.remove();
    pieces.delete(uid);
  }
}

function setRoom(room, members) {
  if (room) {
    const n = Number(members) || 0;
    chipEl.textContent = `${room} · ${n + 1} frog${n ? 's' : ''}`;
    chipEl.hidden = false;
  } else {
    chipEl.textContent = '';
    chipEl.hidden = true;
  }
}

// Bounce the whole stage in from scale 0. Replayed on every reopen.
function playAppear() {
  stageEl.classList.remove('appear');
  void stageEl.offsetWidth; // restart the animation
  stageEl.classList.add('appear');
}

window.api.on('pond:init', (payload) => {
  sheets = payload.sheets || {};
  itemsById = new Map((payload.items || []).map((it) => [it.id, it]));
  // Inset the whole stage by the margin main reserved around the window, so the
  // water floats with transparent breathing room. pondW()/pondH() read the
  // stage's own size, so pond coords stay anchored to the water.
  if (Number.isFinite(payload.margin)) {
    document.documentElement.style.setProperty('--pond-margin', `${payload.margin}px`);
  }
  if (Number.isFinite(payload.headroom)) {
    document.documentElement.style.setProperty('--pond-headroom', `${payload.headroom}px`);
  }
  if (payload.bg) bgEl.src = payload.bg;
  setRoom(payload.room, payload.members);
  applyFurniture(payload.furniture);
  playAppear();
});

window.api.on('pond:furniture', ({ furniture } = {}) => applyFurniture(furniture));
window.api.on('pond:room', ({ room, members } = {}) => setRoom(room, members));
window.api.on('pond:appear', () => playAppear());

// Hover is watched by main (the drag region eats the renderer's own mouse
// events); it drives the chip + button reveal.
window.api.on('pond:hover', ({ on } = {}) => document.body.classList.toggle('hovered', !!on));

// The pond's own actions: hop out (collapse to the lily pad), open the
// furniture picker, and the room panel.
document.getElementById('hopout').addEventListener('click', () => window.api.send('pond:hide'));
document.getElementById('decor').addEventListener('click', () => window.api.send('pond:open-furniture'));
document.getElementById('roominfo').addEventListener('click', () => window.api.send('pond:open-room'));
