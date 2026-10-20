/**
 * Autorización server-side de las acciones de CIRUGÍA (api/cirugia.ts + api/cirugia-marcas.ts).
 *
 * El gating de cirugía era 100% client-side (CirugiasView / la cama en el Mapa esconden los botones
 * con can(user, 'cirugia_*')), pero un POST/PATCH directo con un token válido lo salteaba. Este seam
 * enforça lo mismo en el server, con el MISMO criterio que el resto de la app:
 *   - Permiso: solo bloquea con VEREDICTO REAL. Si no se puede resolver el rol (hipo de DB → getRoleByName
 *     null), NO bloquea (fail-open), igual que dietas.ts ("castiga el dato confirmado, nunca su ausencia").
 *   - Área: si el rol filtra por pisos (filterByFloors) y no es full-access, la operatoria debe pertenecer
 *     a un sector asignado — mismo patrón que tickets.ts (getUserAreasById + areas.length >= 9).
 *
 * Devuelve `null` si está autorizado, o `{ status, error }` para cortar con ese código.
 */
import { getRoleByName } from './role-cache.js';
import { getUserAreasById } from './user-cache.js';

// `area`: el sector (o los sectores) desde los que se puede hacer la acción; alcanza con tener UNO.
// "Iniciar dieta" se hace donde ESTÁ el paciente, que puede no ser el piso de origen (vuelve de cirugía a
// UTI): ahí se pasa [sector de origen, sector actual] (20/10/2026).
export async function authzCirugia(
  req: any,
  permiso: string,
  area?: string | null | (string | null | undefined)[],
): Promise<{ status: number; error: string } | null> {
  const userId = String(req?.user?.id ?? '');
  const userAreas = await getUserAreasById(userId);
  const roleCfg = userAreas?.perfil ? await getRoleByName(userAreas.perfil) : null;

  // Permiso: solo bloquea si el rol se resolvió y NO tiene el permiso (fail-open ante rol irresoluble).
  if (roleCfg && !roleCfg.permissions.includes(permiso)) {
    return { status: 403, error: `No tenés permiso para esta acción (${permiso}).` };
  }

  if (!sectorAutorizado(!!roleCfg?.filterByFloors, userAreas?.assignedAreas ?? [], area)) {
    return { status: 403, error: 'No autorizado: la cirugía no pertenece a tus pisos asignados.' };
  }
  return null;
}

/** Regla de sector (pura, testeable: scripts/check-cirugia-authz.mts). Solo restringe a roles que filtran
 *  por pisos y no son full-access (>= 9 áreas). Pasa si el usuario tiene ALGUNO de los sectores candidatos;
 *  sin sector conocido no se bloquea (fail-open, como el resto de la app). */
export function sectorAutorizado(
  filterByFloors: boolean,
  userAreas: readonly string[],
  area?: string | null | (string | null | undefined)[],
): boolean {
  const hasAll = userAreas.length >= 9; // mismo criterio "full access" que tickets.ts / push-utils
  const candidatas = (Array.isArray(area) ? area : [area]).filter((a): a is string => !!a && !!String(a).trim()).map(String);
  if (!filterByFloors || !userAreas.length || hasAll || !candidatas.length) return true;
  return candidatas.some(a => userAreas.includes(a));
}
