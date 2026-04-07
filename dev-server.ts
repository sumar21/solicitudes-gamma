/**
 * Local dev server — replaces `vercel dev` for API routes.
 * Run with: npx tsx dev-server.ts
 * Listens on port 3000. Vite proxies /api/* here.
 */
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local
try {
  const envPath = resolve(import.meta.dirname ?? '.', '.env.local');
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
  console.log('[dev-server] .env.local loaded');
} catch (e: any) {
  console.warn('[dev-server] Could not load .env.local:', e.message);
}

// Vercel-style request/response adapter
function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      try { resolve(JSON.parse(raw)); } catch { resolve(raw || undefined); }
    });
    req.on('error', () => resolve(undefined));
  });
}

function createRes(nodeRes: ServerResponse) {
  let headersSent = false;
  const res: any = {
    statusCode: 200,
    _headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { res._headers[k] = v; return res; },
    status(code: number) { res.statusCode = code; return res; },
    json(data: unknown) {
      if (headersSent) return res;
      headersSent = true;
      const body = JSON.stringify(data);
      nodeRes.writeHead(res.statusCode, {
        ...res._headers,
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      nodeRes.end(body);
      return res;
    },
    end() {
      if (headersSent) return res;
      headersSent = true;
      nodeRes.writeHead(res.statusCode, {
        ...res._headers,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      nodeRes.end();
      return res;
    },
  };
  return res;
}

// Route table
const routes: Record<string, () => Promise<any>> = {
  '/api/auth':          () => import('./api/auth'),
  '/api/beds':          () => import('./api/beds'),
  '/api/tickets':       () => import('./api/tickets'),
  '/api/ticket-events': () => import('./api/ticket-events'),
  '/api/test':          () => import('./api/test'),
  '/api/users':              () => import('./api/users'),
  '/api/validate-location':  () => import('./api/validate-location'),
  '/api/isolations':         () => import('./api/isolations'),
  '/api/push-subscribe':     () => import('./api/push-subscribe'),
  '/api/notifications':      () => import('./api/notifications'),
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:3000`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  const loader = routes[pathname];
  if (!loader) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Route not found: ${pathname}` }));
    return;
  }

  try {
    const mod = await loader();
    const handler = mod.default;

    // Build Vercel-compatible req
    const body = await parseBody(req);
    const vercelReq: any = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body,
      query: Object.fromEntries(url.searchParams),
      socket: req.socket,
      connection: req.connection,
    };

    const vercelRes = createRes(res);
    await handler(vercelReq, vercelRes);
  } catch (err: any) {
    console.error(`[dev-server] Error in ${pathname}:`, err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
});

server.listen(3000, () => {
  console.log('[dev-server] API running on http://localhost:3000');
  console.log('[dev-server] Routes:', Object.keys(routes).join(', '));
});
