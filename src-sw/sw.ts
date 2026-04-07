/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// Workbox precaching (manifest auto-injected by vite-plugin-pwa)
precacheAndRoute(self.__WB_MANIFEST);

// ── Push notification handler ───────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  const { title, body, ticketId, type } = data;

  const options: NotificationOptions & { vibrate?: number[] } = {
    body: body ?? '',
    icon: '/logo.svg',
    badge: '/logo.svg',
    tag: ticketId ?? `notif-${Date.now()}`,
    data: { ticketId, type },
    vibrate: [200, 100, 200],
  };

  event.waitUntil(
    self.registration.showNotification(title ?? 'MediFlow', options as NotificationOptions)
  );
});

// ── Notification click → focus or open the app ──────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
      } else {
        self.clients.openWindow('/');
      }
    })
  );
});
