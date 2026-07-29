# notify-push — Edge Function de notificaciones de traslados

Reemplaza el envío de Web Push que hacía `api/push-utils.ts` desde Vercel. Se dispara con un
**Database Webhook** sobre `public.traslados` y manda el push **una sola vez** por cambio de fila
commiteado → elimina las notificaciones duplicadas (no hay más doble-PATCH ni carrera entre lambdas).

## Qué hace

- Discrimina el tipo desde el cambio de fila: `INSERT` → `NEW_TICKET`; `UPDATE` con cambio de
  `status` → `STATUS_UPDATE` (o `RECEPTION_CONFIRMED` si el nuevo status es `Por Consolidar`).
  `UPDATE` sin cambio de status → no notifica. `WAITING_ROOM` no tiene label → no notifica.
- Reproduce `isRelevant` (sede / permiso por tipo / `filter_by_floors` con remapeo HRA) leyendo
  `roles` + `push_subscriptions` de Supabase.
- Envía a todos los endpoints del usuario (multi-device), dedup por endpoint, borra la sub al 410.
- Escribe la campanita en `public.notificaciones` (una fila por usuario).
- Idempotencia ante reintentos por timeout: `public.push_dispatch_log` (key `id_univoco:status:updated_at`).

## Deploy (una vez, por entorno de Supabase)

1. **Secrets** de la función (no van al cliente):
   ```bash
   supabase secrets set \
     VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:admin@grupogamma.com \
     WEBHOOK_SECRET=<string aleatorio largo>
   # SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase automáticamente en las Edge Functions.
   ```
   Los VAPID son los MISMOS que ya usa Vercel (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`).

2. **Deploy** de la función:
   ```bash
   supabase functions deploy notify-push --project-ref <ref>
   ```
   (o vía el MCP: `deploy_edge_function`).

3. **Database Webhook** (dashboard → Database → Webhooks → Create):
   - Tabla: `public.traslados`
   - Eventos: **Insert** + **Update**
   - Tipo: **Supabase Edge Function** → `notify-push`
   - Header HTTP: `x-webhook-secret: <el mismo WEBHOOK_SECRET del paso 1>`
   - El payload por defecto (`{ type, table, schema, record, old_record }`) es el que la función espera.
     `old_record` es imprescindible: sin él no se distingue un cambio de status real de una edición
     de destino/observación.

## Notas

- `web-push` corre vía `npm:web-push` (Deno soporta specifiers `npm:`). Si el runtime de Edge diera
  problemas con VAPID, es el único punto a revisar (todo lo demás es SQL + fetch).
- El Service Worker (`src-sw/sw.ts`) no cambia: el payload calca el shape anterior
  (`title, body, ticketId, type, tag, timestamp`), así que el colapso por `tag` sigue igual.
