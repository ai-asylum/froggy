// Water reminder app — scheduler.
//
// A dead-simple repeating reminder, kept free of Electron specifics. main.js
// owns the instance, feeds it the configured delay + message from config, and
// shows the actual notification (and nudges the frog) in `onRemind`.
//
//   const water = createReminder({
//     getConfig: () => ({ intervalMinutes, message }),
//     onRemind: (message) => {}   // fired every `intervalMinutes`
//   });
//   water.reschedule();           // (re)start after config changes

function createReminder({ getConfig, onRemind } = {}) {
  const cfg = typeof getConfig === 'function' ? getConfig : () => ({});
  const remind = typeof onRemind === 'function' ? onRemind : () => {};
  let handle = null;

  function minutes() {
    const m = Number((cfg() || {}).intervalMinutes);
    return Number.isFinite(m) && m >= 1 ? m : 60;
  }

  function stop() {
    if (handle) {
      clearInterval(handle);
      handle = null;
    }
  }

  // Restart the timer from now using the current delay.
  function reschedule() {
    stop();
    handle = setInterval(() => {
      const message = String((cfg() || {}).message || '').trim() || 'Time to drink some water!';
      remind(message);
    }, minutes() * 60 * 1000);
  }

  return { reschedule, stop };
}

module.exports = { createReminder };
