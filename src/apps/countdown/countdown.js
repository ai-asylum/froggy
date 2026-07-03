// Countdown app — timer logic.
//
// A one-shot timer, kept free of Electron specifics (like pomodoro.js). main.js
// owns the instance, feeds it the configured duration + message, streams live
// state to the frog's floating readout, and pops the end-of-countdown message
// dialog in `onDone`. Clicking the Countdown slot starts it (or stops a running
// one); when it hits zero it fires once and returns to idle.
//
//   const cd = createCountdown({
//     getConfig: () => ({ minutes, message, color }),
//     onTick: (state) => {},           // every second + on start/stop
//     onDone: (message, color) => {}   // fired once when it reaches zero
//   });

function createCountdown({ getConfig, onTick, onDone } = {}) {
  const cfg = typeof getConfig === 'function' ? getConfig : () => ({});
  const tickCb = typeof onTick === 'function' ? onTick : () => {};
  const doneCb = typeof onDone === 'function' ? onDone : () => {};

  let running = false;
  let remaining = 0; // seconds
  let handle = null;

  function minutes() {
    const m = Number((cfg() || {}).minutes);
    return Number.isFinite(m) && m >= 1 ? Math.min(600, Math.floor(m)) : 10;
  }

  function message() {
    return String((cfg() || {}).message || '').trim() || 'Time\u2019s up!';
  }

  function color() {
    return (cfg() || {}).color || '#8b5cf6';
  }

  function state() {
    return {
      active: running,
      running,
      remaining,
      minutes: minutes(),
      message: message(),
      color: color(),
      label: 'Countdown'
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
      remaining = 0;
      running = false;
      stopTicking();
      tickCb(state()); // final push so the overlay clears
      doneCb(message(), color());
      return;
    }
    tickCb(state());
  }

  // Begin a fresh countdown from the configured duration.
  function start() {
    remaining = minutes() * 60;
    running = true;
    stopTicking();
    handle = setInterval(tick, 1000);
    tickCb(state());
  }

  // Stop early, back to idle (hides the overlay). Does not fire onDone.
  function stop() {
    running = false;
    remaining = 0;
    stopTicking();
    tickCb(state());
  }

  // The Countdown slot button: start when idle, otherwise cancel.
  function toggle() {
    if (running) stop();
    else start();
  }

  return {
    start,
    stop,
    toggle,
    getState: state,
    isActive: () => running
  };
}

module.exports = { createCountdown };
