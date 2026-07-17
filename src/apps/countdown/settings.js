// Countdown app — persisted settings.
//
// Declared with the app (see pomodoro/settings.js for the pattern). The registry
// surfaces this to config.js, which stores values under `apps.countdown`.

module.exports = {
  id: 'countdown',
  defaults: {
    // One-shot timer length + the message shown when it ends.
    minutes: 10,
    message: 'Time\u2019s up!'
  }
};
