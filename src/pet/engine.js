// Shared frog animation engine.
//
// The same visual behavior drives both the *local* frog (reacting to your
// keyboard) and *remote* friends' frogs (replaying network events). A local
// engine reports every visible beat through `onEvent` so it can be broadcast;
// a remote engine consumes those beats via `applyRemote`.
//
// Usage:
//   const engine = createEngine(canvas, { remote: false, onEvent });
//   engine.onKey();            // local: a keystroke charges the spring
//   engine.applyRemote(msg);   // remote: replay a peer's beat

function createEngine(canvas, opts = {}) {
  const remote = !!opts.remote;
  const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : () => {};
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // The stage is scaled with a CSS transform, so pointer coordinates arrive in
  // scaled (client) pixels while the canvas backing store stays at its base
  // size. Dividing by this maps them back for pixel-perfect hit testing.
  let hitScale = Number(opts.scale) > 0 ? Number(opts.scale) : 1;
  function setScale(s) {
    if (Number(s) > 0) hitScale = Number(s);
  }

  // Sprite sheet geometry: 4 columns x 9 rows of 16x16 frames.
  const FRAME = 16;
  const COLS = 4;
  const SCALE = 4;
  const DRAW = FRAME * SCALE; // 64px
  // Transparent gap below the frog's feet. The local pet window keeps extra
  // headroom here so the sprite never sits against the window edge (where the
  // spawn/rescale artifact shows); remote frogs keep the tight default.
  const BOTTOM_MARGIN = typeof opts.bottomMargin === 'number' ? opts.bottomMargin : 6;
  const REST_X = Math.round((canvas.width - DRAW) / 2); // centered horizontally
  const REST_Y = canvas.height - DRAW - BOTTOM_MARGIN; // baseline near the bottom

  const ANIMATIONS = {
    idle: {
      loop: true,
      arcHeight: 0,
      arcStart: 0.15,
      arcEnd: 0.85,
      squash: 0,
      frames: [
        { frame: 0, dur: 1000 },
        { frame: 1, dur: 1000 }
      ]
    },
    hop: {
      loop: false,
      arcHeight: 18,
      arcStart: 0.15,
      arcEnd: 1,
      squash: 0.3,
      frames: [
        { frame: 12, dur: 60 },
        { frame: 14, dur: 150 },
        { frame: 0, dur: 90 }
      ]
    },
    jump: {
      loop: true,
      arcHeight: 64,
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
    }
  };

  const CHARGE_CROUCH = 12;
  const CHARGE_SQUASH = 13;
  const SLEEP_FRAME = 8;
  const AWAY_FRAME = 10; // back-facing pose, shown when a friend is offline

  // Charge/jump tuning (mirrors the original single-player values).
  const MAX_CHARGE = 300; // characters
  const RELEASE_MS = 600; // pause before it lets go
  const MIN_JUMP = 12; // px, a tiny type-and-stop
  const MAX_JUMP = 38; // px, ~300 chars
  const PULSE_TAU = 110; // ms decay of the per-key squash pulse
  const PULSE_STRENGTH = 0.85; // how deep a single key squashes (0..1)
  const JUMP_STRETCH = 0.6; // elongation while flying fast

  function animDuration(anim) {
    return anim.frames.reduce((sum, f) => sum + f.dur, 0);
  }

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

  function arcOffset(anim, p, heightScale) {
    const apex = anim.arcHeight * heightScale;
    if (!apex || p <= anim.arcStart || p >= anim.arcEnd) return 0;
    const q = (p - anim.arcStart) / (anim.arcEnd - anim.arcStart);
    return apex * Math.sin(Math.PI * q);
  }

  function deformAt(anim, p) {
    const s = anim.squash || 0;
    if (!s) return 0;
    if (p < 0.12) return ((0.12 - p) / 0.12) * s;
    if (p > 0.88) return ((p - 0.88) / 0.12) * s;
    if (!anim.arcHeight) return 0;
    const q = Math.min(Math.max((p - anim.arcStart) / (anim.arcEnd - anim.arcStart), 0), 1);
    return -JUMP_STRETCH * s * 2 * Math.abs(Math.cos(Math.PI * q));
  }

  // --- Sprite loading ------------------------------------------------------
  // Frames are pre-sliced into their own isolated 16x16 canvases at load time,
  // rather than sampled out of the packed sheet on every draw. Blitting a
  // scaled sub-rect of the sheet bleeds a sliver of the neighbouring frame into
  // the drawn frame's edges (a stray pixel line above the frog on squish), so
  // slicing first leaves no neighbour to bleed in.
  let sheetReady = false;
  let frameTiles = []; // frame index -> its own 16x16 canvas
  let outlineTiles = []; // same, as a white silhouette for the outline pass

  function sliceFrames(img, { white } = {}) {
    const rows = Math.max(1, Math.round(img.height / FRAME));
    const count = COLS * rows;
    const tiles = [];
    for (let i = 0; i < count; i++) {
      const sx = (i % COLS) * FRAME;
      const sy = Math.floor(i / COLS) * FRAME;
      const c = document.createElement('canvas');
      c.width = FRAME;
      c.height = FRAME;
      const x = c.getContext('2d');
      x.imageSmoothingEnabled = false;
      x.drawImage(img, sx, sy, FRAME, FRAME, 0, 0, FRAME, FRAME);
      if (white) {
        x.globalCompositeOperation = 'source-in';
        x.fillStyle = '#ffffff';
        x.fillRect(0, 0, FRAME, FRAME);
      }
      tiles[i] = c;
    }
    return tiles;
  }

  let currentColor = null;
  async function loadColor(color, { silent } = {}) {
    if (!color) return;
    currentColor = color;
    const dataUrl = await window.api.invoke('sprite:get', color);
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => {
      frameTiles = sliceFrames(img);
      outlineTiles = sliceFrames(img, { white: true });
      sheetReady = true;
    };
    img.src = dataUrl;
    if (!silent) onEvent({ type: 'color', color });
  }

  const OUTLINE_WIDTH = 0.5;
  const OUTLINE_OFFSETS = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1]
  ];

  // --- State ---------------------------------------------------------------
  // Modes: 'play' (a clip) | 'charge' (building a jump) | 'sleep' | 'away'.
  let mode = 'play';
  let player = { name: 'idle', start: performance.now(), heightScale: 1 };
  let sleepStart = 0;
  let awayStart = 0;
  let charge = 0;
  let lastKeyAt = 0;
  let pulseAt = -1e9;

  // User preferences. `animationsOn` is a master switch (freezes to a static
  // pose); `typingSquishOn` gates only the keystroke charge/squish reaction.
  let animationsOn = true;
  let typingSquishOn = true;
  function setAnimationsEnabled(on) {
    animationsOn = on !== false;
  }
  function setTypingSquish(on) {
    typingSquishOn = on !== false;
  }

  function chargeRatio() {
    return Math.min(charge, MAX_CHARGE) / MAX_CHARGE;
  }

  function playClip(name, heightScale = 1) {
    player = { name, start: performance.now(), heightScale };
    mode = 'play';
  }

  // --- Public: local drivers ----------------------------------------------
  // A key was pressed: (re)enter charge mode and top up the meter. Skipped when
  // typing-squish is off (or animations are disabled) so the frog stays calm as
  // you type — and nothing is broadcast to friends either.
  function onKey() {
    if (!animationsOn || !typingSquishOn) return;
    mode = 'charge';
    charge = Math.min(charge + 1, MAX_CHARGE);
    const now = performance.now();
    lastKeyAt = now;
    pulseAt = now;
    onEvent({ type: 'key' });
  }

  // A deliberate squish (e.g. tapping the frog): the same charge/release beat as
  // a keystroke, but independent of the typing-squish gate so it fires on any
  // click. Still frozen when animations are off. Broadcasts the beat so friends'
  // copies squish along too.
  function squish() {
    if (!animationsOn) return;
    mode = 'charge';
    charge = Math.min(charge + 1, MAX_CHARGE);
    const now = performance.now();
    lastKeyAt = now;
    pulseAt = now;
    onEvent({ type: 'key' });
  }

  // Release the spring into a jump/hop scaled to the charge (or a forced apex).
  // A `silent` launch animates locally but reports no beat, so personal nags
  // (reminders) don't get mirrored onto friends' frogs.
  function launchJump(forcedHeight, silent) {
    const height =
      forcedHeight != null ? forcedHeight : MIN_JUMP + (MAX_JUMP - MIN_JUMP) * chargeRatio();
    const name = height >= 28 ? 'jump' : 'hop';
    playClip(name, height / ANIMATIONS[name].arcHeight);
    charge = 0;
    if (!silent) onEvent({ type: name, height });
  }

  function forceJump(opts) {
    launchJump(MAX_JUMP, opts && opts.silent);
  }
  function celebrate() {
    launchJump(20);
  }
  // A playful little dance: four quick hops in a row. Any in-progress dance is
  // cancelled first so overlapping calls don't stack into double-speed hopping.
  let danceTimer = null;
  function dance(opts) {
    const silent = !!(opts && opts.silent);
    // Notification dances broadcast only the squish (anticipation) beat; the
    // hop itself stays local eye-candy, so friends' frogs squish in sympathy
    // instead of bouncing around their screen.
    const syncSquish = !!(opts && opts.syncSquish);
    if (danceTimer) {
      clearTimeout(danceTimer);
      danceTimer = null;
    }
    let n = 0;
    const hop = () => {
      if (n++ >= 4) {
        danceTimer = null;
        return;
      }
      if (syncSquish) onEvent({ type: 'squish' });
      launchJump(16, silent || syncSquish);
      danceTimer = setTimeout(hop, 240);
    };
    hop();
  }
  function sleep() {
    mode = 'sleep';
    sleepStart = performance.now();
    onEvent({ type: 'sleep' });
  }
  function wake() {
    if (mode === 'sleep') playClip('idle');
    onEvent({ type: 'wake' });
  }
  function idle() {
    charge = 0;
    playClip('idle');
    onEvent({ type: 'idle' });
  }
  function setColor(color, opts2) {
    loadColor(color, opts2);
  }
  // Offline friend: turn its back to you until it reconnects.
  function setAway(on) {
    if (on) {
      if (mode !== 'away') awayStart = performance.now();
      mode = 'away';
    } else if (mode === 'away') {
      playClip('idle');
    }
  }

  // --- Public: remote replay ----------------------------------------------
  // Remote frogs don't auto-release their charge; the explicit hop/jump beat
  // arrives separately, so we just show the squish until it does.
  function remoteKeyPulse() {
    mode = 'charge';
    charge = Math.min(charge + 1, MAX_CHARGE);
    const now = performance.now();
    lastKeyAt = now;
    pulseAt = now;
  }

  function applyRemote(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'key':
      case 'squish':
        remoteKeyPulse();
        break;
      case 'hop':
      case 'jump': {
        const anim = ANIMATIONS[msg.type];
        const h = typeof msg.height === 'number' ? msg.height : anim.arcHeight;
        charge = 0;
        playClip(msg.type, h / anim.arcHeight);
        break;
      }
      case 'sleep':
        mode = 'sleep';
        sleepStart = performance.now();
        break;
      case 'wake':
        if (mode === 'sleep') playClip('idle');
        break;
      case 'idle':
        charge = 0;
        playClip('idle');
        break;
      case 'color':
        loadColor(msg.color, { silent: true });
        break;
      default:
        break;
    }
  }

  // --- Drawing -------------------------------------------------------------
  function drawFrame(frameIndex, yOffset, deform, alpha) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!sheetReady) return;
    const tile = frameTiles[frameIndex];
    if (!tile) return;

    ctx.globalAlpha = typeof alpha === 'number' ? alpha : 1;
    const s = deform || 0;
    const scaleY = 1 - 0.32 * s;
    const scaleX = 1 + 0.22 * s;
    const drawH = DRAW * scaleY;
    const drawW = DRAW * scaleX;
    const baseline = REST_Y + DRAW;
    const drawX = REST_X - (drawW - DRAW) / 2;
    const drawY = baseline - drawH - yOffset;

    const outline = outlineTiles[frameIndex];
    if (outline) {
      const ox = (drawW / FRAME) * OUTLINE_WIDTH;
      const oy = (drawH / FRAME) * OUTLINE_WIDTH;
      for (const [dx, dy] of OUTLINE_OFFSETS) {
        ctx.drawImage(outline, drawX + dx * ox, drawY + dy * oy, drawW, drawH);
      }
    }
    ctx.drawImage(tile, drawX, drawY, drawW, drawH);
    ctx.globalAlpha = 1;
  }

  function drawZs(now, start) {
    const originX = REST_X + DRAW * 0.72;
    const originY = REST_Y + 6;
    const period = 2600;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) {
      const ph = (((now - start) + (i * period) / 3) % period) / period;
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
    // Master switch off: hold a single static pose (still turned away if
    // offline) and skip every animated branch below.
    if (!animationsOn) {
      drawFrame(mode === 'away' ? AWAY_FRAME : 0, 0, 0);
      requestAnimationFrame(tick);
      return;
    }

    if (mode === 'away') {
      // Turned away, faint, gently breathing — offline / no P2P.
      const t = (now - awayStart) / 1000;
      const breathe = 0.05 * (0.5 + 0.5 * Math.sin(t * 1.2));
      drawFrame(AWAY_FRAME, 0, breathe, 0.85);
      drawZs(now, awayStart);
      requestAnimationFrame(tick);
      return;
    }

    if (mode === 'sleep') {
      const t = (now - sleepStart) / 1000;
      const breathe = 0.07 * (0.5 + 0.5 * Math.sin(t * 1.5));
      drawFrame(SLEEP_FRAME, 0, breathe);
      drawZs(now, sleepStart);
      requestAnimationFrame(tick);
      return;
    }

    if (mode === 'charge') {
      // Local frogs auto-release after a typing pause; remote frogs wait for
      // the explicit hop/jump beat from the network.
      if (!remote && now - lastKeyAt >= RELEASE_MS) {
        launchJump();
      } else {
        const r = chargeRatio();
        const pulse = PULSE_STRENGTH * Math.exp(-(now - pulseAt) / PULSE_TAU);
        const sq = Math.min(1, 0.2 * r + pulse);
        const frame = sq > 0.5 ? CHARGE_SQUASH : CHARGE_CROUCH;
        drawFrame(frame, 0, sq);
        requestAnimationFrame(tick);
        return;
      }
    }

    let anim = ANIMATIONS[player.name] || ANIMATIONS.idle;
    let elapsed = now - player.start;
    if (!anim.loop && elapsed >= animDuration(anim) && player.name !== 'idle') {
      playClip('idle');
      anim = ANIMATIONS.idle;
      elapsed = now - player.start;
    }
    const total = animDuration(anim);
    const p = anim.loop ? 0 : Math.min(elapsed / total, 1);
    drawFrame(frameAt(anim, elapsed), arcOffset(anim, p, player.heightScale), deformAt(anim, p));
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Pixel-perfect hit test against the currently painted frame. Incoming
  // coordinates are in scaled client pixels; map them back to canvas pixels.
  function overFrog(x, y) {
    const cx = x / hitScale;
    const cy = y / hitScale;
    if (cx < 0 || cy < 0 || cx >= canvas.width || cy >= canvas.height) return false;
    try {
      const a = ctx.getImageData(Math.floor(cx), Math.floor(cy), 1, 1).data[3];
      return a > 8;
    } catch {
      return false;
    }
  }

  return {
    onKey,
    squish,
    forceJump,
    celebrate,
    dance,
    sleep,
    wake,
    idle,
    setColor,
    setAway,
    setScale,
    setAnimationsEnabled,
    setTypingSquish,
    applyRemote,
    overFrog,
    getColor: () => currentColor
  };
}

// Expose for classic (non-module) <script> includes in Electron renderers.
window.createFrogEngine = createEngine;
