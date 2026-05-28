/**
 * GET/POST /api/cron-cleanup-notifs
 *
 * Cron job (diario — config en vercel.json). Marca como 'Leida' las notificaciones
 * de 10.Notificaciones que quedaron en 'Enviada' hace más de RETENTION_DAYS días.
 *
 * Por qué: usuarios que reciben mucho push (ej. Admin) acumulan miles de filas
 * 'Enviada' que nunca se confirman → el banner de "pendientes sin confirmar" nunca
 * baja y la lista crece sin parar. Una notif sin confirmar tras N días ya no es
 * accionable: se da por leída. NO borra (no destructivo) — solo cambia el Status.
 *
 * Auth: CRON_SECRET (Bearer que manda Vercel Cron, o X-Cron-Secret manual).
 */

import { graphFetch, graphBatchPatchFields } from './graph.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = '240f00dd-715b-4c78-9661-3147b7650a0f'; // 10.Notificaciones
const CRON_SECRET = process.env.CRON_SECRET ?? '';
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

const RETENTION_DAYS = 2;
const MAX_SCAN = 5000;

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Cron-Secret');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'POST or GET only' });
  }

  const authHeader = String(req.headers?.authorization ?? '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const custom = String(req.headers?.['x-cron-secret'] ?? '');
  if (!CRON_SECRET || (bearer || custom) !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!SITE_ID) return res.status(503).json({ error: 'SHAREPOINT_SITE_ID no configurado' });

  const basePath = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  try {
    // Traer todas las 'Enviada' del entorno y filtrar por fecha en memoria
    // (Fecha_N no está indexada → no confiamos en `lt` server-side).
    const filter = encodeURIComponent(`fields/Status_N eq 'Enviada' and fields/Entorno_N eq '${ENTORNO}'`);
    const stale: string[] = [];
    let scanned = 0;
    let next: string | null = `${basePath}?$expand=fields($select=Fecha_N)&$filter=${filter}&$top=500`;
    while (next && scanned < MAX_SCAN) {
      const r: any = await graphFetch(next, { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } });
      if (!r.ok) {
        console.error(`[cron-cleanup-notifs] lookup HTTP ${r.status}`);
        return res.status(502).json({ error: 'lookup failed', status: r.status });
      }
      const data: any = await r.json();
      for (const it of data.value ?? []) {
        scanned++;
        const fecha = Date.parse(String(it.fields?.Fecha_N ?? ''));
        if (!isNaN(fecha) && fecha < cutoff) stale.push(String(it.id));
      }
      const raw = data['@odata.nextLink'] as string | undefined;
      next = raw ? raw.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, '') : null;
    }

    const nowIso = new Date().toISOString();
    const { updated, failed } = await graphBatchPatchFields(
      basePath,
      stale.map(id => ({ id, fields: { Status_N: 'Leida', LeidaAt_N: nowIso } })),
    );

    console.log(`[cron-cleanup-notifs] entorno=${ENTORNO} scanned=${scanned} stale=${stale.length} updated=${updated} failed=${failed}`);
    return res.status(200).json({ ok: true, entorno: ENTORNO, retentionDays: RETENTION_DAYS, scanned, stale: stale.length, updated, failed });
  } catch (err: any) {
    console.error('[cron-cleanup-notifs]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
}
