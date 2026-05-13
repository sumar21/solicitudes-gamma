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
