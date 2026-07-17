// Pomodoro app — persisted settings.
//
// Each app owns its settings here (defaults + light metadata) so its
// configuration lives with the app instead of in one central blob. The registry
// surfaces this to config.js, which stores the actual values under
// `apps.pomodoro` in the single Froggy config file.

module.exports = {
  id: 'pomodoro',
  defaults: {
    // Focus / break block lengths, in minutes.
    workMinutes: 25,
    breakMinutes: 5
  }
};
