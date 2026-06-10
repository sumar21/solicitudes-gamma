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

import { graphFetch, graphBatchPatchFields } from './graph.js';
import { requireAuth } from './jwt.js';

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
      const userId = Number(user?.id) || 0;
      // Modo historial: ?window=24h trae leídas + no-leídas de las últimas 24h (campanita).
      // Sin el param: solo no-leídas (Status_N='Enviada') para el banner de pendientes.
      const isHistory = String(req.query?.window ?? '').trim() === '24h';

      const baseFilter = `fields/UserId_N eq ${userId} and fields/Entorno_N eq '${ENTORNO}'`;
      const filter = encodeURIComponent(
        isHistory ? baseFilter : `${baseFilter} and fields/Status_N eq 'Enviada'`
      );

      let rows: any[] = [];
      if (isHistory) {
        // Sin tope artificial: paginamos siguiendo @odata.nextLink y traemos TODAS las del
        // usuario; el recorte a 24h se hace en memoria (Fecha_N no está indexada, no se
        // puede filtrar por fecha de forma confiable en OData). MAX_SCAN es solo un
        // backstop anti-runaway (la retención del cron es ~2 días, así que es acotado).
        const MAX_SCAN = 5000;
        let next: string | null =
          `${basePath}?$expand=fields&$filter=${filter}&$top=500&$orderby=fields/Fecha_N desc`;
        while (next && rows.length < MAX_SCAN) {
          const page: any = await graphFetch(next, {
            headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' },
          });
          if (!page.ok) break;
          const pageData: any = await page.json();
          for (const it of pageData.value ?? []) rows.push(it);
          const raw = pageData['@odata.nextLink'] as string | undefined;
          // nextLink es absoluta; graphFetch espera path relativo a /v1.0.
          next = raw ? raw.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, '') : null;
        }
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        rows = rows.filter((item: any) => {
          const t = new Date(String((item.fields as Record<string, unknown>).Fecha_N ?? '')).getTime();
          return Number.isFinite(t) && t >= cutoff;
        });
      } else {
        const spRes = await graphFetch(
          `${basePath}?$expand=fields&$filter=${filter}&$top=50&$orderby=fields/Fecha_N desc`,
          { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
        );
        if (!spRes.ok) return res.status(200).json({ notifications: [] });
        const data = (await spRes.json()) as { value: Record<string, unknown>[] };
        rows = data.value ?? [];
      }

      const notifications = rows.map((item: any) => {
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

    // Modo 4: markAllForUser. Marca TODAS las notifs Enviada del user logueado
    // (no solo el top-50 visible en el banner). Resuelve el backlog acumulado:
    // lookup paginado + PATCH con pool de 8. `remaining>0` si se alcanzó el tope.
    if (body.markAllForUser === true) {
      const MAX = 3000; // con $batch (20 ops/req) marcar miles es rápido
      const filter = encodeURIComponent(
        `fields/UserId_N eq ${userId} and fields/Entorno_N eq '${ENTORNO}' and fields/Status_N eq 'Enviada'`
      );
      try {
        const allIds: string[] = [];
        let next: string | null = `${basePath}?$select=id&$filter=${filter}&$top=500`;
        while (next && allIds.length < MAX) {
          const lookup: any = await graphFetch(next, {
            headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' },
          });
          if (!lookup.ok) {
            const errText = await lookup.text().catch(() => '');
            console.error(`[notifications] markAll lookup failed: ${lookup.status} ${errText}`);
            return res.status(500).json({ ok: false, updated: 0, failed: [{ id: 'lookup', status: lookup.status, error: errText.slice(0, 200) }] });
          }
          const lookupData: any = await lookup.json();
          for (const it of lookupData.value ?? []) allIds.push(String(it.id));
          const raw = lookupData['@odata.nextLink'] as string | undefined;
          // nextLink es absoluta; graphFetch espera path relativo a /v1.0.
          next = raw ? raw.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, '') : null;
        }

        const remaining = next ? 1 : 0; // quedó backlog sin recorrer (alcanzó MAX)
        const { updated, failed } = await graphBatchPatchFields(
          basePath,
          allIds.map(id => ({ id, fields: { Status_N: 'Leida', LeidaAt_N: nowIso } })),
        );

        if (updated === 0 && failed > 0) {
          return res.status(500).json({ ok: false, updated, failed, remaining });
        }
        return res.status(200).json({ ok: true, updated, failed, remaining });
      } catch (err: any) {
        console.error('[notifications] markAllForUser error:', err);
        return res.status(500).json({ ok: false, updated: 0, failed: 1, error: err?.message ?? String(err) });
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

export default requireAuth(handler);
