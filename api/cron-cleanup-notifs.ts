/**
 * GET/POST /api/cron-cleanup-notifs
 *
 * Cron job (diario — config en vercel.json). PODA 10.Notificaciones: BORRA las notificaciones
 * más viejas que RETENTION_DAYS días (cualquier Status).
 *
 * Por qué borrar (y no solo marcar Leida, como antes): la lista crecía sin tope (>25k filas) y
 * superaba el list-view threshold de SharePoint (5000). Las queries de la campanita filtran por
 * UserId_N/Entorno_N + $orderby Fecha_N sobre columnas NO indexadas → pasado el umbral devuelven
 * un subconjunto parcial/viejo que EXCLUYE las filas recientes → la campanita queda vacía para los
 * usuarios con mucho push. Acotar la lista a ~RETENTION_DAYS la mantiene por debajo del umbral y
 * restaura queries confiables. Las notis son log transitorio de UI (la campanita solo muestra 24h),
 * no registros de negocio, así que borrarlas es seguro.
 *
 * Escaneo SIN $filter/$orderby (paginado secuencial por id = más viejas primero) para NO depender
 * del umbral roto que estamos arreglando. Filtra Entorno_N + Fecha_N en memoria. Acotado por
 * MAX_DELETE/run: drena el backlog en varias corridas y en régimen permanente borra poco.
 *
 * Auth: CRON_SECRET (Bearer que manda Vercel Cron, o X-Cron-Secret manual).
 */

import { graphFetch, graphBatchDelete } from './graph.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = '240f00dd-715b-4c78-9661-3147b7650a0f'; // 10.Notificaciones
const CRON_SECRET = process.env.CRON_SECRET ?? '';
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

const RETENTION_DAYS = 3;   // > ventana 24h de la campanita, con margen
const MAX_SCAN = 24000;     // backstop de escaneo por corrida
const MAX_DELETE = 8000;    // tope de borrado por corrida (cómodo bajo maxDuration 300s)

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
    // Escaneo secuencial SIN $filter/$orderby (orden por id = más viejas primero). Esto evita
    // el list-view threshold que rompe las queries filtradas/ordenadas sobre columnas no indexadas.
    const toDelete: string[] = [];
    let scanned = 0;
    let next: string | null = `${basePath}?$expand=fields($select=Fecha_N,Entorno_N)&$top=500`;
    while (next && scanned < MAX_SCAN && toDelete.length < MAX_DELETE) {
      const r: any = await graphFetch(next, { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } });
      if (!r.ok) {
        console.error(`[cron-cleanup-notifs] scan HTTP ${r.status}`);
        return res.status(502).json({ error: 'scan failed', status: r.status });
      }
      const data: any = await r.json();
      for (const it of data.value ?? []) {
        scanned++;
        const f = it.fields ?? {};
        if (String(f.Entorno_N ?? '') !== ENTORNO) continue;
        const fecha = Date.parse(String(f.Fecha_N ?? ''));
        if (!isNaN(fecha) && fecha < cutoff) {
          toDelete.push(String(it.id));
          if (toDelete.length >= MAX_DELETE) break;
        }
      }
      const raw = data['@odata.nextLink'] as string | undefined;
      next = raw ? raw.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, '') : null;
    }

    const { deleted, failed } = await graphBatchDelete(basePath, toDelete);
    // remaining=1 si cortamos por tope (hay más backlog para la próxima corrida).
    const remaining = (next && (scanned >= MAX_SCAN || toDelete.length >= MAX_DELETE)) ? 1 : 0;

    console.log(`[cron-cleanup-notifs] entorno=${ENTORNO} retentionDays=${RETENTION_DAYS} scanned=${scanned} toDelete=${toDelete.length} deleted=${deleted} failed=${failed} remaining=${remaining}`);
    return res.status(200).json({ ok: true, entorno: ENTORNO, retentionDays: RETENTION_DAYS, scanned, toDelete: toDelete.length, deleted, failed, remaining });
  } catch (err: any) {
    console.error('[cron-cleanup-notifs]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
}
