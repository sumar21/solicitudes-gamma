/**
 * GET /api/beds — bed map from Gamma (cached, enriquecido con data del evento).
 *
 * Endpoints Gamma usados:
 *   - obtenermapacamas / obtenermapacamasocupadas: base del mapa
 *   - obtenereventointernacion (por cada cama ocupada, vía getEventCached): enrich
 *     con diet, ayunos, diagnóstico, plan, fechas, tipo de internación.
 *
 * Server-side cache: 45s TTL para el mapa completo + 60s TTL compartido para el evento
 * (gamma-client.getEventCached). 5 workers paralelos para el enrich.
 */

import { requireAuth } from './jwt.js';
import {
  getToken, GAMMA_BASE, simpleHash,
  GammaBed, GammaSector, GammaEvent, getEventCached,
} from './gamma-client.js';
import { parseDiets } from './diet-tags.js';
import { summarizeFasting } from './ayunos.js';

const ADMISSION_TYPE_LABELS: Record<string, string> = {
  C:  'Clínica',
  CO: 'COVID-19',
  H:  'Hemodinamia',
  K:  'Quemado',
  O:  'Oncológica',
  Q:  'Quirúrgica',
  R:  'Trasplante Renal',
  T:  'Trasplante Hepático',
};

// ── BedStatus string values (mirrors types.ts enum) ──────────────────────────
const STATUS = {
  AVAILABLE: 'Disponible',
  OCCUPIED: 'Ocupada',
  PREPARATION: 'En preparación',
  DISABLED: 'Inhabilitada',
} as const;

function mapEstado(estado: string | undefined): string {
  if (!estado) return STATUS.AVAILABLE;
  const e = estado.toLowerCase();
  if (e.includes('ocup')) return STATUS.OCCUPIED;
  if (e.includes('prep')) return STATUS.PREPARATION;
  if (e.includes('inhab') || e.includes('inact')) return STATUS.DISABLED;
  return STATUS.OCCUPIED;
}

// ── Transform Gamma data → app Bed[] ────────────────────────────────────────
function transformBeds(mapData: GammaSector[], occupiedData: GammaSector[]) {
  const occLookup = new Map<string, GammaBed>();
  for (const sector of occupiedData) {
    for (const room of sector.habitaciones ?? []) {
      for (const bed of room.camas ?? []) {
        occLookup.set(`${sector.codigo}-${room.codigo}-${bed.codigo}`, bed);
      }
    }
  }

  const beds = [];
  let id = 1;

  for (const sector of mapData) {
    for (const room of sector.habitaciones ?? []) {
      for (const bed of room.camas ?? []) {
        const occ = occLookup.get(`${sector.codigo}-${room.codigo}-${bed.codigo}`);
        const estado = bed.estado ?? occ?.estado;
        const paciente = bed.paciente ?? occ?.paciente;
        const origenEvento = bed.origen_evento ?? occ?.origen_evento;
        const numeroEvento = bed.numero_evento ?? occ?.numero_evento;
        const codigoPaciente = bed.codigo_paciente ?? occ?.codigo_paciente;
        const profesional = bed.profesional ?? occ?.profesional;
        const institucion = bed.institucion ?? occ?.institucion;
        // Plan médico — viene en el array de camas ocupadas (no en el general).
        const planCodigo = occ?.plan_codigo ?? bed.plan_codigo;
        const plan = occ?.plan ?? bed.plan;
        // Observaciones — vienen en el array general (motivo de inhabilitación).
        const observaciones = bed.observaciones ?? occ?.observaciones;

        beds.push({
          id: `BED-${id++}`,
          label: `${room.nombre} - ${bed.nombre ?? `Cama 0${bed.codigo}`}`,
          area: sector.nombre,
          status: mapEstado(estado),
          patientName: paciente ?? undefined,
          roomCode: String(room.codigo),
          bedCode: String(bed.codigo),
          eventOrigin: origenEvento ?? undefined,
          eventNumber: numeroEvento ?? undefined,
          patientCode: codigoPaciente ? String(codigoPaciente).trim() : undefined,
          institution: institucion?.trim() || undefined,
          prescribingPhysician: profesional?.trim() || undefined,
          medicalPlanCode: planCodigo != null ? String(planCodigo).trim() || undefined : undefined,
          medicalPlan:     plan != null ? String(plan).trim() || undefined : undefined,
          disabledReason:  observaciones != null ? String(observaciones).trim() || undefined : undefined,
        });
      }
    }
  }

  return beds;
}

// ── Enrich beds con data del evento (diet, ayunos, diagnóstico, plan, fechas) ──
function applyEventToBed(bed: any, event: GammaEvent): void {
  if (event.EVE_DIAGNOSTICO?.trim()) bed.diagnosis = event.EVE_DIAGNOSTICO.trim();

  // Profesional: priorizar el del evento si no vino en camas ocupadas.
  if (!bed.prescribingPhysician && event.PROFESIONAL_NOMBRE?.trim()) {
    bed.prescribingPhysician = event.PROFESIONAL_NOMBRE.trim();
  }
  // Institution: fallback al evento.
  if (!bed.institution && event.INSTITUCION_NOMBRE?.trim()) {
    bed.institution = event.INSTITUCION_NOMBRE.trim();
  }

  const typeCode = event.EVE_TIPO_INTERNACION?.trim().toUpperCase();
  if (typeCode) {
    bed.admissionTypeCode = typeCode;
    bed.admissionType = ADMISSION_TYPE_LABELS[typeCode] ?? typeCode;
  }

  if (event.EVE_FECHA_HORA_INGRESO) bed.admissionDate = String(event.EVE_FECHA_HORA_INGRESO);
  if (event.EVE_FECHA_PROBABLE_CIRUGIA) bed.expectedSurgeryDate = String(event.EVE_FECHA_PROBABLE_CIRUGIA);
  if (typeof event.EVE_DIAS_AUTORIZADOS === 'number') bed.authorizedDays = event.EVE_DIAS_AUTORIZADOS;

  if (event.IPM_DESCRIPCION) {
    bed.medicalPlanDescription = String(event.IPM_DESCRIPCION).trim() || undefined;
  }

  const { diets, dietTags } = parseDiets(event.DIETAS);
  if (diets) bed.diets = diets;
  if (dietTags) bed.dietTags = dietTags;

  const fasting = summarizeFasting(event.AYUNOS);
  if (fasting) bed.fasting = fasting;
}

async function enrichBedsWithEventData(beds: any[]): Promise<void> {
  const toEnrich = beds.filter(b =>
    b.status === STATUS.OCCUPIED && b.patientCode && b.eventOrigin && b.eventNumber != null
  );
  if (toEnrich.length === 0) return;

  const tokenEvt = await getToken('obtenereventointernacion');
  if (!tokenEvt) {
    console.warn('[api/beds] No event token — skipping enrich');
    return;
  }

  const queue = [...toEnrich];
  let failed = 0;
  const worker = async () => {
    while (queue.length > 0) {
      const bed = queue.shift();
      if (!bed) break;
      try {
        const event = await getEventCached(tokenEvt, bed.eventOrigin, bed.eventNumber);
        if (event) applyEventToBed(bed, event);
        else failed++;
      } catch (e: any) {
        failed++;
        console.warn(`[api/beds] enrich failed for ${bed.eventOrigin}-${bed.eventNumber}:`, e?.message ?? e);
      }
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));

  if (failed > 0) {
    console.warn(`[api/beds] enrich: ${failed}/${toEnrich.length} beds without event data`);
  }
}

// ── Server-side response cache (survives warm invocations) ──────────────────
let bedsCache: { beds: any[]; etag: string; timestamp: number } | null = null;
const BEDS_CACHE_TTL = 45_000; // 45 seconds

// ── Handler ──────────────────────────────────────────────────────────────────
async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const CLIENT_ID = process.env.CLIENT_ID ?? '';
  const CLIENT_SECRET = process.env.CLIENT_SECRET ?? '';

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(503).json({ error: 'CLIENT_ID / CLIENT_SECRET not configured' });
  }

  // Check ETag — if client has current data, return 304
  const ifNoneMatch = req.headers?.['if-none-match'];
  if (bedsCache && Date.now() - bedsCache.timestamp < BEDS_CACHE_TTL) {
    if (ifNoneMatch === bedsCache.etag) {
      return res.status(304).end();
    }
    // Serve from cache
    res.setHeader('ETag', bedsCache.etag);
    return res.status(200).json({ beds: bedsCache.beds });
  }

  try {
    const [tokenMap, tokenOcc] = await Promise.all([
      getToken('obtenermapacamas'),
      getToken('obtenermapacamasocupadas'),
    ]);

    // Fetch + parse, returning { ok } so the handler can detect partial upstream failures
    // (e.g. nginx 504 from the Gamma proxy) and fall back to cached data instead of
    // serving a silently-empty bed map.
    const fetchAndParse = async (url: string, token: string, label: string): Promise<{ ok: boolean; data: GammaSector[] }> => {
      try {
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) {
          console.warn(`[api/beds] ${label} HTTP ${r.status}`);
          return { ok: false, data: [] };
        }
        const text = await r.text();
        let parsed: unknown;
        try { parsed = JSON.parse(text); }
        catch {
          console.warn(`[api/beds] ${label} non-JSON response:`, text.slice(0, 120));
          return { ok: false, data: [] };
        }
        if (!Array.isArray(parsed)) {
          console.warn(`[api/beds] ${label} unexpected shape (not array)`);
          return { ok: false, data: [] };
        }
        return { ok: true, data: parsed as GammaSector[] };
      } catch (e: any) {
        console.error(`[api/beds] ${label} fetch threw:`, e?.message ?? e);
        return { ok: false, data: [] };
      }
    };

    const [mapResult, occResult] = await Promise.all([
      fetchAndParse(`${GAMMA_BASE}/oauth_resource/obtenermapacamas`,         tokenMap, 'obtenermapacamas'),
      fetchAndParse(`${GAMMA_BASE}/oauth_resource/obtenermapacamasocupadas`, tokenOcc, 'obtenermapacamasocupadas'),
    ]);

    // If ANY upstream endpoint failed, don't overwrite the cache with partial data.
    // Without this check, a 504 on obtenermapacamasocupadas would leave all occupied
    // beds showing as AVAILABLE — a serious operational risk (could double-assign a bed).
    if (!mapResult.ok || !occResult.ok) {
      console.warn(`[api/beds] Upstream partial failure — map.ok=${mapResult.ok} occ.ok=${occResult.ok}. Serving cache.`);
      if (bedsCache) {
        res.setHeader('ETag', bedsCache.etag);
        res.setHeader('X-Beds-Stale', '1');
        return res.status(200).json({ beds: bedsCache.beds, stale: true });
      }
      // No cache yet + upstream broken → explicit 503 so the frontend keeps its current data
      return res.status(503).json({ error: 'Gamma upstream unavailable', stale: true });
    }

    const mapData = mapResult.data;
    const occData = occResult.data;

    // Sanity check: obtenermapacamas should always return all hospital beds.
    // An empty array here is suspicious (auth issue / downstream quirk).
    if (!mapData.length) {
      console.warn('[api/beds] mapData empty — treating as upstream failure');
      if (bedsCache) {
        res.setHeader('ETag', bedsCache.etag);
        res.setHeader('X-Beds-Stale', '1');
        return res.status(200).json({ beds: bedsCache.beds, stale: true });
      }
      return res.status(503).json({ error: 'Gamma returned empty bed map', stale: true });
    }

    const beds = transformBeds(mapData, occData);

    // ── Enrich cada cama ocupada con la data del evento (diet, ayunos, etc.) ──
    // 5 workers paralelos sobre el cache compartido — si todos los eventos están
    // calientes el enrich es ~instantáneo; cold cuesta ~5–8s con ~60 camas.
    await enrichBedsWithEventData(beds);

    // Update cache only on a fully successful response
    const etag = simpleHash(beds.map(b => `${b.id}:${b.status}:${b.patientCode ?? ''}`).join('|'));
    bedsCache = { beds, etag, timestamp: Date.now() };

    res.setHeader('ETag', etag);
    res.status(200).json({ beds });
  } catch (err: any) {
    console.error('[api/beds]', err);

    // If we have stale cache, serve it rather than erroring
    if (bedsCache) {
      res.setHeader('ETag', bedsCache.etag);
      res.setHeader('X-Beds-Stale', '1');
      return res.status(200).json({ beds: bedsCache.beds, stale: true });
    }

    res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}

export default requireAuth(handler);
