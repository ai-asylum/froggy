const canvas = document.getElementById('frog');
const ctx = canvas.getContext('2d');
const gear = document.getElementById('gear');
const quit = document.getElementById('quit');
const buttons = [gear, quit];
ctx.imageSmoothingEnabled = false;

// Sprite sheet geometry: 4 columns x 9 rows of 16x16 frames.
const FRAME = 16;
const COLS = 4;
const SCALE = 4;
const DRAW = FRAME * SCALE; // 64px
const REST_X = 18; // frog anchored on the left; the right space holds the buttons
const REST_Y = canvas.height - DRAW - 6; // baseline near the bottom

// Sprite sheet animations (paste-ready from the editor). Frames are indices
// into the sheet, read left-to-right, top-to-bottom (row * COLS + col).
const ANIMATIONS = {
  "idle": {
    "loop": true,
    "arcHeight": 0,
    "arcStart": 0.15,
    "arcEnd": 0.85,
    "squash": 0,
    "frames": [
      { "frame": 0, "dur": 1000 },
      { "frame": 1, "dur": 1000 }
    ]
  },
  "hop": {
    "loop": false,
    "arcHeight": 18,
    "arcStart": 0.15,
    "arcEnd": 1,
    "squash": 0.3,
    "frames": [
      { "frame": 12, "dur": 60 },
      { "frame": 14, "dur": 150 },
      { "frame": 0, "dur": 90 }
    ]
  },
  "jump": {
    "loop": true,
    "arcHeight": 64,
    "arcStart": 0.12,
    "arcEnd": 0.85,
    "squash": 0.5,
    "frames": [
      { "frame": 12, "dur": 90 },
      { "frame": 15, "dur": 110 },
      { "frame": 14, "dur": 180 },
      { "frame": 12, "dur": 120 },
      { "frame": 13, "dur": 90 }
    ]
  }
};

// Frames used for the per-key charge squash feedback (not part of a clip).
const CHARGE_CROUCH = 12;
const CHARGE_SQUASH = 13;

// Eyes-closed calm pose used for the snooze animation.
const SLEEP_FRAME = 8;

function animDuration(anim) {
  return anim.frames.reduce((sum, f) => sum + f.dur, 0);
}

// Which frame is showing at `elapsed` ms into an animation.
function frameAt(anim, elapsed) {
  const total = animDuration(anim);
  let t = elapsed;
  if (anim.loop && total > 0) t %= total;
  let acc = 0;
  for (const f of anim.frames) {
    acc += f.dur;
    if (t < acc) return f.frame;
  }
  return anim.frames[anim.frames.length - 1].frame;
}

// Vertical lift from the animation's arc, scaled per launch (heightScale lets
// the charge meter stretch a clip's default apex up or down).
function arcOffset(anim, p, heightScale) {
  const apex = anim.arcHeight * heightScale;
  if (!apex || p <= anim.arcStart || p >= anim.arcEnd) return 0;
  const q = (p - anim.arcStart) / (anim.arcEnd - anim.arcStart);
  return apex * Math.sin(Math.PI * q);
}

// Signed squash-and-stretch for a clip, scaled by its `squash` amount:
// positive squashes on launch/landing contact, negative stretches while
// airborne (strongest at peak vertical speed, neutral at the apex).
function deformAt(anim, p) {
  const s = anim.squash || 0;
  if (!s) return 0;
  if (p < 0.12) return ((0.12 - p) / 0.12) * s;
  if (p > 0.88) return ((p - 0.88) / 0.12) * s;
  if (!anim.arcHeight) return 0;
  const q = Math.min(Math.max((p - anim.arcStart) / (anim.arcEnd - anim.arcStart), 0), 1);
  return -JUMP_STRETCH * s * 2 * Math.abs(Math.cos(Math.PI * q));
}

let sheet = new Image();
let sheetReady = false;
let outlineSheet = null; // white silhouette of the sheet, for the outline

// Turn every opaque pixel of the sheet white (keeping alpha) so we can stamp a
// pixel-perfect outline behind the frog.
function makeWhiteSilhouette(img) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

async function loadColor(color) {
  const dataUrl = await window.api.invoke('sprite:get', color);
  if (!dataUrl) return;
  const img = new Image();
  img.onload = () => {
    sheet = img;
    sheetReady = true;
    outlineSheet = makeWhiteSilhouette(img);
  };
  img.src = dataUrl;
}
loadColor('green');

// White outline, 8-directional. OUTLINE_WIDTH is in sprite-pixels: 1 = a full
// source pixel thick, 0.5 = sub-pixel (half as wide).
const OUTLINE_WIDTH = 0.5;
const OUTLINE_OFFSETS = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [-1, 1], [1, -1], [1, 1]
];

// --- Animation state -------------------------------------------------------
// Modes: 'play' (a clip from ANIMATIONS) | 'charge' (building a jump) | 'sleep'.
let mode = 'play';
let player = { name: 'idle', start: performance.now(), heightScale: 1 };
let sleepStart = 0;

function playAnim(name, heightScale = 1) {
  player = { name, start: performance.now(), heightScale };
  mode = 'play';
}

// Charge: builds while you type. Each key adds to it, capped at MAX_CHARGE.
// When you stop typing for RELEASE_MS, the frog springs into a jump whose
// height scales with how much you charged.
const MAX_CHARGE = 300; // characters
const RELEASE_MS = 600; // pause before it lets go
const MIN_JUMP = 12; // px, a tiny type-and-stop
const MAX_JUMP = 38; // px, ~300 chars (fits the window headroom)

// Per-key squash feedback: each keystroke pops the frog to a hard squash that
// springs back over ~PULSE_TAU ms, so every keypress is clearly visible.
const PULSE_TAU = 110; // ms decay of the per-key squash pulse
const PULSE_STRENGTH = 0.85; // how deep a single key squashes (0..1)

// How much a jumping clip elongates while flying fast (scaled by clip squash).
const JUMP_STRETCH = 0.6;

let charge = 0;
let lastKeyAt = 0;
let pulseAt = -1e9; // time of the most recent keystroke

function chargeRatio() {
  return Math.min(charge, MAX_CHARGE) / MAX_CHARGE;
}

// A key was pressed: (re)enter charge mode and top up the meter.
function onKey() {
  mode = 'charge'; // typing takes over any clip in flight
  charge = Math.min(charge + 1, MAX_CHARGE);
  const now = performance.now();
  lastKeyAt = now;
  pulseAt = now; // trigger a fresh squash pulse
}

// Release the spring. Height comes from the current charge unless forced
// (the hourly attention jump forces a full-height leap). Small springs use the
// quick hop clip; bigger ones use the full jump, scaled to the target apex.
function launchJump(forcedHeight) {
  const height = forcedHeight != null ? forcedHeight : MIN_JUMP + (MAX_JUMP - MIN_JUMP) * chargeRatio();
  const name = height >= 28 ? 'jump' : 'hop';
  playAnim(name, height / ANIMATIONS[name].arcHeight);
  charge = 0;
}

// Draw a frame, optionally lifted (yOffset) and deformed. `deform` is signed:
// positive squashes (shorter + wider), negative stretches (taller + narrower).
// The bottom edge (feet) stays planted at baseline - yOffset either way.
function drawFrame(frameIndex, yOffset, deform) {
  const sx = (frameIndex % COLS) * FRAME;
  const sy = Math.floor(frameIndex / COLS) * FRAME;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!sheetReady) return;

  const s = deform || 0; // >0 squash, <0 stretch
  const scaleY = 1 - 0.32 * s;
  const scaleX = 1 + 0.22 * s;
  const drawH = DRAW * scaleY;
  const drawW = DRAW * scaleX;
  const baseline = REST_Y + DRAW; // where the feet sit
  const drawX = REST_X - (drawW - DRAW) / 2;
  const drawY = baseline - drawH - yOffset;

  // White outline: stamp the white silhouette shifted one sprite-pixel in every
  // direction, then draw the real frame on top.
  if (outlineSheet) {
    const ox = (drawW / FRAME) * OUTLINE_WIDTH; // outline thickness, on screen
    const oy = (drawH / FRAME) * OUTLINE_WIDTH;
    for (const [dx, dy] of OUTLINE_OFFSETS) {
      ctx.drawImage(outlineSheet, sx, sy, FRAME, FRAME, drawX + dx * ox, drawY + dy * oy, drawW, drawH);
    }
  }

  ctx.drawImage(sheet, sx, sy, FRAME, FRAME, drawX, drawY, drawW, drawH);
}

// Floating "z z z" drifting up from the frog's head while it snoozes.
function drawZs(now) {
  const originX = REST_X + DRAW * 0.72;
  const originY = REST_Y + 6;
  const period = 2600;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 3; i++) {
    const ph = (((now - sleepStart) + (i * period) / 3) % period) / period; // 0..1
    const x = originX + Math.sin(ph * Math.PI * 2) * 4 + i * 3;
    const y = originY - ph * 26;
    const size = 6 + i * 2 + ph * 4;
    ctx.globalAlpha = Math.max(0, Math.sin(ph * Math.PI));
    ctx.font = `bold ${Math.round(size)}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(35,55,45,0.9)';
    ctx.fillStyle = '#ffffff';
    ctx.strokeText('z', x, y);
    ctx.fillText('z', x, y);
  }
  ctx.restore();
}

function tick(now) {
  if (mode === 'sleep') {
    // Slow breathing squash + drifting z's.
    const t = (now - sleepStart) / 1000;
    const breathe = 0.07 * (0.5 + 0.5 * Math.sin(t * 1.5));
    drawFrame(SLEEP_FRAME, 0, breathe);
    drawZs(now);
    requestAnimationFrame(tick);
    return;
  }

  if (mode === 'charge') {
    if (now - lastKeyAt >= RELEASE_MS) {
      launchJump(); // falls through to play the launched clip this frame
    } else {
      const r = chargeRatio();
      // Baseline compression grows slowly with how much you've typed, and each
      // keystroke adds a sharp pulse that springs back for instant feedback.
      const pulse = PULSE_STRENGTH * Math.exp(-(now - pulseAt) / PULSE_TAU);
      const sq = Math.min(1, 0.2 * r + pulse);
      // Swap to the flatter squash sprite while it's deeply compressed.
      const frame = sq > 0.5 ? CHARGE_SQUASH : CHARGE_CROUCH;
      drawFrame(frame, 0, sq);
      requestAnimationFrame(tick);
      return;
    }
  }

  let anim = ANIMATIONS[player.name] || ANIMATIONS.idle;
  let elapsed = now - player.start;
  // A finished one-shot clip settles back into the looping idle pose.
  if (!anim.loop && elapsed >= animDuration(anim) && player.name !== 'idle') {
    playAnim('idle');
    anim = ANIMATIONS.idle;
    elapsed = now - player.start;
  }
  const total = animDuration(anim);
  const p = anim.loop ? 0 : Math.min(elapsed / total, 1);
  drawFrame(frameAt(anim, elapsed), arcOffset(anim, p, player.heightScale), deformAt(anim, p));
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// --- Pixel-perfect click-through ------------------------------------------
let interactive = false;

function setInteractive(next) {
  if (next === interactive) return;
  interactive = next;
  window.api.send('pet:set-ignore', !next);
}

function overButtons(x, y) {
  if (!gear.classList.contains('visible')) return false;
  const pad = 6; // a little slop so they're easy to land on
  return buttons.some((b) => {
    const r = b.getBoundingClientRect();
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  });
}

function overFrog(x, y) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return false;
  try {
    const a = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3];
    return a > 8;
  } catch {
    return false;
  }
}

// --- Drag vs click ---------------------------------------------------------
let down = null; // { screenX, screenY, winX, winY, moved }

// The gear sits above the frog with a transparent gap between them. Without a
// grace period, crossing that gap flips the window back to click-through and
// hides the gear before the cursor arrives. So we keep it alive briefly.
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
  const hot = overFrog(e.clientX, e.clientY) || overButtons(e.clientX, e.clientY);
  if (hot) {
    keepGear();
  } else if (gear.classList.contains('visible')) {
    // Cursor left the frog but the gear is showing: stay interactive for a
    // moment so it can be reached across the gap.
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

// If the cursor leaves the window entirely (common when flicking off a corner
// button), hide immediately instead of waiting for a not-hot mousemove that
// may never come.
document.addEventListener('mouseleave', () => {
  if (down) return; // keep them while dragging
  hideButtons();
});
window.addEventListener('blur', () => {
  if (down) return;
  hideButtons();
});

window.addEventListener('mousedown', (e) => {
  if (buttons.some((b) => b === e.target || b.contains(e.target))) return; // buttons handle themselves
  if (!overFrog(e.clientX, e.clientY)) return;
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

gear.addEventListener('click', (e) => {
  e.stopPropagation();
  window.api.send('pet:open-settings');
});

quit.addEventListener('click', (e) => {
  e.stopPropagation();
  window.api.send('app:quit');
});

// Keep the buttons visible and clickable while the cursor is on them.
gear.addEventListener('mouseenter', () => keepGear());
quit.addEventListener('mouseenter', () => keepGear());

// --- Messages from main ----------------------------------------------------
// Each keystroke charges the spring.
window.api.on('anim:key', () => onKey());
// Settle back to idle (e.g. the input panel opened).
window.api.on('anim:idle', () => {
  charge = 0;
  playAnim('idle');
});
// Doze off after a long idle; wake back to idle on any activity.
window.api.on('anim:sleep', () => {
  mode = 'sleep';
  sleepStart = performance.now();
});
window.api.on('anim:wake', () => {
  if (mode === 'sleep') playAnim('idle');
});
// Hourly attention: force a full-height leap.
window.api.on('anim:jump', () => launchJump(MAX_JUMP));
window.api.on('attention:stop', () => {});
// A small celebratory hop when an entry is saved.
window.api.on('entry:saved', () => launchJump(20));
window.api.on('config:updated', (cfg) => {
  if (cfg && cfg.color) loadColor(cfg.color);
});

// Pick up the configured color on launch.
window.api.invoke('settings:get').then((cfg) => {
  if (cfg && cfg.color) loadColor(cfg.color);
});
