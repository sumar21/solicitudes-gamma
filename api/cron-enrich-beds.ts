/**
 * GET/POST /api/cron-enrich-beds
 *
 * Cron job (Vercel Cron cada 15 min — config en vercel.json). Precomputa el enrich
 * de TODAS las camas ocupadas (paciente + evento: DNI, edad, sexo, diagnóstico,
 * dieta, ayunos, fechas, plan) y lo persiste en la lista SP 12.EnrichCamas.
 *
 * Así /api/beds NO hace las N llamadas de evento en el request del usuario (que
 * timeouteaban a >60s): lee este cache de SP y mergea. El estado de cama sigue en vivo.
 *
 * Auth: CRON_SECRET (Bearer que manda Vercel Cron, o X-Cron-Secret manual). No JWT.
 */

import { graphFetch } from './graph.js';
import { getToken, simpleHash, GammaSector } from './gamma-client.js';
import { buildEnrich, type EnrichResult } from './enrich-core.js';
import type { FastingSummary } from './ayunos.js';
import { sendPushToSubscribers } from './push-utils.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = '443c4ff0-bc98-43ef-a49c-7fd91cc63734'; // 12.EnrichCamas
const CRON_SECRET = process.env.CRON_SECRET ?? '';
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();
const GAMMA_BASE = process.env.GAMMA_VM_URL ?? 'http://35.224.5.114/proxy/index.php';

const WORKERS = 8;
const STALE_MS = 60 * 60 * 1000; // filas no vistas + sin update hace >1h → Inactivo

interface EnrichRow {
  spItemId: string;
  eventKey: string;
  updatedAt: string;
  // Fasting del Payload_EC anterior — sirve para detectar cambios y mandar push
  // a Catering (notif_fasting_change). Si no había fasting en el payload viejo,
  // queda undefined (= 'none' al hashear → bootstrap silencioso si tampoco hay ahora).
  oldFasting: FastingSummary | undefined;
}

// Hash estable del estado de ayunos. Mismo criterio que api/ayunos.ts fastingHash
// pero recibe el `FastingSummary` ya procesado (lo que guardamos en Payload_EC).
// 'none' cuando no hay indicaciones — distinto de un hash real, así detectamos
// transición "no ayuno → ayuno" y viceversa.
function hashFastingSummary(s: FastingSummary | undefined | null): string {
  if (!s || !s.indications || s.indications.length === 0) return 'none';
  const sig = s.indications
    .map(i => `${i.indicationId}:${i.hours.join(',')}:${i.startISO}:${i.totalOccurrences ?? 'n'}`)
    .sort()
    .join('|');
  return simpleHash(sig);
}

// Formato "HH:00, HH:00, ..." con horas únicas y ordenadas para el body del push.
function formatFastingHours(s: FastingSummary | undefined | null): string {
  if (!s) return '';
  return Array.from(new Set(s.indications.flatMap(i => i.hours)))
    .sort((a, b) => a - b)
    .map(h => `${String(h).padStart(2, '0')}:00`)
    .join(', ');
}

// True si la fecha de ingreso es ≤24h atrás. Se usa para distinguir
// "paciente pre-existente" (bootstrap silencioso) vs "paciente recién ingresado
// con ayuno" (notificar igual). Gamma manda EVE_FECHA_HORA_INGRESO sin tz —
// el espacio se reemplaza por 'T' para que Date.parse lo acepte en todos los runtimes.
function isRecentAdmission(admissionDate: string | undefined): boolean {
  if (!admissionDate) return false;
  const ts = Date.parse(admissionDate.replace(' ', 'T'));
  if (isNaN(ts)) return false;
  return (Date.now() - ts) <= 24 * 60 * 60 * 1000;
}

async function fetchEnrichRows(): Promise<Map<string, EnrichRow>> {
  const map = new Map<string, EnrichRow>();
  if (!SITE_ID || !LIST_ID) return map;
  const filter = encodeURIComponent(`fields/Status_EC eq 'Activo' and fields/Entorno_EC eq '${ENTORNO}'`);
  const r = await graphFetch(
    `/sites/${SITE_ID}/lists/${LIST_ID}/items?$expand=fields&$filter=${filter}&$top=500`,
    { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
  );
  if (!r.ok) return map;
  const data = (await r.json()) as { value: any[] };
  for (const item of data.value ?? []) {
    const f = item.fields as Record<string, unknown>;
    const key = String(f.EventKey_EC ?? '').trim();
    if (!key) continue;
    // Parsear Payload_EC para extraer el fasting viejo (comparación de cambio).
    let oldFasting: FastingSummary | undefined;
    try {
      const raw = String(f.Payload_EC ?? '');
      if (raw) {
        const parsed = JSON.parse(raw) as EnrichResult;
        oldFasting = parsed.fasting;
      }
    } catch { /* fila corrupta — sin oldFasting */ }
    map.set(key, {
      spItemId:  String(item.id),
      eventKey:  key,
      updatedAt: String(f.UpdatedAt_EC ?? ''),
      oldFasting,
    });
  }
  return map;
}

async function upsertEnrich(args: {
  existing?: EnrichRow;
  eventKey: string;
  patientCode: string;
  payload: unknown;
}): Promise<void> {
  const basePath = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;
  const fields = {
    Title:          '[sumar]',
    EventKey_EC:    args.eventKey,
    PatientCode_EC: args.patientCode,
    Payload_EC:     JSON.stringify(args.payload),
    UpdatedAt_EC:   new Date().toISOString(),
    Status_EC:      'Activo',
    Entorno_EC:     ENTORNO,
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

async function markInactive(spItemId: string): Promise<void> {
  await graphFetch(`/sites/${SITE_ID}/lists/${LIST_ID}/items/${spItemId}/fields`, {
    method: 'PATCH',
    body: JSON.stringify({ Status_EC: 'Inactivo' }),
  });
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Cron-Secret');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'POST or GET only' });
  }

  const authHeader = String(req.headers?.authorization ?? '');
  const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const customSecret = String(req.headers?.['x-cron-secret'] ?? '');
  const provided = bearerSecret || customSecret;
  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!SITE_ID) return res.status(503).json({ error: 'SHAREPOINT_SITE_ID no configurado' });
  if (!LIST_ID) return res.status(503).json({ error: '12.EnrichCamas LIST_ID no configurado' });

  const stats = { checked: 0, upserted: 0, errors: 0, deactivated: 0 };

  try {
    // 1) Filas existentes en SP.
    const rows = await fetchEnrichRows();

    // 2) Camas ocupadas desde Gamma.
    const tokenOcc = await getToken('obtenermapacamasocupadas');
    const occRes = await fetch(
      `${GAMMA_BASE}/oauth_resource/obtenermapacamasocupadas`,
      { headers: { Authorization: `Bearer ${tokenOcc}` } },
    );
    if (!occRes.ok) {
      return res.status(502).json({ error: 'Gamma obtenermapacamasocupadas falló', stats });
    }
    const occData = (await occRes.json()) as GammaSector[];

    // 3) Flatten a camas con paciente + evento válido. Guardamos areaName/patientName
    // para que la detección de cambio de fasting pueda emitir push (Catering filtra por
    // área y necesita el nombre legible).
    interface OccBed {
      patientCode: string; eventOrigin: string; eventNumber: number;
      areaName: string; patientName: string;
    }
    const beds: OccBed[] = [];
    for (const sector of occData) {
      for (const room of sector.habitaciones ?? []) {
        for (const bed of room.camas ?? []) {
          const code = bed.codigo_paciente ? String(bed.codigo_paciente).trim() : '';
          const origen = bed.origen_evento ? String(bed.origen_evento).trim() : '';
          const numero = typeof bed.numero_evento === 'number' ? bed.numero_evento : Number(bed.numero_evento);
          if (!code || !origen || !numero) continue;
          beds.push({
            patientCode: code, eventOrigin: origen, eventNumber: numero,
            areaName: String(sector.nombre ?? '').trim(),
            patientName: String(bed.paciente ?? '').trim(),
          });
        }
      }
    }
    stats.checked = beds.length;

    // 4) Worker pool: build enrich + upsert por cama.
    const [tokenPat, tokenEvt] = await Promise.all([
      getToken('consultarpacientecodigo'),
      getToken('obtenereventointernacion'),
    ]);
    const seenKeys = new Set<string>();
    const queue = [...beds];
    let fastingNotified = 0;
    const worker = async () => {
      while (queue.length > 0) {
        const b = queue.shift();
        if (!b) return;
        const eventKey = `${b.eventOrigin}-${b.eventNumber}`;
        seenKeys.add(eventKey);
        try {
          const payload = await buildEnrich({
            tokenPat, tokenEvt,
            patientCode: b.patientCode,
            eventOrigin: b.eventOrigin,
            eventNumber: b.eventNumber,
          });

          // ── Detección de cambio de fasting (push a Catering / quien tenga notif_fasting_change) ──
          // Dos disparadores:
          //  · Fila existente y el hash de fasting cambió → push (alta/baja/modificación).
          //  · Fila NUEVA + el paciente ingresó hace ≤24h + tiene fasting → push igual.
          //    Esto evita perder la notificación de "primer ayuno" cuando coincide con el
          //    primer ciclo del cron para ese paciente. El bootstrap silencioso se mantiene
          //    para pacientes pre-existentes (admisión >24h) para no spamear ayunos viejos
          //    si se reseteara la lista 12.EnrichCamas.
          const existing = rows.get(eventKey);
          const newFasting = payload.fasting;
          const hasFasting = !!(newFasting && newFasting.indications.length > 0);
          if (existing) {
            const oldHash = hashFastingSummary(existing.oldFasting);
            const newHash = hashFastingSummary(newFasting);
            if (oldHash !== newHash) {
              const horas = formatFastingHours(newFasting);
              let detalle: string;
              if (oldHash === 'none')      detalle = horas ? `Nuevo ayuno programado: ${horas}` : 'Nuevo ayuno programado';
              else if (newHash === 'none') detalle = 'Ayuno cancelado';
              else                          detalle = horas ? `Ayuno modificado: ${horas}` : 'Ayuno modificado';
              console.log(`[cron-enrich] FASTING CHANGE ${eventKey} patient=${b.patientName} old=${oldHash} new=${newHash}`);
              await sendPushToSubscribers({
                title: 'Ayuno actualizado',
                body:  `${b.patientName || 'Paciente'}: ${detalle}`,
                type:  'FASTING_CHANGE',
                originAreaName: b.areaName, destinationAreaName: b.areaName, sede: 'HPR',
              });
              fastingNotified++;
            }
          } else if (hasFasting && isRecentAdmission(payload.admissionDate)) {
            const horas = formatFastingHours(newFasting);
            const detalle = horas ? `Nuevo ayuno programado: ${horas}` : 'Nuevo ayuno programado';
            console.log(`[cron-enrich] FASTING NEW-PATIENT ${eventKey} patient=${b.patientName} admission=${payload.admissionDate}`);
            await sendPushToSubscribers({
              title: 'Ayuno actualizado',
              body:  `${b.patientName || 'Paciente'}: ${detalle}`,
              type:  'FASTING_CHANGE',
              originAreaName: b.areaName, destinationAreaName: b.areaName, sede: 'HPR',
            });
            fastingNotified++;
          }

          await upsertEnrich({
            existing,
            eventKey,
            patientCode: b.patientCode,
            payload,
          });
          stats.upserted++;
        } catch (err: any) {
          stats.errors++;
          console.error(`[cron-enrich] error en ${eventKey}:`, err?.message ?? err);
        }
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
    (stats as any).fastingNotified = fastingNotified;

    // 5) Cleanup: filas no vistas en este ciclo + viejas → Inactivo.
    const staleCutoff = Date.now() - STALE_MS;
    for (const [key, row] of rows) {
      if (seenKeys.has(key)) continue;
      const ts = Date.parse(row.updatedAt);
      if (!isNaN(ts) && ts < staleCutoff) {
        try { await markInactive(row.spItemId); stats.deactivated++; } catch { /* no-op */ }
      }
    }

    return res.status(200).json({ ok: true, entorno: ENTORNO, stats });
  } catch (err: any) {
    console.error('[cron-enrich]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal error', stats });
  }
}
