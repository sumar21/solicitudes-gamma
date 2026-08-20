/**
 * Vercel serverless — CIRUGÍA · MARCA "VA A CIRUGÍA" (pacientes SIN internación quirúrgica).
 * FUENTE: Supabase public.cirugia_marcas. Es un overlay/flag keyed por PACIENTE (no por cama): sigue
 * al paciente aunque un traslado normal lo mueva de cama antes de operarse. NO es una operatoria
 * (public.cirugia_traslados queda intacta) — sólo habilita el botón "Listo para cirugía" para camas
 * no quirúrgicas. Admisión prende el flag; se cierra solo cuando la cirugía cierra (Iniciar dieta).
 *
 * GET   /api/cirugia-marcas                     → marcas ACTIVAS del entorno → overlay del mapa
 * GET   /api/cirugia-marcas?paciente=<codigo>   → todas las marcas de ese paciente (journey/histórico)
 * POST  /api/cirugia-marcas                     → MARCAR (nace ACTIVA); idempotente por (entorno, paciente)
 * PATCH /api/cirugia-marcas                     → CERRAR (auto al Iniciar dieta) / ANULAR (Admisión desmarca)
 *
 * Sin push en esta fase (paridad con api/cirugia.ts). Cada escritura estampa version.
 */
import { requireAuth } from './jwt.js';
import { getSupabaseAdmin } from './supabase-admin.js';
import { authzCirugia } from './cirugia-authz.js';

const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

/** Fila Supabase (snake_case) → shape del cliente (camelCase). */
function rowToMarca(r: any) {
  return {
    spItemId:    String(r.id),
    entorno:     String(r.entorno ?? ''),
    patientCode: r.paciente_codigo != null ? String(r.paciente_codigo) : '',
    patientName: r.paciente_nombre != null ? String(r.paciente_nombre) : '',
    bedLabel:    r.cama_label != null ? String(r.cama_label) : '',
    area:        r.area != null ? String(r.area) : '',
    estado:      String(r.estado ?? ''),
    markedBy:    r.marcada_por != null ? String(r.marcada_por) : '',
    markedById:  r.marcada_por_id != null ? String(r.marcada_por_id) : '',
    closedBy:    r.cerrada_por != null ? String(r.cerrada_por) : '',
    operador:    r.operador != null ? String(r.operador) : '',
    motivoCierre: r.motivo_cierre != null ? String(r.motivo_cierre) : '',
    markedAt:    r.fecha_marca != null ? String(r.fecha_marca) : '',
    closedAt:    r.fecha_cierre != null ? String(r.fecha_cierre) : '',
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
    console.error('[cirugia-marcas]', e?.message ?? e);
    return res.status(req.method === 'GET' ? 200 : 503).json(req.method === 'GET' ? { marcas: [] } : { error: 'Supabase no configurado' });
  }

  // ── GET — marcas de un paciente (journey / histórico) ─────────────────────
  if (req.method === 'GET' && String(req.query?.paciente ?? '') !== '') {
    try {
      const { data, error } = await supa.from('cirugia_marcas').select('*')
        .eq('entorno', ENTORNO).eq('paciente_codigo', String(req.query.paciente))
        .order('fecha_marca', { ascending: true }).limit(500);
      if (error) { console.error('[cirugia-marcas] paciente failed:', error.message); return res.status(200).json({ marcas: [] }); }
      return res.status(200).json({ marcas: (data ?? []).map(rowToMarca) });
    } catch (err: any) {
      console.error('[cirugia-marcas] paciente error:', err);
      return res.status(200).json({ marcas: [] });
    }
  }

  // ── GET — marcas ACTIVAS (overlay del mapa) ───────────────────────────────
  if (req.method === 'GET') {
    try {
      const { data, error } = await supa.from('cirugia_marcas').select('*')
        .eq('entorno', ENTORNO).eq('estado', 'ACTIVA').limit(500);
      if (error) { console.error('[cirugia-marcas] GET failed:', error.message); return res.status(200).json({ marcas: [] }); }
      return res.status(200).json({ marcas: (data ?? []).map(rowToMarca) });
    } catch (err: any) {
      console.error('[cirugia-marcas] GET error:', err);
      return res.status(200).json({ marcas: [] });
    }
  }

  // ── POST — MARCAR (nace ACTIVA; idempotente por paciente) ─────────────────
  if (req.method === 'POST') {
    const { pacienteCodigo, pacienteNombre, camaLabel, area, userId, userName, operador } = req.body ?? {};
    if (!String(pacienteCodigo ?? '').trim()) return res.status(400).json({ error: 'pacienteCodigo is required' });

    const denyMarcar = await authzCirugia(req, 'cirugia_marcar', area != null ? String(area) : null);
    if (denyMarcar) return res.status(denyMarcar.status).json({ error: denyMarcar.error });

    try {
      const { data: created, error } = await supa.from('cirugia_marcas').insert({
        entorno: ENTORNO,
        paciente_codigo: String(pacienteCodigo),
        paciente_nombre: pacienteNombre != null ? String(pacienteNombre) : null,
        cama_label: camaLabel != null ? String(camaLabel) : null,
        area: area != null ? String(area) : null,
        estado: 'ACTIVA',
        marcada_por_id: userId != null ? String(userId) : null,
        marcada_por: userName != null ? String(userName) : null,
        operador: operador != null ? String(operador) : null,
        version: String(req.body?.version ?? ''),
      }).select('*').single();

      if (error) {
        // 23505 = ya hay una marca ACTIVA para ese paciente → idempotente: devolver la viva.
        if ((error as any).code === '23505') {
          const { data: viva } = await supa.from('cirugia_marcas').select('*')
            .eq('entorno', ENTORNO).eq('paciente_codigo', String(pacienteCodigo)).eq('estado', 'ACTIVA').limit(1);
          if (viva?.length) return res.status(200).json({ ok: true, marca: rowToMarca(viva[0]) });
        }
        console.error('[cirugia-marcas] POST failed:', error.message);
        return res.status(500).json({ error: 'Failed to mark surgery' });
      }

      console.log(`[cirugia-marcas] ACTIVA paciente="${pacienteCodigo}" por ${userName ?? userId}`);
      return res.status(200).json({ ok: true, marca: rowToMarca(created) });
    } catch (err: any) {
      console.error('[cirugia-marcas] POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH — CERRAR (auto por RECIBIDA) / ANULAR (Admisión desmarca) ────────
  if (req.method === 'PATCH') {
    const { id, pacienteCodigo, action, motivo, userId, userName } = req.body ?? {};
    const act = String(action ?? '');
    if (act !== 'CERRAR' && act !== 'ANULAR') return res.status(400).json({ error: 'action must be CERRAR or ANULAR' });
    if (!String(id ?? '').trim() && !String(pacienteCodigo ?? '').trim()) return res.status(400).json({ error: 'id o pacienteCodigo requerido' });

    // ANULAR (Admisión desmarca "va a cirugía") requiere cirugia_marcar. CERRAR es el cierre automático
    // por RECIBIDA (lo dispara el flujo de recepción, no una acción de marcado) → sin gate propio.
    if (act === 'ANULAR') {
      const denyAnular = await authzCirugia(req, 'cirugia_marcar');
      if (denyAnular) return res.status(denyAnular.status).json({ error: denyAnular.error });
    }

    try {
      // Ubicar la marca (por id, o la ACTIVA de ese paciente).
      let q = supa.from('cirugia_marcas').select('id, estado').eq('entorno', ENTORNO);
      q = String(id ?? '').trim() ? q.eq('id', String(id)) : q.eq('paciente_codigo', String(pacienteCodigo)).eq('estado', 'ACTIVA');
      const { data: cur, error: readErr } = await q.limit(1).maybeSingle();
      if (readErr) { console.error('[cirugia-marcas] PATCH read failed:', readErr.message); return res.status(500).json({ error: 'Failed to read marca' }); }
      if (!cur) return res.status(404).json({ error: 'Marca no encontrada' });
      // Idempotente: si ya no está ACTIVA (Admisión ya desmarcó, o cierre previo), no romper.
      if (String(cur.estado) !== 'ACTIVA') return res.status(200).json({ ok: true, alreadyClosed: true, id: String(cur.id) });

      const { error } = await supa.from('cirugia_marcas').update({
        estado: act === 'ANULAR' ? 'ANULADA' : 'CERRADA',
        fecha_cierre: new Date().toISOString(),
        motivo_cierre: motivo != null && motivo !== '' ? String(motivo) : (act === 'ANULAR' ? 'admision_desmarco' : 'cirugia_recibida'),
        cerrada_por_id: userId != null ? String(userId) : null,
        cerrada_por: userName != null ? String(userName) : null,
        version: String(req.body?.version ?? ''),
      }).eq('id', String(cur.id)).eq('entorno', ENTORNO);
      if (error) { console.error('[cirugia-marcas] PATCH failed:', error.message); return res.status(500).json({ error: 'Failed to update marca' }); }

      console.log(`[cirugia-marcas] ${act} (id=${cur.id}) por ${userName ?? userId}`);
      return res.status(200).json({ ok: true, id: String(cur.id) });
    } catch (err: any) {
      console.error('[cirugia-marcas] PATCH error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireAuth(handler);
