/**
 * POST /api/ticket-events
 * Registra movimientos en la lista "08.DetalleTraslados".
 *
 * Body: { ticketId, tipo, usuario, usuarioId }
 */

import { graphFetch }  from './graph';
import { requireAuth } from './jwt';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = 'bd50c2be-0ec7-45d7-b1f5-abf10546675d'; // 08.DetalleTraslados

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SITE_ID) return res.status(503).json({ error: 'SHAREPOINT_SITE_ID not configured' });

  try {
    // ── GET — obtener eventos de un ticket ────────────────────────────────
    if (req.method === 'GET') {
      const ticketId = req.query?.ticketId;
      if (!ticketId) return res.status(400).json({ error: 'ticketId query param required' });

      const filter = `fields/IDUnivocoTraslado_DT eq '${String(ticketId).replace(/'/g, "''")}'`;
      const t0 = Date.now();
      const spRes = await graphFetch(
        `/sites/${SITE_ID}/lists/${LIST_ID}/items?$expand=fields&$filter=${encodeURIComponent(filter)}&$top=50`,
      );

      console.log(`[ticket-events] SP query took ${Date.now() - t0}ms`);
      if (!spRes.ok) throw new Error(`SP GET failed (${spRes.status}): ${await spRes.text()}`);

      const data = (await spRes.json()) as { value: Record<string, unknown>[] };
      const events = (data.value ?? []).map((item) => {
        const f = item.fields as Record<string, unknown>;
        return {
          id:        String(item.id),
          ticketId:  String(f.IDUnivocoTraslado_DT ?? ''),
          tipo:      String(f.TipoMovimiento_DT ?? ''),
          fecha:     String(f.FechaMovimiento_DT ?? ''),
          usuario:   String(f.UsuarioMovimiento_DT ?? ''),
          usuarioId: String(f.IDUsuarioMovimiento_DT ?? ''),
        };
      });

      // Sort by date in server instead of SP query (much faster)
      events.sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

      return res.status(200).json({ events });
    }

    // ── POST — registrar nuevo movimiento ─────────────────────────────────
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { ticketId, tipo, usuario, usuarioId } = req.body ?? {};
    if (!ticketId || !tipo) return res.status(400).json({ error: 'ticketId y tipo requeridos' });

    const fields: Record<string, unknown> = {
      Title:                  '[sumar]',
      IDUnivocoTraslado_DT:   ticketId,
      TipoMovimiento_DT:      tipo,
      FechaMovimiento_DT:     new Date().toISOString(),
      UsuarioMovimiento_DT:   usuario ?? '',
      IDUsuarioMovimiento_DT: usuarioId ?? '',
    };

    const spRes = await graphFetch(
      `/sites/${SITE_ID}/lists/${LIST_ID}/items`,
      { method: 'POST', body: JSON.stringify({ fields }) },
    );

    if (!spRes.ok) throw new Error(`SP POST failed (${spRes.status}): ${await spRes.text()}`);

    const result = (await spRes.json()) as { id: string };
    return res.status(201).json({ ok: true, spItemId: result.id });
  } catch (err: any) {
    console.error('[api/ticket-events]', err);
    return res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}

export default requireAuth(handler);
