// HTTP: serves the built PWA from ui/dist and a tiny JSON API.
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import os from 'node:os';
import type { Engine } from './engine.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};

export function lanIp(): string | null {
  const ifs = os.networkInterfaces();
  const candidates: string[] = [];
  for (const list of Object.values(ifs)) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) candidates.push(i.address);
  // prefer private ranges typical for home LANs
  return candidates.find((a) => a.startsWith('192.168.')) ?? candidates.find((a) => a.startsWith('10.')) ?? candidates[0] ?? null;
}

export interface HttpOptions { staticDir: string; api?: Record<string, (req: IncomingMessage, url: URL, res: ServerResponse) => unknown | Promise<unknown>> }

export function createHttp(engine: Engine, opts: HttpOptions): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const handler = opts.api?.[url.pathname];
      if (url.pathname === '/api/status') return json(res, engine.status(performance.now()));
      if (!handler) return json(res, { error: 'not found' }, 404);
      try { const out = await handler(req, url, res); if (out !== undefined) json(res, out); return; } catch (e) { return json(res, { error: String(e) }, 500); }
    }
    serveStatic(res, opts.staticDir, url.pathname);
  });
}

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveStatic(res: ServerResponse, dir: string, pathname: string): void {
  let file = normalize(join(dir, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(normalize(dir))) { res.writeHead(403); res.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html'); // SPA fallback
  if (!existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('UI not built. Run: npm run ui:build'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(readFileSync(file));
}
