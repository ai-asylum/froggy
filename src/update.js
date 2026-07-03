// Lightweight update check. Rather than a full auto-updater (which on macOS
// needs an Apple code-signing certificate), we just ask GitHub for the latest
// published release, compare it to the running version, and — if there's a
// newer one — offer to open the download page. Works on every platform with no
// signing and no extra native dependencies.

const { app, dialog, shell, Notification } = require('electron');
const https = require('https');

const OWNER = 'ai-asylum';
const REPO = 'froggy';
const RELEASES_PAGE = `https://github.com/${OWNER}/${REPO}/releases/latest`;

// Parse "v1.2.3" / "1.2.3" into [1, 2, 3]; ignores any pre-release suffix.
function parseVersion(v) {
  const core = String(v || '').trim().replace(/^v/i, '').split(/[-+]/)[0];
  return core.split('.').map((n) => parseInt(n, 10) || 0);
}

// Returns true when `latest` is strictly newer than `current`.
function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: 'api.github.com',
        path: `/repos/${OWNER}/${REPO}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': `Froggy/${app.getVersion()}`,
          Accept: 'application/vnd.github+json'
        }
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300) {
          res.resume();
          reject(new Error(`GitHub responded ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// Check GitHub for a newer release. When one is found, show a dialog that can
// open the download page. Pass { silent: true } (the default) to stay quiet
// when already up to date or when the check fails — used for the boot check so
// we never nag or error on a flaky network. A manual "Check for updates…" call
// passes { silent: false } to always report the result.
async function checkForUpdates({ silent = true } = {}) {
  let release;
  try {
    release = await fetchLatestRelease();
  } catch (err) {
    console.warn('Update check failed:', err.message);
    if (!silent) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Froggy',
        message: "Couldn't check for updates",
        detail: 'Please try again later, or visit the releases page.',
        buttons: ['OK']
      });
    }
    return;
  }

  const latest = release && release.tag_name;
  const current = app.getVersion();

  if (!latest || !isNewer(latest, current)) {
    if (!silent) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Froggy',
        message: "You're up to date!",
        detail: `Froggy ${current} is the latest version.`,
        buttons: ['OK']
      });
    }
    return;
  }

  const url = (release && release.html_url) || RELEASES_PAGE;
  const version = String(latest).replace(/^v/i, '');

  if (silent) {
    // Boot check: a gentle notification that opens the page when clicked, so we
    // never steal focus with a modal on startup.
    try {
      const note = new Notification({
        title: 'Froggy update available',
        body: `Version ${version} is ready to download.`
      });
      note.on('click', () => shell.openExternal(url));
      note.show();
    } catch {}
    return;
  }

  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'Froggy',
    message: `Froggy ${version} is available`,
    detail: `You're running ${current}. Open the download page to update.`,
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1
  });
  if (response === 0) shell.openExternal(url);
}

module.exports = { checkForUpdates, isNewer, parseVersion, RELEASES_PAGE };
