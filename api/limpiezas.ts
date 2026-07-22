/**
 * Vercel serverless — CRUD para "14.Limpiezas" (limpiezas de habitaciones por azafatas).
 *
 * GET    /api/limpiezas   → limpiezas activas (overlay "Limpia" vigente)
 * GET    /api/limpiezas?history=1&from=YYYY-MM-DD&to=YYYY-MM-DD → histórico (cerradas por fecha de cierre)
 * POST   /api/limpiezas   → marcar limpia (upsert) { bedLabel, bedCode, roomCode, area, userId, userName }
 * PATCH  /api/limpiezas   → cerrar una limpieza   { bedLabel | spItemId, reason }  reason ∈ ANULADA|TICKET|GAMMA|CONSOLIDADO
 *
 * Modelo: una limpieza = una cama que una azafata marcó limpia mientras PROGAL la
 * reportaba "En preparación". El overlay del front (mergeBeds) la muestra disponible
 * sobre lo que reporta Gamma — PROGAL es read-only, esto NO escribe a PROGAL.
 *
 * Ciclo de vida (Opción B — atado al traslado): la limpieza se cierra (Status_L=Inactivo)
 * cuando se crea un traslado con destino en esa cama (TICKET) o cuando Gamma saca la cama
 * de "En preparación" (GAMMA). El azafata puede deshacerla a mano (ANULADA).
 *
 * Setup: correr scripts/create-limpiezas-list.mts y setear LIMPIEZAS_LIST_ID en envs
 * (o hardcodear el LIST_ID acá como el resto de los endpoints).
 */

import { graphFetch }  from './graph.js';
import { requireAuth } from './jwt.js';
import { sendPushToSubscribers } from './push-utils.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = (process.env.LIMPIEZAS_LIST_ID ?? '3665d496-0e52-465e-b40f-54ca39cd5856').trim(); // 14.Limpiezas

// Entorno: separa producción y testing en la misma lista. Default seguro 'TESTING'.
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

const esc = (s: unknown) => String(s ?? '').replace(/'/g, "''");

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!SITE_ID) return res.status(503).json({ error: 'SHAREPOINT_SITE_ID not configured' });
  if (!LIST_ID) {
    // La lista todavía no se aprovisionó: el front trata esto como "sin limpiezas".
    if (req.method === 'GET') return res.status(200).json({ cleanings: [] });
    return res.status(503).json({ error: 'LIMPIEZAS_LIST_ID not configured — run scripts/create-limpiezas-list.mts' });
  }

  const basePath = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;

  // ── GET — histórico (SOLO limpiezas cerradas: Status_L='Inactivo') ─────────
  if (req.method === 'GET' && String(req.query?.history ?? '') === '1') {
    try {
      const isDate = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''));
      const from = isDate(req.query?.from) ? String(req.query.from) : '';
      const to   = isDate(req.query?.to)   ? String(req.query.to)   : '';
      // Filtramos en SP sólo por Status+Entorno (columnas indexadas) y el rango de fecha
      // en JS sobre FechaCierre_L — evita el filtro OData sobre DateTime (frágil, columna
      // no indexada). El volumen de cerradas es chico; si crece >5k, indexar FechaCierre_L.
      const filter = encodeURIComponent(`fields/Status_L eq 'Inactivo' and fields/Entorno_L eq '${ENTORNO}'`);
      const spRes = await graphFetch(
        `${basePath}?$expand=fields&$filter=${filter}&$top=2000`,
        { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
      );
      if (!spRes.ok) { console.error('[limpiezas] history GET failed:', spRes.status); return res.status(200).json({ cleanings: [] }); }
      const data = (await spRes.json()) as { value: Record<string, unknown>[] };
      const fromMs = from ? Date.parse(`${from}T00:00:00Z`) : -Infinity;
      const toMs   = to   ? Date.parse(`${to}T23:59:59Z`)   : Infinity;
      const cleanings = (data.value ?? [])
        .map((item: any) => {
          const f = item.fields as Record<string, unknown>;
          return {
            spItemId: String(item.id),
            bedLabel: String(f.CamaLabel_L ?? ''),
            area:     String(f.Area_L ?? ''),
            by:       String(f.AzafataNombre_L ?? ''),
            at:       String(f.FechaLimpieza_L ?? ''),
            closedAt: String(f.FechaCierre_L ?? ''),
            reason:   String(f.MotivoCierre_L ?? ''),
          };
        })
        .filter((c) => {
          const t = Date.parse(c.closedAt);
          return !isNaN(t) && t >= fromMs && t <= toMs;
        });
      return res.status(200).json({ cleanings });
    } catch (err: any) {
      console.error('[limpiezas] history GET error:', err);
      return res.status(200).json({ cleanings: [] });
    }
  }

  // ── GET — limpiezas activas ───────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const filter = encodeURIComponent(`fields/Status_L eq 'Activo' and fields/Entorno_L eq '${ENTORNO}'`);
      const spRes = await graphFetch(
        `${basePath}?$expand=fields&$filter=${filter}&$top=500`,
        { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
      );
      if (!spRes.ok) { console.error('[limpiezas] GET failed:', spRes.status); return res.status(200).json({ cleanings: [] }); }
      const data = (await spRes.json()) as { value: Record<string, unknown>[] };
      const cleanings = (data.value ?? []).map((item: any) => {
        const f = item.fields as Record<string, unknown>;
        return {
          spItemId:  String(item.id),
          bedLabel:  String(f.CamaLabel_L ?? ''),
          bedCode:   String(f.CamaCodigo_L ?? ''),
          roomCode:  String(f.Habitacion_L ?? ''),
          area:      String(f.Area_L ?? ''),
          by:        String(f.AzafataNombre_L ?? ''),
          byId:      String(f.AzafataId_L ?? ''),
          at:        String(f.FechaLimpieza_L ?? ''),
        };
      });
      return res.status(200).json({ cleanings });
    } catch (err: any) {
      console.error('[limpiezas] GET error:', err);
      return res.status(200).json({ cleanings: [] });
    }
  }

  // ── POST — marcar limpia (upsert por cama + entorno) ──────────────────────
  if (req.method === 'POST') {
    const { bedLabel, bedCode, roomCode, area, userId, userName } = req.body ?? {};
    if (!bedLabel) return res.status(400).json({ error: 'bedLabel is required' });
    const nowIso = new Date().toISOString();

    // "Habitación Limpia" → push + campanita para los roles que tengan tildado
    // `notif_habitacion_limpia` en el ABM (pensado para Admisión, pero configurable).
    // sendPushToSubscribers ya filtra por permiso del rol, sede y pisos asignados, y
    // persiste la fila per-usuario en 10.Notificaciones. Non-blocking: un fallo de push
    // jamás debe hacer fallar la marca de limpieza (mismo idiom que api/tickets.ts).
    const notifyRoomCleaned = () => {
      const cama = bedCode ? ` · Cama ${bedCode}` : '';
      sendPushToSubscribers({
        title: 'Habitación Limpia',
        body: `Hab. ${roomCode || '?'}${cama} — marcada limpia por ${userName || 'azafata'}.`,
        type: 'ROOM_CLEANED',
        // Área real para el match por pisos; el label de cama como fallback fuzzy.
        originArea: String(bedLabel), destinationArea: String(bedLabel),
        originAreaName: String(area ?? ''), destinationAreaName: String(area ?? ''),
        sede: String(req.user?.sede ?? 'HPR'),
        excludeUserId: String(userId ?? req.user?.id ?? ''),
      }).catch((err: any) => console.error('[limpiezas] Push error:', err));
    };

    try {
      // ¿Ya hay una limpieza activa para esta cama en este entorno? → refrescar.
      const filter = encodeURIComponent(
        `fields/CamaLabel_L eq '${esc(bedLabel)}' and fields/Status_L eq 'Activo' and fields/Entorno_L eq '${ENTORNO}'`,
      );
      const existing = await graphFetch(
        `${basePath}?$expand=fields&$filter=${filter}&$top=1`,
        { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
      );
      if (existing.ok) {
        const data = (await existing.json()) as { value: Record<string, unknown>[] };
        if (data.value?.length > 0) {
          const itemId = String(data.value[0].id);
          await graphFetch(`${basePath}/${itemId}/fields`, {
            method: 'PATCH',
            body: JSON.stringify({ AzafataId_L: String(userId ?? ''), AzafataNombre_L: String(userName ?? ''), FechaLimpieza_L: nowIso }),
          });
          notifyRoomCleaned(); // re-marca de una limpieza vigente: también es el evento
          return res.status(200).json({ ok: true, spItemId: itemId });
        }
      }

      const spRes = await graphFetch(basePath, {
        method: 'POST',
        body: JSON.stringify({
          fields: {
            Title: '[sumar]',
            CamaLabel_L: String(bedLabel),
            CamaCodigo_L: String(bedCode ?? ''),
            Habitacion_L: String(roomCode ?? ''),
            Area_L: String(area ?? ''),
            Status_L: 'Activo',
            MotivoCierre_L: '',
            AzafataId_L: String(userId ?? ''),
            AzafataNombre_L: String(userName ?? ''),
            FechaLimpieza_L: nowIso,
            Entorno_L: ENTORNO,
          },
        }),
      });
      if (!spRes.ok) {
        const errText = await spRes.text();
        console.error('[limpiezas] POST failed:', spRes.status, errText);
        return res.status(500).json({ error: 'Failed to create cleaning' });
      }
      const created = (await spRes.json()) as { id: string };
      console.log(`[limpiezas] Cama "${bedLabel}" marcada limpia por ${userName ?? userId}`);
      notifyRoomCleaned();
      return res.status(200).json({ ok: true, spItemId: String(created.id) });
    } catch (err: any) {
      console.error('[limpiezas] POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH — cerrar una limpieza ───────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { spItemId, bedLabel, reason } = req.body ?? {};
    const motivo = ['ANULADA', 'TICKET', 'GAMMA', 'CONSOLIDADO'].includes(String(reason)) ? String(reason) : 'ANULADA';
    const nowIso = new Date().toISOString();

    try {
      let itemId = spItemId ? String(spItemId) : '';
      if (!itemId) {
        if (!bedLabel) return res.status(400).json({ error: 'spItemId or bedLabel required' });
        const filter = encodeURIComponent(
          `fields/CamaLabel_L eq '${esc(bedLabel)}' and fields/Status_L eq 'Activo' and fields/Entorno_L eq '${ENTORNO}'`,
        );
        const existing = await graphFetch(
          `${basePath}?$expand=fields&$filter=${filter}&$top=1`,
          { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
        );
        if (existing.ok) {
          const data = (await existing.json()) as { value: Record<string, unknown>[] };
          if (data.value?.length > 0) itemId = String(data.value[0].id);
        }
      }
      if (!itemId) return res.status(200).json({ ok: true, message: 'No active cleaning found' });

      await graphFetch(`${basePath}/${itemId}/fields`, {
        method: 'PATCH',
        body: JSON.stringify({ Status_L: 'Inactivo', MotivoCierre_L: motivo, FechaCierre_L: nowIso }),
      });
      return res.status(200).json({ ok: true });
    } catch (err: any) {
      console.error('[limpiezas] PATCH error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireAuth(handler);
