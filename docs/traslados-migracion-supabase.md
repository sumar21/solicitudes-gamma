# Traslados — Documentación del subsistema (referencia para migrar a Supabase)

> **Propósito.** Documentar de punta a punta todo lo que involucra los **traslados** (creación, detalle,
> histórico y notificaciones) para poder migrar esta parte de **SharePoint + Vercel serverless** a
> **Supabase (Postgres + Realtime)**. El motivo del cambio es de **costo**: el *polling* del frontend contra
> SharePoint es el rubro que más consume en Vercel (ver §7).
>
> Todas las referencias son `archivo:línea` sobre el estado actual del código (rama `develop`).
>
> ⚠️ **Los docs viejos están desactualizados.** `docs/arquitectura.md:162` y `docs/decisiones.md:1320`
> todavía dicen "poll cada 8s con `?all=1`". El código real pollea **cada 15s SIN `?all=1`**. La verdad
> está en los comentarios del código, no en esos docs. Este documento refleja el código real.

---

## 0. Índice

1. [Modelo de datos — listas SharePoint → tablas Supabase](#1-modelo-de-datos)
2. [Máquina de estados (ciclo de vida del ticket)](#2-máquina-de-estados)
3. [Creación de un traslado](#3-creación)
4. [Detalle y acciones (los handlers de transición)](#4-detalle-y-acciones)
5. [Histórico](#5-histórico)
6. [Superficie de API + Polling](#6-superficie-de-api--polling)
7. [El costo — por qué migrar](#7-el-costo)
8. [Notificaciones](#8-notificaciones)
9. [Interacción con el mapa de camas (`mergeBeds`)](#9-interacción-con-el-mapa-de-camas)
10. [Plan de migración a Supabase](#10-plan-de-migración-a-supabase)
11. [Deuda técnica y trampas detectadas](#11-deuda-técnica-y-trampas)

---

## 1. Modelo de datos

El subsistema de traslados vive en **5 listas de SharePoint**. Todas se particionan por un discriminador
`Entorno` (`PROD` / `TESTING`, default seguro `'TESTING'`) presente en **todos** los `$filter`.

| Lista | LIST_ID (GUID) | Prefijo cols | Endpoint | Rol |
|---|---|---|---|---|
| **07.Traslados** | `c7417674-9084-416d-a955-7024161a3194` | `_T` | `api/tickets.ts` | Estado del ticket (la tabla central) |
| **08.DetalleTraslados** | `bd50c2be-0ec7-45d7-b1f5-abf10546675d` | `_DT` | `api/ticket-events.ts` | Log de eventos (auditoría, append-only) |
| **13.ObservacionesTraslados** | `1c524476-f88f-47c8-ad22-4b3f7f429e46` | `_OBS` | `api/ticket-observations.ts` | Notas de la azafata con snapshot de status |
| **09.PushSubscriptions** | `648fde7b-89d2-40ac-bc4a-63661508b50a` | `_PS` | `api/push-subscribe.ts` | Suscripciones Web Push por dispositivo |
| **10.Notificaciones** | `240f00dd-715b-4c78-9661-3147b7650a0f` | `_N` | `api/notifications.ts` | Historial de notificaciones in-app (campanita) |

> Los permisos de rol viven en una 6ª lista, **99.ABMRoles_Traslados** (`68836bbe-…`, prefijo `_RT`), que
> gobierna qué usuario ve/recibe qué. No es de traslados pero el subsistema la consulta (`api/role-cache.ts`).

### 1.1 `07.Traslados` — la tabla central

Mapeo `Ticket` (TS) ↔ columna SharePoint. Fuente: `ticketToFields` (escritura, `api/tickets.ts:97-136`) y
`spToTicket` (lectura, `api/tickets.ts:56-94`).

| Campo `Ticket` (TS) | Columna SP | Tipo SP | Significado |
|---|---|---|---|
| `id` | `IDUnivocoTraslado_T` | Text | ID de negocio, formato `TSL-<userId>-ddmmyyyyhhmmss` |
| `patientName` | `Paciente_T` | Text | Nombre del paciente |
| `patientCode` | `CodigoPaciente_T` | Text | Código de paciente (Gamma/PROGAL) |
| `origin` | `CamaOrigen_T` | Text | Label de cama origen |
| `originBedCode` | `CodigoCamaO_T` | Text | Código cama origen |
| `originBedStatus` | `StatusCamaO_T` | Text | Estado cama origen |
| `destination` | `CamaDestino_T` | Text | Label de cama destino (`null` posible) |
| `destinationBedCode` | `CodigoCamaD_T` | Text | Código cama destino |
| `destinationBedStatus` | `StatusCamaD_T` | Text | Estado cama destino |
| `workflow` | `TipoTraslado_T` | Text | `WorkflowType` |
| `status` | `Status_T` | Text | `TicketStatus` (ver §2) |
| `financier` | `Financiador_T` | Text | Financiador / obra social |
| `createdAt` | `FechaInicio_T` | DateTime | Fecha de creación |
| `completedAt` | `FechaFin_T` | DateTime | Fecha de cierre (consolidado/cancelado) |
| `createdBy` | `Usuario_T` | Text | Nombre del creador |
| `createdById` | `IDUsuario_T` | **Number** | ID del creador (casteado a número, `:131-133`) |
| `changeReason` | `MotivoCambio_T` | Text | Motivo del traslado (INTERNAL) |
| `rejectionReason` | `MotivoCancelacion_T` | Text | Motivo de cancelación |
| `observations` | `ObservacionesTraslado_T` | Text | Observaciones libres |
| `intervenedByHostess` | `IntervinoAzafata_T` | Text `'SI'`/`'NO'` | Flag: ¿alguna azafata tocó el ticket? |

**Columnas de control que NO están en el mapeo pero importan:**
- `Title` — se fuerza siempre a `'[sumar]'` (`:128`). Columna automática, no es dato.
- `Entorno_T` — **NO** está en `ticketToFields`; se estampa aparte **solo en el POST** (`:329`). Filtra
  prod/testing en la misma lista. Presente en todos los `$filter` (GET, conflicto, idempotencia).

**Campos del modelo que NO se persisten** (derivados al leer): `spItemId` (= `item.id` de SP), `sede`
(hardcode `HPR` al leer, `:68`), `canCancel` (= `IntervinoAzafata_T !== 'SI'`, `:61-63`), `date`
(deriva de `FechaInicio_T`), `isBedClean`/`isReasonValidated` (hardcodes), y varios timestamps de UI
(`bedAssignedAt`, `cleaningDoneAt`, `transportStartedAt`, `receptionConfirmedAt`, `itrSource`) que **no
tienen columna** — viven solo en memoria del cliente.

> **Para Supabase:** el ID de negocio se genera en el **cliente** y SP no impone unicidad. Conviene un
> `UNIQUE (id_univoco, entorno)`. El conflicto de cama destino (§3) se traduce a un *partial unique index*
> `WHERE status NOT IN ('Consolidado','Cancelado')`. `createdById` es numérico; el resto texto/timestamp.

### 1.2 `08.DetalleTraslados` — log de eventos (auditoría)

Append-only. Se escribe con `spLogEvent` (cliente, `useHospitalState.ts:1583-1595`) vía POST
`/api/ticket-events` (non-blocking).

| Columna SP | Valor |
|---|---|
| `Title` | `'[sumar]'` |
| `IDUnivocoTraslado_DT` | `ticketId` (FK a `07.Traslados.IDUnivocoTraslado_T`) |
| `TipoMovimiento_DT` | tipo de evento (ver vocabulario abajo) |
| `FechaMovimiento_DT` | ISO |
| `UsuarioMovimiento_DT` | nombre del usuario |
| `IDUsuarioMovimiento_DT` | id del usuario |

**Vocabulario canónico de `TipoMovimiento_DT`** (uno por acción):
`Solicitud Creada` · `Habitacion Preparada` · `Inicio Traslado` · `Paciente Recibido` ·
`Consolidado Progal` · `Cancelado: <motivo>` · `Modificacion - <campos> - Motivo: <texto>`.

El mapeo `tipo → label/ícono` (auditoría, export, PatientJourney) está centralizado en
`lib/ticketEvents.tsx:17-70` (`EVENT_CONFIG`, `parseModification`, `movementLabel`).

### 1.3 `13.ObservacionesTraslados` — notas con snapshot de status

> ⚠️ El docstring del endpoint dice "09" y hay comentarios que dicen "13"; el **GUID es el de 13**.

| Columna SP | Valor |
|---|---|
| `Title` | `'[sumar]'` |
| `IDUnivocoTraslado_OBS` | ticketId (FK) |
| `StatusDelTicket_OBS` | snapshot del status al escribir la nota |
| `TextoObservacion_OBS` | texto (máx 500) |
| `UsuarioObservacion_OBS` | nombre |
| `IDUsuarioObservacion_OBS` | id (**Número**) |
| `FechaObservacion_OBS` | ISO |
| `Entorno_OBS` | PROD/TESTING |

Cliente: `spLogObservation` (`useHospitalState.ts:1599-1613`) y `handleAddObservation` (`:1617-1629`).

### 1.4 `09.PushSubscriptions` — suscripciones Web Push

| Columna SP | Valor |
|---|---|
| `Endpoint_PS` | endpoint del push service (clave lógica) |
| `Keys_PS` | JSON stringify de `{ p256dh, auth }` |
| `UserId_PS` | id de usuario (string) |
| `UserRole_PS` | nombre del rol |
| `AssignedAreas_PS` | áreas asignadas, unidas por `;` |
| `Sede_PS` | sede (default `'HPR'`) |
| `Entorno_PS` | PROD/TESTING |

**Frescura (heartbeat):** no hay columna dedicada — se usa el `lastModifiedDateTime` de SharePoint.
`STALE_SUB_MS = 36h` (`api/push-utils.ts:69`): una sub no refrescada en >36h se descarta. El heartbeat
(`touchPushSubscription`, `lib/pushSubscription.ts:96-124`) re-postea la sub al montar, al volver a
foreground y cada 6h. `prunePerUser` conserva las 5 filas más frescas por usuario.

> **Para Supabase:** agregar una columna explícita `last_seen_at` en vez de depender del `updated_at` del ORM.

### 1.5 `10.Notificaciones` — historial in-app (campanita)

| Columna SP | Valor |
|---|---|
| `TicketId_N` | ticketId (FK, puede ser `''` para notifs sin ticket) |
| `UserId_N` | id del destinatario (**Número**) |
| `Title_N` | título |
| `Message_N` | cuerpo |
| `Type_N` | `NotificationType` |
| `Status_N` | `'Enviada'` / `'Leida'` |
| `Fecha_N` | ISO |
| `LeidaAt_N` | ISO (cuándo se marcó leída) |
| `Entorno_N` | PROD/TESTING |

**Una fila por usuario por evento** (no por dispositivo): la entrega de push va a todos los endpoints del
usuario, pero la campanita se persiste deduplicada por `userId` (`api/push-utils.ts:361-363`).
**Retención:** `cron-cleanup-notifs` borra por `Fecha_N < now-3d` (`api/cron-cleanup-notifs.ts:29`).

---

## 2. Máquina de estados

`TicketStatus` — `types.ts:433-440`. **El valor string es exactamente lo que se guarda en `Status_T`.**

| Enum | Valor SP (`Status_T`) | Rank | Notas |
|---|---|---|---|
| `WAITING_ROOM` | `'Esperando Habitacion'` | 0 | Recién creado, destino en preparación |
| `IN_TRANSIT` | `'Habitacion Lista'` | 1 | ⚠️ el nombre del enum engaña: significa "habitación lista" |
| `IN_TRANSPORT` | `'En Traslado'` | 2 | La azafata origen inició el traslado |
| `WAITING_CONSOLIDATION` | `'Por Consolidar'` | 3 | La azafata destino recibió al paciente |
| `COMPLETED` | `'Consolidado'` | 4 | Terminal |
| `REJECTED` | `'Cancelado'` | — | Terminal (fuera de rank) |

> ⚠️ **Trampa de naming.** `IN_TRANSIT` = `'Habitacion Lista'` y `WAITING_ROOM` = `'Esperando Habitacion'`.
> El "rank" (`useHospitalState.ts:467-476`) es un guard anti-retroceso: un poll stale que reporta una
> transición hacia atrás no genera notificación espuria. `REJECTED` no entra al rank → cancelar desde
> cualquier estado siempre se notifica.

### Diagrama de transiciones

```
                         crear (destino Disponible)
                        ┌──────────────────────────► IN_TRANSIT ─┐
   (nuevo ticket) ──────┤                                        │ handleStartTransport
                        └──────────► WAITING_ROOM ──────────────►┤ (azafata origen)
                         crear (destino En prep.)  handleRoomReady│
                                                   (azafata dest) ▼
                                                            IN_TRANSPORT
                                                                  │ handleConfirmReception
                                                                  │ (azafata destino)
                                                                  ▼
                                                       WAITING_CONSOLIDATION
                                                                  │ handleConsolidate
                                                                  │ (Admisión/Admin)
                                                                  ▼
                                                             COMPLETED

   Desde cualquier estado activo ──── handleRejectTicket (Admisión/Admin) ────► REJECTED
   handleConfirmReception también acepta saltar directo desde IN_TRANSIT (guard :2143)
   handleEditTicket recalcula WAITING_ROOM ↔ IN_TRANSIT al cambiar el destino (:2320-2322)
```

**Toda la lógica de la máquina de estados vive en el CLIENTE** (`useHospitalState.ts`). El server
(`api/tickets.ts`) **no valida transiciones** — acepta cualquier `Status_T`. Solo valida: piso de azafata
(403), conflicto de cama destino (409) y persiste. → *Al migrar, mover estas validaciones al backend
(RLS / funciones Postgres) es una mejora clave.*

---

## 3. Creación

### Flujo end-to-end

```
NewRequestModal ──onCreate(data)──► App.onNewRequestCreated ──► actions.handleCreateTicket(data)
   └─ hooks/useHospitalState.ts:1947 (wrapper) ──► _createTicket :1976 (optimista)
        └─ spCreate :1497 ──► POST /api/tickets ──► api/tickets.ts:293 (createTicketIdempotent)
             └─ SharePoint 07.Traslados
```

### El modal (`components/modals/NewRequestModal.tsx`)

Campos: **Tipo de Escenario** (workflow), **Origen** (cama ocupada), **Paciente** (autocompletado
readonly), **Destino** (disponible/prep), **Motivo** (solo INTERNAL, obligatorio), **Origen ITR/Financiador**
(solo ITR_TO_FLOOR), **Observaciones** (opcional).

**Workflows** (`WorkflowType`, `types.ts:12-24`) — el selector ofrece 3 (ROOM_CHANGE está deprecado):

| Workflow | Label UI | Origen | Destino |
|---|---|---|---|
| `INTERNAL` | Traslado Interno | Cualquier cama **OCUPADA** excepto HRA/HIT | Disponible/Prep excepto HRA/HIT. **Exige motivo** |
| `ITR_TO_FLOOR` | Sala de Espera Admisión | **Solo HRA** (sillones de admisión). Financiador auto desde `bed.institution` | Disponible/Prep |
| `INGRESO_A_ITR` | Ingreso a ITR | **Solo HIT** con `eventOrigin === 'HIN'` | Disponible/Prep |
| `ROOM_CHANGE` | *(deprecado)* | — no se ofrece; los viejos se leen como "Traslado Interno" | — |

**Validaciones client-side:** origin+destination requeridos; INTERNAL exige reason; el botón se deshabilita
si el origen ya tiene un traslado activo. Warnings **no bloqueantes**: conflicto de sexo en la habitación
destino, y origen con traslado activo.

### El endpoint `POST /api/tickets` (`api/tickets.ts:293-353`)

1. Descarta `originAreaName`/`destinationAreaName` del body (solo sirven para filtrar el push, no se persisten).
2. **Conflicto de cama destino → 409** (`:305-326`): busca en SP otro ticket activo (Status ≠
   Consolidado/Cancelado) con la misma `CamaDestino_T`. Si existe → `409 { error, conflictingTicketId }`.
   Fail-open si el chequeo falla.
3. Estampa `Entorno_T` (`:329`).
4. **Creación idempotente** (`createTicketIdempotent`, `:146-199`): el POST no es idempotente (un 503/504
   puede haber commiteado igual). Reintenta 429/503/504 (hasta 3, backoff con `Retry-After`); ante 503/504
   busca por `IDUnivocoTraslado_T` para no duplicar.
5. Push `NEW_TICKET` (non-blocking).
6. Responde **201** `{ spItemId }`.

**Generación del ID** — ocurre en el **cliente**, no en el server (`useHospitalState.ts:1996-1998`):
`TSL-<userId>-ddmmyyyyhhmmss`. SP no impone unicidad sobre esta columna.

### Flujo optimista del cliente (`_createTicket`, `:1976-2064`)

Bloquea duplicados por cama origen activa → valida cama origen OCUPADA y destino DISPONIBLE/PREP → deriva
status inicial (**Disponible → `IN_TRANSIT`**, **En prep. → `WAITING_ROOM`**) → **insert optimista** →
notificación local → POST. Si 409 o falla sin spItemId → **rollback** + alert (arregla el bug de tickets
"fantasma"). Éxito → patchea `spItemId` + `spLogEvent('Solicitud Creada')`.

`writingRef` (`:681`) bloquea los polls durante la escritura y se libera diferido (~1s) para absorber la
latencia read-after-write de SharePoint. Tras crear, hay **dos refetch diferidos** (1s y 4.5s) por el mismo
motivo.

---

## 4. Detalle y acciones

### Patrón común de todos los handlers de transición

`handleRoomReady`, `handleStartTransport`, `handleConfirmReception`, `handleConsolidate`, `handleRejectTicket`:

1. Envueltos en `runTicketAction(ticketId, …)` — lock anti doble-click por ticket (`lib/utils.ts:217-225`).
2. `writingRef.current = true` (bloquea polls).
3. Update optimista (`setTickets`).
4. `addNotification({...})` (in-app local).
5. `persistTicketUpdate(ticket, updates, failMsg)` → PATCH `/api/tickets`; si falla → rollback + alert.
6. Solo si persiste OK → `spLogEvent(...)` (auditoría).
7. `finally` libera `writingRef` diferido (~1s).

`persistTicketUpdate` (`:1551`) pre-siembra el snapshot de notificaciones con la clave optimista para que el
detector no re-emita la transición propia.

### Tabla de acciones

| Handler | Línea | Transición | Campos que escribe | Permiso | Evento (`08`) | Notif |
|---|---|---|---|---|---|---|
| `handleRoomReady` | 2066 | WAITING_ROOM → IN_TRANSIT | `status`, `cleaningDoneAt`, `destinationBedStatus=ASSIGNED`, `intervenedByHostess='SI'` | `confirmar_limpieza` (azafata destino) | `Habitacion Preparada` | STATUS_UPDATE "Habitación Lista" |
| `handleStartTransport` | 2091 | IN_TRANSIT → IN_TRANSPORT | `status`, `transportStartedAt`, `originBedStatus=PREPARATION`, `intervenedByHostess='SI'` | `iniciar_traslado` (azafata origen) | `Inicio Traslado` | STATUS_UPDATE "Traslado en Curso" |
| `handleConfirmReception` | 2140 | IN_TRANSPORT/IN_TRANSIT → WAITING_CONSOLIDATION | `status`, `receptionConfirmedAt`, `destinationBedStatus=OCCUPIED`, `intervenedByHostess='SI'` | `confirmar_recepcion` (azafata destino) | `Paciente Recibido` | RECEPTION_CONFIRMED (único que escucha Catering) |
| `handleConsolidate` | 2166 | WAITING_CONSOLIDATION → COMPLETED | `status`, `completedAt`, `originBedStatus=PREPARATION` | `consolidar` (Admisión/Admin) | `Consolidado Progal` | STATUS_UPDATE "Traslado Finalizado" |
| `handleRejectTicket` | 2199 | activo → REJECTED | `status`, `rejectionReason`, `completedAt` | rol ADMISSION/ADMIN + `cancelar_ticket`, motivo obligatorio | `Cancelado: <motivo>` | STATUS_UPDATE "Traslado Cancelado" |
| `handleEditTicket` | 2244 | recalcula WAITING_ROOM↔IN_TRANSIT si cambia destino | workflow/motivo/financiador/obs/destino + recálculo | `editar_ticket`, bloqueado si `canCancel===false`, motivo obligatorio | `Modificacion - <campos> - Motivo: …` | hasta 3 notifs (cancel destino viejo / nuevo destino / modif origen) |

**Efectos laterales notables:**
- `handleRoomReady` → `logRoomPreparedCleaning`: registra una limpieza que **nace cerrada** (motivo TICKET)
  para dejar constancia en el historial de limpiezas.
- `handleConfirmReception` y `handleConsolidate` → `migratePendingMeals`: PATCH `/api/dietas` action
  `reubicar` para que las **comandas pendientes sigan al paciente** a la cama destino.

**Handlers muertos (legacy, no-op):** `handleAssignBedAction`, `handleValidateTicket`,
`handleHousekeepingAction`, `handleCompleteTransport` (`:2808-2811`). El `AssignBedModal` conecta a un stub
— **la cama destino se elige al crear/editar el ticket, no por ese modal**. Descartable en la migración.

### El endpoint `PATCH /api/tickets` (`api/tickets.ts:356-491`)

1. `spItemId` obligatorio (400 si falta).
2. **Enforcement de piso para azafatas** (`:364-391`): si `intervenedByHostess === 'SI'`, la acción exige
   que la azafata tenga asignada el área correcta (`IN_TRANSIT`→destino, `IN_TRANSPORT`→origen,
   `WAITING_CONSOLIDATION`→destino). Si el rol tiene `filterByFloors` y no matchea → **403**. Admin/Admisión
   exentos. Aplica la regla HRA (remapeo al piso real del otro extremo).
3. Conflicto de cama destino → 409 (si cambia el destino).
4. Escribe solo las keys definidas (`ticketToFields` filtra `undefined` → PATCH parcial seguro).
5. Push por status (non-blocking).

**Lo que NO valida:** transición de estado ni permisos por acción (eso está solo en el cliente).

### La UI de detalle (`views/RequestsView.tsx` — vista Operativa)

- **Filtrado:** excluye COMPLETED/REJECTED. Admin/Admisión ven todos los activos; roles con `filterByFloors`
  (Azafata/Catering) ven solo estados operativos y solo tickets de sus áreas asignadas (con remapeo HRA).
- **Botones por estado**, según el tab "actuar como" (`activeRole`): Azafata ve Habitación Lista / Iniciar
  Traslado / Recepción OK según sea origen o destino; Admisión/Admin ve Consolidar / Editar / Cancelar.
- **Observaciones:** modal con hilo + redactor que hace GET/POST a `/api/ticket-observations` (lista 13).

**Modales:** `EditRequestModal` (edita + motivo obligatorio, prefill una sola vez para no pisar el tipeo),
`RejectionModal` (motivo obligatorio), `AssignBedModal` (**muerto**, conecta a un no-op).

---

## 5. Histórico

- **Fuente:** `historyTickets` = `mergedTickets` recortado por sede/áreas (`useHospitalState.ts:1912-1915`).
  `mergedTickets` (`:1221-1226`) = `allTickets` (histórico completo) **pisado** por `tickets` (el poll vivo,
  gana por `id`) → el histórico no muestra el estado congelado de un traslado que se movió hace segundos.
- **`allTickets` NO se pollea** — se carga bajo demanda con `fetchAllTickets` (`:1191`): al entrar a Monitor
  (HOME) o Historial, y con el botón "Actualizar". Anti-rebote de 30s; `force=true` lo saltea.

### `HistoryView.tsx`

- Dos modos: **Lista** (tabla) y **Trayectoria por paciente** (`PatientJourney`, que fetchea los eventos de
  ESE paciente on-demand).
- Filtros: rango de fechas (default hoy), estado (`all`/`completed`/`cancelled`), búsqueda por
  paciente/id (si matchea, saltea el filtro de fecha para ver la trayectoria completa).
- **Export Excel** (`XLSX`): fetchea eventos de auditoría por ticket vía `GET /api/ticket-events` en lotes de
  10 concurrentes; genera 2 hojas (Tickets + Movimientos). No hay export PDF acá.

### `DashboardView` / Monitor

Recibe `historyTickets` (no el poll vivo) porque calcula KPIs por rango de fechas. `avgWait` = tiempo
promedio de ciclo completo (creación→consolidación) sobre los COMPLETED. Compara período vs período anterior.
Worklists en vivo (`pending`, `inProcess`) usan el estado "ahora".

---

## 6. Superficie de API + Polling

### Endpoints de traslados

| Método | Endpoint | Qué hace |
|---|---|---|
| `GET` | `/api/tickets` | Poll: activos + cerrados de los últimos 30 min (ventana de gracia). ETag/304. |
| `GET` | `/api/tickets?all=1` | Histórico completo del entorno (bajo demanda). |
| `GET` | `/api/tickets?patientCode=X` | Historial de un paciente (on-demand, mapa de camas). |
| `POST` | `/api/tickets` | Crear (idempotente, 409 por conflicto de cama). |
| `PATCH` | `/api/tickets` | Actualizar (enforcement de piso 403, conflicto 409). |
| `GET/POST` | `/api/ticket-events` | Log de auditoría (lista 08). |
| `GET/POST` | `/api/ticket-observations` | Notas de la azafata (lista 13). |
| `GET/PATCH` | `/api/notifications` | Campanita (lista 10). |
| `POST/DELETE` | `/api/push-subscribe` | Alta/baja de suscripción push (lista 09). |

### El `GET /api/tickets` en detalle (`api/tickets.ts:215-290`)

- **3 modos** según query (ver tabla arriba). Todos filtran por `Entorno_T`.
- **Ventana de gracia** (`:240-242`): `CLOSED_GRACE_MS = 30min`; el poll trae activos +
  `FechaFin_T ge <hace 30min>`. **Por qué existe:** si el poll trajera solo activos, un traslado que se cierra
  desaparecería del array entre polls y el detector de cambios (que solo mira tickets presentes) nunca vería
  la transición terminal → se perdería la notificación de finalización. Los 30 min cubren pestañas en
  background (donde el navegador estrangula los timers).
- **Paginación** (`:249-272`): sigue `@odata.nextLink`, `$top=500`, backstop `MAX_SCAN=50_000`.
- **ETag/304** (`:276-289`): hash de `id:status:destination:destinationBedStatus:observations:changeReason:
  workflow:financier:intervenedByHostess`. Incluye campos editables además del status para que una edición
  invalide el cache.
  - 🔑 **El ETag se calcula DESPUÉS de paginar** (`:281`, tras el loop `:258-271`). Consecuencia crítica:
    **el 304 ahorra ancho de banda pero NO ahorra el I/O ni la memoria retenida** — el server SIEMPRE escanea
    SharePoint completo aunque después devuelva 304. Es imposible hashear sin haber leído todo.

### Tabla de polling (por pestaña activa en foreground)

| Poll | Constante | Endpoint | Cadencia | Req/hora | Red |
|---|---|---|---|---|---|
| Tickets | `POLL_TICKETS_MS=15_000` (`:458`) | `GET /api/tickets` | 15s | **240** | sí (la mayoría 304) |
| Camas | `POLL_BEDS_MS=60_000` (`:459`) | `GET /api/beds` | 60s | 60 | sí |
| Limpiezas | `POLL_BEDS_MS` | `GET /api/limpiezas` | 60s | 60 | sí |
| Comandas | `POLL_BEDS_MS` | `GET /api/dietas` | 60s | 60 | sí |
| Sync de rol | — | `GET /api/me` | 60s | 60 | sí |
| Notificaciones | — | `GET /api/notifications` ×2 (banner + historial 24h) | 30s | **240** | sí |
| Revalidación ubicación | `REVALIDATE_MS=60_000` | `POST /api/validate-location` | 60s | 60 | sí |
| Expiración de token | — | *(solo localStorage)* | 60s | 0 | **no** |
| Heartbeat push | — | `touchPushSubscription` | 6h + foreground | ~0 | esporádico |
| **TOTAL** | | | | **≈ 780/hora/pestaña** | |

> `fetchAllTickets` (histórico) NO entra a ningún intervalo — solo se dispara al entrar a Monitor/Historial
> (anti-rebote 30s) y con el botón Actualizar.

---

## 7. El costo

### Por qué el polling contra SharePoint es caro

Vercel factura bajo el modelo **Fluid Compute**: cobra **Provisioned Memory × tiempo** + **Active CPU** +
**Invocations**. El problema es que `GET /api/tickets` pasa la mayor parte de su vida **esperando I/O de red**
(paginando SharePoint/Graph), y durante toda esa espera la instancia **mantiene su memoria reservada** → se
factura GB-Hrs aunque la CPU esté ociosa. Peor: como el **ETag se calcula después de paginar**, ni siquiera
el 304 evita el escaneo completo ni el tiempo de memoria retenida.

### Datos reales (`vercel-costs.csv`, proyecto `solicitudes-gamma`, ~35 días: 16-jun → 21-jul 2026)

| Métrica de facturación | USD | % | Notas |
|---|---:|---:|---|
| **Fluid Provisioned Memory** | **$15.39** | **52%** | 1.452 GB-Hrs — memoria retenida esperando I/O. **El rubro dominante.** |
| Fast Origin Transfer | $6.34 | 21% | transferencia de payloads (mitigado por 304) |
| Fluid Active CPU | $5.49 | 19% | |
| Function Invocations | $2.34 | 8% | ~780 req/h/pestaña |
| otros | $0.10 | — | |
| **TOTAL** | **$29.66** | | ~35 días |

**La memoria Fluid retenida durante I/O es >50% del total.** Confirma la tesis: lo que consume dinero es
tener instancias vivas esperando a SharePoint mientras se pollea.

**Optimizaciones ya aplicadas** (que redujeron pero no eliminaron el costo): (a) poll de 8s→15s
("~halve requests"), (b) sacar `?all=1` del poll dejándolo bajo demanda. Medición del antes/después: el
`?all=1` cada 15s traía **1.143 filas / 779 KB / ~2,9s de instancia viva** por request; la vista activa trae
**~1 KB / ~0,5s**.

> **Ningún cron toca la lista de traslados.** Verificado: `07.Traslados` solo la escribe/lee el frontend vía
> `api/tickets.ts`. El costo de tickets es **100% del polling del front**. → La migración de traslados es
> independiente de los crons de camas/notificaciones.

---

## 8. Notificaciones

Hay **dos canales** que conviven:

1. **Web Push (nativo del SO)** — lo emite EXCLUSIVAMENTE el Service Worker, disparado desde el server.
2. **In-app (toasts + campanita)** — lo genera el cliente detectando cambios en el polling.

### 8.1 Canal Web Push (server → SW)

`sendPushToSubscribers(params)` (`api/push-utils.ts:245-397`):

1. Trae suscripciones frescas de `09.PushSubscriptions` (filtradas por entorno, staleness 36h).
2. **Filtra suscriptores** (`isRelevant`, `:199-234`): excluye al que disparó la acción; match de sede
   (`SUMAR` = multi-sede); exige que el rol tenga el **permiso del tipo de notif**; si el rol tiene
   `filterByFloors`, exige match de áreas asignadas (con regla HRA).
3. **Deduplica** por evento lógico (`ticketId:type:hash(title+body)`, TTL 60s in-memory) y por endpoint.
4. Envía con `web-push` (VAPID) `{ urgency:'high', TTL:3600 }`. Sub expirada (404/410) → se borra.
5. **Persiste en `10.Notificaciones`** (una fila por usuario, para la campanita).

**El Service Worker** (`src-sw/sw.ts`): handler `push` → `showNotification` con
`requireInteraction:false` (crítico para heads-up en Android), acción "Ver". Handler `notificationclick` →
`focus()` + postMessage, o `openWindow('/?notifTicketId=X&notifType=Y')`. El cliente lo recibe y marca la
notif leída.

### 8.2 Canal in-app (detección por polling)

`useEffect` sobre `[tickets]` (`useHospitalState.ts:1323-1489`): compara cada ticket contra un snapshot
previo (`prevTicketSnapshotRef`, clave `status|destination`). Genera:
- **Nuevo ticket** (no estaba) → `NEW_TICKET` (skip si el creador soy yo).
- **Cambio de status** → `STATUS_UPDATE` con `statusChangeLabel` (guard anti-retroceso).
- **Cambio de destino** → hasta 3 notifs (cancel destino viejo / nuevo destino / modif origen).

Suprime notifs en la primera carga y los primeros 15s. Toasts solo para las relevantes (permiso + áreas),
máx 5, sonido con cooldown. **Esta es la red de seguridad** que hace necesaria la ventana de gracia de 30 min
(§6): si el web-push falla, el polling igual detecta la transición terminal.

### 8.3 Tipos de notificación y permisos

| `NotificationType` | Permiso (`_RT`) | ¿Disparado por traslados? |
|---|---|---|
| `NEW_TICKET` | `notif_new_ticket` | ✅ POST /api/tickets |
| `STATUS_UPDATE` | `notif_status_update` | ✅ PATCH /api/tickets |
| `RECEPTION_CONFIRMED` | `notif_reception_confirmed` | ✅ único que escucha Catering |
| `ROOM_CLEANED` | `notif_habitacion_limpia` | ❌ limpiezas |
| `DIET_CHANGE` | `notif_diet_change` | ❌ cron enrich |
| `FASTING_CHANGE` | `notif_fasting_change` | ❌ cron enrich |

`NOTIF_TYPE_TO_PERMISSION` está **duplicado a propósito** en `lib/permissions.ts:29-36` (cliente) y
`api/push-utils.ts:183-190` (server).

---

## 9. Interacción con el mapa de camas

Importante para no romper el mapa al migrar: **el estado del ticket pinta las camas origen/destino** vía
`mergeBeds` (`useHospitalState.ts:270-455`). Cada poll reconstruye las camas desde Gamma y superpone el
overlay del ticket:

| Status | Cama origen | Cama destino |
|---|---|---|
| `WAITING_ROOM` | paciente sigue ahí (`keepPatientOnOrigin`) | `PREPARATION` |
| `IN_TRANSIT` | paciente sigue ahí | `ASSIGNED` |
| `IN_TRANSPORT` | se copia el paciente al destino, luego se **vacía** el origen → `PREPARATION` | `ASSIGNED` con paciente |
| `WAITING_CONSOLIDATION` | si PROGAL aún lo tiene, se copia y se vacía el origen; si no, se respeta PROGAL | `OCCUPIED` |
| `COMPLETED` / `REJECTED` | *(fuera del switch)* — la cama vuelve a su estado crudo de Gamma | idem |

Recorrido de la cama destino: `PREPARATION → ASSIGNED → ASSIGNED(con paciente) → OCCUPIED`. La cama origen:
ocupada hasta IN_TRANSPORT, ahí se vacía a `PREPARATION`.

> **Para Supabase:** este overlay es puramente de presentación (cliente). No cambia con la migración *siempre
> que* el cliente siga recibiendo el estado de los tickets activos — solo cambia **cómo** los recibe
> (Realtime en vez de poll).

---

## 10. Plan de migración a Supabase

### Esquema propuesto (Postgres)

```
traslados            -- 07.Traslados. PK id (uuid), UNIQUE(id_univoco, entorno).
                     -- partial unique index sobre cama_destino WHERE status NOT IN ('Consolidado','Cancelado')
traslado_eventos     -- 08.DetalleTraslados. append-only, FK traslado_id, index (traslado_id, fecha)
traslado_obs         -- 13.ObservacionesTraslados. FK traslado_id
push_subscriptions   -- 09. columna explícita last_seen_at (heartbeat), index (user_id, entorno)
notificaciones       -- 10. index (user_id, entorno, status, fecha)
```

Reemplazar la columna `Entorno` por **schemas separados** (`prod` / `testing`) o mantenerla como columna con
RLS por entorno.

### El cambio que mata el costo: **polling → Realtime**

- `GET /api/tickets` (poll de 15s) → **Supabase Realtime subscription** sobre la tabla `traslados`. Esto
  elimina las ~240 invocaciones/h/pestaña **y** la memoria retenida esperando I/O — que es el >50% de la
  factura. Es el objetivo central de la migración.
- La **ventana de gracia de 30 min** deja de ser necesaria: con push/realtime el cliente ve la transición
  terminal en el evento, no hay que "retener" el cerrado en el payload.
- El **ETag/304** deja de tener sentido: Realtime transmite deltas, no snapshots completos.
- `?all=1` y `?patientCode=X` → queries Postgres directas con índices (sin paginación `@odata.nextLink` ni
  `MAX_SCAN`).

### Qué mover al backend (hoy vive en el cliente)

- **Validación de transiciones de estado** (hoy 100% cliente) → funciones Postgres / RLS. El server actual
  no valida transiciones.
- **Permisos por acción** (hoy solo cliente, excepto el enforcement de piso 403) → RLS por rol.
- **Idempotencia de creación** (hoy `createTicketIdempotent` con retries 429/503/504) → innecesaria con
  writes transaccionales de Postgres. Se simplifican `spCreate` + los dobles refetch a 1s/4.5s.

### Notificaciones

- El **canal in-app por polling** se reemplaza por Realtime (el cliente reacciona al evento en vez de
  comparar snapshots). Elimina `prevTicketSnapshotRef` / `statusChangeLabel` / la ventana de gracia.
- El **Web Push** (VAPID + SW) puede quedarse igual, disparado desde una **Supabase Edge Function** en el
  trigger de cambio de estado, en vez de desde `api/tickets.ts`. Migrar la dedup in-memory
  (`push-dedupe.ts`, per-lambda) a un store compartido.
- La **frescura de subs** necesita columna `last_seen_at` explícita (hoy depende del `lastModifiedDateTime`
  de SharePoint).

### Orden sugerido (incremental, sin big-bang)

1. Crear las tablas en Supabase + backfill desde SharePoint.
2. **Doble escritura** temporal (escribir a SP y a Supabase) para no perder datos durante la transición.
3. Migrar el **poll de tickets a Realtime** (el mayor ahorro). Medir la caída de Provisioned Memory en Vercel.
4. Migrar creación/edición/acciones a Supabase (con validaciones server-side).
5. Migrar notificaciones (in-app a Realtime, push a Edge Function).
6. Migrar histórico (`?all=1`, `?patientCode=X`) a queries directas.
7. Cortar la doble escritura y retirar `api/tickets.ts` + las listas SP.

---

## 11. Deuda técnica y trampas

- **Naming de estados:** `IN_TRANSIT` = `'Habitacion Lista'`, `WAITING_ROOM` = `'Esperando Habitacion'`.
  Fuente constante de confusión.
- **Docs viejos mienten:** `docs/arquitectura.md:162` y `docs/decisiones.md:1320` dicen "8s con `?all=1`";
  el código real es 15s sin `?all=1`.
- **Lista 13 mal documentada:** el endpoint `api/ticket-observations.ts` tiene docstring "09" pero el GUID
  es el de `13.ObservacionesTraslados`.
- **Handlers muertos:** `handleAssignBedAction` y cía. son no-ops; `AssignBedModal` no escribe nada.
- **`cron-diet-changes.ts` legacy:** tiene `maxDuration` colgado en `vercel.json` pero **no está en el array
  `crons`** — su lógica la absorbió `cron-enrich-beds.ts`. No toca traslados.
- **El ETag no ahorra I/O:** se calcula después de paginar, así que el 304 ahorra bytes pero no el costo real
  (memoria retenida durante el escaneo). Es la razón de fondo del gasto.
- **Toda la máquina de estados y los permisos por acción viven en el cliente** — la migración es la
  oportunidad de moverlos al backend.

---

*Generado a partir de un relevamiento del código en la rama `develop` (jul-2026). Las referencias
`archivo:línea` pueden correrse con cambios posteriores; el diseño y los nombres de columnas/estados son
estables.*
