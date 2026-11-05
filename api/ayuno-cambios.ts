/**
 * Vercel serverless — HISTORIAL DE CAMBIOS DE AYUNO (solo lectura).
 * FUENTE: Supabase public.ayuno_cambios. Log append-only que escribe cron-enrich-beds cada vez que
 * detecta un cambio de ayuno (compara el fasting del enrich anterior vs el nuevo). Guarda el
 * "antes → después" (horarios legibles o 'sin ayuno') con paciente + sector + timestamp. Espejo de
 * /api/dieta-cambios, que es donde Catering ya mira "qué cambió en la comida de quién".
 *
 * GET /api/ayuno-cambios                          → últimos cambios del entorno (hasta 1000)
 * GET /api/ayuno-cambios?from=YYYY-MM-DD&to=...    → rango por fecha de cambio (día AR, UTC-3)
 * GET /api/ayuno-cambios?paciente=<codigo>         → historial de un paciente
 *
 * No devuelve `detalle` (la frase del push): la pantalla muestra el antes y el después.
 * A diferencia de dieta-cambios, un fallo de la base es 500 (no lista vacía): la vista lo muestra con
 * reintento en vez de un "sin registros" falso (convenciones §4.6).
 */
import { requireAuth } from './jwt.js';
import { getSupabaseAdmin } from './supabase-admin.js';

const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

const isDate = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''));

/** Fila Supabase (snake_case) → shape del cliente (camelCase). */
function rowToCambio(r: any) {
  return {
    id:          String(r.id),
    patientCode: r.paciente_codigo != null ? String(r.paciente_codigo) : '',
    patientName: r.paciente_nombre != null ? String(r.paciente_nombre) : '',
    area:        r.area != null ? String(r.area) : '',
    roomCode:    r.habitacion != null ? String(r.habitacion) : '',
    eventKey:    r.event_key != null ? String(r.event_key) : '',
    prev:        r.resumen_prev != null ? String(r.resumen_prev) : '',
    next:        r.resumen_new != null ? String(r.resumen_new) : '',
    changedAt:   r.fecha_cambio != null ? String(r.fecha_cambio) : '',
  };
}

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supa = getSupabaseAdmin();
    let q = supa.from('ayuno_cambios')
      .select('id, paciente_codigo, paciente_nombre, area, habitacion, event_key, resumen_prev, resumen_new, fecha_cambio')
      .eq('entorno', ENTORNO);
    if (String(req.query?.paciente ?? '') !== '') q = q.eq('paciente_codigo', String(req.query.paciente));
    if (isDate(req.query?.from)) q = q.gte('fecha_cambio', `${String(req.query.from)}T00:00:00-03:00`);
    if (isDate(req.query?.to))   q = q.lte('fecha_cambio', `${String(req.query.to)}T23:59:59-03:00`);

    const { data, error } = await q.order('fecha_cambio', { ascending: false }).limit(1000);
    if (error) {
      console.error('[ayuno-cambios] GET failed:', error.message);
      return res.status(500).json({ error: 'No se pudieron leer los cambios de ayuno' });
    }
    return res.status(200).json({ cambios: (data ?? []).map(rowToCambio) });
  } catch (err: any) {
    console.error('[ayuno-cambios] GET error:', err?.message ?? err);
    return res.status(500).json({ error: 'No se pudieron leer los cambios de ayuno' });
  }
}

export default requireAuth(handler);
