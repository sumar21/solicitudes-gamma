/**
 * POST /api/push-subscribe
 * Saves or updates a Web Push subscription in SharePoint list "09.PushSubscriptions".
 *
 * Body: { endpoint, keys: { p256dh, auth }, userId, role, assignedAreas, sede }
 */

import { graphFetch } from './graph.js';
import { requireAuth } from './jwt.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = '648fde7b-89d2-40ac-bc4a-63661508b50a'; // 09.PushSubscriptions

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!SITE_ID || !LIST_ID) return res.status(503).json({ error: 'SharePoint not configured' });

  const basePath = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;

  // ── DELETE — remove subscription on logout ─────────────────────────────
  if (req.method === 'DELETE') {
    const { endpoint } = req.body ?? {};
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    try {
      const filter = encodeURIComponent(`fields/Endpoint_PS eq '${endpoint.replace(/'/g, "''")}'`);
      const existing = await graphFetch(
        `${basePath}?$expand=fields&$filter=${filter}&$top=1`,
        { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
      );
      if (existing.ok) {
        const data = (await existing.json()) as { value: Record<string, unknown>[] };
        if (data.value?.length > 0) {
          const itemId = String(data.value[0].id);
          await graphFetch(`${basePath}/${itemId}`, { method: 'DELETE' });
          console.log(`[push-subscribe] Deleted subscription for endpoint`);
        }
      }
      return res.status(200).json({ ok: true });
    } catch (err: any) {
      console.error('[push-subscribe] DELETE error:', err);
      return res.status(200).json({ ok: true }); // don't block logout
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { endpoint, keys, userId, role, assignedAreas, sede } = req.body ?? {};
  if (!endpoint || !keys) return res.status(400).json({ error: 'endpoint and keys required' });

  try {
    // Check if subscription with this endpoint already exists
    const filter = encodeURIComponent(`fields/Endpoint_PS eq '${endpoint.replace(/'/g, "''")}'`);
    const existing = await graphFetch(
      `${basePath}?$expand=fields&$filter=${filter}&$top=1`,
      { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
    );

    const fields = {
      Endpoint_PS: endpoint,
      Keys_PS: JSON.stringify(keys),
      UserId_PS: String(userId ?? ''),
      UserRole_PS: String(role ?? ''),
      AssignedAreas_PS: String(assignedAreas ?? ''),
      Sede_PS: String(sede ?? 'HPR'),
    };

    if (existing.ok) {
      const data = (await existing.json()) as { value: Record<string, unknown>[] };
      if (data.value?.length > 0) {
        // Update existing subscription
        const itemId = String(data.value[0].id);
        await graphFetch(`${basePath}/${itemId}/fields`, {
          method: 'PATCH',
          body: JSON.stringify(fields),
        });
        console.log(`[push-subscribe] Updated subscription for user ${userId}`);
        return res.status(200).json({ ok: true, updated: true });
      }
    }

    // Create new subscription
    const spRes = await graphFetch(basePath, {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });

    if (!spRes.ok) {
      const errText = await spRes.text();
      console.error('[push-subscribe] SP create failed:', spRes.status, errText);
      return res.status(500).json({ error: 'Failed to save subscription' });
    }

    console.log(`[push-subscribe] Created subscription for user ${userId}`);
    return res.status(200).json({ ok: true, created: true });
  } catch (err: any) {
    console.error('[push-subscribe] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

export default requireAuth(handler);
