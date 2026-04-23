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

// Apply SKIP_WAITING when the frontend asks for it (via virtual:pwa-register)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Push notification handler ───────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  const { title, body, ticketId, type, tag, timestamp } = data;

  // Unique tag per event (backend sends one; fallback to a client-side unique one).
  // Using ticketId alone would make Android collapse consecutive updates silently
  // without firing a new heads-up banner.
  const notifTag = tag ?? `${ticketId ?? 'nt'}-${type ?? 'evt'}-${Date.now()}`;

  const options: NotificationOptions & {
    vibrate?: number[];
    renotify?: boolean;
    requireInteraction?: boolean;
    timestamp?: number;
    actions?: { action: string; title: string }[];
  } = {
    body: body ?? '',
    icon: '/logo.svg',
    badge: '/logo.svg',
    tag: notifTag,
    data: { ticketId, type, tag: notifTag },
    // Stronger vibration pattern — Android treats non-silent + vibrate as high-priority.
    vibrate: [300, 120, 300, 120, 300],
    // IMPORTANT: do NOT set requireInteraction: true on Android. Some Chrome
    // builds treat such notifications as "ongoing" and skip the heads-up banner,
    // sending the notif straight to the tray without a toast. Letting it
    // auto-dismiss is the cost for guaranteeing the heads-up shows up.
    requireInteraction: false,
    renotify: true,             // re-surface heads-up when tag is reused
    silent: false,              // explicit — some Android builds treat missing flag as silent
    timestamp: timestamp ?? Date.now(),
    // Having at least one action bumps notification importance on many Android devices
    // and makes it more likely to trigger the heads-up banner.
    actions: [{ action: 'open', title: 'Ver' }],
  };

  event.waitUntil(
    self.registration.showNotification(title ?? 'MediFlow', options as NotificationOptions)
  );
});

// ── Notification click → focus or open the app ──────────────────────────────
// Handles both clicks on the notification body and on the "Ver" action button.
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
