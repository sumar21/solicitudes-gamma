/**
 * Autorización server-side de la creación de un PRE-TICKET (api/tickets.ts POST con status
 * 'Presolicitud'). El gating es client-side (el botón "Pre-ticket" solo aparece con
 * can(user, 'crear_pre_ticket')), pero un POST directo con un token válido lo saltearía. Este seam
 * enforça lo mismo en el server, con el MISMO criterio fail-open del resto de la app (cirugia-authz):
 *   - Solo bloquea con VEREDICTO REAL. Si no se puede resolver el rol (getRoleByName null),
 *     NO bloquea (castiga el dato confirmado, nunca su ausencia).
 * No hay chequeo de área: la Coordinadora pide camas de cualquier sector (no filtra por pisos).
 *
 * Devuelve `null` si está autorizado, o `{ status, error }` para cortar con ese código.
 */
import { getRoleByName } from './role-cache.js';
import { getUserAreasById } from './user-cache.js';

export async function authzPreTicket(
  req: any,
  permiso: string,
): Promise<{ status: number; error: string } | null> {
  const userId = String(req?.user?.id ?? '');
  const userAreas = await getUserAreasById(userId);
  const roleCfg = userAreas?.perfil ? await getRoleByName(userAreas.perfil) : null;

  if (roleCfg && !roleCfg.permissions.includes(permiso)) {
    return { status: 403, error: `No tenés permiso para esta acción (${permiso}).` };
  }
  return null;
}
