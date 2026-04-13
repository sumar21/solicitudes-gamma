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

    const safeJson = async (r: Response) => {
      const text = await r.text();
      try { return JSON.parse(text); } catch {
        console.warn('[api/beds] Non-JSON response:', text.slice(0, 100));
        return [];
      }
    };

    const [mapRes, occRes] = await Promise.all([
      fetch(`${GAMMA_BASE}/oauth_resource/obtenermapacamas`, {
        headers: { Authorization: `Bearer ${tokenMap}` },
      }),
      fetch(`${GAMMA_BASE}/oauth_resource/obtenermapacamasocupadas`, {
        headers: { Authorization: `Bearer ${tokenOcc}` },
      }),
    ]);

    const [mapRaw, occRaw] = await Promise.all([safeJson(mapRes), safeJson(occRes)]);

    const mapData: GammaSector[] = Array.isArray(mapRaw) ? mapRaw : [];
    const occData: GammaSector[] = Array.isArray(occRaw) ? occRaw : [];

    if (!mapData.length) {
      console.warn('[api/beds] mapData empty — Gamma may be down');
    }

    const beds = transformBeds(mapData, occData);

    // Update cache
    const etag = simpleHash(beds.map(b => `${b.id}:${b.status}:${b.patientCode ?? ''}`).join('|'));
    bedsCache = { beds, etag, timestamp: Date.now() };

    res.setHeader('ETag', etag);
    res.status(200).json({ beds });
  } catch (err: any) {
    console.error('[api/beds]', err);

    // If we have stale cache, serve it rather than erroring
    if (bedsCache) {
      res.setHeader('ETag', bedsCache.etag);
      return res.status(200).json({ beds: bedsCache.beds });
    }

    res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}

export default requireAuth(handler);
