/**
 * Vercel serverless — CRUD para "15.CargasDieta" (cargas de menú por Nutrición).
 *
 * GET   /api/dietas  → cargas activas (Status_D='Activo'). El front las agrupa por cama+comida.
 * POST  /api/dietas  → cargar/actualizar menú (upsert por cama+comida)
 *                      { bedLabel, bedCode, roomCode, area, patientName, patientCode,
 *                        comida ∈ ALMUERZO|CENA, tipo ∈ MENU|OPCION, observaciones,
 *                        userId, userName }
 * PATCH /api/dietas  → quitar una carga (soft-delete) { spItemId | (bedLabel + comida) }
 *
 * Modelo (calca 14.Limpiezas): una fila activa por (cama, comida, entorno). Menú y Opción
 * son excluyentes → se guarda uno en Tipo_D. Nutrición carga; catering + nutrición leen
 * (cualquiera con el Mapa de Camas). El front solo muestra la carga si el paciente cargado
 * coincide con el actual de la cama (evita dietas fantasma tras reasignar la cama).
 *
 * Setup: correr scripts/create-dietas-list.mts y setear DIETAS_LIST_ID (o hardcodear acá).
 */
import { graphFetch }  from './graph.js';
import { requireAuth } from './jwt.js';
import { getRoleByName } from './role-cache.js';
import { getUserAreasById } from './user-cache.js';
import { MEAL_SLOTS_SP, mealSlotFromSp, mealSlotLabel, permitsMealSlotLoad, dietTypeFromDiets } from '../types.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = (process.env.DIETAS_LIST_ID ?? '891ddeb5-3610-4a25-b6c0-512eb8e1648b').trim(); // 15.CargaComandas (hardcodeado como limpiezas)
const ENRICH_LIST_ID = '443c4ff0-bc98-43ef-a49c-7fd91cc63734'; // 12.EnrichCamas — mismo hardcodeo que api/beds.ts

const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

const esc = (s: unknown) => String(s ?? '').replace(/'/g, "''");

// ── Ciclo de vida de una comanda (Status_D) ─────────────────────────────────
// Se reusa `Status_D` (columna Texto, indexada) en vez de sumar una columna de estado:
//   'Activo'    → PENDIENTE (recién cargada, todavía no se entregó)
//   'Entregado' → la bandeja se entregó (check desde el panel de comandas)
//   'Inactivo'  → ANULADA (soft-delete; regla del repo: nunca se borra de SP)
//
// ⚠️ 'Activo' y 'Entregado' son AMBOS estados VIVOS. Todo lo que antes preguntaba
// `Status_D eq 'Activo'` tiene que preguntar por los dos, si no: la comanda entregada
// desaparecería de la tarjeta, el upsert no la encontraría y crearía un duplicado, y el
// "Quitar" dejaría de funcionar. De ahí `VIVAS_FILTER`.
const ST_PENDIENTE = 'Activo';
const ST_ENTREGADO = 'Entregado';
const ST_ANULADA   = 'Inactivo';

/** Filtro OData de "comanda viva" (pendiente o entregada). Con `or` y no `ne 'Inactivo'`:
 *  SP usa el índice con `eq`, y con `ne` puede no usarlo y chocar contra el límite de 5.000. */
const VIVAS_FILTER = `(fields/Status_D eq '${ST_PENDIENTE}' or fields/Status_D eq '${ST_ENTREGADO}')`;
// Turnos válidos de `Comida_D` — derivados del catálogo único de types.ts. NO hardcodear:
// agregar un turno allá lo habilita acá solo. Ver el comentario de MEAL_SLOTS en types.ts.
const COMIDAS = MEAL_SLOTS_SP;
const TIPOS   = ['MENU', 'OPCION', 'OTROS'];

// ── Comensales (Fase 4) ─────────────────────────────────────────────────────
// Una fila = una bandeja. El titular es el paciente; los acompañantes son filas extra sobre la
// misma (cama, comida) del mismo día. Modelado como filas y no como campo serializado porque
// cocina lee filas planas: una fila = una bandeja es la verdad física del dominio.
const COMENSALES = ['TITULAR', 'ACOMPANANTE'];
// Backstop anti-abuso, NO una regla de negocio (no hay tope real definido).
const MAX_ACOMPANANTES = 6;

/** `Comensal_D` vacío = fila anterior a Fase 4 → TITULAR. Misma retro-compat que api/isolations.ts. */
const comensalOf = (f: Record<string, unknown>): string =>
  String(f.Comensal_D ?? '').trim().toUpperCase() === 'ACOMPANANTE' ? 'ACOMPANANTE' : 'TITULAR';

/** Ordinal del comensal. 0 = titular. Inmutable: nunca se renumera (ver abajo). */
const ordenOf = (f: Record<string, unknown>): number => {
  const n = Number(String(f.OrdenComensal_D ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Día calendario en hora Argentina (ART, UTC-3). Las comandas se planifican día a día:
// el GET devuelve sólo las de hoy, así la de ayer no queda visible. 'en-CA' → 'YYYY-MM-DD'.
const ART_TZ = 'America/Argentina/Buenos_Aires';
const artDay = (iso: unknown): string => {
  const d = new Date(String(iso));
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { timeZone: ART_TZ });
};
/** "Hoy" en hora Argentina. NUNCA `toISOString().slice(0,10)` (daría el día UTC). */
const todayArtDay = (): string => new Date().toLocaleDateString('en-CA', { timeZone: ART_TZ });

/**
 * Permisos del rol del usuario, resueltos por el user-id del JWT (nunca por lo que mande el
 * cliente) → un token viejo con permisos de más no sirve: manda lo que dice SP hoy.
 * Mismo patrón (y mismas cachés) que api/carga-menu.ts — copiado a propósito: extraerlo a un
 * módulo compartido obligaría a tocar ese endpoint estable, fuera del alcance de este cambio.
 * Fail-closed: si SP/role-cache no responde devuelve [] → 403, nunca fail-open en permisos.
 */
// `null` = NO se pudo determinar (sin user-id, SP caído, excepción). El call-site hace
// FAIL-OPEN ante null: bloquear a Nutrición legítima por un hipo de SharePoint es peor que
// dejar pasar una carga de turno no autorizada (la UI ya esconde esos turnos; esto es
// defensa en profundidad, no la única barrera). Un array (incluido []) SÍ es un veredicto:
// [] significa "rol sin permisos de carga" → se bloquea.
async function userPermissions(req: any): Promise<string[] | null> {
  const userId = String(req?.user?.id ?? '');
  if (!userId) return null;
  try {
    const ua = await getUserAreasById(userId);
    // Sin ficha de usuario o sin perfil no hay veredicto confiable → fail-open.
    if (!ua?.perfil) return null;
    const role = await getRoleByName(ua.perfil);
    // Rol inexistente = veredicto real (solo lectura). Rol existente → sus permisos.
    return role?.permissions ?? [];
  } catch (e) {
    console.error('[dietas] userPermissions falló (fail-open):', (e as any)?.message ?? e);
    return null;
  }
}

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!SITE_ID) return res.status(503).json({ error: 'SHAREPOINT_SITE_ID not configured' });
  if (!LIST_ID) {
    // La lista todavía no se aprovisionó: el front trata esto como "sin cargas".
    if (req.method === 'GET') return res.status(200).json({ meals: [] });
    return res.status(503).json({ error: 'DIETAS_LIST_ID not configured — run scripts/create-dietas-list.mts' });
  }

  const basePath = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;

  // ── GET histórico — comandas cargadas en un rango de fechas (FechaCarga_D) ──
  if (req.method === 'GET' && String(req.query?.history ?? '') === '1') {
    const from = String(req.query?.from ?? '');
    const to   = String(req.query?.to ?? '');
    try {
      const filter = encodeURIComponent(`fields/Entorno_D eq '${ENTORNO}'`);
      // Paginamos siguiendo @odata.nextLink (el $top es tamaño de página, NO tope) para no
      // cortar las filas más nuevas cuando la lista crece. Sin $orderby (OData sobre DateTime
      // no-indexado es frágil): filtramos por día ART en JS abajo. MAX 20k = backstop.
      const rows: Record<string, unknown>[] = [];
      let next: string | null = `${basePath}?$expand=fields&$filter=${filter}&$top=500`;
      while (next && rows.length < 20000) {
        const page = await graphFetch(next, { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } });
        if (!page.ok) { console.error('[dietas] GET history failed:', page.status); break; }
        const pageData = (await page.json()) as { value?: Record<string, unknown>[]; '@odata.nextLink'?: string };
        for (const it of pageData.value ?? []) rows.push(it);
        const raw = pageData['@odata.nextLink'];
        next = raw ? raw.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, '') : null;
      }
      const all = rows.map((item: any) => {
        const f = item.fields as Record<string, unknown>;
        return {
          spItemId:      String(item.id),
          bedLabel:      String(f.CamaLabel_D ?? ''),
          area:          String(f.Area_D ?? ''),
          patientName:   String(f.PacienteNombre_D ?? ''),
          patientCode:   String(f.PacienteCodigo_D ?? ''),
          comida:        String(f.Comida_D ?? ''),
          tipo:          String(f.Tipo_D ?? ''),
          detalle:       String(f.Detalle_D ?? ''),
          observaciones: String(f.Observaciones_D ?? ''),
          by:            String(f.NutricionistaNombre_D ?? ''),
          at:            String(f.FechaCarga_D ?? ''),
          status:        String(f.Status_D ?? ''),
          closedAt:      String(f.FechaCierre_D ?? ''), // hora de entrega/anulación (vacío si pendiente)
          // El front del histórico ya esperaba estos dos para etiquetar "Acompañante N",
          // pero el mapping no los incluía → todas las filas decían "Paciente".
          comensal:      comensalOf(f),
          orden:         ordenOf(f),
        };
      });
      // Filtro por DÍA ART de FechaCarga en JS (el filtro OData sobre DateTime es frágil).
      const inRange = all
        .filter((m) => { const day = artDay(m.at); return day && (!from || day >= from) && (!to || day <= to); })
        .sort((a, b) => String(b.at).localeCompare(String(a.at)));
      return res.status(200).json({ meals: inRange });
    } catch (err: any) {
      console.error('[dietas] GET history error:', err);
      return res.status(200).json({ meals: [] });
    }
  }

  // ── GET — comandas de HOY (ART) ───────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const filter = encodeURIComponent(`${VIVAS_FILTER} and fields/Entorno_D eq '${ENTORNO}'`);
      const spRes = await graphFetch(
        `${basePath}?$expand=fields&$filter=${filter}&$top=1000`,
        { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
      );
      if (!spRes.ok) { console.error('[dietas] GET failed:', spRes.status); return res.status(200).json({ meals: [] }); }
      const data = (await spRes.json()) as { value: Record<string, unknown>[] };
      const meals = (data.value ?? []).map((item: any) => {
        const f = item.fields as Record<string, unknown>;
        return {
          spItemId:      String(item.id),
          bedLabel:      String(f.CamaLabel_D ?? ''),
          bedCode:       String(f.CamaCodigo_D ?? ''),
          roomCode:      String(f.Habitacion_D ?? ''),
          area:          String(f.Area_D ?? ''),
          patientName:   String(f.PacienteNombre_D ?? ''),
          patientCode:   String(f.PacienteCodigo_D ?? ''),
          comida:        String(f.Comida_D ?? ''),
          tipo:          String(f.Tipo_D ?? ''),
          detalle:       String(f.Detalle_D ?? ''),
          observaciones: String(f.Observaciones_D ?? ''),
          by:            String(f.NutricionistaNombre_D ?? ''),
          byId:          String(f.NutricionistaID_D ?? ''),
          at:            String(f.FechaCarga_D ?? ''),
          comensal:      comensalOf(f),
          orden:         ordenOf(f),
          status:        String(f.Status_D ?? ST_PENDIENTE),
          closedAt:      String(f.FechaCierre_D ?? ''), // hora de entrega/anulación (vacío si pendiente)
        };
      });
      // Qué se muestra en "De hoy": lo cargado HOY (ART) **+ todo lo que siga PENDIENTE** de
      // días anteriores.
      //
      // Lo segundo no es un detalle: si una bandeja quedó sin entregar y el GET la esconde al
      // día siguiente, nadie la puede cerrar nunca — queda pendiente para siempre en SP, sin
      // que aparezca en ningún lado. Sigue a la vista hasta que la entreguen o la anulen.
      //
      // Las ENTREGADAS de días anteriores sí se ocultan: ya se resolvieron, son histórico.
      // Filtramos en JS a propósito (el filtro OData sobre DateTime es frágil).
      const todayArt = todayArtDay();
      const visibles = meals.filter((m) => artDay(m.at) === todayArt || m.status === ST_PENDIENTE);
      return res.status(200).json({ meals: visibles });
    } catch (err: any) {
      console.error('[dietas] GET error:', err);
      return res.status(200).json({ meals: [] });
    }
  }

  // ── POST — cargar/actualizar una comanda ──────────────────────────────────
  // TITULAR  → upsert por (cama, comida, entorno), como siempre.
  // ACOMPAÑANTE con spItemId → PATCH de esa fila.
  // ACOMPAÑANTE sin spItemId → INSERT (nunca upsert: ante una carrera, un upsert PISARÍA en
  //   silencio el acompañante de otro —alguien se queda sin comer—. Un INSERT deja dos filas
  //   visibles y borrables con un click. Duplicado visible > pérdida silenciosa).
  if (req.method === 'POST') {
    const { bedLabel, bedCode, roomCode, area, patientName, patientCode,
            comida, tipo, detalle, observaciones, userId, userName,
            comensal, spItemId: reqItemId, eventOrigin, eventNumber } = req.body ?? {};
    if (!bedLabel) return res.status(400).json({ error: 'bedLabel is required' });
    const comidaVal = COMIDAS.includes(String(comida)) ? String(comida) : '';
    const tipoVal   = TIPOS.includes(String(tipo))     ? String(tipo)   : '';
    // Default TITULAR: mantiene compatible a cualquier caller viejo que no mande `comensal`.
    const comensalVal = COMENSALES.includes(String(comensal ?? 'TITULAR').toUpperCase())
      ? String(comensal ?? 'TITULAR').toUpperCase() : '';
    if (!comidaVal) return res.status(400).json({ error: `comida must be one of: ${COMIDAS.join(', ')}` });
    if (!tipoVal)   return res.status(400).json({ error: 'tipo must be MENU, OPCION or OTROS' });
    if (!comensalVal) return res.status(400).json({ error: `comensal must be one of: ${COMENSALES.join(', ')}` });

    // ── Enforcement de carga por turno ────────────────────────────────────────
    // La UI ya esconde los turnos que el rol no puede cargar, pero un permiso solo
    // client-side es decorativo: cualquiera con un token puede POSTear a mano.
    // `cargar_dieta` (histórico) habilita TODOS los turnos — los roles productivos
    // existentes pasan sin tocar una fila de SP; `cargar_comanda_<turno>` habilita solo ése.
    // Va ANTES de cualquier lectura/escritura a la lista: un 403 no deja rastro.
    const perms = await userPermissions(req);
    const slotSolicitado = mealSlotFromSp(comidaVal)!; // no-null: comidaVal ya validado contra COMIDAS
    // perms === null → no se pudo determinar (fail-open, ver userPermissions). Solo se bloquea
    // con un veredicto real de permisos que no habilita el turno.
    if (perms !== null && !permitsMealSlotLoad(perms, slotSolicitado)) {
      return res.status(403).json({ error: `No tenés permiso para cargar comandas de ${mealSlotLabel(slotSolicitado)}.` });
    }

    const nowIso = new Date().toISOString();
    const obs = String(observaciones ?? '').slice(0, 500);
    const det = String(detalle ?? '').slice(0, 500);
    // Backstop server-side de la regla de la UI: una comanda "Otros" (dieta terapéutica) sin la
    // comida escrita no tiene sentido. La tarjeta ya lo bloquea; esto respalda cualquier caller.
    if (tipoVal === 'OTROS' && det.trim() === '') return res.status(400).json({ error: 'detalle is required for tipo OTROS' });
    // NutricionistaID_D es columna Número en SP (nombre interno con ID mayúscula). El user.id
    // es el item-id de SP (numérico), así que lo escribimos como número; si no es numérico
    // (edge), omitimos el campo para no romper el POST (una columna Número rechaza strings).
    const nutriIdNum = Number(userId);
    const nutriIdField = String(userId ?? '').trim() !== '' && Number.isFinite(nutriIdNum) ? { NutricionistaID_D: nutriIdNum } : {};

    // ── Bloqueo "sin dieta" (backstop server-side del editor del mapa) ──────
    // La comanda del TITULAR exige dieta cargada en PROGAL. La dieta vive en 12.EnrichCamas
    // (Payload_EC, precomputado por cron-enrich-beds cada 15 min): una query extra POR
    // GUARDADO DE TITULAR — aceptable porque guardar es una acción manual y poco frecuente;
    // los POST de acompañante no la pagan (mandan comensal ACOMPANANTE, incluso vía RAMA A).
    // Fail-open deliberado en TODO lo dudoso (sin patientCode, sin fila enrich, SP caído,
    // payload corrupto): la regla castiga el dato CONFIRMADO "sin dieta", nunca su ausencia.
    // El bloqueo que ve el usuario está en la UI (BedsView) — esto respalda clientes
    // stale/viejos, igual que el backstop de 'OTROS' de arriba.
    if (comensalVal === 'TITULAR' && String(patientCode ?? '').trim() !== '' && ENRICH_LIST_ID) {
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
          // cliente lo mandó — así el server no rechaza una carga que la UI habilitó por mirar
          // un evento distinto. Fallback a "la más reciente por UpdatedAt" para callers viejos
          // que no mandan el evento (retrocompat).
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
      // Traemos TODAS las filas activas de este comensal+comida (titular + acompañantes) y
      // elegimos en JS. $top=50 alcanza: 1 titular + hasta MAX_ACOMPANANTES por comida.
      //
      // LA COMANDA SIGUE AL PACIENTE: si hay patientCode, la identidad del upsert es el
      // PACIENTE, no la cama. Antes se resolvía por CamaLabel_D y eso partía la comanda en
      // dos cuando el paciente se trasladaba: la fila vieja quedaba viva en la cama anterior
      // y una edición desde la cama nueva creaba un DUPLICADO (dos bandejas para la misma
      // persona). Resolviendo por paciente, la edición encuentra su fila esté donde esté, y
      // patchFields la migra a la cama actual. El fallback por cama queda para camas sin
      // código de paciente (enrich ausente) — mismo comportamiento de siempre.
      const identityClause = String(patientCode ?? '').trim() !== ''
        ? `fields/PacienteCodigo_D eq '${esc(patientCode)}'`
        : `fields/CamaLabel_D eq '${esc(bedLabel)}'`;
      const filter = encodeURIComponent(
        `${identityClause} and fields/Comida_D eq '${comidaVal}' and ${VIVAS_FILTER} and fields/Entorno_D eq '${ENTORNO}'`,
      );
      const existing = await graphFetch(
        `${basePath}?$expand=fields&$filter=${filter}&$top=50`,
        { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
      );
      // Si el lookup falla NO caemos al INSERT: crearía una fila duplicada activa que el front
      // enmascara con last-one-wins. Mejor un error que el usuario ve y reintenta.
      if (!existing.ok) {
        console.error('[dietas] POST lookup failed:', existing.status);
        return res.status(500).json({ error: 'No se pudo validar contra SharePoint. Reintentá.' });
      }
      const allRows = ((await existing.json()) as { value: any[] }).value ?? [];

      // ⚠️ El lookup NO filtra por día (no hay columna de día; el "día" se deriva de
      // FechaCarga_D — ver GET de hoy). Sin acotar acá, una fila de un día ANTERIOR entra a
      // las ramas de abajo y rompe dos cosas:
      //   · Si está 'Entregado', bloquea con 409 cargar una comanda NUEVA de hoy. Ese fue el
      //     bug reportado: "guardo, sale el cargando y no aparece nada" (9 combinaciones
      //     cama+comida quedaron bloqueadas por entregas del 14/15/16 de julio).
      //   · Al reusarla por upsert, conservaría el Status viejo → nacería ya "Entregada".
      // Por eso separamos: las decisiones de bloqueo miran SOLO lo de hoy, y una fila vieja se
      // reusa reseteándole el estado a PENDIENTE (es la comanda de otro día, no la de hoy).
      const hoyArt = todayArtDay();
      const esDeHoy = (row: any) => artDay(row?.fields?.FechaCarga_D) === hoyArt;
      const estaPendiente = (row: any) => String(row?.fields?.Status_D ?? '') === ST_PENDIENTE;

      // Candidatas al upsert:
      //   · las de HOY (caso normal), y
      //   · las de días anteriores que siguen PENDIENTES — son el mismo pedido sin cumplir
      //     (el GET las muestra justamente para que se puedan cerrar). Reusarlas evita que
      //     queden DOS filas activas de la misma cama+turno.
      // Las ENTREGADAS de días anteriores quedan afuera: son histórico, no se tocan ni
      // bloquean. Hoy necesita su propia fila.
      const rows = allRows.filter(r => esDeHoy(r) || estaPendiente(r));

      // Una bandeja ENTREGADA HOY está congelada: ya salió de la cocina, editarla sería
      // reescribir un hecho. Para cambiarla hay que volverla a Pendiente (botón ↩ del panel),
      // que deja el paso explícito y auditable en vez de deshacer la entrega en silencio.
      const bloqueadaPorEntrega = (row: any) =>
        String(row?.fields?.Status_D ?? '') === ST_ENTREGADO;

      const patchFields = {
        Tipo_D: tipoVal, Detalle_D: det, Observaciones_D: obs,
        PacienteNombre_D: String(patientName ?? ''), PacienteCodigo_D: String(patientCode ?? ''),
        NutricionistaNombre_D: String(userName ?? ''), ...nutriIdField,
        FechaCarga_D: nowIso,
        // Migración de ubicación: editar una comanda la "muda" a la cama ACTUAL del paciente.
        // Si se trasladó después de la carga, la fila deja de apuntar a la habitación vieja —
        // cocina y el histórico ven a dónde hay que llevar la bandeja de verdad.
        CamaLabel_D: String(bedLabel), CamaCodigo_D: String(bedCode ?? ''),
        Habitacion_D: String(roomCode ?? ''), Area_D: String(area ?? ''),
      };
      // Al reusar una fila de otro día, la comanda es NUEVA → vuelve a PENDIENTE.
      const patchFieldsReuso = { ...patchFields, Status_D: ST_PENDIENTE };

      // ── RAMA A — editar una fila concreta (acompañante existente) ─────────
      if (reqItemId) {
        // Se resuelve DESDE ESTE resultset, no se PATCHea un id arbitrario del cliente: con el
        // poll de 60s, A puede eliminar el acompañante 2 mientras B (stale) lo edita → el PATCH
        // caería sobre una fila Inactivo, devolvería 200 y la comanda no aparecería nunca.
        const target = allRows.find(r => String(r.id) === String(reqItemId));
        if (!target) return res.status(409).json({ error: 'Esa comanda ya no existe o fue eliminada por otro usuario.' });
        // Solo bloquea si la entrega es de HOY (ver comentario del filtro por día arriba).
        if (esDeHoy(target) && bloqueadaPorEntrega(target)) {
          return res.status(409).json({ error: 'comanda_entregada', message: 'La comanda ya fue entregada. Volvela a pendiente desde el panel de comandas para poder editarla.' });
        }
        // Comensal_D / OrdenComensal_D son la IDENTIDAD de la fila: nunca se tocan en un update.
        await graphFetch(`${basePath}/${target.id}/fields`, {
          method: 'PATCH', body: JSON.stringify(esDeHoy(target) ? patchFields : patchFieldsReuso),
        });
        return res.status(200).json({
          ok: true, spItemId: String(target.id),
          comensal: comensalOf(target.fields), orden: ordenOf(target.fields),
        });
      }

      // ── RAMA B — titular: upsert (comportamiento de siempre) ──────────────
      if (comensalVal === 'TITULAR') {
        const titular = rows.find(r => comensalOf(r.fields) === 'TITULAR');
        if (titular) {
          if (bloqueadaPorEntrega(titular)) {
            return res.status(409).json({ error: 'comanda_entregada', message: 'La comanda ya fue entregada. Volvela a pendiente desde el panel de comandas para poder editarla.' });
          }
          await graphFetch(`${basePath}/${titular.id}/fields`, { method: 'PATCH', body: JSON.stringify(patchFields) });
          return res.status(200).json({ ok: true, spItemId: String(titular.id), comensal: 'TITULAR', orden: 0 });
        }
        // no existe → cae al INSERT de abajo
      }

      // ── RAMA C — acompañante nuevo: INSERT, nunca upsert ──────────────────
      let ordenVal = 0;
      if (comensalVal === 'ACOMPANANTE') {
        const acomps = rows.filter(r => comensalOf(r.fields) === 'ACOMPANANTE');
        if (acomps.length >= MAX_ACOMPANANTES) {
          return res.status(400).json({ error: `No se pueden cargar más de ${MAX_ACOMPANANTES} acompañantes por turno.` });
        }
        // El ordinal es identidad, no posición: se toma max+1 y NUNCA se renumera al borrar.
        // Renumerar exigiría reescribir N filas sin transacción → un fallo parcial dejaría
        // duplicados o huecos. Con ordinal inmutable, borrar es un PATCH a una sola fila; la UI
        // muestra el índice visual 1..N recalculado en el render.
        ordenVal = Math.max(0, ...acomps.map(r => ordenOf(r.fields))) + 1;
      }

      const spRes = await graphFetch(basePath, {
        method: 'POST',
        body: JSON.stringify({
          fields: {
            Title: '[sumar]',
            CamaLabel_D: String(bedLabel),
            CamaCodigo_D: String(bedCode ?? ''),
            Habitacion_D: String(roomCode ?? ''),
            Area_D: String(area ?? ''),
            PacienteNombre_D: String(patientName ?? ''),
            PacienteCodigo_D: String(patientCode ?? ''),
            Comida_D: comidaVal,
            Tipo_D: tipoVal,
            Detalle_D: det,
            Observaciones_D: obs,
            Status_D: ST_PENDIENTE,   // nace pendiente de entrega
            NutricionistaNombre_D: String(userName ?? ''),
            ...nutriIdField,
            FechaCarga_D: nowIso,
            Entorno_D: ENTORNO,
            Comensal_D: comensalVal,
            OrdenComensal_D: String(ordenVal),
          },
        }),
      });
      if (!spRes.ok) {
        const errText = await spRes.text();
        console.error('[dietas] POST failed:', spRes.status, errText);
        return res.status(500).json({ error: 'Failed to save meal load' });
      }
      const created = (await spRes.json()) as { id: string };
      console.log(`[dietas] ${comidaVal} "${tipoVal}" (${comensalVal}${ordenVal ? ` #${ordenVal}` : ''}) cargado en "${bedLabel}" por ${userName ?? userId}`);
      // Devolvemos `orden` porque lo asigna el SERVER: el cliente no puede construir la fila
      // optimista sin él, y con esto la inserta sin refetch.
      return res.status(200).json({ ok: true, spItemId: String(created.id), comensal: comensalVal, orden: ordenVal });
    } catch (err: any) {
      console.error('[dietas] POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH — cambiar el estado de una comanda ──────────────────────────────
  //   action 'anular'    (default) → Inactivo  — soft-delete. Es el comportamiento histórico:
  //                                  sin `action`, cualquier caller viejo sigue anulando igual.
  //   action 'entregar'            → Entregado — check desde el panel de comandas
  //   action 'pendiente'           → Activo    — deshacer un check tocado por error
  if (req.method === 'PATCH') {
    const { spItemId, bedLabel, comida, action } = req.body ?? {};
    const nowIso = new Date().toISOString();

    // ── action 'reubicar' — el traslado del paciente se confirmó ────────────
    // Las bandejas PENDIENTES del paciente (todos los turnos, titular y acompañantes) se
    // mudan a su cama nueva EN SP, así Gestión de Comandas y el PDF de despacho muestran
    // la habitación de entrega real sin esperar a que alguien edite la comanda. Las
    // Entregadas/Anuladas no se tocan: son historia de dónde se sirvió cada bandeja.
    // Idempotente: re-llamarla no cambia nada si ya están en la cama destino.
    if (String(action ?? '') === 'reubicar') {
      const { patientCode, bedCode, roomCode, area } = req.body ?? {};
      if (!String(patientCode ?? '').trim()) return res.status(400).json({ error: 'patientCode is required' });
      if (!bedLabel) return res.status(400).json({ error: 'bedLabel (cama destino) is required' });
      try {
        const filter = encodeURIComponent(
          `fields/PacienteCodigo_D eq '${esc(patientCode)}' and fields/Status_D eq '${ST_PENDIENTE}' and fields/Entorno_D eq '${ENTORNO}'`,
        );
        const r = await graphFetch(`${basePath}?$expand=fields&$filter=${filter}&$top=50`, {
          headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' },
        });
        if (!r.ok) return res.status(502).json({ error: 'No se pudo consultar las comandas del paciente.' });
        const rows = ((await r.json()) as { value: any[] }).value ?? [];
        const aMigrar = rows.filter(row => String(row?.fields?.CamaLabel_D ?? '') !== String(bedLabel));
        const ubicacion = {
          CamaLabel_D: String(bedLabel), CamaCodigo_D: String(bedCode ?? ''),
          Habitacion_D: String(roomCode ?? ''), Area_D: String(area ?? ''),
        };
        const results = await Promise.allSettled(aMigrar.map(row =>
          graphFetch(`${basePath}/${row.id}/fields`, { method: 'PATCH', body: JSON.stringify(ubicacion) })));
        const migradas = results.filter(x => x.status === 'fulfilled' && (x.value as any)?.ok).length;
        if (migradas > 0) console.log(`[dietas] reubicar: ${migradas} bandeja(s) pendiente(s) del paciente movida(s) a "${bedLabel}"`);
        return res.status(200).json({ ok: true, migradas, pendientes: rows.length });
      } catch (err: any) {
        console.error('[dietas] reubicar error:', err);
        return res.status(500).json({ error: err.message });
      }
    }

    const ACTIONS: Record<string, Record<string, unknown>> = {
      anular:    { Status_D: ST_ANULADA,   FechaCierre_D: nowIso },
      // FechaCierre_D también en la entrega: es la hora que Catering quiere ver en el
      // histórico ("¿a qué hora salió la bandeja?"). Antes solo la anulación la escribía.
      entregar:  { Status_D: ST_ENTREGADO, FechaCierre_D: nowIso },
      // Deshacer un check limpia la fecha: si quedara la vieja, una re-entrega posterior
      // mostraría la hora del toque errado en vez de la real.
      pendiente: { Status_D: ST_PENDIENTE, FechaCierre_D: null },
    };
    const act = String(action ?? 'anular');
    const fields = ACTIONS[act];
    if (!fields) return res.status(400).json({ error: `action must be one of: ${Object.keys(ACTIONS).join(', ')}` });

    try {
      // Con spItemId se da de baja ESA fila (el camino que usa el botón de eliminar de un
      // acompañante). Sin él, se resuelve por (cama, comida) → SIEMPRE el TITULAR.
      let itemId = spItemId ? String(spItemId) : '';
      if (!itemId) {
        const comidaVal = COMIDAS.includes(String(comida)) ? String(comida) : '';
        if (!bedLabel || !comidaVal) return res.status(400).json({ error: 'spItemId or (bedLabel + comida) required' });
        const filter = encodeURIComponent(
          `fields/CamaLabel_D eq '${esc(bedLabel)}' and fields/Comida_D eq '${comidaVal}' and ${VIVAS_FILTER} and fields/Entorno_D eq '${ENTORNO}'`,
        );
        // ⚠️ $top=50 + find(TITULAR), no $top=1 + value[0]: con acompañantes, ese `[0]` puede
        // ser un acompañante → "Quitar" en el titular le daría de baja la bandeja al acompañante.
        const existing = await graphFetch(
          `${basePath}?$expand=fields&$filter=${filter}&$top=50`,
          { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
        );
        if (existing.ok) {
          const rows = ((await existing.json()) as { value: any[] }).value ?? [];
          const titular = rows.find(r => comensalOf(r.fields) === 'TITULAR');
          if (titular) itemId = String(titular.id);
        }
      }
      if (!itemId) return res.status(200).json({ ok: true, message: 'No active meal load found' });

      const spRes = await graphFetch(`${basePath}/${itemId}/fields`, { method: 'PATCH', body: JSON.stringify(fields) });
      if (!spRes.ok) {
        console.error('[dietas] PATCH failed:', spRes.status, act);
        return res.status(500).json({ error: 'No se pudo actualizar la comanda.' });
      }
      return res.status(200).json({ ok: true, spItemId: itemId, status: fields.Status_D });
    } catch (err: any) {
      console.error('[dietas] PATCH error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireAuth(handler);
