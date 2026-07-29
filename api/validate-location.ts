/**
 * POST /api/validate-location
 * Validates user location (IP + geolocation) against the 99.ABM_GeoIPS SharePoint list.
 *
 * Body:    { sede: string, lat?: number, lng?: number }
 * Returns: { allowed: boolean, ip: string, method?: string, reason?: string, failOpen?: boolean }
 *
 * Usado en el login y en la revalidación periódica del frontend (cada 5 min)
 * que dispara logout automático si la ubicación dejó de ser válida.
 * La lógica está extraída en `api/location-check.ts`.
 */

import { requireAuth } from './jwt.js';
import { checkRequestLocationFull, getClientIp } from './location-check.js';
import { getUserAreasById } from './user-cache.js';
import { getRoleByName } from './role-cache.js';

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

  // Bypass por ROL, AUTORITATIVO server-side: si el rol del usuario tiene bypassLocationCheck,
  // no se evalúa IP/GPS. Clave: NO depende del flag `bypassLocationCheck` del cliente (que se
  // hidrata solo en login y puede quedar viejo) → mata el kick espurio a roles con bypass. Si el
  // lookup del rol falla (instancia fría / hipo de DB), se cae al chequeo normal (fail-safe:
  // preferimos chequear ubicación ante la duda; la histéresis del cliente cubre el transitorio).
  try {
    const userId = String((req as any).user?.id ?? '');
    if (userId) {
      const areas = await getUserAreasById(userId);
      const roleCfg = areas?.perfil ? await getRoleByName(areas.perfil) : null;
      if (roleCfg?.bypassLocationCheck) {
        console.log(`[validate-location] sede=${sede} ip=${clientIp} → ✓ method=role_bypass (user=${userId})`);
        return res.status(200).json({ allowed: true, ip: clientIp, method: 'role_bypass' });
      }
    }
  } catch (e: any) {
    console.warn('[validate-location] lookup de bypass por rol falló, sigo con IP/GPS:', e?.message ?? e);
  }

  const result = await checkRequestLocationFull({ sede, clientIp, lat, lng });

  console.log(
    `[validate-location] sede=${sede} ip=${clientIp} → ${result.allowed ? '✓' : '✗'} method=${result.method ?? 'n/a'}`
  );

  return res.status(200).json(result);
}

export default requireAuth(handler);
