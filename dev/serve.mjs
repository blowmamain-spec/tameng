// Serves extension/ for UI previews with dev/chrome-mock.js injected. Run: node dev/serve.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../extension/', import.meta.url));
const mock = fileURLToPath(new URL('./chrome-mock.js', import.meta.url));
const port = Number(process.env.PORT) || 5179;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    if (path === '/__dev/chrome-mock.js') {
      res.writeHead(200, { 'Content-Type': types['.js'] });
      return res.end(await readFile(mock));
    }
    const file = normalize(join(root, path === '/' ? 'pages/options.html' : path));
    if (!file.startsWith(normalize(root))) throw new Error('outside root');
    let body = await readFile(file);
    if (extname(file) === '.html') {
      body = body.toString().replace('<head>', '<head>\n<script src="/__dev/chrome-mock.js"></script>');
    }
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`Preview: http://localhost:${port}/pages/options.html`));
