/**
 * Vercel serverless function — CRUD for the "Traslados" SharePoint List.
 *
 * GET  /api/tickets          → all non-completed/rejected tickets (active)
 * GET  /api/tickets?all=1    → full history
 * POST /api/tickets          → create ticket  { ...Ticket fields }
 * PATCH /api/tickets         → update ticket  { spItemId, ...fields to update }
 */

import { graphFetch }  from './graph.js';
import { requireAuth } from './jwt.js';
import { Ticket, TicketStatus, WorkflowType, SedeType, BedStatus } from '../types.js';
import { sendPushToSubscribers, effectiveAreaNames } from './push-utils.js';
import { getRoleByName } from './role-cache.js';
import { getUserAreasById } from './user-cache.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = 'c7417674-9084-416d-a955-7024161a3194'; // 07.Traslados

// Entorno: filtra y etiqueta los items para que producción y testing coexistan
// en la misma lista sin pisarse. Default seguro 'TESTING' — si la variable no
// está cargada, no se toca prod por accidente.
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

/** DJB2 string hash — fast, good distribution, no crypto needed */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

// ── SP column names (07.Traslados) ──────────────────────────────────────────
// Title                  → (auto, not used)
// IDUnivocoTraslado_T    → ticket id (TKT-xxx)
// TipoTraslado_T         → workflow type
// CodigoCamaO_T          → origin bed code
// CamaOrigen_T           → origin bed label
// Paciente_T             → patient name
// StatusCamaO_T          → origin bed status
// StatusCamaD_T          → destination bed status
// CodigoCamaD_T          → destination bed code
// CamaDestino_T          → destination bed label
// CodigoPaciente_T       → patient code
// Financiador_T          → financier
// Status_T               → ticket status
// MotivoCambio_T         → change reason
// ObservacionesTraslado_T→ observations
// MotivoCancelacion_T    → rejection/cancellation reason
// FechaInicio_T          → start date (DateTime)
// FechaFin_T             → end date (DateTime)
// Usuario_T              → user who created

// ── SP item → Ticket ─────────────────────────────────────────────────────────
function spToTicket(item: Record<string, unknown>): Ticket {
  const f = item.fields as Record<string, unknown>;

  // Cancellation is allowed until a hostess has intervened.
  // IntervinoAzafata_T is "NO" at creation and flips to "SI" on the first hostess action.
  const intervenedRaw = f.IntervinoAzafata_T ? String(f.IntervinoAzafata_T).trim().toUpperCase() : '';
  const intervenedByHostess: 'SI' | 'NO' = intervenedRaw === 'SI' ? 'SI' : 'NO';
  const canCancel = intervenedByHostess === 'NO';

  return {
    spItemId:               String(item.id),
    id:                     String(f.IDUnivocoTraslado_T ?? ''),
    sede:                   SedeType.HPR,
    patientName:            String(f.Paciente_T ?? ''),
    patientCode:            f.CodigoPaciente_T ? String(f.CodigoPaciente_T) : undefined,
    origin:                 String(f.CamaOrigen_T ?? ''),
    originBedCode:          f.CodigoCamaO_T ? String(f.CodigoCamaO_T) : undefined,
    originBedStatus:        f.StatusCamaO_T ? String(f.StatusCamaO_T) : undefined,
    destination:            f.CamaDestino_T ? String(f.CamaDestino_T) : null,
    destinationBedCode:     f.CodigoCamaD_T ? String(f.CodigoCamaD_T) : undefined,
    destinationBedStatus:   f.StatusCamaD_T ? String(f.StatusCamaD_T) : undefined,
    workflow:               (f.TipoTraslado_T as WorkflowType) ?? WorkflowType.INTERNAL,
    status:                 (f.Status_T as TicketStatus) ?? TicketStatus.WAITING_ROOM,
    createdAt:              String(f.FechaInicio_T ?? ''),
    completedAt:            f.FechaFin_T ? String(f.FechaFin_T) : undefined,
    financier:              f.Financiador_T ? String(f.Financiador_T) : undefined,
    createdBy:              f.Usuario_T ? String(f.Usuario_T) : undefined,
    createdById:            f.IDUsuario_T ? String(f.IDUsuario_T) : undefined,
    date:                   f.FechaInicio_T ? String(f.FechaInicio_T) : undefined,
    isBedClean:             false,
    isReasonValidated:      true,
    changeReason:           f.MotivoCambio_T ? String(f.MotivoCambio_T) : undefined,
    rejectionReason:        f.MotivoCancelacion_T ? String(f.MotivoCancelacion_T) : undefined,
    observations:           f.ObservacionesTraslado_T ? String(f.ObservacionesTraslado_T) : undefined,
    targetBedOriginalStatus: f.StatusCamaD_T ? (f.StatusCamaD_T as BedStatus) : undefined,
    intervenedByHostess,
    canCancel,
  };
}

// ── Ticket → SP fields (only defined keys are included → safe for PATCH) ─────
function ticketToFields(t: Partial<Ticket>): Record<string, unknown> {
  const map: [keyof Ticket, string][] = [
    ['id',                     'IDUnivocoTraslado_T'],
    ['patientName',            'Paciente_T'],
    ['patientCode',            'CodigoPaciente_T'],
    ['origin',                 'CamaOrigen_T'],
    ['originBedCode',          'CodigoCamaO_T'],
    ['originBedStatus',        'StatusCamaO_T'],
    ['destination',            'CamaDestino_T'],
    ['destinationBedCode',     'CodigoCamaD_T'],
    ['destinationBedStatus',   'StatusCamaD_T'],
    ['workflow',               'TipoTraslado_T'],
    ['status',                 'Status_T'],
    ['financier',              'Financiador_T'],
    ['createdAt',              'FechaInicio_T'],
    ['completedAt',            'FechaFin_T'],
    ['createdBy',              'Usuario_T'],
    ['createdById',            'IDUsuario_T'],
    ['changeReason',           'MotivoCambio_T'],
    ['rejectionReason',        'MotivoCancelacion_T'],
    ['observations',           'ObservacionesTraslado_T'],
    ['intervenedByHostess',    'IntervinoAzafata_T'],
  ];

  const fields = Object.fromEntries(
    map
      .filter(([key]) => t[key] !== undefined)
      .map(([key, spKey]) => [spKey, t[key]]),
  );

  // Title is always [sumar]
  fields.Title = '[sumar]';

  // IDUsuario_T is a number column in SP
  if (fields.IDUsuario_T !== undefined) {
    (fields as Record<string, unknown>).IDUsuario_T = Number(fields.IDUsuario_T);
  }

  return fields;
}

// ── Handler ──────────────────────────────────────────────────────────────────
async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SITE_ID || !LIST_ID) {
    return res.status(503).json({ error: 'SHAREPOINT_SITE_ID / SHAREPOINT_TRASLADOS_LIST_ID not configured' });
  }

  try {
    // ── GET ────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const fetchAll = req.query?.all === '1';
      // Entorno: siempre filtra. Histórico (?all=1) también — solo se trae lo del entorno actual.
      const entornoClause = `fields/Entorno_T eq '${ENTORNO}'`;
      const statusClause  = `fields/Status_T ne '${TicketStatus.COMPLETED}' and fields/Status_T ne '${TicketStatus.REJECTED}'`;
      const filter = fetchAll
        ? `&$filter=${entornoClause}`
        : `&$filter=${entornoClause} and ${statusClause}`;

      // Sin tope: paginamos siguiendo @odata.nextLink y traemos TODOS los tickets del
      // entorno (mismo patrón que api/notifications.ts). El `$top=500` es solo el tamaño
      // de página (máximo que Graph devuelve por request con $expand), NO un límite del
      // total. MAX_SCAN es un backstop anti-runaway (no un recorte esperable); si se
      // alcanza, se loguea para que no sea un tope silencioso.
      const MAX_SCAN = 50_000;
      const rows: Record<string, unknown>[] = [];
      let next: string | null =
        `/sites/${SITE_ID}/lists/${LIST_ID}/items?$expand=fields&$top=500${filter}`;
      while (next && rows.length < MAX_SCAN) {
        const page = await graphFetch(next, {
          headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } as any,
        });
        if (!page.ok) throw new Error(`SP GET failed (${page.status}): ${await page.text()}`);
        const pageData = (await page.json()) as {
          value?: Record<string, unknown>[];
          '@odata.nextLink'?: string;
        };
        for (const it of pageData.value ?? []) rows.push(it);
        const raw = pageData['@odata.nextLink'];
        // nextLink es absoluta; graphFetch espera path relativo a /v1.0.
        next = raw ? raw.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, '') : null;
      }
      if (next) console.warn(`[tickets] MAX_SCAN (${MAX_SCAN}) alcanzado — quedaron tickets sin traer`);

      const tickets = rows.map(spToTicket);

      // ETag: hash of ids + all editable/status fields so client can skip unchanged
      // data. Incluye destination/observations/changeReason/workflow/financier además
      // de status: una edición que solo cambia el destino o la observación (sin mover
      // el status) DEBE invalidar el cache, sino el cliente queda en 304 y nunca ve el
      // cambio (el mapa de camas sigue mostrando el destino viejo asignado).
      const etag = `"${simpleHash(tickets.map(t => `${t.id}:${t.status}:${t.destination ?? ''}:${t.destinationBedStatus ?? ''}:${t.observations ?? ''}:${t.changeReason ?? ''}:${t.workflow ?? ''}:${t.financier ?? ''}:${t.intervenedByHostess ?? ''}`).join('|'))}"`;
      res.setHeader('ETag', etag);

      const clientEtag = req.headers?.['if-none-match'];
      if (clientEtag === etag) {
        return res.status(304).end();
      }

      return res.status(200).json({ tickets });
    }

    // ── POST ───────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      // originAreaName/destinationAreaName son los nombres reales de área (no se
      // persisten en SP; ticketToFields los ignora) — solo para filtrar el push.
      const { originAreaName, destinationAreaName, ...ticketBody } = req.body as Ticket & {
        originAreaName?: string;
        destinationAreaName?: string;
      };
      const ticket = ticketBody as Ticket;

      // Reject if destination bed is already targeted by another active ticket.
      // Active = not Consolidado and not Cancelado. Race-condition safe since SP is the source of truth.
      // El chequeo se acota al entorno actual: testing y prod no se pisan.
      if (ticket.destination) {
        const escaped = String(ticket.destination).replace(/'/g, "''");
        const conflictUrl = `/sites/${SITE_ID}/lists/${LIST_ID}/items?$expand=fields&$top=5`
          + `&$filter=fields/Entorno_T eq '${ENTORNO}'`
          + ` and fields/CamaDestino_T eq '${escaped}'`
          + ` and fields/Status_T ne '${TicketStatus.COMPLETED}'`
          + ` and fields/Status_T ne '${TicketStatus.REJECTED}'`;
        const conflictRes = await graphFetch(conflictUrl, {
          headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } as any,
        });
        if (conflictRes.ok) {
          const conflictData = (await conflictRes.json()) as { value: Record<string, unknown>[] };
          if ((conflictData.value ?? []).length > 0) {
            const conflicting = conflictData.value[0];
            const cf = conflicting.fields as Record<string, unknown>;
            return res.status(409).json({
              error: 'Cama destino ya asignada a otro traslado activo.',
              conflictingTicketId: cf.IDUnivocoTraslado_T ? String(cf.IDUnivocoTraslado_T) : undefined,
            });
          }
        }
      }

      // Estampar el entorno en el item nuevo (solo POST — los PATCH no deben pisarlo).
      const fieldsPost = { ...ticketToFields(ticket), Entorno_T: ENTORNO };
      const spRes = await graphFetch(
        `/sites/${SITE_ID}/lists/${LIST_ID}/items`,
        {
          method: 'POST',
          body:   JSON.stringify({ fields: fieldsPost }),
        },
      );

      if (!spRes.ok) throw new Error(`SP POST failed (${spRes.status}): ${await spRes.text()}`);

      const data = (await spRes.json()) as { id: string };

      // Send push notification for new ticket (non-blocking)
      console.log('[tickets] POST success, sending push notification...');
      sendPushToSubscribers({
        title: 'Nueva Solicitud de Traslado',
        body: `${ticket.patientName}: ${ticket.origin} → ${ticket.destination ?? '?'}`,
        ticketId: ticket.id,
        type: 'NEW_TICKET',
        originArea: ticket.origin,       // bed label (fallback fuzzy)
        destinationArea: ticket.destination,
        originAreaName,                  // nombre de área real → match preciso + regla HRA
        destinationAreaName,
        sede: ticket.sede,
        excludeUserId: (req as any).user?.id,
      }).catch((err: any) => console.error('[tickets] Push error:', err));

      return res.status(201).json({ spItemId: data.id });
    }

    // ── PATCH ──────────────────────────────────────────────────────────────
    if (req.method === 'PATCH') {
      const { spItemId, originArea, destinationArea, ...updates } = req.body as Partial<Ticket> & {
        spItemId: string;
        originArea?: string;
        destinationArea?: string;
      };
      if (!spItemId) return res.status(400).json({ error: 'spItemId required' });

      // ── Enforcement de piso para acciones de azafata ───────────────────────
      // Una azafata solo puede ejecutar acciones de su(s) piso(s). Las 3 acciones de
      // azafata se identifican porque marcan IntervinoAzafata_T = 'SI'. Cada una exige
      // un extremo del traslado, aplicando la regla de HRA (Sala de Espera): si el
      // extremo requerido es HRA, se usa el piso real del otro extremo (la azafata de
      // destino maneja todo el flujo de un traslado HRA→Piso). Solo se enforcea para
      // roles que filtran por pisos; admin/admisión (filterByFloors=false) quedan exentos.
      const HOSTESS_ACTION_ENDPOINT: Partial<Record<TicketStatus, 'origin' | 'dest'>> = {
        [TicketStatus.IN_TRANSIT]: 'dest',            // confirmar limpieza (azafata destino)
        [TicketStatus.IN_TRANSPORT]: 'origin',        // iniciar traslado (azafata origen)
        [TicketStatus.WAITING_CONSOLIDATION]: 'dest', // confirmar recepción (azafata destino)
      };
      const endpoint = updates.status ? HOSTESS_ACTION_ENDPOINT[updates.status] : undefined;
      if (updates.intervenedByHostess === 'SI' && endpoint) {
        const userId = String((req as any).user?.id ?? '');
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

      // If destination is being changed (not just touched), verify no other active ticket holds that bed.
      // We only check when `destination` is in the patch payload; status-only updates skip this.
      if (updates.destination) {
        const escaped = String(updates.destination).replace(/'/g, "''");
        const conflictUrl = `/sites/${SITE_ID}/lists/${LIST_ID}/items?$expand=fields&$top=5`
          + `&$filter=fields/Entorno_T eq '${ENTORNO}'`
          + ` and fields/CamaDestino_T eq '${escaped}'`
          + ` and fields/Status_T ne '${TicketStatus.COMPLETED}'`
          + ` and fields/Status_T ne '${TicketStatus.REJECTED}'`
          + ` and id ne ${spItemId}`;
        const conflictRes = await graphFetch(conflictUrl, {
          headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } as any,
        });
        if (conflictRes.ok) {
          const conflictData = (await conflictRes.json()) as { value: Record<string, unknown>[] };
          if ((conflictData.value ?? []).length > 0) {
            const conflicting = conflictData.value[0];
            const cf = conflicting.fields as Record<string, unknown>;
            return res.status(409).json({
              error: 'Cama destino ya asignada a otro traslado activo.',
              conflictingTicketId: cf.IDUnivocoTraslado_T ? String(cf.IDUnivocoTraslado_T) : undefined,
            });
          }
        }
      }

      const spRes = await graphFetch(
        `/sites/${SITE_ID}/lists/${LIST_ID}/items/${spItemId}`,
        {
          method: 'PATCH',
          body:   JSON.stringify({ fields: ticketToFields(updates) }),
        },
      );

      if (!spRes.ok) throw new Error(`SP PATCH failed (${spRes.status}): ${await spRes.text()}`);

      // Send push notification for status change (non-blocking)
      if (updates.status) {
        const statusLabels: Record<string, string> = {
          [TicketStatus.IN_TRANSIT]: 'Habitación Lista',
          [TicketStatus.IN_TRANSPORT]: 'Traslado en Curso',
          [TicketStatus.WAITING_CONSOLIDATION]: 'Recepción Confirmada',
          [TicketStatus.COMPLETED]: 'Traslado Finalizado',
          [TicketStatus.REJECTED]: 'Traslado Cancelado',
        };
        const label = statusLabels[updates.status];
        if (label) {
          const isReceptionConfirmed = updates.status === TicketStatus.WAITING_CONSOLIDATION;
          // Catering-only: human-readable message "X pasó de Habitación 413 (Piso 4) a Habitación 509 (Piso 5)".
          // Only built for WAITING_CONSOLIDATION so other status changes don't notify Catering at all.
          let cateringBody: string | undefined;
          if (isReceptionConfirmed) {
            const extractRoom = (label?: string): string => {
              if (!label) return '?';
              const m = label.match(/Habitaci[oó]n\s+(\S+)/i);
              if (m) return m[1];
              const unidad = label.match(/Unidad\s+([^-]+)/i);
              if (unidad) return unidad[1].trim();
              return label.split(' - ')[0].trim();
            };
            const extractFloor = (areaName?: string): string => {
              if (!areaName) return '';
              const m = areaName.match(/(\d+)°?\s*Piso/i);
              if (m) return `Piso ${m[1]}`;
              return areaName.replace(/\s*HPR\s*$/i, '').trim();
            };
            const patient = updates.patientName ?? 'Paciente';
            const roomO   = extractRoom(updates.origin);
            const roomD   = extractRoom(updates.destination);
            const floorO  = extractFloor(originArea);
            const floorD  = extractFloor(destinationArea);
            const fromPart = floorO ? `Habitación ${roomO} (${floorO})` : `Habitación ${roomO}`;
            const toPart   = floorD ? `Habitación ${roomD} (${floorD})` : `Habitación ${roomD}`;
            cateringBody = `${patient} pasó de ${fromPart} a ${toPart}`;
          }

          sendPushToSubscribers({
            title: label,
            body: `${updates.patientName ?? 'Paciente'}: ${updates.origin ?? ''} → ${updates.destination ?? ''}`,
            ticketId: updates.id,
            // 'RECEPTION_CONFIRMED' is the only event Catering listens to.
            type: isReceptionConfirmed ? 'RECEPTION_CONFIRMED' : 'STATUS_UPDATE',
            originArea: updates.origin,
            destinationArea: updates.destination,
            originAreaName: originArea,
            destinationAreaName: destinationArea,
            sede: updates.sede,
            excludeUserId: (req as any).user?.id,
            cateringTitle: isReceptionConfirmed ? 'Traslado concretado' : undefined,
            cateringBody,
          }).catch((err: any) => console.error('[tickets] Push error:', err));
        }
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error('[api/tickets]', err);
    return res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}

export default requireAuth(handler);
