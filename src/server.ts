import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import diagnoseHandler from './api/diagnose.ts';
import healthHandler from './api/health.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Mock res methods for Vercel handler compatibility
  const vercelRes = Object.assign(res, {
    status(code: number) {
      res.statusCode = code;
      return vercelRes;
    },
    json(data: any) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data, null, 2));
      return vercelRes;
    },
    send(data: any) {
      res.end(data);
      return vercelRes;
    },
  });

  const query: Record<string, string> = {};
  parsedUrl.searchParams.forEach((v, k) => {
    query[k] = v;
  });
  const vercelReq = Object.assign(req, { query });

  if (pathname === '/api/health') {
    healthHandler(vercelReq, vercelRes);
    return;
  }

  if (pathname === '/api/diagnose') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        (vercelReq as any).body = body;
        diagnoseHandler(vercelReq, vercelRes);
      });
    } else {
      diagnoseHandler(vercelReq, vercelRes);
    }
    return;
  }

  // Static files
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') safePath = '/index.html';
  const fullPath = path.join(PUBLIC_DIR, safePath);

  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    serveStatic(req, res, fullPath);
  } else {
    // fallback to index.html for SPA
    serveStatic(req, res, path.join(PUBLIC_DIR, 'index.html'));
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`Pharos dApp Support Agent listening on http://localhost:${PORT}`);
  console.log(`Health endpoint: http://localhost:${PORT}/api/health`);
  console.log(`Diagnose endpoint: http://localhost:${PORT}/api/diagnose`);
  console.log(`======================================================\n`);
});
