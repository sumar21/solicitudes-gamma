# Roles, Permisos y Notificaciones — MediFlow

Referencia para **QA de permisos** y soporte: qué módulos y permisos existen, qué habilita cada uno
(UI y/o notificación), quién recibe cada notificación, cómo funcionan `filter_by_floors` /
`assigned_areas`, y cómo se togglea todo desde el ABM de Roles.

- Fuente de verdad del catálogo: `types.ts` (`PERMISSIONS`, `ROLE_MODULES`, `MEAL_SLOTS`) y `lib/permissions.ts`.
- Los roles viven en **Supabase `public.roles`** (migrados de la lista SharePoint `99.ABMRoles_Traslados`).
  Para el "qué hay / cómo está armado" ver [arquitectura.md](arquitectura.md); para el "por qué",
  [decisiones.md](decisiones.md); para síntomas → causa, [troubleshooting.md](../qa/troubleshooting.md).

> **Regla mental clave:** un rol NO tiene privilegios por su nombre. Todo se decide por los **permisos**
> y **módulos** que tenga cargados (son `text[]` en `public.roles`, editables desde el ABM). "Admin",
> "Azafata", "Catering" son nombres convenientes, no reglas. Las poquísimas excepciones hardcodeadas
> se listan en §9.

---

## 1. Cómo se arma un rol (panorama)

| Pieza | Dónde | Detalle |
|-------|-------|---------|
| Definición del rol | `public.roles` (Supabase) | Columnas: `name`, `modules text[]`, `permissions text[]`, `filter_by_floors bool`, `bypass_location_check bool`, `status` (`Activo`/`Inactivo`, soft-delete). RLS ON **sin policies** → solo `service_role` lee/escribe. |
| CRUD del rol | `api/roles.ts` (`requireAuth`) | Mantiene el "shape SP" para no tocar el front: devuelve `access` como string unido por `/`, `permissions` como array, `spItemId` = uuid. Cada mutación llama `invalidateRoleCache()`. |
| Cache de roles | `api/role-cache.ts` | In-memory, TTL 5 min. `null` = fallo (sirve stale, no cachea) vs `[]` = sin roles (modo seguro). |
| Usuario → rol | `api/auth.ts` (login) | **Los usuarios siguen en SharePoint `00.Usuarios`.** El join es por NOMBRE: `Perfil_U ↔ roles.name` (case-insensitive, `getRoleByName`). |
| Hidratación de la sesión | `api/auth.ts:134-151` | Login copia al `User` (y al JWT): `permissions`, `modules`, `filterByFloors`, `bypassLocationCheck`, `roleName`. |
| Resync en caliente | `api/me.ts?roleName` + `syncSessionRole` (cada 60 s) | Refresca módulos/permisos/flags **sin re-loguear**. LIMITACIÓN: refresca por el `roleName` al que el user YA pertenece; si un admin lo **reasigna a otro rol**, el cambio recién entra al re-loguear (`api/me.ts:10-12`). |
| Safe-default | `lib/permissions.ts:12` | Rol ausente / mal escrito en `Perfil_U` → `permissions:[]`, `modules:[]` → **solo lectura**. `can()` y `hasModule()` devuelven `false` ante campo faltante. |

**Helpers de gating** (`lib/permissions.ts`):

- `can(user, perm)` → gatea **botones y mutaciones** en la UI (`user.permissions.includes(perm)`).
- `hasModule(user, mod)` → gatea **sidebar / vistas** (`user.modules.includes(mod)`).
- `canLoadMealSlot` / `canLoadAnyMealSlot` → carga de comandas por turno (`permitsMealSlotLoad`).
- `canReceiveNotif(user, type)` → gatea la **campanita in-app** client-side vía `NOTIF_TYPE_TO_PERMISSION`.
  El servidor tiene el MISMO map (a propósito duplicado) en `api/push-utils.ts:140` y en la Edge Function
  `supabase/functions/notify-push/index.ts:42` → gatea el **envío real del push**.

---

## 2. Módulos (`Acceso_RT` → columna `modules`)

Drive el sidebar / las vistas. Catálogo cerrado en `types.ts:385` (`ROLE_MODULES`). El `value` que se
persiste NO cambia aunque el label del ABM sí (`views/RoleManagementView.tsx:32-43`).

| `value` (persistido) | Label en el ABM | Qué habilita | Gate |
|----------------------|-----------------|--------------|------|
| `Home` | Home (Monitor) | Landing / Monitor de KPIs (`DashboardView`) | `hasModule` |
| `Operativa` | Operativa | Traslados + solapa Limpiezas (`RequestsView`) | `hasModule` |
| `Historial` | Historial | Auditoría + Trayectoria (`HistoryView`, `PatientJourney`) | `hasModule` |
| `Mapa de Camas` | Mapa de Camas | Grilla de camas + detalle paciente + carga de comandas (`BedsView`) | `hasModule` |
| `Gestion Limpieza` | **Operativa · Limpiezas** | Vista de supervisión de limpiezas (`CleaningManagementView`) | `hasModule` |
| `Gestion Comandas` | Gestión de Comandas | Panel de comandas + planificación de menú (`ComandasManagementView`) | `hasModule` |
| `Configuracion` | Configuración | ABM de Usuarios y Roles (`UserManagementView`, `RoleManagementView`) | `hasModule` |

> **Nota de migración:** "Limpiezas" dejó de ser una vista propia del sidebar y pasó a ser una **solapa
> dentro de Operativa** (`operativaSubview` en `useHospitalState`). El módulo `Gestion Limpieza` sigue
> existiendo como permiso independiente (label "Operativa · Limpiezas" en el ABM). El value NO se tocó
> para no migrar los roles existentes. `ViewMode` ya no incluye `CLEANINGS` (`types.ts:335-339`).

Landing tras login = **primer módulo accesible** en el orden Home → Operativa → Mapa → Historial →
Limpieza → Comandas. Enfermería/Catering (solo Mapa) aterrizan directo en Mapa de Camas.

---

## 3. Catálogo de permisos (`Permisos_RT` → columna `permissions`)

Catálogo cerrado en `types.ts:354-381` (`PERMISSIONS`). Cada permiso gatea UI (`can()`) y/o el envío de
una notificación. Agrupados como en el ABM (`RoleManagementView.tsx:47-106`).

### 3.1. Operativa (traslados + limpiezas)

| Permiso | Qué habilita | Dónde se gatea |
|---------|--------------|----------------|
| `crear_ticket` | Botón "Nueva Solicitud" → crear traslado | UI (`RequestsView` / `NewRequestModal`) |
| `editar_ticket` | Botón "Editar" (solo si la azafata NO intervino) | UI (`EditRequestModal`) |
| `cancelar_ticket` | Botón "Cancelar" (exige motivo) | UI + **hardcode extra**: `handleRejectTicket` pide rol `ADMISSION`/`ADMIN` (ver §9) |
| `asignar_cama` | **LEGACY** — `handleAssignBedAction` es no-op (la cama se asigna al crear) | — |
| `confirmar_limpieza` | Botón "Habitación Lista" (azafata destino) **y** botón "Marcar limpia / Deshacer" en el Mapa | UI + **enforcement de piso server-side** (`api/tickets.ts`, extremo `dest`) |
| `iniciar_traslado` | Botón "Iniciar Traslado" (azafata origen) | UI + enforcement de piso (`api/tickets.ts`, extremo `origin`) |
| `confirmar_recepcion` | Botón "Recepción OK" (azafata destino) | UI + enforcement de piso (`api/tickets.ts`, extremo `dest`) |
| `consolidar` | Botón "Consolidar PROGAL" (Admisión/Admin) | UI |
| `consolidar_limpieza` | Botón "Consolidado PROGAL" en la vista de supervisión de limpieza | UI (`CleaningManagementView`) |

> **Trampa de QA (ABM):** `consolidar_limpieza` se renderiza en el grupo **Operativa**, no en
> "Operativa · Limpiezas" (`RoleManagementView.tsx:62`). Se movió a propósito: como un grupo solo
> aparece si su módulo está tildado, antes era imposible darle ese permiso a un rol con Operativa pero
> sin el módulo `Gestion Limpieza`.

### 3.2. Mapa de Camas — comandas

| Permiso | Qué habilita | Dónde se gatea |
|---------|--------------|----------------|
| `ver_dieta` | Ver las comandas cargadas (ícono + detalle read-only) — Catering/Nutrición | UI (`BedsView`, `ComandasManagementView`) |
| `cargar_dieta` | Cargar/editar comandas de **TODOS** los turnos (permiso histórico) | UI + **enforcement server-side** por turno en `POST /api/dietas` |
| `cargar_comanda_desayuno` | Cargar/editar solo el turno Desayuno | idem, granular |
| `cargar_comanda_almuerzo` | Cargar/editar solo el turno Almuerzo | idem, granular |
| `cargar_comanda_merienda` | Cargar/editar solo el turno Merienda | idem, granular |
| `cargar_comanda_cena` | Cargar/editar solo el turno Cena | idem, granular |

Regla: `permitsMealSlotLoad(perms, slot)` = `cargar_dieta` **O** `cargar_comanda_<slot>`
(`types.ts:293`). `cargar_dieta` + un granular es redundante (gana "todos"). Los `cargar_comanda_*` se
**derivan de `MEAL_SLOTS`**: agregar un turno al catálogo genera su permiso solo.

### 3.3. Gestión de Comandas — planificación de menú

| Permiso | Qué habilita | Dónde se gatea |
|---------|--------------|----------------|
| `ver_planificacion` | Abrir el modal de planificación de menú (solo lectura) | UI + `api/carga-menu.ts` (GET) |
| `abm_planificacion` | Crear / editar / eliminar planificación de menú | UI + `api/carga-menu.ts` (POST/PATCH/DELETE) |

### 3.4. Configuración

| Permiso | Qué habilita | Dónde se gatea |
|---------|--------------|----------------|
| `abm_usuarios` | ABM de Usuarios (`UserManagementView`) | UI |
| `abm_roles` | ABM de Roles (`RoleManagementView`) | UI |

### 3.5. Notificaciones (grupo cross-module — siempre visible en el ABM)

Una por tipo. Gobiernan que el usuario **reciba push + campanita** de ese tipo. Ver §4.

| Permiso | Tipo de notif | Camino de push |
|---------|---------------|----------------|
| `notif_new_ticket` | `NEW_TICKET` | Edge Function `notify-push` (traslados) |
| `notif_status_update` | `STATUS_UPDATE` | Edge Function `notify-push` (traslados) |
| `notif_reception_confirmed` | `RECEPTION_CONFIRMED` | Edge Function `notify-push` (traslados) |
| `notif_diet_change` | `DIET_CHANGE` | `api/push-utils.ts` (Vercel, cron dieta) |
| `notif_fasting_change` | `FASTING_CHANGE` | `api/push-utils.ts` (Vercel, cron ayuno) |
| `notif_habitacion_limpia` | `ROOM_CLEANED` | `api/push-utils.ts` (Vercel, al marcar limpia) |

---

## 4. Matriz de notificaciones

### 4.1. Dos caminos de push (leen ambos `public.push_subscriptions` de Supabase)

| Camino | Corre en | Tipos | Disparo | Idempotencia |
|--------|----------|-------|---------|--------------|
| **Traslados** — `supabase/functions/notify-push/index.ts` | Supabase (Edge Function, Deno) | `NEW_TICKET`, `STATUS_UPDATE`, `RECEPTION_CONFIRMED` | Database Webhook (pg_net) sobre INSERT/UPDATE de `public.traslados` | `push_dispatch_log` (key `id_univoco:status:updated_at`) — mató el "TIN TIN TIN" |
| **Dieta / Ayuno / Limpieza** — `api/push-utils.ts` | Vercel (`web-push`) | `DIET_CHANGE`, `FASTING_CHANGE`, `ROOM_CLEANED` | crons (`cron-diet-changes`) y acción de azafata (`api/limpiezas.ts`) | guard in-memory 60 s (por instancia de lambda) |

> **Comandas NO emite push** (módulo silencioso). Y `notificaciones` la campanita = una fila por
> usuario por evento en `public.notificaciones` (la escriben ambos caminos).

### 4.2. Transición → tipo → label (traslados)

Mapeo en la Edge Function (`STATUS_LABELS`, `notify-push/index.ts:34-46`):

| Estado que se escribe | Tipo | Título de la notif |
|-----------------------|------|--------------------|
| INSERT (creación) | `NEW_TICKET` | "Nueva Solicitud de Traslado" |
| `Habitacion Lista` (IN_TRANSIT) | `STATUS_UPDATE` | "Habitación Lista" |
| `En Traslado` (IN_TRANSPORT) | `STATUS_UPDATE` | "Traslado en Curso" |
| `Por Consolidar` (WAITING_CONSOLIDATION) | `RECEPTION_CONFIRMED` | "Recepción Confirmada" (override CATERING, ver 4.4) |
| `Consolidado` (COMPLETED) | `STATUS_UPDATE` | "Traslado Finalizado" |
| `Cancelado` (REJECTED) | `STATUS_UPDATE` | "Traslado Cancelado" |
| **`Esperando Habitacion` (WAITING_ROOM)** | — | **sin label → NO notifica** |

### 4.3. Quién recibe qué (la matriz)

**Regla dura:** un suscriptor recibe el tipo `X` **sii** su rol tiene el permiso
`NOTIF_TYPE_TO_PERMISSION[X]` **y** pasa el resto de filtros de `isRelevant` (§4.4). No es hardcode por
nombre de rol: es data en `roles.permissions`.

La tabla siguiente es la **configuración habitual** de los roles operativos (editable desde el ABM,
NO garantizada por código). `●` = suele recibir; `○` = filtrado por piso (solo sus áreas); `—` = no.

| Tipo (permiso requerido) | Admisión | Azafata | Enfermería | Catering | Nutrición | Dirección / Read-only | Admin |
|--------------------------|:--------:|:-------:|:----------:|:--------:|:---------:|:---------------------:|:-----:|
| `NEW_TICKET` (`notif_new_ticket`) | ● | ○ | — | — | — | — | (config) |
| `STATUS_UPDATE` (`notif_status_update`) | ● | ○ | — | — | — | — | (config) |
| `RECEPTION_CONFIRMED` (`notif_reception_confirmed`) | ● | ○ | — | ● (texto custom) | — | — | (config) |
| `DIET_CHANGE` (`notif_diet_change`) | — | — | — | ● | (config) | — | (config) |
| `FASTING_CHANGE` (`notif_fasting_change`) | — | — | — | ● | (config) | — | (config) |
| `ROOM_CLEANED` (`notif_habitacion_limpia`) | ● | — | — | — | — | — | (config) |

Notas:
- **Azafata** (`○`): recibe traslados **solo de sus áreas asignadas** (filtro `subAreaMatches`, §5).
- **Dirección / Read-only**: sin permisos de notificación → nunca reciben push.
- **Admin / otros roles**: reciben lo que tengan tildado; no hay privilegio implícito.

### 4.4. Filtros de destinatario (`isRelevant`)

Idéntico en `api/push-utils.ts:149` y en la Edge Function `notify-push/index.ts:169`:

1. **excludeUser** — el que disparó la acción NO se auto-notifica (`created_by_id` en INSERT,
   `last_actor_id` en UPDATE). El actor igual ve su acción por `addNotification` local optimista.
2. **sede** — `sub.sede` debe coincidir con la del evento, salvo `sub.sede === 'SUMAR'`.
3. **rol encontrado** — join case-insensitive contra roles `Activo`; sin rol → descartado.
4. **permiso** — `roleCfg.permissions` incluye `NOTIF_TYPE_TO_PERMISSION[type]`. Tipo no mapeado → `false`.
5. **filter_by_floors** — si el rol filtra, `subAreaMatches` (match exacto de `assigned_areas` contra el
   área origen/destino, con remapeo HRA; ≥ 9 áreas = full access). Ver §5.
6. **freshness** — `last_seen_at ≤ 36 h` (heartbeat); sub stale se descarta (fail-open si no hay timestamp).

**Override CATERING** (solo `RECEPTION_CONFIRMED`): título "Traslado concretado", cuerpo
"{paciente} pasó de Habitación X (Piso) a Habitación Y (Piso)" (`notify-push/index.ts:142-149`).

**Borrado de suscripción:** solo `404`/`410` borran la sub. **`403` NO** (podría ser misconfig VAPID
global del sender → vaciaría toda la tabla). El self-heal client-side (`lib/pushSubscription.ts`)
regenera la sub si el VAPID no matchea.

---

## 5. `filter_by_floors` + `assigned_areas`

- **`filter_by_floors`** es un flag del **rol** (`FiltrarPisos_RT` → columna `filter_by_floors`). Si es
  `true`, el usuario **solo ve traslados/camas de sus áreas** (client: `useHospitalState`) **y** su push
  se filtra por área.
- **`assigned_areas`** viene del **usuario** (`PisosAzafata_u` en `00.Usuarios` SP, codificado
  `P4/P5/HIT/HUC/…` ↔ nombres largos de `Area`). Es un **snapshot** copiado a `push_subscriptions` al
  suscribir (login). Editar el rol o las áreas del usuario (`api/users.ts` PATCH) **propaga en el acto**
  a `push_subscriptions` (`assigned_areas`, `user_role`).
- **Full access:** un rol que filtra pero con **≥ 9 de las 10 áreas** se trata como sin filtro
  (`areas.length >= 9`, mismo criterio en `push-utils`, la Edge Function y `api/tickets.ts`).

### 5.1. Enforcement de piso en el servidor (traslados)

`api/tickets.ts` (PATCH) revalida la acción de azafata contra las áreas del usuario (no confía en la UI).
Mapeo estado-que-se-escribe → extremo requerido (`HOSTESS_ACTION_ENDPOINT`, `tickets.ts:199-203`):

| Acción (status destino) | Extremo requerido |
|-------------------------|-------------------|
| `Habitacion Lista` (confirmar limpieza) | **destino** |
| `En Traslado` (iniciar traslado) | **origen** |
| `Por Consolidar` (confirmar recepción) | **destino** |

Si el rol tiene `filter_by_floors`, no es full access, y el área requerida no está en `assigned_areas`
→ **HTTP 403** "No autorizado: el traslado no pertenece a tus pisos asignados." (`tickets.ts:213-215`).
Admin/Admisión quedan exentos (no filtran).

**Regla HRA** (`effectiveAreaNames`, `push-utils.ts:109`): si el extremo requerido es HRA
(Recepción Admisión = Sala de Espera, sillones) se **remapea al piso real del otro extremo** — así en un
HRA→Piso la azafata de destino es dueña de ambos extremos. Mismo remapeo se aplica en el filtro de push.

---

## 6. `bypass_location_check`

Flag del rol (`BypassUbicacion_RT` → columna `bypass_location_check`). Si es `true`, el usuario se
**saltea la validación de ubicación** (IP/GPS) en login y en la revalidación periódica.

- La decisión es **autoritativa server-side** (`api/validate-location.ts:45-46`): hace lookup fresco del
  rol y devuelve `allowed:true method='role_bypass'` — NO depende del flag del cliente (que se hidrata en
  login y queda viejo).
- Sin bypass → `checkRequestLocationFull` (IP + GPS opcional) contra la lista SharePoint `99.ABM_GeoIPS`.
- Cliente (`useHospitalState`): valida en login y revalida cada 60 s, con **histéresis de 3 fallos**
  consecutivos (~3 min) antes de patear (`handleLogout`); fail-open ante errores de red; `SUMAR` y roles
  con bypass se saltean; no dispara prompt de GPS en background.

---

## 7. Cómo se togglea en el ABM (Configuración → Roles)

Vista `views/RoleManagementView.tsx`. Requiere módulo `Configuracion` + permiso `abm_roles`.

1. **Nuevo Rol** / editar (lápiz) → modal. Nombre + tildar **Módulos de Acceso** (grilla de los 7).
2. **Permisos de Acciones**: aparecen **agrupados por módulo** y cada grupo se renderiza **solo si su
   módulo está tildado** (`moduleEnabled`, `RoleManagementView.tsx:533`). Excepción: el grupo
   **Notificaciones** es cross-module (`module: '__cross__'`) → siempre visible.
3. Toggles **"Filtrado por pisos asignados"** (Sí/No → `filter_by_floors`) y **"Acceso sin restricción de
   ubicación IP/GPS"** (Sí/No → `bypass_location_check`).
4. **Crear/Guardar** → `POST`/`PATCH /api/roles` → `public.roles` + `invalidateRoleCache()`.
5. Eliminar (tacho) = **soft-delete** (`status='Inactivo'`). Los usuarios de ese rol no se borran, pero
   quedan sin match → modo solo-lectura hasta reasignarlos.

**Comportamientos finos del modal (útiles para QA):**

- Destildar un módulo **quita sus permisos del set**; re-tildarlo **restaura los que había al abrir el
  modal** (`originalPermissions`, `RoleManagementView.tsx:198-221`) — evita perder permisos por un toggle
  accidental.
- Si el admin **edita su propio rol**, `onSessionRoleUpdate` refresca módulos/permisos sin re-loguear.
- Nombre de rol **duplicado case-insensitive** → `409` "Ya existe un rol con ese nombre" (índice único
  `lower(name)`, PG `23505`).

---

## 8. Notas de QA (casos borde de permisos/notifs)

| Escenario | Resultado esperado | Verificar |
|-----------|--------------------|-----------|
| `Perfil_U` no matchea ningún `roles.name` | Loguea, pero `permissions:[] modules:[]` → solo lectura, landing potencialmente vacía | Crear usuario con perfil inexistente |
| Editar un rol y quitarle TODOS los permisos | Se escribe `permissions:[]`; los usuarios pierden botones/push en el próximo `syncSessionRole` (60 s) | — |
| **Reasignar** un usuario a OTRO rol | El cambio de módulos/permisos NO entra por `syncSessionRole` (refresca por el `roleName` viejo) → recién al re-loguear | Cambiar el rol de un user logueado |
| Editar **áreas** de un usuario logueado | Propaga a `push_subscriptions` en el acto (push filtra bien), pero `user.assignedAreas` de la sesión NO se refresca hasta re-login → el filtro de UI de camas usa las áreas viejas | — |
| Azafata actúa fuera de su piso | UI puede no mostrar el botón, pero el PATCH server devuelve **403** igual. Regla HRA remapea al piso del otro extremo | Azafata Piso 5 confirmando recepción de un traslado a Piso 6; y caso HRA→Piso |
| Rol filtra pisos con **≥ 9 de 10 áreas** | Full access: ve/recibe TODO (bypass del filtro) | Asignar 9 sectores |
| Actor recibe su propia notif | NO (excludeUser por `created_by_id`/`last_actor_id`), pero SÍ ve la campanita local optimista | Crear traslado y confirmar que no llega tu propio `NEW_TICKET` |
| WAITING_ROOM ('Esperando Habitacion') | NO dispara push (sin label). Solo el `NEW_TICKET` del INSERT | Crear traslado con destino EN PREPARACIÓN |
| Sub stale (>36 h sin heartbeat) | No recibe push aunque el rol tenga el permiso | Dejar un dispositivo sin abrir la PWA >36 h |
| CATERING vs resto en RECEPTION_CONFIRMED | Catering ve "Traslado concretado" (texto custom); el resto ve "Recepción Confirmada" | Comparar el push de ambos para el mismo evento |
| VAPID rotado / mismatch | Sub vieja da 403 (no se borra); self-heal re-suscribe en la próxima apertura. Si las 3 puntas de VAPID no coinciden → nadie recibe push (403 silencioso) | Rotar VAPID |
| Entorno cruzado | Solo se disparan subs del `ENTORNO` actual (default `TESTING`) → TESTING↔PRODUCTIVO no se cruzan | Suscribir en PRODUCTIVO, evento TESTING no llega |
| Permiso de comandas granular | `cargar_comanda_almuerzo` NO habilita cargar cena; la UI esconde los turnos no permitidos y el server bloquea con 403. Se resuelve por user-id del JWT (token viejo con permisos de más no sirve) | Dar solo un turno |

---

## 9. Excepciones hardcodeadas (no todo es data)

Casi todo se decide por permisos, pero hay tres puntos donde el **nombre del rol** importa:

1. **Cancelar traslado** — `handleRejectTicket` exige `cancelar_ticket` **Y además** rol `ADMISSION` o
   `ADMIN` (doble check hardcodeado en `useHospitalState`). Un rol custom con `cancelar_ticket` pero otro
   nombre NO podría cancelar desde la UI.
2. **Override CATERING** en `RECEPTION_CONFIRMED` — el título/cuerpo custom se aplica a subs cuyo
   `user_role.toUpperCase() === 'CATERING'` (`notify-push/index.ts:191`, `push-utils.ts:238`).
3. **Enforcement de piso** — Admin/Admisión quedan exentos del 403 de piso por diseño (no filtran).

Todo lo demás (qué módulos ve, qué botones, qué push recibe) es **100 % data en `public.roles`**.

---

## Referencias de código

- Catálogo: `types.ts:354-386` (`PERMISSIONS`, `ROLE_MODULES`), `types.ts:250-294` (`MEAL_SLOTS` + permisos por turno).
- Gating client: `lib/permissions.ts`.
- Roles (CRUD + cache): `api/roles.ts`, `api/role-cache.ts`, `api/me.ts`.
- Auth + hidratación: `api/auth.ts`, `api/jwt.ts` (⚠️ el header dice "8h" pero `EXPIRY_DEFAULT='3650d'` ≈ 10 años — manda el código).
- Push traslados: `supabase/functions/notify-push/index.ts`. Push dieta/ayuno/limpieza: `api/push-utils.ts`.
- Enforcement de piso: `api/tickets.ts` (PATCH, `HOSTESS_ACTION_ENDPOINT`, `effectiveAreaNames`).
- Ubicación: `api/validate-location.ts`. ABM: `views/RoleManagementView.tsx`, `views/UserManagementView.tsx`.
