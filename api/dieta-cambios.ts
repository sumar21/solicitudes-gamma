/**
 * Vercel serverless — HISTORIAL DE CAMBIOS DE DIETA (solo lectura).
 * FUENTE: Supabase public.dieta_cambios. Log append-only que escribe cron-enrich-beds cada vez que
 * detecta un cambio de dieta (compara el dietTags del Payload_EC anterior vs el nuevo). Guarda el
 * "de X → a Y" con paciente + piso + timestamp. Independiente de push/suscriptores → completo.
 *
 * GET /api/dieta-cambios                          → últimos cambios del entorno (default: 500)
 * GET /api/dieta-cambios?from=YYYY-MM-DD&to=...    → rango por fecha de cambio (día AR, UTC-3)
 * GET /api/dieta-cambios?paciente=<codigo>         → historial de un paciente (journey)
 */
import { requireAuth } from './jwt.js';
import { getSupabaseAdmin } from './supabase-admin.js';

const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

const isDate = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''));

/** Fila Supabase (snake_case) → shape del cliente (camelCase). */
function rowToCambio(r: any) {
  return {
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
    return res.status(200).json({ cambios: (data ?? []).map(rowToCambio) });
  } catch (err: any) {
    console.error('[dieta-cambios] GET error:', err);
    return res.status(200).json({ cambios: [] });
  }
}

export default requireAuth(handler);
