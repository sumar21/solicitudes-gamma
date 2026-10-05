/**
 * Vercel serverless — HISTORIAL DE CAMBIOS DE DIETA (solo lectura).
 * FUENTE: Supabase public.dieta_cambios. Log append-only que escribe cron-enrich-beds cada vez que
 * detecta un cambio de dieta (compara el dietTags del Payload_EC anterior vs el nuevo). Guarda el
 * "de X → a Y" con paciente + piso + timestamp. Independiente de push/suscriptores → completo.
 *
 * GET /api/dieta-cambios                          → últimos cambios del entorno (default: 500)
 * GET /api/dieta-cambios?from=YYYY-MM-DD&to=...    → rango por fecha de cambio (día AR, UTC-3)
 * GET /api/dieta-cambios?paciente=<codigo>         → historial de un paciente (journey)
 *
 * Además de los cambios de dieta (`kind: 'CAMBIO'`), devuelve los "INICIAR DIETA" post cirugía
 * (`kind: 'INICIO_DIETA'`): el paso final de la operatoria (cirugia_eventos.tipo = TOLERANCIA_EVALUADA), que
 * es cuando Enfermería habilita al paciente a comer. Catering recibe ese aviso como push, pero el push se
 * pierde si el dispositivo no estaba suscripto; acá queda en el MISMO historial que los cambios de dieta,
 * que es donde Catering mira "qué cambió en la comida de quién". Sin tabla nueva: se lee de cirugia_eventos
 * + cirugia_traslados (paciente, cama, área).
 */
import { requireAuth } from './jwt.js';
import { getSupabaseAdmin } from './supabase-admin.js';

const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

const isDate = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''));

/** Fila Supabase (snake_case) → shape del cliente (camelCase). */
function rowToCambio(r: any) {
  return {
    kind:        'CAMBIO' as const,
    spItemId:    String(r.id),
    entorno:     String(r.entorno ?? ''),
    patientCode: r.paciente_codigo != null ? String(r.paciente_codigo) : '',
    patientName: r.paciente_nombre != null ? String(r.paciente_nombre) : '',
    area:        r.area != null ? String(r.area) : '',
    roomCode:    r.habitacion != null ? String(r.habitacion) : '',
    eventKey:    r.event_key != null ? String(r.event_key) : '',
    tagsPrev:    r.tags_prev != null ? String(r.tags_prev) : '',
    tagsNew:     r.tags_new != null ? String(r.tags_new) : '',
    changedAt:   r.fecha_cambio != null ? String(r.fecha_cambio) : '',
  };
}

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let supa;
  try { supa = getSupabaseAdmin(); }
  catch (e: any) { console.error('[dieta-cambios]', e?.message ?? e); return res.status(200).json({ cambios: [] }); }

  try {
    let q = supa.from('dieta_cambios').select('*').eq('entorno', ENTORNO);

    // Historial de un paciente (journey).
    if (String(req.query?.paciente ?? '') !== '') {
      q = q.eq('paciente_codigo', String(req.query.paciente));
    }
    // Rango por fecha de cambio (día AR, UTC-3).
    if (isDate(req.query?.from)) q = q.gte('fecha_cambio', `${String(req.query.from)}T00:00:00-03:00`);
    if (isDate(req.query?.to))   q = q.lte('fecha_cambio', `${String(req.query.to)}T23:59:59-03:00`);

    const { data, error } = await q.order('fecha_cambio', { ascending: false }).limit(1000);
    if (error) { console.error('[dieta-cambios] GET failed:', error.message); return res.status(200).json({ cambios: [] }); }
    const cambios: any[] = (data ?? []).map(rowToCambio);

    // ── "Iniciar dieta" post cirugía (fail-soft: si falla, se devuelven igual los cambios de dieta) ──
    try {
      let qe = supa.from('cirugia_eventos').select('id, cirugia_id, usuario, created_at')
        .eq('entorno', ENTORNO).eq('tipo', 'TOLERANCIA_EVALUADA');
      if (isDate(req.query?.from)) qe = qe.gte('created_at', `${String(req.query.from)}T00:00:00-03:00`);
      if (isDate(req.query?.to))   qe = qe.lte('created_at', `${String(req.query.to)}T23:59:59-03:00`);
      const { data: evs, error: evErr } = await qe.order('created_at', { ascending: false }).limit(500);
      if (evErr) throw new Error(evErr.message);
      const ids = [...new Set((evs ?? []).map((e: any) => String(e.cirugia_id)))];
      const byId = new Map<string, any>();
      if (ids.length) {
        const { data: cx, error: cxErr } = await supa.from('cirugia_traslados')
          .select('id, paciente_nombre, paciente_codigo, cama_origen, cama_destino, area').in('id', ids);
        if (cxErr) throw new Error(cxErr.message);
        for (const c of cx ?? []) byId.set(String(c.id), c);
      }
      const paciente = String(req.query?.paciente ?? '');
      for (const e of evs ?? []) {
        const c = byId.get(String(e.cirugia_id));
        if (paciente && String(c?.paciente_codigo ?? '') !== paciente) continue;
        cambios.push({
          kind:        'INICIO_DIETA' as const,
          spItemId:    `cx-${e.id}`,
          entorno:     ENTORNO,
          patientCode: c?.paciente_codigo != null ? String(c.paciente_codigo) : '',
          patientName: c?.paciente_nombre != null ? String(c.paciente_nombre) : '',
          area:        c?.area != null ? String(c.area) : '',
          // Cama donde quedó el paciente: la de regreso si cambió de cama, sino la de origen.
          roomCode:    String(c?.cama_destino ?? c?.cama_origen ?? ''),
          eventKey:    '',
          tagsPrev:    '',
          tagsNew:     '',
          changedAt:   String(e.created_at ?? ''),
          by:          e.usuario != null ? String(e.usuario) : '',
        });
      }
      cambios.sort((a, b) => (a.changedAt < b.changedAt ? 1 : a.changedAt > b.changedAt ? -1 : 0));
    } catch (e: any) {
      console.error('[dieta-cambios] inicio de dieta (cirugía):', e?.message ?? e);
    }
    return res.status(200).json({ cambios });
  } catch (err: any) {
    console.error('[dieta-cambios] GET error:', err);
    return res.status(200).json({ cambios: [] });
  }
}

export default requireAuth(handler);
