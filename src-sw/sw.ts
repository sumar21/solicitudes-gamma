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

  // UN solo waitUntil y showNotification PRIMERO (iOS cancela la suscripción si recibe un push
  // sin mostrar notif). Si falla, reintenta con opciones mínimas.
  event.waitUntil((async () => {
    try {
      await self.registration.showNotification(title ?? 'MediFlow', options);
    } catch {
      try {
        await self.registration.showNotification(title ?? 'MediFlow', { body: body ?? '', tag: notifTag, data: base.data });
      } catch { /* no-op: no se pudo mostrar la notificación */ }
    }
  })());
});

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
