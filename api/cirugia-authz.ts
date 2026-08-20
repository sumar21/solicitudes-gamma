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

export async function authzCirugia(
  req: any,
  permiso: string,
  area?: string | null,
): Promise<{ status: number; error: string } | null> {
  const userId = String(req?.user?.id ?? '');
  const userAreas = await getUserAreasById(userId);
  const roleCfg = userAreas?.perfil ? await getRoleByName(userAreas.perfil) : null;

  // Permiso: solo bloquea si el rol se resolvió y NO tiene el permiso (fail-open ante rol irresoluble).
  if (roleCfg && !roleCfg.permissions.includes(permiso)) {
    return { status: 403, error: `No tenés permiso para esta acción (${permiso}).` };
  }

  // Área: solo para roles que filtran por pisos y no son full-access (>= 9 áreas = sin restricción).
  const areas = userAreas?.assignedAreas ?? [];
  const hasAll = areas.length >= 9; // mismo criterio "full access" que tickets.ts / push-utils
  if (roleCfg?.filterByFloors && areas.length && !hasAll && area && !areas.includes(String(area))) {
    return { status: 403, error: 'No autorizado: la cirugía no pertenece a tus pisos asignados.' };
  }

  return null;
}
