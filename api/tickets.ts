/**
 * Vercel serverless function — CRUD de traslados. FUENTE: Supabase public.traslados
 * (migrado de la lista SP 07.Traslados).
 *
 * GET  /api/tickets          → activos (+ cerrados en la ventana de gracia de 30min)
 * GET  /api/tickets?all=1    → histórico completo del entorno
 * GET  /api/tickets?patientCode=X → historial de UN paciente (todos sus tickets)
 * POST /api/tickets          → crear ticket  { ...Ticket, originAreaName, destinationAreaName }
 * PATCH /api/tickets         → actualizar    { id|spItemId, ...campos, originArea, destinationArea }
 *
 * Escribe con el cliente admin (service_role). El push YA NO sale de acá: lo dispara un Database
 * Webhook sobre public.traslados → Edge Function notify-push (Fase D). El cliente lee por Realtime;
 * este GET queda para ?all=1 (Monitor/Historial) y ?patientCode= (historia por cama), on-demand.
 */
import { requireAuth } from './jwt.js';
import { Ticket, TicketStatus, WorkflowType, SedeType, BedStatus } from '../types.js';
import { effectiveAreaNames } from './push-utils.js';
import { getRoleByName } from './role-cache.js';
import { getUserAreasById } from './user-cache.js';
import { getSupabaseAdmin } from './supabase-admin.js';
import { authzPreTicket } from './pre-ticket-authz.js';

const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

/** DJB2 string hash — para el ETag del GET (no crypto). */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

// ── fila public.traslados → Ticket ────────────────────────────────────────────
function rowToTicket(r: Record<string, any>): Ticket {
  // Cancelable hasta que interviene una azafata (intervino_azafata pasa de 'NO' a 'SI').
  const intervenedByHostess: 'SI' | 'NO' = String(r.intervino_azafata ?? '').trim().toUpperCase() === 'SI' ? 'SI' : 'NO';
  return {
    // DECISIÓN de la migración: spItemId = id_univoco (el cliente lo trata opaco; persistTicketUpdate
    // sigue keyando por spItemId, que ahora coincide con id). Se elimina el item-id de SharePoint.
    spItemId:               String(r.id_univoco ?? ''),
    id:                     String(r.id_univoco ?? ''),
    sede:                   SedeType.HPR,
    patientName:            String(r.paciente ?? ''),
    patientCode:            r.codigo_paciente ? String(r.codigo_paciente) : undefined,
    origin:                 String(r.cama_origen ?? ''),
    originBedCode:          r.cama_origen_codigo ? String(r.cama_origen_codigo) : undefined,
    originBedStatus:        r.cama_origen_status ? String(r.cama_origen_status) : undefined,
    destination:            r.cama_destino ? String(r.cama_destino) : null,
    destinationBedCode:     r.cama_destino_codigo ? String(r.cama_destino_codigo) : undefined,
    destinationBedStatus:   r.cama_destino_status ? String(r.cama_destino_status) : undefined,
    workflow:               (r.workflow as WorkflowType) ?? WorkflowType.INTERNAL,
    status:                 (r.status as TicketStatus) ?? TicketStatus.WAITING_ROOM,
    createdAt:              String(r.created_at ?? ''),
    completedAt:            r.completed_at ? String(r.completed_at) : undefined,
    financier:              r.financiador ? String(r.financiador) : undefined,
    createdBy:              r.created_by ? String(r.created_by) : undefined,
    createdById:            r.created_by_id != null ? String(r.created_by_id) : undefined,
    operador:               r.operador ? String(r.operador) : undefined,
    date:                   r.created_at ? String(r.created_at) : undefined,
    isBedClean:             false,
    isReasonValidated:      true,
    changeReason:           r.motivo_cambio ? String(r.motivo_cambio) : undefined,
    rejectionReason:        r.motivo_cancelacion ? String(r.motivo_cancelacion) : undefined,
    observations:           r.observaciones ? String(r.observaciones) : undefined,
    // Pre-ticket: requisitos de cama tildados por la Coordinadora (snapshot estructurado, para medir).
    requisitosCama:         Array.isArray(r.requisitos_cama) ? r.requisitos_cama.map((x: any) => String(x)) : undefined,
    targetBedOriginalStatus: r.cama_destino_status ? (r.cama_destino_status as BedStatus) : undefined,
    intervenedByHostess,
    canCancel:              intervenedByHostess === 'NO',
  };
}

// ── Ticket → columnas public.traslados (solo claves definidas → safe para PATCH) ──
function ticketToRow(t: Partial<Ticket>): Record<string, unknown> {
  const map: [keyof Ticket, string][] = [
    ['id',                   'id_univoco'],
    ['patientName',          'paciente'],
    ['patientCode',          'codigo_paciente'],
    ['origin',               'cama_origen'],
    ['originBedCode',        'cama_origen_codigo'],
    ['originBedStatus',      'cama_origen_status'],
    ['destination',          'cama_destino'],
    ['destinationBedCode',   'cama_destino_codigo'],
    ['destinationBedStatus', 'cama_destino_status'],
    ['workflow',             'workflow'],
    ['status',               'status'],
    ['financier',            'financiador'],
    ['createdAt',            'created_at'],
    ['completedAt',          'completed_at'],
    ['createdBy',            'created_by'],
    ['createdById',          'created_by_id'],
    ['changeReason',         'motivo_cambio'],
    ['rejectionReason',      'motivo_cancelacion'],
    ['observations',         'observaciones'],
    ['requisitosCama',       'requisitos_cama'],
    ['intervenedByHostess',  'intervino_azafata'],
  ];
  const row = Object.fromEntries(
    map.filter(([key]) => t[key] !== undefined).map(([key, col]) => [col, t[key]]),
  ) as Record<string, unknown>;
  if (row.created_by_id !== undefined) row.created_by_id = Number(row.created_by_id);
  return row;
}

// Busca el traslado ACTIVO que ya tiene esa cama destino (para el 409). El índice único parcial
// (WHERE status NOT IN Consolidado/Cancelado) es la fuente de verdad; esto solo resuelve el id.
async function findDestinationConflict(
  supa: ReturnType<typeof getSupabaseAdmin>,
  destination: string,
  excludeIdUnivoco?: string,
): Promise<string | undefined> {
  let q = supa.from('traslados').select('id_univoco')
    .eq('entorno', ENTORNO).eq('cama_destino', destination)
    .not('status', 'in', `(${TicketStatus.COMPLETED},${TicketStatus.REJECTED})`)
    .limit(1);
  if (excludeIdUnivoco) q = q.neq('id_univoco', excludeIdUnivoco);
  const { data } = await q;
  return data?.[0]?.id_univoco ? String(data[0].id_univoco) : undefined;
}

// ── Handler ──────────────────────────────────────────────────────────────────
async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let supa: ReturnType<typeof getSupabaseAdmin>;
  try { supa = getSupabaseAdmin(); }
  catch (e: any) { console.error('[tickets]', e?.message ?? e); return res.status(503).json({ error: 'Supabase no configurado' }); }

  try {
    // ── GET ────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const fetchAll = req.query?.all === '1';
      const patientCode = typeof req.query?.patientCode === 'string' ? req.query.patientCode.trim() : '';
      const search = typeof req.query?.search === 'string' ? req.query.search.trim() : '';
      // Rango de fechas ART (opcional): el cliente (Historial/Monitor) manda from/to y el filtro va
      // SERVER-SIDE por created_at. Antes se traía TODO y se filtraba en el front (parche de la época
      // SharePoint); con la tabla acumulada chocaba con el cap de filas de Supabase → no traía nada.
      const isDay = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''));
      const from = isDay(req.query?.from) ? String(req.query.from) : '';
      const to   = isDay(req.query?.to)   ? String(req.query.to)   : '';

      let data: Record<string, any>[] | null = null;
      let error: { message: string } | null = null;

      if (search) {
        // Búsqueda del Historial por nombre de paciente o ID, CROSS-fecha (ignora el rango): trae los
        // traslados cerrados (Consolidado/Cancelado) que matchean, así el buscador encuentra al paciente
        // aunque su traslado sea de otro día. Se sanitiza el término (chars que romperían el filtro .or de
        // PostgREST) y se limita el resultado.
        const safe = search.replace(/[,()%*\\]/g, ' ').trim();
        if (safe) {
          const like = `%${safe}%`;
          const resS = await supa.from('traslados').select('*').eq('entorno', ENTORNO)
            .in('status', [TicketStatus.COMPLETED, TicketStatus.REJECTED])
            .or(`paciente.ilike.${like},id_univoco.ilike.${like}`)
            .order('created_at', { ascending: false })
            .limit(300);
          data = resS.data; error = resS.error;
        } else {
          data = [];
        }
      } else if (fetchAll) {
        // Histórico por RANGO (Monitor/Historial). Se pagina server-side: PostgREST corta cada
        // request en db-max-rows (histórico ~1000 en el proyecto), así que una sola query se
        // truncaba en silencio y el filtro por fecha del front no encontraba nada. Acá pedimos
        // páginas con .range() avanzando por la cantidad REALMENTE recibida y cortamos SOLO en la
        // página vacía → el rango completo llega siempre, sin importar el cap del proyecto.
        // Orden estable (created_at, id_univoco) para que la paginación no salte ni duplique filas.
        const PAGE = 1000;
        const HARD_CAP = 100_000; // backstop anti-loop (nunca debería alcanzarse con un rango real)
        const acc: Record<string, any>[] = [];
        while (acc.length < HARD_CAP) {
          let pageQ = supa.from('traslados').select('*').eq('entorno', ENTORNO);
          if (from) pageQ = pageQ.gte('created_at', `${from}T00:00:00-03:00`);
          if (to)   pageQ = pageQ.lte('created_at', `${to}T23:59:59-03:00`);
          pageQ = pageQ
            .order('created_at', { ascending: false })
            .order('id_univoco', { ascending: false })
            .range(acc.length, acc.length + PAGE - 1);
          const res = await pageQ;
          if (res.error) { error = res.error; break; }
          const rows = res.data ?? [];
          acc.push(...rows);
          if (rows.length === 0) break; // no hay más filas en el rango
        }
        data = acc;
      } else {
        let q = supa.from('traslados').select('*').eq('entorno', ENTORNO);
        if (patientCode) {
          q = q.eq('codigo_paciente', patientCode);
        } else {
          // Vista viva: activos + cerrados en la ventana de gracia de 30min. La ventana existe para
          // que el detector de cambios del cliente vea la transición a Consolidado/Cancelado antes de
          // que el ticket se caiga del payload (misma razón que en la versión SP).
          const graceCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
          q = q.or(`status.not.in.(${TicketStatus.COMPLETED},${TicketStatus.REJECTED}),completed_at.gte.${graceCutoff}`);
        }
        const res = await q;
        data = res.data; error = res.error;
      }
      if (error) throw new Error(`Supabase GET failed: ${error.message}`);

      const tickets = (data ?? []).map(rowToTicket);

      // ETag: hash de ids + campos editables/estado. Una edición de destino/observación (sin
      // mover el status) igual invalida el cache. Útil para ?all=1 on-demand.
      const etag = `"${simpleHash(tickets.map(t => `${t.id}:${t.status}:${t.destination ?? ''}:${t.destinationBedStatus ?? ''}:${t.observations ?? ''}:${t.changeReason ?? ''}:${t.workflow ?? ''}:${t.financier ?? ''}:${t.intervenedByHostess ?? ''}`).join('|'))}"`;
      res.setHeader('ETag', etag);
      if (req.headers?.['if-none-match'] === etag) return res.status(304).end();

      return res.status(200).json({ tickets });
    }

    // ── POST — crear ─────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { originAreaName, destinationAreaName } = req.body ?? {};
      const row = ticketToRow(req.body ?? {});
      // Pre-ticket (status 'Presolicitud'): exige el permiso crear_pre_ticket (la Coordinadora).
      // El resto de los altos siguen gateados client-side por crear_ticket (sin cambios).
      if (String(row.status) === TicketStatus.PRESOLICITUD) {
        const denied = await authzPreTicket(req, 'crear_pre_ticket');
        if (denied) return res.status(denied.status).json({ error: denied.error });
      }
      row.entorno = ENTORNO;
      row.version = String(req.body?.version ?? ''); // versión del build del cliente que creó el ticket
      // Responsable (operador de sesión / cuenta compartida) que creó el traslado.
      (row as any).operador = req.body?.operador != null && req.body.operador !== '' ? String(req.body.operador) : null;
      // Nombres de área reales (para que el webhook filtre por piso). No están en Ticket.
      if (originAreaName !== undefined) row.cama_origen_area = originAreaName ? String(originAreaName) : null;
      if (destinationAreaName !== undefined) row.cama_destino_area = destinationAreaName ? String(destinationAreaName) : null;
      // created_at: gana el valor del cliente (ticketToRow lo mapea si vino); si no, default now().

      // upsert(onConflict id_univoco,entorno, ignoreDuplicates) = idempotencia nativa (reemplaza
      // createTicketIdempotent). Un conflicto del ÍNDICE DE CAMA DESTINO (otro índice) NO lo tapa
      // el onConflict → sale como 23505 y lo traducimos a 409.
      const { error } = await supa.from('traslados')
        .upsert(row, { onConflict: 'id_univoco,entorno', ignoreDuplicates: true });
      if (error) {
        if (error.code === '23505') {
          const conflictingTicketId = row.cama_destino
            ? await findDestinationConflict(supa, String(row.cama_destino))
            : undefined;
          return res.status(409).json({ error: 'Cama destino ya asignada a otro traslado activo.', conflictingTicketId });
        }
        console.error('[tickets] POST failed:', error.message);
        return res.status(500).json({ error: 'Failed to create ticket' });
      }
      return res.status(201).json({ spItemId: String(req.body?.id ?? '') });
    }

    // ── PATCH — actualizar ─────────────────────────────────────────────────────
    if (req.method === 'PATCH') {
      const { spItemId, originArea, destinationArea, ...updates } = req.body as Partial<Ticket> & {
        spItemId?: string; originArea?: string; destinationArea?: string;
      };
      const idUnivoco = String(updates.id ?? spItemId ?? '');
      if (!idUnivoco) return res.status(400).json({ error: 'id/spItemId required' });

      // ── Enforcement de piso para acciones de azafata (SIN CAMBIOS respecto de SP) ──
      // Una azafata solo puede ejecutar acciones de su(s) piso(s). Regla HRA (Sala de Espera):
      // si el extremo requerido es HRA, se usa el piso real del otro extremo. Solo aplica a roles
      // con filterByFloors; admin/admisión quedan exentos.
      const HOSTESS_ACTION_ENDPOINT: Partial<Record<TicketStatus, 'origin' | 'dest'>> = {
        [TicketStatus.IN_TRANSIT]: 'dest',            // confirmar limpieza (azafata destino)
        [TicketStatus.IN_TRANSPORT]: 'origin',        // iniciar traslado (azafata origen)
        [TicketStatus.WAITING_CONSOLIDATION]: 'dest', // confirmar recepción (azafata destino)
      };
      const endpoint = updates.status ? HOSTESS_ACTION_ENDPOINT[updates.status] : undefined;
      if (updates.intervenedByHostess === 'SI' && endpoint) {
        const userId = String(req.user?.id ?? '');
        const userAreas = await getUserAreasById(userId);
        const roleCfg = userAreas?.perfil ? await getRoleByName(userAreas.perfil) : null;
        const areas = userAreas?.assignedAreas ?? [];
        const hasAll = areas.length >= 9; // mismo criterio "full access" que push-utils
        if (roleCfg?.filterByFloors && areas.length && !hasAll) {
          const { origin, dest } = effectiveAreaNames(originArea, destinationArea);
          const requiredArea = endpoint === 'origin' ? origin : dest;
          if (requiredArea && !areas.includes(requiredArea)) {
            console.warn(`[tickets] PATCH 403 — user=${userId} areas=[${areas.join(',')}] requiredArea="${requiredArea}" status=${updates.status}`);
            return res.status(403).json({ error: 'No autorizado: el traslado no pertenece a tus pisos asignados.' });
          }
        }
      }

      const fields = ticketToRow(updates);
      delete fields.id_univoco; // no reescribir la clave de join
      fields.last_actor_id = Number(req.user?.id) || null; // quién hizo la acción → excludeUser del webhook
      fields.version = String(req.body?.version ?? ''); // versión del build del cliente que hizo el cambio
      if (originArea !== undefined) fields.cama_origen_area = originArea ? String(originArea) : null;
      if (destinationArea !== undefined) fields.cama_destino_area = destinationArea ? String(destinationArea) : null;

      const { error } = await supa.from('traslados').update(fields)
        .eq('id_univoco', idUnivoco).eq('entorno', ENTORNO);
      if (error) {
        if (error.code === '23505' && updates.destination) {
          const conflictingTicketId = await findDestinationConflict(supa, String(updates.destination), idUnivoco);
          return res.status(409).json({ error: 'Cama destino ya asignada a otro traslado activo.', conflictingTicketId });
        }
        console.error('[tickets] PATCH failed:', error.message);
        return res.status(500).json({ error: 'Failed to update ticket' });
      }
      // El push (NEW_TICKET/STATUS_UPDATE/RECEPTION_CONFIRMED) lo dispara el webhook, no este endpoint.
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error('[api/tickets]', err);
    return res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}

export default requireAuth(handler);
