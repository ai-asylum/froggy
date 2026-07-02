'use strict';

const COLORS = ['green', 'orange', 'pink', 'brown', 'rnbw', 'blue'];
const SWATCH = {
  green: '#5fb85f',
  orange: '#e8973c',
  pink: '#e87fb0',
  brown: '#9c6b43',
  rnbw: 'linear-gradient(135deg,#e85a5a,#e8c85a,#5fb85f,#5a8fe8)',
  blue: '#5a8fe8'
};

// These defaults mirror src/pet/pet.js so the studio opens on the real values.
function defaults() {
  return {
    color: 'green',
    grid: { frameW: 16, frameH: 16, cols: 4, rows: 9, offsetX: 0, offsetY: 0, spacingX: 0, spacingY: 0 },
    sheetZoom: 8,
    previewScale: 6,
    showNums: true,
    current: 'jump',
    // Every behavioral knob the pet uses (mirrors src/pet/pet.js + main.js).
    params: {
      scale: 4,
      petW: 100,
      petH: 112,
      restPad: 6,
      idleFrame: 0,
      crouchFrame: 12,
      squashFrame: 13,
      upFrame: 14,
      highFrame: 15,
      sleepFrame: 8,
      maxChars: 300,
      releaseMs: 600,
      minJump: 12,
      maxJump: 38,
      savedHop: 20,
      durBase: 230,
      durPerPx: 3,
      arcClamp: 0.85,
      squashY: 0.32,
      squashX: 0.22,
      chargeSquashAt: 0.5,
      chargeBobAmp: 0.6,
      chargeBobSpeed: 90
    },
    anims: {
      idle: {
        loop: true,
        arcHeight: 0,
        arcStart: 0.15,
        arcEnd: 0.85,
        squash: 0,
        frames: [{ frame: 0, dur: 600 }]
      },
      hop: {
        loop: false,
        arcHeight: 18,
        arcStart: 0.15,
        arcEnd: 1.0,
        squash: 0.3,
        frames: [
          { frame: 12, dur: 60 },
          { frame: 14, dur: 150 },
          { frame: 0, dur: 90 }
        ]
      },
      jump: {
        loop: false,
        arcHeight: 38,
        arcStart: 0.12,
        arcEnd: 0.85,
        squash: 0.5,
        frames: [
          { frame: 12, dur: 90 },
          { frame: 15, dur: 110 },
          { frame: 14, dur: 180 },
          { frame: 12, dur: 120 },
          { frame: 13, dur: 90 }
        ]
      },
      // Snooze is a special mode in the pet: an eyes-closed pose that slowly
      // "breathes" while z's drift up. It's a single looping frame here so the
      // studio can preview and re-time it; the breathing + z's are procedural.
      snooze: {
        loop: true,
        arcHeight: 0,
        arcStart: 0.15,
        arcEnd: 0.85,
        squash: 0,
        frames: [{ frame: 8, dur: 600 }]
      }
    }
  };
}

// Grouped schema driving the "Pet parameters" panel.
const PARAM_SCHEMA = [
  {
    title: 'Rendering',
    items: [
      { k: 'scale', label: 'sprite scale', step: 1, min: 1, max: 12 },
      { k: 'petW', label: 'window width', step: 2 },
      { k: 'petH', label: 'window height', step: 2 },
      { k: 'restPad', label: 'bottom padding', step: 1 }
    ]
  },
  {
    title: 'Frame roles (index)',
    items: [
      { k: 'idleFrame', label: 'idle' },
      { k: 'crouchFrame', label: 'crouch' },
      { k: 'squashFrame', label: 'squash' },
      { k: 'upFrame', label: 'up' },
      { k: 'highFrame', label: 'high' },
      { k: 'sleepFrame', label: 'sleep' }
    ]
  },
  {
    title: 'Typing charge',
    items: [
      { k: 'maxChars', label: 'max chars', step: 10 },
      { k: 'releaseMs', label: 'release pause (ms)', step: 50 }
    ]
  },
  {
    title: 'Jump height (px)',
    items: [
      { k: 'minJump', label: 'min jump' },
      { k: 'maxJump', label: 'max jump' },
      { k: 'savedHop', label: 'saved-entry hop' }
    ]
  },
  {
    title: 'Jump timing',
    items: [
      { k: 'durBase', label: 'duration base (ms)', step: 10 },
      { k: 'durPerPx', label: 'duration per px (ms)', step: 0.5, float: true },
      { k: 'arcClamp', label: 'arc clamp (0-1)', step: 0.05, float: true, min: 0.1, max: 1 }
    ]
  },
  {
    title: 'Squash & charge feel',
    items: [
      { k: 'squashY', label: 'squash Y (0-1)', step: 0.02, float: true, min: 0, max: 1 },
      { k: 'squashX', label: 'squash X (0-1)', step: 0.02, float: true, min: 0, max: 1 },
      { k: 'chargeSquashAt', label: 'crouch->squash swap (0-1)', step: 0.05, float: true, min: 0, max: 1 },
      { k: 'chargeBobAmp', label: 'charge bob amount', step: 0.1, float: true },
      { k: 'chargeBobSpeed', label: 'charge bob speed', step: 5 }
    ]
  }
];

const LS_KEY = 'froggy-sprite-studio';
let state = load();
let sheet = new Image();
let sheetReady = false;
let customSrc = null;

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const merged = Object.assign(defaults(), parsed);
      // Deep-merge params so new knobs added later still get defaults.
      merged.params = Object.assign(defaults().params, parsed.params || {});
      // Backfill anims added after a user's state was saved (e.g. snooze) so
      // their tabs don't point at an undefined clip.
      merged.anims = Object.assign(defaults().anims, parsed.anims || {});
      return merged;
    }
  } catch {}
  return defaults();
}
function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {}
}

// --- DOM refs ---------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const sheetCanvas = $('sheetCanvas');
const sctx = sheetCanvas.getContext('2d');
const previewCanvas = $('previewCanvas');
const pctx = previewCanvas.getContext('2d');
sctx.imageSmoothingEnabled = false;
pctx.imageSmoothingEnabled = false;

// --- Sheet loading ----------------------------------------------------------
function sheetSrc() {
  return customSrc || `../assets/froggy-${state.color}.png`;
}
function loadSheet() {
  sheetReady = false;
  const img = new Image();
  img.onload = () => {
    sheet = img;
    sheetReady = true;
    drawSheet();
  };
  img.onerror = () => {
    sheetReady = false;
    console.warn('Could not load sheet', sheetSrc());
  };
  img.src = sheetSrc();
}

// --- Frame geometry ---------------------------------------------------------
function frameCount() {
  return state.grid.cols * state.grid.rows;
}
function frameRect(index) {
  const g = state.grid;
  const col = index % g.cols;
  const row = Math.floor(index / g.cols);
  return {
    sx: g.offsetX + col * (g.frameW + g.spacingX),
    sy: g.offsetY + row * (g.frameH + g.spacingY),
    w: g.frameW,
    h: g.frameH
  };
}

// --- Sheet rendering with grid overlay -------------------------------------
function drawSheet() {
  if (!sheetReady) return;
  const g = state.grid;
  const Z = state.sheetZoom;
  sheetCanvas.width = sheet.width * Z;
  sheetCanvas.height = sheet.height * Z;
  sctx.imageSmoothingEnabled = false;
  sctx.clearRect(0, 0, sheetCanvas.width, sheetCanvas.height);
  sctx.drawImage(sheet, 0, 0, sheetCanvas.width, sheetCanvas.height);

  const used = new Set(state.anims[state.current].frames.map((f) => f.frame));

  for (let i = 0; i < frameCount(); i++) {
    const r = frameRect(i);
    const x = r.sx * Z;
    const y = r.sy * Z;
    const w = r.w * Z;
    const h = r.h * Z;
    if (used.has(i)) {
      sctx.fillStyle = 'rgba(76,175,80,0.28)';
      sctx.fillRect(x, y, w, h);
    }
    sctx.strokeStyle = used.has(i) ? '#4caf50' : 'rgba(120,140,170,0.55)';
    sctx.lineWidth = 1;
    sctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (state.showNums) {
      sctx.fillStyle = 'rgba(255,255,255,0.85)';
      sctx.font = `${Math.max(9, Math.min(14, Z * 1.4))}px ui-monospace, monospace`;
      sctx.textBaseline = 'top';
      sctx.fillText(String(i), x + 2, y + 2);
    }
  }
}

function frameIndexAt(clientX, clientY) {
  const rect = sheetCanvas.getBoundingClientRect();
  const Z = state.sheetZoom;
  const px = (clientX - rect.left) / Z;
  const py = (clientY - rect.top) / Z;
  const g = state.grid;
  const cw = g.frameW + g.spacingX;
  const ch = g.frameH + g.spacingY;
  const col = Math.floor((px - g.offsetX) / cw);
  const row = Math.floor((py - g.offsetY) / ch);
  if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) return -1;
  // Ignore clicks that land in the spacing gutter.
  const inX = px - g.offsetX - col * cw;
  const inY = py - g.offsetY - row * ch;
  if (inX > g.frameW || inY > g.frameH) return -1;
  return row * g.cols + col;
}

sheetCanvas.addEventListener('click', (e) => {
  const idx = frameIndexAt(e.clientX, e.clientY);
  if (idx < 0) return;
  state.anims[state.current].frames.push({ frame: idx, dur: 120 });
  changed();
});

// --- Auto-detect grid -------------------------------------------------------
function autoDetect() {
  if (!sheetReady) return;
  const c = document.createElement('canvas');
  c.width = sheet.width;
  c.height = sheet.height;
  const cx = c.getContext('2d');
  cx.drawImage(sheet, 0, 0);
  let data;
  try {
    data = cx.getImageData(0, 0, c.width, c.height).data;
  } catch (err) {
    alert('Could not read pixels (serve over http via `npm run studio`).');
    return;
  }
  const w = c.width;
  const h = c.height;
  const colOcc = new Array(w).fill(false);
  const rowOcc = new Array(h).fill(false);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 0) {
        colOcc[x] = true;
        rowOcc[y] = true;
      }
    }
  }
  const runs = (occ) => {
    let n = 0;
    let inRun = false;
    for (const v of occ) {
      if (v && !inRun) {
        n++;
        inRun = true;
      } else if (!v) inRun = false;
    }
    return n;
  };
  const cols = Math.max(1, runs(colOcc));
  const rows = Math.max(1, runs(rowOcc));
  state.grid.cols = cols;
  state.grid.rows = rows;
  state.grid.frameW = Math.round(w / cols);
  state.grid.frameH = Math.round(h / rows);
  state.grid.offsetX = 0;
  state.grid.offsetY = 0;
  state.grid.spacingX = 0;
  state.grid.spacingY = 0;
  syncInputs();
  changed();
}

// --- Animation editor -------------------------------------------------------
function cur() {
  return state.anims[state.current];
}
function totalDuration(anim) {
  return anim.frames.reduce((s, f) => s + Math.max(0, f.dur), 0);
}

function renderTabs() {
  document.querySelectorAll('#animTabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.anim === state.current);
  });
}

function thumbCanvas(frameIndex) {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const cx = c.getContext('2d');
  cx.imageSmoothingEnabled = false;
  if (sheetReady) {
    const r = frameRect(frameIndex);
    const scale = Math.min(32 / r.w, 32 / r.h);
    const dw = r.w * scale;
    const dh = r.h * scale;
    cx.drawImage(sheet, r.sx, r.sy, r.w, r.h, (32 - dw) / 2, (32 - dh) / 2, dw, dh);
  }
  return c;
}

function renderFrames() {
  const list = $('framesList');
  list.innerHTML = '';
  const anim = cur();
  anim.frames.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'frame-item';

    row.appendChild(thumbCanvas(f.frame));

    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = '#' + i;
    row.appendChild(idx);

    const frameIn = document.createElement('input');
    frameIn.type = 'number';
    frameIn.value = f.frame;
    frameIn.title = 'frame index';
    frameIn.addEventListener('change', () => {
      f.frame = clampInt(frameIn.value, 0, frameCount() - 1);
      changed();
    });
    row.appendChild(frameIn);

    const durIn = document.createElement('input');
    durIn.type = 'number';
    durIn.value = f.dur;
    durIn.title = 'duration ms';
    durIn.addEventListener('change', () => {
      f.dur = Math.max(0, Math.round(Number(durIn.value) || 0));
      changed();
    });
    row.appendChild(durIn);
    const ms = document.createElement('span');
    ms.className = 'muted';
    ms.textContent = 'ms';
    row.appendChild(ms);

    const sp = document.createElement('span');
    sp.className = 'sp';
    row.appendChild(sp);

    const up = mkBtn('up', () => move(i, -1));
    const down = mkBtn('down', () => move(i, 1));
    const del = mkBtn('x', () => {
      anim.frames.splice(i, 1);
      changed();
    });
    row.appendChild(up);
    row.appendChild(down);
    row.appendChild(del);

    list.appendChild(row);
  });

  const add = document.createElement('button');
  add.className = 'small';
  add.textContent = '+ add frame';
  add.addEventListener('click', () => {
    anim.frames.push({ frame: 0, dur: 120 });
    changed();
  });
  list.appendChild(add);

  $('totalDur').textContent = `${anim.frames.length} frames · ${totalDuration(anim)} ms`;
}

function mkBtn(label, fn) {
  const b = document.createElement('button');
  b.className = 'small';
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}
function move(i, dir) {
  const arr = cur().frames;
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  changed();
}
function clampInt(v, lo, hi) {
  v = Math.round(Number(v) || 0);
  return Math.max(lo, Math.min(hi, v));
}

// --- Pet parameters panel ---------------------------------------------------
let paramsBuilt = false;
function renderParams() {
  const host = $('paramGroups');
  if (!paramsBuilt) {
    host.innerHTML = '';
    PARAM_SCHEMA.forEach((group) => {
      const title = document.createElement('div');
      title.className = 'muted';
      title.style.margin = '10px 0 4px';
      title.style.fontSize = '11px';
      title.style.textTransform = 'uppercase';
      title.style.letterSpacing = '0.05em';
      title.textContent = group.title;
      host.appendChild(title);

      group.items.forEach((item) => {
        const row = document.createElement('label');
        row.className = 'row';
        const span = document.createElement('span');
        span.textContent = item.label;
        const input = document.createElement('input');
        input.type = 'number';
        input.id = 'p_' + item.k;
        if (item.step != null) input.step = item.step;
        if (item.min != null) input.min = item.min;
        if (item.max != null) input.max = item.max;
        input.addEventListener('change', () => {
          let v = Number(input.value);
          if (!item.float) v = Math.round(v);
          if (item.min != null) v = Math.max(item.min, v);
          if (item.max != null) v = Math.min(item.max, v);
          state.params[item.k] = v;
          input.value = v;
          changed();
        });
        row.appendChild(span);
        row.appendChild(input);
        host.appendChild(row);
      });
    });
    paramsBuilt = true;
  }
  // Sync values.
  PARAM_SCHEMA.forEach((group) =>
    group.items.forEach((item) => {
      const el = $('p_' + item.k);
      if (el) el.value = state.params[item.k];
    })
  );
}

// --- Preview ----------------------------------------------------------------
function squashAt(anim, p) {
  const s = anim.squash || 0;
  let r = 0;
  if (p < 0.12) r = (0.12 - p) / 0.12;
  else if (p > 0.9) r = (p - 0.9) / 0.1;
  return s * r;
}

function frameAtElapsed(anim, elapsed) {
  let acc = 0;
  for (const f of anim.frames) {
    acc += Math.max(1, f.dur);
    if (elapsed < acc) return f.frame;
  }
  return anim.frames.length ? anim.frames[anim.frames.length - 1].frame : 0;
}

// Floating "z z z" drifting up from the frog's head while it snoozes
// (mirrors drawZs in src/pet/pet.js).
function drawZs(now, originX, originY) {
  const period = 2600;
  pctx.save();
  pctx.textAlign = 'center';
  pctx.textBaseline = 'middle';
  for (let i = 0; i < 3; i++) {
    const ph = ((now + (i * period) / 3) % period) / period; // 0..1
    const x = originX + Math.sin(ph * Math.PI * 2) * 4 + i * 3;
    const y = originY - ph * 26;
    const size = 6 + i * 2 + ph * 4;
    pctx.globalAlpha = Math.max(0, Math.sin(ph * Math.PI));
    pctx.font = `bold ${Math.round(size)}px -apple-system, BlinkMacSystemFont, sans-serif`;
    pctx.lineWidth = 3;
    pctx.strokeStyle = 'rgba(35,55,45,0.9)';
    pctx.fillStyle = '#ffffff';
    pctx.strokeText('z', x, y);
    pctx.fillText('z', x, y);
  }
  pctx.restore();
}

let playStart = performance.now();
function drawPreview(now) {
  const anim = cur();
  const total = Math.max(1, totalDuration(anim));
  const tail = anim.loop ? 0 : 500; // rest a beat before replaying one-shots
  const cycle = total + tail;
  let elapsed = (now - playStart) % cycle;
  if (!$('playing').checked) elapsed = 0;

  const W = previewCanvas.width;
  const H = previewCanvas.height;
  pctx.clearRect(0, 0, W, H);

  if (sheetReady) {
    const g = state.grid;
    const scale = state.previewScale;
    const drawW = g.frameW * scale;
    const drawH = g.frameH * scale;

    let frameIndex;
    let p; // progress 0..1 across the animation for the arc
    if (elapsed >= total) {
      frameIndex = anim.frames.length ? anim.frames[0].frame : 0;
      p = 0;
    } else {
      frameIndex = frameAtElapsed(anim, elapsed);
      p = elapsed / total;
    }

    let y = 0;
    if (anim.arcHeight && anim.arcEnd > anim.arcStart) {
      const t = Math.min(1, Math.max(0, (p - anim.arcStart) / (anim.arcEnd - anim.arcStart)));
      // arcHeight is authored in the pet's px (scale ~6 reference); rescale to
      // the current preview scale so the arc tracks the frog size.
      y = anim.arcHeight * Math.sin(Math.PI * t) * (scale / 6);
    }

    // Snooze breathes procedurally in the pet (slow squash), independent of the
    // clip's own squash curve; mirror that here so the preview matches.
    const isSnooze = state.current === 'snooze';
    const sq = isSnooze
      ? 0.07 * (0.5 + 0.5 * Math.sin((now / 1000) * 1.5))
      : squashAt(anim, p);
    const scaleY = 1 - state.params.squashY * sq;
    const scaleX = 1 + state.params.squashX * sq;
    const dw = drawW * scaleX;
    const dh = drawH * scaleY;

    const baseline = H - 16;
    const drawX = (W - dw) / 2;
    const drawY = baseline - dh - y;

    const r = frameRect(frameIndex);
    pctx.imageSmoothingEnabled = false;
    pctx.drawImage(sheet, r.sx, r.sy, r.w, r.h, drawX, drawY, dw, dh);

    // ground line
    pctx.strokeStyle = 'rgba(255,255,255,0.12)';
    pctx.beginPath();
    pctx.moveTo(0, baseline + 0.5);
    pctx.lineTo(W, baseline + 0.5);
    pctx.stroke();

    if (isSnooze) drawZs(now, drawX + dw * 0.72, drawY);
  }

  $('previewInfo').textContent = `total ${total}ms · frame ${frameAtElapsed(anim, Math.min(elapsed, total - 1))}`;
  requestAnimationFrame(drawPreview);
}

// --- Export -----------------------------------------------------------------
function exportJSON() {
  return JSON.stringify({ grid: state.grid, params: state.params, anims: state.anims }, null, 2);
}
function exportJS() {
  const g = state.grid;
  const p = state.params;
  const lines = [];
  lines.push('// Paste-ready values for src/pet/pet.js (and window size for main.js)');
  lines.push(`const FRAME = ${g.frameW}; // frame width (height ${g.frameH})`);
  lines.push(`const COLS = ${g.cols};   // ${g.rows} rows, ${frameCount()} frames`);
  if (g.offsetX || g.offsetY || g.spacingX || g.spacingY) {
    lines.push(`// offset (${g.offsetX},${g.offsetY}) spacing (${g.spacingX},${g.spacingY})`);
  }
  lines.push('');
  lines.push('const F = {');
  lines.push(`  idle: [${p.idleFrame}],`);
  lines.push(`  crouch: ${p.crouchFrame},`);
  lines.push(`  squash: ${p.squashFrame},`);
  lines.push(`  up: ${p.upFrame},`);
  lines.push(`  high: ${p.highFrame},`);
  lines.push(`  sleep: ${p.sleepFrame}`);
  lines.push('};');
  lines.push('');
  lines.push('const PET_PARAMS = ' + JSON.stringify(p, null, 2) + ';');
  lines.push('');
  lines.push('// main.js window size:');
  lines.push(`// const PET_W = ${p.petW}; const PET_H = ${p.petH};`);
  lines.push('');
  lines.push('const ANIMATIONS = ' + JSON.stringify(state.anims, null, 2) + ';');
  return lines.join('\n');
}
function refreshExport() {
  $('exportOut').value = $('exportMode').value === 'js' ? exportJS() : exportJSON();
}

// --- Wiring -----------------------------------------------------------------
function syncInputs() {
  const g = state.grid;
  $('frameW').value = g.frameW;
  $('frameH').value = g.frameH;
  $('cols').value = g.cols;
  $('rows').value = g.rows;
  $('offsetX').value = g.offsetX;
  $('offsetY').value = g.offsetY;
  $('spacingX').value = g.spacingX;
  $('spacingY').value = g.spacingY;
  $('showNums').checked = state.showNums;
  $('sheetZoom').value = state.sheetZoom;
  $('previewScale').value = state.previewScale;

  const a = cur();
  $('a_loop').checked = a.loop;
  $('a_arcHeight').value = a.arcHeight;
  $('a_arcStart').value = a.arcStart;
  $('a_arcEnd').value = a.arcEnd;
  $('a_squash').value = a.squash;
}

function changed() {
  persist();
  drawSheet();
  renderFrames();
  renderTabs();
  renderParams();
  refreshExport();
}

function bindGridInput(id, key, isFloat) {
  $(id).addEventListener('change', () => {
    const v = isFloat ? Number($(id).value) : Math.round(Number($(id).value) || 0);
    state.grid[key] = v;
    changed();
  });
}
bindGridInput('frameW', 'frameW');
bindGridInput('frameH', 'frameH');
bindGridInput('cols', 'cols');
bindGridInput('rows', 'rows');
bindGridInput('offsetX', 'offsetX');
bindGridInput('offsetY', 'offsetY');
bindGridInput('spacingX', 'spacingX');
bindGridInput('spacingY', 'spacingY');

$('showNums').addEventListener('change', () => {
  state.showNums = $('showNums').checked;
  changed();
});
$('sheetZoom').addEventListener('input', () => {
  state.sheetZoom = Number($('sheetZoom').value);
  drawSheet();
  persist();
});
$('previewScale').addEventListener('input', () => {
  state.previewScale = Number($('previewScale').value);
  persist();
});

function bindAnimInput(id, key, isFloat) {
  $(id).addEventListener('change', () => {
    cur()[key] = isFloat ? Number($(id).value) : Math.round(Number($(id).value) || 0);
    changed();
  });
}
$('a_loop').addEventListener('change', () => {
  cur().loop = $('a_loop').checked;
  changed();
});
bindAnimInput('a_arcHeight', 'arcHeight');
bindAnimInput('a_arcStart', 'arcStart', true);
bindAnimInput('a_arcEnd', 'arcEnd', true);
bindAnimInput('a_squash', 'squash', true);

document.querySelectorAll('#animTabs button').forEach((b) => {
  b.addEventListener('click', () => {
    state.current = b.dataset.anim;
    playStart = performance.now();
    syncInputs();
    changed();
  });
});

$('autoDetect').addEventListener('click', autoDetect);
$('restart').addEventListener('click', () => (playStart = performance.now()));

$('loadDefaults').addEventListener('click', () => {
  if (!confirm('Reset all grid + animation values to the pet defaults?')) return;
  const color = state.color;
  state = defaults();
  state.color = color;
  customSrc = null;
  syncInputs();
  changed();
});

$('exportMode').addEventListener('change', refreshExport);
$('copyJson').addEventListener('click', () => {
  navigator.clipboard.writeText(exportJSON());
});
$('copyJs').addEventListener('click', () => {
  navigator.clipboard.writeText(exportJS());
});

// Color swatches
const sw = $('swatches');
COLORS.forEach((c) => {
  const b = document.createElement('button');
  b.className = 'swatch' + (state.color === c ? ' sel' : '');
  b.style.background = SWATCH[c];
  b.title = c;
  b.addEventListener('click', () => {
    state.color = c;
    customSrc = null;
    document.querySelectorAll('.swatch').forEach((s) => s.classList.remove('sel'));
    b.classList.add('sel');
    loadSheet();
    persist();
  });
  sw.appendChild(b);
});

$('pickFile').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  customSrc = url;
  loadSheet();
});

// --- Boot -------------------------------------------------------------------
syncInputs();
renderTabs();
renderFrames();
renderParams();
refreshExport();
loadSheet();
requestAnimationFrame(drawPreview);
