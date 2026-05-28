/**
 * POST /api/cron-diet-changes
 *
 * Cron job (Vercel Cron cada 15 min — config en vercel.json). El "cron de
 * notificaciones clínicas a Catering": detecta cambios de DIETA y de AYUNO de
 * cualquier paciente ocupado y notifica al piso correspondiente vía push
 * (type 'DIET_CHANGE' y 'FASTING_CHANGE' — cada uno gobernado por su permiso).
 *
 * Estrategia:
 *   1. Bulk read del snapshot en SP (lista 11.DietaSnapshot — guarda DietHash_DS
 *      y FastingHash_DS por paciente).
 *   2. Trae camas ocupadas vía Gamma (obtenermapacamasocupadas).
 *   3. Por cada cama ocupada con paciente + evento, fetcha el evento y hashea
 *      dieta (hashTags) + ayuno (fastingHash).
 *   4. Compara cada dimensión contra el snapshot, independientes:
 *        · Sin snapshot previo → CREA + NO push (primer ciclo silencioso).
 *        · Hash igual → sin push.
 *        · Hash distinto → PUSH a Catering del piso.
 *        · FastingHash previo '' (snapshots viejos pre-feature) → bootstrap
 *          silencioso: persiste el hash sin push.
 *      Siempre refresca el snapshot (LastChecked + ambos hashes).
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

import { graphFetch } from './graph.js';
import {
  getToken, fetchEventDetails, simpleHash,
  GammaSector, GammaBed, GammaEvent,
} from './gamma-client.js';
import { sendPushToSubscribers } from './push-utils.js';
import { fastingHash, summarizeFasting } from './ayunos.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = 'f8895f54-7c86-4ebf-b281-caec77837359'; // 11.DietaSnapshot
const CRON_SECRET = process.env.CRON_SECRET ?? '';
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

const STALE_DAYS = 7; // snapshots sin update tras esto se marcan Inactivos

// ── Helpers ──────────────────────────────────────────────────────────────────
// Misma lógica de tags activos que usa /api/bed-enrich (mantener sincronizado).
function extractDietTags(event: GammaEvent | null): string[] {
  if (!event || !Array.isArray(event.DIETAS) || event.DIETAS.length === 0) return [];
  const tags: string[] = [];
  for (const d of event.DIETAS) {
    const desc = String(d?.HCG_DESCRIPCION ?? '').trim();
    const resp = String(d?.EIP_RESPUESTA_VALOR ?? '').trim();
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
  fastingHash: string;  // '' = nunca inicializado (bootstrap); 'none' = sin ayunos
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
      fastingHash: String(f.FastingHash_DS ?? ''),
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
  fastingHash: string;
}): Promise<void> {
  const basePath = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;
  const now = new Date().toISOString();
  const fields = {
    Title: '[sumar]',
    PatientCode_DS: args.patientCode,
    DietHash_DS:    args.dietHash,
    DietTags_DS:    args.dietTags.join(';'),
    FastingHash_DS: args.fastingHash,
    EventOrigin_DS: args.eventOrigin,
    EventNumber_DS: args.eventNumber,
    PatientName_DS: args.patientName,
    AreaName_DS:    args.areaName,
    LastChecked_DS: now,
    Status_DS:      'Activo',
    Entorno_DS:     ENTORNO,
  };
  if (args.existing) {
    await graphFetch(`${basePath}/${args.existing.spItemId}/fields`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    });
  } else {
    await graphFetch(basePath, {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
  }
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

  const stats = { checked: 0, created: 0, unchanged: 0, changed: 0, notified: 0, fastingChanged: 0, fastingNotified: 0, deactivated: 0, errors: 0 };

  try {
    // 1) Snapshot bulk
    const snapshots = await fetchSnapshots();

    // 2) Camas ocupadas desde Gamma
    const tokenOcc = await getToken('obtenermapacamasocupadas');
    const occRes = await fetch(
      `${process.env.GAMMA_VM_URL ?? 'http://35.224.5.114/proxy/index.php'}/oauth_resource/obtenermapacamasocupadas`,
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
      while (queue.length > 0) {
        const b = queue.shift();
        if (!b) return;
        seenCodes.add(b.patientCode);
        try {
          const event = await fetchEventDetails(tokenEvt, b.eventOrigin, b.eventNumber);
          const tags = extractDietTags(event);
          const dHash = hashTags(tags);
          const fHash = fastingHash(event?.AYUNOS);
          const existing = snapshots.get(b.patientCode);

          const baseArgs = {
            patientCode: b.patientCode,
            patientName: b.patientName,
            areaName:    b.areaName,
            eventOrigin: b.eventOrigin,
            eventNumber: b.eventNumber,
            dietHash:    dHash,
            dietTags:    tags,
            fastingHash: fHash,
          };

          if (!existing) {
            // Primer ciclo para este paciente: crear snapshot SIN push (anti-spam bootstrap).
            await upsertSnapshot({ existing: undefined, ...baseArgs });
            stats.created++;
            continue; // ← sigue procesando el resto de la queue
          }

          let changed = false;

          // ── Dieta ──
          if (existing.dietHash !== dHash) {
            changed = true;
            stats.changed++;
            const tagsLabel = tags.length > 0 ? tags.join(', ') : 'sin dieta especial';
            await sendPushToSubscribers({
              title: 'Dieta actualizada',
              body:  `${b.patientName || 'Paciente'}: ${tagsLabel}`,
              type:  'DIET_CHANGE',
              originAreaName: b.areaName, destinationAreaName: b.areaName, sede: 'HPR',
            });
            stats.notified++;
          }

          // ── Ayuno ── (independiente de dieta). Si el campo nunca se inicializó ('')
          // → solo bootstrap silencioso (lo persiste el upsert final), sin push.
          if (existing.fastingHash !== '' && existing.fastingHash !== fHash) {
            changed = true;
            stats.fastingChanged++;
            const summary = summarizeFasting(event?.AYUNOS);
            const horas = summary
              ? Array.from(new Set(summary.indications.flatMap(i => i.hours)))
                  .sort((a, b2) => a - b2)
                  .map(h => `${String(h).padStart(2, '0')}:00`).join(', ')
              : '';
            let detalle: string;
            if (existing.fastingHash === 'none') detalle = horas ? `Nuevo ayuno programado: ${horas}` : 'Nuevo ayuno programado';
            else if (fHash === 'none')           detalle = 'Ayuno cancelado';
            else                                 detalle = horas ? `Ayuno modificado: ${horas}` : 'Ayuno modificado';
            await sendPushToSubscribers({
              title: 'Ayuno actualizado',
              body:  `${b.patientName || 'Paciente'}: ${detalle}`,
              type:  'FASTING_CHANGE',
              originAreaName: b.areaName, destinationAreaName: b.areaName, sede: 'HPR',
            });
            stats.fastingNotified++;
          }

          if (!changed) stats.unchanged++;

          // Refrescar snapshot siempre (LastChecked + hashes nuevos, incl. bootstrap del fasting).
          await upsertSnapshot({ existing, ...baseArgs });
        } catch (err: any) {
          stats.errors++;
          console.error(`[cron-diet] error procesando ${b.patientCode}:`, err?.message ?? err);
        }
      }
    });
    await Promise.all(workers);

    // 5) Cleanup: snapshots no vistos en este ciclo + viejos → Inactivo.
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

    return res.status(200).json({ ok: true, entorno: ENTORNO, stats });
  } catch (err: any) {
    console.error('[cron-diet]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal error', stats });
  }
}
