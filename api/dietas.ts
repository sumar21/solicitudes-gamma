/**
 * Vercel serverless — CRUD de COMANDAS (pedidos de comida por Nutrición).
 * FUENTE: Supabase public.comandas (migrado de la lista SP 15.CargaComandas).
 *
 * GET   /api/dietas               → comandas de HOY (ART) + pendientes de días previos
 * GET   /api/dietas?history=1&from&to → histórico por día de carga
 * POST  /api/dietas               → cargar/actualizar (upsert titular / insert acompañante)
 * PATCH /api/dietas               → cambiar estado (anular/entregar/pendiente/reubicar)
 *
 * 🔀 HÍBRIDO. Las comandas viven en Supabase, PERO el backstop server-side "titular sin dieta"
 * (409 'sin_dieta') sigue leyendo 12.EnrichCamas en SharePoint vía graphFetch — esa lista NO se
 * migró (es co-propiedad de api/beds.ts + cron-enrich-beds, que siguen en SP). Es fail-open TOTAL:
 * si el cross-read a SP falla o falta el dato, la comanda SE GUARDA igual; solo el dato CONFIRMADO
 * "sin tipo de dieta en PROGAL" bloquea. NO traducir ese bloque a Supabase.
 *
 * Modelo (calca limpiezas, extendido a comensales): una fila = una bandeja. Titular (comensal
 * 'TITULAR', orden 0) + acompañantes (orden max+1, inmutable) sobre la misma (identidad, comida,
 * día-ART). La identidad es el PACIENTE (paciente_codigo) si existe, si no la cama (cama_label):
 * así la comanda sigue al paciente cuando se traslada. `dia` e `identidad` son columnas generated
 * en Postgres (antes se derivaban en JS). Comandas NO emite push.
 */
import { graphFetch }  from './graph.js';
import { requireAuth } from './jwt.js';
import { getRoleByName } from './role-cache.js';
import { getUserAreasById } from './user-cache.js';
import { getSupabaseAdmin } from './supabase-admin.js';
import { MEAL_SLOTS_SP, mealSlotFromSp, mealSlotLabel, permitsMealSlotLoad, dietTypeFromDiets } from '../types.js';

// EnrichCamas queda en SharePoint (lectura híbrida del backstop 'sin_dieta').
const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const ENRICH_LIST_ID = '443c4ff0-bc98-43ef-a49c-7fd91cc63734'; // 12.EnrichCamas — mismo hardcodeo que api/beds.ts

const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

const esc = (s: unknown) => String(s ?? '').replace(/'/g, "''"); // OData (solo para el enrich SP)

// ── Ciclo de vida de una comanda (columna status) ───────────────────────────
//   'Activo'    → PENDIENTE (recién cargada, todavía no se entregó)
//   'Entregado' → la bandeja se entregó (check desde el panel de comandas)
//   'Inactivo'  → ANULADA (soft-delete; regla del repo: nunca se borra)
// ⚠️ 'Activo' y 'Entregado' son AMBOS estados VIVOS (VIVAS). Si el GET escondiera una entregada,
// el upsert no la encontraría y crearía un duplicado, y el "Quitar" dejaría de funcionar.
const ST_PENDIENTE = 'Activo';
const ST_ENTREGADO = 'Entregado';
const ST_ANULADA   = 'Inactivo';
const VIVAS = [ST_PENDIENTE, ST_ENTREGADO];

// Turnos válidos de `comida` — derivados del catálogo único de types.ts. NO hardcodear.
const COMIDAS = MEAL_SLOTS_SP;
const TIPOS   = ['MENU', 'OPCION', 'OTROS'];

// ── Comensales (Fase 4) ─────────────────────────────────────────────────────
// Una fila = una bandeja. El titular es el paciente; los acompañantes son filas extra sobre la
// misma (identidad, comida) del mismo día. Modelado como filas y no como campo serializado porque
// cocina lee filas planas: una fila = una bandeja es la verdad física del dominio.
const COMENSALES = ['TITULAR', 'ACOMPANANTE'];
// Backstop anti-abuso, NO una regla de negocio (no hay tope real definido).
const MAX_ACOMPANANTES = 6;

/** Comensal de una fila. Defensivo: cualquier cosa que no sea ACOMPANANTE → TITULAR. */
const comensalOf = (r: Record<string, unknown>): string =>
  String(r.comensal ?? '').trim().toUpperCase() === 'ACOMPANANTE' ? 'ACOMPANANTE' : 'TITULAR';

/** Ordinal del comensal. 0 = titular. Inmutable: nunca se renumera. */
const ordenOf = (r: Record<string, unknown>): number => {
  const n = Number(r.orden_comensal);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const isDay = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''));
/** "Hoy" en hora Argentina como 'YYYY-MM-DD' (coincide con la columna generated `dia`, UTC-3). */
const todayArtDay = (): string => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

/**
 * Permisos del rol del usuario, resueltos por el user-id del JWT (nunca por lo que mande el
 * cliente). `null` = NO se pudo determinar (sin user-id, cache caída, excepción) → el call-site
 * hace FAIL-OPEN: la UI ya esconde los turnos no autorizados, esto es defensa en profundidad.
 * Un array (incluido []) SÍ es un veredicto: [] = "rol sin permisos de carga" → se bloquea.
 */
async function userPermissions(req: any): Promise<string[] | null> {
  const userId = String(req?.user?.id ?? '');
  if (!userId) return null;
  try {
    const ua = await getUserAreasById(userId);
    if (!ua?.perfil) return null;
    const role = await getRoleByName(ua.perfil);
    return role?.permissions ?? [];
  } catch (e) {
    console.error('[dietas] userPermissions falló (fail-open):', (e as any)?.message ?? e);
    return null;
  }
}

/** Fila Supabase → payload del GET de HOY (incluye bedCode/roomCode/byId). */
function rowToMealHoy(r: any) {
  return {
    spItemId:      String(r.id),
    bedLabel:      String(r.cama_label ?? ''),
    bedCode:       String(r.cama_codigo ?? ''),
    roomCode:      String(r.habitacion ?? ''),
    area:          String(r.area ?? ''),
    patientName:   String(r.paciente_nombre ?? ''),
    patientCode:   String(r.paciente_codigo ?? ''),
    comida:        String(r.comida ?? ''),
    tipo:          String(r.tipo ?? ''),
    detalle:       String(r.detalle ?? ''),
    observaciones: String(r.observaciones ?? ''),
    by:            String(r.nutricionista_nombre ?? ''),
    byId:          r.nutricionista_id != null ? String(r.nutricionista_id) : '',
    at:            String(r.fecha_carga ?? ''),
    comensal:      comensalOf(r),
    orden:         ordenOf(r),
    status:        String(r.status ?? ST_PENDIENTE),
    closedAt:      String(r.fecha_cierre ?? ''), // hora de entrega/anulación (vacío si pendiente)
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
    console.error('[dietas]', e?.message ?? e);
    return res.status(req.method === 'GET' ? 200 : 503).json(req.method === 'GET' ? { meals: [] } : { error: 'Supabase no configurado' });
  }

  // ── GET histórico — comandas cargadas en un rango de días (por `dia` ART) ──
  if (req.method === 'GET' && String(req.query?.history ?? '') === '1') {
    const from = String(req.query?.from ?? '');
    const to   = String(req.query?.to ?? '');
    try {
      let q = supa.from('comandas').select('*').eq('entorno', ENTORNO);
      if (isDay(from)) q = q.gte('dia', from);
      if (isDay(to))   q = q.lte('dia', to);
      const { data, error } = await q.order('fecha_carga', { ascending: false }).limit(20000);
      if (error) { console.error('[dietas] GET history failed:', error.message); return res.status(200).json({ meals: [] }); }
      const meals = (data ?? []).map((r: any) => ({
        spItemId:        String(r.id),
        bedLabel:        String(r.cama_label ?? ''),
        area:            String(r.area ?? ''),
        patientName:     String(r.paciente_nombre ?? ''),
        patientCode:     String(r.paciente_codigo ?? ''),
        comida:          String(r.comida ?? ''),
        tipo:            String(r.tipo ?? ''),
        detalle:         String(r.detalle ?? ''),
        observaciones:   String(r.observaciones ?? ''),
        by:              String(r.nutricionista_nombre ?? ''),
        at:              String(r.fecha_carga ?? ''),
        status:          String(r.status ?? ''),
        closedAt:        String(r.fecha_cierre ?? ''),
        motivoAnulacion: String(r.motivo_anulacion ?? ''),
        comensal:        comensalOf(r),
        orden:           ordenOf(r),
      }));
      return res.status(200).json({ meals });
    } catch (err: any) {
      console.error('[dietas] GET history error:', err);
      return res.status(200).json({ meals: [] });
    }
  }

  // ── GET — comandas de HOY (ART) + pendientes de días previos ──────────────
  if (req.method === 'GET') {
    try {
      const { data, error } = await supa.from('comandas').select('*')
        .eq('entorno', ENTORNO).in('status', VIVAS).limit(2000);
      if (error) { console.error('[dietas] GET failed:', error.message); return res.status(200).json({ meals: [] }); }
      // Qué se muestra en "De hoy": lo cargado HOY (ART) **+ todo lo que siga PENDIENTE** de días
      // anteriores. Lo segundo no es un detalle: si una bandeja quedó sin entregar y el GET la
      // esconde al día siguiente, nadie la puede cerrar nunca. Las ENTREGADAS de días anteriores
      // sí se ocultan (ya se resolvieron, son histórico).
      const todayArt = todayArtDay();
      const visibles = (data ?? []).filter((r: any) => String(r.dia) === todayArt || r.status === ST_PENDIENTE);
      return res.status(200).json({ meals: visibles.map(rowToMealHoy) });
    } catch (err: any) {
      console.error('[dietas] GET error:', err);
      return res.status(200).json({ meals: [] });
    }
  }

  // ── POST — cargar/actualizar una comanda ──────────────────────────────────
  // TITULAR  → upsert por (identidad, comida, día).
  // ACOMPAÑANTE con spItemId → PATCH de esa fila.
  // ACOMPAÑANTE sin spItemId → INSERT (nunca upsert: ante una carrera, un upsert PISARÍA en
  //   silencio el acompañante de otro. Un INSERT deja dos filas visibles y borrables).
  if (req.method === 'POST') {
    const { bedLabel, bedCode, roomCode, area, patientName, patientCode,
            comida, tipo, detalle, observaciones, userId, userName,
            comensal, spItemId: reqItemId, eventOrigin, eventNumber } = req.body ?? {};
    if (!bedLabel) return res.status(400).json({ error: 'bedLabel is required' });
    const comidaVal = COMIDAS.includes(String(comida)) ? String(comida) : '';
    const tipoVal   = TIPOS.includes(String(tipo))     ? String(tipo)   : '';
    const comensalVal = COMENSALES.includes(String(comensal ?? 'TITULAR').toUpperCase())
      ? String(comensal ?? 'TITULAR').toUpperCase() : '';
    if (!comidaVal) return res.status(400).json({ error: `comida must be one of: ${COMIDAS.join(', ')}` });
    if (!tipoVal)   return res.status(400).json({ error: 'tipo must be MENU, OPCION or OTROS' });
    if (!comensalVal) return res.status(400).json({ error: `comensal must be one of: ${COMENSALES.join(', ')}` });

    // ── Enforcement de carga por turno ────────────────────────────────────────
    // La UI ya esconde los turnos que el rol no puede cargar, pero un permiso solo client-side es
    // decorativo. `cargar_dieta` habilita TODOS los turnos; `cargar_comanda_<turno>` habilita ése.
    // perms === null → no se pudo determinar (fail-open). Solo bloquea con veredicto real.
    const perms = await userPermissions(req);
    const slotSolicitado = mealSlotFromSp(comidaVal)!; // no-null: comidaVal ya validado
    if (perms !== null && !permitsMealSlotLoad(perms, slotSolicitado)) {
      return res.status(403).json({ error: `No tenés permiso para cargar comandas de ${mealSlotLabel(slotSolicitado)}.` });
    }

    const nowIso = new Date().toISOString();
    const obs = String(observaciones ?? '').slice(0, 500);
    const det = String(detalle ?? '').slice(0, 500);
    // Backstop server-side: una comanda "Otros" (dieta terapéutica) sin la comida escrita no tiene sentido.
    if (tipoVal === 'OTROS' && det.trim() === '') return res.status(400).json({ error: 'detalle is required for tipo OTROS' });
    // nutricionista_id es bigint nullable → un id no numérico se guarda como null (sin quirk).
    const nutriIdNum = Number(userId);
    const nutriId = String(userId ?? '').trim() !== '' && Number.isFinite(nutriIdNum) ? nutriIdNum : null;

    // ── Bloqueo "sin dieta" (backstop híbrido: LEE 12.EnrichCamas en SharePoint) ──
    // La comanda del TITULAR exige dieta cargada en PROGAL (Payload_EC, precomputado por
    // cron-enrich-beds cada 15 min). Una query extra POR GUARDADO DE TITULAR (los acompañantes no
    // la pagan). Fail-open deliberado en TODO lo dudoso: castiga el dato CONFIRMADO "sin dieta",
    // nunca su ausencia. 🔀 Este bloque queda en SharePoint (EnrichCamas no migró).
    if (comensalVal === 'TITULAR' && String(patientCode ?? '').trim() !== '' && SITE_ID && ENRICH_LIST_ID) {
      try {
        const efilter = encodeURIComponent(
          `fields/PatientCode_EC eq '${esc(patientCode)}' and fields/Status_EC eq 'Activo' and fields/Entorno_EC eq '${ENTORNO}'`,
        );
        const er = await graphFetch(
          `/sites/${SITE_ID}/lists/${ENRICH_LIST_ID}/items?$expand=fields&$filter=${efilter}&$top=5`,
          { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
        );
        if (er.ok) {
          const enrichRows = ((await er.json()) as { value: any[] }).value ?? [];
          // Elegir la MISMA fila que la UI: por EventKey (eventOrigin-eventNumber) cuando el
          // cliente lo mandó; si no, la más reciente por UpdatedAt (retrocompat).
          const eventKey = `${String(eventOrigin ?? '').trim()}-${String(eventNumber ?? '').trim()}`;
          const byEvent = String(eventOrigin ?? '').trim() !== ''
            ? enrichRows.find(r => String(r?.fields?.EventKey_EC ?? '').trim() === eventKey)
            : undefined;
          const latest = byEvent ?? enrichRows.sort((a, b) =>
            String(b?.fields?.UpdatedAt_EC ?? '').localeCompare(String(a?.fields?.UpdatedAt_EC ?? '')))[0];
          if (latest) {
            const payload = JSON.parse(String(latest.fields?.Payload_EC ?? 'null')) as
              { diets?: { descripcion: string; respuesta: string }[] } | null;
            if (payload && dietTypeFromDiets(payload.diets) === undefined) {
              return res.status(409).json({
                error: 'sin_dieta',
                message: 'El paciente no tiene dieta cargada en PROGAL. No se puede cargar su comanda hasta que la dieta esté cargada.',
              });
            }
          }
        }
      } catch { /* fail-open: sin señal confiable no se bloquea */ }
    }

    try {
      // Traemos TODAS las filas vivas de esta identidad+comida (titular + acompañantes) y
      // elegimos en JS. La identidad es el PACIENTE si hay código (la comanda lo sigue al
      // trasladarse), con fallback a la cama para camas sin código (enrich ausente).
      let lookup = supa.from('comandas').select('*')
        .eq('entorno', ENTORNO).eq('comida', comidaVal).in('status', VIVAS);
      lookup = String(patientCode ?? '').trim() !== ''
        ? lookup.eq('paciente_codigo', String(patientCode))
        : lookup.eq('cama_label', String(bedLabel));
      const { data: allRows, error: lookupErr } = await lookup.limit(50);
      // Si el lookup falla NO caemos al INSERT: crearía una fila duplicada activa. Mejor un error
      // que el usuario ve y reintenta.
      if (lookupErr) {
        console.error('[dietas] POST lookup failed:', lookupErr.message);
        return res.status(500).json({ error: 'No se pudo validar contra la base. Reintentá.' });
      }
      const rowsAll = allRows ?? [];

      // El lookup trae vivas de cualquier día. Las decisiones de bloqueo miran SOLO lo de hoy; una
      // fila vieja PENDIENTE se reusa reseteándole el estado a pendiente (es de otro día).
      const hoyArt = todayArtDay();
      const esDeHoy = (r: any) => String(r?.dia) === hoyArt;
      const estaPendiente = (r: any) => String(r?.status ?? '') === ST_PENDIENTE;
      const bloqueadaPorEntrega = (r: any) => String(r?.status ?? '') === ST_ENTREGADO;

      // Candidatas al upsert: las de HOY + las de días previos que siguen PENDIENTES (mismo pedido
      // sin cumplir). Las ENTREGADAS de días anteriores quedan afuera (histórico).
      const rows = rowsAll.filter((r: any) => esDeHoy(r) || estaPendiente(r));

      const patchFields: Record<string, unknown> = {
        tipo: tipoVal, detalle: det, observaciones: obs,
        paciente_nombre: String(patientName ?? ''), paciente_codigo: String(patientCode ?? ''),
        nutricionista_nombre: String(userName ?? ''),
        // Solo se pisa si el request trae un id numérico; si no, se OMITE (un UPDATE sin la clave no
        // toca la columna) y se preserva el nutricionista_id previo — igual que el `...nutriIdField`
        // del original en SharePoint. En el INSERT sí va (nace null si no hay id).
        ...(nutriId != null ? { nutricionista_id: nutriId } : {}),
        version: String(req.body?.version ?? ''),
        // Al re-guardar, la comanda se "muda" a la cama ACTUAL del paciente (si se trasladó) y
        // fecha_carga=now() recomputa la columna `dia` a hoy (clave para reusar una pendiente vieja).
        fecha_carga: nowIso,
        cama_label: String(bedLabel), cama_codigo: String(bedCode ?? ''),
        habitacion: String(roomCode ?? ''), area: String(area ?? ''),
      };
      // Al reusar una fila de otro día, la comanda es NUEVA → vuelve a PENDIENTE.
      const patchFieldsReuso = { ...patchFields, status: ST_PENDIENTE };

      // ── RAMA A — editar una fila concreta (acompañante existente) ─────────
      if (reqItemId) {
        // Se resuelve DESDE ESTE resultset, no se PATCHea un id arbitrario del cliente.
        const target = rowsAll.find((r: any) => String(r.id) === String(reqItemId));
        if (!target) return res.status(409).json({ error: 'Esa comanda ya no existe o fue eliminada por otro usuario.' });
        // Solo bloquea si la entrega es de HOY.
        if (esDeHoy(target) && bloqueadaPorEntrega(target)) {
          return res.status(409).json({ error: 'comanda_entregada', message: 'La comanda ya fue entregada. Volvela a pendiente desde el panel de comandas para poder editarla.' });
        }
        // comensal / orden_comensal son la IDENTIDAD de la fila: nunca se tocan en un update.
        const { error } = await supa.from('comandas').update(esDeHoy(target) ? patchFields : patchFieldsReuso).eq('id', target.id);
        if (error) { console.error('[dietas] POST rama A failed:', error.message); return res.status(500).json({ error: 'Failed to save meal load' }); }
        return res.status(200).json({ ok: true, spItemId: String(target.id), comensal: comensalOf(target), orden: ordenOf(target) });
      }

      // ── RAMA B — titular: upsert ──────────────────────────────────────────
      if (comensalVal === 'TITULAR') {
        const titular = rows.find((r: any) => comensalOf(r) === 'TITULAR');
        if (titular) {
          if (bloqueadaPorEntrega(titular)) {
            return res.status(409).json({ error: 'comanda_entregada', message: 'La comanda ya fue entregada. Volvela a pendiente desde el panel de comandas para poder editarla.' });
          }
          const { error } = await supa.from('comandas').update(patchFields).eq('id', titular.id);
          if (error) { console.error('[dietas] POST rama B failed:', error.message); return res.status(500).json({ error: 'Failed to save meal load' }); }
          return res.status(200).json({ ok: true, spItemId: String(titular.id), comensal: 'TITULAR', orden: 0 });
        }
        // no existe → cae al INSERT de abajo
      }

      // ── RAMA C — acompañante nuevo: INSERT, nunca upsert ──────────────────
      let ordenVal = 0;
      if (comensalVal === 'ACOMPANANTE') {
        const acomps = rows.filter((r: any) => comensalOf(r) === 'ACOMPANANTE');
        if (acomps.length >= MAX_ACOMPANANTES) {
          return res.status(400).json({ error: `No se pueden cargar más de ${MAX_ACOMPANANTES} acompañantes por turno.` });
        }
        // El ordinal es identidad, no posición: max+1 y NUNCA se renumera al borrar.
        ordenVal = Math.max(0, ...acomps.map((r: any) => ordenOf(r))) + 1;
      }

      const insertRow = {
        entorno: ENTORNO,
        cama_label: String(bedLabel), cama_codigo: String(bedCode ?? ''),
        habitacion: String(roomCode ?? ''), area: String(area ?? ''),
        paciente_nombre: String(patientName ?? ''), paciente_codigo: String(patientCode ?? ''),
        comida: comidaVal, tipo: tipoVal, detalle: det, observaciones: obs,
        status: ST_PENDIENTE, // nace pendiente de entrega
        nutricionista_nombre: String(userName ?? ''), nutricionista_id: nutriId,
        fecha_carga: nowIso,
        comensal: comensalVal, orden_comensal: ordenVal,
        version: String(req.body?.version ?? ''),
      };
      const { data: created, error: insErr } = await supa.from('comandas').insert(insertRow).select('id').single();
      if (insErr) {
        // 23505 solo puede venir del índice único parcial del TITULAR (carrera: otro request creó
        // el titular vivo entre el lookup y el insert). Re-buscamos y lo reusamos (como limpiezas).
        if (comensalVal === 'TITULAR' && (insErr as any).code === '23505') {
          let rq = supa.from('comandas').select('*')
            .eq('entorno', ENTORNO).eq('comida', comidaVal).in('status', VIVAS).eq('comensal', 'TITULAR');
          rq = String(patientCode ?? '').trim() !== '' ? rq.eq('paciente_codigo', String(patientCode)) : rq.eq('cama_label', String(bedLabel));
          const { data: raced } = await rq.limit(5);
          const t = (raced ?? []).find((r: any) => String(r.dia) === hoyArt) ?? (raced ?? [])[0];
          if (t) {
            if (bloqueadaPorEntrega(t)) return res.status(409).json({ error: 'comanda_entregada', message: 'La comanda ya fue entregada. Volvela a pendiente desde el panel de comandas para poder editarla.' });
            await supa.from('comandas').update(patchFields).eq('id', t.id);
            return res.status(200).json({ ok: true, spItemId: String(t.id), comensal: 'TITULAR', orden: 0 });
          }
        }
        console.error('[dietas] POST insert failed:', insErr.message);
        return res.status(500).json({ error: 'Failed to save meal load' });
      }
      console.log(`[dietas] ${comidaVal} "${tipoVal}" (${comensalVal}${ordenVal ? ` #${ordenVal}` : ''}) cargado en "${bedLabel}" por ${userName ?? userId}`);
      // Devolvemos `orden` porque lo asigna el SERVER: el cliente arma la fila optimista sin refetch.
      return res.status(200).json({ ok: true, spItemId: String(created.id), comensal: comensalVal, orden: ordenVal });
    } catch (err: any) {
      console.error('[dietas] POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH — cambiar el estado de una comanda ──────────────────────────────
  //   action 'anular' (default) → Inactivo (soft-delete)
  //   action 'entregar'         → Entregado
  //   action 'pendiente'        → Activo (deshacer un check)
  //   action 'reubicar'         → mudar las pendientes del paciente a su cama nueva
  if (req.method === 'PATCH') {
    const { spItemId, bedLabel, comida, action, motivo } = req.body ?? {};
    const nowIso = new Date().toISOString();

    // ── action 'reubicar' — el traslado del paciente se confirmó ────────────
    // Las bandejas PENDIENTES del paciente (todos los turnos, titular y acompañantes) se mudan a
    // su cama nueva, así Gestión de Comandas y el PDF muestran la habitación de entrega real. Las
    // Entregadas/Anuladas no se tocan. Idempotente.
    if (String(action ?? '') === 'reubicar') {
      const { patientCode, bedCode, roomCode, area } = req.body ?? {};
      if (!String(patientCode ?? '').trim()) return res.status(400).json({ error: 'patientCode is required' });
      if (!bedLabel) return res.status(400).json({ error: 'bedLabel (cama destino) is required' });
      try {
        const { data: rows, error } = await supa.from('comandas').select('id, cama_label')
          .eq('entorno', ENTORNO).eq('paciente_codigo', String(patientCode)).eq('status', ST_PENDIENTE).limit(50);
        if (error) { console.error('[dietas] reubicar lookup failed:', error.message); return res.status(502).json({ error: 'No se pudo consultar las comandas del paciente.' }); }
        const aMigrar = (rows ?? []).filter((r: any) => String(r.cama_label ?? '') !== String(bedLabel));
        if (aMigrar.length > 0) {
          const ids = aMigrar.map((r: any) => r.id);
          const { error: upErr } = await supa.from('comandas').update({
            cama_label: String(bedLabel), cama_codigo: String(bedCode ?? ''),
            habitacion: String(roomCode ?? ''), area: String(area ?? ''),
            version: String(req.body?.version ?? ''),
          }).in('id', ids);
          if (upErr) { console.error('[dietas] reubicar update failed:', upErr.message); return res.status(500).json({ error: upErr.message }); }
          console.log(`[dietas] reubicar: ${aMigrar.length} bandeja(s) pendiente(s) del paciente movida(s) a "${bedLabel}"`);
        }
        return res.status(200).json({ ok: true, migradas: aMigrar.length, pendientes: (rows ?? []).length });
      } catch (err: any) {
        console.error('[dietas] reubicar error:', err);
        return res.status(500).json({ error: err.message });
      }
    }

    // El motivo de anulación va en su propia columna (no en observaciones). Se escribe SOLO al
    // anular; al volver a pendiente se limpia.
    const motivoAnul = String(motivo ?? '').slice(0, 500);
    const ACTIONS: Record<string, Record<string, unknown>> = {
      anular:    { status: ST_ANULADA,   fecha_cierre: nowIso, motivo_anulacion: motivoAnul },
      entregar:  { status: ST_ENTREGADO, fecha_cierre: nowIso },
      pendiente: { status: ST_PENDIENTE, fecha_cierre: null, motivo_anulacion: '' },
    };
    const act = String(action ?? 'anular');
    const fields = ACTIONS[act];
    if (!fields) return res.status(400).json({ error: `action must be one of: ${Object.keys(ACTIONS).join(', ')}` });

    try {
      // Con spItemId se da de baja ESA fila (botón de eliminar de un acompañante). Sin él, se
      // resuelve por (cama, comida) → SIEMPRE el TITULAR (nunca un acompañante).
      let itemId = spItemId ? String(spItemId) : '';
      if (!itemId) {
        const comidaVal = COMIDAS.includes(String(comida)) ? String(comida) : '';
        if (!bedLabel || !comidaVal) return res.status(400).json({ error: 'spItemId or (bedLabel + comida) required' });
        const { data } = await supa.from('comandas').select('id')
          .eq('entorno', ENTORNO).eq('cama_label', String(bedLabel)).eq('comida', comidaVal)
          .in('status', VIVAS).eq('comensal', 'TITULAR').limit(1);
        if (data?.length) itemId = String(data[0].id);
      }
      if (!itemId) return res.status(200).json({ ok: true, message: 'No active meal load found' });

      // Un plato ENTREGADO está congelado: no se puede anular directo — hay que volverlo a
      // pendiente primero (paso explícito y auditable). `pendiente` (deshacer) sí se permite.
      if (act === 'anular') {
        const { data: cur } = await supa.from('comandas').select('status').eq('id', itemId).maybeSingle();
        if (cur && String(cur.status) === ST_ENTREGADO) {
          return res.status(409).json({
            error: 'comanda_entregada',
            message: 'La comanda ya fue entregada. Volvela a pendiente desde el panel de Comandas para poder anularla.',
          });
        }
      }

      const { error } = await supa.from('comandas').update({ ...fields, version: String(req.body?.version ?? '') }).eq('id', itemId);
      if (error) { console.error('[dietas] PATCH failed:', error.message, act); return res.status(500).json({ error: 'No se pudo actualizar la comanda.' }); }
      return res.status(200).json({ ok: true, spItemId: itemId, status: fields.status });
    } catch (err: any) {
      console.error('[dietas] PATCH error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireAuth(handler);
