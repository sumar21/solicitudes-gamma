/**
 * GET /api/beds — bed map from Gamma (fast, cached, no enrichment).
 *
 * Only calls 2 Gamma endpoints: obtenermapacamas + obtenermapacamasocupadas.
 * Returns basic bed data (status, patientName, patientCode, event info).
 * Enrichment (DNI, financier, diagnosis, physician) is handled by /api/bed-enrich.
 *
 * Server-side cache: 45s TTL. ETag support for 304 responses.
 */

import { requireAuth } from './jwt.js';
import {
  getToken, GAMMA_BASE, simpleHash,
  GammaBed, GammaSector,
} from './gamma-client.js';

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
        });
      }
    }
  }

  return beds;
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
