// Pomodoro app — timer logic.
//
// Deliberately free of Electron specifics so it's easy to reason about (and
// reuse). main.js owns the single instance, feeds it the configured durations,
// and reacts to its callbacks (a celebratory frog hop when a phase ends, and
// pushing live state to the frog overlay). It keeps ticking in the background
// whether or not any window is open.
//
// The cycle is *tap-driven*: clicking the Pomodoro slot starts a focus block;
// when it runs out the frog jumps and the timer waits. Tapping the frog then
// starts the break, and so on — focus <-> break — until the Pomodoro slot is
// clicked again to stop. So each phase ends in an "awaiting" pause instead of
// rolling straight into the next.
//
//   const pomo = createPomodoro({
//     getDurations: () => ({ workMinutes, breakMinutes }),
//     onTick: (state) => {},              // every second + on any transition
//     onPhaseChange: (phase, state) => {},// a new focus/break block began
//     onComplete: (finishedPhase, state) => {} // a phase's timer hit 0
//   });

function createPomodoro({ getDurations, onTick, onPhaseChange, onComplete } = {}) {
  const durations = typeof getDurations === 'function' ? getDurations : () => ({});
  const tickCb = typeof onTick === 'function' ? onTick : () => {};
  const phaseCb = typeof onPhaseChange === 'function' ? onPhaseChange : () => {};
  const completeCb = typeof onComplete === 'function' ? onComplete : () => {};

  // phase: 'idle' | 'focus' | 'break'
  let phase = 'idle';
  let remaining = 0; // seconds
  let running = false;
  // Finished a phase and waiting for the frog to be tapped to begin the next.
  // While awaiting, `phase` still holds the phase that just ended.
  let awaiting = false;
  let handle = null;

  function minutesFor(nextPhase) {
    const d = durations() || {};
    if (nextPhase === 'break') return Math.max(1, Number(d.breakMinutes) || 5);
    return Math.max(1, Number(d.workMinutes) || 25);
  }

  // The phase a frog tap will begin next (the opposite of the current one).
  function nextPhase() {
    return phase === 'focus' ? 'break' : 'focus';
  }

  function state() {
    const d = durations() || {};
    return {
      phase,
      remaining,
      running,
      awaiting,
      active: phase !== 'idle',
      next: awaiting ? nextPhase() : null,
      workMinutes: Math.max(1, Number(d.workMinutes) || 25),
      breakMinutes: Math.max(1, Number(d.breakMinutes) || 5)
    };
  }

  function stopTicking() {
    if (handle) {
      clearInterval(handle);
      handle = null;
    }
  }

  function tick() {
    if (!running) return;
    remaining -= 1;
    if (remaining <= 0) {
      // Phase finished. Pause here and wait for a frog tap to start the next.
      remaining = 0;
      running = false;
      awaiting = true;
      stopTicking();
      completeCb(phase, state());
      tickCb(state());
      return;
    }
    tickCb(state());
  }

  function startTicking() {
    stopTicking();
    handle = setInterval(tick, 1000);
  }

  function beginPhase(nextP) {
    phase = nextP;
    remaining = minutesFor(nextP) * 60;
    running = true;
    awaiting = false;
    startTicking();
    phaseCb(phase, state());
    tickCb(state());
  }

  // Start a fresh cycle from idle (begins a focus block).
  function start() {
    if (phase !== 'idle') return;
    beginPhase('focus');
  }

  // Frog tap while awaiting: roll into the opposite phase and keep the cycle
  // going. Returns whether it did anything (so callers can fall through to the
  // normal frog-click behavior when there's nothing to advance).
  function advance() {
    if (!awaiting) return false;
    beginPhase(nextPhase());
    return true;
  }

  // Full stop, back to idle (hides the overlay).
  function stop() {
    running = false;
    awaiting = false;
    stopTicking();
    phase = 'idle';
    remaining = 0;
    tickCb(state());
  }

  // The Pomodoro slot button: start from idle, otherwise stop.
  function toggle() {
    if (phase === 'idle') start();
    else stop();
  }

  return {
    start,
    stop,
    toggle,
    advance,
    getState: state,
    isActive: () => phase !== 'idle',
    isAwaiting: () => awaiting
  };
}

module.exports = { createPomodoro };
