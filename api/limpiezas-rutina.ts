/**
 * Vercel serverless — LIMPIEZA DE RUTINA (camas ocupadas, ~2 veces por día).
 * FUENTE: Supabase public.limpiezas_rutina. Es un overlay sobre la cama OCUPADA (no cambia su
 * estado), distinto de public.limpiezas (limpieza terminal de una cama desocupada).
 *
 * GET   /api/limpiezas-rutina                          → rutinas ABIERTAS (INICIADA) del entorno → overlay del mapa
 * GET   /api/limpiezas-rutina?report=1&date=YYYY-MM-DD → rutinas del DÍA (reporte) por fecha_inicio (día AR, UTC-3)
 * GET   /api/limpiezas-rutina?paciente=<codigo>        → todas las rondas de ese paciente (journey)
 * POST  /api/limpiezas-rutina                          → INICIAR (nace INICIADA); idempotente por (entorno, cama)
 * PATCH /api/limpiezas-rutina                          → FINALIZAR / ANULAR una rutina abierta
 *
 * Sin push (no lo pide el flujo). Cada escritura estampa version.
 */
import { requireAuth } from './jwt.js';
import { getSupabaseAdmin } from './supabase-admin.js';

const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

const isDate = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''));

// Fecha "hoy" en zona AR (UTC-3, sin DST) → YYYY-MM-DD, para el reporte por día por defecto.
function hoyAR(): string {
  const ar = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return ar.toISOString().slice(0, 10);
}

/** Fila Supabase (snake_case) → shape del cliente (camelCase). */
function rowToRutina(r: any) {
  return {
    spItemId:        String(r.id),
    entorno:         String(r.entorno ?? ''),
    bedLabel:        String(r.cama_label ?? ''),
    bedCode:         r.cama_codigo != null ? String(r.cama_codigo) : '',
    roomCode:        r.habitacion != null ? String(r.habitacion) : '',
    area:            r.area != null ? String(r.area) : '',
    patientCode:     r.paciente_codigo != null ? String(r.paciente_codigo) : '',
    patientName:     r.paciente_nombre != null ? String(r.paciente_nombre) : '',
    estado:          String(r.estado ?? ''),
    startedBy:       r.iniciada_por != null ? String(r.iniciada_por) : '',
    startedById:     r.iniciada_por_id != null ? String(r.iniciada_por_id) : '',
    finishedBy:      r.finalizada_por != null ? String(r.finalizada_por) : '',
    startedAt:       r.fecha_inicio != null ? String(r.fecha_inicio) : '',
    finishedAt:      r.fecha_fin != null ? String(r.fecha_fin) : '',
    motivoAnulacion: r.motivo_anulacion != null ? String(r.motivo_anulacion) : '',
  };
}

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let supa;
  try { supa = getSupabaseAdmin(); }
  catch (e: any) {
    console.error('[limpiezas-rutina]', e?.message ?? e);
    return res.status(req.method === 'GET' ? 200 : 503).json(req.method === 'GET' ? { rutinas: [] } : { error: 'Supabase no configurado' });
  }

  // ── GET — reporte del día (todas las del día por fecha_inicio, día AR) ─────
  if (req.method === 'GET' && String(req.query?.report ?? '') === '1') {
    try {
      const date = isDate(req.query?.date) ? String(req.query.date) : hoyAR();
      const { data, error } = await supa.from('limpiezas_rutina').select('*')
        .eq('entorno', ENTORNO)
        .gte('fecha_inicio', `${date}T00:00:00-03:00`)
        .lte('fecha_inicio', `${date}T23:59:59-03:00`)
        .order('fecha_inicio', { ascending: false }).limit(2000);
      if (error) { console.error('[limpiezas-rutina] report failed:', error.message); return res.status(200).json({ rutinas: [] }); }
      return res.status(200).json({ rutinas: (data ?? []).map(rowToRutina), date });
    } catch (err: any) {
      console.error('[limpiezas-rutina] report error:', err);
      return res.status(200).json({ rutinas: [] });
    }
  }

  // ── GET — rondas de un paciente (journey) ─────────────────────────────────
  if (req.method === 'GET' && String(req.query?.paciente ?? '') !== '') {
    try {
      const { data, error } = await supa.from('limpiezas_rutina').select('*')
        .eq('entorno', ENTORNO).eq('paciente_codigo', String(req.query.paciente))
        .order('fecha_inicio', { ascending: true }).limit(500);
      if (error) { console.error('[limpiezas-rutina] paciente failed:', error.message); return res.status(200).json({ rutinas: [] }); }
      return res.status(200).json({ rutinas: (data ?? []).map(rowToRutina) });
    } catch (err: any) {
      console.error('[limpiezas-rutina] paciente error:', err);
      return res.status(200).json({ rutinas: [] });
    }
  }

  // ── GET — rutinas ABIERTAS (overlay del mapa) ─────────────────────────────
  if (req.method === 'GET') {
    try {
      const { data, error } = await supa.from('limpiezas_rutina').select('*')
        .eq('entorno', ENTORNO).eq('estado', 'INICIADA').limit(500);
      if (error) { console.error('[limpiezas-rutina] GET failed:', error.message); return res.status(200).json({ rutinas: [] }); }
      return res.status(200).json({ rutinas: (data ?? []).map(rowToRutina) });
    } catch (err: any) {
      console.error('[limpiezas-rutina] GET error:', err);
      return res.status(200).json({ rutinas: [] });
    }
  }

  // ── POST — INICIAR (nace INICIADA; idempotente por cama) ──────────────────
  if (req.method === 'POST') {
    const { bedLabel, bedCode, roomCode, area, patientCode, patientName, userId, userName, operador } = req.body ?? {};
    if (!String(bedLabel ?? '').trim()) return res.status(400).json({ error: 'bedLabel is required' });

    try {
      const { data: created, error } = await supa.from('limpiezas_rutina').insert({
        entorno: ENTORNO,
        cama_label: String(bedLabel),
        cama_codigo: bedCode != null ? String(bedCode) : null,
        habitacion: roomCode != null ? String(roomCode) : null,
        area: area != null ? String(area) : null,
        paciente_codigo: patientCode != null ? String(patientCode) : null,
        paciente_nombre: patientName != null ? String(patientName) : null,
        estado: 'INICIADA',
        iniciada_por_id: userId != null ? String(userId) : null,
        iniciada_por: userName != null ? String(userName) : null,
        operador: operador != null ? String(operador) : null,
        version: String(req.body?.version ?? ''),
      }).select('*').single();

      if (error) {
        // 23505 = ya hay una rutina ABIERTA para esa cama → idempotente: devolver la abierta.
        if ((error as any).code === '23505') {
          const { data: viva } = await supa.from('limpiezas_rutina').select('*')
            .eq('entorno', ENTORNO).eq('cama_label', String(bedLabel)).eq('estado', 'INICIADA').limit(1);
          if (viva?.length) return res.status(200).json({ ok: true, rutina: rowToRutina(viva[0]) });
        }
        console.error('[limpiezas-rutina] POST failed:', error.message);
        return res.status(500).json({ error: 'Failed to start routine cleaning' });
      }

      console.log(`[limpiezas-rutina] INICIADA en "${bedLabel}" por ${userName ?? userId}`);
      return res.status(200).json({ ok: true, rutina: rowToRutina(created) });
    } catch (err: any) {
      console.error('[limpiezas-rutina] POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH — FINALIZAR / ANULAR una rutina abierta ─────────────────────────
  if (req.method === 'PATCH') {
    const { id, bedLabel, action, motivo, userId, userName } = req.body ?? {};
    const act = String(action ?? 'FINALIZAR');
    if (act !== 'FINALIZAR' && act !== 'ANULAR') return res.status(400).json({ error: 'action must be FINALIZAR or ANULAR' });
    if (!String(id ?? '').trim() && !String(bedLabel ?? '').trim()) return res.status(400).json({ error: 'id o bedLabel requerido' });

    try {
      // Ubicar la rutina abierta (por id, o la INICIADA de esa cama).
      let q = supa.from('limpiezas_rutina').select('id, estado').eq('entorno', ENTORNO);
      q = String(id ?? '').trim() ? q.eq('id', String(id)) : q.eq('cama_label', String(bedLabel)).eq('estado', 'INICIADA');
      const { data: cur, error: readErr } = await q.limit(1).maybeSingle();
      if (readErr) { console.error('[limpiezas-rutina] PATCH read failed:', readErr.message); return res.status(500).json({ error: 'Failed to read routine' }); }
      if (!cur) return res.status(404).json({ error: 'Rutina no encontrada' });
      if (String(cur.estado) !== 'INICIADA') return res.status(409).json({ error: `La rutina no está abierta (${cur.estado})` });

      const fields: Record<string, unknown> = {
        estado: act === 'ANULAR' ? 'ANULADA' : 'FINALIZADA',
        fecha_fin: new Date().toISOString(),
        version: String(req.body?.version ?? ''),
      };
      if (act === 'FINALIZAR') {
        fields.finalizada_por_id = userId != null ? String(userId) : null;
        fields.finalizada_por = userName != null ? String(userName) : null;
      } else {
        fields.motivo_anulacion = motivo != null ? String(motivo) : null;
      }

      const { error } = await supa.from('limpiezas_rutina').update(fields).eq('id', String(cur.id)).eq('entorno', ENTORNO);
      if (error) { console.error('[limpiezas-rutina] PATCH failed:', error.message); return res.status(500).json({ error: 'Failed to update routine' }); }

      console.log(`[limpiezas-rutina] ${act} (id=${cur.id}) por ${userName ?? userId}`);
      return res.status(200).json({ ok: true, id: String(cur.id) });
    } catch (err: any) {
      console.error('[limpiezas-rutina] PATCH error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireAuth(handler);
