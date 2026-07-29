/**
 * Campanita in-app. FUENTE: Supabase public.notificaciones (migrado de SP 10.Notificaciones).
 *
 * GET    /api/notifications          → notifs NO leídas del user (status='Enviada').
 *                                       ?window=24h → leídas + no-leídas de las últimas 24h.
 * PATCH  /api/notifications          → marcar como leída. Cuatro formas de body:
 *                                       1) { notificationId }           → single por id (uuid)
 *                                       2) { notificationIds: [...] }   → bulk por ids
 *                                       3) { ticketId, type }           → mark-by-event
 *                                       4) { markAllForUser: true }     → todo el backlog del user
 *                                       Responde 200 { ok, updated, failed }.
 *
 * Lee/escribe con el cliente admin (service_role, bypassa RLS) y SIEMPRE filtra por user_id =
 * String(user.id) del token → un usuario nunca toca notifs de otro. Mismo shape de respuesta que
 * la versión SP para no tocar el front. (El cliente TAMBIÉN podría leer por Realtime directo con
 * el pase; este endpoint se mantiene como camino mínimo.)
 */
import { requireAuth } from './jwt.js';
import { getSupabaseAdmin } from './supabase-admin.js';

const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

// Fila Supabase → shape que consume el front (idéntico al de la versión SP).
function toApiNotif(r: any) {
  return {
    id: String(r.id),
    ticketId: String(r.traslado_id ?? ''),
    userId: r.user_id,
    title: String(r.title ?? ''),
    message: String(r.message ?? ''),
    type: String(r.type ?? ''),
    status: String(r.status ?? ''),
    fecha: String(r.created_at ?? ''),
    leidaAt: r.leida_at ? String(r.leida_at) : null,
  };
}

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let supa;
  try { supa = getSupabaseAdmin(); }
  catch (e: any) { console.error('[notifications]', e?.message ?? e); return res.status(503).json({ error: 'Supabase no configurado' }); }

  const user = (req as any).user;
  const userId = String(user?.id ?? '');

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const isHistory = String(req.query?.window ?? '').trim() === '24h';
      let q = supa.from('notificaciones')
        .select('id, traslado_id, user_id, title, message, type, status, created_at, leida_at')
        .eq('user_id', userId)
        .eq('entorno', ENTORNO)
        .order('created_at', { ascending: false });
      if (isHistory) {
        q = q.gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
      } else {
        q = q.eq('status', 'Enviada').limit(50);
      }
      const { data, error } = await q;
      if (error) { console.error('[notifications] GET failed:', error.message); return res.status(200).json({ notifications: [] }); }
      return res.status(200).json({ notifications: (data ?? []).map(toApiNotif) });
    } catch (err: any) {
      console.error('[notifications] GET error:', err);
      return res.status(200).json({ notifications: [] });
    }
  }

  // ── PATCH — marcar leída ────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const body = req.body ?? {};
    const nowIso = new Date().toISOString();
    const markRead = { status: 'Leida', leida_at: nowIso };

    try {
      // Modo 3: mark-by-event (ticketId + type). Sin ticketId no se puede linkear (ej DIET_CHANGE).
      if (body.ticketId !== undefined || body.type !== undefined) {
        const ticketId = String(body.ticketId ?? '').trim();
        const type = String(body.type ?? '').trim();
        if (!ticketId || !type) return res.status(200).json({ ok: true, updated: 0, failed: [], reason: 'missing-ticketId-or-type' });
        const { data, error } = await supa.from('notificaciones').update(markRead)
          .eq('user_id', userId).eq('entorno', ENTORNO)
          .eq('traslado_id', ticketId).eq('type', type).eq('status', 'Enviada')
          .select('id');
        if (error) { console.error('[notifications] mark-by-event failed:', error.message); return res.status(500).json({ ok: false, updated: 0, failed: [{ id: 'update', error: error.message }] }); }
        return res.status(200).json({ ok: true, updated: data?.length ?? 0, failed: [] });
      }

      // Modo 4: markAllForUser — todo el backlog no leído del user.
      if (body.markAllForUser === true) {
        const { data, error } = await supa.from('notificaciones').update(markRead)
          .eq('user_id', userId).eq('entorno', ENTORNO).eq('status', 'Enviada')
          .select('id');
        if (error) { console.error('[notifications] markAll failed:', error.message); return res.status(500).json({ ok: false, updated: 0, failed: 1, error: error.message }); }
        return res.status(200).json({ ok: true, updated: data?.length ?? 0, failed: 0, remaining: 0 });
      }

      // Modos 1 y 2: por id (single o bulk).
      const ids: string[] = Array.isArray(body.notificationIds)
        ? body.notificationIds.map(String).filter(Boolean)
        : body.notificationId ? [String(body.notificationId)] : [];
      if (ids.length === 0) return res.status(400).json({ error: 'notificationId, notificationIds or {ticketId,type} required' });

      const { data, error } = await supa.from('notificaciones').update(markRead)
        .in('id', ids).eq('user_id', userId).eq('entorno', ENTORNO)
        .select('id');
      if (error) { console.error('[notifications] PATCH by id failed:', error.message); return res.status(500).json({ ok: false, updated: 0, failed: ids.map(id => ({ id, error: error.message })) }); }
      return res.status(200).json({ ok: true, updated: data?.length ?? 0, failed: [] });
    } catch (err: any) {
      console.error('[notifications] PATCH error:', err);
      return res.status(500).json({ ok: false, updated: 0, failed: 1, error: err?.message ?? String(err) });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireAuth(handler);
