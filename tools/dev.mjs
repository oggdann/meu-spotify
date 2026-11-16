import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import music from '../api/musica.js';
import library from '../api/biblioteca.js';
const root = path.resolve('public');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png' };
http.createServer(async (req, res) => {
  try {
    res.status = status => { res.statusCode = status; return res; };
    res.json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/musica') return music(req, res);
    if (url.pathname === '/api/biblioteca') return library(req, res);
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
    const data = await readFile(file); res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(data);
  } catch { res.statusCode = 404; res.end('Not found'); }
}).listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log('OGG preview listening on port ' + (process.env.PORT || 3000)));
