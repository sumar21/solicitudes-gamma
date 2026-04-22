/**
 * POST /api/validate-location
 * Validates user location (IP + geolocation) against the 99.ABM_GeoIPS SharePoint list.
 *
 * Body:    { sede: string, lat?: number, lng?: number }
 * Returns: { allowed: boolean, ip: string, reason?: string }
 *
 * - Checks request IP against allowed IP prefixes for the sede
 * - Checks lat/lng against allowed geolocations (100m radius)
 * - If either matches → allowed
 */

import { graphFetch } from './graph.js';
import { requireAuth } from './jwt.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const GEOIPS_LIST_ID = 'c30a13f0-070a-45bf-9ff2-415b36325af5'; // 99.ABM_GeoIPS

// ── Haversine distance (meters) ─────────────────────────────────────────────
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => deg * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Normalize IPv4-mapped IPv6 addresses (e.g. "::ffff:192.168.1.50" → "192.168.1.50").
// Node/Vercel can surface either form depending on the upstream proxy config.
function normalizeIp(ip: string): string {
  if (!ip) return '';
  return ip.replace(/^::ffff:/i, '').trim();
}

// ── Extract client IP from request ──────────────────────────────────────────
function getClientIp(req: any): string {
  // Vercel / proxied environments
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first) return normalizeIp(first);
  }
  // Direct connection
  const raw = req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? '';
  return normalizeIp(raw);
}

// Radius in meters from any configured allowed geo point. 200m covers a
// multi-pavilion hospital when only one coordinate is configured; the system
// still supports adding more coords per sede in 99.ABM_GeoIPS if needed.
const GEO_RADIUS_METERS = 200;

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SITE_ID) return res.status(503).json({ error: 'SHAREPOINT_SITE_ID not configured' });

  const { sede, lat, lng } = req.body ?? {};
  if (!sede) return res.status(400).json({ error: 'sede is required' });

  const clientIp = getClientIp(req);

  // Allow localhost in development
  if (clientIp === '::1' || clientIp === '127.0.0.1' || clientIp === '::ffff:127.0.0.1') {
    console.log(`[validate-location] ✓ Localhost detected (${clientIp}) — allowed`);
    return res.status(200).json({ allowed: true, ip: clientIp, method: 'localhost' });
  }

  // SUMAR is a superuser sede — validate against HPR (only sede in this app)
  const effectiveSede = String(sede).toUpperCase() === 'SUMAR' ? 'HPR' : sede;

  console.log(`[validate-location] sede=${sede}${effectiveSede !== sede ? ` (→ ${effectiveSede})` : ''} ip=${clientIp} lat=${lat} lng=${lng}`);

  try {
    // Fetch all active GeoIPS records
    const filter = encodeURIComponent("fields/Status_GI eq 'Activo'");
    const spRes = await graphFetch(
      `/sites/${SITE_ID}/lists/${GEOIPS_LIST_ID}/items?$expand=fields&$filter=${filter}&$top=200`,
      { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
    );

    if (!spRes.ok) {
      console.error(`[validate-location] ⚠ FAIL-OPEN (SP ${spRes.status}) — allowing ip=${clientIp} sede=${effectiveSede}`);
      // If we can't validate, allow access (fail-open to not block hospital operations)
      return res.status(200).json({ allowed: true, ip: clientIp, reason: 'validation_unavailable', failOpen: true });
    }

    const data = (await spRes.json()) as { value: Record<string, unknown>[] };
    const items = data.value ?? [];

    // Normalize sede matching. We want "HPR" to match:
    //   - "HPR"                              (exact)
    //   - "HPR - GRUPO GAMMA S.A."           (followed by a word-boundary)
    //   - "HPR, sede central"                (same)
    // but NOT to match "CHPR", "SIHPRAN" (substring match would be too loose
    // once more sedes like IG/GAM/SUMAR exist).
    const sedeNorm = effectiveSede.trim().toUpperCase();
    const matchesSede = (recordSede: string) => {
      const r = (recordSede || '').trim().toUpperCase();
      if (r === sedeNorm) return true;
      // Next char after the sede name must be non-alphanumeric (space, dash, comma, etc.)
      return r.startsWith(sedeNorm) && !/[A-Z0-9]/.test(r.charAt(sedeNorm.length));
    };

    // Separate geo and IP records for this sede
    const geoRecords: { lat: number; lng: number }[] = [];
    const ipPrefixes: string[] = [];

    for (const item of items) {
      const f = item.fields as Record<string, unknown>;
      const recordSede = String(f.Sedes_S ?? '');
      const tipo = String(f.Tipo_GI ?? '');
      const ip = String(f.IP_GI ?? '');

      if (!matchesSede(recordSede)) {
        console.log(`[validate-location]   skip record: sede="${recordSede}" (no match for ${sedeNorm})`);
        continue;
      }

      const tipoLower = tipo.toLowerCase();
      if (tipoLower.includes('geo') || tipoLower.includes('ubicacion')) {
        const rLat = Number(f.LatResumidaNum_GI);
        const rLng = Number(f.LongResumidaNum_GI);
        if (!isNaN(rLat) && !isNaN(rLng)) {
          geoRecords.push({ lat: rLat, lng: rLng });
        }
      } else if (tipoLower.includes('ip') || tipoLower.includes('direc')) {
        const prefix = ip.trim().replace(/\.$/, '');
        if (prefix) ipPrefixes.push(prefix);
      } else {
        console.log(`[validate-location]   skip record: sede="${recordSede}" tipo="${tipo}" ip="${ip}" — tipo not recognized`);
      }
    }

    console.log(`[validate-location] Found ${geoRecords.length} geo records, ${ipPrefixes.length} IP prefixes for sede ${effectiveSede}`);
    if (ipPrefixes.length > 0) console.log(`[validate-location] Allowed IP prefixes: [${ipPrefixes.join(', ')}]`);
    if (geoRecords.length > 0) console.log(`[validate-location] Allowed geo points: [${geoRecords.map(g => `(${g.lat},${g.lng})`).join(', ')}]`);

    // If no restrictions configured for this sede, allow
    if (geoRecords.length === 0 && ipPrefixes.length === 0) {
      console.log(`[validate-location] ✓ No restrictions configured → allowed`);
      return res.status(200).json({ allowed: true, ip: clientIp, reason: 'no_restrictions' });
    }

    // ── Check IP ────────────────────────────────────────────────────────────
    // Match by prefix so the admin can configure any CIDR-like length:
    //   prefix "192.168"          matches "192.168.1.50", "192.168.99.7", ...
    //   prefix "192.168.1"        matches "192.168.1.50", NOT "192.168.2.5"
    //   prefix "192.168.1.50"     matches exactly that IP
    // We append "." to both sides so "192.168.1" doesn't accidentally match
    // "192.168.10.5" (the naive startsWith would pass).
    let ipValid = false;
    if (clientIp && ipPrefixes.length > 0) {
      const clientIpDotted = clientIp + '.';
      console.log(`[validate-location] Client IP: ${clientIp}`);
      for (const prefix of ipPrefixes) {
        const prefixDotted = prefix.replace(/\.$/, '') + '.';
        if (clientIpDotted === prefixDotted || clientIpDotted.startsWith(prefixDotted)) {
          ipValid = true;
          console.log(`[validate-location] ✓ IP match: ${clientIp} startsWith ${prefix}`);
          break;
        }
      }
      if (!ipValid) {
        console.log(`[validate-location] ✗ IP no match: ${clientIp} not in [${ipPrefixes.join(', ')}]`);
      }
    } else if (!clientIp) {
      console.log(`[validate-location] ✗ No client IP detected`);
    }

    if (ipValid) {
      return res.status(200).json({ allowed: true, ip: clientIp, method: 'ip' });
    }

    // ── Check Geolocation ───────────────────────────────────────────────────
    let geoValid = false;
    if (lat != null && lng != null && geoRecords.length > 0) {
      const userLat = Number(lat);
      const userLng = Number(lng);
      if (!isNaN(userLat) && !isNaN(userLng)) {
        for (const rec of geoRecords) {
          const dist = haversineMeters(userLat, userLng, rec.lat, rec.lng);
          console.log(`[validate-location] Geo distance to (${rec.lat},${rec.lng}): ${dist.toFixed(0)}m (max ${GEO_RADIUS_METERS}m)`);
          if (dist <= GEO_RADIUS_METERS) {
            geoValid = true;
            console.log(`[validate-location] ✓ Geo match`);
            break;
          }
        }
        if (!geoValid) console.log(`[validate-location] ✗ Geo no match — too far from all points`);
      }
    } else {
      console.log(`[validate-location] Geo skipped — lat/lng not provided`);
    }

    if (geoValid) {
      return res.status(200).json({ allowed: true, ip: clientIp, method: 'geo' });
    }

    // ── Neither matched — classify the reason so the frontend can show a
    //    specific message (IP out of range vs GPS unavailable vs GPS out of range).
    const hadCoords = lat != null && lng != null && !isNaN(Number(lat)) && !isNaN(Number(lng));
    let denialCode: 'ip_no_match' | 'geo_unavailable' | 'geo_no_match' | 'no_ip';
    let denialMsg: string;
    if (!clientIp) {
      denialCode = 'no_ip';
      denialMsg = 'No se pudo detectar tu IP. Reintentá o contactá soporte.';
    } else if (!hadCoords && geoRecords.length > 0) {
      denialCode = 'geo_unavailable';
      denialMsg = 'Tu IP no está autorizada y no se pudo obtener la ubicación GPS. Permití la geolocalización del navegador e intentá de nuevo.';
    } else if (hadCoords) {
      denialCode = 'geo_no_match';
      denialMsg = `Estás fuera del área autorizada para la sede ${effectiveSede} (radio ${GEO_RADIUS_METERS} m).`;
    } else {
      denialCode = 'ip_no_match';
      denialMsg = `Tu red no está autorizada para la sede ${effectiveSede}.`;
    }
    console.log(`[validate-location] ✗ DENIED [${denialCode}] ip=${clientIp} sede=${effectiveSede} coords=${hadCoords ? `${lat},${lng}` : 'none'}`);
    return res.status(200).json({
      allowed: false,
      ip: clientIp,
      method: denialCode,
      reason: denialMsg,
    });
  } catch (err: any) {
    console.error(`[validate-location] ⚠ FAIL-OPEN (exception) — allowing ip=${clientIp} err=${err?.message ?? err}`);
    // Fail-open: don't block hospital operations if validation breaks
    return res.status(200).json({ allowed: true, ip: clientIp, reason: 'validation_error', failOpen: true });
  }
}

export default requireAuth(handler);
