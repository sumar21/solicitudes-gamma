/**
 * Cache server-side de roles.
 *
 * FUENTE: Supabase `public.roles` (migrado de la lista SP 99.ABMRoles_Traslados). Se lee con el
 * cliente admin (service_role) porque la tabla tiene RLS solo-service_role. Evita hitear la DB en
 * cada login/push: cache in-memory TTL 5 min, invalidado explícitamente desde api/roles.ts tras
 * mutaciones POST/PATCH/DELETE.
 *
 * - getRoleByName(perfilU) busca case-insensitive (Perfil_U del user vs roles.name).
 * - Si no hay match: devuelve null → caller usa modo seguro = solo lectura.
 *
 * CONTRATO PRESERVADO en la migración SP→Supabase: la interface RoleConfig, la semántica
 * null-vs-[] (fallo vs sin-roles) y el serve-stale-on-error son IDÉNTICOS a la versión SP —
 * de eso dependen auth.ts (login), me.ts, tickets.ts (enforcement de piso), dietas.ts,
 * carga-menu.ts y push-utils.ts, que NO se tocan porque todos leen por este seam.
 */
import { getSupabaseAdmin } from './supabase-admin.js';

export interface RoleConfig {
  id: string;
  name: string;
  modules: string[];      // en Supabase ya es text[] nativo (antes: Acceso_RT split '/')
  permissions: string[];  // en Supabase ya es text[] nativo (antes: Permisos_RT split ';')
  filterByFloors: boolean;
  // Si está activo, los usuarios de este rol pueden entrar sin validación de
  // ubicación (IP/GPS). filter_by_floors / bypass_location_check son boolean nativos en Supabase.
  bypassLocationCheck: boolean;
  // Cuenta compartida: al loguearse la persona real se identifica (nombre) y ese nombre queda
  // como "operador" de las transacciones hasta el "cambio de turno".
  requiresIdentification: boolean;
}

const TTL_MS = 5 * 60 * 1000;

let cache: { roles: RoleConfig[]; exp: number } | null = null;

// `null` = la lectura FALLÓ (DB caída / red / envs faltantes). Distinto de `[]`, que es un
// resultado válido "no hay roles". La diferencia es clave: un fallo NO debe cachearse como
// lista vacía (ver getRolesCached), porque eso dejaría a todos los usuarios sin permisos por
// los 5 min del TTL — el modo seguro "solo lectura" es correcto para un rol ausente, pero
// catastrófico si se dispara por un hipo transitorio de la DB.
async function fetchRolesFromDB(): Promise<RoleConfig[] | null> {
  try {
    const supa = getSupabaseAdmin(); // lanza si faltan las envs → lo atrapa el catch → null
    const { data, error } = await supa
      .from('roles')
      .select('id, name, modules, permissions, filter_by_floors, bypass_location_check, requires_identification')
      .eq('status', 'Activo')
      .limit(200);
    if (error) {
      // Error de la query (no excepción): también es un FALLO, no "sin roles" → null (no cachea).
      console.error('[role-cache] Supabase fetch failed:', error.message);
      return null;
    }
    // modules/permissions ya vienen como text[] nativos; los flags como boolean. Sin split ni
    // parseBool: la forma correcta la garantiza la tabla (arrays y booleanos nativos).
    return (data ?? []).map((r: any) => ({
      id: String(r.id),
      name: String(r.name ?? ''),
      modules: Array.isArray(r.modules) ? r.modules.map(String) : [],
      permissions: Array.isArray(r.permissions) ? r.permissions.map(String) : [],
      filterByFloors: Boolean(r.filter_by_floors),
      bypassLocationCheck: Boolean(r.bypass_location_check),
      requiresIdentification: Boolean(r.requires_identification),
    }));
  } catch (err: any) {
    // getSupabaseAdmin lanzó (envs faltantes) o el cliente rechazó: FALLO, no "sin roles".
    console.error('[role-cache] Supabase fetch threw:', err?.message ?? err);
    return null;
  }
}

export async function getRolesCached(): Promise<RoleConfig[]> {
  const now = Date.now();
  if (cache && cache.exp > now) return cache.roles;
  const roles = await fetchRolesFromDB();
  if (roles === null) {
    // Fetch falló: servir el último cache bueno AUNQUE esté vencido (serve-stale-on-error),
    // y JAMÁS cachear el fallo. Sin cache previo devolvemos [] pero SIN persistirlo, así el
    // próximo request reintenta la DB en vez de quedar 5 min envenenado con vacío.
    if (cache) { console.warn('[role-cache] DB falló — sirviendo cache vencido (serve-stale)'); return cache.roles; }
    return [];
  }
  cache = { roles, exp: now + TTL_MS };
  return roles;
}

export async function getRoleByName(perfilU: string): Promise<RoleConfig | null> {
  if (!perfilU) return null;
  const roles = await getRolesCached();
  const needle = perfilU.trim().toLowerCase();
  return roles.find(r => r.name.trim().toLowerCase() === needle) ?? null;
}

export function invalidateRoleCache(): void {
  cache = null;
}
