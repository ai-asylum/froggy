// Tiny zero-dependency static server for the sprite studio.
// Serves the project root so the studio can load ../assets/*.png over http
// (avoids file:// canvas restrictions and enables grid auto-detection).
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT ? Number(process.env.PORT) : 4321;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const STUDIO_PATH = '/tools/sprite-studio.html';

function createServer() {
  return http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = STUDIO_PATH;

    const filePath = path.join(ROOT, urlPath);
    // Keep requests inside the project root.
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found: ' + urlPath);
        return;
      }
      const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    });
  });
}

/**
 * Start the studio server. Returns a promise resolving with the live URL, or
 * null if the port is already in use (e.g. a studio is already running).
 */
function startServer(port = PORT) {
  return new Promise((resolve) => {
    const server = createServer();
    const url = `http://localhost:${port}${STUDIO_PATH}`;
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve({ url, server: null, alreadyRunning: true });
      else resolve(null);
    });
    server.listen(port, () => resolve({ url, server, alreadyRunning: false }));
  });
}

module.exports = { startServer, STUDIO_PATH, PORT };

// Run directly (npm run studio).
if (require.main === module) {
  startServer().then((info) => {
    if (info) console.log(`Sprite studio running at ${info.url}`);
    else console.error('Failed to start sprite studio server.');
  });
}
