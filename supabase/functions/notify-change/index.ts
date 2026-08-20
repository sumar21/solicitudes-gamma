// deno-lint-ignore-file no-explicit-any
/**
 * Supabase Edge Function: notify-change
 *
 * Disparada por Database Webhooks (INSERT) sobre public.dieta_cambios, public.ayuno_cambios,
 * public.cirugia_cambios y public.cirugia_eventos (notificación por paso de la operatoria, Fase B).
 * Reproduce el envío de Web Push que antes hacía api/push-utils.ts desde Vercel para DIET_CHANGE /
 * FASTING_CHANGE, pero UNA sola vez por fila insertada → mata los duplicados ("TIN TIN TIN") del
 * guard en memoria por-lambda. Mismo patrón que notify-push (traslados); acá el "evento" es la fila
 * de cambio que el enrich ya persiste (dieta_cambios / ayuno_cambios).
 *
 * Lee roles + push_subscriptions de Supabase (service_role, bypassa RLS), reproduce isRelevant
 * (sede/permiso por tipo/filter_by_floors con remapeo HRA), envía el push y escribe la campanita en
 * public.notificaciones (una fila por usuario). Idempotencia ante reintentos por timeout:
 * public.push_dispatch_log con key = `${tabla}:${id de fila}` (insert on conflict do nothing).
 *
 * El body se arma de campos de la fila (paciente + tags/detalle + ubicación), igual que notify-push
 * lo arma de la fila de traslado — no se guarda texto pre-armado.
 *
 * Secrets (supabase secrets set, compartidos con notify-push): SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, WEBHOOK_SECRET.
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

// DEBE coincidir con notify-push y push-utils: era 36h y silenciaba a la mitad del padrón (el
// heartbeat solo corre con la app abierta). A 90 días la baja la manejan el DELETE explícito del
// usuario y los 404/410 del push service, no el corte por tiempo.
const STALE_SUB_MS = 90 * 24 * 60 * 60 * 1000;

// dieta/ayuno son de HPR (mismo valor que pasaba push-utils). Un sub de otra sede (que no sea SUMAR,
// el rol transversal) no recibe estas notis.
const PUSH_SEDE = 'HPR';

// Config por tabla de origen del webhook. type = valor persistido en notificaciones.type y clave del
// permiso requerido (NOTIF_TYPE_TO_PERMISSION); title = encabezado de la notif.
const TABLE_CONFIG: Record<string, { type: string; permission: string; title: string }> = {
  dieta_cambios:   { type: 'DIET_CHANGE',    permission: 'notif_diet_change',         title: 'Dieta actualizada' },
  ayuno_cambios:   { type: 'FASTING_CHANGE', permission: 'notif_fasting_change',       title: 'Ayuno actualizado' },
  cirugia_cambios: { type: 'CIRUGIA_MOVE',   permission: 'notif_cirugia_cama_progal',  title: 'Cambio de cama en PROGAL' },
};

// Fase B — notificación POR PASO de la operatoria. La tabla origen es cirugia_eventos (append-only,
// una fila por transición); el `tipo` = estado alcanzado. Solo los pasos acá listados notifican; el
// resto (CANCELADO, etc.) se ignora. paciente/cama salen de un JOIN a cirugia_traslados por cirugia_id.
// Cada permiso es CONFIGURABLE por rol en el ABM (limpieza al retirar, admisión al entrar, catering al
// finalizar, etc.). type = valor guardado en notificaciones.type (mapea al permiso en lib/permissions).
const CX_STEP_CONFIG: Record<string, { type: string; permission: string; title: string }> = {
  LISTO_PARA_CIRUGIA:  { type: 'CX_LISTO_PARA_CIRUGIA',  permission: 'notif_cirugia_lista',      title: 'Listo para cirugía' },
  VAN_A_BUSCAR:        { type: 'CX_VAN_A_BUSCAR',        permission: 'notif_cirugia_camillero',  title: 'Camillero va a buscar' },
  EN_TRASLADO:         { type: 'CX_EN_TRASLADO',         permission: 'notif_cirugia_retirado',   title: 'Paciente retirado a cirugía' },
  EN_CIRUGIA:          { type: 'CX_EN_CIRUGIA',          permission: 'notif_cirugia_en_cirugia', title: 'Paciente en cirugía' },
  EN_DEVOLUCION:       { type: 'CX_EN_DEVOLUCION',       permission: 'notif_cirugia_volviendo',  title: 'Paciente volviendo de cirugía' },
  RECIBIDA:            { type: 'CX_RECIBIDA',            permission: 'notif_cirugia_recibido',   title: 'Paciente recibido de cirugía' },
  TOLERANCIA_EVALUADA: { type: 'CX_TOLERANCIA_EVALUADA', permission: 'notif_cirugia_finalizada', title: 'Evaluación de tolerancia realizada' },
};

// DJB2 — para el tag del SW (colapsa el mismo evento lógico en una burbuja).
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

// HRA = Sala de Espera (Recepción Admisión). Replicado de push-utils.ts / notify-push.
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
// dieta/ayuno traen un solo área (el sector del paciente): origin === dest → el remapeo HRA es no-op,
// igual que cuando push-utils pasaba originAreaName = destinationAreaName = area.
function subAreaMatches(assignedAreas: string[], originAreaName?: string, destAreaName?: string): boolean {
  if (!assignedAreas.length) return false;
  if (assignedAreas.length >= 9) return true; // full access
  const { origin, dest } = effectiveAreaNames(originAreaName, destAreaName);
  return Boolean((origin && assignedAreas.includes(origin)) || (dest && assignedAreas.includes(dest)));
}

// Ubicación legible para el body ("Habitación 413 (Piso 4)"). Replicado de api/room-formatter.ts.
function extractFloor(areaName?: string): string {
  if (!areaName) return '';
  const m = areaName.match(/(\d+)°?\s*Piso/i);
  if (m) return `Piso ${m[1]}`;
  return areaName.replace(/\s*HPR\s*$/i, '').trim();
}
function formatRoom(roomName?: string, areaName?: string): string {
  const room = (roomName ?? '').trim();
  const floor = extractFloor(areaName);
  if (!room) return floor;
  return floor ? `${room} (${floor})` : room;
}

// Compacta el label de cama: "Habitación 417 HPR - Cama 01" → "417 - 01". Réplica de formatBedName.
function formatBedShort(bedName: string): string {
  const m = bedName.match(/Habitaci[oó]n\s+([A-Za-z0-9]+)(?:\s+HPR)?\s*-\s*Cama\s+([A-Za-z0-9]+)/i);
  return m ? `${m[1]} - ${m[2]}` : bedName;
}

Deno.serve(async (req: Request) => {
  // Autorización: header secreto configurado en el Database Webhook (solo si WEBHOOK_SECRET está set,
  // igual que notify-push; en este proyecto está vacío → no se exige header).
  if (WEBHOOK_SECRET && req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }
  let payload: any;
  try { payload = await req.json(); } catch { return new Response('bad request', { status: 400 }); }

  const { type, table, record } = payload ?? {};
  if (type !== 'INSERT' || !record) return new Response('ignored event', { status: 200 });

  const entorno = String(record.entorno ?? '');
  const rowId = String(record.id ?? '');
  if (!rowId) return new Response('no row id', { status: 200 });

  // Actor que originó el evento (solo cirugia_eventos trae usuario_id): se excluye de los destinatarios
  // para que no reciba el push de su propia acción, igual que el camino de traslados (notify-push).
  const actorId = String(record.usuario_id ?? '');

  // ── Idempotencia ante reintentos del webhook: una fila = un despacho ──
  // La marca se ESCRIBE recién al FINAL (tras enviar). Acá sólo CHEQUEAMOS si ya se despachó por
  // completo: si un intento anterior murió por timeout a mitad del envío, no dejó marca → este
  // reintento re-envía. Antes se marcaba ANTES de enviar, y un timeout perdía las notis que faltaban
  // (el reintento veía la marca y respondía "already dispatched" sin reenviar).
  const idemKey = `${table}:${rowId}`;
  const { data: alreadyDispatched } = await supa.from('push_dispatch_log')
    .select('idempotency_key').eq('idempotency_key', idemKey).maybeSingle();
  if (alreadyDispatched) return new Response('already dispatched', { status: 200 });

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) { console.warn('[notify-change] VAPID no configurado'); return new Response('no vapid', { status: 200 }); }

  // ── Config + body según la tabla de origen ─────────────────────────────────
  let cfg: { type: string; permission: string; title: string };
  let title: string;
  let body: string;
  let paciente: string;
  let areaName: string | undefined;

  if (String(table) === 'cirugia_eventos') {
    // Paso de cirugía (Fase B): tipo = estado alcanzado. Solo notifican los pasos de CX_STEP_CONFIG;
    // el resto (CANCELADO, etc.) se ignora. paciente/cama vienen de cirugia_traslados (JOIN por id).
    const stepCfg = CX_STEP_CONFIG[String(record.tipo ?? '')];
    if (!stepCfg) return new Response('paso sin notificacion', { status: 200 });
    const { data: cx } = await supa.from('cirugia_traslados')
      .select('paciente_nombre, cama_origen, area').eq('id', String(record.cirugia_id ?? '')).maybeSingle();
    paciente = String(cx?.paciente_nombre ?? '').trim() || 'Paciente';
    const camaShort = formatBedShort(String(cx?.cama_origen ?? ''));
    body = camaShort ? `${paciente} — ${camaShort}` : paciente;
    areaName = cx?.area ? String(cx.area) : undefined;
    cfg = stepCfg;
    title = cfg.title;
  } else {
    cfg = TABLE_CONFIG[String(table)];
    if (!cfg) return new Response('unknown table', { status: 200 });
    // Body: se arma de la fila (mismo texto que armaba push-utils).
    paciente = String(record.paciente_nombre ?? '').trim() || 'Paciente';
    const roomLabel = formatRoom(record.habitacion, record.area);
    let core: string;
    let appendRoom = true; // dieta/ayuno agregan " — ubicación"; cirugía ya trae las camas en el core.
    title = cfg.title;
    if (cfg.type === 'DIET_CHANGE') {
      const tags = String(record.tags_new ?? '').trim();
      // tags_new se guarda como join '; '; el body histórico usaba ', '. Normalizamos a ', '.
      const tagsLabel = tags ? tags.split(';').map((t: string) => t.trim()).filter(Boolean).join(', ') : 'sin dieta especial';
      core = `${paciente}: ${tagsLabel}`;
    } else if (cfg.type === 'FASTING_CHANGE') {
      const detalle = String(record.detalle ?? '').trim() || 'Ayuno actualizado';
      // Cancelación: el enrich escribe detalle 'Ayuno cancelado' como literal fijo → título propio.
      if (detalle.toLowerCase().includes('cancelad')) { title = 'Ayuno cancelado'; core = paciente; }
      else { core = `${paciente}: ${detalle}`; }
    } else {
      // CIRUGIA_MOVE: PROGAL movió de cama a un paciente en cirugía (detectado por el enrich).
      const prev = String(record.cama_prev ?? '').trim();
      const next = String(record.cama_new ?? '').trim();
      core = prev && next ? `${paciente}: ${prev} → ${next}` : paciente;
      appendRoom = false; // las camas ya están en el core; no repetir la ubicación.
    }
    body = (appendRoom && roomLabel) ? `${core} — ${roomLabel}` : core;
    areaName = record.area ? String(record.area) : undefined;
  }

  // ── Roles activos (join case-insensitive por nombre) ───────────────────────
  const { data: roleRows } = await supa.from('roles').select('name, permissions, filter_by_floors').eq('status', 'Activo');
  const roleByName = new Map<string, any>();
  for (const r of roleRows ?? []) roleByName.set(String(r.name).trim().toLowerCase(), r);

  // ── Suscripciones del entorno, frescas (heartbeat ≤ 90d) ───────────────────
  const { data: subRows } = await supa.from('push_subscriptions')
    .select('endpoint, keys, user_id, user_role, assigned_areas, sede, last_seen_at')
    .eq('entorno', entorno);
  const now = Date.now();
  const fresh = (subRows ?? []).filter(s => {
    if (!s.last_seen_at) return true; // fail-open
    const t = Date.parse(s.last_seen_at); return !Number.isFinite(t) || now - t <= STALE_SUB_MS;
  });

  // ── Filtrado (isRelevant): sede + permiso + filter_by_floors con remapeo HRA ─
  const relevant = fresh.filter(s => {
    if (actorId && String(s.user_id) === actorId) return false; // no auto-notificar al actor de la transición
    const subSede = String(s.sede ?? '');
    if (subSede && subSede !== PUSH_SEDE && subSede !== 'SUMAR') return false;
    const roleCfg = roleByName.get(String(s.user_role ?? '').trim().toLowerCase());
    if (!roleCfg) return false;
    if (!(roleCfg.permissions ?? []).includes(cfg.permission)) return false;
    if (roleCfg.filter_by_floors && !subAreaMatches(s.assigned_areas ?? [], areaName, areaName)) return false;
    return true;
  });
  if (relevant.length === 0) return new Response('no relevant subs', { status: 200 });

  // ── Payload (tag por evento lógico → el SW colapsa duplicados) ─────────────
  const tagBase = `${cfg.type}-${simpleHash(paciente + body)}`;
  const ts = Date.now();
  const pushPayload = JSON.stringify({ title, body, type: cfg.type, tag: tagBase, timestamp: ts });

  // ── Envío (dedup por endpoint; a TODOS los endpoints del user para multi-device) ──
  const seen = new Set<string>();
  const toSend = relevant.filter(s => seen.has(s.endpoint) ? false : (seen.add(s.endpoint), true));
  await Promise.allSettled(toSend.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        pushPayload,
        { urgency: 'high', TTL: 3600 },
      );
    } catch (err: any) {
      // Solo 404/410 = sub vencida → se borra. El 403 NO (podría ser misconfig VAPID global del
      // sender → borraría toda la tabla en un broadcast). El chequeo client-side ya regenera.
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await supa.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      } else {
        console.error('[notify-change] send failed:', err?.statusCode ?? err?.message ?? err);
      }
    }
  }));

  // ── Campanita: UNA fila por usuario (traslado_id vacío: no es un traslado) ──
  const byUser = new Map<string, any>();
  for (const s of relevant) if (!byUser.has(String(s.user_id))) byUser.set(String(s.user_id), s);
  await Promise.allSettled([...byUser.values()].map(async (sub) => {
    const { error } = await supa.from('notificaciones').insert({
      traslado_id: null,
      user_id: String(sub.user_id),
      title,
      message: body,
      type: cfg.type,
      status: 'Enviada',
      entorno,
    });
    if (error) console.error('[notify-change] notificaciones insert:', error.message);
  }));

  // Recién ahora (envío + campanita completos) marcamos el despacho: si un intento previo murió a
  // mitad de camino no dejó marca y este re-envió; ahora que terminó, un futuro reintento se saltea.
  const { error: idemErr } = await supa.from('push_dispatch_log').insert({ idempotency_key: idemKey });
  if (idemErr && (idemErr as any).code !== '23505') console.error('[notify-change] push_dispatch_log:', idemErr.message);

  return new Response(JSON.stringify({ ok: true, table, type: cfg.type, sent: toSend.length, notified: byUser.size }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
