const fs = require('fs');
const path = require('path');

function pad(n) {
  return String(n).padStart(2, '0');
}

// Local date as YYYY-MM-DD.
function dateStamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Local time as HH:MM.
function timeStamp(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Append one micro-blog entry to the day's markdown file.
 * There is a single file per day: microblog_YYYY-MM-DD.md
 * The first entry of the day creates the file with frontmatter; later
 * entries are appended under a timestamped heading.
 * Returns the absolute path written.
 */
function writeEntry({ text, destFolder, author }) {
  const now = new Date();
  const date = dateStamp(now);
  const time = timeStamp(now);

  fs.mkdirSync(destFolder, { recursive: true });

  const filename = `microblog_${date}.md`;
  const fullPath = path.join(destFolder, filename);
  const body = String(text || '').trim();
  const exists = fs.existsSync(fullPath);

  if (!exists) {
    const content = [
      '---',
      `created: ${date}`,
      `updated: ${date}`,
      'source: human',
      `author: ${author}`,
      'type: microblog',
      '---',
      '',
      `## ${time}`,
      '',
      body,
      ''
    ].join('\n');
    fs.writeFileSync(fullPath, content, 'utf8');
    return fullPath;
  }

  // Append a new timestamped entry to the existing day file.
  const entry = ['', `## ${time}`, '', body, ''].join('\n');
  fs.appendFileSync(fullPath, entry, 'utf8');

  // Bump the `updated` field to reflect the latest entry time.
  try {
    const current = fs.readFileSync(fullPath, 'utf8');
    const bumped = current.replace(/^updated: .*$/m, `updated: ${date}`);
    if (bumped !== current) fs.writeFileSync(fullPath, bumped, 'utf8');
  } catch (_) {
    // Non-fatal: the entry is already appended.
  }

  return fullPath;
}

module.exports = { writeEntry, dateStamp, timeStamp };
