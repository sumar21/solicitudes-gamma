/**
 * CRUD for "99.ABMRoles_Traslados" SharePoint list.
 *
 * GET    /api/roles       → all active roles
 * POST   /api/roles       → create role { name, access }
 * PATCH  /api/roles       → update role { spItemId, name?, access? }
 * DELETE /api/roles       → soft delete  { spItemId }
 */

import { graphFetch } from './graph.js';
import { requireAuth } from './jwt.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = '68836bbe-18c5-4cb2-8cc6-e21ecae96710'; // 99.ABMRoles_Traslados

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!SITE_ID) return res.status(503).json({ error: 'SHAREPOINT_SITE_ID not configured' });

  const basePath = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;

  // ── GET ─────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const filter = encodeURIComponent("fields/Status_RT eq 'Activo'");
      const spRes = await graphFetch(
        `${basePath}?$expand=fields&$filter=${filter}&$top=200`,
        { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
      );
      if (!spRes.ok) {
        console.error('[roles] GET failed:', spRes.status);
        return res.status(200).json({ roles: [] });
      }
      const data = (await spRes.json()) as { value: Record<string, unknown>[] };
      const roles = (data.value ?? []).map((item: any) => {
        const f = item.fields as Record<string, unknown>;
        return {
          id: String(item.id),
          name: String(f.NombreRol_RT ?? ''),
          access: String(f.Acceso_RT ?? ''),
          status: String(f.Status_RT ?? ''),
        };
      });
      return res.status(200).json({ roles });
    } catch (err: any) {
      console.error('[roles] GET error:', err);
      return res.status(200).json({ roles: [] });
    }
  }

  // ── POST ────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { name, access } = req.body ?? {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    try {
      const spRes = await graphFetch(basePath, {
        method: 'POST',
        body: JSON.stringify({
          fields: {
            Title: '[sumar]',
            NombreRol_RT: String(name),
            Acceso_RT: String(access ?? ''),
            Status_RT: 'Activo',
          },
        }),
      });
      if (!spRes.ok) {
        const errText = await spRes.text();
        console.error('[roles] POST failed:', spRes.status, errText);
        return res.status(500).json({ error: 'Failed to create role' });
      }
      const created = (await spRes.json()) as { id: string };
      console.log(`[roles] Created role: ${name}`);
      return res.status(200).json({ ok: true, id: String(created.id) });
    } catch (err: any) {
      console.error('[roles] POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH ───────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { spItemId, name, access } = req.body ?? {};
    if (!spItemId) return res.status(400).json({ error: 'spItemId required' });

    const fields: Record<string, string> = {};
    if (name !== undefined) fields.NombreRol_RT = String(name);
    if (access !== undefined) fields.Acceso_RT = String(access);

    try {
      const spRes = await graphFetch(`${basePath}/${spItemId}/fields`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      });
      if (!spRes.ok) {
        console.error('[roles] PATCH failed:', spRes.status);
        return res.status(500).json({ error: 'Failed to update role' });
      }
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
      await graphFetch(`${basePath}/${spItemId}/fields`, {
        method: 'PATCH',
        body: JSON.stringify({ Status_RT: 'Inactivo' }),
      });
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
