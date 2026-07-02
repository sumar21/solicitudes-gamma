/**
 * GET /api/me?roleName=<NombreRol_RT>
 *
 * Devuelve la config VIGENTE del rol (módulos/permisos/flags) desde el role-cache
 * server-side. La usa el front para resincronizar la sesión sin re-loguear: cuando
 * un admin edita un rol, los usuarios con ese rol actualizan su navbar en el próximo
 * poll (ver useHospitalState → syncSessionRole). Cacheado 5 min (role-cache), así que
 * no satura SP aunque muchas sesiones lo pollen.
 *
 * ponytail: refresca por roleName (el rol al que el user ya pertenece). Si un admin
 * REASIGNA al user a otro rol distinto, ese cambio se toma recién al re-loguear —
 * caso raro; el upgrade sería derivar el roleName del registro SP del user por id.
 */
import { requireAuth } from './jwt.js';
import { getRoleByName } from './role-cache.js';

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const roleName = String(req.query?.roleName ?? '').trim();
  if (!roleName) return res.status(400).json({ error: 'roleName required' });

  const cfg = await getRoleByName(roleName);
  if (!cfg) return res.status(200).json({ role: null }); // rol borrado/renombrado → front mantiene lo actual

  return res.status(200).json({
    role: {
      name: cfg.name,
      modules: cfg.modules,
      permissions: cfg.permissions,
      filterByFloors: cfg.filterByFloors,
      bypassLocationCheck: cfg.bypassLocationCheck,
    },
  });
}

export default requireAuth(handler);
