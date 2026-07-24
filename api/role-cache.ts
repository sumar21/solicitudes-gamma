/**
 * Cache server-side de roles (99.ABMRoles_Traslados).
 *
 * Evita hitear SP en cada login/push. TTL 5 min. Se invalida explícitamente
 * desde api/roles.ts tras mutaciones POST/PATCH/DELETE.
 *
 * - getRoleByName(perfilU) busca case-insensitive (Perfil_U del user vs NombreRol_RT).
 * - Si no hay match: devuelve null → caller usa modo seguro = solo lectura.
 */
import { graphFetch } from './graph.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = '68836bbe-18c5-4cb2-8cc6-e21ecae96710'; // 99.ABMRoles_Traslados
const TTL_MS  = 5 * 60 * 1000;

export interface RoleConfig {
  id: string;
  name: string;
  modules: string[];      // Acceso_RT split por '/'
  permissions: string[];  // Permisos_RT split por ';'
  filterByFloors: boolean;
  // Si está activo, los usuarios de este rol pueden entrar sin validación de
  // ubicación (IP/GPS). BypassUbicacion_RT en SP.
  bypassLocationCheck: boolean;
}

let cache: { roles: RoleConfig[]; exp: number } | null = null;

function parseBool(raw: unknown): boolean {
  if (!raw) return false;
  const v = String(raw).trim().toLowerCase();
  return v === 'sí' || v === 'si' || v === 'yes' || v === 'true' || v === '1';
}

// `null` = el fetch FALLÓ (SP caído / red / config faltante). Distinto de `[]`, que es un
// resultado válido "no hay roles". La diferencia es clave: un fallo NO debe cachearse como
// lista vacía (ver getRolesCached), porque eso dejaría a todos los usuarios sin permisos por
// los 5 min del TTL — el modo seguro "solo lectura" es correcto para un rol ausente, pero
// catastrófico si se dispara por un hipo transitorio de SharePoint.
async function fetchRolesFromSP(): Promise<RoleConfig[] | null> {
  if (!SITE_ID) return null;
  const filter = encodeURIComponent("fields/Status_RT eq 'Activo'");
  const res = await graphFetch(
    `/sites/${SITE_ID}/lists/${LIST_ID}/items?$expand=fields&$filter=${filter}&$top=200`,
    { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
  ).catch(() => null); // graphFetch puede RECHAZAR (no solo !ok): sin esto salía como 500 opaco
  if (!res || !res.ok) {
    console.error('[role-cache] SP fetch failed:', res?.status ?? 'network error');
    return null;
  }
  const data = (await res.json()) as { value: Record<string, unknown>[] };
  return (data.value ?? []).map((item: any) => {
    const f = item.fields as Record<string, unknown>;
    return {
      id: String(item.id),
      name: String(f.NombreRol_RT ?? ''),
      modules: String(f.Acceso_RT ?? '').split('/').map(s => s.trim()).filter(Boolean),
      permissions: String(f.Permisos_RT ?? '').split(';').map(s => s.trim()).filter(Boolean),
      filterByFloors: parseBool(f.FiltrarPisos_RT),
      bypassLocationCheck: parseBool(f.BypassUbicacion_RT),
    };
  });
}

export async function getRolesCached(): Promise<RoleConfig[]> {
  const now = Date.now();
  if (cache && cache.exp > now) return cache.roles;
  const roles = await fetchRolesFromSP();
  if (roles === null) {
    // Fetch falló: servir el último cache bueno AUNQUE esté vencido (serve-stale-on-error),
    // y JAMÁS cachear el fallo. Sin cache previo devolvemos [] pero SIN persistirlo, así el
    // próximo request reintenta SP en vez de quedar 5 min envenenado con vacío.
    if (cache) { console.warn('[role-cache] SP falló — sirviendo cache vencido (serve-stale)'); return cache.roles; }
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
