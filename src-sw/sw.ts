/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope;

// Workbox precaching (manifest auto-injected by vite-plugin-pwa)
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Take control of all open clients as soon as this SW activates.
// Combined with the SKIP_WAITING message handler below (triggered by the frontend
// when a new version is detected), this removes the "close all tabs to update"
// friction — users get the new version automatically.
clientsClaim();

// Cierra las notificaciones del SO que matcheen un ticket (o todas si no se pasa).
// Estilo WhatsApp: leer un "hilo" (ticket) limpia todas sus notifs del lock screen.
// DIET_CHANGE no tiene ticketId — se limpia con "marcar todas" (sin args) o al tocarla.
async function closeMatchingNotifications(ticketId?: string): Promise<void> {
  const notifs = await self.registration.getNotifications();
  for (const n of notifs) {
    if (!ticketId) { n.close(); continue; }                  // sin args → todas
    if ((n.data as any)?.ticketId === ticketId) n.close();   // hilo del ticket
  }
}

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg) return;
  // Apply SKIP_WAITING when the frontend asks for it (via virtual:pwa-register)
  if (msg.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  // Cerrar notifs del SO cuando el cliente marca como leído.
  if (msg.type === 'CLOSE_NOTIFICATIONS') {
    event.waitUntil(closeMatchingNotifications(msg.ticketId));
  }
});

// ── Push log (IndexedDB) ────────────────────────────────────────────────────
// Registra cada push recibido para diagnóstico. Si el cliente reporta que no le
// llegan notifs, podemos revisar este log para distinguir entre:
//   · el push NO llegó al SW (red, sub inválida, server) → log vacío.
//   · el push SÍ llegó pero el banner heads-up no apareció (channel Android,
//     battery optimization, etc.) → log con entrada para el evento esperado.
// TTL 24h y cap de 50 entradas para no crecer indefinidamente.
const PUSH_LOG_DB    = 'mediflow-push-log';
const PUSH_LOG_STORE = 'entries';
const PUSH_LOG_MAX   = 50;
const PUSH_LOG_TTL_MS = 24 * 60 * 60 * 1000;

function openPushLog(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PUSH_LOG_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PUSH_LOG_STORE)) {
        db.createObjectStore(PUSH_LOG_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function logPushReceived(entry: Record<string, unknown>): Promise<void> {
  try {
    const db = await openPushLog();
    const tx = db.transaction(PUSH_LOG_STORE, 'readwrite');
    const store = tx.objectStore(PUSH_LOG_STORE);
    store.add({ ...entry, ts: Date.now() });
    // Cleanup: borrar entradas viejas y limitar el total.
    const cursorReq = store.openCursor();
    const now = Date.now();
    let count = 0;
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      count++;
      const value = cursor.value as { ts: number };
      const tooOld = now - value.ts > PUSH_LOG_TTL_MS;
      if (tooOld || count > PUSH_LOG_MAX) cursor.delete();
      cursor.continue();
    };
    await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
    db.close();
  } catch { /* no-op: el logging nunca debe romper el flujo del push */ }
}

// ── Push notification handler ───────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  const { title, body, ticketId, type, tag, timestamp } = data;

  // Stable tag per (ticketId, type): the backend always sends one; the fallback
  // mirrors it so a repeated push for the same event collapses into a single bubble.
  const notifTag = tag ?? `${ticketId ?? 'nt'}-${type ?? 'evt'}`;

  // iOS/WebKit soporta un SUBCONJUNTO mínimo de opciones. actions/vibrate/renotify/
  // requireInteraction son de Android; en iOS conviene NO pasarlas (hay reportes de que
  // WebKit no pinta la notificación con opciones que no soporta). Detectamos iOS por el UA
  // del SW y ahí mandamos solo lo básico. En Android/desktop se mantiene todo como estaba.
  const isIOS = /iPad|iPhone|iPod/i.test(self.navigator.userAgent || '');
  const base: any = {
    body: body ?? '',
    icon: '/logo.svg',
    badge: '/badge.svg',
    tag: notifTag,
    data: { ticketId, type, tag: notifTag },
    timestamp: timestamp ?? Date.now(),
  };
  const options: any = isIOS ? base : {
    ...base,
    vibrate: [300, 120, 300, 120, 300],
    requireInteraction: false,
    renotify: false,
    silent: false,
    actions: [{ action: 'open', title: 'Ver' }],
  };

  // UN solo waitUntil y showNotification PRIMERO (iOS cancela la suscripción si recibe un
  // push sin mostrar notif). Si falla, reintenta con opciones mínimas. Después reporta a
  // /api/push-debug (para diagnosticar el iPhone SIN cable) y loguea en IndexedDB.
  event.waitUntil((async () => {
    let shown = false;
    let errMsg = '';
    try {
      await self.registration.showNotification(title ?? 'MediFlow', options);
      shown = true;
    } catch (e) {
      errMsg = String((e as any)?.message ?? e);
      try {
        await self.registration.showNotification(title ?? 'MediFlow', { body: body ?? '', tag: notifTag, data: base.data });
        shown = true;
      } catch (e2) {
        errMsg += ' | fallback: ' + String((e2 as any)?.message ?? e2);
      }
    }

    // Reporte de diagnóstico (best-effort). TEMPORAL: se quita cuando el push de iOS quede confirmado.
    try {
      await fetch('/api/push-debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // NO se manda `body` (contiene nombre de paciente) — solo metadata de diagnóstico.
          title, type, ticketId, shown, error: errMsg, isIOS,
          permission: typeof Notification !== 'undefined' ? Notification.permission : 'unknown',
        }),
      });
    } catch { /* no-op */ }

    try {
      await logPushReceived({
        title, body, ticketId, type, tag, payloadTs: timestamp,
        permission: typeof Notification !== 'undefined' ? Notification.permission : 'unknown',
        scope: self.registration.scope,
      });
    } catch { /* no-op */ }
  })());
});

// ── Cómo leer el push-log desde el browser del cliente ─────────────────────
// Pegá esto en DevTools → Console (estando en el dominio de la PWA):
//
//   (async () => {
//     const db = await new Promise((r, rej) => {
//       const req = indexedDB.open('mediflow-push-log', 1);
//       req.onsuccess = () => r(req.result);
//       req.onerror   = () => rej(req.error);
//     });
//     const tx = db.transaction('entries', 'readonly');
//     const all = await new Promise((r) => {
//       const out = []; const c = tx.objectStore('entries').openCursor();
//       c.onsuccess = () => {
//         const cur = c.result;
//         if (!cur) { r(out); return; }
//         out.push(cur.value); cur.continue();
//       };
//     });
//     console.table(all.map(e => ({
//       hora: new Date(e.ts).toLocaleString('es-AR'),
//       title: e.title, body: e.body, type: e.type, ticketId: e.ticketId,
//       permission: e.permission,
//     })));
//   })();
//
// Si el array está vacío → el push NO está llegando al SW (revisar sub/red/server).
// Si el array tiene entradas pero el cliente no vio banner → es config Android
// (channel importance + battery optimization).

// ── Notification click → focus or open the app + propagar ticketId/type ─────
// El SW no tiene JWT, así que no puede marcar la notif como leída por sí mismo.
// Estrategia: delegar al cliente:
//   · Si hay un client abierto → focus + postMessage con {ticketId, type}.
//     El cliente escucha el message y dispara mark-by-event con su JWT.
//   · Si no hay client → openWindow con query params, la app los lee al mount.
self.addEventListener('notificationclick', (event) => {
  const data: any = event.notification.data ?? {};
  const ticketId = typeof data.ticketId === 'string' ? data.ticketId : '';
  const type     = typeof data.type === 'string' ? data.type : '';
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) {
        // App ya abierta: focus + mandamos los datos por postMessage.
        existing.focus();
        try {
          existing.postMessage({ kind: 'notification-clicked', ticketId, type });
        } catch { /* postMessage no soportado: el cliente refrescará por polling */ }
      } else {
        // App cerrada: abrimos con query params; la app los lee al mount.
        const params = new URLSearchParams();
        if (ticketId) params.set('notifTicketId', ticketId);
        if (type)     params.set('notifType', type);
        const qs = params.toString();
        self.clients.openWindow(qs ? `/?${qs}` : '/');
      }
    })
  );
});
