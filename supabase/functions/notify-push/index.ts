// deno-lint-ignore-file no-explicit-any
/**
 * Supabase Edge Function: notify-push
 *
 * Disparada por un Database Webhook sobre public.traslados (INSERT + UPDATE, con old_record).
 * Reproduce el envío de Web Push que antes hacía api/push-utils.ts desde Vercel, pero UNA sola vez
 * por cambio de fila commiteado → mata las notificaciones duplicadas ("TIN TIN TIN"): no hay más
 * doble-PATCH ni carrera entre lambdas fríos (el webhook dispara una vez por versión).
 *
 * Lee roles + push_subscriptions de Supabase (service_role, bypassa RLS), reproduce isRelevant
 * (sede/permiso por tipo/filter_by_floors con remapeo HRA), envía el push y escribe la campanita
 * en public.notificaciones (una fila por usuario). Idempotencia ante reintentos por timeout:
 * public.push_dispatch_log con key = id_univoco:status:updated_at (insert on conflict do nothing).
 *
 * Secrets (supabase secrets set): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY,
 * VAPID_PRIVATE_KEY, VAPID_SUBJECT, WEBHOOK_SECRET.
 */
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const VAPID_PUBLIC   = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE  = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT  = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@grupogamma.com';
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') ?? '';

if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// Ver el comentario largo en api/push-utils.ts: era 36h y silenciaba a la mitad del padrón.
// Ambos valores DEBEN coincidir, sino traslados y limpiezas usan criterios distintos.
const STALE_SUB_MS = 90 * 24 * 60 * 60 * 1000;

// TicketStatus (valor persistido en español) → label de la notif. Sin label = no se notifica.
const STATUS_LABELS: Record<string, string> = {
  'Habitacion Lista': 'Habitación Lista',   // IN_TRANSIT
  'En Traslado':      'Traslado en Curso',  // IN_TRANSPORT
  'Por Consolidar':   'Paciente en habitación', // WAITING_CONSOLIDATION → RECEPTION_CONFIRMED
  'Consolidado':      'Traslado Finalizado', // COMPLETED
  'Cancelado':        'Traslado Cancelado',  // REJECTED
  // 'Esperando Habitacion' (WAITING_ROOM) no tiene label → sin push.
};
const NOTIF_TYPE_TO_PERMISSION: Record<string, string> = {
  NEW_TICKET:          'notif_new_ticket',
  STATUS_UPDATE:       'notif_status_update',
  RECEPTION_CONFIRMED: 'notif_reception_confirmed',
};

// DJB2 — para el tag del SW (colapsa el mismo evento lógico en una burbuja).
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

// HRA = Sala de Espera (Recepción Admisión). Replicado de push-utils.ts.
function isHraAreaName(area?: string | null): boolean {
  if (!area) return false;
  const n = area.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return n.includes('recepcion') && n.includes('admision');
}
function effectiveAreaNames(originArea?: string, destArea?: string) {
  const remap = (self?: string, other?: string) =>
    isHraAreaName(self) && other && !isHraAreaName(other) ? other : self;
  return { origin: remap(originArea, destArea), dest: remap(destArea, originArea) };
}
function subAreaMatches(assignedAreas: string[], originAreaName?: string, destAreaName?: string): boolean {
  if (!assignedAreas.length) return false;
  if (assignedAreas.length >= 9) return true; // full access
  const { origin, dest } = effectiveAreaNames(originAreaName, destAreaName);
  return Boolean((origin && assignedAreas.includes(origin)) || (dest && assignedAreas.includes(dest)));
}

const extractRoom = (label?: string): string => {
  if (!label) return '?';
  const m = label.match(/Habitaci[oó]n\s+(\S+)/i); if (m) return m[1];
  const u = label.match(/Unidad\s+([^-]+)/i); if (u) return u[1].trim();
  return label.split(' - ')[0].trim();
};
const extractFloor = (areaName?: string): string => {
  if (!areaName) return '';
  const m = areaName.match(/(\d+)°?\s*Piso/i); if (m) return `Piso ${m[1]}`;
  return areaName.replace(/\s*HPR\s*$/i, '').trim();
};

interface Params {
  type: string; title: string; body: string; ticketId: string; entorno: string;
  excludeUserId: string | null;
  originAreaName?: string; destinationAreaName?: string;
  cateringTitle?: string; cateringBody?: string;
}

Deno.serve(async (req: Request) => {
  // Autorización: header secreto configurado en el Database Webhook.
  if (WEBHOOK_SECRET && req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }
  let payload: any;
  try { payload = await req.json(); } catch { return new Response('bad request', { status: 400 }); }

  const { type, record, old_record } = payload ?? {};
  if (!record) return new Response('no record', { status: 200 });

  // ── Discriminar el tipo de evento desde el cambio de fila ──────────────────
  let notifType: string | null = null;
  let title = '', excludeUserId: string | null = null;
  if (type === 'INSERT') {
    notifType = 'NEW_TICKET';
    title = 'Nueva Solicitud de Traslado';
    excludeUserId = record.created_by_id != null ? String(record.created_by_id) : null;
  } else if (type === 'UPDATE') {
    if (old_record?.status === record.status) return new Response('no status change', { status: 200 });
    const label = STATUS_LABELS[record.status];
    if (!label) return new Response('status sin label', { status: 200 }); // WAITING_ROOM u otro
    notifType = record.status === 'Por Consolidar' ? 'RECEPTION_CONFIRMED' : 'STATUS_UPDATE';
    title = label;
    excludeUserId = record.last_actor_id != null ? String(record.last_actor_id) : null;
  } else {
    return new Response('ignored event', { status: 200 });
  }

  // ── Idempotencia ante reintentos por timeout del webhook ───────────────────
  const idemKey = `${record.id_univoco}:${record.status}:${record.updated_at}`;
  const { error: idemErr } = await supa.from('push_dispatch_log').insert({ idempotency_key: idemKey });
  if (idemErr) {
    // 23505 = ya se despachó esta versión → salir sin re-enviar. Otro error → log y seguir.
    if ((idemErr as any).code === '23505') return new Response('already dispatched', { status: 200 });
    console.error('[notify-push] push_dispatch_log:', idemErr.message);
  }

  const paciente = record.paciente ?? 'Paciente';
  const body = notifType === 'NEW_TICKET'
    ? `${paciente}: ${record.cama_origen} → ${record.cama_destino ?? '?'}`
    : `${paciente}: ${record.cama_origen ?? ''} → ${record.cama_destino ?? ''}`;

  const params: Params = {
    type: notifType, title, body, ticketId: String(record.id_univoco ?? ''),
    entorno: String(record.entorno ?? ''), excludeUserId,
    originAreaName: record.cama_origen_area ?? undefined,
    destinationAreaName: record.cama_destino_area ?? undefined,
  };
  // Override CATERING (solo RECEPTION_CONFIRMED).
  if (notifType === 'RECEPTION_CONFIRMED') {
    const roomO = extractRoom(record.cama_origen), roomD = extractRoom(record.cama_destino);
    const floorO = extractFloor(record.cama_origen_area), floorD = extractFloor(record.cama_destino_area);
    const fromP = floorO ? `Habitación ${roomO} (${floorO})` : `Habitación ${roomO}`;
    const toP   = floorD ? `Habitación ${roomD} (${floorD})` : `Habitación ${roomD}`;
    params.cateringTitle = 'Traslado concretado';
    params.cateringBody = `${paciente} pasó de ${fromP} a ${toP}`;
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) { console.warn('[notify-push] VAPID no configurado'); return new Response('no vapid', { status: 200 }); }

  // ── Roles activos (join case-insensitive por nombre) ───────────────────────
  const { data: roleRows } = await supa.from('roles').select('name, permissions, filter_by_floors').eq('status', 'Activo');
  const roleByName = new Map<string, any>();
  for (const r of roleRows ?? []) roleByName.set(String(r.name).trim().toLowerCase(), r);

  // ── Suscripciones del entorno, frescas (heartbeat ≤ 36h) ───────────────────
  const { data: subRows } = await supa.from('push_subscriptions')
    .select('endpoint, keys, user_id, user_role, assigned_areas, sede, last_seen_at')
    .eq('entorno', params.entorno);
  const now = Date.now();
  const fresh = (subRows ?? []).filter(s => {
    if (!s.last_seen_at) return true; // fail-open
    const t = Date.parse(s.last_seen_at); return !Number.isFinite(t) || now - t <= STALE_SUB_MS;
  });

  const reqPerm = NOTIF_TYPE_TO_PERMISSION[params.type];
  const relevant = fresh.filter(s => {
    if (params.excludeUserId != null && s.user_id === params.excludeUserId) return false;
    const roleCfg = roleByName.get(String(s.user_role ?? '').trim().toLowerCase());
    if (!roleCfg) return false;
    if (!reqPerm || !(roleCfg.permissions ?? []).includes(reqPerm)) return false;
    if (roleCfg.filter_by_floors && !subAreaMatches(s.assigned_areas ?? [], params.originAreaName, params.destinationAreaName)) return false;
    return true;
  });
  if (relevant.length === 0) return new Response('no relevant subs', { status: 200 });

  // ── Payloads (tag por evento lógico → el SW colapsa duplicados) ────────────
  const tagBase = `${params.ticketId}-${params.type}-${simpleHash(params.title + params.body)}`;
  const ts = Date.now();
  const genericPayload = JSON.stringify({ title: params.title, body: params.body, ticketId: params.ticketId, type: params.type, tag: `${tagBase}-g`, timestamp: ts });
  const cateringPayload = params.cateringBody
    ? JSON.stringify({ title: params.cateringTitle ?? params.title, body: params.cateringBody, ticketId: params.ticketId, type: params.type, tag: `${tagBase}-c`, timestamp: ts })
    : genericPayload;

  // ── Envío (dedup por endpoint; a TODOS los endpoints del user para multi-device) ──
  const seen = new Set<string>();
  const toSend = relevant.filter(s => seen.has(s.endpoint) ? false : (seen.add(s.endpoint), true));
  await Promise.allSettled(toSend.map(async (sub) => {
    const isCatering = String(sub.user_role ?? '').toUpperCase() === 'CATERING';
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        isCatering ? cateringPayload : genericPayload,
        { urgency: 'high', TTL: 3600 },
      );
    } catch (err: any) {
      // Solo 404/410 = sub vencida → se borra. El 403 NO (podría ser misconfig VAPID global del
      // sender → borraría toda la tabla en un broadcast). El chequeo client-side ya regenera.
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await supa.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      } else {
        console.error('[notify-push] send failed:', err?.statusCode ?? err?.message ?? err);
      }
    }
  }));

  // ── Campanita: UNA fila por usuario ────────────────────────────────────────
  const byUser = new Map<string, any>();
  for (const s of relevant) if (!byUser.has(String(s.user_id))) byUser.set(String(s.user_id), s);
  await Promise.allSettled([...byUser.values()].map(async (sub) => {
    const isCatering = String(sub.user_role ?? '').toUpperCase() === 'CATERING';
    const { error } = await supa.from('notificaciones').insert({
      traslado_id: params.ticketId,
      user_id: String(sub.user_id),
      title: isCatering ? (params.cateringTitle ?? params.title) : params.title,
      message: isCatering ? (params.cateringBody ?? params.body) : params.body,
      type: params.type,
      status: 'Enviada',
      entorno: params.entorno,
    });
    if (error) console.error('[notify-push] notificaciones insert:', error.message);
  }));

  return new Response(JSON.stringify({ ok: true, sent: toSend.length, notified: byUser.size }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
