const { execFile } = require('child_process');

// Run a git command in `cwd`, resolving with { code, stdout, stderr }.
// Never rejects on a non-zero exit; callers decide what a failure means.
function git(args, cwd) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        code: err && typeof err.code === 'number' ? err.code : err ? 1 : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || '')
      });
    });
  });
}

// True if `folder` is inside a git working tree.
async function isGitRepo(folder) {
  if (!folder) return false;
  const res = await git(['rev-parse', '--is-inside-work-tree'], folder);
  return res.code === 0 && res.stdout.trim() === 'true';
}

/**
 * Stage changes under `folder`, commit them, and push.
 * Returns { ok, skipped?, error? }. `skipped` means there was nothing to commit.
 */
async function commitAndPush(folder, message) {
  if (!(await isGitRepo(folder))) {
    return { ok: false, error: 'not a git repository' };
  }

  const add = await git(['add', '-A', '.'], folder);
  if (add.code !== 0) return { ok: false, error: add.stderr.trim() || 'git add failed' };

  // Nothing staged means nothing to push.
  const staged = await git(['diff', '--cached', '--quiet'], folder);
  if (staged.code === 0) return { ok: true, skipped: true };

  const commit = await git(['commit', '-m', message], folder);
  if (commit.code !== 0) return { ok: false, error: commit.stderr.trim() || 'git commit failed' };

  const push = await git(['push'], folder);
  if (push.code !== 0) return { ok: false, error: push.stderr.trim() || 'git push failed' };

  return { ok: true };
}

module.exports = { isGitRepo, commitAndPush };
