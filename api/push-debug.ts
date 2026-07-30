/**
 * POST /api/push-debug — TEMPORAL (diagnóstico).
 *
 * El Service Worker reporta acá cada push que RECIBE, para poder diagnosticar el push en iOS
 * SIN cable / Web Inspector (leemos la tabla public.push_debug desde el server). Sin auth (el SW
 * no tiene JWT — mismo criterio que el DELETE de push-subscribe). NO recibe/guarda el body
 * (tiene nombre de paciente), solo metadata.
 *
 * QUITAR (este endpoint + la tabla push_debug + el fetch en src-sw/sw.ts) cuando el push de iOS
 * quede confirmado.
 */
import { getSupabaseAdmin } from './supabase-admin.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const b = req.body ?? {};
    const supa = getSupabaseAdmin();
    await supa.from('push_debug').insert({
      title:      b.title ?? null,
      type:       b.type ?? null,
      ticket_id:  b.ticketId ?? null,
      is_ios:     typeof b.isIOS === 'boolean' ? b.isIOS : null,
      shown:      typeof b.shown === 'boolean' ? b.shown : null,
      error:      b.error ? String(b.error).slice(0, 300) : null,
      permission: b.permission ?? null,
      ua:         String(req.headers?.['user-agent'] ?? '').slice(0, 200),
    });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(200).json({ ok: false });
  }
}
