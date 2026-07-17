// Lightweight update check. Rather than a full auto-updater (which on macOS
// needs an Apple code-signing certificate), we just ask GitHub for the latest
// published release, compare it to the running version, and — if there's a
// newer one — offer to open the download page. Works on every platform with no
// signing and no extra native dependencies.

const { app, dialog, shell, nativeImage } = require('electron');
const https = require('https');
const path = require('path');

// Frog icon for our dialogs, so message boxes show Froggy instead of the
// default Electron diamond. Bundled under assets/ so it resolves in dev and in
// the packaged app. Falls back to undefined (Electron's default) if missing.
function frogIcon() {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'));
    return img.isEmpty() ? undefined : img;
  } catch {
    return undefined;
  }
}

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

// Pick the best release asset to download for the current OS/arch. Returns a
// direct `browser_download_url` when we can confidently match one, otherwise
// null so callers fall back to the release web page. Matching is by file
// extension + arch keyword rather than exact filename, so it survives
// electron-builder naming quirks (e.g. x64 dmgs that omit the arch suffix).
function pickAssetUrl(release) {
  const assets = (release && release.assets) || [];
  if (!assets.length) return null;

  const arch = process.arch; // 'arm64' | 'x64' | ...
  const byName = (pred) => assets.filter((a) => pred(String(a.name || '').toLowerCase()));
  const archMatch = (name) => {
    if (arch === 'arm64') return name.includes('arm64');
    if (arch === 'x64') return name.includes('x64') || name.includes('x86_64') || !name.includes('arm64');
    return true;
  };

  let candidates = [];
  if (process.platform === 'darwin') {
    // Prefer a .dmg, fall back to the mac .zip. Skip block/latest metadata.
    const dmgs = byName((n) => n.endsWith('.dmg'));
    const zips = byName((n) => n.endsWith('.zip') && n.includes('mac'));
    candidates = [...dmgs, ...zips];
  } else if (process.platform === 'win32') {
    candidates = byName((n) => n.endsWith('.exe'));
  } else if (process.platform === 'linux') {
    candidates = byName((n) => n.endsWith('.appimage'));
  }
  if (!candidates.length) return null;

  const best = candidates.find((a) => archMatch(String(a.name || '').toLowerCase())) || candidates[0];
  return best && best.browser_download_url ? best.browser_download_url : null;
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
        icon: frogIcon(),
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
        icon: frogIcon(),
        title: 'Froggy',
        message: "You're up to date!",
        detail: `Froggy ${current} is the latest version.`,
        buttons: ['OK']
      });
    }
    return;
  }

  const pageUrl = (release && release.html_url) || RELEASES_PAGE;
  const assetUrl = pickAssetUrl(release);
  const version = String(latest).replace(/^v/i, '');

  // When we can match an installer for this OS/arch we hand the browser the
  // file directly; otherwise we fall back to the release page so the user can
  // pick manually.
  const detail = assetUrl
    ? `You're running ${current}. Download the installer for your system to update.`
    : `You're running ${current}. Open the download page to update.`;

  // Both the boot check and the manual check surface an available update the
  // same way: a modal asking whether to download. `silent` only governs the
  // "up to date" / error cases above, so a flaky network or an up-to-date app
  // never nags on startup.
  const { response } = await dialog.showMessageBox({
    type: 'info',
    icon: frogIcon(),
    title: 'Froggy',
    message: `Froggy ${version} is available`,
    detail,
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1
  });
  if (response === 0) shell.openExternal(assetUrl || pageUrl);
}

module.exports = { checkForUpdates, isNewer, parseVersion, pickAssetUrl, RELEASES_PAGE };
