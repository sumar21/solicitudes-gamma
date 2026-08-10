/**
 * GET/POST /api/ticket-observations — observaciones que se cargan durante un traslado.
 * FUENTE: Supabase public.traslado_obs (migrado de SP 13.ObservacionesTraslados).
 *
 * Cada observación queda ligada al STATUS del ticket en el momento en que se escribe, para
 * auditar por qué se demoró cada paso.
 *
 * GET  ?ticketId=<id>                                  → observaciones del ticket, cronológico
 * POST { ticketId, status, texto, usuario, usuarioId } → crea una observación
 */
import { requireAuth } from './jwt.js';
import { getSupabaseAdmin } from './supabase-admin.js';

const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();
const MAX_TEXT = 500; // mismo límite que motivos de cancelación / cambio en tickets

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let supa;
  try { supa = getSupabaseAdmin(); }
  catch (e: any) { console.error('[ticket-observations]', e?.message ?? e); return res.status(503).json({ error: 'Supabase no configurado' }); }

  try {
    // ── GET ────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const ticketId = req.query?.ticketId;
      if (!ticketId) return res.status(400).json({ error: 'ticketId query param required' });

      const { data, error } = await supa.from('traslado_obs')
        .select('id, traslado_id, status_ticket, texto, usuario, usuario_id, created_at')
        .eq('traslado_id', String(ticketId)).eq('entorno', ENTORNO)
        .order('created_at', { ascending: true });
      if (error) throw new Error(`Supabase GET failed: ${error.message}`);

      const observations = (data ?? []).map((r: any) => ({
        id:        String(r.id),
        ticketId:  String(r.traslado_id ?? ''),
        status:    String(r.status_ticket ?? ''),
        texto:     String(r.texto ?? ''),
        usuario:   String(r.usuario ?? ''),
        usuarioId: r.usuario_id != null ? String(r.usuario_id) : '',
        fecha:     String(r.created_at ?? ''),
      }));
      return res.status(200).json({ observations });
    }

    // ── POST ─────────────────────────────────────────────────────────────────
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { ticketId, status, texto, usuario, usuarioId, operador } = req.body ?? {};
    const cleanText = String(texto ?? '').trim();
    if (!ticketId || !cleanText) return res.status(400).json({ error: 'ticketId y texto requeridos' });

    const idNum = Number(usuarioId);
    const { data, error } = await supa.from('traslado_obs').insert({
      traslado_id:   String(ticketId),
      entorno:       ENTORNO,
      status_ticket: status != null && status !== '' ? String(status) : null,
      texto:         cleanText.slice(0, MAX_TEXT),
      usuario:       usuario != null && usuario !== '' ? String(usuario) : null,
      usuario_id:    Number.isFinite(idNum) && usuarioId != null && usuarioId !== '' ? idNum : null,
      operador:      operador != null && operador !== '' ? String(operador) : null,
      version:       String(req.body?.version ?? ''),
    }).select('id').single();
    if (error) throw new Error(`Supabase POST failed: ${error.message}`);

    return res.status(201).json({ ok: true, spItemId: String(data.id) });
  } catch (err: any) {
    console.error('[api/ticket-observations]', err);
    return res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}

export default requireAuth(handler);
