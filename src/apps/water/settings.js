// Water reminder app — persisted settings.
//
// Declared with the app (see pomodoro/settings.js for the pattern). The registry
// surfaces this to config.js, which stores values under `apps.water`.

module.exports = {
  id: 'water',
  defaults: {
    // How often to nudge, and what to say.
    intervalMinutes: 60,
    message: 'Time to drink some water!'
  }
};
