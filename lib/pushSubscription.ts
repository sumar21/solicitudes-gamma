/**
 * Client-side Web Push subscription utility.
 * Subscribes the browser to push notifications and sends the subscription to the backend.
 */

import { APP_VERSION } from './version';

const VAPID_PUBLIC_KEY = (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY as string;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/** True si la applicationServerKey de una sub existente coincide con la VAPID actual.
 *  Si el browser NO expone la key (algunos Safari sobre una sub válida), devolvemos true = NO forzar
 *  re-suscripción — evita churn de endpoints en cada apertura cuando no podemos comparar. */
function sameApplicationServerKey(existing: ArrayBuffer | null | undefined, current: Uint8Array): boolean {
  if (!existing) return true;
  const a = new Uint8Array(existing);
  if (a.length !== current.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== current[i]) return false;
  return true;
}

export async function subscribeToPush(
  token: string,
  userId: string,
  userRole: string,
  assignedAreas: string[],
  sede: string,
): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[push] Push notifications not supported in this browser');
      return false;
    }

    if (!VAPID_PUBLIC_KEY) {
      console.warn('[push] VAPID_PUBLIC_KEY not configured');
      return false;
    }

    const registration = await navigator.serviceWorker.ready;
    const currentKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);

    // Check if already subscribed
    let subscription = await registration.pushManager.getSubscription();

    // Si la sub existente fue creada con OTRA applicationServerKey (VAPID viejo/rotado), NO sirve:
    // el sender firma con el VAPID actual → el push service devuelve 403 y nunca entrega. La
    // descartamos para re-suscribir con la actual (si solo la re-posteáramos, el 403 sería eterno).
    if (subscription && !sameApplicationServerKey(subscription.options?.applicationServerKey, currentKey)) {
      console.warn('[push] Sub con VAPID distinto al actual → re-suscribiendo');
      await subscription.unsubscribe().catch(() => {});
      subscription = null;
    }

    if (!subscription) {
      // Request permission if needed (si ya está 'granted', resuelve sin prompt).
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.warn('[push] Notification permission denied');
        return false;
      }

      // Subscribe
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: currentKey,
      });
    }

    // Send subscription to backend
    const subJSON = subscription.toJSON();
    const res = await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        endpoint: subJSON.endpoint,
        keys: subJSON.keys,
        userId,
        role: userRole,
        assignedAreas: assignedAreas.join(';'),
        sede,
        version: APP_VERSION,
      }),
    });

    if (!res.ok) {
      console.error('[push] Failed to save subscription:', res.status);
      return false;
    }

    console.log('[push] Subscribed successfully');
    return true;
  } catch (err) {
    console.error('[push] Subscription error:', err);
    return false;
  }
}

/**
 * "Heartbeat" de la suscripción: re-envía la sub existente al backend para refrescar su
 * `lastModifiedDateTime` en SP. El server-side usa ese timestamp para saltear (y luego
 * limpiar) suscripciones abandonadas — así un dispositivo deslogueado/cerrado deja de
 * recibir push a las ~36h sin tener que crear columnas nuevas en SharePoint.
 *
 * A diferencia de `subscribeToPush`, NO pide permiso ni crea una sub nueva: si el browser
 * no tiene una suscripción activa, es no-op (evita prompts sorpresa en background).
 * Usa `keepalive` para sobrevivir si la pestaña se cierra justo después.
 */
export async function touchPushSubscription(
  token: string,
  userId: string,
  userRole: string,
  assignedAreas: string[],
  sede: string,
): Promise<void> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return; // sin sub activa → no-op, no prompt

    const subJSON = subscription.toJSON();
    await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        endpoint: subJSON.endpoint,
        keys: subJSON.keys,
        userId,
        role: userRole,
        assignedAreas: assignedAreas.join(';'),
        sede,
        version: APP_VERSION,
      }),
      keepalive: true,
    });
  } catch { /* el heartbeat nunca debe romper nada */ }
}
