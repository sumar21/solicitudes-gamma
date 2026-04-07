/**
 * Client-side Web Push subscription utility.
 * Subscribes the browser to push notifications and sends the subscription to the backend.
 */

const VAPID_PUBLIC_KEY = (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY as string;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
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

    // Check if already subscribed
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // Request permission if needed
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.warn('[push] Notification permission denied');
        return false;
      }

      // Subscribe
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
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
