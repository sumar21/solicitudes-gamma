/**
 * GET /api/debug-subs
 *
 * Endpoint TEMPORAL de auditoría de suscripciones Web Push (lista 09.PushSubscriptions).
 * Útil para diagnosticar por qué un rol no recibe notificaciones (áreas vacías,
 * sede distinta, sub expirada, falta de registro).
 *
 * Devuelve un resumen por rol + el listado crudo (con endpoints truncados).
 * Quitar cuando ya no haga falta.
 */

import { graphFetch } from './graph.js';
import { requireAuthAndLocation } from './jwt.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = '648fde7b-89d2-40ac-bc4a-63661508b50a'; // 09.PushSubscriptions

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'GET only' });
  if (!SITE_ID || !LIST_ID)     return res.status(503).json({ error: 'SharePoint no configurado' });

  try {
    const spRes = await graphFetch(
      `/sites/${SITE_ID}/lists/${LIST_ID}/items?$expand=fields&$top=500`,
      { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
    );
    if (!spRes.ok) return res.status(500).json({ error: `SP ${spRes.status}` });

    const data = (await spRes.json()) as { value: any[] };
    const subs = (data.value ?? []).map((item: any) => {
      const f = item.fields as Record<string, unknown>;
      const endpoint = String(f.Endpoint_PS ?? '');
      return {
        id: String(item.id),
        userId: String(f.UserId_PS ?? ''),
        role: String(f.UserRole_PS ?? ''),
        sede: String(f.Sede_PS ?? ''),
        entorno: String(f.Entorno_PS ?? '(empty)'),
        assignedAreas: String(f.AssignedAreas_PS ?? '').split(';').filter(Boolean),
        endpointHost: endpoint ? new URL(endpoint).host : '(empty)',
        endpointTail: endpoint ? endpoint.slice(-12) : '',
        hasKeys: !!f.Keys_PS,
      };
    });

    // Resumen por rol — buckets con count + cuántas tienen áreas válidas
    const byRole: Record<string, { total: number; withAreas: number; withoutAreas: number; sedes: Set<string> }> = {};
    for (const s of subs) {
      const role = s.role || '(empty)';
      if (!byRole[role]) byRole[role] = { total: 0, withAreas: 0, withoutAreas: 0, sedes: new Set() };
      byRole[role].total++;
      if (s.assignedAreas.length > 0) byRole[role].withAreas++;
      else byRole[role].withoutAreas++;
      if (s.sede) byRole[role].sedes.add(s.sede);
    }
    const summary = Object.entries(byRole).map(([role, b]) => ({
      role,
      total: b.total,
      withAreas: b.withAreas,
      withoutAreas: b.withoutAreas,
      sedes: [...b.sedes],
    }));

    return res.status(200).json({
      total: subs.length,
      summary,
      subs,
    });
  } catch (err: any) {
    console.error('[debug-subs]', err);
    return res.status(500).json({ error: err.message });
  }
}

export default requireAuthAndLocation(handler);
