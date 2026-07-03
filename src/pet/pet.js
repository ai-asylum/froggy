// Local frog driver. The animation itself lives in the shared engine
// (engine.js); this file wires the local frog to the keyboard/attention events
// from main, handles dragging + the gear/quit buttons, and forwards every
// visible beat to main so it can be broadcast to friends' frogs.

const canvas = document.getElementById('frog');
const gear = document.getElementById('gear');
const quit = document.getElementById('quit');
const slotBtns = Array.from(document.querySelectorAll('.slot'));
const buttons = [...slotBtns, gear, quit];

// Local beats are streamed to main, which relays them to connected peers.
const engine = window.createFrogEngine(canvas, {
  remote: false,
  // Extra transparent space below the frog (matches the taller pet window) so
  // the sprite keeps its on-screen spot but never touches the window edge.
  bottomMargin: 46,
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
  if (cfg && typeof cfg.scale === 'number') applyScale(cfg.scale);
  if (cfg && 'frogButton' in cfg) applyFrogButton(cfg.frogButton);
  if (cfg && Array.isArray(cfg.slots)) renderSlots(cfg.slots);
  applyAnimPrefs(cfg);
});

// The "disable animations" / "disable typing squish" appearance toggles.
function applyAnimPrefs(cfg) {
  if (!cfg) return;
  engine.setTypingSquish(cfg.typingSquish !== false);
  engine.setAnimationsEnabled(cfg.animations !== false);
}
// While an app is notifying (or a friend invite / journal nag is waiting), hide
// every app button (the arc slots + the frog's own slot badge) and flash the
// notifier's icon in the center instead, so it's unmistakable what wants a tap.
const notifEl = document.getElementById('notif');

// While a notification is pending the frog dances in bursts to stay noticeable:
// four hops, a ~2s breather, then again — looping until the notification clears.
const NOTIFY_DANCE_SPAN = 1000; // ~ four hops (matches engine.dance())
const NOTIFY_DANCE_GAP = 2000; // pause between bursts
let notifyDanceTimer = null;
function startNotifyDance() {
  if (notifyDanceTimer) return; // already looping
  const burst = () => {
    engine.dance();
    notifyDanceTimer = setTimeout(burst, NOTIFY_DANCE_SPAN + NOTIFY_DANCE_GAP);
  };
  burst();
}
function stopNotifyDance() {
  if (notifyDanceTimer) {
    clearTimeout(notifyDanceTimer);
    notifyDanceTimer = null;
  }
}

window.api.on('frog:notify', (info) => {
  const active = !!(info && info.active);
  document.body.classList.toggle('frog-notifying', active);
  if (active && notifEl) {
    notifEl.style.setProperty('--arc-color', (info && info.color) || 'rgba(30,30,40,0.82)');
    notifEl.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${(info && info.icon) || ''}</svg>`;
  }
  if (active) startNotifyDance();
  else stopNotifyDance();
});

// --- Shout echo ------------------------------------------------------------
// Your own shouts (and the settings "Test shout") appear here in a red, all-caps
// bubble above the frog that auto-hides after a few seconds.
const bubbleEl = document.getElementById('bubble');
const bubbleTextEl = document.getElementById('bubbletext');
let bubbleTimer = null;
window.api.on('shout:show', ({ text }) => {
  clearTimeout(bubbleTimer);
  bubbleTextEl.textContent = String(text || '').toUpperCase();
  bubbleEl.classList.add('shout', 'visible');
  bubbleTimer = setTimeout(() => bubbleEl.classList.remove('visible'), 8000);
});

// --- Shared timer overlay (Pomodoro + Countdown) ---------------------------
// A live timer floats just above the frog while either app is running. Each
// app streams its state; we normalize both into a common "view" and show one at
// a time (a running Countdown takes precedence over Pomodoro, then reveals it
// again when it ends). main drives all updates over their :state broadcasts.
const timerEl = document.getElementById('timer');
const timerLabelEl = document.getElementById('timer-label');
const timerTimeEl = document.getElementById('timer-time');
const timerHintEl = document.getElementById('timer-hint');

function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

let pomoView = { active: false };
let countdownView = { active: false };

function applyOverlay() {
  const view = countdownView.active ? countdownView : pomoView;
  if (!view.active) {
    timerEl.classList.remove('visible', 'awaiting');
    timerEl.style.removeProperty('--timer-accent');
    return;
  }
  timerEl.classList.add('visible');
  timerEl.classList.toggle('awaiting', !!view.awaiting);
  timerLabelEl.textContent = view.label || '';
  timerTimeEl.textContent = view.time || '';
  timerHintEl.textContent = view.hint || '';
  timerEl.style.setProperty('--timer-accent', view.accent || 'rgba(255,255,255,0.82)');
}

// Pomodoro state -> overlay view. Warm accent for focus, cool for break; a
// finished phase becomes an "awaiting" tap prompt.
function toPomoView(st) {
  if (!st || !st.active) return { active: false };
  const upcoming = st.awaiting ? st.next || 'focus' : st.phase;
  const accent = upcoming === 'break' ? '#b9e6ff' : '#ffd7b0';
  if (st.awaiting) {
    return {
      active: true,
      awaiting: true,
      accent,
      label: st.phase === 'focus' ? 'Focus done' : 'Break over',
      time: fmtClock(0),
      hint: upcoming === 'break' ? 'tap to start break' : 'tap to focus'
    };
  }
  return {
    active: true,
    accent,
    label: st.phase === 'break' ? 'Break' : 'Focus',
    time: fmtClock(st.remaining)
  };
}

// Countdown state -> overlay view. Tinted with the app's own color.
function toCountdownView(st) {
  if (!st || !st.active) return { active: false };
  return {
    active: true,
    accent: st.color || '#8b5cf6',
    label: st.label || 'Countdown',
    time: fmtClock(st.remaining)
  };
}

window.api.on('pomodoro:state', (st) => {
  pomoView = toPomoView(st);
  applyOverlay();
});
window.api.on('countdown:state', (st) => {
  countdownView = toCountdownView(st);
  applyOverlay();
});
window.api.invoke('pomodoro:get').then((st) => {
  pomoView = toPomoView(st);
  applyOverlay();
});
window.api.invoke('countdown:get').then((st) => {
  countdownView = toCountdownView(st);
  applyOverlay();
});

// --- Reminder message readout ----------------------------------------------
// A finished Water reminder / Countdown floats its message just above the frog
// in the same pill as the timer, tinted with the app's accent, then auto-hides.
const frogMsgEl = document.getElementById('frogmsg');
const frogMsgLabelEl = document.getElementById('frogmsg-label');
const frogMsgTextEl = document.getElementById('frogmsg-text');
let frogMsgTimer = null;
window.api.on('frog:message', ({ text, label, color } = {}) => {
  clearTimeout(frogMsgTimer);
  frogMsgLabelEl.textContent = String(label || '');
  frogMsgTextEl.textContent = String(text || '');
  frogMsgEl.style.setProperty('--timer-accent', color || 'rgba(255,255,255,0.82)');
  frogMsgEl.classList.add('visible');
  frogMsgTimer = setTimeout(() => frogMsgEl.classList.remove('visible'), 8000);
});

// --- App slots -------------------------------------------------------------
// The three arc buttons + the frog itself (the 4th slot) are filled from
// config.slots. We fetch the app catalog (id -> name/color/icon) once, then
// render whatever ids are configured.
const appsById = new Map();
const FROG_SLOT = 3; // slots[0..2] are the arc buttons; slots[3] is the frog
const petSlotEl = document.getElementById('petslot');
const LONG_PRESS_MS = 450; // hold this long to open a slot's picker
// Keep the CSS progress-ring animation in lockstep with the JS timer.
document.documentElement.style.setProperty('--press-ms', LONG_PRESS_MS + 'ms');

// When the frog button is disabled (settings toggle), the frog stops acting as
// the 4th slot: no badge, no picker gesture, and a tap opens the journal (main
// handles that fallback). Kept in sync via config:updated.
let frogButtonEnabled = true;
function applyFrogButton(enabled) {
  frogButtonEnabled = enabled !== false;
  if (petSlotEl) petSlotEl.classList.toggle('off', !frogButtonEnabled);
}

const PLUS_SVG =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>';

function renderSlots(slots) {
  slotBtns.forEach((btn, i) => {
    const app = appsById.get((slots || [])[i]);
    if (app) {
      btn.classList.remove('empty');
      btn.style.setProperty('--arc-color', app.color || 'rgba(30,30,40,0.82)');
      btn.dataset.tip = app.name;
      btn.dataset.appId = app.id;
      btn.title = app.name;
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${app.icon || ''}</svg>`;
    } else {
      btn.classList.add('empty');
      btn.style.removeProperty('--arc-color');
      btn.dataset.tip = 'Add app';
      delete btn.dataset.appId;
      btn.title = 'Add app';
      btn.innerHTML = PLUS_SVG;
    }
  });
  renderPetSlot(appsById.get((slots || [])[FROG_SLOT]));
}

// The frog's own badge (slot 3). Icon when assigned, faint dashed "+" when not.
function renderPetSlot(app) {
  if (!petSlotEl) return;
  if (app) {
    petSlotEl.classList.remove('empty');
    petSlotEl.style.setProperty('--arc-color', app.color || 'rgba(30,30,40,0.82)');
    petSlotEl.dataset.appId = app.id;
    petSlotEl.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${app.icon || ''}</svg>`;
  } else {
    petSlotEl.classList.add('empty');
    petSlotEl.style.removeProperty('--arc-color');
    delete petSlotEl.dataset.appId;
    petSlotEl.innerHTML = PLUS_SVG;
  }
}

Promise.all([window.api.invoke('apps:list'), window.api.invoke('settings:get')]).then(
  ([list, cfg]) => {
    for (const app of list || []) appsById.set(app.id, app);
    applyFrogButton(cfg && cfg.frogButton);
    renderSlots((cfg && cfg.slots) || []);
  }
);

// Grow/shrink the whole stage (frog + action buttons) with a CSS transform.
// The pet window is resized to match by main; the engine only needs the factor
// to keep pixel-perfect hit testing accurate.
function applyScale(scale) {
  const s = Number(scale) > 0 ? Number(scale) : 1;
  document.documentElement.style.setProperty('--scale', String(s));
  engine.setScale(s);
}

// Pick up the configured color + scale on launch (silent: don't broadcast).
window.api.invoke('settings:get').then((cfg) => {
  if (cfg && cfg.color) engine.setColor(cfg.color, { silent: true });
  if (cfg && typeof cfg.scale === 'number') applyScale(cfg.scale);
  applyAnimPrefs(cfg);
});

// --- Pixel-perfect click-through ------------------------------------------
let interactive = false;

// During the first-run "name your frog" step the frog is shown purely as a
// preview perched on the naming card — clicks/drags/hover are all suppressed
// until naming completes (main toggles this via pet:lock).
let locked = false;
window.api.on('pet:lock', (on) => {
  locked = !!on;
  if (locked) hideButtons();
});

function setInteractive(next) {
  if (locked) next = false;
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

// Everything that fades in on hover: the arc slots, gear/quit, and the frog's
// own slot badge (only shown while the frog is hovered, like the arc slots).
const hoverEls = petSlotEl ? [...buttons, petSlotEl] : buttons;

function keepGear() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  hoverEls.forEach((b) => b.classList.add('visible'));
  setInteractive(true);
}

function releaseGear() {
  if (hideTimer) return;
  hideTimer = setTimeout(() => {
    hideTimer = null;
    hoverEls.forEach((b) => b.classList.remove('visible'));
    setInteractive(false);
  }, 600);
}

// The frog is itself a slot: holding it opens its picker (like long-pressing an
// arc slot). Tracked here so a drag or a quick release cancels it.
let frogPressTimer = null;
function clearFrogPress() {
  if (frogPressTimer) {
    clearTimeout(frogPressTimer);
    frogPressTimer = null;
  }
  if (petSlotEl) petSlotEl.classList.remove('pressing');
}

window.addEventListener('mousemove', (e) => {
  if (locked) return;
  if (down) {
    const dx = e.screenX - down.screenX;
    const dy = e.screenY - down.screenY;
    if (!down.moved && Math.hypot(dx, dy) > 4) {
      down.moved = true;
      clearFrogPress(); // it's a drag, not a long-press
    }
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
  hoverEls.forEach((b) => b.classList.remove('visible'));
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
  if (locked) return;
  if (e.button !== 0) return; // only the left button drags / taps the frog
  if (buttons.some((b) => b === e.target || b.contains(e.target))) return;
  if (!engine.overFrog(e.clientX, e.clientY)) return;
  down = {
    screenX: e.screenX,
    screenY: e.screenY,
    winX: window.screenX,
    winY: window.screenY,
    moved: false
  };
  // Only arm the long-press picker while the frog acts as a slot; otherwise the
  // frog just drags / taps (the tap falls back to the journal in main).
  if (frogButtonEnabled) {
    if (petSlotEl) petSlotEl.classList.add('pressing');
    frogPressTimer = setTimeout(() => {
      frogPressTimer = null;
      if (!down || down.moved) return;
      down = null; // consumed by the long-press: no drag / click follows
      if (petSlotEl) petSlotEl.classList.remove('pressing');
      window.api.send('pet:edit-slot', FROG_SLOT);
    }, LONG_PRESS_MS);
  }
});

window.addEventListener('mouseup', () => {
  clearFrogPress();
  if (!down) return;
  const wasDrag = down.moved;
  down = null;
  if (wasDrag) {
    window.api.send('pet:move-end');
  } else {
    window.api.send('pet:click');
  }
});

// The frog is just another button: a quick click launches its app (or hands the
// tap to a notifying app / journal nag), a long-press opens its picker to change
// or clear the app, and a right-click jumps to that app's settings — mirroring
// the arc slots. Slots handle their own right-click, so we only act when the
// cursor is over the frog itself.
window.addEventListener('contextmenu', (e) => {
  if (locked) return;
  if (buttons.some((b) => b === e.target || b.contains(e.target))) return;
  if (!engine.overFrog(e.clientX, e.clientY)) return;
  e.preventDefault();
  clearFrogPress();
  if (frogButtonEnabled) window.api.send('pet:slot-settings', FROG_SLOT);
});

// Slot gestures: a quick click launches the app (empty slots do nothing on a
// click — they require a long-press); a long-press opens the picker to add /
// change / clear the slot; a right-click jumps to the slotted app's settings.
slotBtns.forEach((btn) => {
  const index = Number(btn.dataset.slot);
  let pressTimer = null;
  let longFired = false;

  function edit() {
    window.api.send('pet:edit-slot', index);
  }
  function clearTimer() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    btn.classList.remove('pressing');
  }

  btn.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    longFired = false;
    btn.classList.add('pressing');
    pressTimer = setTimeout(() => {
      longFired = true;
      btn.classList.remove('pressing');
      edit();
    }, LONG_PRESS_MS);
  });
  btn.addEventListener('mouseup', clearTimer);
  btn.addEventListener('mouseleave', clearTimer);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (longFired) return; // the long-press already opened the picker
    // Filled slot: a quick click launches its app. Empty slot: no click action —
    // it can only be opened with a long-press (see the timer above).
    if (btn.dataset.appId) window.api.send('pet:launch-slot', index);
  });
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearTimer();
    window.api.send('pet:slot-settings', index);
  });
});

gear.addEventListener('click', (e) => {
  e.stopPropagation();
  window.api.send('pet:open-settings');
});
quit.addEventListener('click', (e) => {
  e.stopPropagation();
  window.api.send('app:quit');
});
// Hover labels: reuse a single centered tip so long text never clips the window.
const tip = document.getElementById('tip');
const petButtons = new Set([gear, quit]);
function showTip(btn) {
  tip.textContent = btn.dataset.tip || '';
  tip.classList.toggle('up', petButtons.has(btn));
  tip.classList.add('visible');
}
function hideTip() {
  tip.classList.remove('visible');
}

buttons.forEach((b) => {
  b.addEventListener('mouseenter', () => {
    keepGear();
    showTip(b);
  });
  b.addEventListener('mouseleave', hideTip);
});
