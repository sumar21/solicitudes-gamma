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

// ── Extract client IP from request ──────────────────────────────────────────
function getClientIp(req: any): string {
  // Vercel / proxied environments
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first) return first;
  }
  // Direct connection
  return req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? '';
}

const GEO_RADIUS_METERS = 100;

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
  console.log(`[validate-location] sede=${sede} ip=${clientIp} lat=${lat} lng=${lng}`);

  try {
    // Fetch all active GeoIPS records
    const filter = encodeURIComponent("fields/Status_GI eq 'Activo'");
    const spRes = await graphFetch(
      `/sites/${SITE_ID}/lists/${GEOIPS_LIST_ID}/items?$expand=fields&$filter=${filter}&$top=200`,
      { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
    );

    if (!spRes.ok) {
      console.error('[validate-location] SP query failed:', spRes.status);
      // If we can't validate, allow access (fail-open to not block hospital operations)
      return res.status(200).json({ allowed: true, ip: clientIp, reason: 'validation_unavailable' });
    }

    const data = (await spRes.json()) as { value: Record<string, unknown>[] };
    const items = data.value ?? [];

    // Normalize sede matching: "HPR" should match "HPR - GRUPO GAMMA S.A."
    const sedeNorm = sede.trim().toUpperCase();
    const matchesSede = (recordSede: string) => {
      const r = (recordSede || '').trim().toUpperCase();
      return r.startsWith(sedeNorm) || r.includes(sedeNorm);
    };

    // Separate geo and IP records for this sede
    const geoRecords: { lat: number; lng: number }[] = [];
    const ipPrefixes: string[] = [];

    for (const item of items) {
      const f = item.fields as Record<string, unknown>;
      if (!matchesSede(String(f.Sedes_S ?? ''))) continue;

      const tipo = String(f.Tipo_GI ?? '').toLowerCase();
      if (tipo.includes('geo') || tipo.includes('ubicacion')) {
        const rLat = Number(f.LatResumidaNum_GI);
        const rLng = Number(f.LongResumidaNum_GI);
        if (!isNaN(rLat) && !isNaN(rLng)) {
          geoRecords.push({ lat: rLat, lng: rLng });
        }
      } else if (tipo.includes('ip') || tipo.includes('direc')) {
        const prefix = String(f.IP_GI ?? '').trim().replace(/\.$/, '');
        if (prefix) ipPrefixes.push(prefix);
      }
    }

    console.log(`[validate-location] Found ${geoRecords.length} geo records, ${ipPrefixes.length} IP prefixes for sede ${sede}`);

    // If no restrictions configured for this sede, allow
    if (geoRecords.length === 0 && ipPrefixes.length === 0) {
      return res.status(200).json({ allowed: true, ip: clientIp, reason: 'no_restrictions' });
    }

    // ── Check IP ────────────────────────────────────────────────────────────
    let ipValid = false;
    if (clientIp && ipPrefixes.length > 0) {
      const clientParts = clientIp.split('.');
      const clientSubnet = clientParts.slice(0, 3).join('.');
      for (const prefix of ipPrefixes) {
        if (clientSubnet === prefix) {
          ipValid = true;
          console.log(`[validate-location] IP match: ${clientSubnet} === ${prefix}`);
          break;
        }
      }
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
          console.log(`[validate-location] Distance to (${rec.lat},${rec.lng}): ${dist.toFixed(0)}m`);
          if (dist <= GEO_RADIUS_METERS) {
            geoValid = true;
            break;
          }
        }
      }
    }

    if (geoValid) {
      return res.status(200).json({ allowed: true, ip: clientIp, method: 'geo' });
    }

    // ── Neither matched ─────────────────────────────────────────────────────
    return res.status(200).json({
      allowed: false,
      ip: clientIp,
      reason: 'Ubicación o red no autorizada para esta sede',
    });
  } catch (err: any) {
    console.error('[validate-location] Error:', err);
    // Fail-open: don't block hospital operations if validation breaks
    return res.status(200).json({ allowed: true, ip: clientIp, reason: 'validation_error' });
  }
}

export default requireAuth(handler);
