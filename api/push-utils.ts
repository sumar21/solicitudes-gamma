/**
 * Server-side Web Push utility.
 * Fetches subscriptions from SharePoint, filters by role/area, sends push notifications.
 */

import webpush from 'web-push';
import { graphFetch } from './graph.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = '648fde7b-89d2-40ac-bc4a-63661508b50a'; // 09.PushSubscriptions
const NOTIF_LIST_ID = '240f00dd-715b-4c78-9661-3147b7650a0f'; // 10.Notificaciones

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
  type?: string;           // NEW_TICKET, STATUS_UPDATE
  originArea?: string;
  destinationArea?: string;
  sede?: string;
  excludeUserId?: string;  // don't notify the user who triggered the action
}

interface Subscription {
  spItemId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userId: string;
  role: string;
  assignedAreas: string[];
  sede: string;
}

async function fetchSubscriptions(sede?: string): Promise<Subscription[]> {
  if (!SITE_ID || !LIST_ID) return [];
  const basePath = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;

  try {
    const spRes = await graphFetch(
      `${basePath}?$expand=fields&$top=500`,
      { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
    );
    if (!spRes.ok) return [];

    const data = (await spRes.json()) as { value: Record<string, unknown>[] };
    return (data.value ?? []).map((item: any) => {
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
      };
    }).filter(s => s.endpoint && s.keys.p256dh);
  } catch (err) {
    console.error('[push-utils] fetchSubscriptions error:', err);
    return [];
  }
}

function isRelevant(sub: Subscription, params: PushParams): boolean {
  // Exclude the user who triggered the action
  if (params.excludeUserId && sub.userId === params.excludeUserId) return false;

  // Filter by sede
  if (params.sede && sub.sede && sub.sede !== params.sede && sub.sede !== 'SUMAR') return false;

  const role = sub.role.toUpperCase();

  // Admin and Admission receive all notifications
  if (role === 'ADMIN' || role === 'ADMISSION') return true;

  // Hostess: only if ticket area intersects their assigned areas
  if (role === 'HOSTESS') {
    if (!sub.assignedAreas.length) return false;
    // If hostess has 9+ areas, she gets all notifications (effectively full access)
    if (sub.assignedAreas.length >= 9) return true;
    const { originArea, destinationArea } = params;
    // originArea/destinationArea may be bed labels — check if any assigned area is contained in them
    const matchesArea = (bedLabel?: string) => {
      if (!bedLabel) return false;
      return sub.assignedAreas.some(area => bedLabel.includes(area) || area.includes(bedLabel));
    };
    return matchesArea(originArea) || matchesArea(destinationArea);
  }

  // Other roles: no push notifications
  return false;
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

  const relevant = subs.filter(s => isRelevant(s, params));
  console.log(`[push-utils] ${relevant.length} relevant after filtering`);

  if (relevant.length === 0) { console.log('[push-utils] No relevant subscribers, skipping'); return; }

  console.log(`[push-utils] Sending push to ${relevant.length} subscriber(s) for: ${params.title}`);

  const payload = JSON.stringify({
    title: params.title,
    body: params.body,
    ticketId: params.ticketId,
    type: params.type,
  });

  const results = await Promise.allSettled(
    relevant.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          payload,
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
    const now = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // UTC-3 (Argentina)
    Promise.allSettled(
      relevant.map(async (sub) => {
        try {
          const r = await graphFetch(notifPath, {
            method: 'POST',
            body: JSON.stringify({
              fields: {
                TicketId_N: params.ticketId ?? '',
                UserId_N: Number(sub.userId) || 0,
                Title_N: params.title,
                Message_N: params.body,
                Type_N: params.type ?? '',
                Status_N: 'Enviada',
                Fecha_N: now,
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
