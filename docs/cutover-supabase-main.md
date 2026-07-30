# Runbook — Cutover de la migración Supabase a `main` (PRODUCTIVO)

Migra a producción lo que ya está en `develop`: **traslados, eventos, observaciones, limpiezas,
roles, notificaciones y comandas** (comandas = pedidos de comida: `15.CargaComandas` + `16.CargaMenu`)
sobre Supabase (Realtime + webhook de push). **Dietas (crons de cambio de dieta/ayuno) NO** están en
esta migración: siguen en SharePoint (leen Gamma/`11.DietaSnapshot`/`12.EnrichCamas`). `12.EnrichCamas`
tampoco migra (la lee `api/dietas.ts` de forma híbrida para el backstop `sin_dieta`).

El proyecto Supabase es **uno solo, compartido**, separado por la columna `entorno`. Las tablas,
la Edge Function y el webhook **ya están aplicados** (los usa develop con `entorno=TESTING`). El
cutover NO re-aplica migraciones: solo **carga las envs de prod, backfillea los datos de
`PRODUCTIVO` y mergea**.

> ⚠️ Este runbook incorpora los fixes de la verificación adversarial (NO-GO → GO). Los backfills
> ahora exigen `--entorno` explícito (allowlist {TESTING,PRODUCTIVO}) y `--yes-borra-vivas` para
> PRODUCTIVO; el de traslados desactiva solo el trigger de push mientras corre. Leé cada paso.

---

## 0) ANTES de mergear — sacar el andamiaje de diagnóstico ⚠️
El diagnóstico de iOS dejó cosas TEMPORALES que NO deben ir a prod. **Yo (Claude) las quito en un
commit antes del merge; avisá cuando termines de testear en develop:**
- `api/push-debug.ts` + su ruta en `dev-server.ts` + el `fetch('/api/push-debug')` del Service
  Worker (`src-sw/sw.ts`) — se mantiene el resto del SW (las opciones iOS-safe SÍ quedan).
- `src-sw/sw.ts`: el push-log de IndexedDB (`logPushReceived` / `mediflow-push-log`) persiste PHI
  (nombre de paciente) 24h en cada device → dejar de persistir `body` (solo metadata) o quitarlo.
- `api/debug-subs.ts` — endpoint TEMPORAL de auditoría (se auto-rutea en Vercel; lee SP viejo).
  Quitar (o dejar explícito si se quiere conservar, aclarando que lee SharePoint).
- Tabla `public.push_debug` (drop).
- Re-deploy de la Edge Function `notify-push` en su **versión limpia** (sin `diag`/`sendResults`).
  Comando MANUAL (el merge NO despliega Edge Functions): `supabase functions deploy notify-push`.
  Ojo: el proyecto es COMPARTIDO → redeployar también saca el diag a TESTING (coordinar el momento).

## 1) Envs en Vercel — entorno **Production**
Cargar las 4 (las mismas que ya están en Preview):
- `SUPABASE_SECRET_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_JWT_PRIVATE_KEY`
- **(B4) `ENTORNO=PRODUCTIVO` en Production — verificar explícitamente.** `api/supabase-token.ts`
  (claim `entorno` del pase que consumen las RLS), `api/tickets.ts`, `api/limpiezas.ts`,
  `api/dietas.ts`, `api/carga-menu.ts` y `api/notifications.ts` usan `process.env.ENTORNO ?? 'TESTING'`.
  En Preview `ENTORNO=TESTING`; si al copiar envs se pisa/omite en Production, el pase firma
  `entorno='TESTING'` → prod lee/escribe TESTING y, vía Realtime+RLS, el navegador ve filas de
  TESTING (fuga de PHI cross-entorno). Confirmar golpeando `/api/supabase-token` en prod que el
  claim `entorno` sea `PRODUCTIVO` ANTES del merge.
- **VAPID — mismo par en las 3 puntas** (si no, el push da 403 silencioso):
  `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (server, Production) = secrets de la Edge Function en
  Supabase = **`VITE_VAPID_PUBLIC_KEY`** (build del cliente, con la que el navegador suscribe).
  ← ya confirmado que es el de prod; verificar que las 3 coincidan.

## 2) Supabase — nada nuevo que aplicar, solo verificar
- Tablas + RLS + Realtime + índices: ya aplicados (mirror en `supabase/migrations/`). Incluye
  `public.comandas` + `public.carga_menu` (comandas) y la función `set_traslados_notify_enabled`.
- Edge Function `notify-push` (verify_jwt=false) + webhook (trigger `notify_push_traslados`): ya vivos.
- Secrets VAPID de la Edge Function: ya cargados.
- **(A2) WEBHOOK_SECRET — decidir explícitamente.** El trigger hace `net.http_post` con headers solo
  `{'Content-Type'}` (NO manda `x-webhook-secret`), y la Edge Function está `verify_jwt=false` con la
  URL en el repo. Dos caminos:
  - (a) Dejarlo VACÍO (como dev) → la Edge Function es un endpoint PÚBLICO: cualquiera con la URL
    puede POSTear `{type:'INSERT',record:{…}}` y disparar push + campanitas arbitrarias al personal.
    Como el proyecto es compartido, la exposición YA existe hoy.
  - (b) Setear `WEBHOOK_SECRET` (secret de la función) **y** una migración nueva que agregue
    `x-webhook-secret` al `net.http_post` del trigger. Si se setea el secret SIN actualizar el
    trigger → 401 en TODOS los webhooks → push + campanita ROTOS en silencio.
  Recomendado (b) para prod. Si se elige (a), aceptarlo por escrito.

## 3) Backfill de `PRODUCTIVO` (correr JUSTO antes del merge)
Con las creds de SharePoint del `.env` (son las mismas para prod). **Dry-run primero (sin `--apply`),
mirar los conteos, y recién ahí `--apply`.** Los backfills destructivos exigen `--yes-borra-vivas`
para PRODUCTIVO. **Congelar** ediciones (traslados + limpiezas + observaciones + comandas + roles)
durante la ventana; minimizar la ventana (backfill inmediatamente antes del merge, deploy rápido).
**NO re-correr un backfill después del merge** (pisaría datos vivos con los viejos de SP).

**Orden importa** (ver notas): traslados → limpiezas → comandas/carga_menu → notificaciones →
push_subscriptions **al final**.

```bash
# Roles (globales; re-seed para agarrar ediciones recientes en SP). No llevan --entorno.
npx tsx scripts/seed-roles.mts                                   # dry-run
npx tsx scripts/seed-roles.mts --apply

# Traslados + eventos + observaciones. El script DESACTIVA el trigger de push mientras corre (B1)
# y aísla filas con cama_destino duplicada sin abortar (B2). Pre-escanea colisiones en el dry-run.
npx tsx scripts/backfill-traslados.mts --entorno=PRODUCTIVO
npx tsx scripts/backfill-traslados.mts --entorno=PRODUCTIVO --apply --yes-borra-vivas

# Limpiezas
npx tsx scripts/backfill-limpiezas.mts --entorno=PRODUCTIVO
npx tsx scripts/backfill-limpiezas.mts --entorno=PRODUCTIVO --apply --yes-borra-vivas

# Comandas: planificación de menú (16.CargaMenu) primero, luego las comandas (15.CargaComandas)
npx tsx scripts/backfill-carga-menu.mts --entorno=PRODUCTIVO
npx tsx scripts/backfill-carga-menu.mts --entorno=PRODUCTIVO --apply --yes-borra-vivas
npx tsx scripts/backfill-comandas.mts   --entorno=PRODUCTIVO
npx tsx scripts/backfill-comandas.mts   --entorno=PRODUCTIVO --apply --yes-borra-vivas

# Notificaciones no leídas recientes → "mini histórico" de la campanita. Ventana elegida: 48h
# (--days=2 ≈ 1190 no-leídas al 30/07; --days=1 ≈ 547). El delete se acota a la misma ventana (A4).
# Correr DESPUÉS de traslados (que puede generar notis vía webhook).
npx tsx scripts/backfill-notificaciones.mts --entorno=PRODUCTIVO --days=2
npx tsx scripts/backfill-notificaciones.mts --entorno=PRODUCTIVO --days=2 --apply --yes-borra-vivas

# Suscripciones push AL FINAL (para que TODOS reciban push desde el minuto 0, sin reabrir la app).
# El script verifica el par VAPID (A1) y aborta si VAPID_PUBLIC_KEY ≠ VITE_VAPID_PUBLIC_KEY.
npx tsx scripts/backfill-push-subscriptions.mts --entorno=PRODUCTIVO
npx tsx scripts/backfill-push-subscriptions.mts --entorno=PRODUCTIVO --apply
```

## 4) Merge `develop` → `main` + push
Dispara el deploy de Production con el código ya apuntando a Supabase (traslados/limpiezas/comandas
por Realtime; sin poll salvo beds).

## 5) Verificación post-merge (en prod, con cuidado)
- Login de un usuario de cada rol → permisos/módulos correctos.
- Mapa/lista se actualizan solos (Realtime), sin el poll de 15s de tickets.
- Crear/mover un traslado → escribe Supabase; el push nativo llega (a otro usuario, no el actor).
- Marcar habitación limpia → overlay + push `ROOM_CLEANED` a Admisión.
- **Comandas**: cargar/entregar/anular una comanda y agregar un acompañante → el overlay del mapa y
  Gestión de Comandas se actualizan solos (Realtime `comandas-live`), sin poll; el histórico anda.
  Planificar un menú (modal) → autocompleta la carga por cama. Confirmar que **NO** llega push de
  comandas (el módulo es silencioso; los DIET_CHANGE/FASTING son de los crons, intactos).
- Confirmar que los crons (`cron-diet-changes`, `cron-enrich-beds`) y `push-utils` siguen intactos.

## 6) Rollback
El rollback debe cubrir TODO lo migrado, no solo traslados:
- **Lectura/escritura**: `git revert` de `api/tickets.ts` + `api/role-cache.ts` + `api/roles.ts` +
  `api/limpiezas.ts` + `api/notifications.ts` + `api/push-subscribe.ts` + `api/dietas.ts` +
  `api/carga-menu.ts` → vuelven a SharePoint (SP quedó intacto; los usuarios NO están migrados).
  Ojo: lo escrito en Supabase durante la ventana no vuelve a SP solo (por eso ventana corta).
- **UI en vivo**: revertir `hooks/useHospitalState.ts` también, o la app queda sin live-update
  (se quitaron los polls de tickets/limpiezas/comandas y se reemplazaron por Realtime; si solo se
  revierten los `api/`, los canales se suscriben a tablas Supabase donde ya no se escribe → la UI
  no refresca sola hasta recargar).
- **Realtime/push**: desactivar el webhook en Supabase (o `set_traslados_notify_enabled(false)`) y
  re-habilitar el push en `tickets.ts` (revert) es de bajo riesgo (el push es no-bloqueante).

## Notas
- Los usuarios (`00.Usuarios/Perfil_U`) NO se migran: el join usuario→rol sigue por nombre.
- Las suscripciones stale (>36h) se migran pero el sender las saltea/limpia (inofensivo).
- **Comandas es HÍBRIDO server-side**: `api/dietas.ts` guarda comandas en Supabase PERO el backstop
  `sin_dieta` sigue leyendo `12.EnrichCamas` en SharePoint (fail-open). No cortar esa dependencia.
- **Freeze irreal en hospital 24/7**: un traslado creado entre el backfill y el deploy se escribe en
  SP (código viejo) y queda INVISIBLE tras el cutover. Minimizar la ventana y/o coordinar con
  operaciones una franja de baja actividad. NO re-correr el backfill después del merge.
- `id_univoco` puede coexistir en TESTING y PRODUCTIVO (constraint `unique(id_univoco,entorno)`).
  Los eventos de `08.DetalleTraslados` (sin columna Entorno) se asocian por pertenencia al set del
  entorno backfilleado; si un `id_univoco` viviera en ambos entornos, revisar antes.
