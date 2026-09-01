/**
 * GET /api/me?roleName=<NombreRol_RT>
 *
 * Devuelve la config VIGENTE del rol (módulos/permisos/flags) desde el role-cache
 * server-side. La usa el front para resincronizar la sesión sin re-loguear: cuando
 * un admin edita un rol, los usuarios con ese rol actualizan su navbar en el próximo
 * poll (ver useHospitalState → syncSessionRole). Cacheado 5 min (role-cache), así que
 * no satura SP aunque muchas sesiones lo pollen.
 *
 * Devuelve TAMBIÉN los sectores del propio usuario (`user.assignedAreas`, de user-cache /
 * PisosAzafata_u). Van aparte del rol porque son un campo del USUARIO, no del rol, y sin esto
 * no tenían ningún camino hasta la sesión: un cambio de sectores en el ABM no llegaba nunca
 * ni a `currentUser` ni a la suscripción push — que se graba con una FOTO de assignedAreas
 * (push-subscribe) tomada en el login. Una sub con filter_by_floors y sectores vacíos queda
 * muda de forma permanente y silenciosa (subAreaMatches), así que el único arreglo era pedirle
 * a la persona que se deslogueara. Ahora el poll de 60s la sana sola.
 *
 * ponytail: refresca la CONFIG por roleName (el rol al que el user ya pertenece). Si un admin
 * REASIGNA al user a otro rol distinto, ese cambio se toma recién al re-loguear — caso raro;
 * `user.perfil` ya expone el rol vigente en SP para cuando se quiera cerrar también ese hueco.
 */
import { requireAuth } from './jwt.js';
import { getRoleByName } from './role-cache.js';
import { getUserAreasById } from './user-cache.js';

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const roleName = String(req.query?.roleName ?? '').trim();
  if (!roleName) return res.status(400).json({ error: 'roleName required' });

  const cfg = await getRoleByName(roleName);

  // Sectores vigentes del usuario del token. `getUserAreasById` devuelve null cuando la lectura de
  // SP FALLA (≠ de un usuario sin sectores, que devuelve assignedAreas: []). Esa distinción es
  // crítica: mandamos `user: null` ante un fallo para que el front CONSERVE los sectores que ya
  // tiene. Si mandáramos [] en un hipo de SP, el próximo heartbeat regrabaría la suscripción con
  // sectores vacíos y dejaría el dispositivo mudo — justo el bug que este endpoint viene a cerrar.
  const areas = await getUserAreasById(String(req.user?.id ?? ''));
  const user = areas ? { assignedAreas: areas.assignedAreas, perfil: areas.perfil } : null;

  // rol borrado/renombrado → front mantiene la config actual, pero los sectores igual se refrescan.
  if (!cfg) return res.status(200).json({ role: null, user });

  return res.status(200).json({
    role: {
      name: cfg.name,
      modules: cfg.modules,
      permissions: cfg.permissions,
      filterByFloors: cfg.filterByFloors,
      bypassLocationCheck: cfg.bypassLocationCheck,
      requiresIdentification: cfg.requiresIdentification,
    },
    user,
  });
}

export default requireAuth(handler);
