/**
 * Helper compartido de validación de ubicación.
 *
 * Usado por:
 *   - /api/validate-location (login completo: IP + geo)
 *   - requireAuthAndLocation wrapper (cada request: solo IP, sin geo)
 *
 * Estrategia: lista `99.ABM_GeoIPS` cacheada en memoria por sede (TTL 5 min).
 * Sin esto, cada request del polling (cada 8s) haría un fetch a SP — insostenible
 * con 10 usuarios activos (~432k SP calls/día). Con cache, máximo 1 SP call por
 * sede cada 5 min.
 *
 * Cross-sede acceptance: ver SEDE_EXTRA_ALLOWED abajo. HPR acepta también
 * reglas de IG (staff de IG que ocasionalmente entra a MediFlow desde su red).
 */

import { graphFetch } from './graph.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const GEOIPS_LIST_ID = 'c30a13f0-070a-45bf-9ff2-415b36325af5'; // 99.ABM_GeoIPS

// Radio en metros desde cualquier punto geo configurado. 200m cubre un hospital
// multi-pabellón con una sola coord; pueden agregarse más coords por sede.
export const GEO_RADIUS_METERS = 200;

// ── Cache de reglas por sede (TTL 5 min) ────────────────────────────────────
interface SedeRules {
  ipPrefixes: string[];
  geoRecords: { lat: number; lng: number }[];
}

const rulesCache = new Map<string, { rules: SedeRules; exp: number }>();
const RULES_TTL = 5 * 60 * 1000;

// ── Cache de "fail-open" si SP cae: evita machacar SP con retries en cascada
// cuando ya sabemos que respondió mal hace segundos. TTL corto.
let spFailUntil = 0;
const SP_FAIL_COOLDOWN = 30 * 1000; // 30s

// ── Helpers exportados ──────────────────────────────────────────────────────

/** Haversine distance entre dos puntos lat/lng en metros. */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => deg * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Normaliza IPv4-mapped IPv6 ("::ffff:192.168.1.50" → "192.168.1.50"). */
export function normalizeIp(ip: string): string {
  if (!ip) return '';
  return ip.replace(/^::ffff:/i, '').trim();
}

/** Extrae la IP del cliente del request. */
export function getClientIp(req: any): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first) return normalizeIp(first);
  }
  const raw = req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? '';
  return normalizeIp(raw);
}

function isLocalhostIp(ip: string): boolean {
  return ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
}

// Normalizar sede: "HPR" matchea "HPR", "HPR - GRUPO GAMMA", pero NO "CHPR".
function matchesSedeFactory(sedeNorm: string) {
  return (recordSede: string) => {
    const r = (recordSede || '').trim().toUpperCase();
    if (r === sedeNorm) return true;
    return r.startsWith(sedeNorm) && !/[A-Z0-9]/.test(r.charAt(sedeNorm.length));
  };
}

// Cross-sede acceptance: qué sedes adicionales de la lista 99.ABM_GeoIPS aceptamos
// cuando el usuario loguea con una sede dada. Caso típico: staff de IG accede
// ocasionalmente a MediFlow (que es de HPR) — sus IPs/coords están registradas
// como IG, así que las aceptamos en login HPR.
//   HPR  → acepta reglas HPR + IG.
//   IG   → solo IG (no es simétrico — Bandejas / sistemas de IG corren en IG).
//   SUMAR → superuser, acepta cualquiera (HPR + IG).
const SEDE_EXTRA_ALLOWED: Record<string, string[]> = {
  HPR:   ['IG'],
  SUMAR: ['HPR', 'IG'],
};

function allowedSpSedes(sedeNorm: string): string[] {
  const extras = SEDE_EXTRA_ALLOWED[sedeNorm] ?? [];
  // Set para deduplicar si la sede ya está en extras por error de config.
  return Array.from(new Set([sedeNorm, ...extras]));
}

/**
 * Trae las reglas de SP para una sede. Con cache 5 min.
 * Si SP falla, marca un cooldown corto (30s) y devuelve null → fail-open.
 */
async function fetchRulesForSede(sede: string): Promise<SedeRules | null> {
  const sedeNorm = sede.trim().toUpperCase();
  const now = Date.now();

  // Cache hit
  const cached = rulesCache.get(sedeNorm);
  if (cached && cached.exp > now) return cached.rules;

  // Cooldown de fail-open de SP — si recién falló, no reintentamos.
  if (spFailUntil > now) return null;

  if (!SITE_ID) return null;

  try {
    const filter = encodeURIComponent("fields/Status_GI eq 'Activo'");
    const spRes = await graphFetch(
      `/sites/${SITE_ID}/lists/${GEOIPS_LIST_ID}/items?$expand=fields&$filter=${filter}&$top=200`,
      { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
    );
    if (!spRes.ok) {
      console.warn(`[location-check] SP HTTP ${spRes.status} — fail-open (cooldown ${SP_FAIL_COOLDOWN / 1000}s)`);
      spFailUntil = now + SP_FAIL_COOLDOWN;
      return null;
    }
    const data = (await spRes.json()) as { value: Record<string, unknown>[] };
    const items = data.value ?? [];
    // Aceptamos reglas de la sede actual + las extras configuradas en SEDE_EXTRA_ALLOWED.
    const allowedSedes = allowedSpSedes(sedeNorm);
    const matchers = allowedSedes.map(s => matchesSedeFactory(s));
    const matchesAnyAllowedSede = (recordSede: string) =>
      matchers.some(m => m(recordSede));

    const geoRecords: { lat: number; lng: number }[] = [];
    const ipPrefixes: string[] = [];

    for (const item of items) {
      const f = item.fields as Record<string, unknown>;
      if (!matchesAnyAllowedSede(String(f.Sedes_S ?? ''))) continue;
      const tipo = String(f.Tipo_GI ?? '').toLowerCase();
      if (tipo.includes('geo') || tipo.includes('ubicacion')) {
        const lat = Number(f.LatResumidaNum_GI);
        const lng = Number(f.LongResumidaNum_GI);
        if (!isNaN(lat) && !isNaN(lng)) geoRecords.push({ lat, lng });
      } else if (tipo.includes('ip') || tipo.includes('direc')) {
        const prefix = String(f.IP_GI ?? '').trim().replace(/\.$/, '');
        if (prefix) ipPrefixes.push(prefix);
      }
    }

    const rules: SedeRules = { ipPrefixes, geoRecords };
    rulesCache.set(sedeNorm, { rules, exp: now + RULES_TTL });
    return rules;
  } catch (err: any) {
    console.warn(`[location-check] SP exception — fail-open: ${err?.message ?? err}`);
    spFailUntil = now + SP_FAIL_COOLDOWN;
    return null;
  }
}

/** Match de IP contra una lista de prefijos. Usa "." como guarda para evitar
 *  que "192.168.1" matchee "192.168.10.5". */
function ipMatches(clientIp: string, prefixes: string[]): boolean {
  if (!clientIp || prefixes.length === 0) return false;
  const clientIpDotted = clientIp + '.';
  for (const prefix of prefixes) {
    const prefixDotted = prefix.replace(/\.$/, '') + '.';
    if (clientIpDotted === prefixDotted || clientIpDotted.startsWith(prefixDotted)) return true;
  }
  return false;
}

// ── API pública ──────────────────────────────────────────────────────────────

export type LocationCheckResult = {
  allowed: boolean;
  ip: string;
  method?: 'localhost' | 'ip' | 'geo' | 'no_restrictions' | 'ip_no_match' | 'geo_unavailable' | 'geo_no_match' | 'no_ip';
  reason?: string;
  failOpen?: boolean;
};

/**
 * Validación rápida solo por IP. Pensado para correr en cada request
 * autenticado (vía requireAuthAndLocation). No pide geo al cliente.
 */
export async function checkRequestLocation(params: {
  sede: string;
  clientIp: string;
}): Promise<LocationCheckResult> {
  const { sede, clientIp } = params;

  if (isLocalhostIp(clientIp)) {
    return { allowed: true, ip: clientIp, method: 'localhost' };
  }

  // SUMAR es un superuser sede → valida contra HPR (única sede de la app).
  const effectiveSede = String(sede ?? '').toUpperCase() === 'SUMAR' ? 'HPR' : sede;

  const rules = await fetchRulesForSede(effectiveSede);
  if (!rules) {
    // SP no responde → fail-open
    return { allowed: true, ip: clientIp, reason: 'validation_unavailable', failOpen: true };
  }

  // Si la sede no tiene restricciones configuradas, pasa todo.
  if (rules.ipPrefixes.length === 0 && rules.geoRecords.length === 0) {
    return { allowed: true, ip: clientIp, method: 'no_restrictions' };
  }

  if (ipMatches(clientIp, rules.ipPrefixes)) {
    return { allowed: true, ip: clientIp, method: 'ip' };
  }

  // Si llegamos acá, la IP no autoriza y NO tenemos geo en esta llamada.
  if (!clientIp) {
    return { allowed: false, ip: '', method: 'no_ip', reason: 'No se pudo detectar tu IP.' };
  }
  if (rules.geoRecords.length > 0) {
    return {
      allowed: false, ip: clientIp, method: 'geo_unavailable',
      reason: 'Tu red no está autorizada y no se está validando GPS en este request. Reingresá desde una red autorizada.',
    };
  }
  return {
    allowed: false, ip: clientIp, method: 'ip_no_match',
    reason: `Tu red no está autorizada para la sede ${effectiveSede}.`,
  };
}

/**
 * Validación completa (IP + geo). Usado por /api/validate-location en el login,
 * donde el cliente sí pasa lat/lng.
 */
export async function checkRequestLocationFull(params: {
  sede: string;
  clientIp: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<LocationCheckResult> {
  const { sede, clientIp, lat, lng } = params;

  if (isLocalhostIp(clientIp)) {
    return { allowed: true, ip: clientIp, method: 'localhost' };
  }

  const effectiveSede = String(sede ?? '').toUpperCase() === 'SUMAR' ? 'HPR' : sede;

  const rules = await fetchRulesForSede(effectiveSede);
  if (!rules) {
    return { allowed: true, ip: clientIp, reason: 'validation_unavailable', failOpen: true };
  }

  if (rules.ipPrefixes.length === 0 && rules.geoRecords.length === 0) {
    return { allowed: true, ip: clientIp, method: 'no_restrictions' };
  }

  if (ipMatches(clientIp, rules.ipPrefixes)) {
    return { allowed: true, ip: clientIp, method: 'ip' };
  }

  // Geo check
  const hadCoords = lat != null && lng != null && !isNaN(Number(lat)) && !isNaN(Number(lng));
  if (hadCoords && rules.geoRecords.length > 0) {
    const userLat = Number(lat);
    const userLng = Number(lng);
    for (const rec of rules.geoRecords) {
      const dist = haversineMeters(userLat, userLng, rec.lat, rec.lng);
      if (dist <= GEO_RADIUS_METERS) {
        return { allowed: true, ip: clientIp, method: 'geo' };
      }
    }
  }

  // Denegado — clasificar
  if (!clientIp) {
    return {
      allowed: false, ip: '', method: 'no_ip',
      reason: 'No se pudo detectar tu IP. Reintentá o contactá soporte.',
    };
  }
  if (!hadCoords && rules.geoRecords.length > 0) {
    return {
      allowed: false, ip: clientIp, method: 'geo_unavailable',
      reason: 'Tu IP no está autorizada y no se pudo obtener la ubicación GPS. Permití la geolocalización del navegador e intentá de nuevo.',
    };
  }
  if (hadCoords) {
    return {
      allowed: false, ip: clientIp, method: 'geo_no_match',
      reason: `Estás fuera del área autorizada para la sede ${effectiveSede} (radio ${GEO_RADIUS_METERS} m).`,
    };
  }
  return {
    allowed: false, ip: clientIp, method: 'ip_no_match',
    reason: `Tu red no está autorizada para la sede ${effectiveSede}.`,
  };
}
