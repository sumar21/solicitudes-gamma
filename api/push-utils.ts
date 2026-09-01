/**
 * Server-side Web Push (Vercel) para las notis que NO son de traslados: habitación limpia
 * (ROOM_CLEANED), cambio de dieta (DIET_CHANGE), ayuno (FASTING_CHANGE). Las de traslados
 * (NEW_TICKET / STATUS_UPDATE / RECEPTION_CONFIRMED) las manda ahora la Edge Function notify-push
 * vía Database Webhook, no este módulo.
 *
 * MIGRACIÓN: las suscripciones y la campanita viven en Supabase (public.push_subscriptions y
 * public.notificaciones). Este módulo LEE las subs y ESCRIBE la campanita en Supabase (los roles
 * ya salían de Supabase vía role-cache). El dato de dieta/limpieza sigue en SharePoint y el cron
 * que detecta el cambio no se toca: solo cambió de dónde salen las subs y dónde se anota la campanita.
 */

import webpush from 'web-push';
import { simpleHash } from './gamma-client.js';
import { getRoleByName, type RoleConfig } from './role-cache.js';
import { createRecentEventGuard } from './push-dedupe.js';
import { getSupabaseAdmin } from './supabase-admin.js';

// Guard de idempotencia módulo-level: colapsa el doble envío casi-simultáneo (o el reintento en
// un lambda caliente) en un solo envío por evento. Techo per-instancia-de-lambda.
const recentEventGuard = createRecentEventGuard(60_000);

// Entorno: solo se leen subs del entorno actual. Default 'TESTING' para no disparar a usuarios
// reales por un misconfig.
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  ?? '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? '';
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT     ?? 'mailto:admin@grupogamma.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

interface PushParams {
  title: string;
  body: string;
  ticketId?: string;
  type?: string;           // ROOM_CLEANED, DIET_CHANGE, FASTING_CHANGE (traslados van por la Edge Function)
  originArea?: string;
  destinationArea?: string;
  originAreaName?: string;
  destinationAreaName?: string;
  sede?: string;
  excludeUserId?: string;
  cateringTitle?: string;
  cateringBody?: string;
}

interface Subscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userId: string;
  role: string;
  assignedAreas: string[];
  sede: string;
  lastModified: string;  // last_seen_at (heartbeat)
}

// Suscripción "vigente": refrescada hace ≤ STALE_SUB_MS (heartbeat del cliente). Fail-open si no
// hay timestamp.
//
// Era 36h y silenciaba a la mitad del padrón: el heartbeat solo corre con la app ABIERTA (mount /
// foreground / cada 6h), así que un fin de semana (~62h) o un teléfono que nadie abre — que es
// justo el caso de uso del push — vencía la sub. Un envío real medido descartaba 46 de 88 subs.
// A 90 días el corte por tiempo deja de ser el mecanismo de baja: la baja explícita del usuario
// borra sus subs (api/users.ts DELETE) y los 404/410 del push service limpian los dispositivos
// muertos. DEBE coincidir con supabase/functions/notify-push/index.ts (duplicado a propósito).
const STALE_SUB_MS = 90 * 24 * 60 * 60 * 1000;

function isFresh(lastModified: string, now: number): boolean {
  if (!lastModified) return true; // fail-open
  const t = Date.parse(lastModified);
  if (!Number.isFinite(t)) return true;
  return now - t <= STALE_SUB_MS;
}

async function fetchSubscriptions(): Promise<Subscription[]> {
  try {
    const supa = getSupabaseAdmin();
    const { data, error } = await supa
      .from('push_subscriptions')
      .select('endpoint, keys, user_id, user_role, assigned_areas, sede, last_seen_at')
      .eq('entorno', ENTORNO);
    if (error) { console.error('[push-utils] fetchSubscriptions error:', error.message); return []; }

    const now = Date.now();
    const all = (data ?? []).map((s: any) => ({
      endpoint:      String(s.endpoint ?? ''),
      keys:          (s.keys ?? { p256dh: '', auth: '' }) as { p256dh: string; auth: string },
      userId:        String(s.user_id ?? ''),
      role:          String(s.user_role ?? ''),
      assignedAreas: Array.isArray(s.assigned_areas) ? s.assigned_areas.map(String) : [],
      sede:          String(s.sede ?? ''),
      lastModified:  s.last_seen_at ? String(s.last_seen_at) : '',
    })).filter(s => s.endpoint && s.keys.p256dh);

    const fresh = all.filter(s => isFresh(s.lastModified, now));
    const stale = all.length - fresh.length;
    if (stale > 0) console.log(`[push-utils] skipped ${stale} stale subscription(s) (>36h sin refresco)`);
    return fresh;
  } catch (err) {
    console.error('[push-utils] fetchSubscriptions error:', err);
    return [];
  }
}

// HRA = Sala de Espera (Recepción Admisión). Replicado de lib/utils.isHraArea (server compila aparte).
function isHraAreaName(area?: string | null): boolean {
  if (!area) return false;
  const n = area.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return n.includes('recepcion') && n.includes('admision');
}

// Remapea el extremo HRA al piso real del otro extremo (ver lib/utils.effectiveHostessAreas).
export function effectiveAreaNames(originArea?: string, destinationArea?: string): { origin?: string; dest?: string } {
  const remap = (self?: string, other?: string) =>
    isHraAreaName(self) && other && !isHraAreaName(other) ? other : self;
  return { origin: remap(originArea, destinationArea), dest: remap(destinationArea, originArea) };
}

function subAreaMatches(sub: Subscription, params: PushParams): boolean {
  // Fail-OPEN sin sectores — mismo criterio que notify-change / notify-push (ver ahí el razonamiento
  // completo). assigned_areas es una foto tomada al loguearse: hasta que /api/me empezó a refrescar
  // los sectores, una sub grabada antes de cargarlos quedaba muda para siempre y en silencio.
  if (!sub.assignedAreas.length) return true;
  if (sub.assignedAreas.length >= 9) return true; // full access

  const { originArea, destinationArea, originAreaName, destinationAreaName } = params;

  // Con nombres de área reales usamos SOLO match exacto + remapeo HRA (no fuzzy por label, que
  // reintroduciría el cruce HRA que notifica a todas las azafatas).
  if (originAreaName || destinationAreaName) {
    const { origin, dest } = effectiveAreaNames(originAreaName, destinationAreaName);
    return Boolean(
      (origin && sub.assignedAreas.includes(origin)) ||
      (dest && sub.assignedAreas.includes(dest)),
    );
  }

  // Fuzzy legacy contra bed labels (solo cuando no hay nombres de área).
  const matchesLegacy = (bedLabel?: string) => {
    if (!bedLabel) return false;
    return sub.assignedAreas.some(area => bedLabel.includes(area) || area.includes(bedLabel));
  };
  return matchesLegacy(originArea) || matchesLegacy(destinationArea);
}

// Mapeo tipo de notif → permiso requerido. Misma fuente de verdad que lib/permissions.ts.
const NOTIF_TYPE_TO_PERMISSION: Record<string, string> = {
  NEW_TICKET:           'notif_new_ticket',
  SURGICAL_ADMISSION:   'notif_ingreso_quirurgico',
  STATUS_UPDATE:        'notif_status_update',
  RECEPTION_CONFIRMED:  'notif_reception_confirmed',
  DIET_CHANGE:          'notif_diet_change',
  FASTING_CHANGE:       'notif_fasting_change',
  ROOM_CLEANED:         'notif_habitacion_limpia',
  CIRUGIA_MOVE:         'notif_cirugia_cama_progal',
  CX_LISTO_PARA_CIRUGIA:  'notif_cirugia_lista',
  CX_VAN_A_BUSCAR:        'notif_cirugia_camillero',
  CX_EN_TRASLADO:         'notif_cirugia_retirado',
  CX_EN_CIRUGIA:          'notif_cirugia_en_cirugia',
  CX_EN_DEVOLUCION:       'notif_cirugia_volviendo',
  CX_TOLERANCIA_EVALUADA: 'notif_cirugia_finalizada',
};

function isRelevant(sub: Subscription, params: PushParams, roleCfg: RoleConfig | null): boolean {
  const tag = `user=${sub.userId} role=${sub.role}`;

  if (params.excludeUserId && sub.userId === params.excludeUserId) {
    console.log(`[push-utils]  ✗ ${tag} — excluded (trigger user)`);
    return false;
  }
  if (params.sede && sub.sede && sub.sede !== params.sede && sub.sede !== 'SUMAR') {
    console.log(`[push-utils]  ✗ ${tag} — sede mismatch (sub=${sub.sede} push=${params.sede})`);
    return false;
  }
  if (!roleCfg) {
    console.log(`[push-utils]  ✗ ${tag} — role config not found`);
    return false;
  }
  const reqPerm = params.type ? NOTIF_TYPE_TO_PERMISSION[params.type] : undefined;
  if (!reqPerm) {
    console.log(`[push-utils]  ✗ ${tag} — type "${params.type}" not mapped to any permission`);
    return false;
  }
  if (!roleCfg.permissions.includes(reqPerm)) {
    console.log(`[push-utils]  ✗ ${tag} — missing permission ${reqPerm}`);
    return false;
  }
  if (roleCfg.filterByFloors && !subAreaMatches(sub, params)) {
    console.log(`[push-utils]  ✗ ${tag} — areas mismatch (sub=[${sub.assignedAreas.join(',')}] push.origin="${params.originAreaName}" push.dest="${params.destinationAreaName}")`);
    return false;
  }
  console.log(`[push-utils]  ✓ ${tag} — relevant (type=${params.type})`);
  return true;
}

async function deleteSubscription(endpoint: string): Promise<void> {
  try {
    const supa = getSupabaseAdmin();
    await supa.from('push_subscriptions').delete().eq('endpoint', endpoint);
  } catch { /* silent */ }
}

export async function sendPushToSubscribers(params: PushParams): Promise<void> {
  console.log(`[push-utils] Called with: title="${params.title}" type="${params.type}" sede="${params.sede}" excludeUser="${params.excludeUserId}"`);

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('[push-utils] VAPID keys not configured, skipping push');
    return;
  }

  const subs = await fetchSubscriptions();
  console.log(`[push-utils] Found ${subs.length} total subscription(s)`);

  // Pre-cargar config de cada rol único (role-cache cachea 5min).
  const uniqueRoles = Array.from(new Set(subs.map(s => s.role).filter(Boolean)));
  const roleCfgByName = new Map<string, RoleConfig | null>();
  await Promise.all(uniqueRoles.map(async r => { roleCfgByName.set(r, await getRoleByName(r)); }));

  let relevant = subs.filter(s => isRelevant(s, params, roleCfgByName.get(s.role) ?? null));
  console.log(`[push-utils] ${relevant.length} relevant after filtering`);
  if (relevant.length === 0) { console.log('[push-utils] No relevant subscribers, skipping'); return; }

  // Discriminador del EVENTO LÓGICO (título+cuerpo): estable ante re-envío idéntico.
  const eventDiscriminator = simpleHash(`${params.title}${params.body ?? ''}`);
  const dedupeKey = `${params.ticketId ?? 'nt'}:${params.type ?? 'evt'}:${eventDiscriminator}`;
  if (recentEventGuard(dedupeKey)) {
    console.log(`[push-utils] Skipping duplicate event (<60s): ${dedupeKey}`);
    return;
  }

  console.log(`[push-utils] Sending push to ${relevant.length} subscriber(s) for: ${params.title}`);

  const uniqueTagBase = `${params.ticketId ?? 'nt'}-${params.type ?? 'evt'}-${eventDiscriminator}`;
  const hasCateringOverride = !!(params.cateringBody || params.cateringTitle);
  const genericPayload = JSON.stringify({
    title: params.title, body: params.body, ticketId: params.ticketId, type: params.type,
    tag: `${uniqueTagBase}-g`, timestamp: Date.now(),
  });
  const cateringPayload = hasCateringOverride
    ? JSON.stringify({
        title: params.cateringTitle ?? params.title, body: params.cateringBody ?? params.body,
        ticketId: params.ticketId, type: params.type, tag: `${uniqueTagBase}-c`, timestamp: Date.now(),
      })
    : genericPayload;

  // Dedup por endpoint (cinturón contra filas duplicadas). NO por userId (rompería multi-device).
  const seen = new Set<string>();
  relevant = relevant.filter(s => seen.has(s.endpoint) ? false : (seen.add(s.endpoint), true));

  const results = await Promise.allSettled(
    relevant.map(async (sub) => {
      try {
        const isCatering = sub.role.toUpperCase() === 'CATERING';
        const payload = isCatering ? cateringPayload : genericPayload;
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          payload,
          { urgency: 'high', TTL: 60 * 60 },
        );
      } catch (err: any) {
        // Solo 404/410 = sub muerta (desuscrita/rotada) → se borra. El 403 NO se borra a propósito:
        // un 403 puede ser un fallo de auth VAPID GLOBAL del sender (misconfig), y borrar en 403
        // vaciaría TODA la tabla en un broadcast. El chequeo de VAPID client-side (pushSubscription.ts)
        // ya regenera cualquier sub con llave vieja en la próxima apertura, sin ese riesgo.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          console.log(`[push-utils] Removing expired subscription for user ${sub.userId}`);
          await deleteSubscription(sub.endpoint);
        } else {
          console.error(`[push-utils] Push failed for user ${sub.userId}:`, err?.statusCode ?? err);
        }
      }
    }),
  );

  const sent = results.filter(r => r.status === 'fulfilled').length;
  console.log(`[push-utils] Push complete: ${sent}/${relevant.length} delivered`);

  // Campanita en Supabase public.notificaciones: UNA fila por USUARIO por evento (no por sub).
  try {
    const supa = getSupabaseAdmin();
    const notifTargets = Array.from(new Map(relevant.map(s => [String(s.userId), s])).values());
    await Promise.allSettled(
      notifTargets.map(async (sub) => {
        const isCatering = sub.role.toUpperCase() === 'CATERING';
        const { error } = await supa.from('notificaciones').insert({
          traslado_id: params.ticketId ?? '',
          user_id: String(sub.userId),
          title: isCatering ? (params.cateringTitle ?? params.title) : params.title,
          message: isCatering ? (params.cateringBody ?? params.body) : params.body,
          type: params.type ?? '',
          status: 'Enviada',
          entorno: ENTORNO,
        });
        if (error) console.error(`[push-utils] notificaciones insert (user ${sub.userId}):`, error.message);
      }),
    );
  } catch (err) {
    console.error('[push-utils] campanita write error:', err);
  }
}
