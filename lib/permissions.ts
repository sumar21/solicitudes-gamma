/**
 * Helper de chequeo de permisos.
 *
 * Los permisos viven en `user.permissions` (poblado en login desde
 * 99.ABMRoles_Traslados → Permisos_RT). Si el campo no existe (token viejo
 * pre-refactor, rol mal configurado, etc.) el helper devuelve `false` →
 * comportamiento safe-default = solo lectura.
 */
import type { User, Permission, RoleModule } from '../types';

export const can = (user: User | null | undefined, perm: Permission): boolean =>
  !!user?.permissions?.includes(perm);

export const hasModule = (user: User | null | undefined, mod: RoleModule): boolean =>
  !!user?.modules?.includes(mod);

// Mapeo de tipo de notificación al permiso requerido para recibirla.
// Fuente única de verdad client-side. El server tiene un map equivalente
// (intencionalmente duplicado por separación de TS/build).
const NOTIF_TYPE_TO_PERMISSION: Record<string, Permission> = {
  NEW_TICKET:           'notif_new_ticket',
  STATUS_UPDATE:        'notif_status_update',
  RECEPTION_CONFIRMED:  'notif_reception_confirmed',
  DIET_CHANGE:          'notif_diet_change',
  FASTING_CHANGE:       'notif_fasting_change',
  ROOM_CLEANED:         'notif_habitacion_limpia',
};

/**
 * Chequea si el user puede recibir un push/notif de cierto tipo. Tipo desconocido
 * → false (fail-safe: no notificamos lo que no sabemos clasificar).
 */
export const canReceiveNotif = (
  user: User | null | undefined,
  notifType: string | null | undefined,
): boolean => {
  if (!notifType) return false;
  const perm = NOTIF_TYPE_TO_PERMISSION[notifType];
  return perm ? can(user, perm) : false;
};
