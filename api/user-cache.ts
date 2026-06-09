/**
 * Cache server-side de datos mínimos de usuario (00.Usuarios).
 *
 * Usado para validaciones en endpoints (ej: enforcement del piso de la azafata en
 * el PATCH de /api/tickets). No reemplaza /api/users; solo expone, por id, el perfil
 * y los pisos asignados (PisosAzafata_u) ya decodificados a nombres de área.
 *
 * TTL corto (2 min): los pisos de un usuario cambian rara vez, y el peor caso de
 * staleness (que una azafata recién reasignada sea rechazada/aceptada con un par de
 * minutos de retraso) es benigno.
 */
import { graphFetch } from './graph.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = 'e623ad06-ff62-441f-b67d-666224af5805'; // 00.Usuarios
const TTL_MS = 2 * 60 * 1000;

// Short codes → full Area names (mismo map que api/auth.ts y api/users.ts).
const AREA_CODES: Record<string, string> = {
  P4: 'Internacion 4° Piso HPR',
  P5: 'Internacion 5° Piso HPR',
  P6: 'Internacion 6° Piso HPR',
  P7: 'Internacion 7° Piso HPR',
  P8: 'Internacion 8° Piso HPR',
  HIT: 'Internación Transitoria HPR',
  HSS: 'Servicio de Neurofisiologia (Sueño) HPR',
  HUC: 'Unidad Coronaria HPR',
  HUQ: 'Unidad Recuperaciòn Postquirùrgica',
  HUT: 'Unidad de Terapia Intensiva HPR',
};

/** Convierte el valor guardado en SP (codes o nombres viejos) → nombres de área. */
function decodeFloors(raw: string): string[] {
  if (!raw) return [];
  return raw.split(';').map(s => s.trim()).filter(Boolean).map(s => AREA_CODES[s] ?? s);
}

export interface UserAreas {
  id: string;
  perfil: string;          // Perfil_U (NombreRol_RT del rol del usuario)
  assignedAreas: string[]; // PisosAzafata_u decodificado a nombres de área
}

const cache = new Map<string, { data: UserAreas | null; exp: number }>();

export async function getUserAreasById(id: string): Promise<UserAreas | null> {
  if (!id || !SITE_ID) return null;
  const now = Date.now();
  const cached = cache.get(id);
  if (cached && cached.exp > now) return cached.data;

  try {
    const res = await graphFetch(`/sites/${SITE_ID}/lists/${LIST_ID}/items/${id}?$expand=fields`);
    if (!res.ok) {
      cache.set(id, { data: null, exp: now + TTL_MS });
      return null;
    }
    const item = (await res.json()) as { id: string; fields: Record<string, unknown> };
    const f = item.fields ?? {};
    const data: UserAreas = {
      id: String(item.id),
      perfil: String(f.Perfil_U ?? ''),
      assignedAreas: decodeFloors(String(f.PisosAzafata_u ?? '')),
    };
    cache.set(id, { data, exp: now + TTL_MS });
    return data;
  } catch {
    return null;
  }
}

export function invalidateUserCache(id?: string): void {
  if (id) cache.delete(id);
  else cache.clear();
}
