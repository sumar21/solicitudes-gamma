/**
 * /api/push-subscribe — alta/baja de suscripciones Web Push en SP "09.PushSubscriptions".
 *
 * POST   (requiere auth): body { endpoint, keys:{p256dh,auth}, userId, role, assignedAreas, sede }
 *        Crea o actualiza la fila por endpoint+entorno. Idempotente: si hubiera filas
 *        duplicadas del mismo endpoint (carrera/throttle en un alta previa), conserva una
 *        y borra el resto.
 * DELETE (SIN auth): body { endpoint }. Borra TODAS las filas de ese endpoint en el entorno.
 *        No exige token porque el logout también ocurre con la sesión ya expirada (auto-logout
 *        por vencimiento / revocación de ubicación) — si exigiéramos auth, esos casos nunca
 *        limpiarían la suscripción y el dispositivo seguiría recibiendo push. El endpoint es
 *        un secreto inadivinable (URL larga aleatoria del push service), así que identificar
 *        por endpoint es seguro.
 */

import { graphFetch } from './graph.js';
import { requireAuth } from './jwt.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = '648fde7b-89d2-40ac-bc4a-63661508b50a'; // 09.PushSubscriptions

// Entorno: filtra y etiqueta las subs para que prod y testing no se crucen
// (un mismo browser puede suscribirse en ambos entornos sin colisionar).
// Default seguro 'TESTING'.
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

const PREFER_HDR = { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } as const;

// Devuelve todas las filas (id) de un endpoint en el entorno actual.
async function findRowsByEndpoint(basePath: string, endpoint: string): Promise<string[]> {
  const filter = encodeURIComponent(
    `fields/Endpoint_PS eq '${endpoint.replace(/'/g, "''")}' and fields/Entorno_PS eq '${ENTORNO}'`,
  );
  const r = await graphFetch(`${basePath}?$expand=fields&$filter=${filter}&$top=100`, { headers: PREFER_HDR });
  if (!r.ok) return [];
  const data = (await r.json()) as { value?: Record<string, unknown>[] };
  return (data.value ?? []).map(it => String(it.id));
}

// Poda best-effort por-usuario: conserva las `keep` filas más frescas del usuario en el
// entorno y borra el resto. Acota el fan-out de push que sufre un tercero pasivo cuando un
// mismo user acumula endpoints viejos/rotados (root-cause de las notis duplicadas). Ordena
// por lastModifiedDateTime DESC → la fila recién upserteada sobrevive siempre, y un 2do
// device real (heartbeat cada 6h vía touchPushSubscription) se mantiene fresco y no se poda.
// Nunca bloquea ni falla el alta: la query no-indexada (UserId_PS) puede fallar al azar (SP).
async function prunePerUser(basePath: string, userId: string, keep: number): Promise<void> {
  if (!userId) return; // sin user no hay a quién podar (evita borrar filas con UserId vacío)
  try {
    const filter = encodeURIComponent(
      `fields/UserId_PS eq '${userId.replace(/'/g, "''")}' and fields/Entorno_PS eq '${ENTORNO}'`,
    );
    const r = await graphFetch(`${basePath}?$expand=fields&$filter=${filter}&$top=100`, { headers: PREFER_HDR });
    if (!r.ok) return;
    const data = (await r.json()) as { value?: { id: string; lastModifiedDateTime?: string }[] };
    // lastModifiedDateTime es ISO 8601 → orden lexicográfico = cronológico; DESC = más nuevo primero.
    const rows = (data.value ?? [])
      .slice()
      .sort((a, b) => String(b.lastModifiedDateTime ?? '').localeCompare(String(a.lastModifiedDateTime ?? '')));
    for (const row of rows.slice(keep)) {
      await graphFetch(`${basePath}/${row.id}`, { method: 'DELETE' });
    }
    if (rows.length > keep) console.log(`[push-subscribe] Pruned ${rows.length - keep} stale endpoint(s) for user ${userId}`);
  } catch (err: any) {
    console.error('[push-subscribe] prune error (best-effort):', err);
  }
}

// ── DELETE — baja en logout (sin auth) ────────────────────────────────────────
async function handleDelete(req: any, res: any, basePath: string) {
  const { endpoint } = req.body ?? {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  try {
    const ids = await findRowsByEndpoint(basePath, endpoint);
    for (const id of ids) {
      await graphFetch(`${basePath}/${id}`, { method: 'DELETE' });
    }
    if (ids.length) console.log(`[push-subscribe] Deleted ${ids.length} subscription row(s) for endpoint`);
    return res.status(200).json({ ok: true, deleted: ids.length });
  } catch (err: any) {
    console.error('[push-subscribe] DELETE error:', err);
    return res.status(200).json({ ok: true }); // nunca bloquear el logout
  }
}

// ── POST — alta/actualización (requiere auth) ─────────────────────────────────
async function handlePost(req: any, res: any, basePath: string) {
  const { endpoint, keys, userId, role, assignedAreas, sede } = req.body ?? {};
  if (!endpoint || !keys) return res.status(400).json({ error: 'endpoint and keys required' });

  try {
    const fields = {
      Endpoint_PS: endpoint,
      Keys_PS: JSON.stringify(keys),
      UserId_PS: String(userId ?? ''),
      UserRole_PS: String(role ?? ''),
      AssignedAreas_PS: String(assignedAreas ?? ''),
      Sede_PS: String(sede ?? 'HPR'),
      Entorno_PS: ENTORNO,
    };

    const ids = await findRowsByEndpoint(basePath, endpoint);
    if (ids.length > 0) {
      // Actualiza la primera fila y elimina duplicados si los hubiera (idempotencia).
      await graphFetch(`${basePath}/${ids[0]}/fields`, { method: 'PATCH', body: JSON.stringify(fields) });
      for (const dupId of ids.slice(1)) {
        await graphFetch(`${basePath}/${dupId}`, { method: 'DELETE' });
      }
      if (ids.length > 1) console.log(`[push-subscribe] Deduped ${ids.length - 1} duplicate row(s) for user ${userId}`);
      await prunePerUser(basePath, String(userId ?? ''), 5);
      return res.status(200).json({ ok: true, updated: true, deduped: ids.length - 1 });
    }

    // No existía: crear.
    const spRes = await graphFetch(basePath, { method: 'POST', body: JSON.stringify({ fields }) });
    if (!spRes.ok) {
      const errText = await spRes.text();
      console.error('[push-subscribe] SP create failed:', spRes.status, errText);
      return res.status(500).json({ error: 'Failed to save subscription' });
    }
    console.log(`[push-subscribe] Created subscription for user ${userId}`);
    await prunePerUser(basePath, String(userId ?? ''), 5);
    return res.status(200).json({ ok: true, created: true });
  } catch (err: any) {
    console.error('[push-subscribe] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!SITE_ID || !LIST_ID) return res.status(503).json({ error: 'SharePoint not configured' });

  const basePath = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;

  // DELETE sin auth (ver cabecera del archivo). POST exige token válido.
  if (req.method === 'DELETE') return handleDelete(req, res, basePath);
  if (req.method === 'POST') return requireAuth((rq, rs) => handlePost(rq, rs, basePath))(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}
