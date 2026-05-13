/**
 * GET    /api/notifications          → user's UNREAD notifications (Status_N='Enviada')
 * PATCH  /api/notifications          → mark as read. Tres formas de body:
 *                                       1) { notificationId: string }              → single by SP id
 *                                       2) { notificationIds: string[] }           → bulk by SP ids
 *                                       3) { ticketId: string, type: string }      → mark-by-event:
 *                                            busca y marca todas las notifs del user logueado que
 *                                            matchean (TicketId_N + Type_N + Status_N='Enviada').
 *                                            Útil cuando el cliente solo tiene una notif local
 *                                            (NOTIF-POLL-*) o el SW recibió un push tap.
 *                                       Responde 200 con { ok: true, updated: N, failed: [...] }.
 *                                       Si TODOS los PATCH fallan, responde 500 con detalle.
 *
 * Uses SharePoint list "10.Notificaciones"
 */

import { graphFetch } from './graph.js';
import { requireAuthAndLocation } from './jwt.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = '240f00dd-715b-4c78-9661-3147b7650a0f'; // 10.Notificaciones

// Entorno: separa el log de notificaciones de prod/testing. Default 'TESTING'.
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!SITE_ID) return res.status(503).json({ error: 'SHAREPOINT_SITE_ID not configured' });

  const basePath = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;
  const user = (req as any).user;

  // ── GET — fetch user's UNREAD notifications ───────────────────────────────
  // Filtrado server-side por Status_N=Enviada para evitar payload de notifs ya leídas
  // y para que el cliente no tenga que filtrar nada (fuente única de verdad: SP).
  if (req.method === 'GET') {
    try {
      const filter = encodeURIComponent(
        `fields/UserId_N eq ${Number(user?.id) || 0} and fields/Entorno_N eq '${ENTORNO}' and fields/Status_N eq 'Enviada'`
      );
      const spRes = await graphFetch(
        `${basePath}?$expand=fields&$filter=${filter}&$top=50&$orderby=fields/Fecha_N desc`,
        { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
      );
      if (!spRes.ok) return res.status(200).json({ notifications: [] });

      const data = (await spRes.json()) as { value: Record<string, unknown>[] };
      const notifications = (data.value ?? []).map((item: any) => {
        const f = item.fields as Record<string, unknown>;
        return {
          id: String(item.id),
          ticketId: String(f.TicketId_N ?? ''),
          userId: f.UserId_N,
          title: String(f.Title_N ?? ''),
          message: String(f.Message_N ?? ''),
          type: String(f.Type_N ?? ''),
          status: String(f.Status_N ?? ''),
          fecha: String(f.Fecha_N ?? ''),
          leidaAt: f.LeidaAt_N ? String(f.LeidaAt_N) : null,
        };
      });
      return res.status(200).json({ notifications });
    } catch (err: any) {
      console.error('[notifications] GET error:', err);
      return res.status(200).json({ notifications: [] });
    }
  }

  // ── PATCH — mark notification(s) as read ──────────────────────────────────
  // Acepta:
  //   { notificationId: "123" }              → single
  //   { notificationIds: ["123","456",...] } → bulk
  // Responde 200 con { ok, updated, failed: [{ id, status, error }] }.
  // Si TODAS las llamadas a SP fallaron, responde 500 — así el cliente sabe que no
  // puede limpiar el banner. Si al menos una funcionó, devuelve 200 con la lista de
  // fallos para que el cliente actualice optimísticamente lo que sí funcionó.
  if (req.method === 'PATCH') {
    const body = req.body ?? {};
    const userId = Number(user?.id) || 0;
    const nowIso = new Date().toISOString();

    // Modo 3: mark-by-event. Lookup en SP por (ticketId, type, userId, Status=Enviada),
    // luego PATCH a cada uno. Sin ticketId no podemos linkear (caso DIET_CHANGE):
    // respondemos ok con updated=0 para no romper el cliente.
    if (body.ticketId !== undefined || body.type !== undefined) {
      const ticketId = String(body.ticketId ?? '').trim();
      const type = String(body.type ?? '').trim();
      if (!ticketId || !type) {
        return res.status(200).json({ ok: true, updated: 0, failed: [], reason: 'missing-ticketId-or-type' });
      }
      const safeTicketId = ticketId.replace(/'/g, "''");
      const safeType     = type.replace(/'/g, "''");
      const filter = encodeURIComponent(
        `fields/UserId_N eq ${userId} and fields/Entorno_N eq '${ENTORNO}' and fields/TicketId_N eq '${safeTicketId}' and fields/Type_N eq '${safeType}' and fields/Status_N eq 'Enviada'`
      );
      try {
        const lookup = await graphFetch(
          `${basePath}?$expand=fields&$filter=${filter}&$top=20`,
          { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
        );
        if (!lookup.ok) {
          const errText = await lookup.text().catch(() => '');
          console.error(`[notifications] mark-by-event lookup failed: ${lookup.status} ${errText}`);
          return res.status(500).json({ ok: false, updated: 0, failed: [{ id: 'lookup', status: lookup.status, error: errText.slice(0, 200) }] });
        }
        const lookupData = (await lookup.json()) as { value: Record<string, unknown>[] };
        const matches = (lookupData.value ?? []).map((it: any) => String(it.id));
        if (matches.length === 0) {
          return res.status(200).json({ ok: true, updated: 0, failed: [], reason: 'no-match' });
        }
        let updated = 0;
        const failed: { id: string; status?: number; error?: string }[] = [];
        for (const id of matches) {
          try {
            const spRes = await graphFetch(`${basePath}/${id}/fields`, {
              method: 'PATCH',
              body: JSON.stringify({ Status_N: 'Leida', LeidaAt_N: nowIso }),
            });
            if (spRes.ok) updated++;
            else {
              const errText = await spRes.text().catch(() => '');
              console.error(`[notifications] mark-by-event PATCH id=${id} failed: ${spRes.status} ${errText}`);
              failed.push({ id, status: spRes.status, error: errText.slice(0, 200) });
            }
          } catch (err: any) {
            console.error(`[notifications] mark-by-event PATCH id=${id} error:`, err);
            failed.push({ id, error: err?.message ?? String(err) });
          }
        }
        if (updated === 0 && failed.length > 0) {
          return res.status(500).json({ ok: false, updated: 0, failed });
        }
        return res.status(200).json({ ok: true, updated, failed });
      } catch (err: any) {
        console.error('[notifications] mark-by-event error:', err);
        return res.status(500).json({ ok: false, updated: 0, failed: [{ id: 'lookup', error: err?.message }] });
      }
    }

    // Modos 1 y 2: por id explícito (single o bulk).
    const ids: string[] = Array.isArray(body.notificationIds)
      ? body.notificationIds.map(String).filter(Boolean)
      : body.notificationId ? [String(body.notificationId)] : [];

    if (ids.length === 0) {
      return res.status(400).json({ error: 'notificationId, notificationIds or {ticketId,type} required' });
    }

    const failed: { id: string; status?: number; error?: string }[] = [];
    let updated = 0;

    for (const id of ids) {
      try {
        const spRes = await graphFetch(`${basePath}/${id}/fields`, {
          method: 'PATCH',
          body: JSON.stringify({ Status_N: 'Leida', LeidaAt_N: nowIso }),
        });
        if (spRes.ok) {
          updated++;
        } else {
          const errText = await spRes.text().catch(() => '');
          console.error(`[notifications] PATCH id=${id} failed: ${spRes.status} ${errText}`);
          failed.push({ id, status: spRes.status, error: errText.slice(0, 200) });
        }
      } catch (err: any) {
        console.error(`[notifications] PATCH id=${id} error:`, err);
        failed.push({ id, error: err?.message ?? String(err) });
      }
    }

    if (updated === 0 && failed.length > 0) {
      return res.status(500).json({ ok: false, updated: 0, failed });
    }
    return res.status(200).json({ ok: true, updated, failed });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireAuthAndLocation(handler);
