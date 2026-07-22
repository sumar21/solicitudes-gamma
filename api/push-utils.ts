/**
 * Server-side Web Push utility.
 * Fetches subscriptions from SharePoint, filters by role/area, sends push notifications.
 */

import webpush from 'web-push';
import { graphFetch } from './graph.js';
import { simpleHash } from './gamma-client.js';
import { getRoleByName, type RoleConfig } from './role-cache.js';
import { createRecentEventGuard } from './push-dedupe.js';

// Guard de idempotencia módulo-level: colapsa el doble PATCH casi-simultáneo (o el
// reintento en un lambda caliente) en un solo envío por evento. Ver push-dedupe.ts.
// ponytail: per-instancia-de-lambda; NO cubre 2 lambdas fríos en paralelo.
const recentEventGuard = createRecentEventGuard(60_000);

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = '648fde7b-89d2-40ac-bc4a-63661508b50a'; // 09.PushSubscriptions
const NOTIF_LIST_ID = '240f00dd-715b-4c78-9661-3147b7650a0f'; // 10.Notificaciones

// Entorno: el server-side push solo lee subs del entorno actual. Default 'TESTING'
// para que un misconfig nunca dispare push a usuarios reales sin querer.
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
  type?: string;           // NEW_TICKET, STATUS_UPDATE, RECEPTION_CONFIRMED
  originArea?: string;
  destinationArea?: string;
  // Actual area names (not bed labels). When present, used for precise area matching
  // of subscribers filtered by assignedAreas (e.g. CATERING).
  originAreaName?: string;
  destinationAreaName?: string;
  sede?: string;
  excludeUserId?: string;  // don't notify the user who triggered the action
  // Optional override for CATERING subscribers. If present, these values
  // replace title/body ONLY for subs with role === 'CATERING'.
  cateringTitle?: string;
  cateringBody?: string;
}

interface Subscription {
  spItemId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userId: string;
  role: string;
  assignedAreas: string[];
  sede: string;
  lastModified: string;  // lastModifiedDateTime de SP (se bumpea en cada alta/heartbeat)
}

// Suscripción "vigente": refrescada hace ≤ STALE_SUB_MS. El cliente hace un heartbeat
// (re-POST de la sub) al abrir la app, al pasar a foreground y cada 6h mientras esté
// abierta. Una sub no tocada en >36h = dispositivo que dejó de usar la app (logout que
// no llegó a limpiar, token vencido con la app cerrada, PWA abandonada). NO le mandamos
// push: es la causa de "recibo notis deslogueado". Fail-open: si no hay timestamp, se
// envía igual (nunca cortamos por un dato faltante).
const STALE_SUB_MS = 36 * 60 * 60 * 1000;

function isFresh(lastModified: string, now: number): boolean {
  if (!lastModified) return true; // fail-open
  const t = Date.parse(lastModified);
  if (!Number.isFinite(t)) return true;
  return now - t <= STALE_SUB_MS;
}

async function fetchSubscriptions(sede?: string): Promise<Subscription[]> {
  if (!SITE_ID || !LIST_ID) return [];
  const basePath = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;

  try {
    // Filtramos SP-side por entorno para no traer subs de otro entorno (y bajar payload).
    const filter = encodeURIComponent(`fields/Entorno_PS eq '${ENTORNO}'`);
    // PAGINAR todas las subs del entorno (antes cortaba en $top=500 SIN paginar). Con la lista
    // crecida (>3000 subs) y orden por id (más viejas primero), esas 500 eran dispositivos
    // viejos: cuando TODAS superaron las 36h, fetchSubscriptions devolvía 0 frescas → push-utils
    // no mandaba push NI escribía en 10.Notificaciones → "no llegan push" + campanita vacía.
    // Las subs frescas reales quedaban fuera de la ventana de 500. $top sigue siendo el tamaño
    // de página; el nextLink trae el resto. MAX_SCAN es backstop anti-runaway.
    const MAX_SCAN = 20000;
    const rows: Record<string, unknown>[] = [];
    let next: string | null = `${basePath}?$expand=fields&$filter=${filter}&$top=500`;
    while (next && rows.length < MAX_SCAN) {
      const page = await graphFetch(next, { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } });
      if (!page.ok) break;
      const pageData = (await page.json()) as { value?: Record<string, unknown>[]; '@odata.nextLink'?: string };
      for (const it of pageData.value ?? []) rows.push(it);
      const raw = pageData['@odata.nextLink'];
      // nextLink es absoluta; graphFetch espera path relativo a /v1.0.
      next = raw ? raw.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, '') : null;
    }

    const now = Date.now();
    const all = rows.map((item: any) => {
      const f = item.fields as Record<string, unknown>;
      let keys = { p256dh: '', auth: '' };
      try { keys = JSON.parse(String(f.Keys_PS ?? '{}')); } catch { /* invalid */ }
      return {
        spItemId: String(item.id),
        endpoint: String(f.Endpoint_PS ?? ''),
        keys,
        userId: String(f.UserId_PS ?? ''),
        role: String(f.UserRole_PS ?? ''),
        assignedAreas: String(f.AssignedAreas_PS ?? '').split(';').filter(Boolean),
        sede: String(f.Sede_PS ?? ''),
        lastModified: String(item.lastModifiedDateTime ?? ''),
      };
    }).filter(s => s.endpoint && s.keys.p256dh);

    const fresh = all.filter(s => isFresh(s.lastModified, now));
    const stale = all.length - fresh.length;
    if (stale > 0) console.log(`[push-utils] skipped ${stale} stale subscription(s) (>36h sin refresco)`);
    return fresh;
  } catch (err) {
    console.error('[push-utils] fetchSubscriptions error:', err);
    return [];
  }
}

// HRA = Sala de Espera (Recepción Admisión). Replicado de lib/utils.isHraArea
// porque el server compila aparte (mismo patrón que NOTIF_TYPE_TO_PERMISSION).
// Mantener en sync con el cliente.
function isHraAreaName(area?: string | null): boolean {
  if (!area) return false;
  const n = area.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return n.includes('recepcion') && n.includes('admision');
}

// Remapea el extremo HRA al piso real del otro extremo (ver lib/utils.effectiveHostessAreas).
// La Sala de Espera la tienen todas las azafatas, así que matchear por HRA notificaría a
// todas: cuando un extremo es HRA y el otro es un piso real, ese extremo se vuelve el piso real.
export function effectiveAreaNames(originArea?: string, destinationArea?: string): { origin?: string; dest?: string } {
  const remap = (self?: string, other?: string) =>
    isHraAreaName(self) && other && !isHraAreaName(other) ? other : self;
  return { origin: remap(originArea, destinationArea), dest: remap(destinationArea, originArea) };
}

// True if the given subscription's assignedAreas intersect any of the ticket's
// origin/destination areas. Prefers the exact area names (originAreaName /
// destinationAreaName) when provided, and falls back to the bed label matching
// kept for backwards compatibility.
function subAreaMatches(sub: Subscription, params: PushParams): boolean {
  if (!sub.assignedAreas.length) return false;
  // If the subscriber has 9+ areas we consider it "full access" — this is how
  // existing HOSTESS users end up receiving everything.
  if (sub.assignedAreas.length >= 9) return true;

  const { originArea, destinationArea, originAreaName, destinationAreaName } = params;

  // Si tenemos nombres de área reales (las notifs de cambio de estado y, ahora,
  // también NEW_TICKET los mandan), usamos SOLO el match exacto con remapeo de HRA.
  // No caemos al fuzzy por label de cama, que reintroduciría el cruce (la azafata
  // tiene HRA en sus áreas y el label del extremo HRA matchearía igual).
  if (originAreaName || destinationAreaName) {
    const { origin, dest } = effectiveAreaNames(originAreaName, destinationAreaName);
    return Boolean(
      (origin && sub.assignedAreas.includes(origin)) ||
      (dest && sub.assignedAreas.includes(dest)),
    );
  }

  // Legacy fuzzy matching against bed labels (solo cuando no hay nombres de área)
  const matchesLegacy = (bedLabel?: string) => {
    if (!bedLabel) return false;
    return sub.assignedAreas.some(area => bedLabel.includes(area) || area.includes(bedLabel));
  };
  return matchesLegacy(originArea) || matchesLegacy(destinationArea);
}

// Mapeo tipo de notif → permiso requerido. Misma fuente de verdad que
// lib/permissions.ts del cliente (duplicada intencionalmente — server compila aparte).
const NOTIF_TYPE_TO_PERMISSION: Record<string, string> = {
  NEW_TICKET:           'notif_new_ticket',
  STATUS_UPDATE:        'notif_status_update',
  RECEPTION_CONFIRMED:  'notif_reception_confirmed',
  DIET_CHANGE:          'notif_diet_change',
  FASTING_CHANGE:       'notif_fasting_change',
  ROOM_CLEANED:         'notif_habitacion_limpia',
};

// Decide si una suscripción es relevante para el push actual. Filtra por:
//  · sede / excludeUser (no son permisos — comportamiento universal)
//  · permiso granular según el tipo de notif (configurable en 99.ABMRoles_Traslados)
//  · filtro por pisos asignados si el rol tiene FiltrarPisos_RT=Sí
//
// Logueo: cada rama de descarte loguea la razón. Esto permite diagnosticar
// "por qué no le llegó push a X" sin agregar instrumentación ad-hoc cada vez.
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
    console.log(`[push-utils]  ✗ ${tag} — role config not found in 99.ABMRoles_Traslados`);
    return false;
  }

  const reqPerm = params.type ? NOTIF_TYPE_TO_PERMISSION[params.type] : undefined;
  if (!reqPerm) {
    console.log(`[push-utils]  ✗ ${tag} — type "${params.type}" not mapped to any permission`);
    return false;
  }
  if (!roleCfg.permissions.includes(reqPerm)) {
    console.log(`[push-utils]  ✗ ${tag} — missing permission ${reqPerm} (has: [${roleCfg.permissions.join(',')}])`);
    return false;
  }

  if (roleCfg.filterByFloors && !subAreaMatches(sub, params)) {
    console.log(`[push-utils]  ✗ ${tag} — areas mismatch (sub.assignedAreas=[${sub.assignedAreas.join(',')}] push.originArea="${params.originAreaName}" push.destArea="${params.destinationAreaName}")`);
    return false;
  }

  console.log(`[push-utils]  ✓ ${tag} — relevant (type=${params.type})`);
  return true;
}

async function deleteSubscription(spItemId: string): Promise<void> {
  if (!SITE_ID || !LIST_ID) return;
  try {
    await graphFetch(`/sites/${SITE_ID}/lists/${LIST_ID}/items/${spItemId}`, {
      method: 'DELETE',
    });
  } catch { /* silent */ }
}

export async function sendPushToSubscribers(params: PushParams): Promise<void> {
  console.log(`[push-utils] Called with: title="${params.title}" sede="${params.sede}" excludeUser="${params.excludeUserId}"`);

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('[push-utils] VAPID keys not configured, skipping push');
    return;
  }
  console.log('[push-utils] VAPID keys OK, fetching subscriptions...');

  const subs = await fetchSubscriptions(params.sede);
  console.log(`[push-utils] Found ${subs.length} total subscription(s)`);
  subs.forEach(s => console.log(`  - user=${s.userId} role=${s.role} areas=${s.assignedAreas.join(',')}`));

  // Pre-cargar config de cada rol único de las subs (cache 5min, evita N fetches).
  const uniqueRoles = Array.from(new Set(subs.map(s => s.role).filter(Boolean)));
  const roleCfgByName = new Map<string, RoleConfig | null>();
  await Promise.all(uniqueRoles.map(async r => {
    roleCfgByName.set(r, await getRoleByName(r));
  }));

  let relevant = subs.filter(s => isRelevant(s, params, roleCfgByName.get(s.role) ?? null));
  console.log(`[push-utils] ${relevant.length} relevant after filtering`);

  if (relevant.length === 0) { console.log('[push-utils] No relevant subscribers, skipping'); return; }

  // Discriminador del EVENTO LÓGICO: hash de (título + cuerpo). Distingue lo que dentro
  // del mismo `type` son eventos DISTINTOS —los 3 STATUS_UPDATE de un ticket (Habitación
  // Lista / Traslado en Curso / Finalizado) tienen títulos distintos, y los DIET/FASTING
  // (sin ticketId, título fijo) tienen cuerpo por-paciente— pero es ESTABLE ante un
  // re-envío idéntico (doble PATCH / reintento). Sin esto, el tag por (ticket,tipo)
  // colapsaba transiciones y pacientes distintos en una sola burbuja silenciosa.
  const eventDiscriminator = simpleHash(`${params.title}${params.body ?? ''}`);

  // Idempotencia por evento lógico: si el MISMO evento se envió hace <60s desde esta
  // instancia, lo salteamos. Se arma ACÁ —después de confirmar relevant>0— para que un
  // primer intento que no entregó a nadie (subs vacías por error transitorio, VAPID off)
  // NO suprima un reintento legítimo. Colapsa el doble PATCH casi-simultáneo (el lock
  // cliente es per-pestaña). Techo per-instancia-de-lambda (ver recentEventGuard).
  const dedupeKey = `${params.ticketId ?? 'nt'}:${params.type ?? 'evt'}:${eventDiscriminator}`;
  if (recentEventGuard(dedupeKey)) {
    console.log(`[push-utils] Skipping duplicate event (<60s): ${dedupeKey}`);
    return;
  }

  console.log(`[push-utils] Sending push to ${relevant.length} subscriber(s) for: ${params.title}`);

  // Tag por EVENTO LÓGICO (ticket-tipo-discriminador): dos push del MISMO evento colapsan
  // en UNA burbuja; transiciones y pacientes distintos conservan su tag propio y disparan
  // su heads-up (ver arquitectura.md:471). Antes el tag por (ticket,tipo) era demasiado
  // grueso y silenciaba transporte/finalización y cambios de dieta de otros pacientes.
  const uniqueTagBase = `${params.ticketId ?? 'nt'}-${params.type ?? 'evt'}-${eventDiscriminator}`;

  // CATERING subscribers may receive a custom message (human-readable format with
  // room + floor). We build a dedicated payload for them so the same event delivers
  // distinct titles/bodies to catering vs everyone else.
  const hasCateringOverride = !!(params.cateringBody || params.cateringTitle);
  const genericPayload = JSON.stringify({
    title: params.title,
    body: params.body,
    ticketId: params.ticketId,
    type: params.type,
    tag: `${uniqueTagBase}-g`,
    timestamp: Date.now(),
  });
  const cateringPayload = hasCateringOverride
    ? JSON.stringify({
        title: params.cateringTitle ?? params.title,
        body:  params.cateringBody  ?? params.body,
        ticketId: params.ticketId,
        type: params.type,
        tag: `${uniqueTagBase}-c`,
        timestamp: Date.now(),
      })
    : genericPayload;

  // Dedup por endpoint exacto: cinturón barato contra filas duplicadas en SP que
  // apuntan al mismo endpoint (rotación/churn). Mandarlas todas = N copias del mismo
  // push al mismo dispositivo. NO deduplicamos por userId: rompería multi-device.
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
          { urgency: 'high', TTL: 60 * 60 }, // high priority = heads-up on Android
        );
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          // Subscription expired — clean up
          console.log(`[push-utils] Removing expired subscription for user ${sub.userId}`);
          await deleteSubscription(sub.spItemId);
        } else {
          console.error(`[push-utils] Push failed for user ${sub.userId}:`, err?.statusCode ?? err);
        }
      }
    })
  );

  const sent = results.filter(r => r.status === 'fulfilled').length;
  console.log(`[push-utils] Push complete: ${sent}/${relevant.length} delivered`);

  // Save notification records in 10.Notificaciones (non-blocking)
  if (SITE_ID && NOTIF_LIST_ID) {
    const notifPath = `/sites/${SITE_ID}/lists/${NOTIF_LIST_ID}/items`;
    const now = new Date().toISOString();
    // Una sola fila por USUARIO por evento (no por suscripción). La ENTREGA de push
    // sí va a todos los endpoints del usuario (loop de arriba), pero el registro in-app
    // de la campanita debe ser único: un user con N navegadores/dispositivos suscriptos
    // no debe ver la misma notif N veces. Dedup por userId conservando la primera sub
    // relevante (Title/Message solo varían por rol CATERING, que es per-usuario, así que
    // cualquier representante del usuario produce la misma fila).
    const notifTargets = Array.from(
      new Map(relevant.map(s => [String(s.userId), s])).values(),
    );
    Promise.allSettled(
      notifTargets.map(async (sub) => {
        try {
          const isCatering = sub.role.toUpperCase() === 'CATERING';
          const notifTitle = isCatering ? (params.cateringTitle ?? params.title) : params.title;
          const notifBody  = isCatering ? (params.cateringBody  ?? params.body)  : params.body;
          const r = await graphFetch(notifPath, {
            method: 'POST',
            body: JSON.stringify({
              fields: {
                TicketId_N: params.ticketId ?? '',
                UserId_N: Number(sub.userId) || 0,
                Title_N: notifTitle,
                Message_N: notifBody,
                Type_N: params.type ?? '',
                Status_N: 'Enviada',
                Fecha_N: now,
                Entorno_N: ENTORNO,
              },
            }),
          });
          if (!r.ok) {
            const errText = await r.text();
            console.error(`[push-utils] Failed to save notification for user ${sub.userId}:`, r.status, errText);
          } else {
            console.log(`[push-utils] Saved notification for user ${sub.userId}`);
          }
        } catch (err) {
          console.error(`[push-utils] Error saving notification for user ${sub.userId}:`, err);
        }
      })
    ).catch(() => {});
  }
}
