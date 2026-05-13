/**
 * POST /api/validate-location
 * Validates user location (IP + geolocation) against the 99.ABM_GeoIPS SharePoint list.
 *
 * Body:    { sede: string, lat?: number, lng?: number }
 * Returns: { allowed: boolean, ip: string, method?: string, reason?: string, failOpen?: boolean }
 *
 * Usado en el login (cliente envía lat/lng del browser).
 * La lógica está extraída en `api/location-check.ts` para reusar en el middleware
 * `requireAuthAndLocation` que valida solo IP en cada request post-login.
 */

import { requireAuth } from './jwt.js';
import { checkRequestLocationFull, getClientIp } from './location-check.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';

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
  const result = await checkRequestLocationFull({ sede, clientIp, lat, lng });

  console.log(
    `[validate-location] sede=${sede} ip=${clientIp} → ${result.allowed ? '✓' : '✗'} method=${result.method ?? 'n/a'}`
  );

  return res.status(200).json(result);
}

export default requireAuth(handler);
