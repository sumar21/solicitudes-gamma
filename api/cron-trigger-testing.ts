/**
 * GET/POST /api/cron-trigger-testing
 *
 * Vercel Cron (corre SOLO en Production) cuyo único trabajo es DISPARAR el enrich de
 * la partición TESTING. No hace el enrich él mismo: le pega al `/api/cron-enrich-beds`
 * del deployment Preview de `develop` (que tiene ENTORNO=TESTING + GAMMA_VM_URL test),
 * para que el enrich corra con el CÓDIGO DE DEVELOP contra PROGAL test y escriba las
 * filas `Entorno_EC = 'TESTING'` de 12.EnrichCamas.
 *
 * Reemplaza a .github/workflows/enrich-testing.yml: el scheduler de GitHub Actions es
 * best-effort y se atrasa; el de Vercel es confiable. (Los Vercel Cron corren solo en
 * Production, por eso este forwarder vive acá y reenvía al Preview en vez de enriquecer
 * en prod — así no pierde el código de develop ni toca la lógica del enrich.)
 *
 * Auth: CRON_SECRET (Bearer que manda Vercel Cron, o X-Cron-Secret manual). No JWT.
 * Requiere la env var TESTING_BASE_URL (alias estable del Preview de develop, sin barra final).
 */

import { fetchWithTimeout } from './gamma-client.js';

const CRON_SECRET = process.env.CRON_SECRET ?? '';
const TESTING_BASE_URL = (process.env.TESTING_BASE_URL ?? '').replace(/\/$/, '');

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Cron-Secret');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'POST or GET only' });
  }

  // Mismo patrón de auth que cron-enrich-beds.
  const authHeader = String(req.headers?.authorization ?? '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const custom = String(req.headers?.['x-cron-secret'] ?? '');
  if (!CRON_SECRET || (bearer || custom) !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!TESTING_BASE_URL) {
    return res.status(503).json({ error: 'TESTING_BASE_URL no configurado' });
  }

  const url = `${TESTING_BASE_URL}/api/cron-enrich-beds`;
  try {
    // 290s < maxDuration 300; el enrich del Preview se autocorta por CRON_BUDGET_MS (~240s).
    // No pasamos ?silent: el enrich del Preview debe comportarse normal (push a suscriptores TESTING).
    const r = await fetchWithTimeout(
      url,
      { method: 'POST', headers: { 'X-Cron-Secret': CRON_SECRET } },
      290_000,
    );
    const text = await r.text();
    console.log(`[cron-trigger-testing] upstream ${r.status}: ${text.slice(0, 300)}`);
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok, upstreamStatus: r.status, upstream: text.slice(0, 500) });
  } catch (e: any) {
    console.error('[cron-trigger-testing] error:', e?.message ?? e);
    return res.status(502).json({ ok: false, error: e?.message ?? 'fetch failed' });
  }
}
