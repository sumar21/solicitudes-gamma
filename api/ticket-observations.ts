/**
 * GET/POST /api/ticket-observations
 *
 * Observaciones que las azafatas (u otros roles operativos) cargan durante un traslado.
 * Cada observación queda ligada al STATUS del ticket en el momento en que se escribe, así
 * al auditar el historial se entiende por qué se demoró cada paso (ej.: la habitación tardó
 * horas en limpiarse porque un familiar se olvidó prendas, el traslado no se pudo hacer
 * porque el familiar no estaba presente, etc.).
 *
 * Lista SP "13.ObservacionesTraslados". El GUID es constante estructural (hardcodeado
 * como el resto de las listas del proyecto).
 *
 * GET  ?ticketId=<id>  → observaciones del ticket, en orden cronológico.
 * POST { ticketId, status, texto, usuario, usuarioId } → crea una observación.
 */

import { graphFetch }  from './graph.js';
import { requireAuth } from './jwt.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = '1c524476-f88f-47c8-ad22-4b3f7f429e46'; // 13.ObservacionesTraslados
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

const MAX_TEXT = 500; // mismo límite que motivos de cancelación / cambio en tickets

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SITE_ID) return res.status(503).json({ error: 'SHAREPOINT_SITE_ID not configured' });

  try {
    // ── GET — observaciones de un ticket ──────────────────────────────────
    if (req.method === 'GET') {
      const ticketId = req.query?.ticketId;
      if (!ticketId) return res.status(400).json({ error: 'ticketId query param required' });

      const filter = [
        `fields/IDUnivocoTraslado_OBS eq '${String(ticketId).replace(/'/g, "''")}'`,
        `fields/Entorno_OBS eq '${ENTORNO}'`,
      ].join(' and ');

      const spRes = await graphFetch(
        `/sites/${SITE_ID}/lists/${LIST_ID}/items?$expand=fields&$filter=${encodeURIComponent(filter)}&$top=200`,
        { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
      );
      if (!spRes.ok) throw new Error(`SP GET failed (${spRes.status}): ${await spRes.text()}`);

      const data = (await spRes.json()) as { value: Record<string, unknown>[] };
      const observations = (data.value ?? []).map((item) => {
        const f = item.fields as Record<string, unknown>;
        return {
          id:        String(item.id),
          ticketId:  String(f.IDUnivocoTraslado_OBS ?? ''),
          status:    String(f.StatusDelTicket_OBS ?? ''),
          texto:     String(f.TextoObservacion_OBS ?? ''),
          usuario:   String(f.UsuarioObservacion_OBS ?? ''),
          usuarioId: String(f.IDUsuarioObservacion_OBS ?? ''),
          fecha:     String(f.FechaObservacion_OBS ?? ''),
        };
      });

      // Orden cronológico en el server (más barato que ordenar en SP).
      observations.sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

      return res.status(200).json({ observations });
    }

    // ── POST — crear observación ──────────────────────────────────────────
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { ticketId, status, texto, usuario, usuarioId } = req.body ?? {};
    const cleanText = String(texto ?? '').trim();
    if (!ticketId || !cleanText) return res.status(400).json({ error: 'ticketId y texto requeridos' });

    // IDUsuarioObservacion_OBS es columna Número en SP (= item id del usuario en 00.Usuarios).
    const usuarioIdNum = Number(usuarioId);

    const fields: Record<string, unknown> = {
      Title:                    String(ticketId),
      IDUnivocoTraslado_OBS:    String(ticketId),
      StatusDelTicket_OBS:      String(status ?? ''),
      TextoObservacion_OBS:     cleanText.slice(0, MAX_TEXT),
      UsuarioObservacion_OBS:   String(usuario ?? ''),
      IDUsuarioObservacion_OBS: Number.isFinite(usuarioIdNum) ? usuarioIdNum : null,
      FechaObservacion_OBS:     new Date().toISOString(),
      Entorno_OBS:              ENTORNO,
    };

    const spRes = await graphFetch(
      `/sites/${SITE_ID}/lists/${LIST_ID}/items`,
      { method: 'POST', body: JSON.stringify({ fields }) },
    );
    if (!spRes.ok) throw new Error(`SP POST failed (${spRes.status}): ${await spRes.text()}`);

    const result = (await spRes.json()) as { id: string };
    return res.status(201).json({ ok: true, spItemId: result.id });
  } catch (err: any) {
    console.error('[api/ticket-observations]', err);
    return res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}

export default requireAuth(handler);
