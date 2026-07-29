/**
 * GET/POST /api/ticket-events — timeline/trayectoria de un traslado.
 * FUENTE: Supabase public.traslado_eventos (migrado de SP 08.DetalleTraslados).
 *
 * GET  ?ticketId=<id>                          → eventos del ticket, orden cronológico
 * POST { ticketId, tipo, usuario, usuarioId }  → registra un movimiento
 *
 * NOTA: 08.DetalleTraslados NO tenía columna Entorno; traslado_eventos SÍ. Ahora el GET filtra
 * y el POST etiqueta por entorno (las lecturas del cliente van bajo RLS por entorno).
 */
import { requireAuth } from './jwt.js';
import { getSupabaseAdmin } from './supabase-admin.js';

const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let supa;
  try { supa = getSupabaseAdmin(); }
  catch (e: any) { console.error('[ticket-events]', e?.message ?? e); return res.status(503).json({ error: 'Supabase no configurado' }); }

  try {
    // ── GET ────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const ticketId = req.query?.ticketId;
      if (!ticketId) return res.status(400).json({ error: 'ticketId query param required' });

      const { data, error } = await supa.from('traslado_eventos')
        .select('id, traslado_id, tipo, usuario, usuario_id, created_at')
        .eq('traslado_id', String(ticketId)).eq('entorno', ENTORNO)
        .order('created_at', { ascending: true });
      if (error) throw new Error(`Supabase GET failed: ${error.message}`);

      const events = (data ?? []).map((r: any) => ({
        id:        String(r.id),
        ticketId:  String(r.traslado_id ?? ''),
        tipo:      String(r.tipo ?? ''),
        fecha:     String(r.created_at ?? ''),
        usuario:   String(r.usuario ?? ''),
        usuarioId: r.usuario_id != null ? String(r.usuario_id) : '',
      }));
      return res.status(200).json({ events });
    }

    // ── POST ─────────────────────────────────────────────────────────────────
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { ticketId, tipo, usuario, usuarioId } = req.body ?? {};
    if (!ticketId || !tipo) return res.status(400).json({ error: 'ticketId y tipo requeridos' });

    const idNum = Number(usuarioId);
    const { data, error } = await supa.from('traslado_eventos').insert({
      traslado_id: String(ticketId),
      entorno:     ENTORNO,
      tipo:        String(tipo),
      usuario:     usuario != null && usuario !== '' ? String(usuario) : null,
      usuario_id:  Number.isFinite(idNum) && usuarioId != null && usuarioId !== '' ? idNum : null,
    }).select('id').single();
    if (error) throw new Error(`Supabase POST failed: ${error.message}`);

    return res.status(201).json({ ok: true, spItemId: String(data.id) });
  } catch (err: any) {
    console.error('[api/ticket-events]', err);
    return res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}

export default requireAuth(handler);
