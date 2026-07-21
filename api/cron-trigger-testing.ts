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
    // FIRE-AND-FORGET (antes: esperaba 290s a que el Preview terminara).
    //
    // Este handler no hace trabajo propio: solo despierta al enrich del Preview. Esperar a
    // que ese enrich TERMINE mantenía viva una instancia de PRODUCCIÓN los ~100-290s que
    // tardaba, 96 veces por día, con ~0% de CPU — puro Provisioned Memory facturado por
    // estar sentado esperando. Se pagaba dos veces la misma corrida: la del Preview que
    // hace el trabajo y la de prod que la mira.
    //
    // Con 10s alcanza para que el request LLEGUE y el Preview arranque (cubre cold start).
    // El AbortError posterior es el resultado ESPERADO, no un fallo: significa que el
    // disparo salió y nos desentendimos. Por eso se devuelve 202 y no 502 — un 502 acá
    // ensuciaría los logs de cron con "fallas" que no lo son.
    const r = await fetchWithTimeout(
      url,
      { method: 'POST', headers: { 'X-Cron-Secret': CRON_SECRET } },
      10_000,
    );
    // Si el Preview igual contestó rápido, lo logueamos; no cambia nada.
    const text = await r.text();
    console.log(`[cron-trigger-testing] upstream ${r.status}: ${text.slice(0, 300)}`);
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok, upstreamStatus: r.status, upstream: text.slice(0, 500) });
  } catch (e: any) {
    // Timeout = disparo exitoso. El enrich sigue corriendo del lado del Preview.
    if (e?.name === 'AbortError') {
      console.log('[cron-trigger-testing] disparado (fire-and-forget, sin esperar al upstream)');
      return res.status(202).json({ ok: true, triggered: true, awaited: false });
    }
    console.error('[cron-trigger-testing] error:', e?.message ?? e);
    return res.status(502).json({ ok: false, error: e?.message ?? 'fetch failed' });
  }
}
