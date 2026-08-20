/**
 * Vercel serverless — máquina de estados de CIRUGÍA (traslados a quirófano).
 * FUENTE: Supabase public.cirugia_traslados (overlay "Cx" sobre la cama, NO un ticket de traslados).
 *
 * GET    /api/cirugia                                   → operatorias VIVAS del entorno (overlay Mapa + cola)
 * GET    /api/cirugia?history=1&from=YYYY-MM-DD&to=...  → cerradas (TOLERANCIA_EVALUADA/CANCELADO) por fecha_cierre
 * GET    /api/cirugia?paciente=<pacienteCodigo>         → todas las rondas de ese paciente (trayectoria)
 * GET    /api/cirugia?eventos=<cirugiaId>               → timeline de pasos de esa operatoria (cirugia_eventos)
 * POST   /api/cirugia                                   → alta = LISTO_PARA_CIRUGIA (la marca Enfermería)
 *                                                         idempotente por id_univoco + candado 1-viva-por-cama
 * PATCH  /api/cirugia                                   → transición de estado (máquina guardada server-side)
 *
 * Máquina de estados propia (no reusa el pipeline de traslados). Estados VIVOS = todos menos los
 * terminales (RECIBIDA/CANCELADO). El índice único parcial cirugia_viva_uidx garantiza UNA operatoria
 * viva por (entorno, cama_origen). Cada escritura estampa version + last_actor_id.
 *
 * ⚠️ Push: NO se emite en esta fase (va en F6). Sin llamadas a push-utils todavía.
 */
import { requireAuth } from './jwt.js';
import { getSupabaseAdmin } from './supabase-admin.js';
import { authzCirugia } from './cirugia-authz.js';

const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

// Estados que ocupan el candado "una viva por cama" (índice parcial cirugia_viva_uidx).
const VIVOS = ['LISTO_PARA_CIRUGIA', 'VAN_A_BUSCAR', 'EN_TRASLADO', 'EN_CIRUGIA', 'EN_DEVOLUCION'];
// Lo que se muestra en overlay + cola: las vivas + la recibida esperando la evaluación de tolerancia.
const EN_COLA = [...VIVOS, 'RECIBIDA'];

// Máquina de estados ESTRICTA: estado actual → acciones permitidas (== estado destino). Cada paso
// existe y se registra (ver cirugia_eventos) para medir tiempos. CANCELADO desde cualquier estado
// vivo; los terminales no tienen salida. Cualquier otra transición → 409.
//   LISTO_PARA_CIRUGIA (Enfermería) → VAN_A_BUSCAR (Cirugía despacha camillero)
//     → EN_TRASLADO (Enfermería: "se lo llevó el camillero") → EN_CIRUGIA (Cirugía)
//     → EN_DEVOLUCION (el paciente vuelve; YA NO se elige destino) → RECIBIDA (Enfermería destino)
//     → TOLERANCIA_EVALUADA (quien recibió evaluó la tolerancia — CIERRA el ticket)
// El destino lo detecta el cron desde PROGAL (no se elige ni se consolida en la app).
const TRANSICIONES: Record<string, string[]> = {
  LISTO_PARA_CIRUGIA:  ['VAN_A_BUSCAR', 'CANCELADO'],
  VAN_A_BUSCAR:        ['EN_TRASLADO', 'CANCELADO'],
  EN_TRASLADO:         ['EN_CIRUGIA', 'CANCELADO'],
  EN_CIRUGIA:          ['EN_DEVOLUCION', 'CANCELADO'],
  EN_DEVOLUCION:       ['RECIBIDA', 'CANCELADO'],
  RECIBIDA:            ['TOLERANCIA_EVALUADA', 'CANCELADO'],
  TOLERANCIA_EVALUADA: [],
  CANCELADO:           [],
};

// Permiso requerido por cada acción del PATCH (el alta POST exige cirugia_listo). El gating client-side
// esconde los botones, pero un PATCH directo lo saltea → se enforça acá (ver authzCirugia).
const ACCION_PERMISO: Record<string, string> = {
  VAN_A_BUSCAR:        'cirugia_buscar',
  EN_TRASLADO:         'cirugia_entregar',
  EN_CIRUGIA:          'cirugia_operar',
  EN_DEVOLUCION:       'cirugia_devolver',
  RECIBIDA:            'cirugia_recibir',
  TOLERANCIA_EVALUADA: 'cirugia_tolerancia',
  CANCELADO:           'cirugia_cancelar',
};

/** Fila Supabase (snake_case) → CirugiaTraslado (camelCase, shape lean sin columnas server-only). */
function rowToCirugia(r: any) {
  return {
    id:                 String(r.id),
    entorno:            String(r.entorno ?? ''),
    idUnivoco:          String(r.id_univoco ?? ''),
    pacienteCodigo:     r.paciente_codigo != null ? String(r.paciente_codigo) : undefined,
    pacienteNombre:     r.paciente_nombre != null ? String(r.paciente_nombre) : undefined,
    camaOrigen:         String(r.cama_origen ?? ''),
    camaDestino:        r.cama_destino != null ? String(r.cama_destino) : undefined,
    area:               r.area != null ? String(r.area) : undefined,
    tipo:               r.tipo != null ? String(r.tipo) : undefined,
    estado:             String(r.estado ?? ''),
    motivoCancelacion:  r.motivo_cancelacion != null ? String(r.motivo_cancelacion) : undefined,
    operador:           r.operador != null ? String(r.operador) : undefined,
    version:            r.version != null ? String(r.version) : undefined,
    fechaCierre:        r.fecha_cierre != null ? String(r.fecha_cierre) : undefined,
    createdAt:          String(r.created_at ?? ''),
    updatedAt:          String(r.updated_at ?? ''),
  };
}

/**
 * Registra una transición en el detalle (public.cirugia_eventos) — append-only. `tipo` = la acción/
 * estado alcanzado; `meta` lleva el contexto (camaOrigen, camaDestino, motivo, estadoResultante).
 * Best-effort a propósito: la fuente de verdad es el estado en cirugia_traslados. Si el log falla, se
 * registra el error pero NO se rompe la transición (no bloqueamos el flujo clínico por un insert de
 * auditoría). Puede dejar un hueco en las métricas de tiempo — es el trade-off aceptado.
 */
async function logEvento(supa: any, cirugiaId: string, tipo: string, body: any, meta?: Record<string, unknown>) {
  try {
    const { error } = await supa.from('cirugia_eventos').insert({
      cirugia_id: String(cirugiaId),
      entorno:    ENTORNO,
      tipo:       String(tipo),
      usuario:    body?.userName != null && body.userName !== '' ? String(body.userName) : null,
      usuario_id: body?.userId != null && body.userId !== '' ? String(body.userId) : null,
      operador:   body?.operador != null && body.operador !== '' ? String(body.operador) : null,
      meta:       meta ?? null,
      version:    String(body?.version ?? ''),
    });
    if (error) console.error('[cirugia] logEvento failed:', error.message, tipo, cirugiaId);
  } catch (e: any) {
    console.error('[cirugia] logEvento error:', e?.message ?? e, tipo, cirugiaId);
  }
}

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let supa;
  try { supa = getSupabaseAdmin(); }
  catch (e: any) {
    console.error('[cirugia]', e?.message ?? e);
    return res.status(req.method === 'GET' ? 200 : 503).json(req.method === 'GET' ? { cirugias: [] } : { error: 'Supabase no configurado' });
  }

  // ── GET — histórico (cerradas por fecha_cierre) ───────────────────────────
  if (req.method === 'GET' && String(req.query?.history ?? '') === '1') {
    try {
      const isDate = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''));
      const from = isDate(req.query?.from) ? String(req.query.from) : '';
      const to   = isDate(req.query?.to)   ? String(req.query.to)   : '';
      let q = supa.from('cirugia_traslados').select('*')
        .eq('entorno', ENTORNO).in('estado', ['TOLERANCIA_EVALUADA', 'CANCELADO']).limit(2000);
      if (from) q = q.gte('fecha_cierre', `${from}T00:00:00Z`);
      if (to)   q = q.lte('fecha_cierre', `${to}T23:59:59Z`);
      const { data, error } = await q;
      if (error) { console.error('[cirugia] history GET failed:', error.message); return res.status(200).json({ cirugias: [] }); }
      return res.status(200).json({ cirugias: (data ?? []).map(rowToCirugia) });
    } catch (err: any) {
      console.error('[cirugia] history GET error:', err);
      return res.status(200).json({ cirugias: [] });
    }
  }

  // ── GET — timeline de pasos de UNA operatoria (cirugia_eventos, append-only) ──
  if (req.method === 'GET' && String(req.query?.eventos ?? '') !== '') {
    try {
      const { data, error } = await supa.from('cirugia_eventos')
        .select('tipo, usuario, operador, meta, created_at')
        .eq('entorno', ENTORNO).eq('cirugia_id', String(req.query.eventos))
        .order('created_at', { ascending: true }).limit(200);
      if (error) { console.error('[cirugia] eventos GET failed:', error.message); return res.status(200).json({ eventos: [] }); }
      const eventos = (data ?? []).map((e: any) => ({
        tipo:     String(e.tipo ?? ''),
        usuario:  e.usuario != null ? String(e.usuario) : undefined,
        operador: e.operador != null ? String(e.operador) : undefined,
        meta:     e.meta ?? undefined,
        at:       String(e.created_at ?? ''),
      }));
      return res.status(200).json({ eventos });
    } catch (err: any) {
      console.error('[cirugia] eventos GET error:', err);
      return res.status(200).json({ eventos: [] });
    }
  }

  // ── GET — todas las rondas de un paciente (trayectoria) ───────────────────
  if (req.method === 'GET' && String(req.query?.paciente ?? '') !== '') {
    try {
      const { data, error } = await supa.from('cirugia_traslados').select('*')
        .eq('entorno', ENTORNO).eq('paciente_codigo', String(req.query.paciente)).limit(500);
      if (error) { console.error('[cirugia] paciente GET failed:', error.message); return res.status(200).json({ cirugias: [] }); }
      return res.status(200).json({ cirugias: (data ?? []).map(rowToCirugia) });
    } catch (err: any) {
      console.error('[cirugia] paciente GET error:', err);
      return res.status(200).json({ cirugias: [] });
    }
  }

  // ── GET — operatorias VIVAS del entorno (overlay Mapa + cola Cirugías) ─────
  if (req.method === 'GET') {
    try {
      const { data, error } = await supa.from('cirugia_traslados').select('*')
        .eq('entorno', ENTORNO).in('estado', EN_COLA).limit(500);
      if (error) { console.error('[cirugia] GET failed:', error.message); return res.status(200).json({ cirugias: [] }); }
      const rows = (data ?? []) as any[];
      // Timestamps por paso (cirugia_eventos) de las vivas → habilita las columnas de HORA de cada
      // paso en la grilla (Retirado / En cirugía / Recibido / …). 1 query con `in`, primera
      // ocurrencia de cada tipo = cuándo se hizo ese paso.
      const pasosById = new Map<string, Record<string, string>>();
      const ids = rows.map(r => String(r.id)).filter(Boolean);
      if (ids.length) {
        const { data: evs } = await supa.from('cirugia_eventos')
          .select('cirugia_id, tipo, created_at')
          .eq('entorno', ENTORNO).in('cirugia_id', ids)
          .order('created_at', { ascending: true }).limit(2000);
        for (const e of (evs ?? []) as any[]) {
          const cid = String(e.cirugia_id ?? ''), tipo = String(e.tipo ?? '');
          if (!cid || !tipo) continue;
          const rec = pasosById.get(cid) ?? {};
          if (!(tipo in rec)) rec[tipo] = String(e.created_at ?? '');
          pasosById.set(cid, rec);
        }
      }
      return res.status(200).json({ cirugias: rows.map(r => ({ ...rowToCirugia(r), pasos: pasosById.get(String(r.id)) ?? {} })) });
    } catch (err: any) {
      console.error('[cirugia] GET error:', err);
      return res.status(200).json({ cirugias: [] });
    }
  }

  // ── POST — alta (LISTO_PARA_CIRUGIA; la marca Enfermería de piso) ─────────
  if (req.method === 'POST') {
    const { idUnivoco, pacienteCodigo, pacienteNombre, camaOrigen, area, tipo, userId, userName } = req.body ?? {};
    if (!String(idUnivoco ?? '').trim())  return res.status(400).json({ error: 'idUnivoco is required' });
    if (!String(camaOrigen ?? '').trim()) return res.status(400).json({ error: 'camaOrigen is required' });

    const denyPost = await authzCirugia(req, 'cirugia_listo', area != null ? String(area) : null);
    if (denyPost) return res.status(denyPost.status).json({ error: denyPost.error });

    try {
      const { data: created, error } = await supa.from('cirugia_traslados').insert({
        entorno: ENTORNO,
        id_univoco: String(idUnivoco),
        paciente_codigo: pacienteCodigo != null ? String(pacienteCodigo) : null,
        paciente_nombre: pacienteNombre != null ? String(pacienteNombre) : null,
        cama_origen: String(camaOrigen),
        area: area != null ? String(area) : null,
        tipo: tipo != null ? String(tipo) : null,
        estado: 'LISTO_PARA_CIRUGIA',
        created_by_id: userId != null ? String(userId) : null,
        last_actor_id: userId != null ? String(userId) : null,
        operador: req.body?.operador != null && req.body.operador !== '' ? String(req.body.operador) : null,
        version: String(req.body?.version ?? ''),
      }).select('id').single();

      if (error) {
        // 23505 = choque contra uno de los dos índices únicos:
        //   cirugia_univoco_uidx → alta reintentada (mismo id_univoco) → devolver la existente.
        //   cirugia_viva_uidx    → ya hay una VIVA para esa cama_origen → devolver la viva.
        // En ambos casos la respuesta es idempotente (200 con el id existente), no un duplicado.
        if ((error as any).code === '23505') {
          const { data: byUniv } = await supa.from('cirugia_traslados').select('id')
            .eq('entorno', ENTORNO).eq('id_univoco', String(idUnivoco)).limit(1);
          if (byUniv?.length) return res.status(200).json({ ok: true, id: String(byUniv[0].id) });
          const { data: viva } = await supa.from('cirugia_traslados').select('id')
            .eq('entorno', ENTORNO).eq('cama_origen', String(camaOrigen)).in('estado', VIVOS).limit(1);
          if (viva?.length) return res.status(200).json({ ok: true, id: String(viva[0].id) });
        }
        console.error('[cirugia] POST failed:', error.message);
        return res.status(500).json({ error: 'Failed to create cirugia' });
      }

      // Detalle: primer evento del circuito (solo en alta genuina — los 200 idempotentes de arriba
      // son reintentos y NO deben duplicar el evento LISTO).
      await logEvento(supa, String(created.id), 'LISTO_PARA_CIRUGIA', req.body, {
        camaOrigen: String(camaOrigen), tipo: tipo != null ? String(tipo) : null,
      });
      console.log(`[cirugia] LISTO_PARA_CIRUGIA en "${camaOrigen}" por ${userName ?? userId}`);
      return res.status(200).json({ ok: true, id: String(created.id) });
    } catch (err: any) {
      console.error('[cirugia] POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH — transición de estado (máquina de estados guardada) ────────────
  if (req.method === 'PATCH') {
    const { id, action, motivoCancelacion, userId, userName } = req.body ?? {};
    if (!String(id ?? '').trim()) return res.status(400).json({ error: 'id is required' });

    const act = String(action ?? '');
    const ACCIONES = ['VAN_A_BUSCAR', 'EN_TRASLADO', 'EN_CIRUGIA', 'EN_DEVOLUCION', 'RECIBIDA', 'TOLERANCIA_EVALUADA', 'CANCELADO'];
    if (!ACCIONES.includes(act)) return res.status(400).json({ error: `action must be one of: ${ACCIONES.join(', ')}` });
    if (act === 'CANCELADO' && !String(motivoCancelacion ?? '').trim()) {
      return res.status(400).json({ error: 'motivoCancelacion is required for CANCELADO' });
    }

    try {
      // Guard: leer el estado ACTUAL antes de escribir (fuente de verdad del 409). Trae `area` para
      // la autorización por sector.
      const { data: cur, error: readErr } = await supa.from('cirugia_traslados')
        .select('estado, cama_origen, cama_destino, area').eq('id', String(id)).eq('entorno', ENTORNO).maybeSingle();
      if (readErr) { console.error('[cirugia] PATCH read failed:', readErr.message); return res.status(500).json({ error: 'Failed to read cirugia' }); }
      if (!cur) return res.status(404).json({ error: 'Cirugia not found' });

      // Autorización server-side: permiso de la acción + (si filtra por pisos) sector de la operatoria.
      const denyPatch = await authzCirugia(req, ACCION_PERMISO[act] ?? 'cirugia_cancelar', cur.area);
      if (denyPatch) return res.status(denyPatch.status).json({ error: denyPatch.error });

      const permitidas = TRANSICIONES[String(cur.estado)] ?? [];
      if (!permitidas.includes(act)) {
        return res.status(409).json({ error: `Transición inválida: ${cur.estado} → ${act}` });
      }

      const nowIso = new Date().toISOString();
      const fields: Record<string, unknown> = {
        estado: act,
        last_actor_id: userId != null ? String(userId) : null,
        version: String(req.body?.version ?? ''),
      };
      // EN_DEVOLUCION ya NO elige destino: el paciente vuelve y el cron detecta a qué cama lo movió
      // Admisión en PROGAL (graba cama_destino ahí). RECIBIDA es intermedio (no cierra). El cierre
      // lo hace TOLERANCIA_EVALUADA.
      if (act === 'TOLERANCIA_EVALUADA') {
        // Quien recibió confirmó la evaluación de tolerancia → terminal: cierra el ticket.
        fields.fecha_cierre = nowIso;
      }
      if (act === 'CANCELADO') {
        // Terminal transversal: cierra + motivo + libera la cama.
        fields.fecha_cierre = nowIso;
        fields.motivo_cancelacion = String(motivoCancelacion);
      }

      // CAS (compare-and-set): el UPDATE reafirma el estado que leímos recién. Si otra transición ganó
      // la carrera entre el read y el write (doble-tap, dos dispositivos), afecta 0 filas → 409 y NO se
      // loguea el evento (evita duplicar el paso en la auditoría y un push repetido).
      const { data: updated, error } = await supa.from('cirugia_traslados').update(fields)
        .eq('id', String(id)).eq('entorno', ENTORNO).eq('estado', String(cur.estado)).select('id');
      if (error) { console.error('[cirugia] PATCH failed:', error.message, act); return res.status(500).json({ error: 'Failed to update cirugia' }); }
      if (!updated || updated.length === 0) {
        return res.status(409).json({ error: 'La cirugía cambió de estado; recargá e intentá de nuevo.' });
      }

      // Detalle: un evento por transición. `tipo` = la acción (el click), `estadoResultante` = el
      // estado que quedó (== la acción; TOLERANCIA_EVALUADA cierra el ticket).
      const meta: Record<string, unknown> = { camaOrigen: String(cur.cama_origen), estadoResultante: fields.estado };
      if (fields.cama_destino) meta.camaDestino = fields.cama_destino;
      if (fields.motivo_cancelacion) meta.motivo = fields.motivo_cancelacion;
      await logEvento(supa, String(id), act, req.body, meta);

      console.log(`[cirugia] ${cur.estado} → ${act} (id=${id}) por ${userName ?? userId}`);
      return res.status(200).json({ ok: true });
    } catch (err: any) {
      console.error('[cirugia] PATCH error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireAuth(handler);
