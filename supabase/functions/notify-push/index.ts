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
 * public.push_dispatch_log con key = id_univoco:status:updated_at:type (insert on conflict do nothing).
 * Una fila puede emitir MÁS de una notificación (ej. un ingreso quirúrgico manda el NEW_TICKET normal
 * + un SURGICAL_ADMISSION a Enfermería) → la key incluye el `type` para que no colisionen.
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
  PRE_TICKET:          'notif_pre_ticket',
  STATUS_UPDATE:       'notif_status_update',
  RECEPTION_CONFIRMED: 'notif_reception_confirmed',
  // Ingreso quirúrgico desde Sala de Espera → SOLO a quien tenga notif_ingreso_quirurgico (Enfermería).
  SURGICAL_ADMISSION:  'notif_ingreso_quirurgico',
};

// Estado inicial de un pre-ticket (Coordinadora pidió cama; espera que Admisión configure el destino).
const PRESOLICITUD = 'Presolicitud';
const newTicketTitle = (workflow?: string) =>
  workflow === 'ITR_TO_FLOOR' ? 'Nueva Solicitud de Ingreso' : 'Nueva Solicitud de Traslado';

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
  // Fail-OPEN cuando la suscripción no trae sectores — mismo criterio que notify-change (ver ahí el
  // razonamiento completo): una sub sin sectores quedaba muda para siempre y en silencio, porque
  // assigned_areas es una foto del login que sólo se regrababa al re-loguear.
  if (!assignedAreas.length) return true;
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
    if (record.status === PRESOLICITUD) {
      // Pre-ticket recién creado por la Coordinadora → aviso a Admisión (permiso notif_pre_ticket)
      // para que configure el destino. NO se avisa a las azafatas todavía (ese push sale al convertir).
      notifType = 'PRE_TICKET';
      title = 'Nueva Solicitud de Cama';
      excludeUserId = record.created_by_id != null ? String(record.created_by_id) : null;
    } else {
      notifType = 'NEW_TICKET';
      // "Ingreso" si el paciente entra desde Sala de Espera (workflow ITR_TO_FLOOR); "Traslado" para el
      // resto (interno / Ingreso a ITR). Pedido de Julieta: identificar el ingreso en la notificación.
      title = newTicketTitle(record.workflow);
      excludeUserId = record.created_by_id != null ? String(record.created_by_id) : null;
    }
  } else if (type === 'UPDATE') {
    if (old_record?.status === record.status) return new Response('no status change', { status: 200 });
    // Conversión de un pre-ticket: Presolicitud → estado vivo (Admisión configuró el destino). Recién
    // acá el traslado se vuelve "real" → se comporta como un alta nueva y avisa a azafatas/limpieza.
    if (old_record?.status === PRESOLICITUD && record.status !== PRESOLICITUD) {
      notifType = 'NEW_TICKET';
      title = newTicketTitle(record.workflow);
      excludeUserId = record.last_actor_id != null ? String(record.last_actor_id) : null;
    } else {
      const label = STATUS_LABELS[record.status];
      if (!label) return new Response('status sin label', { status: 200 }); // WAITING_ROOM u otro
      notifType = record.status === 'Por Consolidar' ? 'RECEPTION_CONFIRMED' : 'STATUS_UPDATE';
      title = label;
      excludeUserId = record.last_actor_id != null ? String(record.last_actor_id) : null;
    }
  } else {
    return new Response('ignored event', { status: 200 });
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) { console.warn('[notify-push] VAPID no configurado'); return new Response('no vapid', { status: 200 }); }

  // ── Roles + suscripciones del entorno (una sola vez; las comparten los despachos) ──
  const { data: roleRows } = await supa.from('roles').select('name, permissions, filter_by_floors').eq('status', 'Activo');
  const roleByName = new Map<string, any>();
  for (const r of roleRows ?? []) roleByName.set(String(r.name).trim().toLowerCase(), r);

  const { data: subRows } = await supa.from('push_subscriptions')
    .select('endpoint, keys, user_id, user_role, assigned_areas, sede, last_seen_at')
    .eq('entorno', String(record.entorno ?? ''));
  const now = Date.now();
  const fresh = (subRows ?? []).filter(s => {
    if (!s.last_seen_at) return true; // fail-open
    const t = Date.parse(s.last_seen_at); return !Number.isFinite(t) || now - t <= STALE_SUB_MS;
  });

  // Despacha UNA notificación: idempotencia (la key incluye el tipo → dos avisos del MISMO evento no
  // colisionan), filtra destinatarios por permiso + área, envía web push y escribe la campanita.
  async function dispatchNotification(p: Params): Promise<{ type: string; sent: number; notified: number; skipped?: string }> {
    const idemKey = `${p.ticketId}:${record.status}:${record.updated_at}:${p.type}`;
    const { error: idemErr } = await supa.from('push_dispatch_log').insert({ idempotency_key: idemKey });
    if (idemErr) {
      if ((idemErr as any).code === '23505') return { type: p.type, sent: 0, notified: 0, skipped: 'already dispatched' };
      console.error('[notify-push] push_dispatch_log:', idemErr.message);
    }

    const reqPerm = NOTIF_TYPE_TO_PERMISSION[p.type];
    const relevant = fresh.filter(s => {
      if (p.excludeUserId != null && s.user_id === p.excludeUserId) return false;
      const roleCfg = roleByName.get(String(s.user_role ?? '').trim().toLowerCase());
      if (!roleCfg) return false;
      if (!reqPerm || !(roleCfg.permissions ?? []).includes(reqPerm)) return false;
      if (roleCfg.filter_by_floors && !subAreaMatches(s.assigned_areas ?? [], p.originAreaName, p.destinationAreaName)) return false;
      return true;
    });
    if (relevant.length === 0) return { type: p.type, sent: 0, notified: 0, skipped: 'no relevant subs' };

    // ── Payloads (tag por evento lógico → el SW colapsa duplicados) ────────────
    const tagBase = `${p.ticketId}-${p.type}-${simpleHash(p.title + p.body)}`;
    const ts = Date.now();
    const genericPayload = JSON.stringify({ title: p.title, body: p.body, ticketId: p.ticketId, type: p.type, tag: `${tagBase}-g`, timestamp: ts });
    const cateringPayload = p.cateringBody
      ? JSON.stringify({ title: p.cateringTitle ?? p.title, body: p.cateringBody, ticketId: p.ticketId, type: p.type, tag: `${tagBase}-c`, timestamp: ts })
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
        traslado_id: p.ticketId,
        user_id: String(sub.user_id),
        title: isCatering ? (p.cateringTitle ?? p.title) : p.title,
        message: isCatering ? (p.cateringBody ?? p.body) : p.body,
        type: p.type,
        status: 'Enviada',
        entorno: p.entorno,
      });
      if (error) console.error('[notify-push] notificaciones insert:', error.message);
    }));

    return { type: p.type, sent: toSend.length, notified: byUser.size };
  }

  const paciente = record.paciente ?? 'Paciente';
  const body = notifType === 'PRE_TICKET'
    // Un pre-ticket no tiene destino todavía → mostramos paciente + movimiento (motivo_cambio).
    ? `${paciente} — ${record.motivo_cambio ?? 'pedido de cama'}`
    : notifType === 'NEW_TICKET'
      ? `${paciente}: ${record.cama_origen} → ${record.cama_destino ?? '?'}`
      : `${paciente}: ${record.cama_origen ?? ''} → ${record.cama_destino ?? ''}`;

  const mainParams: Params = {
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
    mainParams.cateringTitle = 'Traslado concretado';
    mainParams.cateringBody = `${paciente} pasó de ${fromP} a ${toP}`;
  }

  const mainRes = await dispatchNotification(mainParams);

  // ── Ingreso QUIRÚRGICO desde Sala de Espera → aviso EXTRA solo a Enfermería ──
  // Un ingreso (workflow ITR_TO_FLOOR) cuyo paciente es de internación Quirúrgica (tipo_internacion='Q',
  // snapshot guardado al crear el traslado). Va con su tipo propio (SURGICAL_ADMISSION → permiso
  // notif_ingreso_quirurgico) para que Enfermería se entere SOLO de estos ingresos que le interesan,
  // sin recibir todos los traslados. Es un despacho INDEPENDIENTE del NEW_TICKET normal.
  let surgicalRes: { type: string; sent: number; notified: number; skipped?: string } | null = null;
  if (type === 'INSERT' && record.workflow === 'ITR_TO_FLOOR'
      && String(record.tipo_internacion ?? '').trim().toUpperCase() === 'Q') {
    surgicalRes = await dispatchNotification({
      type: 'SURGICAL_ADMISSION',
      title: 'Nuevo ingreso quirúrgico',
      body: `${paciente} — ${record.cama_destino ?? record.cama_origen ?? 'ingreso'}`,
      ticketId: String(record.id_univoco ?? ''),
      entorno: String(record.entorno ?? ''),
      excludeUserId: record.created_by_id != null ? String(record.created_by_id) : null,
      originAreaName: record.cama_origen_area ?? undefined,
      destinationAreaName: record.cama_destino_area ?? undefined,
    });
  }

  return new Response(JSON.stringify({ ok: true, main: mainRes, surgical: surgicalRes }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
