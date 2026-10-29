/**
 * Vercel serverless — CRUD de limpiezas de habitaciones. FUENTE: Supabase public.limpiezas
 * (migrado de la lista SP 14.Limpiezas).
 *
 * GET    /api/limpiezas   → limpiezas activas (overlay "Limpia" vigente)
 * GET    /api/limpiezas?history=1&from=YYYY-MM-DD&to=YYYY-MM-DD → histórico (cerradas por fecha de cierre)
 * POST   /api/limpiezas   → marcar limpia (upsert por cama+entorno) { bedLabel, bedCode, roomCode, area, userId, userName }
 *                           + { closed: true, reason? } → limpieza que NACE cerrada (constancia histórica; sin push)
 * PATCH  /api/limpiezas   → cerrar una limpieza { bedLabel | spItemId, reason }  reason ∈ ANULADA|TICKET|GAMMA|CONSOLIDADO
 * PATCH  /api/limpiezas   + { reason: 'CANCELADA', observacion } → "Cancelar" una limpieza activa con observación (permiso
 *                           limpieza_rutina_cancelar, 30/10/2026). Sin cambios de esquema: queda en motivo_cierre como
 *                           "CANCELADA: <observación> — <cuenta> (<turno>)" (el historial lo muestra como "Cancelada").
 * POST   /api/limpiezas   + { revertir: true } → "Volver a En preparación" (permiso limpieza_revertir, 29/10/2026):
 *                           la cama se pasó a limpia y está sucia. Anula la limpieza activa si la hay y deja una fila
 *                           ACTIVA con motivo_cierre = 'SUCIA': el mapa la vuelve a mostrar "En preparación" aunque
 *                           PROGAL ya diga Disponible, hasta que una azafata la marque limpia (esa fila se cierra y
 *                           queda en el historial como "Volvió a preparación"). Sin cambios de esquema.
 *
 * El overlay del front (mergeBeds) muestra la cama disponible sobre lo que reporta Gamma (read-only).
 * El push "Habitación Limpia" (ROOM_CLEANED) sigue saliendo por push-utils (que ya lee subs de Supabase).
 */
import { requireAuth } from './jwt.js';
import { sendPushToSubscribers } from './push-utils.js';
import { getSupabaseAdmin } from './supabase-admin.js';
// Chequeo genérico "el rol tiene el permiso" (fail-open si el rol no se resuelve); nació para el pre-ticket.
import { authzPreTicket as authzPermiso } from './pre-ticket-authz.js';

const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();
const MOTIVOS = ['ANULADA', 'TICKET', 'GAMMA', 'CONSOLIDADO'];
// Marca de "volvió a preparación": fila ACTIVA con este motivo_cierre (las limpiezas activas normales lo tienen null).
const SUCIA = 'SUCIA';

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let supa;
  try { supa = getSupabaseAdmin(); }
  catch (e: any) { console.error('[limpiezas]', e?.message ?? e); return res.status(req.method === 'GET' ? 200 : 503).json(req.method === 'GET' ? { cleanings: [] } : { error: 'Supabase no configurado' }); }

  // ── GET — histórico (cerradas) ────────────────────────────────────────────
  if (req.method === 'GET' && String(req.query?.history ?? '') === '1') {
    try {
      const isDate = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''));
      const from = isDate(req.query?.from) ? String(req.query.from) : '';
      const to   = isDate(req.query?.to)   ? String(req.query.to)   : '';
      let q = supa.from('limpiezas').select('*').eq('entorno', ENTORNO).eq('status', 'Inactivo').limit(2000);
      if (from) q = q.gte('fecha_cierre', `${from}T00:00:00Z`);
      if (to)   q = q.lte('fecha_cierre', `${to}T23:59:59Z`);
      const { data, error } = await q;
      if (error) { console.error('[limpiezas] history GET failed:', error.message); return res.status(200).json({ cleanings: [] }); }
      const cleanings = (data ?? []).map((r: any) => ({
        spItemId: String(r.id),
        bedLabel: String(r.cama_label ?? ''),
        area:     String(r.area ?? ''),
        by:       String(r.azafata_nombre ?? ''),
        // Nombre que puso la persona al cambiar de turno (las cuentas son compartidas por piso): sin esto el
        // historial mostraba solo "Azafata, Piso 5" (29/10/2026).
        operador: String(r.operador ?? ''),
        at:       String(r.fecha_limpieza ?? ''),
        closedAt: String(r.fecha_cierre ?? ''),
        reason:   String(r.motivo_cierre ?? ''),
      }));
      return res.status(200).json({ cleanings });
    } catch (err: any) {
      console.error('[limpiezas] history GET error:', err);
      return res.status(200).json({ cleanings: [] });
    }
  }

  // ── GET — limpiezas activas ───────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { data, error } = await supa.from('limpiezas').select('*')
        .eq('entorno', ENTORNO).eq('status', 'Activo').limit(500);
      if (error) { console.error('[limpiezas] GET failed:', error.message); return res.status(200).json({ cleanings: [] }); }
      const cleanings = (data ?? []).map((r: any) => ({
        spItemId: String(r.id),
        bedLabel: String(r.cama_label ?? ''),
        bedCode:  String(r.cama_codigo ?? ''),
        roomCode: String(r.habitacion ?? ''),
        area:     String(r.area ?? ''),
        by:       String(r.azafata_nombre ?? ''),
        byId:     String(r.azafata_id ?? ''),
        operador: String(r.operador ?? ''),
        at:       String(r.fecha_limpieza ?? ''),
        sucia:    r.motivo_cierre === SUCIA, // "volvió a preparación" (no es una limpieza: es la marca de sucia)
      }));
      return res.status(200).json({ cleanings });
    } catch (err: any) {
      console.error('[limpiezas] GET error:', err);
      return res.status(200).json({ cleanings: [] });
    }
  }

  // ── POST — marcar limpia (upsert por cama + entorno) ──────────────────────
  if (req.method === 'POST') {
    const { bedLabel, bedCode, roomCode, area, userId, userName, operador, closed, reason, revertir } = req.body ?? {};
    if (!bedLabel) return res.status(400).json({ error: 'bedLabel is required' });

    // ── "Volver a En preparación" (ver encabezado) ──
    if (revertir === true) {
      const denied = await authzPermiso(req, 'limpieza_revertir');
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const nowIso0 = new Date().toISOString();
      try {
        const { data: activa } = await supa.from('limpiezas').select('id, motivo_cierre')
          .eq('entorno', ENTORNO).eq('cama_label', String(bedLabel)).eq('status', 'Activo').limit(1);
        if (activa?.length && activa[0].motivo_cierre === SUCIA) return res.status(200).json({ ok: true, unchanged: true, spItemId: String(activa[0].id) });
        if (activa?.length) {
          await supa.from('limpiezas').update({ status: 'Inactivo', motivo_cierre: 'ANULADA', fecha_cierre: nowIso0, version: String(req.body?.version ?? '') })
            .eq('id', activa[0].id).eq('entorno', ENTORNO);
        }
        const { data: creada, error } = await supa.from('limpiezas').insert({
          entorno: ENTORNO, cama_label: String(bedLabel), cama_codigo: String(bedCode ?? ''),
          habitacion: String(roomCode ?? ''), area: String(area ?? ''), status: 'Activo', motivo_cierre: SUCIA,
          azafata_id: String(userId ?? ''), azafata_nombre: String(userName ?? ''),
          operador: operador != null && operador !== '' ? String(operador) : null,
          fecha_limpieza: nowIso0, version: String(req.body?.version ?? ''),
        }).select('id').single();
        if (error) { console.error('[limpiezas] revertir failed:', error.message); return res.status(500).json({ error: 'No se pudo volver a "En preparación".' }); }
        console.log(`[limpiezas] "${bedLabel}" volvió a En preparación por ${userName ?? userId}${operador ? ` (${operador})` : ''}`);
        return res.status(200).json({ ok: true, spItemId: String(creada.id) });
      } catch (err: any) {
        console.error('[limpiezas] revertir error:', err);
        return res.status(500).json({ error: err.message });
      }
    }
    const nowIso = new Date().toISOString();
    const naceCerrada = closed === true;
    const motivoCierre = MOTIVOS.includes(String(reason)) ? String(reason) : 'TICKET';

    // "Habitación Limpia" → push + campanita (roles con notif_habitacion_limpia).
    //
    // Se AWAITEA antes de responder: si se dispara sin await, Vercel puede congelar el lambda
    // apenas sale la respuesta y el envío queda a medio camino. Medido sobre 67 limpiezas
    // nacidas activas, 5 (~7%) no generaron NINGÚN ROOM_CLEANED para nadie. Los crons de
    // dieta/ayuno ya awaiteaban; este era el único call site suelto. El .catch() se mantiene:
    // un fallo del push NO debe romper el POST (la limpieza ya se guardó).
    const notifyRoomCleaned = () => {
      const cama = bedCode ? ` · Cama ${bedCode}` : '';
      return sendPushToSubscribers({
        title: 'Habitación Limpia',
        body: `Hab. ${roomCode || '?'}${cama} — marcada limpia por ${userName || 'azafata'}.`,
        type: 'ROOM_CLEANED',
        originArea: String(bedLabel), destinationArea: String(bedLabel),
        originAreaName: String(area ?? ''), destinationAreaName: String(area ?? ''),
        sede: String(req.user?.sede ?? 'HPR'),
        excludeUserId: String(userId ?? req.user?.id ?? ''),
      }).catch((err: any) => console.error('[limpiezas] Push error:', err));
    };

    try {
      // Modo "nace cerrada": constancia histórica ("Habitación Lista" del ticket). No toca la
      // activa, no dispara push, no aparece como overlay (el GET de activas filtra status='Activo').
      if (naceCerrada) {
        const { data, error } = await supa.from('limpiezas').insert({
          entorno: ENTORNO, cama_label: String(bedLabel), cama_codigo: String(bedCode ?? ''),
          habitacion: String(roomCode ?? ''), area: String(area ?? ''),
          status: 'Inactivo', motivo_cierre: motivoCierre,
          azafata_id: String(userId ?? ''), azafata_nombre: String(userName ?? ''),
          operador: operador != null ? String(operador) : null,
          fecha_limpieza: nowIso, fecha_cierre: nowIso,
          version: String(req.body?.version ?? ''),
        }).select('id').single();
        if (error) { console.error('[limpiezas] POST(closed) failed:', error.message); return res.status(500).json({ error: 'Failed to create cleaning' }); }
        return res.status(200).json({ ok: true, spItemId: String(data.id) });
      }

      // Upsert de la ACTIVA: si ya hay una para esta cama+entorno → refrescar; si no → crear.
      const refresh = { azafata_id: String(userId ?? ''), azafata_nombre: String(userName ?? ''), operador: operador != null ? String(operador) : null, fecha_limpieza: nowIso, version: String(req.body?.version ?? '') };
      const { data: existing } = await supa.from('limpiezas').select('id, motivo_cierre')
        .eq('entorno', ENTORNO).eq('cama_label', String(bedLabel)).eq('status', 'Activo').limit(1);
      // La activa es la marca de "volvió a preparación": se cierra (queda en el historial) y se crea la limpieza nueva.
      if (existing?.length && existing[0].motivo_cierre === SUCIA) {
        await supa.from('limpiezas').update({ status: 'Inactivo', fecha_cierre: nowIso, version: String(req.body?.version ?? '') })
          .eq('id', existing[0].id).eq('entorno', ENTORNO);
        existing.length = 0;
      }
      if (existing?.length) {
        await supa.from('limpiezas').update(refresh).eq('id', existing[0].id);
        await notifyRoomCleaned();
        return res.status(200).json({ ok: true, spItemId: String(existing[0].id) });
      }

      const { data: created, error } = await supa.from('limpiezas').insert({
        entorno: ENTORNO, cama_label: String(bedLabel), cama_codigo: String(bedCode ?? ''),
        habitacion: String(roomCode ?? ''), area: String(area ?? ''), status: 'Activo',
        ...refresh,
      }).select('id').single();
      if (error) {
        // 23505 = carrera contra el índice único parcial (otra marca activa se creó) → refrescarla.
        if ((error as any).code === '23505') {
          const { data: raced } = await supa.from('limpiezas').select('id')
            .eq('entorno', ENTORNO).eq('cama_label', String(bedLabel)).eq('status', 'Activo').limit(1);
          if (raced?.length) {
            await supa.from('limpiezas').update(refresh).eq('id', raced[0].id);
            await notifyRoomCleaned();
            return res.status(200).json({ ok: true, spItemId: String(raced[0].id) });
          }
        }
        console.error('[limpiezas] POST failed:', error.message);
        return res.status(500).json({ error: 'Failed to create cleaning' });
      }
      await notifyRoomCleaned();
      return res.status(200).json({ ok: true, spItemId: String(created.id) });
    } catch (err: any) {
      console.error('[limpiezas] POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH — cerrar una limpieza ───────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { spItemId, bedLabel, reason, observacion, userName, operador } = req.body ?? {};
    let motivo = MOTIVOS.includes(String(reason)) ? String(reason) : 'ANULADA';
    const nowIso = new Date().toISOString();
    if (String(reason) === 'CANCELADA') {
      const obs = String(observacion ?? '').trim();
      if (!obs) return res.status(400).json({ error: 'La observación es obligatoria para cancelar.' });
      const denied = await authzPermiso(req, 'limpieza_rutina_cancelar');
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const quien = [userName, operador ? `(${operador})` : ''].filter(Boolean).join(' ');
      motivo = `CANCELADA: ${obs.slice(0, 300)}${quien ? ` — ${quien}` : ''}`;
    }

    try {
      let itemId = spItemId ? String(spItemId) : '';
      if (!itemId) {
        if (!bedLabel) return res.status(400).json({ error: 'spItemId or bedLabel required' });
        const { data } = await supa.from('limpiezas').select('id')
          .eq('entorno', ENTORNO).eq('cama_label', String(bedLabel)).eq('status', 'Activo').limit(1);
        if (data?.length) itemId = String(data[0].id);
      }
      if (!itemId) return res.status(200).json({ ok: true, message: 'No active cleaning found' });

      const { error } = await supa.from('limpiezas')
        .update({ status: 'Inactivo', motivo_cierre: motivo, fecha_cierre: nowIso, version: String(req.body?.version ?? '') })
        .eq('id', itemId).eq('entorno', ENTORNO); // re-afirma el entorno: un spItemId de otro entorno no cierra acá
      if (error) { console.error('[limpiezas] PATCH failed:', error.message); return res.status(500).json({ error: 'Failed to close cleaning' }); }
      return res.status(200).json({ ok: true });
    } catch (err: any) {
      console.error('[limpiezas] PATCH error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireAuth(handler);
