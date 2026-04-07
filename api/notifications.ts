/**
 * GET    /api/notifications          → user's notifications
 * PATCH  /api/notifications          → mark as read { notificationId }
 *
 * Uses SharePoint list "10.Notificaciones"
 */

import { graphFetch } from './graph.js';
import { requireAuth } from './jwt.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = '240f00dd-715b-4c78-9661-3147b7650a0f'; // 10.Notificaciones

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!SITE_ID) return res.status(503).json({ error: 'SHAREPOINT_SITE_ID not configured' });

  const basePath = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;
  const user = (req as any).user;

  // ── GET — fetch user's notifications ──────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const filter = encodeURIComponent(`fields/UserId_N eq ${Number(user?.id) || 0}`);
      const spRes = await graphFetch(
        `${basePath}?$expand=fields&$filter=${filter}&$top=50&$orderby=fields/Fecha_N desc`,
        { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
      );
      if (!spRes.ok) return res.status(200).json({ notifications: [] });

      const data = (await spRes.json()) as { value: Record<string, unknown>[] };
      const notifications = (data.value ?? []).map((item: any) => {
        const f = item.fields as Record<string, unknown>;
        return {
          id: String(item.id),
          ticketId: String(f.TicketId_N ?? ''),
          userId: f.UserId_N,
          title: String(f.Title_N ?? ''),
          message: String(f.Message_N ?? ''),
          type: String(f.Type_N ?? ''),
          status: String(f.Status_N ?? ''),
          fecha: String(f.Fecha_N ?? ''),
          leidaAt: f.LeidaAt_N ? String(f.LeidaAt_N) : null,
        };
      });
      return res.status(200).json({ notifications });
    } catch (err: any) {
      console.error('[notifications] GET error:', err);
      return res.status(200).json({ notifications: [] });
    }
  }

  // ── PATCH — mark notification as read ─────────────────────────────────────
  if (req.method === 'PATCH') {
    const { notificationId } = req.body ?? {};
    if (!notificationId) return res.status(400).json({ error: 'notificationId required' });

    try {
      const spRes = await graphFetch(`${basePath}/${notificationId}/fields`, {
        method: 'PATCH',
        body: JSON.stringify({
          Status_N: 'Leida',
          LeidaAt_N: new Date().toISOString(),
        }),
      });
      if (!spRes.ok) {
        console.error('[notifications] PATCH failed:', spRes.status);
        return res.status(500).json({ error: 'Failed to update' });
      }
      return res.status(200).json({ ok: true });
    } catch (err: any) {
      console.error('[notifications] PATCH error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireAuth(handler);
