/**
 * CRUD de roles. FUENTE: Supabase `public.roles` (migrado de la lista SP 99.ABMRoles_Traslados).
 *
 * GET    /api/roles       → todos los roles activos
 * POST   /api/roles       → crear  { name, access, permissions, filterByFloors, bypassLocationCheck }
 * PATCH  /api/roles       → editar { spItemId(=id), name?, access?, permissions?, filterByFloors?, bypassLocationCheck? }
 * DELETE /api/roles       → soft delete { spItemId(=id) }  → status='Inactivo'
 *
 * Mantiene el MISMO shape de respuesta que la versión SharePoint para NO tocar el front:
 * RoleManagementView espera `access` como string unido por '/' (y hace access.split('/')),
 * UserManagementView usa {name, filterByFloors}. `spItemId` en el body ahora es el uuid de la
 * fila (el front lo trata como opaco: lo toma de role.id que devuelve el GET).
 *
 * Escribe con el cliente admin (service_role, bypassa RLS). Tras cada mutación invalida el cache
 * de role-cache.ts para que login/enforcement/push vean el cambio sin esperar el TTL de 5 min.
 */
import { requireAuth } from './jwt.js';
import { getSupabaseAdmin } from './supabase-admin.js';
import { invalidateRoleCache } from './role-cache.js';

interface RoleRow {
  id: string;
  name: string;
  modules: string[];
  permissions: string[];
  filter_by_floors: boolean;
  bypass_location_check: boolean;
  requires_identification: boolean;
  status: string;
}

// Fila Supabase → shape que consume el front (access como string '/'-joined, permissions array, status).
function toApiRole(r: RoleRow) {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    access: (Array.isArray(r.modules) ? r.modules : []).join('/'),
    permissions: Array.isArray(r.permissions) ? r.permissions : [],
    filterByFloors: Boolean(r.filter_by_floors),
    bypassLocationCheck: Boolean(r.bypass_location_check),
    requiresIdentification: Boolean(r.requires_identification),
    status: String(r.status ?? ''),
  };
}

// `access` (string con '/') → modules text[]. Mismo criterio que el seed y que la vieja role-cache.
function splitModules(access: unknown): string[] {
  return String(access ?? '').split('/').map(s => s.trim()).filter(Boolean);
}

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let supa;
  try {
    supa = getSupabaseAdmin();
  } catch (e: any) {
    console.error('[roles]', e?.message ?? e);
    return res.status(503).json({ error: 'Supabase no configurado' });
  }

  // ── GET ─────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { data, error } = await supa
        .from('roles')
        .select('id, name, modules, permissions, filter_by_floors, bypass_location_check, requires_identification, status')
        .eq('status', 'Activo')
        .order('name');
      if (error) {
        // Se traga el error con 200 {roles:[]} (igual que la versión SP): el front mantiene su
        // estado previo y no rompe el ABM ante un hipo del backend.
        console.error('[roles] GET failed:', error.message);
        return res.status(200).json({ roles: [] });
      }
      return res.status(200).json({ roles: (data ?? []).map((r: any) => toApiRole(r)) });
    } catch (err: any) {
      console.error('[roles] GET error:', err);
      return res.status(200).json({ roles: [] });
    }
  }

  // ── POST ────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { name, access, permissions, filterByFloors, bypassLocationCheck, requiresIdentification } = req.body ?? {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    try {
      const { data, error } = await supa
        .from('roles')
        .insert({
          name: String(name),
          modules: splitModules(access),
          permissions: Array.isArray(permissions) ? permissions.map(String) : [],
          filter_by_floors: !!filterByFloors,
          bypass_location_check: !!bypassLocationCheck,
          requires_identification: !!requiresIdentification,
          status: 'Activo',
        })
        .select('id')
        .single();
      if (error) {
        // 23505 = violación de unique(lower(name)) → nombre duplicado. Mensaje accionable.
        if (error.code === '23505') return res.status(409).json({ error: 'Ya existe un rol con ese nombre' });
        console.error('[roles] POST failed:', error.message);
        return res.status(500).json({ error: 'Failed to create role' });
      }
      invalidateRoleCache();
      console.log(`[roles] Created role: ${name}`);
      return res.status(200).json({ ok: true, id: String(data.id) });
    } catch (err: any) {
      console.error('[roles] POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH ───────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { spItemId, name, access, permissions, filterByFloors, bypassLocationCheck, requiresIdentification } = req.body ?? {};
    if (!spItemId) return res.status(400).json({ error: 'spItemId required' });

    const fields: Record<string, unknown> = {};
    if (name !== undefined) fields.name = String(name);
    if (access !== undefined) fields.modules = splitModules(access);
    if (permissions !== undefined) {
      const arr = Array.isArray(permissions) ? permissions.map(String) : [];
      if (arr.length === 0) {
        console.warn(`[roles] PATCH id=${spItemId} — writing empty permissions (all permissions removed)`);
      }
      fields.permissions = arr;
    }
    if (filterByFloors !== undefined) fields.filter_by_floors = !!filterByFloors;
    if (bypassLocationCheck !== undefined) fields.bypass_location_check = !!bypassLocationCheck;
    if (requiresIdentification !== undefined) fields.requires_identification = !!requiresIdentification;

    try {
      const { error } = await supa.from('roles').update(fields).eq('id', spItemId);
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Ya existe un rol con ese nombre' });
        console.error('[roles] PATCH failed:', error.message);
        return res.status(500).json({ error: 'Failed to update role' });
      }
      invalidateRoleCache();
      console.log(`[roles] Updated role ${spItemId}`);
      return res.status(200).json({ ok: true });
    } catch (err: any) {
      console.error('[roles] PATCH error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE (soft) ───────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { spItemId } = req.body ?? {};
    if (!spItemId) return res.status(400).json({ error: 'spItemId required' });

    try {
      // AHORA sí se verifica el resultado Y se invalida el cache: la versión SP no chequeaba el
      // graphFetch ni invalidaba en DELETE (un rol borrado sobrevivía hasta 5 min en cache).
      const { error } = await supa.from('roles').update({ status: 'Inactivo' }).eq('id', spItemId);
      if (error) {
        console.error('[roles] DELETE failed:', error.message);
        return res.status(500).json({ error: 'Failed to delete role' });
      }
      invalidateRoleCache();
      console.log(`[roles] Deactivated role ${spItemId}`);
      return res.status(200).json({ ok: true });
    } catch (err: any) {
      console.error('[roles] DELETE error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireAuth(handler);
