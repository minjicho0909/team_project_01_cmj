// 로컬 실행: node --env-file=.env dev-server.js  (또는 npm run dev)
// public 폴더를 화면으로, /api/이름 을 api/이름.js 로 연결한다 — Vercel 과 같은 (req, res) 핸들러를 그대로 쓴다.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.PORT) || 3000;
const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
      const file = path.join(ROOT, 'api', `${name}.js`);
      if (!name || !fs.existsSync(file)) { res.statusCode = 404; return res.end('없는 API'); }
      const mod = await import(pathToFileURL(file).href);
      return await mod.default(req, res);
    }
    let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([\\/])+/, '');
    let file = path.join(PUBLIC, p || 'index.html');
    if (!file.startsWith(PUBLIC)) { res.statusCode = 403; return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('없음'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.statusCode = 500; res.end('서버 오류'); }
  }
});

server.listen(PORT, () => console.log(`길잡이 로컬 서버: http://localhost:${PORT}`));
