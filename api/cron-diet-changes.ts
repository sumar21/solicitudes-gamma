/**
 * POST /api/cron-diet-changes
 *
 * Cron job (Vercel Cron cada 15 min — config en vercel.json). Detecta cambios
 * en la DIETA de cualquier paciente ocupado y notifica al piso correspondiente
 * vía push (type 'DIET_CHANGE').
 *
 * La detección de cambios de AYUNO vive en `cron-enrich-beds.ts` — ese cron ya
 * escribe el `fasting` en 12.EnrichCamas y compara el payload viejo vs nuevo,
 * así no duplicamos snapshots ni necesitamos columnas extra en 11.DietaSnapshot.
 *
 * Estrategia:
 *   1. Bulk read del snapshot en SP (lista 11.DietaSnapshot — guarda DietHash_DS).
 *   2. Trae camas ocupadas vía Gamma (obtenermapacamasocupadas).
 *   3. Por cada cama ocupada con paciente + evento, fetcha el evento y hashea la dieta.
 *   4. Compara contra el snapshot:
 *        · Sin snapshot previo → CREA snapshot + NO push (primer ciclo silencioso).
 *        · Hash igual → solo PATCH LastChecked_DS.
 *        · Hash distinto → PUSH a Catering del piso + PATCH del snapshot.
 *   5. Snapshots con LastChecked_DS > 7 días → marca Inactivo.
 *
 * Auth: acepta dos formas (compatibilidad con GitHub Actions legacy + Vercel Cron):
 *   - `Authorization: Bearer ${CRON_SECRET}` ← Vercel Cron lo manda automáticamente
 *   - `X-Cron-Secret: ${CRON_SECRET}`        ← GitHub Actions / curl manual
 *  No usa JWT (es un bot, no un usuario).
 *
 * Setup:
 *   - Setear CRON_SECRET (random largo) en .env.local y Vercel envs.
 *   - El LIST_ID de 11.DietaSnapshot está hardcoded abajo (convención del proyecto:
 *     los GUIDs de listas son constantes estructurales, no secretos).
 */

import { graphFetch, graphFetchRetry } from './graph.js';
import {
  getToken, fetchEventDetails, fetchWithTimeout, simpleHash,
  GammaSector, GammaBed, GammaEvent, GAMMA_BASE,
} from './gamma-client.js';
import { sendPushToSubscribers } from './push-utils.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = 'f8895f54-7c86-4ebf-b281-caec77837359'; // 11.DietaSnapshot
const CRON_SECRET = process.env.CRON_SECRET ?? '';
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

const STALE_DAYS = 7; // snapshots sin update tras esto se marcan Inactivos

// ── Helpers ──────────────────────────────────────────────────────────────────
// Normalización determinística del texto de un tag: unicode NFC + colapsar
// espacios internos + trim. Evita falsos positivos por diferencias cosméticas
// (acentos compuestos vs precompuestos, espacios dobles) que Gamma puede devolver
// de forma inconsistente entre corridas y harían "saltar" el hash sin cambio real.
// Mantener sincronizado con parseDiets en api/diet-tags.ts.
function normalizeTag(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

// Misma lógica de tags activos que usa /api/bed-enrich (mantener sincronizado).
function extractDietTags(event: GammaEvent | null): string[] {
  if (!event || !Array.isArray(event.DIETAS) || event.DIETAS.length === 0) return [];
  const tags: string[] = [];
  for (const d of event.DIETAS) {
    const desc = normalizeTag(String(d?.HCG_DESCRIPCION ?? ''));
    const resp = normalizeTag(String(d?.EIP_RESPUESTA_VALOR ?? ''));
    if (!desc) continue;
    const lresp = resp.toLowerCase();
    if (desc.toLowerCase() === 'tipo') {
      if (resp && lresp !== 'no') tags.push(resp);
    } else if (lresp === 'sí' || lresp === 'si') {
      tags.push(desc);
    }
  }
  return tags;
}

// Hash estable: ordenado para que el orden de Gamma no cause cambios falsos.
function hashTags(tags: string[]): string {
  return simpleHash([...tags].sort().join('|'));
}

interface Snapshot {
  spItemId: string;
  patientCode: string;
  dietHash: string;
  dietTags: string;
  patientName: string;
  areaName: string;
  eventOrigin: string;
  eventNumber: string;
  lastChecked: string;
}

async function fetchSnapshots(): Promise<Map<string, Snapshot>> {
  const map = new Map<string, Snapshot>();
  if (!SITE_ID || !LIST_ID) return map;
  const filter = encodeURIComponent(`fields/Status_DS eq 'Activo' and fields/Entorno_DS eq '${ENTORNO}'`);
  const r = await graphFetch(
    `/sites/${SITE_ID}/lists/${LIST_ID}/items?$expand=fields&$filter=${filter}&$top=500`,
    { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
  );
  if (!r.ok) return map;
  const data = (await r.json()) as { value: any[] };
  for (const item of data.value ?? []) {
    const f = item.fields as Record<string, unknown>;
    const code = String(f.PatientCode_DS ?? '').trim();
    if (!code) continue;
    map.set(code, {
      spItemId:    String(item.id),
      patientCode: code,
      dietHash:    String(f.DietHash_DS ?? ''),
      dietTags:    String(f.DietTags_DS ?? ''),
      patientName: String(f.PatientName_DS ?? ''),
      areaName:    String(f.AreaName_DS ?? ''),
      eventOrigin: String(f.EventOrigin_DS ?? ''),
      eventNumber: String(f.EventNumber_DS ?? ''),
      lastChecked: String(f.LastChecked_DS ?? ''),
    });
  }
  return map;
}

async function upsertSnapshot(args: {
  existing?: Snapshot;
  patientCode: string;
  patientName: string;
  areaName: string;
  eventOrigin: string;
  eventNumber: number;
  dietHash: string;
  dietTags: string[];
}): Promise<boolean> {
  const basePath = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;
  const now = new Date().toISOString();
  const fields = {
    Title: '[sumar]',
    PatientCode_DS: args.patientCode,
    DietHash_DS:    args.dietHash,
    DietTags_DS:    args.dietTags.join(';'),
    EventOrigin_DS: args.eventOrigin,
    EventNumber_DS: args.eventNumber,
    PatientName_DS: args.patientName,
    AreaName_DS:    args.areaName,
    LastChecked_DS: now,
    Status_DS:      'Activo',
    Entorno_DS:     ENTORNO,
  };
  // Devuelve si la escritura persistió. graphFetch NO lanza en respuestas no-2xx
  // (devuelve el Response crudo), así que hay que chequear .ok explícitamente: si
  // SharePoint throttlea (429) o falla, el hash NO se guarda y el caller debe evitar
  // notificar para no re-spamear el mismo cambio en la próxima corrida.
  const res = args.existing
    ? await graphFetchRetry(`${basePath}/${args.existing.spItemId}/fields`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      })
    : await graphFetchRetry(basePath, {
        method: 'POST',
        body: JSON.stringify({ fields }),
      });
  return res.ok;
}

async function markSnapshotInactive(spItemId: string): Promise<void> {
  await graphFetch(`/sites/${SITE_ID}/lists/${LIST_ID}/items/${spItemId}/fields`, {
    method: 'PATCH',
    body: JSON.stringify({ Status_DS: 'Inactivo' }),
  });
}

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Cron-Secret');

  if (req.method === 'OPTIONS') return res.status(200).end();
  // Vercel Cron usa GET por default; aceptamos ambos. Para curl/Actions legacy seguimos
  // soportando POST.
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'POST or GET only' });
  }

  // Auth por shared secret (no usuario). Aceptamos ambos formatos:
  //   - Authorization: Bearer <secret>  → Vercel Cron lo manda automáticamente
  //   - X-Cron-Secret: <secret>         → GitHub Actions / curl manual
  const authHeader = String(req.headers?.authorization ?? '');
  const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const customSecret = String(req.headers?.['x-cron-secret'] ?? '');
  const provided = bearerSecret || customSecret;
  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!SITE_ID) {
    return res.status(503).json({ error: 'SHAREPOINT_SITE_ID no configurado' });
  }

  // Modo re-baseline silencioso (disparo MANUAL, no automático): persiste todos los
  // hashes pero NO envía ningún push. Sirve para re-sincronizar el snapshot tras un
  // deploy que cambia el formato de hash o tras un cambio masivo de nomenclatura en
  // Progal, evitando una única ola legítima de notificaciones. Uso: ?silent=1.
  const silent = ['1', 'true', 'yes'].includes(
    String(req.query?.silent ?? req.query?.rebaseline ?? '').toLowerCase(),
  );

  const stats = { checked: 0, created: 0, unchanged: 0, changed: 0, notified: 0, skippedPersistFail: 0, skippedByBudget: 0, deactivated: 0, errors: 0, silent };

  // Presupuesto de tiempo por corrida: si nos acercamos al maxDuration (300s),
  // cortamos prolijo y devolvemos 200 con stats parciales en vez de que Vercel mate
  // la función (status 0). Las camas que quedaron se retoman en el próximo ciclo.
  const deadline = Date.now() + Number(process.env.CRON_BUDGET_MS ?? 240_000);

  try {
    // 1) Snapshot bulk
    const snapshots = await fetchSnapshots();

    // 2) Camas ocupadas desde Gamma
    const tokenOcc = await getToken('obtenermapacamasocupadas');
    const occRes = await fetchWithTimeout(
      `${GAMMA_BASE}/oauth_resource/obtenermapacamasocupadas`,
      { headers: { Authorization: `Bearer ${tokenOcc}` } },
    );
    if (!occRes.ok) {
      return res.status(502).json({ error: 'Gamma obtenermapacamasocupadas falló', stats });
    }
    const occData = (await occRes.json()) as GammaSector[];

    // 3) Flatten camas ocupadas con paciente + evento válido
    interface OccupiedBed {
      patientCode: string;
      patientName: string;
      areaName: string;
      eventOrigin: string;
      eventNumber: number;
    }
    const beds: OccupiedBed[] = [];
    for (const sector of occData) {
      for (const room of sector.habitaciones ?? []) {
        for (const bed of room.camas ?? []) {
          const code = bed.codigo_paciente ? String(bed.codigo_paciente).trim() : '';
          const origen = bed.origen_evento ? String(bed.origen_evento).trim() : '';
          const numero = typeof bed.numero_evento === 'number' ? bed.numero_evento : Number(bed.numero_evento);
          if (!code || !origen || !numero) continue;
          beds.push({
            patientCode: code,
            patientName: String(bed.paciente ?? '').trim(),
            areaName:    String(sector.nombre ?? '').trim(),
            eventOrigin: origen,
            eventNumber: numero,
          });
        }
      }
    }
    stats.checked = beds.length;

    // 4) Por cada cama: fetch evento + comparar + actuar.
    // Concurrencia limitada (5 a la vez) para no saturar Gamma.
    const tokenEvt = await getToken('obtenereventointernacion');
    const seenCodes = new Set<string>();
    const queue = [...beds];
    const workers = Array.from({ length: 5 }, async () => {
      while (queue.length > 0 && Date.now() < deadline) {
        const b = queue.shift();
        if (!b) return;
        seenCodes.add(b.patientCode);
        try {
          const event = await fetchEventDetails(tokenEvt, b.eventOrigin, b.eventNumber);
          // null = fetch falló/timeout. NO lo tratamos como "sin dieta": eso
          // dispararía un falso push de "dieta removida". Saltamos — el hash viejo
          // queda intacto y se reintenta en el próximo ciclo.
          if (event === null) {
            stats.errors++;
            continue;
          }
          const tags = extractDietTags(event);
          const dHash = hashTags(tags);
          const existing = snapshots.get(b.patientCode);

          const baseArgs = {
            patientCode: b.patientCode,
            patientName: b.patientName,
            areaName:    b.areaName,
            eventOrigin: b.eventOrigin,
            eventNumber: b.eventNumber,
            dietHash:    dHash,
            dietTags:    tags,
          };

          if (!existing) {
            // Primer ciclo para este paciente: crear snapshot SIN push (anti-spam bootstrap).
            await upsertSnapshot({ existing: undefined, ...baseArgs });
            stats.created++;
            continue;
          }

          const changed = existing.dietHash !== dHash;

          // Persistir PRIMERO (LastChecked + hash nuevo). Si la escritura falla
          // (SP throttle/error), NO notificamos: el hash viejo queda intacto y el
          // cambio se vuelve a detectar — y notificar una sola vez — cuando SP
          // persista en una corrida futura. Esto corta el spam auto-perpetuado.
          const persisted = await upsertSnapshot({ existing, ...baseArgs });

          if (!persisted) {
            stats.skippedPersistFail++;
            console.warn(`[cron-diet] persist FAIL patient=${b.patientCode} (${b.patientName}) — push pospuesto`);
            continue;
          }

          if (changed) {
            stats.changed++;
            // Log del diff para diagnosticar falsos positivos: si prev/new son
            // idénticos visualmente pero el hash difiere → hash inestable / dato corrupto.
            console.log(`[cron-diet] DIETA CHANGE patient=${b.patientCode} (${b.patientName})${silent ? ' [silent]' : ''}`);
            console.log(`  prev hash=${existing.dietHash} tags=${existing.dietTags || '(vacío)'}`);
            console.log(`  new  hash=${dHash} tags=${tags.join(';') || '(vacío)'}`);
            if (!silent) {
              const tagsLabel = tags.length > 0 ? tags.join(', ') : 'sin dieta especial';
              await sendPushToSubscribers({
                title: 'Dieta actualizada',
                body:  `${b.patientName || 'Paciente'}: ${tagsLabel}`,
                type:  'DIET_CHANGE',
                originAreaName: b.areaName, destinationAreaName: b.areaName, sede: 'HPR',
              });
              stats.notified++;
            }
          } else {
            stats.unchanged++;
          }
        } catch (err: any) {
          stats.errors++;
          console.error(`[cron-diet] error procesando ${b.patientCode}:`, err?.message ?? err);
        }
      }
    });
    await Promise.all(workers);

    // Si cortamos por presupuesto, las camas sin procesar quedan para el próximo ciclo.
    if (queue.length > 0) {
      stats.skippedByBudget = queue.length;
      console.warn(`[cron-diet] budget agotado: ${queue.length} camas pospuestas al próximo ciclo`);
    }

    // 5) Cleanup: snapshots no vistos en este ciclo + viejos → Inactivo.
    // Sólo si no agotamos el presupuesto: con la corrida cortada habría camas no
    // vistas que no son stale de verdad. El cleanup se retoma el próximo ciclo.
    if (Date.now() < deadline) {
      const staleCutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
      for (const [code, snap] of snapshots) {
        if (seenCodes.has(code)) continue;
        const lastTs = Date.parse(snap.lastChecked);
        if (!isNaN(lastTs) && lastTs < staleCutoff) {
          try {
            await markSnapshotInactive(snap.spItemId);
            stats.deactivated++;
          } catch { /* no-op */ }
        }
      }
    }

    return res.status(200).json({ ok: true, entorno: ENTORNO, stats });
  } catch (err: any) {
    console.error('[cron-diet]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal error', stats });
  }
}
