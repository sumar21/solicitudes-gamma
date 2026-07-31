/**
 * /api/push-subscribe — alta/baja de suscripciones Web Push en Supabase public.push_subscriptions.
 *
 * POST   (requiere auth): body { endpoint, keys:{p256dh,auth}, userId, role, assignedAreas, sede }
 *        UPSERT por endpoint. El índice UNIQUE(endpoint) garantiza UNA fila por dispositivo:
 *        el bug de suscripciones duplicadas (que en SP requería findRowsByEndpoint + dedup manual
 *        + prunePerUser, todo racy) se vuelve estructuralmente imposible. Actualiza last_seen_at
 *        (heartbeat) en cada alta/refresco → el sender descarta las stale (>36h).
 * DELETE (SIN auth): body { endpoint }. Borra la fila de ese endpoint (logout).
 *        No exige token porque el logout también ocurre con la sesión ya expirada (auto-logout por
 *        vencimiento / revocación de ubicación) — si exigiéramos auth, esos casos nunca limpiarían
 *        la suscripción. El endpoint es un secreto inadivinable (URL larga del push service).
 */
import { requireAuth } from './jwt.js';
import { getSupabaseAdmin } from './supabase-admin.js';

const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

// assignedAreas puede llegar como array (nuevo) o como string ';'-joined (compat con el cliente
// actual). En Supabase la columna es text[]; normalizamos siempre a array.
function toAreas(x: unknown): string[] {
  if (Array.isArray(x)) return x.map(String).filter(Boolean);
  return String(x ?? '').split(';').map(s => s.trim()).filter(Boolean);
}

async function handlePost(req: any, res: any) {
  const { endpoint, keys, userId, role, assignedAreas, sede } = req.body ?? {};
  if (!endpoint || !keys) return res.status(400).json({ error: 'endpoint and keys required' });
  try {
    const supa = getSupabaseAdmin();
    const { error } = await supa.from('push_subscriptions').upsert(
      {
        endpoint: String(endpoint),
        keys,                              // jsonb { p256dh, auth }
        user_id: String(userId ?? ''),
        user_role: String(role ?? ''),
        assigned_areas: toAreas(assignedAreas),
        sede: String(sede ?? 'HPR'),
        entorno: ENTORNO,
        last_seen_at: new Date().toISOString(),
        version: String(req.body?.version ?? ''), // versión del build del cliente (captura en login/heartbeat)
      },
      { onConflict: 'endpoint' },          // UNIQUE(endpoint) → alta idempotente, sin duplicados
    );
    if (error) {
      console.error('[push-subscribe] upsert failed:', error.message);
      return res.status(500).json({ error: 'Failed to save subscription' });
    }
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('[push-subscribe] POST error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function handleDelete(req: any, res: any) {
  const { endpoint } = req.body ?? {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  try {
    // endpoint es UNIQUE global → borra la única fila del dispositivo (sin filtrar por entorno).
    const supa = getSupabaseAdmin();
    const { error } = await supa.from('push_subscriptions').delete().eq('endpoint', String(endpoint));
    if (error) console.error('[push-subscribe] DELETE error:', error.message);
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('[push-subscribe] DELETE error:', err);
    return res.status(200).json({ ok: true }); // nunca bloquear el logout
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // DELETE sin auth (ver cabecera). POST exige token válido.
  if (req.method === 'DELETE') return handleDelete(req, res);
  if (req.method === 'POST') return requireAuth((rq: any, rs: any) => handlePost(rq, rs))(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}
