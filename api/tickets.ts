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

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = 'c7417674-9084-416d-a955-7024161a3194'; // 07.Traslados

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
      const filter = fetchAll
        ? ''
        : `&$filter=fields/Status_T ne '${TicketStatus.COMPLETED}' and fields/Status_T ne '${TicketStatus.REJECTED}'`;

      const spRes = await graphFetch(
        `/sites/${SITE_ID}/lists/${LIST_ID}/items?$expand=fields&$top=500${filter}`,
      );

      if (!spRes.ok) throw new Error(`SP GET failed (${spRes.status}): ${await spRes.text()}`);

      const data = (await spRes.json()) as { value: Record<string, unknown>[] };
      const tickets = (data.value ?? []).map(spToTicket);

      // ETag: simple hash of ids + statuses so client can skip unchanged data
      const etag = `"${simpleHash(tickets.map(t => `${t.id}:${t.status}:${t.destinationBedStatus ?? ''}`).join('|'))}"`;
      res.setHeader('ETag', etag);

      const clientEtag = req.headers?.['if-none-match'];
      if (clientEtag === etag) {
        return res.status(304).end();
      }

      return res.status(200).json({ tickets });
    }

    // ── POST ───────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const ticket = req.body as Ticket;
      const spRes = await graphFetch(
        `/sites/${SITE_ID}/lists/${LIST_ID}/items`,
        {
          method: 'POST',
          body:   JSON.stringify({ fields: ticketToFields(ticket) }),
        },
      );

      if (!spRes.ok) throw new Error(`SP POST failed (${spRes.status}): ${await spRes.text()}`);

      const data = (await spRes.json()) as { id: string };
      return res.status(201).json({ spItemId: data.id });
    }

    // ── PATCH ──────────────────────────────────────────────────────────────
    if (req.method === 'PATCH') {
      const { spItemId, ...updates } = req.body as Partial<Ticket> & { spItemId: string };
      if (!spItemId) return res.status(400).json({ error: 'spItemId required' });

      const spRes = await graphFetch(
        `/sites/${SITE_ID}/lists/${LIST_ID}/items/${spItemId}`,
        {
          method: 'PATCH',
          body:   JSON.stringify({ fields: ticketToFields(updates) }),
        },
      );

      if (!spRes.ok) throw new Error(`SP PATCH failed (${spRes.status}): ${await spRes.text()}`);

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error('[api/tickets]', err);
    return res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}

export default requireAuth(handler);
