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
 * terminales (TOLERANCIA_EVALUADA/CANCELADO). Candado POR PACIENTE (índice cirugia_viva_paciente_uidx,
 * migración 20261020140000): un paciente no puede tener dos operatorias EN CURSO ("Regreso de cirugía" no
 * cuenta); sin código de paciente, respaldo por cama. Cada escritura estampa version + last_actor_id.
 *
 * ⚠️ Push: NO se emite en esta fase (va en F6). Sin llamadas a push-utils todavía.
 */
import { requireAuth } from './jwt.js';
import { getSupabaseAdmin } from './supabase-admin.js';
import { authzCirugia } from './cirugia-authz.js';
import { cirugiaBedBusyMessage, resolveAltaChoque, type LiveCirugiaRow } from './cirugia-conflict.js';
import { ANTERIOR, pasosDesdeEventos } from './cirugia-pasos.js';

const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

// Estados VIVOS (cola + overlay). El candado por paciente cubre solo los EN CURSO (todos menos EN_DEVOLUCION).
const VIVOS = ['LISTO_PARA_CIRUGIA', 'VAN_A_BUSCAR', 'EN_TRASLADO', 'EN_CIRUGIA', 'EN_DEVOLUCION'];
// Lo que se muestra en overlay + cola: las vivas (EN_DEVOLUCION incluido, que espera "Iniciar dieta").
const EN_COLA = [...VIVOS];

// Máquina de estados ESTRICTA: estado actual → acciones permitidas (== estado destino). Cada paso
// existe y se registra (ver cirugia_eventos) para medir tiempos. CANCELADO desde cualquier estado
// vivo; los terminales no tienen salida. Cualquier otra transición → 409.
//   LISTO_PARA_CIRUGIA (Enfermería) → VAN_A_BUSCAR (Cirugía despacha camillero)
//     → EN_TRASLADO (Enfermería: "en traslado a cirugía") → EN_CIRUGIA (Cirugía)
//     → EN_DEVOLUCION ("Regreso de cirugía"; el paciente vuelve, el destino lo detecta el cron)
//     → TOLERANCIA_EVALUADA ("Iniciar dieta": Enfermería del piso recibe e inicia la dieta — CIERRA)
// El destino lo detecta el cron desde PROGAL (no se elige ni se consolida en la app).
const TRANSICIONES: Record<string, string[]> = {
  LISTO_PARA_CIRUGIA:  ['VAN_A_BUSCAR', 'CANCELADO'],
  VAN_A_BUSCAR:        ['EN_TRASLADO', 'CANCELADO'],
  EN_TRASLADO:         ['EN_CIRUGIA', 'CANCELADO'],
  EN_CIRUGIA:          ['EN_DEVOLUCION', 'CANCELADO'],
  EN_DEVOLUCION:       ['TOLERANCIA_EVALUADA', 'CANCELADO'],
  TOLERANCIA_EVALUADA: [],
  CANCELADO:           [],
};

// "Ya se operó (fuera de MediFlow)" (20/10/2026): Gamma empezó a usar el módulo con pacientes que ya
// se habían operado, y la "Q" del mapa los mostraba como pendientes. Se registra una cirugía COMPLETADA
// (TOLERANCIA_EVALUADA) con este `tipo`: así la respetan solos el gate de consentimiento, la "Q" y el
// detalle (una 2da cirugía necesita la marca de Admisión). Sin eventos (no dispara el push de "Iniciar
// dieta") y fuera del histórico/métricas. Se anula con la acción ANULAR_PREVIA.
const TIPO_PREVIA = 'PREVIA_EXTERNA';

// Permiso requerido por cada acción del PATCH (el alta POST exige cirugia_listo). El gating client-side
// esconde los botones, pero un PATCH directo lo saltea → se enforça acá (ver authzCirugia).
const ACCION_PERMISO: Record<string, string> = {
  VAN_A_BUSCAR:        'cirugia_buscar',
  EN_TRASLADO:         'cirugia_entregar',
  EN_CIRUGIA:          'cirugia_operar',
  EN_DEVOLUCION:       'cirugia_devolver',
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
    eventKey:           r.event_key != null ? String(r.event_key) : undefined,
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
        .eq('entorno', ENTORNO).in('estado', ['TOLERANCIA_EVALUADA', 'CANCELADO'])
        .or(`tipo.is.null,tipo.neq.${TIPO_PREVIA}`) // las previas no son operatorias de MediFlow (métricas)
        .limit(2000);
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
      // paso en la grilla (Retirado / En cirugía / Recibido / …). 1 query con `in`; la hora de cada paso
      // la arma pasosDesdeEventos (contempla "Volver un paso").
      const pasosById = new Map<string, Record<string, string>>();
      const ids = rows.map(r => String(r.id)).filter(Boolean);
      if (ids.length) {
        const { data: evs } = await supa.from('cirugia_eventos')
          .select('cirugia_id, tipo, meta, created_at')
          .eq('entorno', ENTORNO).in('cirugia_id', ids)
          .order('created_at', { ascending: true }).limit(2000);
        const evsById = new Map<string, any[]>();
        for (const e of (evs ?? []) as any[]) {
          const cid = String(e.cirugia_id ?? '');
          if (cid) evsById.set(cid, [...(evsById.get(cid) ?? []), e]);
        }
        for (const [cid, list] of evsById) pasosById.set(cid, pasosDesdeEventos(list));
      }
      // Cirugías COMPLETADAS ("Iniciar dieta") del último año, solo paciente + internación: con esto el
      // Mapa de Camas decide si muestra la "Q" de un quirúrgico (se oculta si ya se operó en ESTA
      // internación y no tiene consentimiento nuevo). Misma regla que el gate del POST. Best-effort.
      let completadas: { pacienteCodigo: string; eventKey?: string }[] = [];
      try {
        const desde = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
        const { data: comp } = await supa.from('cirugia_traslados').select('paciente_codigo, event_key')
          .eq('entorno', ENTORNO).eq('estado', 'TOLERANCIA_EVALUADA')
          .or(`fecha_cierre.gte.${desde},fecha_cierre.is.null`).limit(5000);
        completadas = ((comp ?? []) as any[])
          .filter(c => c.paciente_codigo != null && String(c.paciente_codigo).trim())
          .map(c => ({ pacienteCodigo: String(c.paciente_codigo).trim(), eventKey: c.event_key != null ? String(c.event_key) : undefined }));
      } catch (e: any) { console.error('[cirugia] GET completadas:', e?.message ?? e); }
      return res.status(200).json({ cirugias: rows.map(r => ({ ...rowToCirugia(r), pasos: pasosById.get(String(r.id)) ?? {} })), completadas });
    } catch (err: any) {
      console.error('[cirugia] GET error:', err);
      return res.status(200).json({ cirugias: [] });
    }
  }

  // ── POST — alta (LISTO_PARA_CIRUGIA; la marca Enfermería de piso) ─────────
  if (req.method === 'POST' && req.body?.previa === true) {
    // ── "Ya se operó (fuera de MediFlow)": cirugía previa registrada a mano (ver TIPO_PREVIA) ──
    const { pacienteCodigo, pacienteNombre, camaOrigen, area, eventKey, userId } = req.body ?? {};
    const pcode = String(pacienteCodigo ?? '').trim();
    if (!pcode) return res.status(400).json({ error: 'Falta el código de paciente.' });
    if (!String(camaOrigen ?? '').trim()) return res.status(400).json({ error: 'camaOrigen is required' });
    const deny1 = await authzCirugia(req, 'cirugia_listo', area != null ? String(area) : null);
    const deny2 = deny1 ? await authzCirugia(req, 'cirugia_marcar', area != null ? String(area) : null) : null;
    if (deny1 && deny2) return res.status(deny1.status).json({ error: deny1.error });
    const ekeyRaw = eventKey != null ? String(eventKey).trim() : '';
    const ekey = /^[A-Za-z0-9_-]{1,64}$/.test(ekeyRaw) ? ekeyRaw : null;
    try {
      // Idempotente: una sola previa por paciente + internación.
      let ya = supa.from('cirugia_traslados').select('id').eq('entorno', ENTORNO).eq('paciente_codigo', pcode)
        .eq('estado', 'TOLERANCIA_EVALUADA').eq('tipo', TIPO_PREVIA);
      ya = ekey ? ya.eq('event_key', ekey) : ya.is('event_key', null);
      const { data: existente } = await ya.limit(1);
      if (existente?.length) return res.status(200).json({ ok: true, id: String(existente[0].id) });
      const nowIso = new Date().toISOString();
      const { data: created, error } = await supa.from('cirugia_traslados').insert({
        entorno: ENTORNO,
        id_univoco: `previa:${pcode}:${ekey ?? 'sin-evento'}:${Date.now()}`,
        paciente_codigo: pcode,
        paciente_nombre: pacienteNombre != null ? String(pacienteNombre) : null,
        cama_origen: String(camaOrigen),
        area: area != null ? String(area) : null,
        tipo: TIPO_PREVIA,
        estado: 'TOLERANCIA_EVALUADA',
        event_key: ekey,
        fecha_cierre: nowIso,
        created_by_id: userId != null ? String(userId) : null,
        last_actor_id: userId != null ? String(userId) : null,
        operador: req.body?.operador != null && req.body.operador !== '' ? String(req.body.operador) : null,
        version: String(req.body?.version ?? ''),
      }).select('id').single();
      if (error) { console.error('[cirugia] POST previa failed:', error.message); return res.status(500).json({ error: 'No se pudo registrar la cirugía previa.' }); }
      console.log(`[cirugia] PREVIA registrada paciente=${pcode} evento=${ekey ?? '-'} por ${req.body?.userName ?? userId}`);
      return res.status(200).json({ ok: true, id: String(created.id) });
    } catch (err: any) {
      console.error('[cirugia] POST previa error:', err);
      return res.status(500).json({ error: 'No se pudo registrar la cirugía previa.' });
    }
  }

  if (req.method === 'POST') {
    const { idUnivoco, pacienteCodigo, pacienteNombre, camaOrigen, area, tipo, admissionTypeCode, eventKey, userId, userName } = req.body ?? {};
    if (!String(idUnivoco ?? '').trim())  return res.status(400).json({ error: 'idUnivoco is required' });
    if (!String(camaOrigen ?? '').trim()) return res.status(400).json({ error: 'camaOrigen is required' });

    const denyPost = await authzCirugia(req, 'cirugia_listo', area != null ? String(area) : null);
    if (denyPost) return res.status(denyPost.status).json({ error: denyPost.error });

    // ── Gate de consentimiento por cirugía ─────────────────────────────────────
    // Cada cirugía firma su consentimiento. Un paciente quirúrgico (Q) se auto-habilita SOLO en su 1ra
    // cirugía DE ESTA INTERNACIÓN (consentimiento del ingreso); un clínico necesita siempre la marca de
    // Admisión. De la 2da en adelante (ya tiene una COMPLETADA en la misma internación), aunque sea Q,
    // requiere la marca (nuevo consentimiento).
    //   permitido = marca ACTIVA de Admisión  ||  (es Q && SIN cirugía completada en ESTA internación)
    // Espeja el gate del cliente (BedsView) y lo hace REAL: un POST directo no lo saltea. Solo se evalúa
    // con código de paciente (marca e historial se keyean por código); sin código, fail-open.
    //
    // El alcance es la INTERNACIÓN, no la vida del paciente: el consentimiento se firma por internación.
    // Antes se miraba todo el historial sin límite de tiempo, así que alguien operado hace meses que
    // reingresaba como quirúrgico no se auto-habilitaba nunca más. Se acota por event_key
    // (`${EVE_ORIGEN}-${EVE_NUMERO}`, ver lib/utils.bedEventKey).
    // Las filas con event_key NULL (previas a la columna, o cama sin el dato) siguen contando SIEMPRE:
    // ante falta de dato nunca desbloqueamos de más.
    const pcode = pacienteCodigo != null ? String(pacienteCodigo).trim() : '';
    if (pcode) {
      const esQ = String(admissionTypeCode ?? '').trim().toUpperCase() === 'Q'
        || String(tipo ?? '').trim().toLowerCase() === 'quirúrgica';
      const ekeyRaw = eventKey != null ? String(eventKey).trim() : '';
      // El .or() de abajo interpola la clave DENTRO de la gramática de filtros de PostgREST, donde
      // la coma y los paréntesis son separadores. Sólo se acepta la forma real del EventKey
      // (`HIN-70952`); cualquier otra cosa se descarta y se cae al chequeo amplio — que es el lado
      // seguro y además evita construir un filtro roto o inyectado.
      const ekey = /^[A-Za-z0-9_-]{1,64}$/.test(ekeyRaw) ? ekeyRaw : '';
      let prevQuery = supa.from('cirugia_traslados').select('id')
        .eq('entorno', ENTORNO).eq('paciente_codigo', pcode).eq('estado', 'TOLERANCIA_EVALUADA');
      // Con EventKey: sólo cuentan las de ESTA internación + las sin dato. Sin EventKey (no vino en el
      // body, o no tiene forma válida): no podemos discriminar → se cuentan todas, como antes.
      if (ekey) prevQuery = prevQuery.or(`event_key.eq.${ekey},event_key.is.null`);
      const [{ data: marcaActiva }, { data: prevCompletada }] = await Promise.all([
        supa.from('cirugia_marcas').select('id')
          .eq('entorno', ENTORNO).eq('paciente_codigo', pcode).eq('estado', 'ACTIVA').limit(1),
        prevQuery.limit(1),
      ]);
      const permitido = !!(marcaActiva?.length) || (esQ && !(prevCompletada?.length));
      if (!permitido) {
        return res.status(403).json({
          error: 'Este paciente requiere que Admisión lo habilite para una nueva cirugía (nuevo consentimiento).',
        });
      }
    }

    try {
      const { data: created, error } = await supa.from('cirugia_traslados').insert({
        entorno: ENTORNO,
        id_univoco: String(idUnivoco),
        paciente_codigo: String(pacienteCodigo ?? '').trim() || null, // '' → null (índices por paciente)
        paciente_nombre: pacienteNombre != null ? String(pacienteNombre) : null,
        cama_origen: String(camaOrigen),
        // Internación en la que ocurre esta cirugía — acota el gate de consentimiento (ver arriba).
        event_key: eventKey != null && String(eventKey).trim() !== '' ? String(eventKey).trim() : null,
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
        //   cirugia_viva_paciente_uidx → el paciente ya tiene una EN CURSO → devolverla (idempotente).
        //   (índices viejos por cama, si siguieran) → otro paciente toma la cama → 409 con el motivo.
        if ((error as any).code === '23505') {
          const { data: byUniv } = await supa.from('cirugia_traslados').select('id')
            .eq('entorno', ENTORNO).eq('id_univoco', String(idUnivoco)).limit(1);
          if (byUniv?.length) return res.status(200).json({ ok: true, id: String(byUniv[0].id) });
          // Candidatas: las EN CURSO del mismo paciente (candado por paciente) + las vivas de esa cama
          // (índices viejos por cama, o paciente sin código).
          const COLS = 'id, paciente_codigo, paciente_nombre, estado, cama_origen, cama_destino, updated_at';
          const pcodeAlta = String(pacienteCodigo ?? '').trim();
          const [delPaciente, deLaCama] = await Promise.all([
            pcodeAlta
              ? supa.from('cirugia_traslados').select(COLS).eq('entorno', ENTORNO).eq('paciente_codigo', pcodeAlta).in('estado', VIVOS).limit(10)
              : Promise.resolve({ data: [] as any[] }),
            supa.from('cirugia_traslados').select(COLS).eq('entorno', ENTORNO).eq('cama_origen', String(camaOrigen)).in('estado', VIVOS).limit(10),
          ]);
          const vistas = new Set<string>();
          const vivas = [...(delPaciente.data ?? []), ...(deLaCama.data ?? [])].filter((r: any) => !vistas.has(r.id) && (vistas.add(r.id), true));
          // Mismo paciente con una operatoria EN CURSO → reintento (doble tap, dos dispositivos):
          // idempotente. Cualquier otro choque → 409 con el motivo. Antes se devolvía 200 con el id de la
          // viva aunque fuera de OTRO paciente y la app creía que había marcado (20/10/2026).
          const choque = resolveAltaChoque((vivas ?? []) as LiveCirugiaRow[], { pacienteCodigo, pacienteNombre });
          if (choque.kind === 'idempotente') return res.status(200).json({ ok: true, id: choque.id });
          if (choque.kind === 'conflicto') {
            console.warn(`[cirugia] alta rechazada: "${camaOrigen}" tiene viva ${choque.live.id} (${choque.live.estado}) de otro paciente`);
            return res.status(409).json({
              error: cirugiaBedBusyMessage(choque.live, String(camaOrigen)),
              conflictingCirugiaId: String(choque.live.id),
            });
          }
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
    const { id, action, motivoCancelacion, userId, userName, areaActual } = req.body ?? {};
    if (!String(id ?? '').trim()) return res.status(400).json({ error: 'id is required' });

    const act = String(action ?? '');
    const ACCIONES = ['VAN_A_BUSCAR', 'EN_TRASLADO', 'EN_CIRUGIA', 'EN_DEVOLUCION', 'TOLERANCIA_EVALUADA', 'CANCELADO', 'RETROCEDER', 'ANULAR_PREVIA'];
    if (!ACCIONES.includes(act)) return res.status(400).json({ error: `action must be one of: ${ACCIONES.join(', ')}` });
    if (act === 'CANCELADO' && !String(motivoCancelacion ?? '').trim()) {
      return res.status(400).json({ error: 'motivoCancelacion is required for CANCELADO' });
    }

    try {
      // Guard: leer el estado ACTUAL antes de escribir (fuente de verdad del 409). Trae `area` para
      // la autorización por sector.
      const { data: cur, error: readErr } = await supa.from('cirugia_traslados')
        .select('estado, cama_origen, cama_destino, area, paciente_codigo, tipo').eq('id', String(id)).eq('entorno', ENTORNO).maybeSingle();
      if (readErr) { console.error('[cirugia] PATCH read failed:', readErr.message); return res.status(500).json({ error: 'Failed to read cirugia' }); }
      if (!cur) return res.status(404).json({ error: 'Cirugia not found' });

      // Autorización server-side: permiso de la acción + (si filtra por pisos) sector. La operatoria sigue
      // al PACIENTE: vale el sector de origen O el sector donde ESTÁ hoy (PROGAL pudo moverlo: de ITR a la
      // 817 antes de "En traslado a cirugía", o del piso a UTI al volver). Antes solo valía el de origen y
      // decía "no pertenece a tus pisos" (20/10/2026). `areaActual` lo manda el cliente desde el mapa de
      // Gamma; el permiso de la acción se exige igual.
      const areasAccion = [cur.area, areaActual != null ? String(areaActual) : null];
      // RETROCEDER exige el permiso del paso que se deshace (deshacer "En traslado" = cirugia_entregar).
      // ANULAR_PREVIA: los mismos que la registran (cirugia_listo o cirugia_marcar).
      let denyPatch: { status: number; error: string } | null;
      if (act === 'ANULAR_PREVIA') {
        const d1 = await authzCirugia(req, 'cirugia_listo', areasAccion);
        denyPatch = d1 ? await authzCirugia(req, 'cirugia_marcar', areasAccion) : null;
      } else {
        const permiso = act === 'RETROCEDER' ? ACCION_PERMISO[String(cur.estado)] : ACCION_PERMISO[act];
        denyPatch = await authzCirugia(req, permiso ?? 'cirugia_cancelar', areasAccion);
      }
      if (denyPatch) return res.status(denyPatch.status).json({ error: denyPatch.error });

      let estadoNuevo = act;
      if (act === 'RETROCEDER') {
        estadoNuevo = ANTERIOR[String(cur.estado)] ?? '';
        if (!estadoNuevo) return res.status(409).json({ error: 'Este paso no tiene uno anterior al que volver.' });
      } else if (act === 'ANULAR_PREVIA') {
        if (cur.tipo !== TIPO_PREVIA || cur.estado !== 'TOLERANCIA_EVALUADA') {
          return res.status(409).json({ error: 'Solo se puede anular una cirugía previa registrada a mano.' });
        }
        estadoNuevo = 'CANCELADO';
      } else {
        const permitidas = TRANSICIONES[String(cur.estado)] ?? [];
        if (!permitidas.includes(act)) {
          return res.status(409).json({ error: `Transición inválida: ${cur.estado} → ${act}` });
        }
      }

      const nowIso = new Date().toISOString();
      const fields: Record<string, unknown> = {
        estado: estadoNuevo,
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
      if (act === 'ANULAR_PREVIA') fields.motivo_cancelacion = 'Cirugía previa anulada (registrada por error)';

      // CAS (compare-and-set): el UPDATE reafirma el estado que leímos recién. Si otra transición ganó
      // la carrera entre el read y el write (doble-tap, dos dispositivos), afecta 0 filas → 409 y NO se
      // loguea el evento (evita duplicar el paso en la auditoría y un push repetido).
      const { data: updated, error } = await supa.from('cirugia_traslados').update(fields)
        .eq('id', String(id)).eq('entorno', ENTORNO).eq('estado', String(cur.estado)).select('id');
      if (error) {
        // Volver de "Regreso de cirugía" a "En cirugía" la mete de nuevo en el candado por paciente: si ya
        // le marcaron OTRA operatoria en curso, choca con cirugia_viva_paciente_uidx.
        if ((error as any).code === '23505' && act === 'RETROCEDER') {
          return res.status(409).json({ error: 'El paciente ya tiene otra cirugía en curso; no se puede volver este paso.' });
        }
        console.error('[cirugia] PATCH failed:', error.message, act); return res.status(500).json({ error: 'Failed to update cirugia' });
      }
      if (!updated || updated.length === 0) {
        return res.status(409).json({ error: 'La cirugía cambió de estado; recargá e intentá de nuevo.' });
      }

      // ── Cierre del flag "va a cirugía" DEL LADO DEL SERVIDOR ──────────────────
      // La marca de Admisión es "por cirugía": al cerrar la operatoria tiene que apagarse, porque es
      // la mitad del gate de consentimiento del POST (permitido = marcaActiva || Q sin previa). Una
      // marca que sobrevive al cierre auto-habilita una 2da cirugía SIN consentimiento nuevo — justo
      // la validación que Enfermería usa para asegurar la firma.
      // El cliente ya lo dispara (useHospitalState, al Iniciar dieta), pero fire-and-forget: si esa
      // llamada se perdía (red caída, pestaña cerrada justo ahí) la marca quedaba ACTIVA y nadie se
      // enteraba. Acá corre DESPUÉS del CAS, así que sólo lo hace la transición que ganó la carrera.
      // Idempotente (filtra por estado ACTIVA) y best-effort: si falla no se revierte una transición
      // clínica ya commiteada — queda el log y el cierre del cliente como segunda red.
      if (act === 'TOLERANCIA_EVALUADA' && cur.paciente_codigo) {
        const { error: marcaErr } = await supa.from('cirugia_marcas').update({
          estado: 'CERRADA',
          fecha_cierre: nowIso,
          motivo_cierre: 'cirugia_finalizada',
          cerrada_por_id: userId != null ? String(userId) : null,
          cerrada_por: userName != null ? String(userName) : null,
          version: String(req.body?.version ?? ''),
        }).eq('entorno', ENTORNO).eq('paciente_codigo', String(cur.paciente_codigo)).eq('estado', 'ACTIVA');
        if (marcaErr) console.error('[cirugia] cierre de marca falló:', marcaErr.message);
      }

      // Detalle: un evento por transición. `tipo` = la acción (el click), `estadoResultante` = el
      // estado que quedó (== la acción; TOLERANCIA_EVALUADA cierra el ticket).
      const meta: Record<string, unknown> = { camaOrigen: String(cur.cama_origen), estadoResultante: fields.estado };
      if (fields.cama_destino) meta.camaDestino = fields.cama_destino;
      if (fields.motivo_cancelacion) meta.motivo = fields.motivo_cancelacion;
      // RETROCESO: evento propio (no es un paso de la lista de push de notify-change → no notifica) con
      // de/a, para medir cuántas veces se marca un paso por error.
      if (act === 'RETROCEDER') { meta.de = String(cur.estado); meta.a = estadoNuevo; }
      await logEvento(supa, String(id), act === 'RETROCEDER' ? 'RETROCESO' : act, req.body, meta);

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
