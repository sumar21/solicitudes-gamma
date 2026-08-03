# Arquitectura — MediFlow (Gestión de Traslados Hospitalarios)

## 1. Visión general

MediFlow es una aplicación web para gestionar traslados de pacientes dentro del Hospital Privado de Rosario (HPR), parte del Grupo Gamma. Orquesta el ciclo de vida completo de un traslado: desde la solicitud inicial hasta la consolidación final, pasando por asignación de cama, limpieza, transporte y recepción.

**Stack tecnológico:**

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + TypeScript + Tailwind CSS |
| Componentes UI | Radix UI (Dialog, Popover, Select) + componentes custom |
| Build | Vite 6 + vite-plugin-pwa |
| Backend API | Vercel Serverless Functions (Node.js) |
| Base de datos transaccional | **Supabase (Postgres)** — traslados, limpiezas, comandas, roles, notificaciones, push_subscriptions |
| Base de datos legacy | **SharePoint Online** (Microsoft Graph) — usuarios (login), enrich del mapa, geo-IP, dieta-snapshot |
| API externa | Grupo Gamma REST API (mapa de camas en vivo, pacientes, eventos) |
| Tiempo real | **Supabase Realtime** (traslados / limpiezas / comandas) + poll 60s (solo camas) |
| Autenticación | JWT de sesión HS256 (jose) ~10 años + "pase" de lectura ES256 para la RLS de Supabase (TTL 1h) |
| Notificaciones | Web Push (VAPID) por **dos caminos**: Edge Function (traslados) + Vercel push-utils (dieta/ayuno/limpieza) |
| Deploy | Vercel + Supabase (Edge Functions, migraciones SQL) |

### 1.1. Stack de datos: qué vive en Supabase, SharePoint y Gamma

> **Contexto (jul-2026):** el dominio transaccional se **migró de SharePoint a Supabase** (en producción). Las secciones **§21–§47** de este documento son un **changelog histórico** escrito en la época SharePoint; para el estado ACTUAL de traslados / limpiezas / comandas / roles / notificaciones mandan §1.1, §3, §4, §6, §7 y §9. Donde el changelog contradiga a estas secciones, **gana el código** (y estas secciones). El runbook del cutover develop→main es [docs/cutover-supabase-main.md](../historial/cutover-supabase-main.md).

MediFlow corre sobre **tres backends simultáneos**:

**1) Supabase (Postgres)** — proyecto único `qnxckwtssevvhnhyprcl`, compartido por ambos entornos (columna `entorno` = `TESTING` / `PRODUCTIVO`, mismo proyecto). Aloja el dominio transaccional migrado:

| Tabla Supabase | Reemplazó a (SP) | Escribe | Lee el cliente |
|---|---|---|---|
| `public.traslados` | 07.Traslados | [api/tickets.ts](../api/tickets.ts) (service_role) | Realtime `traslados-live` (RLS por entorno) |
| `public.traslado_eventos` | 08.DetalleTraslados | [api/ticket-events.ts](../api/ticket-events.ts) | on-demand / Realtime |
| `public.traslado_obs` | 13.ObservacionesTraslados | [api/ticket-observations.ts](../api/ticket-observations.ts) | on-demand |
| `public.limpiezas` | 14.Limpiezas | [api/limpiezas.ts](../api/limpiezas.ts) | Realtime `limpiezas-live` |
| `public.comandas` | 15.CargaComandas | [api/dietas.ts](../api/dietas.ts) | Realtime `comandas-live` |
| `public.carga_menu` | 16.CargaMenu | [api/carga-menu.ts](../api/carga-menu.ts) | via `/api/carga-menu` |
| `public.roles` | 99.ABMRoles_Traslados | [api/roles.ts](../api/roles.ts) | solo backend (RLS ON, **sin policy**) |
| `public.notificaciones` | 10.Notificaciones | push-utils / Edge Function | via `/api/notifications` |
| `public.push_subscriptions` | 09.PushSubscriptions | [api/push-subscribe.ts](../api/push-subscribe.ts) | solo backend (RLS ON, **sin policy**) |
| `public.push_dispatch_log` | (nuevo) | Edge Function `notify-push` | — (idempotencia del webhook) |

**Patrón de acceso a Supabase:**
- **Lectura del cliente** por Realtime bajo **RLS** que filtra `entorno = auth.jwt() ->> 'entorno'`, usando el "pase" JWT ES256 (§1.2). `roles` y `push_subscriptions` tienen RLS ON pero **sin policies** → candado total, solo backend; `anon` sin grants en ninguna tabla.
- **Escritura** SOLO por `service_role` (secret key `sb_secret_…`, [api/supabase-admin.ts](../api/supabase-admin.ts), bypassa RLS). El browser nunca escribe directo: pega a los endpoints `api/*`. La RLS de las tablas transaccionales **no tiene policy de write** → `authenticated` no puede escribir.
- **Índices-candado** que reemplazan chequeos racy de SharePoint: `traslados_cama_destino_activa_idx` (1 traslado activo por cama destino → violación = 409 `conflictingTicketId`), `limpiezas_activa_uidx` (1 limpieza Activo por cama+entorno), `comandas_titular_viva_uidx` (1 titular vivo por entorno/identidad/comida/día), `push_subscriptions UNIQUE(endpoint)`, `roles_name_lower_uidx` (join case-insensitive único), `traslados UNIQUE(id_univoco, entorno)`.

**2) SharePoint (Microsoft Graph, [api/graph.ts](../api/graph.ts))** — sigue vivo para:
- `00.Usuarios` — login ([api/auth.ts](../api/auth.ts)); join usuario→rol por `Perfil_U` ↔ `roles.name`. Los usuarios **NO** se migraron.
- `12.EnrichCamas` — enrich del mapa (cron `cron-enrich-beds`); [api/dietas.ts](../api/dietas.ts) la lee híbrida para el backstop `sin_dieta`.
- `11.DietaSnapshot` — cron `cron-diet-changes` (hoy **desprogramado**, §42).
- `08.Aislamientos` — [api/isolations.ts](../api/isolations.ts) (**deprecado**: la fuente única de aislamientos es PROGAL vía enrich, §46).
- `99.ABM_GeoIPS` — validación de ubicación.
- `10.Notificaciones` (viejo) — todavía podado por `cron-cleanup-notifs` (**cruft**; NO es la campanita actual, que vive en `public.notificaciones`).

**3) Gamma API (VM 35.224.5.114, [api/beds.ts](../api/beds.ts) + [api/gamma-client.ts](../api/gamma-client.ts))** — mapa de camas en vivo (`obtenermapacamas` + `obtenermapacamasocupadas`). Es el **ÚNICO** dominio que sigue con **poll** (60s); no se migró a Realtime.

**Crons vigentes ([vercel.json](../vercel.json), corren solo en Production):**

| Cron | Schedule | Qué hace | maxDuration |
|---|---|---|---|
| `cron-enrich-beds` | `0,15,30,45 * * * *` | enrich del mapa (12.EnrichCamas) + detección dieta/ayuno → push | 300s |
| `cron-cleanup-notifs` | `0 4 * * *` | poda `10.Notificaciones` **VIEJO** en SharePoint (cruft; no toca `public.notificaciones`) | 300s |
| `cron-trigger-testing` | `5,20,35,50 * * * *` | forwarder que dispara el enrich de la partición TESTING contra el Preview de `develop` (env `TESTING_BASE_URL`) | 15s |
| `cron-diet-changes` | **desprogramado** | (sin schedule; la detección de dieta vive en `cron-enrich-beds`, §42) | 300s |

### 1.2. Dos JWT: sesión (SharePoint) vs pase (Supabase)

|  | `mediflow_token` (sesión) | "pase" de Supabase |
|---|---|---|
| Firma | HS256 (`JWT_SECRET`) | ES256 (`SUPABASE_JWT_PRIVATE_KEY`, JWK P-256) |
| Vida | ~10 años (`EXPIRY_DEFAULT='3650d'`) | 1h |
| Emite | [api/auth.ts](../api/auth.ts) (login) | [api/supabase-token.ts](../api/supabase-token.ts) (valida el mediflow_token) |
| Claims | `id, name, role, sede, email` | `role:'authenticated', entorno, sede, sub=userId` |
| Dónde vive | `localStorage.mediflow_token` | cache in-memory en [lib/supabase.ts](../lib/supabase.ts), `cache:'no-store'` |
| Para qué | `authFetch` a `api/*` | Realtime + RLS de Supabase |

> **Nota:** los headers de `api/jwt.ts` y `api/auth.ts` dicen "8h", pero la constante real es `EXPIRY_DEFAULT='3650d'` (~10 años). El comportamiento real es 10 años; el comentario miente. El "pase" es de un solo uso lógico: el cliente lo re-mintea on-demand y `resetSupabasePase()` lo invalida en login/logout. `cache:'no-store'` (cliente) + `Cache-Control: no-store` (endpoint) evitan que el CDN sirva un pase vencido en loop. Sin `mediflow_token`, el pase es `''` → conexión `anon` → la RLS no deja ver nada (fallback seguro).

### 1.3. Versionado de cliente (APP_VERSION)

[lib/version.ts](../lib/version.ts) exporta `APP_VERSION` (hoy `v20260731_1.0.1`), un literal **baked-at-build** (NO env var) que se bumpéa a mano por deploy que se quiera trazar. Se captura en login (`localStorage.mediflow_version`) y se estampa en la columna `version` de **cada escritura transaccional** (traslados, eventos, obs, limpiezas, comandas, planificación). Migración [`20260731120000_version_columns.sql`](../supabase/migrations/20260731120000_version_columns.sql). Sirve para detectar clientes con build viejo/cacheado (filas server-side o pre-feature quedan `''`/NULL). Badge visible en login + sidebar.

---

## 2. Estructura de directorios

```
solicitudes-gamma/
├── App.tsx                  # Componente raíz: login, layout, routing, modales
├── index.tsx                # Entry point React
├── types.ts                 # Tipos, enums e interfaces compartidas
├── api/                     # Serverless functions (Vercel / dev-server)
│   │  # — Supabase (dominio transaccional) —
│   ├── supabase-admin.ts    # Cliente service_role (secret key, bypassa RLS) — SOLO backend
│   ├── supabase-token.ts    # Mintea el "pase" ES256 de lectura (RLS por entorno)
│   ├── tickets.ts           # CRUD de traslados (public.traslados)
│   ├── ticket-events.ts     # Timeline de traslado (public.traslado_eventos)
│   ├── ticket-observations.ts # Observaciones por traslado (public.traslado_obs)
│   ├── limpiezas.ts         # CRUD de limpiezas por azafata (public.limpiezas)
│   ├── dietas.ts            # CRUD de comandas (public.comandas) — híbrido: sin_dieta lee 12.EnrichCamas
│   ├── carga-menu.ts        # CRUD de planificación de menú (public.carga_menu)
│   ├── roles.ts             # ABM de roles (public.roles, mantiene shape SP para el front)
│   ├── role-cache.ts        # Cache in-memory de roles (TTL 5min, serve-stale-on-error)
│   ├── me.ts                # Resync de sesión en caliente (?roleName → config vigente)
│   ├── notifications.ts     # Campanita in-app (public.notificaciones)
│   ├── push-subscribe.ts    # Upsert de suscripción push (public.push_subscriptions)
│   ├── push-utils.ts        # Envío de push (dieta/ayuno/limpieza) por Vercel web-push
│   │  # — SharePoint (Graph) —
│   ├── auth.ts              # Login contra SP (00.Usuarios) + rate-limit
│   ├── users.ts             # ABM de usuarios (00.Usuarios; propaga rol/áreas a push_subscriptions)
│   ├── isolations.ts        # Aislamientos (08.Aislamientos) — DEPRECADO (fuente única PROGAL)
│   ├── validate-location.ts # Validación IP/geolocalización (99.ABM_GeoIPS)
│   ├── graph.ts             # Helper Microsoft Graph (token cache + fetch + $batch)
│   │  # — Gamma (mapa de camas) + enrich —
│   ├── beds.ts              # Mapa de camas en vivo (Gamma) + merge de 12.EnrichCamas
│   ├── bed-enrich.ts        # Enrich on-demand por cama (fallback del cron)
│   ├── enrich-core.ts       # buildEnrich compartido (cron + on-demand)
│   ├── gamma-client.ts      # Cliente Gamma (token cache, fetchWithTimeout, getEventCached)
│   ├── diet-tags.ts         # parseDiets(); ayunos.ts, isolations-summary.ts, room-formatter.ts
│   │  # — crons —
│   ├── cron-enrich-beds.ts  # Precomputa 12.EnrichCamas + detección dieta/ayuno (0,15,30,45)
│   ├── cron-trigger-testing.ts # Forwarder que dispara el enrich de TESTING (5,20,35,50)
│   ├── cron-cleanup-notifs.ts  # Poda 10.Notificaciones VIEJO en SP (diario 4am)
│   ├── cron-diet-changes.ts # DESPROGRAMADO (detección de dieta migró a cron-enrich-beds)
│   │  # — infra —
│   ├── jwt.ts               # Sign/verify mediflow_token (HS256) + middleware requireAuth
│   ├── rate-limit.ts        # Anti brute-force del login (Upstash + fallback memoria)
│   └── test.ts              # Endpoint de prueba
├── hooks/
│   └── useHospitalState.ts  # Hook central: estado global, polling, acciones
├── views/
│   ├── DashboardView.tsx    # Monitor: KPIs, gráficos, tickets recientes
│   ├── RequestsView.tsx     # Operativa: tabla de tickets con acciones por rol
│   ├── HistoryView.tsx      # Historial: tickets completados, filtros, export XLSX
│   ├── BedsView.tsx         # Mapa de camas: grilla visual, detalle paciente, PDF
│   ├── UserManagementView.tsx # ABM de usuarios
│   └── RoleManagementView.tsx # ABM de roles
├── components/
│   ├── modals/              # Modales de acción
│   │   ├── NewRequestModal.tsx
│   │   ├── AssignBedModal.tsx
│   │   ├── AreaSelectionModal.tsx
│   │   └── RejectionModal.tsx
│   ├── dashboard/           # Componentes del monitor
│   │   ├── StatCard.tsx
│   │   └── StatusDonutChart.tsx
│   ├── ui/                  # Componentes UI genéricos (card, input, table, etc.)
│   ├── AuditModal.tsx       # Modal de auditoría/detalle de ticket
│   ├── PatientJourney.tsx   # Timeline de movimientos del paciente (dentro de HistoryView)
│   ├── Icons.tsx            # Re-exports de lucide-react
│   ├── GammaLogo.tsx        # Logo SVG
│   ├── NotificationToast.tsx
│   ├── NotificationsDropdown.tsx
│   └── StatusBadge.tsx
├── lib/
│   ├── supabase.ts          # Cliente Supabase FRONTEND (publishable key + pase ES256 + RLS)
│   ├── version.ts           # APP_VERSION (baked-at-build, se estampa en cada escritura)
│   ├── permissions.ts       # can()/hasModule()/canReceiveNotif() + NOTIF_TYPE_TO_PERMISSION
│   ├── fasting.ts           # Reloj de ayunos client-side (hora Argentina)
│   ├── utils.ts             # cn(), formatDate, calculateTicketMetrics, isHraArea/isHitArea
│   ├── constants.ts         # Áreas, constantes de negocio
│   ├── pushSubscription.ts  # Suscripción push client-side (self-heal VAPID + heartbeat)
│   ├── ticketEvents.tsx     # Config centralizada de eventos de ticket (label, icono, color)
│   └── real-beds-data.ts    # Datos reales de referencia
├── supabase/
│   ├── migrations/          # Migraciones SQL (tablas, RLS, índices-candado, webhook)
│   └── functions/
│       └── notify-push/     # Edge Function (Deno): push de traslados por Database Webhook
├── src-sw/
│   └── sw.ts                # Service Worker: precache + push handler
├── dev-server.ts            # Servidor local que emula Vercel serverless
├── vite.config.ts           # Config Vite: proxy /api, PWA, alias @
├── vercel.json              # Config deploy: rewrites SPA, headers SW
└── package.json
```

---

## 3. Flujo de datos y comunicación entre módulos

### 3.1. Arquitectura general

```
┌──────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React SPA)                        │
│  App.tsx ──► useHospitalState() ──► Views + Components             │
│      │                          │                                  │
│  authFetch() (mediflow_token)   supabase-js (pase ES256)           │
│      │                          │                                  │
│  ┌───▼──────────┐          ┌────▼───────────────────┐             │
│  │ /api/* (Vercel)│         │ Supabase Realtime (RLS) │             │
│  └───┬──────────┘          └────┬───────────────────┘             │
└──────┼──────────────────────────┼─────────────────────────────────┘
       │                          │  canales *-live (traslados,
       │ service_role             │  limpiezas, comandas)
       ▼                          ▼
 ┌──────────────┐   ┌────────────────────┐   ┌────────────────────┐
 │ SharePoint   │   │ Supabase (Postgres)│   │ Grupo Gamma API    │
 │ (Graph)      │   │ traslados/limpiezas│   │ (VM 35.224.5.114)  │
 │ 00.Usuarios  │   │ comandas/carga_menu│   │ obtenermapacamas   │
 │ 12.EnrichCamas│  │ roles/notificaciones│  │ obtenermapacamas-  │
 │ 99.ABM_GeoIPS│   │ push_subscriptions │   │   ocupadas         │
 └──────────────┘   └─────────┬──────────┘   └────────────────────┘
   login, enrich,             │ Database Webhook (pg_net)
   geo-IP                     ▼
                     ┌────────────────────┐
                     │ Edge Function      │  Web Push (traslados)
                     │ notify-push (Deno) │
                     └────────────────────┘
```

El browser habla con **tres planos**: (a) los endpoints `api/*` de Vercel con el `mediflow_token` (todas las escrituras + lecturas on-demand), (b) **Supabase Realtime** con el "pase" ES256 (lecturas en vivo de traslados/limpiezas/comandas bajo RLS por entorno), y (c) nada directo con SharePoint/Gamma (siempre vía `api/*`).

### 3.2. Flujo de autenticación

1. El usuario ingresa email y contraseña en el formulario de login (`App.tsx`).
2. `useHospitalState.handleLogin()` envía `POST /api/auth` con las credenciales.
3. `api/auth.ts` busca en la lista SharePoint `00.Usuarios` un usuario activo cuyo `UsuarioApp_Usr` coincida y verifica la contraseña contra `Password_Usr`.
4. Si es válido, firma un JWT (HS256, **~10 años de vida** para todos los roles) con `jose` conteniendo `id`, `name`, `role`, `sede`, `email`.
5. El token se guarda en `localStorage` (`mediflow_token`) y se envía como `Authorization: Bearer <token>` en todos los requests posteriores via `authFetch()`.
6. El middleware `requireAuth` en cada endpoint verifica el token antes de procesar.
7. Se monitorea la expiración del token cada 60s; como el token dura ~10 años, la advertencia y el auto-logout en la práctica nunca se disparan (pero el código sigue activo). El logout explícito (botón) sigue funcionando normalmente.

**Nota:** el token tiene ~10 años de vida para todos los roles. La app se usa instalada como PWA en celulares y tablets; el re-login frecuente es más una molestia operativa que una ganancia de seguridad en este contexto. La principal barrera de seguridad es el control de ubicación (IP + GPS).

**Pase de Supabase (paso adicional post-login):** con el `mediflow_token` en mano, el cliente pide `GET /api/supabase-token` (Bearer del mediflow_token) y recibe un JWT ES256 corto (1h, claim `entorno`) que [lib/supabase.ts](../lib/supabase.ts) inyecta como `accessToken` en cada request/reconexión de Realtime. Es lo que habilita las lecturas del cliente bajo RLS. Ver §1.2. El login también hidrata permisos/módulos/`filterByFloors`/`bypassLocationCheck` desde `public.roles` (via role-cache) y, si el rol tiene notificaciones concedidas, registra la suscripción push (snapshot de rol+áreas+sede+entorno).

### 3.3. Flujo de un traslado (ciclo de vida del Ticket)

```
 WAITING_ROOM ──► IN_TRANSIT ──► IN_TRANSPORT ──► WAITING_CONSOLIDATION ──► COMPLETED
 (Esperando       (Habitación    (En Traslado)    (Por Consolidar)          (Consolidado)
  Habitación)      Lista)
                                                                      ──► REJECTED
                                                                          (Cancelado)
```

| Estado | Quién actúa (permiso) | Acción |
|--------|-------------|--------|
| **crear** | Admisión (`crear_ticket`) | `POST /api/tickets` → arranca en `WAITING_ROOM` (destino EN PREPARACIÓN) **o directo** en `IN_TRANSIT` (destino DISPONIBLE, se saltea limpieza) |
| `WAITING_ROOM → IN_TRANSIT` | **Azafata de destino** (`confirmar_limpieza`, "Habitación Lista") | `PATCH /api/tickets` (status + cama destino "Asignada") |
| `IN_TRANSIT → IN_TRANSPORT` | **Azafata de origen** (`iniciar_traslado`, "Iniciar Traslado") | `PATCH /api/tickets` (status + cama origen "En preparación") |
| `IN_TRANSPORT → WAITING_CONSOLIDATION` | **Azafata de destino** (`confirmar_recepcion`, "Recepción OK") | `PATCH /api/tickets` (status + cama destino "Ocupada" + migra comandas) |
| `WAITING_CONSOLIDATION → COMPLETED` | Admisión/Admin (`consolidar`, "Consolidar PROGAL") | `PATCH /api/tickets` (status + completedAt) |
| `* → REJECTED` | Admisión/Admin (`cancelar_ticket`, motivo obligatorio) | `PATCH /api/tickets` (status + motivo_cancelacion) |

> **Ojo con dos matices que la tabla vieja tenía mal:** (1) quien confirma la limpieza previa al ingreso es la **azafata de destino** (rol HOSTESS, `confirmar_limpieza`), no un "Housekeeping" genérico; (2) un traslado con cama destino **DISPONIBLE** nace directo en `IN_TRANSIT` (salta el paso de limpieza), solo con destino **EN PREPARACIÓN** nace en `WAITING_ROOM`. El enforcement de piso de la azafata se valida server-side en `api/tickets.ts` (403 si el traslado no pertenece a sus áreas; regla HRA remapea al piso real del otro extremo). La columna `intervino_azafata` pasa de `'NO'` a `'SI'` en la primera acción de azafata y bloquea la **edición** (no la cancelación).

Cada transición genera:
- Un evento en `public.traslado_eventos` (via `POST /api/ticket-events`, append-only) para la trayectoria.
- Una notificación push, **disparada por la Edge Function `notify-push`** (Database Webhook sobre `public.traslados`, no por `push-utils`) — una sola vez por versión de fila commiteada (§7).
- Una fila en `public.notificaciones` (campanita in-app) por usuario destinatario; el propio actor ve su acción por `addNotification` local optimista y **no** recibe su propia push.

### 3.4. Sincronización: Realtime (transaccional) + poll (solo camas)

> **Cambio de arquitectura:** el **poll de tickets cada 8s y de limpiezas cada 60s YA NO existe.** Los tres dominios transaccionales llegan por **Supabase Realtime**. El único poll que queda es el de **camas** (Gamma no está en Supabase).

**Realtime (`useHospitalState` monta 3 canales al tener token + pase):**
- `traslados-live`, `limpiezas-live`, `comandas-live` — `postgres_changes` (`event:*`) sobre `public.traslados` / `public.limpiezas` / `public.comandas`.
- Un cambio de fila dispara un **refetch debounced (300ms)** al endpoint del dominio (`/api/tickets`, `/api/limpiezas`, `/api/dietas`), respetando el optimistic update en vuelo (`mealsWritingRef` para comandas).
- Al **(re)conectar** (status `SUBSCRIBED`) se hace **catch-up** con un fetch completo: Realtime **no** reenvía los eventos perdidos mientras el socket estuvo caído.
- El `GET /api/tickets` quedó **on-demand**: `?all=1` (Monitor/Historial), `?patientCode=` (historia de un paciente) y una "vista viva" (activos + cerrados en ventana de gracia de 30 min) casi sin uso porque Realtime empuja los cambios.

**Camas — único poll que queda (Gamma, sigue en SharePoint):**
- `GET /api/beds` cada **60s** (`POLL_BEDS_MS`) con `If-None-Match`. Cache server-side de **45s** + ETag (combina firma del mapa + del enrich, §31.4). El enrich (DNI/dieta/ayuno/diagnóstico) lo **precomputa** el cron `cron-enrich-beds` en `12.EnrichCamas`; `/api/beds` lo lee en 1 query y lo mergea (ver §31). El click en cama usa `/api/bed-enrich` solo como fallback para camas que el cron aún no procesó.

**Resiliencia en camas:** Si un poll de camas falla (error HTTP, JSON inválido, array vacío), se conservan los datos anteriores. Si Gamma responde con camas sin ocupación pero el estado anterior tenía ocupadas, se descarta la respuesta (fallo parcial de Gamma → sirve cache stale con `X-Beds-Stale`, evita mostrar ocupadas como Disponibles).

**Detección de cambios (campanita/toast):** al recibir tickets, se compara un snapshot previo (`Map<id, status>`) contra los nuevos. Los cambios generan notificaciones in-app con sonido (Web Audio API, G5 + C6). El envío real de push lo hacen los dos caminos del §7 (Edge Function + push-utils), no el cliente.

**Protección de escritura:** Un `writingRef` (tickets) / `mealsWritingRef` (comandas) evita que un refetch de Realtime pise el estado optimista mientras la escritura viaja al backend.

---

## 4. API Backend — Serverless Functions

Cada archivo en `api/` es una Vercel Serverless Function. En desarrollo, `dev-server.ts` las sirve localmente en `http://localhost:3000` emulando la interfaz de Vercel (`req.body`, `req.query`, `res.status().json()`).

### 4.1. `api/graph.ts` — Microsoft Graph Client

Helper compartido por todos los endpoints que acceden a SharePoint:
- Obtiene un token de Azure AD via Client Credentials flow (`client_credentials` grant).
- Cachea el token en memoria del módulo (sobrevive invocaciones "warm" en Vercel).
- Expone `graphFetch(path, init)` que agrega automáticamente el `Authorization` header.

### 4.2. `api/gamma-client.ts` — Cliente compartido de Gamma

Módulo compartido que centraliza la comunicación con la API de Grupo Gamma:
- Token cache por scope (sobrevive invocaciones warm de Vercel).
- Flujo OAuth de 3 pasos: `oauth_authorize` → `oauth_token` → `oauth_resource/<endpoint>`.
- Helpers: `getToken()`, `fetchPatientDetails()`, `fetchEventDetails()`, `calcAge()`.
- Interfaces: `GammaBed`, `GammaPatient`, `GammaSector`, `GammaEvent`.
- Utilidad `simpleHash()` (DJB2) para ETags.

Usado por `api/beds.ts` y `api/bed-enrich.ts`.

### 4.3. `api/beds.ts` — Proxy de la API Gamma (mapa de camas)

Endpoint rápido con **cache server-side de 45 segundos** y soporte **ETag/304**.

Solo hace 2 llamadas a Gamma:
- `obtenermapacamas` — mapa completo de camas (sectores → habitaciones → camas).
- `obtenermapacamasocupadas` — camas ocupadas con paciente, **profesional e institución** (endpoint mejorado por Gamma).

Retorna camas con: estado, nombre del paciente, profesional, financiador/institución, evento. **No incluye** datos de enriquecimiento (DNI, edad, sexo, diagnóstico) — esos se obtienen on-demand via `/api/bed-enrich`.

Las respuestas de Gamma se parsean con `safeJson()` que devuelve `[]` si no es JSON válido. Si hay cache stale y Gamma falla, se sirve la cache en vez de un error.

### 4.4. `api/bed-enrich.ts` — Enriquecimiento on-demand por cama

Endpoint para obtener datos detallados de un paciente específico. Se llama cuando el usuario hace click en una cama ocupada en el mapa.

- `GET /api/bed-enrich?patientCode=X&eventOrigin=Y&eventNumber=Z`
- Llama a `consultarpacientecodigo` (DNI, edad, sexo, obra social) + `obtenereventointernacion` (diagnóstico, profesional prescriptor).
- **Cache server-side de 10 minutos** por `patientCode`.
- Solo 2 llamadas a Gamma por request (nunca más).
- Devuelve: `{ dni, age, sex, institution, diagnosis, prescribingPhysician }`.

### 4.3. `api/tickets.ts` — CRUD de Traslados (Supabase)

Escribe `public.traslados` con el cliente **service_role** ([api/supabase-admin.ts](../api/supabase-admin.ts), bypassa RLS). Mapea bidireccionalmente entre el modelo `Ticket` (types.ts) y la fila vía `rowToTicket`/`ticketToRow` (columnas `id_univoco`, `paciente`, `status`, `intervino_azafata`, `entorno`, `version`, …). El browser **no** escribe directo: pega a este endpoint.
- `GET` — **on-demand**: `?all=1` (Monitor/Historial), `?patientCode=` (historia de un paciente), y la "vista viva" (activos + cerrados en ventana de gracia de 30 min). El grueso de la actualización llega por Realtime (§3.4).
- `POST` — crea el ticket (upsert idempotente `onConflict (id_univoco, entorno)`). **No** dispara push; el push lo hace la Edge Function por webhook (§7). El índice único parcial `traslados_cama_destino_activa_idx` garantiza 1 traslado activo por cama destino (Postgres 23505 → **409** con `conflictingTicketId`).
- `PATCH` — transiciones de estado. **Enforcement de piso server-side**: si el rol tiene `filter_by_floors` y no es full access (≥9 áreas), la acción de azafata solo pasa si el piso requerido está en sus áreas → si no, **403**. Mapeo status→extremo: `IN_TRANSIT`→destino, `IN_TRANSPORT`→origen, `WAITING_CONSOLIDATION`→destino (regla HRA: remapea al piso real del otro extremo). Editar destino revalida el 409 de cama y solo se permite con `intervino_azafata='NO'`.
- Códigos: 400 (falta id/spItemId), 403 (piso), 409 (cama destino tomada), 503 (Supabase sin configurar).

### 4.4. `api/validate-location.ts` — Validación de ubicación

Verifica que el usuario acceda desde una ubicación autorizada:
- **IP:** compara el subnet del cliente contra prefijos permitidos en la lista `99.ABM_GeoIPS`.
- **Geolocalización:** calcula distancia Haversine contra coordenadas permitidas (radio 200m, ver `GEO_RADIUS_METERS` en [api/location-check.ts](api/location-check.ts)).
- **Fail-open:** si la validación falla técnicamente, se permite el acceso para no bloquear operaciones hospitalarias.

### 4.5. Otros endpoints

| Endpoint | Fuente de datos | Función |
|----------|----------|---------|
| `api/tickets.ts` | **Supabase** `traslados` | CRUD de traslados (service_role) — ver §4.3 |
| `api/ticket-events.ts` | **Supabase** `traslado_eventos` | Timeline append-only (trayectoria) |
| `api/ticket-observations.ts` | **Supabase** `traslado_obs` | Observaciones por traslado, snapshotean el status |
| `api/limpiezas.ts` | **Supabase** `limpiezas` | GET activas / POST marcar limpia (upsert) / PATCH cerrar (`ANULADA`\|`TICKET`\|`GAMMA`\|`CONSOLIDADO`) |
| `api/dietas.ts` | **Supabase** `comandas` (+ SP `12.EnrichCamas` para `sin_dieta`) | CRUD de comandas por turno/acompañante + reubicar al trasladar |
| `api/carga-menu.ts` | **Supabase** `carga_menu` | CRUD de planificación de menú (rango sin solapamiento) |
| `api/roles.ts` | **Supabase** `roles` | CRUD de roles (mantiene el shape SP para el front; `invalidateRoleCache()` en cada mutación) |
| `api/me.ts` | **Supabase** `roles` (via role-cache) | `?roleName` → config vigente del rol (resync de sesión en caliente, pollea 60s) |
| `api/notifications.ts` | **Supabase** `notificaciones` | Campanita in-app por usuario+entorno (GET no-leídas / PATCH marcar) |
| `api/push-subscribe.ts` | **Supabase** `push_subscriptions` | Upsert por endpoint (UNIQUE) + heartbeat `last_seen_at` |
| `api/supabase-token.ts` | — | Mintea el "pase" ES256 de lectura (RLS por entorno, §1.2) |
| `api/users.ts` | SharePoint `00.Usuarios` | CRUD de usuarios (soft-delete `Status_U='Inactivo'`; propaga rol/áreas a `push_subscriptions`) |
| `api/isolations.ts` | SharePoint `08.Aislamientos` | **DEPRECADO** — la fuente única de aislamientos es PROGAL vía enrich (§46) |

---

## 5. Frontend — Componentes principales

### 5.1. `App.tsx` — Componente raíz

Responsabilidades:
- **Login screen:** formulario de autenticación (cuando `currentUser` es `null`).
- **Layout:** sidebar (desktop fija / mobile drawer) + header + main content.
- **Routing por estado:** `currentView` determina qué vista renderizar (no usa react-router; es una SPA con navegación interna por estado).
- **Control de acceso por rol:** determina qué vistas y acciones están disponibles según el rol del usuario.
- **Orquestación de modales:** `NewRequestModal`, `AssignBedModal`, `RejectionModal`, `AreaSelectionModal`.

### 5.2. `hooks/useHospitalState.ts` — Estado global

**Patrón:** un único custom hook que centraliza todo el estado de la aplicación. No usa Redux ni Context; simplemente retorna `{ state, actions }` desde el componente raíz y pasa props a las vistas.

**Estado que gestiona:**
- Sesión: `currentUser`, `token`, `tokenExpirySoon`, `loginEmail/Pass/Error/Loading`.
- Datos: `tickets`, `rawBeds`, `beds` (derivado), `isolatedPatients`, `isolatedBeds` (derivado).
- UI: `currentView`, `activeRole`, `sortConfig`, `requestsSearchTerm`, `notifications`, `toasts`.
- Polling: refs para ETag, snapshot de tickets, cooldown de sonido, bloqueo de escritura.

**Acciones que expone:**
- `handleLogin`, `handleLogout` — autenticación.
- `handleCreateTicket`, `handleRoomReady`, `handleStartTransport`, `handleConfirmReception`, `handleConsolidate`, `handleRejectTicket`, `handleEditTicket`, `handleAddObservation` — ciclo de vida del traslado (§3.3). `handleAssignBedAction` quedó **legacy/no-op** (la cama se asigna al crear).
- `fetchBeds`, `fetchTickets`, `refreshAll` — fetch manual (este último invalida ETags y trae camas + tickets + aislamientos en paralelo; se dispara desde el botón "Refrescar" del mapa).
- `toggleIsolation(bedLabel, nextTypes?)` — aislamientos multi-tipo (`nextTypes` es array; `undefined` o `[]` borra todos los tipos del paciente).
- `markBedClean(bed)` — marca una cama "En preparación" como limpia (POST a `/api/limpiezas` → `public.limpiezas`, optimista + push `ROOM_CLEANED`).
- `undoBedClean(bedLabel)` — deshace la limpieza (PATCH `motivo=ANULADA`).
- `handleUpdateUserAreas` — áreas de azafata.
- Setters: `setCurrentView`, `setActiveRole`, `setLoginEmail`, etc.

**Merge de camas:** la función `mergeBeds()` combina **cuatro** fuentes: datos reales de Gamma, tickets activos (Supabase), overlay de limpiezas (`public.limpiezas`) y overlay de comandas (`public.comandas`). Una cama que PROGAL reporta "En preparación" y tiene una limpieza activa se muestra como disponible con el overlay `cleaned=true` (chip "Limpia ✓" en BedsView). PROGAL es read-only: el overlay es solo visual, no escribe a PROGAL.

**Edición de ticket (`handleEditTicket`):** admite cambiar workflow, destino, motivo de cambio, financiador ITR y observaciones. Solo disponible mientras `intervino_azafata='NO'`. Valida que la nueva cama destino siga `AVAILABLE` o `PREPARATION` al momento del guardado (protege contra race conditions con otros admins; **409** si otro admin la tomó), recalcula `status` (IN_TRANSIT vs WAITING_ROOM) según el estado Gamma de la nueva cama, y registra un único evento `"Modificacion - {cambios} - Motivo: {motivo}"` en `public.traslado_eventos`. La liberación de la cama vieja es **implícita** gracias a `mergeBeds`. (La edición de **aislamiento** desde la app ya **no** existe: la fuente única es PROGAL vía enrich, §46.)

**Sincronización (ver §3.4):**
- `tickets` / `limpiezas` / `comandas`: **Supabase Realtime** (canales `*-live`, refetch debounced 300ms). El poll de tickets de 8s **ya no existe**.
- `beds`: poll cada 60 s (`POLL_BEDS_MS`) — único dominio que no está en Supabase.
- `isolations`: **eliminado** — el aislamiento viaja en el enrich (`bed.isolations`), fuente única PROGAL (§46).

### 5.3. Vistas

El acceso a cada vista lo gobierna `hasModule(user, mod)` (los módulos del rol, `public.roles.modules`), no un rol hardcodeado.

| Vista | Módulo (`hasModule`) | Descripción |
|-------|--------|-------------|
| `DashboardView` | Home | KPIs (activos, completados, espera media), gráficos (volumen por workflow, donut de estados), tickets recientes |
| `RequestsView` | Operativa | Tabla de traslados activos + solapa de limpiezas, con acciones contextuales por permiso. Tabs de perfil operativo. Búsqueda/orden |
| `HistoryView` | Historial | **Lista** (cerrados, filtros fecha/estado/tipo, export XLSX, AuditModal) + **Trayectoria** (paciente → `PatientJourney`) |
| `BedsView` | Mapa de Camas | Grilla de camas por sector/piso, colores por estado, detalle del paciente (4 tabs), PDFs (sector / A-Z / dietas-ayunos). Marcar/deshacer limpieza |
| `CleaningManagementView` | Gestion Limpieza | Supervisor: tab Activas (consolidar `CONSOLIDADO PROGAL`, permiso `consolidar_limpieza`) + tab Histórico por `fecha_cierre` |
| `ComandasManagementView` | Gestion Comandas | Nutrición/Catering: tab "De hoy" (Pendientes/Entregadas, entregar/anular/volver-a-pendiente) + Histórico + Planificación de menú |
| `UserManagementView` | Configuracion (`abm_usuarios`) | ABM de usuarios (SharePoint `00.Usuarios`). Asignación de pisos a azafatas |
| `RoleManagementView` | Configuracion (`abm_roles`) | ABM de roles (`public.roles`). Permisos agrupados por módulo |

---

## 6. Sistema de roles y permisos

Los roles y sus permisos se gestionan dinámicamente desde **`public.roles` en Supabase** (migrados de la lista SP `99.ABMRoles_Traslados`). La tabla tiene RLS ON **sin policies** y grants solo a `service_role` → el backend la lee con la secret key ([api/supabase-admin.ts](../api/supabase-admin.ts)); `anon`/`authenticated` no la ven nunca. `api/roles.ts` reconstruye el **shape SP** (campo `access` unido por `/`, `permissions` como array, `spItemId`=uuid) para no tocar el front. Columnas: `name` (join case-insensitive por `lower(name)`, único), `modules text[]`, `permissions text[]`, `filter_by_floors bool`, `bypass_location_check bool`, `status` (`Activo`/`Inactivo`).

### 6.1. Roles (100% dinámicos, editables desde el ABM)

Ya no hay roles "fijos por SharePoint": cualquier rol se crea/edita/elimina (soft-delete `status='Inactivo'`) desde el ABM (`views/RoleManagementView.tsx`, permiso `abm_roles`). Ejemplos de configuración típica:

| Rol | Módulos típicos | Notas |
|---------------------|-----------|-------------------------------|
| **Admin** | Home / Operativa / Historial / Mapa de Camas / Gestion Limpieza / Gestion Comandas / Configuracion | full access |
| **Admision** | Home / Operativa / Historial / Mapa de Camas | crea/consolida traslados |
| **Azafata** | Operativa / Historial / Mapa de Camas | `filter_by_floors=Sí` |
| **Enfermeria** | Mapa de Camas | solo lectura |
| **Catering / Cocina** | Mapa de Camas / Gestion Comandas | `ver_dieta`, recibe DIET/FASTING/RECEPTION |
| **Nutricion** | Mapa de Camas / Gestion Comandas | carga comandas + planificación |

> Un usuario cuyo `Perfil_U` no matchea ningún `roles.name` loguea igual pero queda `permissions:[] modules:[]` → **solo-lectura** (modo seguro).

### 6.2. Mapeo de módulos a vistas

| Módulo (`roles.modules`) | Vista en la app | Descripción |
|---------------------|-----------------|-------------|
| Home | `DashboardView` | Monitor con KPIs y gráficos |
| Operativa | `RequestsView` | Traslados + limpiezas con acciones por permiso |
| Historial | `HistoryView` | Modo Lista (cerrados, export XLSX) + modo Trayectoria (por paciente) |
| Mapa de Camas | `BedsView` | Grilla de camas, detalle paciente (4 tabs), export PDF |
| Gestion Limpieza | `CleaningManagementView` | Supervisor de limpiezas (Activas + Histórico) |
| Gestion Comandas | `ComandasManagementView` | Panel de comandas + planificación de menú |
| Configuracion | `UserManagementView` + `RoleManagementView` | ABM de usuarios y roles |

### 6.3. Acciones en Operativa por rol

| Rol | Acciones disponibles |
|-----|---------------------|
| **Admin** | Todas: crear ticket, asignar cama, consolidar, cancelar + ABM usuarios/roles |
| **Admision** | Crear ticket, asignar cama, consolidar, cancelar |
| **Azafata** | Confirmar limpieza, iniciar transporte, confirmar recepción (filtrado por áreas asignadas) |
| **Enfermeria** | Solo lectura (Mapa de Camas únicamente) |
| **Catering** | Solo lectura (Mapa de Camas únicamente) |

### 6.4. Comportamiento especial por rol

- **Azafatas:** solo ven tickets cuyas camas de origen o destino estén en sus `assignedAreas` (pisos asignados vía el campo `PisosAzafata_u` en `00.Usuarios`). Al primer login sin áreas asignadas, se les muestra `AreaSelectionModal`.
- **Enfermería y Catering:** al no tener acceso a Operativa ni Home, la app los redirige automáticamente a Mapa de Camas como vista por defecto.
- **Configuración es dinámica:** cualquier rol con el módulo `Configuracion` + los permisos `abm_usuarios`/`abm_roles` entra al ABM. Ya **no** hay privilegio hardcodeado por rol "Admin".
- **Resync en caliente + límite:** `syncSessionRole` pollea `/api/me?roleName` cada 60s y actualiza módulos/permisos/flags **sin re-loguear**. Limitación: refresca por el `roleName` al que el usuario ya pertenece; si un admin **reasigna** el usuario a OTRO rol, ese cambio se toma recién al re-loguear.
- **Enforcement server-side:** `bypass_location_check` y el filtro de piso de la azafata se deciden server-side con lookup fresco del rol (no confían en el flag del cliente, que se hidrata en login y queda viejo).

### 6.5. Catálogo de permisos vigente (`types.ts` `PERMISSIONS`)

Catálogo **cerrado** (`as const`). `can(user, perm)` gatea botones/mutaciones (UI); `hasModule` gatea vistas; `canReceiveNotif` gatea la campanita. (Se eliminaron `editar_aislamiento` —§46— y el viejo `recibe_push` —§28.)

| Grupo | Permisos |
|---|---|
| Traslados | `crear_ticket`, `editar_ticket`, `cancelar_ticket`, `asignar_cama` (**legacy**, no-op), `confirmar_limpieza`, `iniciar_traslado`, `confirmar_recepcion`, `consolidar` |
| Limpiezas | `consolidar_limpieza` |
| Comandas | `cargar_dieta` (todos los turnos), `cargar_comanda_{desayuno,almuerzo,merienda,cena}` (granular, derivados de `MEAL_SLOTS`), `ver_dieta`, `ver_planificacion`, `abm_planificacion` |
| Configuración | `abm_usuarios`, `abm_roles` |
| Notificaciones (una por tipo) | `notif_new_ticket`, `notif_status_update`, `notif_reception_confirmed`, `notif_diet_change`, `notif_fasting_change`, `notif_habitacion_limpia` |

Módulos (`ROLE_MODULES`): `Home`, `Operativa`, `Historial`, `Mapa de Camas`, `Gestion Limpieza`, `Gestion Comandas`, `Configuracion`.

---

## 7. Notificaciones

### 7.1. In-app (campanita)

La campanita persiste en **`public.notificaciones`** (una fila por usuario+evento); el cliente la lee por `GET /api/notifications` (no-leídas, o `?window=24h`). Además, el hook `useHospitalState` detecta cambios al recibir actualizaciones de Realtime comparando el snapshot de `id → status` y genera objetos `Notification` locales que se muestran como:
- **Toast:** banner efímero con sonido (Web Audio, dos tonos G5+C6).
- **Dropdown:** listado con marca de lectura (`bellNotifications` deduplica el historial por evento).

Filtrado por relevancia (`canReceiveNotif` + área): las Azafatas solo ven notificaciones de tickets en sus áreas asignadas; Catering recibe solo por push server-side (§25). El propio actor ve su acción por `addNotification` optimista y no recibe su propia push.

### 7.2. Web Push — DOS caminos

Las suscripciones viven en **`public.push_subscriptions`** (Supabase, `UNIQUE(endpoint)` → duplicado imposible; columnas `user_id`, `user_role`, `assigned_areas text[]`, `sede`, `entorno`, `last_seen_at` heartbeat). La campanita in-app es **`public.notificaciones`** (una fila por usuario por evento). Hay **dos emisores** de push, ambos leen `push_subscriptions` + `roles` de Supabase y aplican el mismo filtro:

| Camino | Tipos | Corre en | Disparo |
|---|---|---|---|
| **Edge Function `notify-push`** (Deno) | `NEW_TICKET`, `STATUS_UPDATE`, `RECEPTION_CONFIRMED` | **Supabase** | Database Webhook (`pg_net`) sobre INSERT/UPDATE de `public.traslados` |
| **`api/push-utils.ts`** (web-push) | `DIET_CHANGE`, `FASTING_CHANGE`, `ROOM_CLEANED` | **Vercel** | crons (`cron-enrich-beds`) y acciones (`api/limpiezas.ts`) |

**Por qué el split:** mover el push de traslados al webhook lo dispara **una sola vez por versión de fila commiteada** — mató el bug "TIN TIN TIN" de duplicados. Idempotencia extra por `public.push_dispatch_log` (key `id_univoco:status:updated_at`, insert on conflict do nothing).

**Matriz de filtrado (`isRelevant`, idéntica en ambos emisores):** (a) `excludeUser` — el actor NO se autonotifica (`created_by_id` en INSERT, `last_actor_id` en UPDATE); (b) sede; (c) rol activo (join por nombre case-insensitive); (d) **permiso granular** (`NOTIF_TYPE_TO_PERMISSION[type]` ∈ `roles.permissions`); (e) `filter_by_floors` → `subAreaMatches` por áreas (remap HRA; ≥9 áreas = full access); (f) suscripción fresca (`last_seen_at` ≤36h). CATERING recibe título/cuerpo custom en `RECEPTION_CONFIRMED` ("Traslado concretado…").

**Reglas de la sub:** solo 404/410 borran la sub (vencida); un **403 NO** (podría ser misconfig VAPID global → vaciaría toda la tabla). El VAPID debe coincidir en 3 puntas (Vercel Production, secrets de la Edge Function, `VITE_VAPID_PUBLIC_KEY` del build). El cliente se auto-cura: `subscribeToPush` regenera la sub si la llave pública no matchea (self-heal en mount/F5) + `touchPushSubscription` refresca el heartbeat cada 6h.

**Entorno:** solo se notifica a subs del `ENTORNO` actual (default `TESTING` para no disparar a reales por misconfig). El Service Worker (`src-sw/sw.ts`) muestra la notificación nativa y al hacer click enruta a la app (marca leído por `ticketId+type`).

> El `STATUS_LABELS` de la Edge Function decide el label de cada transición: `Habitacion Lista`→"Habitación Lista", `En Traslado`→"Traslado en Curso", `Por Consolidar`→"Recepción Confirmada" (RECEPTION_CONFIRMED), `Consolidado`→"Traslado Finalizado", `Cancelado`→"Traslado Cancelado". **`Esperando Habitacion` (WAITING_ROOM) no tiene label → NO dispara push.**

---

## 8. PWA (Progressive Web App)

- **vite-plugin-pwa** con estrategia `injectManifest` genera el Service Worker.
- El manifest configura la app como `standalone` con nombre "Grupo Gamma - Gestión de Traslados".
- El SW precachea assets estáticos y excluye `/api/` del fallback de navegación.
- `vercel.json` configura el header `Service-Worker-Allowed: /` para el SW.
- **Instalación en Android:** el sidebar mobile muestra un botón "Instalar App" (solo en Android) que captura el evento `beforeinstallprompt` del browser y dispara el prompt de instalación nativo. Desaparece tras instalar o si la app ya está instalada.

---

## 9. Persistencia: tablas Supabase + listas SharePoint

### 9.0. Tablas Supabase (dominio transaccional migrado)

Proyecto `qnxckwtssevvhnhyprcl`, entorno-scoped por columna `entorno`. Ver §1.1 para el patrón de acceso (RLS + pase + service_role) y los índices-candado.

| Tabla | Migración | Reemplazó a | Estados / notas |
|-------|-----------|-------------|-----------------|
| `public.traslados` | `20260729163447` (+`170658`) | 07.Traslados | status español; `intervino_azafata`; `version` |
| `public.traslado_eventos` | `20260729163447` | 08.DetalleTraslados | append-only; ahora con `entorno` (08 no lo tenía) |
| `public.traslado_obs` | `20260729163447` | 13.ObservacionesTraslados | snapshotea el status del ticket |
| `public.limpiezas` | `20260729172000` | 14.Limpiezas | `status` Activo/Inactivo; `motivo_cierre` ANULADA/TICKET/GAMMA/CONSOLIDADO |
| `public.comandas` | `20260730120000` | 15.CargaComandas | Activo(pendiente)/Entregado/Inactivo; cols GENERATED `dia`+`identidad` |
| `public.carga_menu` | `20260730120000` | 16.CargaMenu | plantilla por rango; `fecha_inicio/fin` (date) |
| `public.roles` | `20260729155507` | 99.ABMRoles_Traslados | RLS ON **sin policy**; solo service_role |
| `public.notificaciones` | `20260729160711` | 10.Notificaciones | campanita in-app; RLS SELECT/UPDATE own |
| `public.push_subscriptions` | `20260729153848` | 09.PushSubscriptions | `UNIQUE(endpoint)`; RLS ON **sin policy** |
| `public.push_dispatch_log` | `20260729170658` | (nuevo) | idempotencia del webhook |

RLS de lectura: `20260729171716` (SELECT por entorno en traslados/eventos/obs; el resto análogo). Grants: `20260729182257`. Webhook de push: `20260729183000`. Columnas `version`: `20260731120000`.

### 9.1. Listas SharePoint todavía en uso

| Lista | ID | Propósito | Estado |
|-------|----|-----------|--------|
| `00.Usuarios` | `e623ad06-ff62-441f-b67d-666224af5805` | Usuarios de la app (login, ABM) | **vigente** (no migró) |
| `12.EnrichCamas` | `443c4ff0-bc98-43ef-a49c-7fd91cc63734` | Enrich precomputado del mapa (cron) | **vigente** |
| `11.DietaSnapshot` | — | Snapshot de dieta (cron-diet-changes) | vigente pero cron **desprogramado** (§42) |
| `99.ABM_GeoIPS` | `c30a13f0-070a-45bf-9ff2-415b36325af5` | IPs y geolocalizaciones permitidas | **vigente** |
| `08.Aislamientos` | `0a36e3e2-1ca2-4951-86f9-afd288465022` | Aislamientos por paciente | **deprecado** (fuente única PROGAL, §46) |
| `10.Notificaciones` | `240f00dd-715b-4c78-9661-3147b7650a0f` | Historial viejo de notifs | **cruft**: solo lo poda `cron-cleanup-notifs`; la campanita real es `public.notificaciones` |

### 9.2. Listas SharePoint MIGRADAS a Supabase (ya no se leen/escriben)

Se mantienen los GUIDs como registro histórico; el runtime ya **no** las usa (ver §9.0).

| Lista SP (histórica) | ID | Ahora en |
|-------|----|----------|
| `07.Traslados` | `c7417674-9084-416d-a955-7024161a3194` | `public.traslados` |
| `08.DetalleTraslados` | `bd50c2be-0ec7-45d7-b1f5-abf10546675d` | `public.traslado_eventos` |
| `09.PushSubscriptions` | `648fde7b-89d2-40ac-bc4a-63661508b50a` | `public.push_subscriptions` |
| `13.ObservacionesTraslados` | `1c524476-f88f-47c8-ad22-4b3f7f429e46` | `public.traslado_obs` |
| `14.Limpiezas` | `3665d496-0e52-465e-b40f-54ca39cd5856` | `public.limpiezas` |
| `99.ABMRoles_Traslados` | `68836bbe-18c5-4cb2-8cc6-e21ecae96710` | `public.roles` |

**Columnas de `public.limpiezas`** (Supabase, migración `20260729172000` — reemplaza a la vieja lista SP `14.Limpiezas` y sus columnas `_L`):

| Columna | Tipo | Descripción |
|-------|---------|-------------|
| `cama_label` | text | Label legible de la cama (join visual con el mapa) |
| `cama_codigo` / `habitacion` | text | Código de cama / habitación Gamma |
| `area` | text | Sector / piso (para filtrar por área de azafata) |
| `status` | text (`Activo`/`Inactivo`) | Activo = overlay vigente; Inactivo = cerrada (soft-delete) |
| `motivo_cierre` | text (`ANULADA`/`TICKET`/`GAMMA`/`CONSOLIDADO`) | Por qué se cerró |
| `azafata_id` / `azafata_nombre` | text | Quién marcó (denormalizado para auditoría) |
| `fecha_limpieza` / `fecha_cierre` | timestamptz | Cuándo se marcó limpia / cuándo se cerró |
| `entorno` | text | `PRODUCTIVO` / `TESTING` |
| `version` | text | `APP_VERSION` del cliente que escribió (§1.3) |

> Índice-candado `limpiezas_activa_uidx`: una sola limpieza `Activo` por `cama_label`+`entorno` (23505 en carrera → el POST re-busca y refresca la existente). Ya no aplica lo de "indexar columnas en la UI de SP" ni el script `create-limpiezas-list.mts`: la tabla y sus índices los define la migración SQL.

**Columnas nuevas (2026-04-22):**
- `07.Traslados.IntervinoAzafata_T` (Text): `"NO"` al crear el ticket, pasa a `"SI"` en la primera acción de azafata (`handleRoomReady`, `handleStartTransport`, `handleConfirmReception`). Gatekeepa la cancelación y edición: solo se permite mientras esté en `"NO"`.
- `08.Aislamientos.Tipo_A` (Text): almacena uno o varios tipos de aislamiento activos por paciente, separados por `;` (ej: `"Covid;Contacto"`). Backward-compatible: los registros con un solo tipo se leen como array de un elemento.

**Formato del campo `IP_GI` en `99.ABM_GeoIPS` (2026-05-14):**

El field acepta dos formatos para definir IPs permitidas. Backwards-compatible — las filas existentes en formato A siguen funcionando.

| Formato | Ejemplo | Qué matchea |
|---|---|---|
| **A — Prefix dotted** (legacy, recomendado por default) | `190.172.65.` | Cualquier IP que arranque con `190.172.65.` exacto (todo el `/24`, 256 IPs). El guard de `.` final evita que `192.168.1` matchee falsamente `192.168.10.5`. |
| **B — CIDR** (nuevo, casos puntuales) | `190.172.65.0/24` | Mismo efecto que el formato A. Útil cuando el admin de red ya tiene el CIDR del ISP a mano. |

**Importante — preferir granularidad chica**:
- Por default, **agregar una fila `/24` por cada red origen** (formato A o `/24` CIDR). Es lo más restrictivo + auditeable.
- Solo usar máscaras mayores a `/24` (ej. `/16` o `/22`) si el ISP confirma que TODO ese rango pertenece a la misma organización autorizada. Una máscara amplia como `/16` cubre 65 536 IPs y puede dejar entrar IPs de otras organizaciones del mismo ISP — **no es lo que querés**.
- Si la misma organización tiene salida por varios `/24` no contiguos (multi-WAN), **agregar una fila por cada `/24`** en lugar de una máscara amplia.

Notas técnicas:
- Solo IPv4. IPv6 no se soporta hoy (Vercel proxea v4).
- CIDR mal escrito (ej. `190.172/16` o mask >32) devuelve `false` silenciosamente — el admin se entera por "no entra el user". Recomendación: usar [cidr.xyz](https://cidr.xyz) o similar para validar antes de cargar.
- **Cache TTL 60s**: cambios en `99.ABM_GeoIPS` tardan hasta ~1 min en propagar al server (ver `RULES_TTL` en [api/location-check.ts](api/location-check.ts)). Sumado al interval de revalidación del frontend (60s), el worst case end-to-end es ~2 min hasta que un user activo es expulsado por un cambio en SP.

---

## 10. Patrones y decisiones de diseño

### Estado centralizado sin librería externa
Todo el estado vive en `useHospitalState()`, un hook que retorna `{ state, actions }`. Se pasan como props desde `App.tsx` a las vistas. Esto simplifica el proyecto al costo de un componente raíz grande, pero evita la complejidad de Redux/Context para una app con un número acotado de vistas.

### Optimistic UI + polling con protección de escritura
Al ejecutar una acción (ej: asignar cama), el estado local se actualiza inmediatamente. Un `writingRef` bloquea los polls durante la escritura a SharePoint para evitar que datos obsoletos reviertan el cambio visual. El ETag en el endpoint de tickets evita transferir datos si no hubo cambios.

### Proxy de APIs externas
Las credenciales de Gamma y Azure nunca llegan al browser. Los serverless functions actúan como proxy, cacheando tokens y transformando los datos a la estructura interna de la app.

### Soft-delete
Usuarios, roles y aislamientos usan soft-delete (campo `Status = 'Inactivo'`) en vez de borrar registros de SharePoint, manteniendo trazabilidad.

### Fail-open en validación de ubicación
Si la validación de IP/geo falla técnicamente, se permite el acceso. En un contexto hospitalario, es preferible un falso positivo a bloquear operaciones críticas.

### PWA para dispositivos compartidos
La app funciona como PWA instalable. Las Azafatas usan tablets compartidas con tokens de larga duración (~10 años) para evitar re-login constante.

### Cache fail-open en `/api/beds` ante fallo parcial de Gamma
El proxy Gamma puede responder 504 (Gateway Timeout) en uno de los dos endpoints consumidos (`obtenermapacamas` u `obtenermapacamasocupadas`). En ese caso el handler NO sobrescribe el caché con datos parciales (que haría aparecer camas ocupadas como disponibles — riesgo operativo de doble asignación), sino que devuelve el último snapshot válido con `X-Beds-Stale: 1` y `{ stale: true }` en el body. Si no hay caché previo, responde 503 para que el frontend conserve su estado actual en lugar de limpiar el mapa.

### Notificaciones de modificación de traslado
Cuando Admisión edita el destino de un ticket, se emiten tres notificaciones distinguidas por área:
- Área destino **viejo**: "Traslado Cancelado" (el paciente ya no va a llegar)
- Área destino **nuevo**: "Nueva Solicitud de Traslado"
- Área de **origen**: "Modificación de Solicitud"

El change-detection del polling (`useEffect` en `useHospitalState`) compara snapshots `${status}|${destination}` para detectar cambios de destino además de status. El editor pre-semilla su propio snapshot antes del `setTickets` para evitar duplicar las notifs en su propia sesión.

### Tag único por evento en Web Push
Cada payload de push incluye `tag: ticketId-type-timestamp`. Esto evita que Chrome Android colapse silenciosamente notifs consecutivas del mismo ticket (cuando el tag se repite, varios builds ignoran `renotify: true` y no muestran heads-up). El SW usa ese tag al llamar `showNotification()`.

---

## 11. Desarrollo local

```bash
# Instalar dependencias
npm install

# Levantar API local (emula Vercel serverless)
npm run dev:api       # → http://localhost:3000

# Levantar frontend (Vite, proxia /api a localhost:3000)
npm run dev           # → http://localhost:5173

# O ambos juntos
npm run dev:full
```

Variables de entorno necesarias (ver [.env.example](../.env.example)):
- `AZURE_TENANT_ID`, `AZURE_CLIENTE_ID`, `AZURE_CLIENT_SECRET` — Microsoft Graph
- `SHAREPOINT_SITE_ID` — Site de SharePoint
- `GAMMA_VM_URL`, `CLIENT_ID`, `CLIENT_SECRET` — API de Grupo Gamma
- `JWT_SECRET` — Secreto para firmar el `mediflow_token` (HS256)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — Web Push (server)
- `VITE_VAPID_PUBLIC_KEY` — Clave pública VAPID expuesta al frontend (debe coincidir con el par de arriba y con los secrets de la Edge Function)
- **Supabase (backend):** `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (`sb_secret_…`, service_role), `SUPABASE_JWT_PRIVATE_KEY` (JWK P-256 para firmar el pase ES256)
- **Supabase (frontend):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (pública por diseño; lo que protege es la RLS)
- `ENTORNO` — `PRODUCTIVO` / `TESTING` (default `TESTING`)
- **Crons / Edge:** `CRON_SECRET` (auth de los crons), `MEDIFLOW_URL` (GitHub Secrets), `TESTING_BASE_URL` (alias del Preview de develop para `cron-trigger-testing`), `WEBHOOK_SECRET` (auth del Database Webhook → Edge Function `notify-push`)

> 🔴 **Nunca** documentar valores de secrets (passwords, tokens, claves privadas). Solo los nombres. La secret key de Supabase y `SUPABASE_JWT_PRIVATE_KEY` no deben llegar jamás al bundle del cliente (se importan solo desde `api/`).

---

## 12. Cambios estructurales recientes (2026-04-27)

### 12.1. Rol CATERING agregado al sistema

Se incorpora un sexto rol al portafolio de roles, exclusivo para el equipo de cocina/dieta:

| Rol | Acceso | Push notifications |
|-----|--------|-------------------|
| **Catering** | Mapa de Camas | Solo eventos `RECEPTION_CONFIRMED` (paciente recibido en destino) |

A diferencia de los demás roles, Catering **no recibe** notificaciones de creación, status updates ni modificaciones — solo le interesa saber cuando un paciente efectivamente llegó a su nueva ubicación, para coordinar la entrega de comida. El backend (`api/push-utils.ts`) compone un mensaje específico para este rol: `"{Paciente} pasó de Habitación {origen} ({piso}) a Habitación {destino} ({piso})"`.

Para soportar esto, el endpoint `PATCH /api/tickets` recibe ahora `originAreaName` y `destinationAreaName` (nombres legibles del área Gamma, no labels de cama) en el contexto de actualización de status. Esto permite componer el mensaje human-readable sin que el SW tenga que resolver labels.

### 12.2. Validación server-side de doble asignación de cama destino

`api/tickets.ts` agregó dos checks de unicidad de destino, gateways anti-race-condition:

- **POST**: antes de crear el ticket, query a SP filtrando `CamaDestino_T eq '{destination}' and Status_T ne 'Consolidado' and Status_T ne 'Cancelado'`. Si hay match → `409 { error, conflictingTicketId }`.
- **PATCH**: solo si los `updates` incluyen `destination`, misma query excluyendo el `id` actual con `id ne {spItemId}`.

El frontend (`hooks/useHospitalState.ts`) maneja el 409 haciendo rollback del optimistic update (remueve el ticket recién agregado en `_createTicket`, o restaura el snapshot del ticket original en `handleEditTicket`) y muestra un alert con el ID del ticket conflictivo.

Complementariamente, `App.tsx` calcula `activeTransferDestinations: Set<string>` de los tickets activos y lo pasa a `NewRequestModal`/`EditRequestModal` para ocultar de los dropdowns las camas ya tomadas por otros traslados activos. El modal de edición preserva el destino actual del propio ticket en la lista (se muestra como opción seleccionable).

### 12.3. Tabs internos en el detalle de cama (BedsView)

El modal de detalle de paciente (`BedsView.tsx`) hoy tiene **cuatro tabs** (esta sección decía "tres"; se agregó Ayunos, ver §29.4/§34):
- **Generales**: DNI, edad, sexo, financiador, profesional, diagnóstico (datos del enrich).
- **Internación**: tipo de internación (códigos C/CO/H/K/O/Q/R/T), fecha/hora de ingreso, días de estadía vs autorizados, fecha probable de cirugía.
- **Dieta**: condiciones + tipo de dieta + sección Menú donde Nutrición carga comandas por turno (§ dominio Comandas).
- **Ayunos**: ocurrencias vigentes por indicación en hora Argentina.

La botonera de tabs es scrolleable en mobile (§37). Aislamientos se muestran en solo lectura (fuente PROGAL, §46).

### 12.4. Auto-update de PWA sin intervención del usuario

`vite-plugin-pwa` se configuró con auto-actualización: el SW detecta una nueva versión, la activa y refresca la página automáticamente sin mostrar prompt al usuario. Decisión motivada por el perfil del usuario hospitalario (sin conocimiento técnico).

---

## 13. Workflow types — fusión de `ROOM_CHANGE` con `INTERNAL`

`WorkflowType.ROOM_CHANGE` quedó marcado como `@deprecated` pero **no se removió del enum**: tickets viejos en `07.Traslados` con `TipoTraslado_T = 'ROOM_CHANGE'` deben seguir leyéndose. La UI los renderiza como "Traslado Interno" (mismo label que `INTERNAL`) y al editarlos se auto-mapean a `INTERNAL`.

Reglas de filtrado de origen/destino por workflow en los modales:
- `INTERNAL`: origen y destino no pueden ser ITR (`bed.area !== Area.HIT`).
- `ITR_TO_FLOOR`: origen debe ser ITR (`bed.area === Area.HIT`), destino no.

`INTERNAL` siempre requiere un motivo del dropdown `ROOM_CHANGE_REASONS` (validado en frontend y backend). Valores vigentes ([lib/constants.ts](lib/constants.ts)): `Solicitud familiar`, `Asilamiento / Infectologia`, `Mantenimiento edificio`, `Cambio de area`, `Requerimiento Interno`, `Solicita Upgrade`. El desglose de motivos del Monitor los cuenta dinámicamente (capta también motivos legacy de tickets viejos, ej. `Pase a piso`, ya retirado del dropdown).

---

## 14. Operativa: Admin puede ejecutar acciones de Azafata

El tab switcher de `RequestsView.tsx` (`Admin / Admisión / Azafata`) hoy permite que un Admin elija el tab "Azafata" y vea/ejecute las acciones operativas (Habitación Lista, Iniciar Traslado, Recepción OK) **sin filtro de áreas**. Implementado como bypass en dos puntos:
- Filtro `sortedTickets`: si `currentUser.role === Role.ADMIN`, se saltea el filtro de `assignedAreas`.
- `renderActionButtons` (HOSTESS branch): un admin se trata como `hasAllAreas = true`.

Los handlers de azafata (`handleRoomReady`, `handleStartTransport`, `handleConfirmReception`) no validan rol — la restricción siempre fue de UI. Cuando un admin ejecuta estas acciones, el flag `intervenedByHostess` también pasa a `'SI'`, bloqueando edición/cancelación posterior (mismo contrato que con una azafata real).

---

## 15. Sector HRA (sala de espera de Recepción Admisión)

Sumado al portafolio de áreas como **`Area.HRA = 'Recepción Admision y Altas de Internacion HPR'`** ([types.ts:46](types.ts#L46)). Es un sector "ficticio" — sus "camas" son sillones donde Admisión registra pacientes que están a la espera de habitación de internación.

### Pipeline operativo
1. **PROGAL**: Admisión registra al paciente en un sillón HRA. El sistema externo persiste la ocupación.
2. **Gamma → MediFlow**: el sillón aparece como `OCCUPIED` en el response de `obtenermapacamasocupadas`.
3. **MediFlow**: el sillón es seleccionable como **origen** del workflow `Ingreso ITR` (y solo de ese workflow).
4. **Azafata destino**: hace todo el flujo (ver §16).
5. **PROGAL**: al consolidar, el sillón se libera.

### Reglas de visibilidad y filtros
- `AREA_LABELS[Area.HRA] = 'Sala Espera'` (label corto en el mapa).
- `AREA_ORDER`: HRA va **primero**, antes de HIT, porque conceptualmente es pre-internación.
- `CRITICAL_AREAS_NO_BLOCK` incluye HRA: si un paciente tiene aislamiento en un sillón, los demás sillones siguen libres (cada uno es físicamente independiente).
- HRA es **origen exclusivo** del workflow `Ingreso ITR` — nunca es destino de ningún ticket.
- HRA es **seleccionable** como área asignable en `AreaSelectionModal` y `UserManagementView` (Catering puede tener HRA en su lista de áreas).

### Helper de detección
- [lib/utils.ts](lib/utils.ts) expone `isHraArea(area)` y `isHitArea(area)`. Ambos hacen matching tolerante (case-insensitive, sin diacríticos) por substring clave (`recepcion`+`admision` y `transitoria` respectivamente). Usar estos helpers en lugar de `b.area === Area.HRA` para evitar mismatches por strings ligeramente distintos que pueda enviar Gamma.

---

## 16. Flujo simplificado de azafata para `Ingreso ITR`

Cuando el origen es HRA (sillón de sala de espera), no hay azafata estable de origen. Para que el ticket avance, la azafata **destino** ejecuta los 3 pasos en secuencia.

[views/RequestsView.tsx:131-189](views/RequestsView.tsx#L131): variable `isIngresoFlow = ticket.workflow === ITR_TO_FLOOR` controla el routing de botones:

| Status | Internal (Traslado Interno) | Ingreso ITR |
|--------|------------------------------|-------------|
| `WAITING_ROOM` | Azafata destino marca "Habitación Lista" | Azafata destino marca "Habitación Lista" |
| `IN_TRANSIT` | Azafata **origen** marca "Iniciar Traslado" | Azafata **destino** marca "Iniciar Traslado" |
| `IN_TRANSPORT` | Azafata destino marca "Recepción OK" | Azafata destino marca "Recepción OK" |

En Ingreso ITR la azafata origen no recibe badges de espera ("Esperando preparación destino", "Traslado en curso...") porque no hay azafata HRA real. El admin actuando como azafata sigue funcionando igual (`hasAllAreas = true` cubre ambos roles).

---

## 17. Plan médico del paciente

Gamma incorporó dos fuentes para el plan médico:

1. **`obtenermapacamasocupadas`** (en cada poll, sin enrich): los campos `plan_codigo` y `plan` vienen dentro de cada `cama[]`.
2. **`obtenereventointernacion`** (al click, vía enrich): `IPM_PLAN_MEDICO` (código) e `IPM_DESCRIPCION` (descripción legible).

El backend mapea ambas fuentes a 3 campos del modelo `Bed`:
- `medicalPlanCode` — código corto (ej. `'A1'`).
- `medicalPlan` — texto del plan (ej. `'AMBULATORIO'`).
- `medicalPlanDescription` — descripción larga (solo del enrich).

El render en el modal de detalle ([BedsView.tsx:1328-1338](views/BedsView.tsx#L1328)) muestra el plan como **subtítulo dentro de la card Financiador** (no como card separada): financiador en negrita arriba + `Plan: A1 · AMBULATORIO` en gris claro abajo. El plan rápido viene del poll; la descripción se completa al expandir el modal cuando termina el enrich.

---

## 18. Observaciones de cama inhabilitada

Gamma sumó el campo `observaciones` al array `camas[]` de `obtenermapacamas`. Sirve para que el equipo sepa **por qué** una cama está fuera de servicio (mantenimiento, equipamiento, etc.).

Mapeado a `Bed.disabledReason` en [api/beds.ts:80](api/beds.ts#L80). Render dual:
- **Tooltip nativo** en el grid: `<button title="Inhabilitada — {motivo}">` ([BedsView.tsx:1085-1089](views/BedsView.tsx#L1085)).
- **Panel ámbar destacado** en el modal cuando se hace click ([BedsView.tsx:1471-1480](views/BedsView.tsx#L1471)) — solo aparece si hay `disabledReason`, no se muestra placeholder vacío.

---

## 19. Rate limiting del login (anti brute-force)

[api/auth.ts](api/auth.ts) ahora consulta [api/rate-limit.ts](api/rate-limit.ts) antes de validar credenciales. Reglas: **5 intentos fallidos en 5 min → 15 min de bloqueo**. Login exitoso resetea el contador.

### Capa de almacenamiento dual (Upstash + memoria)

- **Si `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` están en envs** → contador en Upstash Redis (compartido entre instancias Vercel, sobrevive cold-starts).
- **Si no están** → fallback automático a `Map<key, ...>` in-memory por instancia.

### Circuit breaker (3 fallos / 5 min de cooldown)

Si Upstash falla 3 veces consecutivas (timeout, cuota agotada, error de red), el módulo lo deshabilita por **5 minutos** y enruta todo al fallback in-memory. Reintenta al expirar el cooldown. Estado en memoria del módulo: `breakerFailures` + `breakerOpenUntil`.

### Doble escritura best-effort

`recordFailure()` y `resetRateLimit()` siempre escriben primero en memoria, después intentan Upstash. Esto preserva continuidad del contador si el breaker se abre justo entre dos intentos del mismo atacante.

### Key del rate limit

`username:ip` combinado. Un atacante no puede agotar la cuota de un usuario legítimo desde otra IP, ni dos IPs distintas comparten cuota.

### Frontend

[hooks/useHospitalState.ts:553-562](hooks/useHospitalState.ts#L553) detecta `res.status === 429`, lee `retryAfterSeconds` y muestra: `"Cuenta bloqueada por seguridad tras varios intentos fallidos. Probá de nuevo en X minutos."`

---

## 20. Separación de entornos (`TESTING` / `PRODUCTIVO`)

Producción y testing conviven en el **mismo proyecto Supabase** y en las **mismas listas SharePoint** sin pisarse, discriminados por una columna `entorno`/`Entorno_*` y la env `ENTORNO` (default seguro `TESTING`).

**En Supabase (dominio transaccional):** cada tabla tiene columna `entorno`. La **lectura del cliente** la filtra la **RLS** (`entorno = auth.jwt() ->> 'entorno'`) usando el "pase" ES256 cuyo claim `entorno` mintea `api/supabase-token.ts` con `process.env.ENTORNO`. Las **escrituras** (service_role) estampan `ENTORNO` en cada fila. Un entorno **no puede** ver filas del otro aunque compartan proyecto. `traslados UNIQUE(id_univoco, entorno)` permite que el mismo `id_univoco` coexista en TESTING y PRODUCTIVO.

> ⚠️ **Fuga cross-entorno (PHI):** si `ENTORNO` se omite/pisa a `TESTING` en Production, el pase firma `entorno='TESTING'` y el navegador de prod vería/escribiría filas de TESTING. Verificación: golpear `/api/supabase-token` en prod y confirmar que el claim `entorno` sea `PRODUCTIVO`.

**En SharePoint (lo que queda):**

| Lista | Campo | Endpoint que filtra |
|-------|-------|---------------------|
| `12.EnrichCamas` | `Entorno_EC` | [api/beds.ts](../api/beds.ts) (lectura), [api/cron-enrich-beds.ts](../api/cron-enrich-beds.ts) (upsert) |
| `11.DietaSnapshot` | `Entorno_DS` | [api/cron-diet-changes.ts](../api/cron-diet-changes.ts) (desprogramado) |
| `08.Aislamientos` | `Entorno_A` | [api/isolations.ts](../api/isolations.ts) — deprecado |
| `10.Notificaciones` (viejo) | `Entorno_N` | [api/cron-cleanup-notifs.ts](../api/cron-cleanup-notifs.ts) (poda) |

Las listas `07/08/09/13/14` y roles/comandas **ya no** figuran acá porque migraron a Supabase (su segregación por entorno la hace la columna `entorno` + RLS, arriba).

**Contrato**:
- Cada archivo declara `const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim()` — default seguro `TESTING`.
- Lecturas SP filtran `$filter=fields/Entorno_X eq '{ENTORNO}'`; lecturas Supabase por RLS.
- Escrituras estampan el entorno; los PATCH/DELETE no lo tocan (preservan el original).

**Setup operativo**: `Vercel Production` → `ENTORNO=PRODUCTIVO`; `Vercel Preview` / dev local → `ENTORNO=TESTING`.

---

## 21. Cron de cambio de dieta (Catering)

Detecta automáticamente cambios de dieta en PROGAL y notifica a Catering del piso correspondiente vía push, sin depender de que un usuario abra la card del paciente.

### Arquitectura

```
GitHub Actions (cron */30 * * * *)
    ↓ HTTP POST + X-Cron-Secret
Vercel: /api/cron-diet-changes
    ↓ bulk read snapshot                ↓ trae camas ocupadas
SharePoint                              Gamma API
11.DietaSnapshot                        obtenermapacamasocupadas
                                        obtenereventointernacion
    ↓ workers paralelos (5)
    ↓ por cada paciente: hash de dietas vs snapshot
    ↓ si difiere
push-utils.sendPushToSubscribers (type: 'DIET_CHANGE')
    ↓ filtrado server-side por rol CATERING + área + entorno
Web Push API → device del Catering del piso
```

### Por qué GitHub Actions (no Vercel Cron)

Vercel Cron en plan Hobby permite 1 job/día (insuficiente para 30 min). Pro lo permite pero es pago. **GitHub Actions cron es gratis** en repos privados (2.000 min/mes; el job tarda ~10-30s × 48 veces/día = ~24 min/día).

Tradeoff: GitHub Actions cron es best-effort — puede tener delays de hasta 15 min reales.

### Componentes

- **[api/cron-diet-changes.ts](api/cron-diet-changes.ts)** — endpoint POST con auth por shared secret (`X-Cron-Secret` header contra `process.env.CRON_SECRET`). NO usa `requireAuth` (es un bot, no usuario). Concurrencia 5 paralelos. Bootstrap silencioso: pacientes sin snapshot previo se crean sin disparar push (evita spam masivo en el primer ciclo). Cleanup: snapshots con `LastChecked_DS > 7 días` → marcados `Inactivo`.

- **[api/push-utils.ts](api/push-utils.ts:121-126)** — `isRelevant` para Catering acepta `'RECEPTION_CONFIRMED' || 'DIET_CHANGE'`. Filtra también por área asignada y entorno.

- **[.github/workflows/check-diet-changes.yml](.github/workflows/check-diet-changes.yml)** — workflow YAML con `schedule: '*/30 * * * *'` + `workflow_dispatch` (manual desde la UI de Actions). El job hace un único `curl` al endpoint, falla si HTTP != 200.

### Lista 11.DietaSnapshot — columnas

| Campo | Tipo | Para qué |
|-------|------|----------|
| `Title` | Texto | `'[sumar]'` |
| `PatientCode_DS` | Texto | Código Gamma (clave lógica) |
| `DietHash_DS` | Texto | Hash DJB2 ordenado de tags activos |
| `DietTags_DS` | Texto | Tags activos para mostrar en notif |
| `EventOrigin_DS` / `EventNumber_DS` | Texto / Número | Identificador del evento de internación |
| `PatientName_DS` / `AreaName_DS` | Texto | Para mensaje y filtrado de área |
| `LastChecked_DS` | Fecha/hora | Última vez visto en un ciclo (cleanup TTL) |
| `Status_DS` | Texto | `'Activo'` / `'Inactivo'` |
| `Entorno_DS` | Texto | `'PRODUCTIVO'` / `'TESTING'` |

LIST_ID hardcoded en el archivo (convención del proyecto, igual que las otras 4 listas).

### Variables de entorno necesarias

- `CRON_SECRET` (random ≥32 chars) → `.env.local`, Vercel envs (Production + Preview), GitHub repo Secrets.
- `MEDIFLOW_URL` → solo GitHub repo Secrets, apunta al dominio de producción (ej: `https://mediflow.grupogamma.com`).

---

## 22. Cache split en bed-enrich

[api/bed-enrich.ts](api/bed-enrich.ts) tiene dos caches in-memory con TTLs diferenciados:

| Cache | TTL | Datos |
|-------|-----|-------|
| `patientCache` | 10 min | DNI, edad, sexo, financiador (no cambian en una internación) |
| `eventCache` | 30 s | Diagnóstico, plan médico, fechas, días autorizados, **dieta** |

El evento se cachea muy corto porque la dieta cambia en vivo desde PROGAL. Antes había un solo cache de 10 min para todo → cambios de dieta quedaban invisibles hasta 10 minutos.

### Bypass al click (?fresh=1)

El modal de detalle del paciente pasa siempre `?fresh=1` al endpoint ([hooks/useHospitalState.ts](hooks/useHospitalState.ts) `enrichBed`). El backend ignora el cache del evento en ese caso (pero mantiene el de paciente). Cada vez que se abre el modal → dato fresco garantizado, sin penalizar la latencia del primer fetch.

Los PDFs (`enrichBedsForPdf` en BedsView) **NO pasan `fresh=1`** → benefician del cache de 30s al procesar muchas camas en serie.

---

## 23. SW push log (IndexedDB) y badge dedicado

### Logging diagnóstico

[src-sw/sw.ts](src-sw/sw.ts) registra cada push recibido en una IndexedDB local (`mediflow-push-log`, TTL 24h, cap 50 entradas). Si el cliente reporta que no le llegan notifs, este log distingue entre:
- **Push no llegó al SW** (log vacío) → problema de red/sub/server.
- **Push sí llegó pero el banner heads-up no apareció** (log con entrada del evento esperado) → config Android (channel importance / battery optimization).

Cómo el cliente lo lee (snippet documentado al final del SW): abrir DevTools console del navegador y correr un script que lee la IndexedDB y muestra los entries formateados.

### Badge dedicado

[public/badge.svg](public/badge.svg) — SVG monocromático sin fondo, usado en `badge` del payload Web Push. Android lo trata como alpha mask en la status bar. Antes se usaba `logo.svg` con fondo color, lo que algunos builds de Chrome Android degradaban en prioridad visual.

---

## 24. Endpoint y script de debug para subscriptions

Herramientas de auditoría para diagnosticar problemas de push:

- **[api/debug-subs.ts](api/debug-subs.ts)** — `GET /api/debug-subs` (requiere JWT). Devuelve resumen por rol (cuántas subs, cuántas con áreas, cuántas sin) + listado completo (con endpoints truncados por privacidad).

- **[scripts/list-catering-subs.mts](scripts/list-catering-subs.mts)** — script standalone con `tsx`. Lista TODAS las subs (sin filtrar por entorno, intencional). Con flag `--clean` borra subs huérfanas del rol Catering (areas vacías) **acotado al entorno actual** — no toca subs de otro entorno.

Ambos exponen el campo `entorno` para distinguir testing de prod al auditar.

---

## 25. Filtrado de notificaciones in-app por rol (independiente del push server)

El frontend tiene un **detector de cambios** en el polling que, además del toast in-app, dispara una **Web Notification del SO** (`new window.Notification(...)`) cuando el tab está en background. Esto es independiente del push del server.

[hooks/useHospitalState.ts:328-346](hooks/useHospitalState.ts#L328) — función `isRelevant` del detector. Reglas por rol:

| Rol | Toasts in-app + Web Notification |
|-----|-----------------------------------|
| ADMIN / ADMISSION | Todo (sin filtro) |
| HOSTESS | Solo si `originArea` o `destArea` ∈ `assignedAreas` |
| **CATERING** | **Nada** — solo recibe via push server-side (`RECEPTION_CONFIRMED` + `DIET_CHANGE`) |
| Otros (READ_ONLY, NURSING) | Nada |

Razón del bloqueo total para Catering: el server-side push ya filtra los 2 únicos eventos relevantes para Catering por área. Mantener el detector local activo generaba duplicados / falsos positivos (ej: "Nueva Solicitud de Traslado" del polling cuando se crea un ticket en otro piso, evento que el server explícitamente había bloqueado).

[hooks/useHospitalState.ts:707-722](hooks/useHospitalState.ts#L707) — `filteredNotifications` (dropdown) sigue la misma lógica por consistencia.

---

## 26. Permisos configurables por rol desde SharePoint (2026-05-13)

Hasta esta iteración, los permisos de acción (Crear Ticket, Editar, Cancelar, Confirmar Limpieza, etc.) estaban hardcodeados en ~15 puntos del frontend con checks tipo `role === Role.ADMIN || Role.ADMISSION`. Cambiar permisos requería deploy. Ahora se configuran desde `99.ABMRoles_Traslados` y se reflejan al re-loguear.

### 26.1. Esquema en SharePoint (`99.ABMRoles_Traslados`)

Tres columnas relevantes (las dos últimas son nuevas):

| Campo SP | Tipo | Descripción |
|---|---|---|
| `NombreRol_RT` | Text | "Admin", "Admision", "Azafata", "Catering", "Enfermeria", "Direccion" |
| `Acceso_RT` | Text | Módulos visibles, separados por `/` (ej: `Home/Operativa/Historial/Mapa de Camas`) |
| `Permisos_RT` | Text | Permisos de acción, separados por `;` (ver catálogo abajo) |
| `FiltrarPisos_RT` | Text/Choice | `Sí` / `No` — si filtra view por pisos asignados |
| `Status_RT` | Text | `Activo` / `Inactivo` |

### 26.2. Catálogo cerrado de 12 permisos

Definido como `as const` en [types.ts](types.ts):

| Módulo | Código | Acción |
|---|---|---|
| Operativa | `crear_ticket` | Botón "Nueva Solicitud" |
| | `editar_ticket` | Editar ticket activo |
| | `cancelar_ticket` | Cancelar ticket |
| | `asignar_cama` | Asignar/cambiar cama destino |
| | `confirmar_limpieza` | "Habitación Lista" |
| | `iniciar_traslado` | "Iniciar Traslado" |
| | `confirmar_recepcion` | "Recepción OK" |
| | `consolidar` | "Consolidar PROGAL" |
| Mapa de Camas | `editar_aislamiento` | Toggle aislamientos en modal cama |
| Configuración | `abm_usuarios` | Vista Usuarios |
| | `abm_roles` | Vista Roles |
| Notif. | `recibe_push` | Recibe push + notif in-app + campana |

### 26.3. Flujo de datos

```
SP 99.ABMRoles_Traslados              api/auth.ts (login)          Frontend
─────────────────────                 ──────────────────          ──────────
Acceso_RT: Home/Operativa/...         getRoleByName(Perfil_U)  →  user.modules: string[]
Permisos_RT: crear_ticket;...    ─►   role-cache (TTL 5min)    ─► user.permissions: Permission[]
FiltrarPisos_RT: Sí                   enriquece user           →  user.filterByFloors: boolean
NombreRol_RT: Azafata                                          →  user.roleName: string
```

Helper de check en [lib/permissions.ts](lib/permissions.ts):
- `can(user, 'crear_ticket')` — devuelve `boolean`.
- `hasModule(user, 'Operativa')` — verifica acceso a vista.

Sin permissions (token viejo pre-refactor): `App.tsx` fuerza logout silencioso en el boot para que el user re-loguee y reciba la config nueva.

### 26.4. Cache server-side de roles

[api/role-cache.ts](api/role-cache.ts) cachea la lista de roles activos con TTL 5 min. Se invalida tras mutaciones POST/PATCH/DELETE en `api/roles.ts`. Sin el cache, cada login y cada filtrado de push haría un fetch a SP — insostenible con polling.

### 26.5. ABM de Roles (UI)

[views/RoleManagementView.tsx](views/RoleManagementView.tsx) modal extendido con:
- Sección "Permisos de Acciones" agrupada por módulo, colapsable por grupo (Operativa, Mapa de Camas, Configuración, Notificaciones).
- Toggle radio "Filtrado por pisos asignados: Sí / No".
- Cada grupo de permisos solo aparece si el módulo correspondiente está habilitado en "Módulos de Acceso" (excepto el grupo "Notificaciones" que es cross-module).
- Tabla desktop incluye columnas "Permisos" (count) y "Filtra pisos".

### 26.6. ABM de Usuarios (UI condicional por rol)

[views/UserManagementView.tsx](views/UserManagementView.tsx) carga los roles desde `/api/roles` con el flag `filterByFloors`. El selector de pisos en el modal de alta/edición se muestra **solo si el rol elegido tiene `FiltrarPisos_RT=Sí`** (antes era hardcoded `role === 'Azafata' || 'Catering'`). Al cambiar el rol, si el nuevo no filtra → la selección de pisos se limpia.

### 26.7. Filtro de tickets/camas por pisos (genérico)

El filtro por pisos asignados, antes en hardcode `Role.HOSTESS` / `[HOSTESS, CATERING]`, ahora se gobierna por `user.filterByFloors`:
- [hooks/useHospitalState.ts](hooks/useHospitalState.ts) `filteredTickets`, `filteredNotifications`, AreaSelectionModal trigger.
- [views/RequestsView.tsx](views/RequestsView.tsx) filtro de tickets + render de botones de azafata.
- [views/BedsView.tsx](views/BedsView.tsx) preselección inicial de `areaFilters`.

Bypass implícito: cuando un Admin "actúa como" azafata (tab switcher), su `filterByFloors=false` → ve todo sin filtro de áreas.

### 26.8. Push server-side respeta `recibe_push` + `filterByFloors`

[api/push-utils.ts](api/push-utils.ts) `isRelevant` ahora:
1. Lookup del rol via `getRoleByName(sub.role)` (cache).
2. Si el rol NO tiene `recibe_push` → no recibe nada.
3. Si tiene `filterByFloors=true` → aplica `subAreaMatches` por áreas asignadas.
4. Si tiene `filterByFloors=false` → recibe todo del sede.
5. **Excepción Catering** (caso especial mantenido): si `roleConfig.name === 'Catering'`, restringe a `RECEPTION_CONFIRMED` y `DIET_CHANGE` (no es permiso fino — comportamiento específico de ese rol).

---

## 27. Marcar notificaciones como leídas al interactuar (2026-05-13)

Mejora del flujo de "leído". Antes el click en una notif del dropdown solo flipeaba el estado local (`isRead: true`) sin tocar la fila SP — el banner de "20 min sin confirmar" la volvía a mostrar. Tap en push del SO no marcaba nada.

### 27.1. Endpoint `PATCH /api/notifications` extendido con `mark-by-event`

Tres formas de body aceptadas en [api/notifications.ts](api/notifications.ts):
- `{ notificationId: string }` — single (legacy)
- `{ notificationIds: string[] }` — bulk (legacy)
- **`{ ticketId: string, type: string }`** — NUEVO: busca en `10.Notificaciones` la(s) fila(s) que machean `TicketId_N + Type_N + UserId_N (logueado) + Status_N='Enviada' + Entorno_N`, las marca todas como `Leida`. Útil cuando el cliente solo conoce `ticketId+type` (notifs locales del polling, o tap de push desde SW).

Respuesta unificada: `{ ok, updated, failed }`. 500 si TODAS fallaron, 200 si parcial.

### 27.2. Click en notif del dropdown in-app

[hooks/useHospitalState.ts](hooks/useHospitalState.ts) `handleMarkNotificationRead(notif)` ahora acepta el objeto Notification completo (antes solo `id`):
- Si `id` no tiene prefijo `NOTIF-` (es SP item id) → PATCH por id (camino legacy).
- Si es local (`NOTIF-POLL-*`) y tiene `ticketId+type` → PATCH mark-by-event → marca la fila SP que corresponde al user logueado.

Callers en [App.tsx](App.tsx): dropdown + modal de pendientes pasan la notif completa (`n` no `n.id`).

### 27.3. Tap en push del SO (Android/iOS)

El service worker no tiene acceso al JWT, así que delega al cliente. [src-sw/sw.ts](src-sw/sw.ts) `notificationclick`:
- App ya abierta → `existing.focus()` + `existing.postMessage({ kind: 'notification-clicked', ticketId, type })`.
- App cerrada → `clients.openWindow('/?notifTicketId=X&notifType=Y')`.

[hooks/useHospitalState.ts](hooks/useHospitalState.ts) escucha ambos paths:
- `navigator.serviceWorker.addEventListener('message', ...)` captura el postMessage.
- `useEffect` al mount con `currentUser` lee `window.location.search` y llama `markNotificationByEvent(ticketId, type)`. Después limpia los query params con `history.replaceState` para que no se re-dispare en refresh.

### 27.4. Caso DIET_CHANGE (sin ticketId)

[api/cron-diet-changes.ts](api/cron-diet-changes.ts) no incluye `ticketId` en su push (es un evento de cama, no de ticket). El endpoint mark-by-event responde `{ ok: true, updated: 0 }` y la notif queda en el banner hasta que el user la marque manualmente con "Marcar todas como leídas" del modal de pendientes. Aceptable porque DIET_CHANGE no genera notif local (solo push).

---

## 28. Permisos granulares de notificación (2026-05-27)

El permiso único `recibe_push` fue reemplazado por 4 permisos granulares configurables por rol desde el ABM:

| Permiso | Tipo de notificación |
|---|---|
| `notif_new_ticket` | Traslado pedido (nuevo) |
| `notif_status_update` | Actualizaciones de estado |
| `notif_reception_confirmed` | Recepción confirmada |
| `notif_diet_change` | Cambio de dieta |

### 28.1. Mapeo type → permission

[lib/permissions.ts](lib/permissions.ts) exporta `NOTIF_TYPE_TO_PERMISSION` y el helper `canReceiveNotif(user, type)`. Tanto el push server-side (`api/push-utils.ts`) como el detector de polling del cliente (`hooks/useHospitalState.ts`) usan este helper para decidir qué notifs mostrar/enviar.

### 28.2. Logging de diagnóstico en push-utils

[api/push-utils.ts](api/push-utils.ts) `isRelevant` loguea la razón exacta de cada descarte por subscriber: excluded (trigger user), sede mismatch, role config not found, type not mapped, missing permission, areas mismatch. Visible en Vercel logs filtrando por `[push-utils]`.

---

## 29. Enrich upfront en `/api/beds` y ayunos (2026-05-27)

### 29.1. Cambio arquitectural: de "fast/enrich" a enrich completo

Antes: `/api/beds` solo devolvía datos básicos (status, patientName, patientCode). El enrich (DNI, dieta, diagnóstico, etc.) se hacía on-click con `/api/bed-enrich`. Ahora: `/api/beds` enriquece TODAS las camas ocupadas con data del evento Gamma en cada poll. El modal abre sin loading para campos del evento.

Flujo actual:
```
/api/beds (cada 60s, cache 45s):
  ├── obtenermapacamas + obtenermapacamasocupadas  → beds base
  └── 5 workers × getEventCached(origin, number)   → diet, ayunos, diagnóstico, fechas, plan
        ↓
  Cada bed ocupado: { ...base, diagnosis, dietTags, fasting, admissionDate, ... }

Click en cama → /api/bed-enrich (sin fresh=1):
  └── Solo consultarpacientecodigo → DNI, edad, sexo (cache 10 min)
  └── Evento: del shared cache (60s), NO re-fetch
```

### 29.2. Cache compartido de eventos

[api/gamma-client.ts](api/gamma-client.ts) exporta `getEventCached(token, origin, number)` con cache módulo-nivel (60s TTL). Lo usan:
- `/api/beds` — enrich masivo (5 workers)
- `/api/bed-enrich` — on-click (sin `fresh=1` → cache hit)

`setEventCache()` permite que bed-enrich con `fresh=1` (uso futuro/manual) actualice el cache compartido tras fetch directo.

### 29.3. Helpers extraídos

| Archivo | Función | Usado por |
|---|---|---|
| [api/diet-tags.ts](api/diet-tags.ts) | `parseDiets(DIETAS)` → `{ diets, dietTags }` | beds.ts, bed-enrich.ts |
| [api/ayunos.ts](api/ayunos.ts) | `summarizeFasting(AYUNOS)` → `FastingSummary` | beds.ts, bed-enrich.ts |

### 29.4. Ayunos en el mapa de camas

Gamma expone `AYUNOS[]` en `obtenereventointernacion`. Desde la migración de Progal (jun-2026), la API devuelve los ayunos **no ejecutados (vigentes) ya resueltos**: cada entrada es UNA ocurrencia concreta. El front NO calcula nada (repeticiones, suspensiones individuales, etc. ya las resolvió la API), solo agrupa y muestra:
- `PEA_ID_PLANIFICACION` — identifica la indicación (agrupa sus ocurrencias). Fallback: `PEA_ID_INDICACION`.
- `PAT_FECHA_HORA` — fecha y hora exacta de la ocurrencia (ISO naive = hora Argentina).
- `PEA_FECHA_HORA_INICIO` — cuándo se cargó la indicación; informativo, **no se usa**.

El helper `summarizeFasting()` agrupa las ocurrencias por indicación y devuelve `{ hasUpcoming, nextAt, indications[].occurrences[] }`.

**UI:**
- **Tarjeta de cama**: ícono `UtensilsCrossed` (lucide-react) en círculo ámbar abajo-derecha cuando hay ayunos vigentes (`hasLiveFasting`).
- **Modal de detalle**: pestaña "Ayunos" con tarjetas por indicación listando cada ocurrencia formateada `DD/MM HH:MM` (`formatFastingDateTime`).
- **PDF de dietas/ayunos**: `fastingTimesForToday()` muestra los horarios `HH:MM` de la jornada ART actual.

### 29.5. Cron de dieta cada 5 minutos

[vercel.json](vercel.json) — el cron `cron-diet-changes` pasó de `*/30` a `*/5` para detectar cambios de dieta más rápido.

---

## 30. Fixes de notificaciones (2026-05-27)

### 30.1. Re-login sin notifs falsas

[hooks/useHospitalState.ts](hooks/useHospitalState.ts) `handleLogout` ahora resetea refs del detector de polling (`initialLoadDoneRef`, `appStartTimeRef`, `prevTicketSnapshotRef`, `soundCooldownRef`, `ticketsEtagRef`) y limpia states in-memory (`tickets`, `notifications`, `toasts`, `unreadSpNotifications`, `rawBeds`). Sin esto, al re-loguear en la misma pestaña, el detector comparaba contra el snapshot del user anterior y disparaba notifs falsas para todos los tickets activos.

### 30.2. Timestamp real del evento

`timestampOfTicketEvent(t)` en [hooks/useHospitalState.ts](hooks/useHospitalState.ts) mapea `status → timestamp del ticket` (cleaningDoneAt, transportStartedAt, receptionConfirmedAt, completedAt, createdAt) en lugar de `new Date()` (hora del cliente). Las notifs del polling ahora muestran la hora del evento real.

### 30.3. Restauración de permisos al reactivar módulo en ABM

[views/RoleManagementView.tsx](views/RoleManagementView.tsx) — `toggleModule` destruía los permisos de un módulo al desactivarlo, y NO los restauraba al reactivarlo. Ahora guarda un snapshot de `originalPermissions` al abrir el modal y los restaura si el módulo se reactiva.

---

## 31. Enrich del mapa de camas precomputado en SharePoint

Refactor mayor del flujo de `/api/beds` para evitar timeouts (>60s) cuando muchas camas requerían enrich on-request.

### 31.1. Lista nueva `12.EnrichCamas`

LIST_ID `443c4ff0-bc98-43ef-a49c-7fd91cc63734`. Una fila por evento ocupado:
- `EventKey_EC` = `${eventOrigin}-${eventNumber}` (clave de match).
- `PatientCode_EC`.
- `Payload_EC` (multiline text) = `JSON.stringify(EnrichResult)` — dni, age, sex, diagnosis, admission*, fechas, plan, diets, dietTags, **fasting**.
- `UpdatedAt_EC`, `Status_EC`, `Entorno_EC`.

### 31.2. Helper compartido `api/enrich-core.ts`

Centraliza la construcción del `EnrichResult` (paciente + evento) que antes vivía inline en `bed-enrich.ts`:
- `buildPatientData(patient)` — bloque DNI/edad/sexo/financiador (puro).
- `buildEventData(event, opts?)` — bloque diagnóstico/dieta/ayunos/plan/fechas (puro).
- `buildEnrich({ tokenPat, tokenEvt, ... })` — hace fetch a Gamma (paciente + evento via `getEventCached`) y compone. Usado por el cron de enrich y por `bed-enrich` on-demand.

### 31.3. Cron `cron-enrich-beds` (cada 15 min)

[api/cron-enrich-beds.ts](api/cron-enrich-beds.ts). Recorre todas las camas ocupadas con 8 workers paralelos, llama `buildEnrich` por cada una, upsert a `12.EnrichCamas`. `maxDuration: 300s` en vercel.json. Cleanup de filas no vistas + viejas → `Status_EC = 'Inactivo'`.

### 31.4. `/api/beds` lee del cache de SP

[api/beds.ts](api/beds.ts) `enrichBedsFromCache`: tras `transformBeds`, lee `12.EnrichCamas` (1 query), arma Map por `eventKey`, aplica `applyEnrichToBed` (incluye DNI/edad/sexo + flag `enriched: true`). El request del usuario nunca hace las N llamadas de evento → sin timeout.

**ETag del endpoint incluye una firma del enrich** (hash de `eventKey:UpdatedAt_EC` de filas aplicadas). Sino el polling recibe 304 y no refleja cambios de enrich. Ver §31.5.

### 31.5. Frescura sin recarga: polling de beds + cache compartido de eventos

- Cache server-side de `/api/beds` con TTL 45s + ETag combinado (mapa + firma del enrich) → el cliente recibe 200 cuando el enrich cambió en SP.
- `gamma-client.ts` exporta `getEventCached` (Map module-level, 60s TTL). Compartido entre `/api/beds` (legacy path) y `/api/bed-enrich`.
- Cadena: cron 15min escribe a SP → app re-lee `/api/beds` en su poll de 60s → cambio visible en ≤16 min sin recarga.

### 31.6. Click en cama: condicional `enriched`

[views/BedsView.tsx](views/BedsView.tsx) modal — el `useEffect` que dispara `onEnrichBed` ahora salta si `selectedBed.enriched` (la fila vino del cron y ya tiene todo). Solo pega a Gamma como fallback para camas recién ocupadas que el cron aún no procesó.

---

## 32. Notificaciones: cleanup, $batch y filtro defensivo

Resuelve el banner "Tenés N notificaciones sin confirmar" que no se vaciaba para usuarios con backlog (Admin con 1000+ filas `Enviada`).

### 32.1. `markAllForUser` con Microsoft Graph `$batch`

[api/notifications.ts](api/notifications.ts) modo PATCH `{ markAllForUser: true }` marca **todas** las `Status_N='Enviada'` del user logueado (no solo el top-50 del banner). Usa el helper compartido `graphBatchPatchFields` ([api/graph.ts](api/graph.ts)) — 20 PATCH por request al endpoint `/$batch`. Pasa de marcar de a una (~150ms × 1000 = 2.5 min) a ~10s. `remaining` indica si quedó backlog (cliente repite hasta 5 iteraciones).

### 32.2. Filtro defensivo de status en el cliente

[hooks/useHospitalState.ts](hooks/useHospitalState.ts) `checkUnreadNotifications` ahora filtra `n.status === 'Enviada'` además de fecha >20min. Defensivo: si el `$filter` del server fallara (columnas no indexadas con `HonorNonIndexedQueriesWarningMayFailRandomly`), el cliente no muestra Leidas.

### 32.3. Cron `cron-cleanup-notifs` (diario 4am)

[api/cron-cleanup-notifs.ts](api/cron-cleanup-notifs.ts). Trae todas las `Enviada` del entorno, filtra en memoria por `Fecha_N` < hoy-2 días, las marca `Leida` con `$batch`. NO borra (no destructivo). Mantiene el volumen y el banner sanos sin acumular. Retención: 2 días (constante `RETENTION_DAYS`).

---

## 33. Detección de cambios de ayuno en `cron-enrich-beds`

Originalmente `cron-diet-changes` cubría dieta + ayuno (con `FastingHash_DS` en `11.DietaSnapshot`). Refactor: la detección de fasting **se movió a `cron-enrich-beds`** porque ese cron ya escribe el `fasting` en `Payload_EC` y compara naturalmente viejo vs nuevo en cada ciclo, sin necesidad de columnas extra.

### 33.1. Flujo nuevo

[api/cron-enrich-beds.ts](api/cron-enrich-beds.ts): `fetchEnrichRows` parsea `Payload_EC` y extrae `oldFasting`. El worker compara `hashFastingSummary(oldFasting)` vs el nuevo. Si difiere **y** la fila ya existía (no es bootstrap del paciente) → `sendPushToSubscribers({ type: 'FASTING_CHANGE', ... })` con mensaje contextual ("Nuevo ayuno programado: HH:MM" / "Ayuno modificado" / "Ayuno cancelado").

[api/cron-diet-changes.ts](api/cron-diet-changes.ts) volvió a ser solo dieta: sin `FastingHash_DS`, sin `fastingHash` en `Snapshot`/`upsertSnapshot`. JSDoc actualizado.

### 33.2. Permiso granular `notif_fasting_change`

Tipo `NotificationType.FASTING_CHANGE` + permiso `notif_fasting_change` en el catálogo. Mapeado en ambos lados (`lib/permissions.ts` y `api/push-utils.ts` `NOTIF_TYPE_TO_PERMISSION`). Configurable en el ABM (`views/RoleManagementView.tsx` checkbox "Cambio de ayuno" en el grupo cross-module).

---

## 34. Ayunos: reloj inteligente client-side + helper TZ Argentina

[lib/fasting.ts](lib/fasting.ts) (NUEVO, client-side):
- `fastingOccurrenceEpochs(startISO, hours, total)` — genera epochs en hora Argentina (UTC-3 fijo, sin DST). Parsea `startISO` por partes para no depender de la TZ del runtime. `Date.UTC(Y, M-1, D+d, H+3, ...)` normaliza overflow de día/hora.
- `liveUpcoming(ind, now)` — próximas ocurrencias vigentes/futuras con gracia 1h (la de las 15 se ve hasta las 16).
- `hasLiveFasting(fasting, now)` — boolean para el ícono de la tarjeta.
- `formatART(epoch)` — `toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false, ... })`. 24h explícito.

Razón: el cron (Vercel UTC) precomputaba `upcoming`/`hasUpcoming` y los congelaba 15min; el cliente los **ignora** y recalcula en cada render con su `now` y hora Argentina explícita. Cambios live, sin TZ bug, sin esperar al próximo cron.

### 34.1. UI ayunos

[views/BedsView.tsx](views/BedsView.tsx):
- Pill ámbar "🍽 Ayuno" en la tarjeta (no círculo chico) — visible solo si `hasLiveFasting`.
- Modal: pestaña "Ayunos" lista indicaciones con `liveUpcoming` + `formatART`. Indicaciones sin próximas se ocultan; si ninguna → "Sin ayunos próximos".

---

## 35. Permisos y persistencia de geolocalización

Refactor para minimizar prompts al usuario tras recargas (deploy autoUpdate del SW + descarte de memoria del SO).

### 35.1. Cache geo persistido en localStorage

[hooks/useHospitalState.ts](hooks/useHospitalState.ts) — `mediflow_geo` con `{ lat, lng, ts }` y TTL 30min. Helpers módulo-level:
- `readPersistedGeo()` / `writePersistedGeo(coords)` — sobreviven recargas y deploys.
- `geoNoPrompt(ref)` — devuelve geo del ref o localStorage si vigente, **sin** llamar `getCurrentPosition`.
- `requestFreshGeo(ref)` — único punto que dispara prompt; persiste lo obtenido.
- `geoPermissionState()` — consulta `navigator.permissions.query({ name: 'geolocation' })`.

### 35.2. IP-first en validación de ubicación

Tanto el login como la revalidación periódica ahora validan **sin coords primero**. Solo piden GPS si el server responde `method: 'geo_unavailable'` (IP no autoriza) **Y** el permiso del browser está `granted` (no disparar prompt sorpresa en background si está `prompt`/`denied`/`unknown`). Resultado:
- Celu en WiFi del hospital → nunca prompt.
- Datos móviles con geo cacheada → reusa, no prompt.
- Datos móviles sin cache + permiso `prompt` → fail-open en background (no expulsa; espera interacción).

---

## 36. Service worker: cerrar notificaciones del SO al leer (WhatsApp-like)

[src-sw/sw.ts](src-sw/sw.ts) extiende el listener `message` para manejar `CLOSE_NOTIFICATIONS`:
- Si `ticketId` presente → cierra todas las notifs del SO con `data.ticketId` matcheando (el "hilo" del ticket).
- Si no se pasa `ticketId` → cierra todas (caso "marcar todas como leídas").

El cliente ([hooks/useHospitalState.ts](hooks/useHospitalState.ts)) invoca via `closeOsNotifications(ticketId?)` después de marcar leído (en `markNotificationByEvent`, `handleMarkNotificationRead` SP-id, `handleMarkAllNotificationsRead`). Limita el match a Android (en iOS el SO controla más estrictamente la bandeja).

---

## 37. Tab bar del modal de cama scrolleable (mobile)

[views/BedsView.tsx](views/BedsView.tsx) — la botonera de tabs del modal de cama usa `overflow-x-auto` + tabs `shrink-0 whitespace-nowrap` (en vez de `flex-1`). En mobile, los 4 tabs (GENERALES / INTERNACIÓN / DIETA / AYUNOS) ya no se desbordan del fondo gris ni se ven cortados al activarse. El wrapper del modal lleva `min-w-0` para que el contenido respete el ancho del DialogContent (CSS grid).

---

## 38. Movimiento de pacientes en `mergeBeds`: identidad + enrich completo

[hooks/useHospitalState.ts](hooks/useHospitalState.ts).

### 38.1. Constantes canónicas de campos del paciente

`IDENTITY_FIELDS` (4: `patientName`, `patientCode`, `eventOrigin`, `eventNumber`) y `ENRICH_FIELDS` (19: `institution`, `attendingPhysician`, `dni`, `age`, `sex`, `diagnosis`, `prescribingPhysician`, `admissionType*`, `admissionDate`, `expectedSurgeryDate`, `authorizedDays`, `medicalPlan*`, `diets`, `dietTags`, `fasting`, `enriched`) son tuples `as const`.

`clearPatientFromBed`, `copyPatientToBed`, `extractEnrichSnapshot` y `reapplyEnrichFromMap` iteran sobre estas constantes. Cualquier campo nuevo de enrich se agrega en un solo lugar y los cuatro helpers quedan sincronizados sin tocar tres listas literales.

### 38.2. `mergeBeds` en `WAITING_CONSOLIDATION`

Hasta que Admin consolide en PROGAL, Gamma sigue apuntando al paciente en la cama origen. Visualmente lo mostramos en destino: `copyPatientToBed(origin, dest)` copia paciente + enrich completo, y `clearPatientFromBed(origin)` limpia TODO en el origen (sino la pill de ayuno, dieta, diagnóstico, DNI quedan fantasma).

### 38.3. La pill "acompaña al paciente": snapshot client-side por `patientCode`

[hooks/useHospitalState.ts](hooks/useHospitalState.ts) `patientEnrichMapRef: Map<patientCode, PatientEnrichSnapshot>` (en `useRef`).

- **En cada `fetchBeds` exitoso**, antes de `setRawBeds`: para cada `bed` con `patientCode && enriched === true`, `extractEnrichSnapshot(bed)` y `map.set(patientCode, snap)`. Beds con `enriched !== true` **no actualizan** la entrada (se mantiene el snapshot del poll previo).
- **En el `useMemo beds`** (tras `mergeBeds`): `reapplyEnrichFromMap(merged, map)` recorre los beds y, para cada uno con `patientCode` presente en el mapa, `Object.assign(bed, snap)` — sobreescribe TODOS los campos del enrich con los del snapshot.

Consecuencia: cuando un paciente con ayuno se mueve de cama, la pill aparece **donde está hoy** según el `patientCode` actual del bed, sin esperar al próximo `cron-enrich-beds` (15 min). Cubre el caso "Catering veía la pill fantasma" al mover pacientes vía Progal directo (sin ticket en MediFlow).

### 38.4. Caveats

- **Cancelación de ayuno**: si Gamma cancela el ayuno pero el cron aún no procesó al paciente, el snapshot sigue mostrando la pill hasta 15min. Mismo comportamiento que el flujo anterior — el fix no empeora ese caso.
- **Persistencia**: el mapa vive en memoria, se pierde al recargar. El primer poll después de F5 trae todos los enrich del cache SP → el mapa se rehidrata.
- **Crecimiento**: ~150 pacientes activos × ~1KB c/u = <200KB. Sin cleanup explícito por ahora.

---

## 39. Exportables PDF del mapa de camas

[views/BedsView.tsx](views/BedsView.tsx) — tres botones en la barra superior, cada uno con icono distintivo + tooltip + `aria-label`. En mobile el label se oculta (`hidden sm:inline`) pero los iconos quedan diferenciados.

| Botón | Icono | Función |
|---|---|---|
| PDF | `FileText` | Mapa por sector — `exportPDF`, A4 landscape, columnas: Hab/Cama/Estado/Paciente/DNI/Edad/Sexo/Tipo/Ingreso/Días/Cirugía/Evento/Profesional/Financiador. |
| PDF A-Z | `ArrowDownAZ` | Listado alfabético por paciente — `exportPDFAlpha`, mismo formato ordenado por nombre. |
| Dietas | `UtensilsCrossed` | `exportPDFDietas` (NUEVO). Solo OCUPADAS con `dietTags` ∪ `fasting` ∪ observaciones. Columnas: Hab · Cama · Sector · Paciente · **Dieta** (verde) · **Ayuno** (ámbar) · **Observaciones** (multi-línea, `doc.splitTextToSize` ajusta el alto de la fila dinámicamente). Pensado para Catering. |

Los 3 PDFs parten de `filteredBeds` (derivado de `beds`) → heredan automáticamente la combinación **PROGAL + tickets activos + ENRICH "sigue al paciente"** (§38.3). El paso intermedio `enrichBedsForPdf` ejecuta `onEnrichBed` on-demand solo para beds sin DNI; pega a Gamma con el `patientCode + eventOrigin + eventNumber` actuales — datos vivos para esa identidad, no del cache stale.

---

## 40. `cron-enrich-beds`: push de ayuno también para pacientes recién ingresados

[api/cron-enrich-beds.ts](api/cron-enrich-beds.ts) helper `isRecentAdmission(admissionDate)` — true si `admissionDate` (string crudo de Gamma `EVE_FECHA_HORA_INGRESO`, formato `"YYYY-MM-DD HH:MM:SS"`) es ≤24h atrás. Normaliza el espacio a `'T'` para que `Date.parse` lo acepte consistentemente entre runtimes.

Segunda rama del detector de fasting:

```ts
if (existing) {
  // (a) Cambio de hash sobre fila ya existente → push (como antes).
} else if (hasFasting && isRecentAdmission(payload.admissionDate)) {
  // (b) Fila NUEVA + paciente admitido ≤24h + tiene fasting → push.
  //     Logging: [cron-enrich] FASTING NEW-PATIENT ...
}
```

**Por qué:** el bootstrap silencioso original (sin push si la fila no existía) trataba a TODO paciente nuevo como bootstrap, perdiendo el push del primer ayuno cuando el paciente recién ingresaba al hospital. La rama (b) corrige eso sin reintroducir el spam de "el deploy crea filas → push masivo": pacientes pre-existentes (admisión >24h) siguen entrando por bootstrap silencioso.

## 41. Robustez de los crons frente a Gamma lento (2026-06-08)

Gamma corre sobre una VM proxy single-node que bajo carga responde `obtenereventointernacion` en 20-25s o se cuelga. Sin techo por llamada, un request colgado bloqueaba el worker hasta que Vercel mataba la función entera (log: status `0` / `FUNCTION_INVOCATION_TIMEOUT`, `Duration: 0ms`, sin respuesta). Tres capas de defensa, todas tuneables por env sin redeploy.

### 41.1. `fetchWithTimeout` en gamma-client

[api/gamma-client.ts](api/gamma-client.ts) exporta `fetchWithTimeout(url, init?, timeoutMs?)` — envuelve `fetch` con un `AbortController` que aborta a los `GAMMA_TIMEOUT_MS` (env `GAMMA_FETCH_TIMEOUT_MS`, default 30s). Aplicado a `getToken` (oauth_authorize + oauth_token), `fetchPatientDetails`, `fetchEventDetails` y a las llamadas de `obtenermapacamasocupadas` de los crons. Una llamada lenta aborta → se trata como error de ESA cama, no de toda la corrida.

### 41.2. Presupuesto de tiempo por corrida (deadline)

`cron-enrich-beds` y `cron-diet-changes` calculan `const deadline = Date.now() + CRON_BUDGET_MS` (env `CRON_BUDGET_MS`, default 240s, bajo el `maxDuration` de 300s). El loop de workers corre `while (queue.length > 0 && Date.now() < deadline)`. Si se agota el presupuesto, corta prolijo, reporta `stats.skippedByBudget` y devuelve `200` con stats parciales — en vez de que la plataforma la mate con status 0. Las camas sin procesar se retoman el ciclo siguiente. El cleanup de filas stale se saltea si se agotó el presupuesto (filas no vistas por el corte ≠ stale reales).

### 41.3. Distinguir "fetch falló" de "dato vacío"

`fetchEventDetails` devuelve `null` tanto si el evento no existe como si el fetch falló/timeouteó. Tratar ese `null` como "sin dieta/ayuno" disparaba **notificaciones falsas** ("dieta removida" / "Ayuno cancelado") y, en enrich, **pisaba el payload bueno con uno vacío**. Fix:
- `cron-diet-changes`: si `event === null` → `stats.errors++; continue` (no toca el snapshot, no notifica).
- `buildEnrich` ([api/enrich-core.ts](api/enrich-core.ts)) ahora devuelve `eventFetchFailed: event === null`; `cron-enrich-beds` saltea el upsert+push cuando es `true`.

Con los timeouts de 41.1 esto se volvía más frecuente, así que el guard es necesario para no convertir un cuelgue transitorio en una notificación falsa.

### 41.4. Schedules desfasados

Ambos crons corrían en `*/15` (mismo minuto) y saturaban la VM simultáneamente (5+8 workers paralelos), inflando las latencias. Quedó `cron-enrich-beds` en `0,15,30,45` y — tras la consolidación (§42) — `cron-diet-changes` desprogramado.

## 42. Consolidación: detección de dieta dentro de `cron-enrich-beds` (2026-06-08)

`cron-enrich-beds` ya fetcha el evento de cada cama y calcula `dietTags` (vía `parseDiets`). `cron-diet-changes` volvía a fetchear el MISMO evento solo para la dieta — duplicando la carga sobre la VM lenta. Se movió la detección de dieta a `cron-enrich-beds`, en paralelo a la de ayuno:

- `EnrichRow` suma `oldDietTags` (parseado del `Payload_EC` anterior, igual que `oldFasting`).
- Helper `hashDietTags(tags)` = `simpleHash([...tags].sort().join('|'))` — **idéntico** a `cron-diet-changes.hashTags` sobre el `dietTags` ya normalizado por `parseDiets`, así no hay falsos positivos al migrar.
- Si una fila **existente** cambia el hash de dieta → push `DIET_CHANGE` ("Dieta actualizada"). Bootstrap silencioso en filas nuevas (igual que el cron viejo; la dieta NO usa la rama "recién ingresado" del ayuno — ver decisión 19.5).
- `stats.dietNotified` además de `fastingNotified`.

`cron-diet-changes` quedó **desprogramado** de [vercel.json](vercel.json) (el archivo persiste para rebaseline manual con `?silent=1`). La lista `11.DietaSnapshot` queda sin uso. Resultado: ayuno + dieta salen de una sola corrida (:00/:15/:30/:45), con la mitad de llamadas a Gamma. El envío (`sendPushToSubscribers` con `type: 'DIET_CHANGE'`) es idéntico al del cron viejo, así que el filtrado de suscriptores, el permiso `notif_diet_change` y el guardado en `10.Notificaciones` no cambian.

## 43. Deduplicación de notificaciones de la campanita (2026-06-12)

**Síntoma:** usuarios reportaban notificaciones duplicadas y hasta triplicadas en la campanita. Una query read-only de `10.Notificaciones` (PRODUCTIVO, un día) mostró **822 filas escritas para solo 257 eventos reales** (`UserId_N|TicketId_N|Type_N`) → **565 filas de exceso**.

**Causa raíz:** `sendPushToSubscribers` ([api/push-utils.ts](api/push-utils.ts)) escribía **una fila en `10.Notificaciones` por cada suscripción push**, no por usuario. El loop de guardado iteraba el mismo array `relevant` (una entrada por fila de `09.PushSubscriptions`) que el loop de ENTREGA, y `now` se calcula una sola vez por llamada → todas las filas de un evento comparten `Fecha_N` exacto. Un usuario con N endpoints (multi-dispositivo, PWA + browser, rotación de endpoint FCM) recibía N filas idénticas. La correlación era exacta: dentro de un mismo timestamp, el conteo de duplicados = cantidad de suscripciones del usuario (user 68 con 4 subs → ×4; user 75 con 3 → ×3). 19 de 27 usuarios prod tenían ≥2 suscripciones (uno con 25). La campanita además no deduplicaba el historial al renderizar, así que cada fila duplicada se mostraba tal cual.

**Fix en dos capas:**

- **Write-side (causa raíz):** antes del loop de inserción en `10.Notificaciones`, se deduplica `relevant` por `userId` (`notifTargets = Array.from(new Map(relevant.map(s => [String(s.userId), s])).values())`), conservando una suscripción representante por usuario (Title/Message solo varían por rol CATERING, que es per-usuario). Resultado: **una fila por usuario por evento**. La **entrega de push se mantiene intacta** (un push por endpoint; todos los dispositivos del usuario reciben el aviso del SO).
- **Render-side (defensa en profundidad):** el memo `bellNotifications` ([hooks/useHospitalState.ts](hooks/useHospitalState.ts)) colapsa filas duplicadas del historial por clave de evento `ticketId|type|minuto`, con fallback `type|title|message|minuto` para `DIET_CHANGE`/`FASTING_CHANGE` (que no llevan `ticketId`). El minuto sale del `timestamp` ya truncado por `formatDateTime` ("DD/MM/YY HH:mm"), así que duplicados con idéntico `Fecha_N` colapsan; conserva el id real de SP (para marcar-como-leída) y queda no-leída si cualquier copia lo está. Cubre filas legacy/en-vuelo que el fix write-side no limpia retroactivamente.

**Limpieza one-off:** [scripts/_cleanup-notif-dupes.mjs](scripts/_cleanup-notif-dupes.mjs) borra (read+delete; dry-run por default, mutación tras `--apply`) las filas exactamente duplicadas (`UserId_N|TicketId_N|Type_N|Fecha_N` idéntico), conservando 1 por grupo — **nunca fusiona timestamps distintos** (eventos potencialmente reales). [scripts/_diag-notif-dupes.mjs](scripts/_diag-notif-dupes.mjs) es el diagnóstico read-only que agrupa y reporta el histograma de duplicados + suscripciones por usuario; reutilizable para verificar el deploy.

> **Nota operativa:** el fix write-side corta los duplicados nuevos solo una vez **deployado**; mientras producción corra el código viejo, se siguen escribiendo.

### 43.x. Fix "llegan notis con la sesión deslogueada" (2026-06-19)

**Causa raíz:** la entrega de push es independiente de la sesión de la app (depende solo de la fila en `09.PushSubscriptions` + el endpoint vivo). Si el logout no limpiaba la fila, el dispositivo seguía recibiendo — y los **crons** (`cron-enrich-beds`, `cron-diet-changes`) le pegaban cada 15 min sin sesión de por medio. Los casos que fallaban: logout por **token vencido** (el `DELETE` exigía auth → 401 → fila no borrada), logout cortado al cerrar la PWA (fetch fire-and-forget), token expirado con la **app cerrada** (no corre código de cliente), y **duplicados** de endpoint (POST creaba fila nueva ante throttle; DELETE borraba solo `$top=1`).

**Solución (sin tocar el esquema SP):**
- **DELETE sin `requireAuth`** ([api/push-subscribe.ts](api/push-subscribe.ts)): identifica por endpoint (secreto inadivinable), así el logout por vencimiento/ubicación SÍ limpia. Borra **todas** las filas del endpoint (no `$top=1`).
- **POST idempotente:** si hay filas duplicadas del endpoint, actualiza una y borra el resto.
- **Logout robusto** ([hooks/useHospitalState.ts](hooks/useHospitalState.ts) `handleLogout`): `keepalive: true`, sin depender del token, borra la fila antes de `unsubscribe()`.
- **Staleness en el sender** ([api/push-utils.ts](api/push-utils.ts) `fetchSubscriptions`): saltea subs con `lastModifiedDateTime` > 36h (fail-open si falta el dato). Resuelve el caso "app cerrada + token vencido".
- **Heartbeat del cliente:** mientras la sesión está activa, re-POSTea la sub (refresca `lastModifiedDateTime`) al montar, al foreground y cada 6h (`touchPushSubscription`, no pide permiso ni crea sub nueva). Mantiene "vivas" solo las subs de dispositivos en uso.

**Hardening pendiente:** handler `pushsubscriptionchange` en el SW + endpoint "rotate" (frena la acumulación por rotación de endpoint en origen), y un cron de limpieza que borre las filas con `lastModifiedDateTime` viejo (hoy el sender ya las ignora, pero quedan en la lista). Además, hacer idempotente el push del `PATCH` de estado (hoy reenvía aunque el status no cambie de verdad).

## 44. Observaciones de traslado: carga + auditoría (2026-06-18)

Feature para que **cualquier rol** deje notas ligadas a un ticket de traslado, persistidas para auditoría. Backend: lista SP `13.ObservacionesTraslados` ([api/ticket-observations.ts](api/ticket-observations.ts) — `GET ?ticketId=`, `POST`). Cada observación **snapshotea el status del ticket** al momento de escribirla (`StatusDelTicket_OBS`) + autor + fecha.

### Dos superficies, un mismo dato

- **Operativa** ([views/RequestsView.tsx](views/RequestsView.tsx)) — **un solo botón "Observaciones"** para todos los roles (antes había split cargar/ver por rol). Abre un modal **hilo + redactor**: arriba el historial cronológico (auto-scroll al fondo + contador en el header), abajo el textarea. La nota nueva aparece **al instante** (append optimista) y el modal **no se cierra** → cargar y ver en el mismo lugar. Disponible mientras el ticket esté activo.
- **Auditoría** ([components/AuditModal.tsx](components/AuditModal.tsx), Historial → Auditar) — las observaciones se renderizan como **nodos propios en la misma línea de tiempo de los hitos**, intercaladas por fecha (no como badge colgado de un hito). Incluye un redactor para notas **post-cierre** (el ticket en auditoría siempre está cerrado), marcadas distinto ("Post cierre", violeta). En desktop el redactor va inline al pie; en mobile es un **botón que abre un modal** aparte (libera alto para ver más trazabilidad). El composer queda **fijo** mientras la trazabilidad scrollea (modal acotado a `max-h-[92vh]`).

### Línea de tiempo unificada (auditoría) — fix del bug de obs huérfanas

Antes cada observación se anclaba al evento que "abría" su status (mapa `EVENT_TIPO_TO_STATUS`). Eso dejaba **huérfanas** las notas cuyo evento no existía: un **traslado directo** (cama destino `AVAILABLE`) nace en `Habitacion Lista` (IN_TRANSIT) **sin** registrar el hito `Habitacion Preparada`, y los tickets `Cancelado` ni figuran en el mapa. Esas observaciones nunca se mostraban. Ahora se **mergean eventos + observaciones en un solo array ordenado por `fecha`** (`TimelineItem = {kind:'event'} | {kind:'obs'}`) → toda observación siempre aparece, sin depender de qué eventos existan. Ver decisión §21.1.

### Reglas de carga (`handleAddObservation` en [useHospitalState.ts](hooks/useHospitalState.ts))

- Bloqueada en tickets cerrados (`COMPLETED`/`REJECTED`) desde Operativa — las notas post-cierre se cargan **solo desde Auditoría** (POST directo, no pasa por este handler).
- La **Azafata** deja de cargar al llegar a `WAITING_CONSOLIDATION` (ya recibió al paciente, su parte operativa terminó); Admisión/Admin sí pueden seguir anotando en esa etapa.

## 45. Habitación en notificaciones de dieta/ayuno para todos los roles (2026-06-18)

`cron-enrich-beds` agregaba la habitación (`formatRoomForCatering(roomName, areaName)`, ej. `"Habitación 413 (Piso 4)"`) **solo** al `cateringBody` de los push `DIET_CHANGE`/`FASTING_CHANGE`; el `body` genérico que veían los demás roles iba sin ubicación. Ahora la habitación va en el `body` genérico también (un solo texto para `body` y `cateringBody`), así **todos los roles** ubican al paciente sin abrir la app. Ver [api/cron-enrich-beds.ts](api/cron-enrich-beds.ts). (`cron-diet-changes` sigue desprogramado — §42 — por eso no requirió el mismo cambio.)

## 46. Aislamientos desde PROGAL como fuente única (2026-06-22)

Hasta acá los aislamientos se **cargaban a mano** desde la app y vivían en la lista `08.Aislamientos` (`/api/isolations`), leídos por el front cada 30s a un `Map<patientCode, IsolationType[]>`. Grupo Gamma ahora los devuelve dentro del evento (`obtenereventointernacion`), así que pasan a tomarse **100% de PROGAL** vía el enrich. La app ya **no asigna ni quita** aislamientos.

### Flujo de datos (espejo de `DIETAS`/`AYUNOS`)

- `obtenereventointernacion` retorna `AISLAMIENTOS[]`, misma forma que `DIETAS`: `{ HCG_DESCRIPCION, EIP_RESPUESTA_VALOR }`. El tipo base trae `"Prescribe"`; la observación llega como fila aparte `"<Tipo> - Observaciones"` con el texto libre.
- [api/isolations-summary.ts](api/isolations-summary.ts) (**nuevo**, análogo a [api/diet-tags.ts](api/diet-tags.ts)/[api/ayunos.ts](api/ayunos.ts)): `summarizeIsolations()` filtra los prescriptos, **normaliza** el nombre de Gamma a un nombre canónico + clave de color (la app los nombra distinto: "De contacto"→"Contacto", "COVID 19"→"Covid", etc.) y adjunta la observación. `hashIsolations()` para detección de cambios.
- Se guarda como `isolations: IsolationEntry[]` (`{ name, color, observation? }`) en `EnrichResult` ([api/enrich-core.ts](api/enrich-core.ts) `buildEventData`) → `Payload_EC` de `12.EnrichCamas` → `bed.isolations` vía `applyEnrichToBed` ([api/beds.ts](api/beds.ts)). **El cron no necesitó cambios**: ya persiste el payload completo.

### Front

- `isolations` se sumó a `ENRICH_FIELDS` ([hooks/useHospitalState.ts](hooks/useHospitalState.ts), ahora 20 campos) → el aislamiento **viaja con el enrich y "sigue al paciente"** en los traslados, igual que dieta/ayuno (`mergeBeds`/`reapplyEnrichFromMap`).
- `isolatedBeds` se **deriva de `bed.isolations`** (camas con ≥1 aislamiento). Se eliminaron: `isolatedPatients`, el polling de `/api/isolations` (`POLL_ISOLATIONS_MS`), `fetchIsolations`, `toggleIsolation`, los bloques de escritura en create/edit ticket, la UI de aislamiento en los modales y el permiso `editar_aislamiento`.
- El color map de [views/BedsView.tsx](views/BedsView.tsx) pasó a estar **keyed por clave de color** (no por el enum). Tipo nuevo **Contacto preventivo** (`teal`); **Entomológico/Dengue** re-coloreado a `fuchsia` (antes `violet`, chocaba con el default). El detalle de cama muestra tipos + observaciones (solo lectura, usa `displayBed` para soportar enrich on-demand).

### Deprecado

`/api/isolations` + lista `08.Aislamientos` + enum `IsolationType` quedan **sin uso** (el archivo del endpoint sigue en el repo, inactivo). La fuente única es PROGAL.

## 47. Mapa de camas y traslados: ajustes finos (2026-06-25)

Tres cambios acotados (pedido del cliente), validados con una revisión adversarial multi-agente: los tres cumplen la intención; sin bugs francos (solo cosmética menor en 47.3).

### 47.1. `WAITING_CONSOLIDATION`: la cama origen respeta PROGAL (refina §38.2)

`mergeBeds` ([hooks/useHospitalState.ts](hooks/useHospitalState.ts)) ya no fuerza la cama **origen** a "En preparación" en `WAITING_CONSOLIDATION` de forma incondicional. El helper `progalStillHasTicketPatientOnOrigin(origin, ticket)` decide: si PROGAL todavía muestra OCCUPIED con el **mismo `patientCode`** del ticket (move ejecutado pero no consolidado) → se limpia/prepara como antes; si PROGAL ya inhabilitó/liberó/reasignó la cama → se respeta su estado real (`gammaBeds`). Así una cama origen **inhabilitada** en PROGAL ya no reaparece como "En preparación" ni como destino reutilizable (`availableDestinations` en [NewRequestModal](components/modals/NewRequestModal.tsx)/[EditRequestModal](components/modals/EditRequestModal.tsx) solo lista Disponible/En preparación). El **destino** sigue con el ticket como fuente de verdad. `IN_TRANSPORT` queda **sin cambios**. Regla mnemónica: **origen = PROGAL, destino = ticket**.

### 47.2. "Ingreso a ITR": origen solo pacientes con `eventOrigin === 'HIN'`

El filtro de origen del workflow `INGRESO_A_ITR` ([components/modals/NewRequestModal.tsx](components/modals/NewRequestModal.tsx)) pasó de `isHitArea(b.area)` a `isHitArea(b.area) && normEventOrigin(b.eventOrigin) === 'HIN'`. `eventOrigin` (= `origen_evento` de `obtenermapacamasocupadas`, ver [api/beds.ts](api/beds.ts) `transformBeds`) distingue internación definitiva (`HIN`) de transitoria (`HIT`); solo las `HIN` se listan. Complementa las reglas de origen/destino por workflow (sección de workflows, más arriba). Los flujos `INTERNAL` e `ITR_TO_FLOOR` no se ven afectados (el filtro vive dentro de la rama `isIngresoItrFlow`).

### 47.3. Aislamiento "Contacto preventivo": cama contigua señalizada, no bloqueada (extiende §46)

`blockedByIsolation` ([views/BedsView.tsx](views/BedsView.tsx)) se desdobló en `{ blockedByIsolation, preventiveContactAdjacent }`. Las camas no aisladas de una habitación con **solo** Contacto preventivo van a `preventiveContactAdjacent` (celda `cyan` + badge ShieldAlert cyan, NO "inhabilitada"); si la habitación tiene algún aislamiento **duro**, las contiguas siguen en `blockedByIsolation` (violeta — el bloqueo duro tiene prioridad). El `cyan` no se solapa con ningún color de estado de cama ni con el violeta del bloqueo. El modal de la cama contigua muestra un aviso cyan "usar con precaución" en lugar del cartel "Bloqueada".
