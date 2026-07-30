/**
 * Local dev server — replaces `vercel dev` for API routes.
 * Run with: npx tsx dev-server.ts
 * Listens on port 3000. Vite proxies /api/* here.
 */
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Carga de env: .env.local primero y .env después, como fallback.
//
// Antes solo leía .env.local. Como este repo tiene `.env` (y no `.env.local`), el server
// arrancaba SIN NINGUNA variable — sin JWT_SECRET ni credenciales de SharePoint/Gamma — y el
// síntoma era un login que fallaba con "Token inválido" sin ninguna pista del motivo.
//
// El orden importa: `.env.local` gana porque es el override personal de cada dev (y está en
// .gitignore). Se usa `if (!process.env[key])` en las dos pasadas, así una variable ya
// definida en el entorno real (o en .env.local) nunca se pisa con la de .env.
const envFiles = ['.env.local', '.env'];
const envLoaded: string[] = [];
for (const file of envFiles) {
  try {
    const lines = readFileSync(resolve(import.meta.dirname ?? '.', file), 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      // Se quitan comillas envolventes: `FOO="bar"` y `FOO='bar'` son válidos en un .env.
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
    envLoaded.push(file);
  } catch { /* el archivo puede no existir — se prueba el siguiente */ }
}
if (envLoaded.length) {
  console.log(`[dev-server] env cargado desde: ${envLoaded.join(', ')}`);
} else {
  console.warn('[dev-server] ⚠️  No se encontró .env.local ni .env — los endpoints van a fallar por falta de credenciales.');
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
  '/api/ticket-observations': () => import('./api/ticket-observations'),
  '/api/test':          () => import('./api/test'),
  '/api/users':              () => import('./api/users'),
  '/api/validate-location':  () => import('./api/validate-location'),
  '/api/isolations':         () => import('./api/isolations'),
  '/api/limpiezas':          () => import('./api/limpiezas'),
  '/api/dietas':             () => import('./api/dietas'),
  '/api/carga-menu':         () => import('./api/carga-menu'),
  '/api/push-subscribe':     () => import('./api/push-subscribe'),
  '/api/notifications':      () => import('./api/notifications'),
  '/api/bed-enrich':         () => import('./api/bed-enrich'),
  '/api/roles':              () => import('./api/roles'),
  '/api/me':                 () => import('./api/me'),
  '/api/cron-diet-changes':  () => import('./api/cron-diet-changes'),
  '/api/cron-enrich-beds':   () => import('./api/cron-enrich-beds'),
  '/api/cron-trigger-testing': () => import('./api/cron-trigger-testing'),
  '/api/cron-cleanup-notifs': () => import('./api/cron-cleanup-notifs'),
  '/api/client-ip':          () => import('./api/client-ip'),
  '/api/supabase-token':     () => import('./api/supabase-token'),
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

// EADDRINUSE con mensaje accionable en vez del stack trace de Node. Pasa cuando quedó un
// dev-server zombie de una corrida anterior (crash de tsx watch, terminal duplicada, etc.).
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error('\n[dev-server] ⚠️  El puerto 3000 ya está ocupado por otro proceso.');
    console.error('[dev-server] Casi seguro es un dev-server viejo que quedó colgado. Matalo con:');
    console.error('[dev-server]     lsof -ti:3000 | xargs kill');
    console.error('[dev-server] y volvé a correr `npm run dev:full`.\n');
    process.exit(1);
  }
  throw err;
});

server.listen(3000, () => {
  console.log('[dev-server] API running on http://localhost:3000');
  console.log('[dev-server] Routes:', Object.keys(routes).join(', '));
});
