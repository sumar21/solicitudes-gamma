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

import { graphFetch, graphFetchRetry } from './graph.js';
import { getToken, fetchWithTimeout, simpleHash, GammaSector } from './gamma-client.js';
import { buildEnrich, type EnrichResult } from './enrich-core.js';
import type { FastingSummary } from './ayunos.js';
import { sendPushToSubscribers } from './push-utils.js';
import { formatRoomForCatering } from './room-formatter.js';
import { getSupabaseAdmin } from './supabase-admin.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = '443c4ff0-bc98-43ef-a49c-7fd91cc63734'; // 12.EnrichCamas
const CRON_SECRET = process.env.CRON_SECRET ?? '';
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();
const GAMMA_BASE = process.env.GAMMA_VM_URL ?? 'http://35.224.5.114/proxy/index.php';

// Concurrencia contra Gamma. La VM es SINGLE-NODE (docs/arquitectura.md §41): 8 workers en
// paralelo la saturan y entran en congestion collapse — más concurrencia la vuelve más lenta,
// tardamos más, y se satura más. Infra reportó "ráfagas masivas cada 15 min" y tiene razón:
// disparábamos las 103 camas lo más rápido posible.
// Trade-off MEDIDO (103 camas, presupuesto 240s):
//   VM rápida (2s/req):  8w sin pacing → 103/103 en 26s  |  4w+1000ms → 103/103 en 103s
//   VM lenta  (22s/req): 8w sin pacing →  87/103         |  4w+1000ms →  43/103
// Con la VM lenta procesamos menos por corrida — las restantes se retoman a los 15 min.
// La apuesta: al dejar de saturarla, deja de estar lenta. Si no ocurre, subí CRON_WORKERS
// por env (sin redeploy) y medí de nuevo con la línea `[cron-enrich] RUN`.
const WORKERS = Number(process.env.CRON_WORKERS ?? 4);

// Espaciado mínimo entre el ARRANQUE de dos requests (ms). Convierte la ráfaga en un goteo:
// con 103 camas y 1200ms, la carga se reparte a lo largo de ~2 min en vez de caer de golpe.
// Tenemos 240s de presupuesto — usar la ventana en vez de correr no nos cuesta nada, y a una
// VM single-node le cambia la vida. 0 lo desactiva.
const PACE_MS = Number(process.env.CRON_PACE_MS ?? 1000);
const STALE_MS = 60 * 60 * 1000; // filas no vistas + sin update hace >1h → Inactivo

interface EnrichRow {
  spItemId: string;
  eventKey: string;
  updatedAt: string;
  // Fasting del Payload_EC anterior — sirve para detectar cambios y mandar push
  // a Catering (notif_fasting_change). Si no había fasting en el payload viejo,
  // queda undefined (= 'none' al hashear → bootstrap silencioso si tampoco hay ahora).
  oldFasting: FastingSummary | undefined;
  // dietTags del Payload_EC anterior — baseline para detectar cambio de DIETA acá
  // mismo (reemplaza a cron-diet-changes + lista 11.DietaSnapshot). undefined = sin
  // dieta especial (hashea estable, así "dieta especial → sin dieta" también dispara).
  oldDietTags: string[] | undefined;
}

// Hash estable del estado de ayunos. Mismo criterio que api/ayunos.ts fastingHash
// pero recibe el `FastingSummary` ya procesado (lo que guardamos en Payload_EC).
// 'none' cuando no hay indicaciones — distinto de un hash real, así detectamos
// transición "no ayuno → ayuno" y viceversa.
function hashFastingSummary(s: FastingSummary | undefined | null): string {
  if (!s || !s.indications || s.indications.length === 0) return 'none';
  const sig = s.indications
    .map(i => `${i.indicationId}:${(i.occurrences ?? []).join(',')}`)
    .sort()
    .join('|');
  return simpleHash(sig);
}

// Hash estable de los tags de dieta. Mismo criterio que cron-diet-changes.hashTags
// (ordenado + join '|') sobre el dietTags YA normalizado por parseDiets — por eso el
// hash es equivalente y no genera falsos positivos al consolidar. [] = sin dieta especial.
function hashDietTags(tags: string[] | undefined): string {
  return simpleHash([...(tags ?? [])].sort().join('|'));
}

// Formato "DD/MM HH:MM, ..." con ocurrencias únicas y ordenadas para el body del push.
// Las fechas son naive ART → se formatean por partes (no Date, que aplicaría la TZ del
// runtime Vercel/UTC). Si hay muchas, se acota para no inflar el cuerpo de la notif.
function formatFastingHours(s: FastingSummary | undefined | null): string {
  if (!s) return '';
  const all = Array.from(new Set(s.indications.flatMap(i => i.occurrences ?? []))).sort();
  const fmt = (iso: string): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : iso;
  };
  const parts = all.map(fmt);
  return parts.length <= 4 ? parts.join(', ') : `${parts.slice(0, 3).join(', ')} y ${parts.length - 3} más`;
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
    // Parsear Payload_EC para extraer el baseline viejo (fasting + dieta) y comparar.
    let oldFasting: FastingSummary | undefined;
    let oldDietTags: string[] | undefined;
    try {
      const raw = String(f.Payload_EC ?? '');
      if (raw) {
        const parsed = JSON.parse(raw) as EnrichResult;
        oldFasting = parsed.fasting;
        oldDietTags = parsed.dietTags;
      }
    } catch { /* fila corrupta — sin baseline */ }
    map.set(key, {
      spItemId:  String(item.id),
      eventKey:  key,
      updatedAt: String(f.UpdatedAt_EC ?? ''),
      oldFasting,
      oldDietTags,
    });
  }
  return map;
}

async function upsertEnrich(args: {
  existing?: EnrichRow;
  eventKey: string;
  patientCode: string;
  payload: unknown;
}): Promise<boolean> {
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
  // Devuelve si la escritura persistió. graphFetch NO lanza en no-2xx: si SP
  // throttlea/falla, el payload (y el fasting baseline) NO se guarda → el caller
  // debe evitar el push para no re-notificar el mismo cambio en la próxima corrida.
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

  // Re-baseline silencioso (disparo MANUAL): reescribe todos los payloads pero NO
  // envía ningún push de fasting. Para re-sincronizar baselines tras un deploy que
  // cambie el formato del hash. Uso: ?silent=1.
  const silent = ['1', 'true', 'yes'].includes(
    String(req.query?.silent ?? req.query?.rebaseline ?? '').toLowerCase(),
  );

  const stats = { checked: 0, upserted: 0, errors: 0, eventTimeouts: 0, skippedPersistFail: 0, skippedByBudget: 0, deactivated: 0, breakerTripped: false, silent };

  // Presupuesto de tiempo por corrida: si nos acercamos al maxDuration (300s),
  // cortamos prolijo y devolvemos 200 con stats parciales en vez de que Vercel mate
  // la función (status 0). Las camas que quedaron se retoman en el próximo ciclo.
  const runStart = Date.now();
  const deadline = runStart + Number(process.env.CRON_BUDGET_MS ?? 240_000);

  try {
    // 1) Filas existentes en SP.
    const rows = await fetchEnrichRows();

    // 2) Camas ocupadas desde Gamma.
    const tokenOcc = await getToken('obtenermapacamasocupadas');
    const occRes = await fetchWithTimeout(
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
      areaName: string; patientName: string; roomName: string;
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
            // Habitación legible para el cuerpo del push a Catering. NO entra al hash
            // de detección de cambios (ver pushBody/dietPushBody) para que un cambio
            // de cama del paciente no dispare una re-notificación de dieta/ayuno.
            roomName: String(room.nombre ?? '').trim(),
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
    let dietNotified = 0;
    // Circuit breaker: N timeouts CONSECUTIVOS de evento → cortar la corrida.
    // Tuneable por env sin redeploy (mismo criterio que CRON_BUDGET_MS / GAMMA_FETCH_TIMEOUT_MS).
    // 0 lo desactiva.
    //
    // ⚠️ El umbral NO es arbitrario: en una corrida REAL (20/07 12:30) se observaron
    // 8 timeouts consecutivos al arranque y después la VM se recuperó y procesó el resto
    // bien. Con umbral 8 esa corrida se habría cortado perdiendo ~95 camas buenas.
    // 20 deja margen sobre ese patrón y aun así, con la VM caída, manda 20 requests en
    // vez de 103 (-80%). Subir si aparecen falsos cortes; bajar solo con datos.
    const BREAKER_THRESHOLD = Number(process.env.CRON_BREAKER_FAILS ?? 20);
    let consecutiveEventFails = 0;
    let breakerTripped = false;
    // Reloj compartido del pacing: cada worker espera su turno antes de disparar. Se comparte
    // entre workers (no es un sleep por worker) para que el RITMO GLOBAL sea PACE_MS,
    // independiente de cuántos workers haya.
    let nextSlot = Date.now();
    const esperarTurno = async () => {
      if (PACE_MS <= 0) return;
      const ahora = Date.now();
      const mio = Math.max(ahora, nextSlot);
      nextSlot = mio + PACE_MS;
      const espera = mio - ahora;
      if (espera > 0) await new Promise(r => setTimeout(r, espera));
    };

    const worker = async () => {
      while (queue.length > 0 && Date.now() < deadline && !breakerTripped) {
        const b = queue.shift();
        if (!b) return;
        await esperarTurno();
        // El turno pudo haber consumido lo que quedaba de presupuesto.
        if (Date.now() >= deadline || breakerTripped) { queue.unshift(b); return; }
        const eventKey = `${b.eventOrigin}-${b.eventNumber}`;
        seenKeys.add(eventKey);
        try {
          const { eventFetchFailed, ...payload } = await buildEnrich({
            tokenPat, tokenEvt,
            patientCode: b.patientCode,
            eventOrigin: b.eventOrigin,
            eventNumber: b.eventNumber,
          });
          // El fetch del evento falló/timeouteó: NO pisar el payload bueno con uno
          // vacío (borraría diagnóstico/dieta/ayuno) ni emitir un falso "Ayuno
          // cancelado". Saltamos — se reintenta en el próximo ciclo.
          if (eventFetchFailed) {
            stats.errors++;
            stats.eventTimeouts++;
            // ── Circuit breaker ────────────────────────────────────────────
            // La VM de Gamma es single-node: cuando se satura, `obtenereventointernacion`
            // tarda 20-25s o se cuelga (ver docs/arquitectura.md §41). Al abortar NO la
            // liberamos —el proceso sigue vivo del otro lado— y el worker toma la
            // siguiente cama al instante, así que le apilamos trabajo más rápido de lo
            // que puede drenar. Insistir con las 103 camas empeora algo que ya está caído.
            //
            // Cuenta fallos CONSECUTIVOS: un timeout suelto entre respuestas buenas es
            // ruido normal y el contador se resetea; N seguidos = la VM no está
            // respondiendo, y ahí cortamos y reintentamos en el próximo ciclo (15 min).
            if (BREAKER_THRESHOLD > 0 && ++consecutiveEventFails >= BREAKER_THRESHOLD) {
              breakerTripped = true;
              console.warn(`[cron-enrich] CIRCUIT BREAKER: ${consecutiveEventFails} timeouts consecutivos de obtenereventointernacion — corto la corrida (quedan ${queue.length} camas para el próximo ciclo)`);
            }
            continue;
          }
          consecutiveEventFails = 0;   // respuesta buena → el breaker vuelve a cero

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

          // Decidir QUÉ notificar (sin enviar todavía): el push se manda recién
          // después de un upsert exitoso, para no re-notificar si SP falla.
          let pushBody: string | null = null;
          if (existing) {
            const oldHash = hashFastingSummary(existing.oldFasting);
            const newHash = hashFastingSummary(newFasting);
            if (oldHash !== newHash) {
              const horas = formatFastingHours(newFasting);
              let detalle: string;
              if (oldHash === 'none')      detalle = horas ? `Nuevo ayuno programado: ${horas}` : 'Nuevo ayuno programado';
              else if (newHash === 'none') detalle = 'Ayuno cancelado';
              else                          detalle = horas ? `Ayuno modificado: ${horas}` : 'Ayuno modificado';
              console.log(`[cron-enrich] FASTING CHANGE ${eventKey} patient=${b.patientName} old=${oldHash} new=${newHash}${silent ? ' [silent]' : ''}`);
              pushBody = `${b.patientName || 'Paciente'}: ${detalle}`;
            }
          } else if (hasFasting && isRecentAdmission(payload.admissionDate)) {
            const horas = formatFastingHours(newFasting);
            const detalle = horas ? `Nuevo ayuno programado: ${horas}` : 'Nuevo ayuno programado';
            console.log(`[cron-enrich] FASTING NEW-PATIENT ${eventKey} patient=${b.patientName} admission=${payload.admissionDate}${silent ? ' [silent]' : ''}`);
            pushBody = `${b.patientName || 'Paciente'}: ${detalle}`;
          }

          // ── Detección de cambio de DIETA (push notif_diet_change) ──
          // Reemplaza a cron-diet-changes: comparamos el dietTags nuevo contra el del
          // payload anterior (mismo hash que usaba ese cron). Bootstrap silencioso para
          // filas nuevas, igual que el cron viejo: no spamear dietas pre-existentes al
          // repoblar 12.EnrichCamas. Sólo notifica cuando una fila EXISTENTE cambia.
          const newDietTags = payload.dietTags ?? [];
          let dietPushBody: string | null = null;
          if (existing) {
            const oldDietHash = hashDietTags(existing.oldDietTags);
            const newDietHash = hashDietTags(newDietTags);
            if (oldDietHash !== newDietHash) {
              const label = newDietTags.length > 0 ? newDietTags.join(', ') : 'sin dieta especial';
              console.log(`[cron-enrich] DIET CHANGE ${eventKey} patient=${b.patientName} old=${oldDietHash} new=${newDietHash}${silent ? ' [silent]' : ''}`);
              dietPushBody = `${b.patientName || 'Paciente'}: ${label}`;
            }
          }

          // Persistir PRIMERO. Si falla, no notificamos (se reintenta en la próxima
          // corrida y se notifica una sola vez cuando SP persista el nuevo baseline).
          const persisted = await upsertEnrich({
            existing,
            eventKey,
            patientCode: b.patientCode,
            payload,
          });
          if (!persisted) {
            stats.skippedPersistFail++;
            console.warn(`[cron-enrich] persist FAIL ${eventKey} patient=${b.patientName} — push pospuesto`);
            continue;
          }
          stats.upserted++;

          // La habitación se agrega en TODOS los avisos de dieta/ayuno (no solo Catering):
          // ayuda a ubicar al paciente sin abrir la app. roomLabel ej. "Habitación 413 (Piso 4)".
          const roomLabel = formatRoomForCatering(b.roomName, b.areaName);

          if (pushBody && !silent) {
            const body = roomLabel ? `${pushBody} — ${roomLabel}` : pushBody;
            await sendPushToSubscribers({
              title: 'Ayuno actualizado',
              body,
              type:  'FASTING_CHANGE',
              originAreaName: b.areaName, destinationAreaName: b.areaName, sede: 'HPR',
              cateringTitle: 'Ayuno actualizado',
              cateringBody:  body,
            });
            fastingNotified++;
          }

          if (dietPushBody && !silent) {
            const body = roomLabel ? `${dietPushBody} — ${roomLabel}` : dietPushBody;
            await sendPushToSubscribers({
              title: 'Dieta actualizada',
              body,
              type:  'DIET_CHANGE',
              originAreaName: b.areaName, destinationAreaName: b.areaName, sede: 'HPR',
              cateringTitle: 'Dieta actualizada',
              cateringBody:  body,
            });
            dietNotified++;

            // Historial de cambios de dieta (Supabase public.dieta_cambios): append-only, guarda el
            // "de X → a Y". Independiente de push/suscriptores → historial completo. Best-effort: un
            // fallo acá NO corta el cron (el push ya salió; el próximo cambio real se registra igual).
            try {
              await getSupabaseAdmin().from('dieta_cambios').insert({
                entorno:         ENTORNO,
                paciente_codigo: b.patientCode,
                paciente_nombre: b.patientName || null,
                area:            b.areaName || null,
                habitacion:      b.roomName || null,
                event_key:       eventKey || null,
                tags_prev:       (existing?.oldDietTags ?? []).join('; ') || null,
                tags_new:        newDietTags.join('; ') || null,
              });
            } catch (e: any) {
              console.error(`[cron-enrich] dieta_cambios insert falló ${eventKey}:`, e?.message ?? e);
            }
          }
        } catch (err: any) {
          stats.errors++;
          console.error(`[cron-enrich] error en ${eventKey}:`, err?.message ?? err);
        }
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
    (stats as any).fastingNotified = fastingNotified;
    (stats as any).dietNotified = dietNotified;

    // Si cortamos (por presupuesto o por breaker), las camas sin procesar quedan para el
    // próximo ciclo.
    if (queue.length > 0) {
      stats.skippedByBudget = queue.length;
      const motivo = breakerTripped ? 'circuit breaker' : 'budget agotado';
      console.warn(`[cron-enrich] ${motivo}: ${queue.length} camas pospuestas al próximo ciclo`);
    }
    stats.breakerTripped = breakerTripped;

    // Resumen de UNA línea por corrida. Antes solo se logueaban cambios y fallos, así que
    // desde los logs de Vercel no se podía responder "¿cuántos requests le mandamos a Gamma?".
    // `eventos` es 1 request a obtenereventointernacion por cama procesada (no reintentamos).
    const procesadas = stats.checked - queue.length;
    const durS = ((Date.now() - runStart) / 1000).toFixed(1);
    console.log(
      `[cron-enrich] RUN entorno=${ENTORNO} camas=${stats.checked} procesadas=${procesadas} ` +
      `eventos=${procesadas} eventos_timeout=${stats.eventTimeouts} upserted=${stats.upserted} ` +
      `pospuestas=${queue.length} breaker=${breakerTripped} workers=${WORKERS} pace=${PACE_MS}ms dur=${durS}s`,
    );

    // 5) Cleanup: filas no vistas en este ciclo + viejas → Inactivo.
    // Sólo si no agotamos el presupuesto: con la corrida cortada habría filas no
    // vistas que no son stale de verdad. El cleanup se retoma el próximo ciclo.
    // Tampoco si cortó el breaker: quedaron camas sin ver que NO son stale de verdad
    // (mismo razonamiento que con el budget) — desactivarlas borraría enrich bueno.
    if (Date.now() < deadline && !breakerTripped) {
      const staleCutoff = Date.now() - STALE_MS;
      for (const [key, row] of rows) {
        if (seenKeys.has(key)) continue;
        const ts = Date.parse(row.updatedAt);
        if (!isNaN(ts) && ts < staleCutoff) {
          try { await markInactive(row.spItemId); stats.deactivated++; } catch { /* no-op */ }
        }
      }
    }

    return res.status(200).json({ ok: true, entorno: ENTORNO, stats });
  } catch (err: any) {
    console.error('[cron-enrich]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal error', stats });
  }
}
