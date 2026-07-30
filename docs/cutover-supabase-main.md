# Runbook — Cutover de la migración Supabase a `main` (PRODUCTIVO)

Migra a producción lo que ya está en `develop`: **traslados, eventos, observaciones, limpiezas,
roles y notificaciones** sobre Supabase (Realtime + webhook de push). **Comandas y dietas NO** están
en esta migración (siguen en SharePoint).

El proyecto Supabase es **uno solo, compartido**, separado por la columna `entorno`. Las tablas,
la Edge Function y el webhook **ya están aplicados** (los usa develop con `entorno=TESTING`). El
cutover NO re-aplica migraciones: solo **carga las envs de prod, backfillea los datos de
`PRODUCTIVO` y mergea**.

---

## 0) ANTES de mergear — sacar el andamiaje de diagnóstico ⚠️

El diagnóstico de iOS dejó cosas TEMPORALES que NO deben ir a prod. **Yo (Claude) las quito en un
commit antes del merge; avisá cuando termines de testear en develop:**
- `api/push-debug.ts` + su ruta en `dev-server.ts` + el `fetch('/api/push-debug')` del Service
  Worker (`src-sw/sw.ts`) — se mantiene el resto del SW (las opciones iOS-safe SÍ quedan).
- Tabla `public.push_debug` (drop).
- Re-deploy de la Edge Function `notify-push` en su **versión limpia** (sin los campos de
  diagnóstico `diag`/`sendResults` en la respuesta). Está en `supabase/functions/notify-push/index.ts`.

## 1) Envs en Vercel — entorno **Production**
Cargar las 4 (las mismas que ya están en Preview):
- `SUPABASE_SECRET_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_JWT_PRIVATE_KEY`
- Verificar que `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` en Production sean el **mismo par** que los
  secrets de la Edge Function en Supabase (si no, el push da 403). ← ya confirmado que es el de prod.

## 2) Supabase — nada nuevo que aplicar, solo verificar
- Tablas + RLS + Realtime + índices: ya aplicados (mirror en `supabase/migrations/`).
- Edge Function `notify-push` (verify_jwt=false) + webhook (trigger `notify_push_traslados`): ya vivos.
- Secrets VAPID de la Edge Function: ya cargados.

## 3) Backfill de `PRODUCTIVO` (correr JUSTO antes del merge)
Con las creds de SharePoint del `.env` (son las mismas para prod). **Dry-run primero (sin `--apply`),
mirar los conteos, y recién ahí `--apply`.** Congelar ediciones de roles/traslados durante la ventana.

```bash
# Roles (globales; re-seed para agarrar ediciones recientes en SP)
npx tsx scripts/seed-roles.mts                                   # dry-run
npx tsx scripts/seed-roles.mts --apply

# Traslados + eventos + observaciones
npx tsx scripts/backfill-traslados.mts --entorno=PRODUCTIVO
npx tsx scripts/backfill-traslados.mts --entorno=PRODUCTIVO --apply

# Limpiezas
npx tsx scripts/backfill-limpiezas.mts --entorno=PRODUCTIVO
npx tsx scripts/backfill-limpiezas.mts --entorno=PRODUCTIVO --apply

# Suscripciones push (para que TODOS reciban push desde el minuto 0, sin reabrir la app)
npx tsx scripts/backfill-push-subscriptions.mts --entorno=PRODUCTIVO
npx tsx scripts/backfill-push-subscriptions.mts --entorno=PRODUCTIVO --apply

# Notificaciones no leídas recientes (opcional; el badge de pendientes) — SOLO pre-cutover
npx tsx scripts/backfill-notificaciones.mts --entorno=PRODUCTIVO --days=7
npx tsx scripts/backfill-notificaciones.mts --entorno=PRODUCTIVO --days=7 --apply
```

## 4) Merge `develop` → `main` + push
Dispara el deploy de Production con el código ya apuntando a Supabase.

## 5) Verificación post-merge (en prod, con cuidado)
- Login de un usuario de cada rol → permisos/módulos correctos.
- Mapa/lista se actualizan solos (Realtime), sin el poll de 15s.
- Crear/mover un traslado → escribe Supabase; el push nativo llega (a otro usuario, no el actor).
- Marcar habitación limpia → overlay + push `ROOM_CLEANED` a Admisión.

## 6) Rollback
- **Lectura/escritura de traslados**: `git revert` de `api/tickets.ts` + `api/role-cache.ts` +
  `api/roles.ts` → vuelven a SharePoint al instante (SP quedó intacto; los usuarios NO están migrados).
  Ojo: los traslados escritos en Supabase durante la ventana no vuelven a SP solos (script inverso
  si hiciera falta — por eso conviene ventana corta).
- **Realtime/push**: desactivar el webhook en Supabase y re-habilitar el push en tickets.ts (revert)
  es de bajo riesgo (el push es no-bloqueante).

## Notas
- Los usuarios (`00.Usuarios/Perfil_U`) NO se migran: el join usuario→rol sigue por nombre.
- Las suscripciones stale (>36h) se migran pero el sender las saltea/limpia (inofensivo).
- Comandas/dietas quedan en SharePoint. Comandas se migraría después como rama aparte (fácil, calca limpiezas).
