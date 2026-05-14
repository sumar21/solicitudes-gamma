/**
 * GET /api/client-ip
 *
 * Endpoint público (sin auth) que devuelve la IP del cliente tal como la ve el
 * server. Usado por el login para que el usuario vea su IP/geo antes de loguear
 * y nos pueda mandar captura cuando le rebota la validación de ubicación.
 *
 * Responde: { ip: string }
 *
 * IMPORTANTE: no devolvemos nada sensible (no leakea sede, JWT, ni reglas de
 * GeoIPs). Solo el dato que el navegador ya puede inferir vía sitios públicos.
 */

import { getClientIp } from './location-check.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  return res.status(200).json({ ip });
}
