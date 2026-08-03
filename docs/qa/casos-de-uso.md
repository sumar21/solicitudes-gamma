# Casos de Uso por Rol — MediFlow

> **Para qué sirve este documento.** Es el mapa central de QA: describe, rol por rol y paso a paso,
> **qué hace cada usuario, qué debería pasar y qué resultado verificar**. Cada caso está pensado para
> ejecutarse como prueba manual (o con una herramienta tipo sprite). Si la app se comporta distinto a lo
> que dice acá, es un bug (o este doc quedó viejo — avisar).
>
> Fuente de verdad = el código actual (post-migración SharePoint → Supabase). Cuando la doc general
> (`docs/arquitectura.md`, `decisiones.md`) contradice esto, gana el código. Ver también:
> `docs/troubleshooting.md` (síntoma → causa) y `docs/cutover-supabase-main.md` (qué migró y qué no).

---

## Cómo leer un caso de uso

Cada caso sigue este formato:

- **ID** — código estable para referenciarlo en QA (ej. `CU-ADM-01`).
- **Actor** — el rol que ejecuta.
- **Objetivo** — qué quiere lograr.
- **Precondiciones** — qué tiene que ser cierto antes de empezar.
- **Pasos** — numerados, en la UI real.
- **Resultado esperado** — qué verificar (estado, mapa, notificación, evento).
- **Permiso / gating** — el permiso de `types.ts` que habilita la acción y el enforcement server-side si lo hay.
- **Archivo** — dónde vive la lógica, por si hay que depurar.

### Glosario rápido

| Concepto | Qué es |
|---|---|
| **Traslado / Ticket** | Movimiento de un paciente de una cama origen (ocupada) a una cama destino. Vive en `public.traslados` (Supabase). |
| **Azafata (HOSTESS)** | Rol operativo que ejecuta los pasos físicos del traslado y marca camas limpias. Suele tener `filter_by_floors` (solo ve sus pisos). |
| **Estado del ticket** | `Esperando Habitacion` → `Habitacion Lista` → `En Traslado` → `Por Consolidar` → `Consolidado`; rama `Cancelado`. |
| **`intervino_azafata`** | Columna del ticket. `'NO'` al crear; pasa a `'SI'` en la primera acción de azafata. Bloquea la **edición** (no la cancelación). |
| **Entorno** | `TESTING` / `PRODUCTIVO`. Mismo proyecto Supabase, aislados por columna `entorno` + RLS. |
| **Comanda** | Una bandeja de comida (titular o acompañante) que carga Nutrición por cama/turno. Vive en `public.comandas`. |
| **Overlay "Opción B"** | La app pinta el mapa de camas por encima de PROGAL (read-only): una cama marcada limpia se ve "Disponible" aunque PROGAL diga otra cosa. |

### Máquina de estados del traslado (referencia)

| Estado (enum) | Value persistido | Qué significa | Quién lo dispara |
|---|---|---|---|
| `WAITING_ROOM` | `Esperando Habitacion` | Cama destino en preparación, esperando confirmación de limpieza. **No dispara push.** | Admisión (al crear, si destino estaba EN PREPARACIÓN) |
| `IN_TRANSIT` | `Habitacion Lista` | Habitación lista, esperando inicio del traslado. | Azafata de **destino** (o al crear si destino estaba DISPONIBLE — salta limpieza) |
| `IN_TRANSPORT` | `En Traslado` | Paciente en camino. | Azafata de **origen** |
| `WAITING_CONSOLIDATION` | `Por Consolidar` | Paciente recibido, falta reflejarlo en PROGAL. | Azafata de **destino** |
| `COMPLETED` | `Consolidado` | Terminal. Reflejado en PROGAL. | Admisión / Admin |
| `REJECTED` | `Cancelado` | Terminal. Cancelado con motivo. | Admisión / Admin |

---

## 1. Rol ADMISIÓN — Crear y gestionar traslados

Módulo **Operativa** (solapa *traslados*). Permisos típicos: `crear_ticket`, `editar_ticket`,
`cancelar_ticket`, `consolidar`, y notificaciones. Admisión **no** tiene `filter_by_floors` (ve todo).
Lógica en `hooks/useHospitalState.ts`, UI en `views/RequestsView.tsx` y `components/modals/`.

### CU-ADM-01 — Crear un traslado interno

- **Actor:** Admisión
- **Objetivo:** mover un paciente de una cama a otra dentro del hospital.
- **Precondiciones:** rol con `crear_ticket`; cama origen **Ocupada**; cama destino **Disponible** o **En preparación**.
- **Pasos:**
  1. Operativa → botón **Nueva Solicitud** (abre `NewRequestModal`).
  2. Elegir workflow **Traslado Interno** (`INTERNAL`).
  3. Elegir **cama origen** (debe estar Ocupada). El **nombre del paciente se autocompleta** desde la cama origen.
  4. Elegir **cama destino** (Disponible o En preparación).
  5. Escribir el **motivo** (obligatorio en Traslado Interno).
  6. Confirmar.
- **Resultado esperado:**
  - Si la cama destino estaba **Disponible** → el ticket arranca en **`Habitacion Lista`** (`IN_TRANSIT`, **salta el paso de limpieza**).
  - Si estaba **En preparación** → arranca en **`Esperando Habitacion`** (`WAITING_ROOM`).
  - Se registra el evento **`Solicitud Creada`** en la trayectoria; `intervino_azafata='NO'` (aún editable/cancelable).
  - Las azafatas del piso destino con `notif_new_ticket` reciben push **"Nueva Solicitud de Traslado"** (el creador **no** se autonotifica).
  - En el mapa, la cama destino refleja el overlay del ticket.
- **Permiso / gating:** `crear_ticket`. POST `/api/tickets` (upsert idempotente por `id_univoco,entorno`).
- **Archivo:** `handleCreateTicket` → `_createTicket` en `hooks/useHospitalState.ts`; `api/tickets.ts`.

### CU-ADM-02 — Crear traslado desde Sala de Espera de Admisión (HRA)

- **Actor:** Admisión
- **Objetivo:** mover a un paciente que está en los sillones de Admisión (HRA) hacia un piso.
- **Precondiciones:** cama/sillón **origen en HRA**; cama destino Disponible o En preparación.
- **Pasos:**
  1. Nueva Solicitud → workflow **Sala de Espera Admisión** (`ITR_TO_FLOOR`).
  2. El origen queda restringido a **HRA / sillones**.
  3. Elegir destino; completar el **financiador ITR** (en vez del motivo libre).
  4. Confirmar.
- **Resultado esperado:** ticket creado igual que CU-ADM-01 (estado según cama destino). Regla especial:
  cuando un extremo es HRA, el enforcement de piso se remapea al piso real del **otro** extremo (ver CU-AZA-07).
- **Permiso / gating:** `crear_ticket`.
- **Archivo:** `NewRequestModal.tsx`; `_createTicket`.

### CU-ADM-03 — Crear ingreso a ITR

- **Actor:** Admisión
- **Objetivo:** registrar un traslado que sale de Internación Transitoria (HIT).
- **Precondiciones:** cama origen entre las **8 camas de HIT**.
- **Pasos:** Nueva Solicitud → workflow **Ingreso a ITR** (`INGRESO_A_ITR`) → origen restringido a HIT → destino → confirmar.
- **Resultado esperado:** ticket creado (estado según cama destino).
- **Permiso / gating:** `crear_ticket`.

### CU-ADM-04 — Consolidar un traslado en PROGAL

- **Actor:** Admisión / Admin
- **Objetivo:** marcar que el traslado ya se reflejó manualmente en PROGAL (MediFlow **no** escribe PROGAL).
- **Precondiciones:** ticket en **`Por Consolidar`** (`WAITING_CONSOLIDATION`).
- **Pasos:**
  1. Operativa (tab Admin/Admisión) → sobre el ticket "Por Consolidar" aparece el botón violeta **Consolidar PROGAL**.
  2. Tocarlo.
- **Resultado esperado:**
  - status → **`Consolidado`** (`COMPLETED`, terminal); se setea `completedAt`.
  - Cama origen → **En preparación**; evento **`Consolidado Progal`**.
  - Se re-disparan las comandas pendientes a la cama destino (red idempotente, `migratePendingMeals`).
  - Refresca el mapa; push **"Traslado Finalizado"** (`STATUS_UPDATE`).
- **Permiso / gating:** `consolidar`.
- **Archivo:** `handleConsolidate` en `hooks/useHospitalState.ts`.

### CU-ADM-05 — Cancelar un traslado

- **Actor:** Admisión / Admin (**doble check hardcodeado**: solo estos roles, `useHospitalState.ts:2304`)
- **Objetivo:** anular un traslado en cualquier etapa activa.
- **Precondiciones:** ticket activo (no terminal). Se puede cancelar **aunque la azafata ya haya intervenido**.
- **Pasos:**
  1. Sobre el ticket → botón rojo **Cancelar** (abre `RejectionModal`).
  2. Escribir el **motivo** (obligatorio).
  3. Confirmar.
- **Resultado esperado:**
  - status → **`Cancelado`** (`REJECTED`, terminal); guarda `motivo_cancelacion` y `completedAt`.
  - Evento **`Cancelado: {motivo}`**; push **"Traslado Cancelado"** (`STATUS_UPDATE`).
  - Si el motivo está vacío → **alert** y **no** persiste.
- **Permiso / gating:** `cancelar_ticket` **+** rol `ADMISSION | ADMIN` (hardcodeado). Sin permiso → alert.
- **Archivo:** `handleRejectTicket`; `RejectionModal.tsx`.

### CU-ADM-06 — Editar un traslado (antes de que actúe la azafata)

- **Actor:** Admisión / Admin
- **Objetivo:** corregir workflow, cama destino, motivo/financiador u observaciones.
- **Precondiciones:** `intervino_azafata='NO'` (la azafata **aún no** tocó nada; `canCancel !== false`).
- **Pasos:**
  1. Botón ámbar **Editar** (abre `EditRequestModal`).
  2. Cambiar lo que corresponda (workflow / cama destino / motivo `INTERNAL` / financiador `ITR_TO_FLOOR` / observaciones).
  3. Escribir el **motivo de modificación** (obligatorio) → guardar.
- **Resultado esperado:**
  - Si cambia la cama destino, se **revalida** que siga Disponible/En preparación y se **recalcula** el estado (`IN_TRANSIT` vs `WAITING_ROOM`). Si otro admin ya tomó esa cama → **409** con rollback + alert.
  - Un cambio de destino **entre áreas** emite 3 notificaciones: cancelación al área vieja, nueva solicitud al área nueva, modificación al origen.
  - Se registra **un único** evento `Modificacion - {cambios} - Motivo: {motivo}`. La cama vieja se libera implícitamente (`mergeBeds` recomputa el mapa).
  - Si `intervino_azafata='SI'` → **bloqueado** (alert "la azafata ya intervino"). Para eso está Cancelar.
- **Permiso / gating:** `editar_ticket`.
- **Archivo:** `handleEditTicket`; `EditRequestModal.tsx`.

### CU-ADM-07 — Cargar una observación en un ticket activo

- **Actor:** Admisión / Azafata (mientras el ticket esté activo)
- **Objetivo:** dejar una nota ligada al estado actual del ticket.
- **Pasos:** en el ticket activo → cargar observación → se guarda (POST `/api/ticket-observations`), snapshoteando el status del momento.
- **Resultado esperado:** la observación queda en `traslado_obs`. La **azafata deja de poder cargar** al llegar a `Por Consolidar`; Admisión/Admin sí pueden seguir. Sobre tickets ya cerrados se anota desde **Historial → Auditar**, no desde Operativa.
- **Archivo:** `handleAddObservation`; `api/ticket-observations.ts`.

---

## 2. Rol AZAFATA (HOSTESS) — Ejecutar el traslado por piso y marcar limpieza

Rol operativo con `filter_by_floors=Sí`: **solo ve y actúa** sobre traslados/camas de sus **Sectores
Asignados** (`assignedAreas`). Botones en Operativa (tab "actuando como HOSTESS") y en el Mapa de Camas.
Enforcement de piso también **server-side** en `api/tickets.ts` (403 si actúa fuera de sus pisos).

> **Regla de oro del piso:** cada paso lo dispara la azafata de un extremo específico. Si el botón no
> aparece, casi siempre es porque el traslado no pertenece a los pisos asignados de esa azafata.

### CU-AZA-01 — Confirmar habitación lista (azafata de DESTINO)

- **Actor:** Azafata cuyo piso asignado = área de la **cama destino**
- **Objetivo:** confirmar que la habitación destino quedó limpia y lista.
- **Precondiciones:** ticket en **`Esperando Habitacion`** (`WAITING_ROOM`).
- **Pasos:** Operativa → en el ticket "Esperando Habitacion" aparece el botón azul **Habitación Lista** → tocarlo.
- **Resultado esperado:**
  - status → **`Habitacion Lista`** (`IN_TRANSIT`); cama destino → **Asignada**; `intervino_azafata='SI'` (desde acá **ya no se puede editar**).
  - Evento **`Habitacion Preparada`** + constancia en el histórico de limpiezas (nace **cerrada**, motivo TICKET → se ve como "Traslado").
  - Push **"Habitación Lista"** (`STATUS_UPDATE`). La azafata de **origen** ve el badge "Esperando inicio de traslado".
- **Permiso / gating:** `confirmar_limpieza`; server exige que el **piso destino** esté en sus áreas → si no, **403**.
- **Archivo:** `handleRoomReady`; `logRoomPreparedCleaning`.

### CU-AZA-02 — Iniciar el traslado físico (azafata de ORIGEN)

- **Actor:** Azafata del piso **origen**
- **Objetivo:** empezar a mover al paciente.
- **Precondiciones:** ticket en **`Habitacion Lista`** (`IN_TRANSIT`).
- **Pasos:** en el ticket "Habitacion Lista" aparece el botón verde **Iniciar Traslado** → tocarlo.
- **Resultado esperado:**
  - status → **`En Traslado`** (`IN_TRANSPORT`); cama origen → **En preparación** (el paciente sale de origen); `intervino_azafata='SI'`.
  - Evento **`Inicio Traslado`**; push **"Traslado en Curso"** (`STATUS_UPDATE`). La azafata de destino ve el badge "Esperando inicio de traslado".
- **Permiso / gating:** `iniciar_traslado`; server exige **piso origen** → si no, **403**.
- **Archivo:** `handleStartTransport`.

### CU-AZA-03 — Confirmar recepción del paciente (azafata de DESTINO)

- **Actor:** Azafata del piso **destino**
- **Objetivo:** confirmar que el paciente llegó a la cama destino.
- **Precondiciones:** ticket en **`En Traslado`** (`IN_TRANSPORT`).
- **Pasos:** en el ticket aparece el botón verde **Recepción OK** → tocarlo.
- **Resultado esperado:**
  - status → **`Por Consolidar`** (`WAITING_CONSOLIDATION`); cama destino → **Ocupada**.
  - Evento **`Paciente Recibido`**. Se disparan las **comandas pendientes** a mudarse con el paciente (`migratePendingMeals` → PATCH `/api/dietas action:reubicar`).
  - Push **"Recepción Confirmada"** (`RECEPTION_CONFIRMED`). **Catering** recibe un texto custom: *"Traslado concretado — {paciente} pasó de Habitación X (Piso) a Habitación Y (Piso)"*.
  - Desde acá la azafata **ya no carga observaciones** (su parte operativa terminó).
- **Permiso / gating:** `confirmar_recepcion`; server exige **piso destino** → si no, **403**.
- **Archivo:** `handleConfirmReception`.

### CU-AZA-04 — Marcar una habitación limpia desde el Mapa de Camas

- **Actor:** Azafata con la cama en sus áreas asignadas
- **Objetivo:** marcar una cama "En preparación" como limpia (overlay "Opción B").
- **Precondiciones:** la cama está **En preparación** (estado mergeado) y **no** la está usando un ticket activo.
- **Pasos:**
  1. Mapa de Camas → abrir el detalle de una cama "En preparación" de un sector asignado.
  2. Arriba del modal aparece el botón verde **Marcar habitación limpia** (ícono SprayCan) → tocarlo.
- **Resultado esperado:**
  - **Optimista:** la cama pasa a **Disponible** con chip **"Limpia ✓"** al instante y se cierra el modal.
  - POST `/api/limpiezas` (upsert por cama+entorno, `version=APP_VERSION`) → push **ROOM_CLEANED "Habitación Limpia"** a los roles con `notif_habitacion_limpia` del mismo piso (excluye a quien la marcó — típicamente llega a Admisión).
  - Si el POST falla → **rollback** (la cama vuelve a "En preparación").
- **Permiso / gating:** `confirmar_limpieza` + chequeo de área (`!filterByFloors || assignedAreas.includes(bed.area)`).
- **Archivo:** `markBedClean`; `api/limpiezas.ts`; push por `api/push-utils.ts` (NO la Edge Function).

### CU-AZA-05 — Deshacer una limpieza

- **Actor:** Azafata
- **Objetivo:** revertir una marca de limpieza propia.
- **Precondiciones:** la cama está marcada **"Limpia ✓"** y en sus áreas.
- **Pasos:** reabrir la cama → botón **Deshacer** → tocarlo.
- **Resultado esperado:** el overlay se quita (optimista) y PATCH `/api/limpiezas` cierra la fila con motivo **ANULADA** (status → Inactivo).
- **Permiso / gating:** `confirmar_limpieza` + área.
- **Archivo:** `undoBedClean`.

### CU-AZA-06 — Intento de marcar limpia una cama reservada por un traslado

- **Actor:** Azafata
- **Objetivo (negativo):** confirmar que **no** se puede marcar limpia una cama que es destino de un traslado en curso.
- **Pasos:** abrir una cama "En preparación" que es **destino** de un traslado activo.
- **Resultado esperado:** en vez del botón "Marcar limpia" aparece un **panel índigo**: *"Reservada por un traslado en curso (paciente X). La limpieza previa al ingreso se confirma con Habitación Lista desde Operativa"*. La marca no aplica (el auto-cierre la anularía con motivo TICKET).
- **Archivo:** `BedsView.tsx`; gate `bedsInUseByTickets` en `useHospitalState.ts`.

### CU-AZA-07 (borde) — Enforcement de piso: acción fuera de los sectores asignados

- **Actor:** Azafata (ej. Piso 5) intentando actuar sobre un traslado de otro piso (ej. Piso 6).
- **Objetivo (negativo/seguridad):** verificar que el servidor rechaza aunque la UI lo permitiera.
- **Resultado esperado:** PATCH `/api/tickets` devuelve **403** "No autorizado: el traslado no pertenece a tus pisos asignados". Regla HRA: si el extremo requerido es la Sala de Espera (Recepción Admisión), se remapea al **piso real del otro extremo** (`effectiveAreaNames`). Roles con **≥9 de 10 áreas** = full access (bypass del filtro).
- **Archivo:** `api/tickets.ts` (PATCH).

---

## 3. Roles ENFERMERÍA / CATERING — Ver el mapa de camas (solo lectura)

Roles de **solo lectura del mapa** (`READ_ONLY`, `NURSING`, `CATERING`). Su vista por defecto es
**Mapa de Camas** (la app los redirige ahí porque no ven Operativa/Home). No ven botones de acción de
traslado ni "Marcar limpia". Catering además recibe push `DIET_CHANGE` / `FASTING_CHANGE` /
`RECEPTION_CONFIRMED` (texto custom). Lógica en `views/BedsView.tsx`.

> El **mapa de camas sigue en SharePoint/Gamma** (no migró a Supabase): `GET /api/beds` con **poll cada
> 60s** (es el único dominio que aún usa poll). El enrich (DNI/edad/dieta/ayunos/aislamientos) lo
> precomputa el cron `cron-enrich-beds` en `12.EnrichCamas`.

### CU-VER-01 — Consultar la grilla de camas y filtrar

- **Actor:** Enfermería / Catering
- **Objetivo:** ver el estado de las camas por sector.
- **Pasos:**
  1. Entrar (landing = Mapa de Camas).
  2. Ver la grilla coloreada: **verde**=Disponible, **rojo**=Ocupada, **ámbar**=En preparación, **índigo**=Asignada, **gris**=Inhabilitada.
  3. Filtrar con el **buscador** (paciente/evento/financiador/médico/habitación), el **multiselect de sectores**, los **chips de estado**, y los toggles **Aislamiento / Dietas / Ayunos**.
- **Resultado esperado:** la grilla respeta todos los filtros. El **techo por área** se aplica antes que cualquier filtro UI: un rol de piso nunca ve camas de otro piso aunque manipule los filtros. El badge de conteo **excluye HRA** (sillones, no camas).
- **Archivo:** `BedsView.tsx` (`getStatusColor`, `filteredBeds`).

### CU-VER-02 — Abrir el detalle de un paciente

- **Actor:** Enfermería / Catering / Azafata / Admisión
- **Objetivo:** ver la ficha del paciente de una cama ocupada.
- **Pasos:** click en una cama roja (Ocupada) → se abre el modal con 4 tabs.
- **Resultado esperado:** se ven **cuatro** tabs:
  - **Generales** — DNI/edad/sexo/diagnóstico/financiador+plan/médico.
  - **Internación** — tipo de ingreso, fecha de admisión y días de estadía vs autorizados, fecha probable de cirugía.
  - **Dieta** — chips Condiciones/Tipo + formulario + sección Menú (comandas de Nutrición).
  - **Ayunos** — ocurrencias vigentes por indicación, en hora Argentina.
  - Los **aislamientos** se muestran **solo lectura** (fuente PROGAL). Botón "Historial del paciente" hace fetch on-demand de sus traslados.
- **Archivo:** `BedsView.tsx`; `lib/fasting.ts`.

### CU-VER-03 (borde) — Bloqueo visual por aislamiento

- **Actor:** cualquiera que mire el mapa
- **Objetivo:** entender por qué una cama libre aparece bloqueada.
- **Resultado esperado:** un paciente con aislamiento **"duro"** (no preventivo) **bloquea** las camas libres (Disponible/En preparación) de **su habitación** → celda violeta opacity-60 con "X". **"Contacto preventivo" NO bloquea**: solo señaliza las camas contiguas en **cyan**. Exento en áreas críticas **HUC/HUT/HIT/HRA**. En camas libres, un chip outline sugiere el **sexo** según el resto de ocupantes (sugerencia, no restricción).
- **Archivo:** `computeIsolationBlocks` en `BedsView.tsx`.

### CU-VER-04 — Exportar PDFs del mapa

- **Actor:** Enfermería / Catering / Admisión
- **Objetivo:** imprimir el estado de camas.
- **Pasos:** desde el header del Mapa → generar PDF (por sector / alfabético A-Z / dietas / ayunos).
- **Resultado esperado:** todos los PDFs llevan zócalo de totales (**Ocupadas = Ocupada + Asignada**; "En preparación" queda fuera de los %).

---

## 4. Rol NUTRICIÓN — Comandas, acompañantes, entrega y planificación

Dominio **comandas** (Supabase `public.comandas` + `public.carga_menu`). Carga desde el **Mapa de Camas**
(tab Dieta del detalle) y gestión desde el módulo **Gestión de Comandas**. **Comandas NO emite push**
(módulo silencioso); se sincroniza por Realtime (canal `comandas-live`). Permisos: `cargar_dieta` (todos
los turnos) o `cargar_comanda_<turno>` (granular), `ver_dieta`, `ver_planificacion`, `abm_planificacion`.

### CU-NUT-01 — Cargar la comanda del titular

- **Actor:** Nutrición
- **Objetivo:** cargar la bandeja del paciente para un turno.
- **Precondiciones:** permiso del turno; el titular tiene dieta cargada en PROGAL (ver borde `sin_dieta`).
- **Pasos:**
  1. Mapa de Camas → abrir la cama del paciente → sección de comandas por turno (`MealSlotEditor`, boxes Desayuno/Almuerzo/Merienda/Cena).
  2. Abrir el turno → elegir **Menú / Opción / Otros**.
  3. Si eligió **Menú u Opción** y hay planificación vigente hoy, el **detalle se autocompleta** con el texto planificado (editable). Si eligió **Otros**, el detalle es **obligatorio** (no autocompleta).
  4. Observaciones (opcional) → **Guardar**.
- **Resultado esperado:** POST `/api/dietas` (upsert del titular por `identidad+comida+día`). La bandeja queda en estado **Pendiente** (`Activo`). Optimista con rollback si falla.
- **Permiso / gating:** `cargar_dieta` **o** `cargar_comanda_<turno>`. Server enforcea el turno por user-id del JWT → **403** si no lo tiene.
- **Archivo:** `saveMealLoad` en `useHospitalState.ts`; `api/dietas.ts`; UI en `BedsView.tsx`.

### CU-NUT-02 — Agregar un acompañante

- **Actor:** Nutrición
- **Objetivo:** sumar una bandeja de acompañante al mismo turno.
- **Precondiciones:** ya existe (o no) el titular; **máximo 6** acompañantes.
- **Pasos:** dentro del turno → **Agregar acompañante** → aparece un `CompanionEditor` (draft local) → elegir tipo/detalle/obs → **Guardar**.
- **Resultado esperado:** el alta es **sin optimistic update** (el `orden` lo asigna el server): la fila aparece recién con la respuesta. Es **INSERT** puro (nunca upsert, para no pisar el acompañante de otro en una carrera). El 7mo da **400** (backstop anti-abuso).
- **Permiso / gating:** mismo permiso de turno que el titular.
- **Archivo:** `api/dietas.ts` (POST comensal ≠ TITULAR).

### CU-NUT-03 — Editar una comanda

- **Actor:** Nutrición
- **Pasos:** reabrir el turno → cambiar tipo/detalle/obs → **Actualizar**.
- **Resultado esperado:** se actualiza. **Si la bandeja está ENTREGADA está congelada**: banda verde *"Ya entregada — volvela a pendiente desde el panel de Comandas"*, campos disabled, y el server devuelve **409 `comanda_entregada`** si se fuerza.
- **Archivo:** `api/dietas.ts`.

### CU-NUT-04 — Quitar / anular una comanda (titular o acompañante)

- **Actor:** Nutrición
- **Objetivo:** anular una bandeja con motivo auditable.
- **Pasos:** botón **Quitar** (titular) o **X** (acompañante) → prompt inline de **motivo obligatorio** → Confirmar.
- **Resultado esperado:** PATCH `/api/dietas action='anular'` (soft-delete, status → **Inactivo** + `motivo_anulacion`). Anular el **titular** no toca a los acompañantes del turno. Un acompañante **draft** se descarta sin red ni motivo. Bloqueado si ya está entregada.
- **Archivo:** `clearMealLoad`; `api/dietas.ts`.

### CU-NUT-05 — Panel Gestión de Comandas: entregar / volver a pendiente / anular

- **Actor:** Nutrición (o cualquiera con el módulo **Gestión Comandas**)
- **Objetivo:** operar el estado de las bandejas del día.
- **Pasos:**
  1. Sidebar → **Comandas** → tab **De hoy** (arranca en sub-vista Pendientes; botonera Pendientes/Entregadas con contadores).
  2. En una fila **Pendiente**: check verde = **entregar**; X roja = **anular** (modal de motivo obligatorio).
  3. En una fila **Entregada**: undo = **volver a pendiente**.
- **Resultado esperado:** PATCH `/api/dietas` (`entregar` → Entregado + `fecha_cierre`; `pendiente` → Activo, limpia cierre y motivo; `anular` → Inactivo). **Anular directo desde Entregado está bloqueado** (409 `comanda_entregada`): hay que volver a pendiente primero.
- **Permiso / gating (borde de seguridad):** el PATCH de estado **NO** enforcea permiso server-side — la restricción es de UI (tener el módulo Gestión Comandas). A validar contra el diseño esperado.
- **Archivo:** `views/ComandasManagementView.tsx`; `setMealStatus`; `api/dietas.ts`.

### CU-NUT-06 — Consultar histórico y exportar

- **Actor:** Nutrición / Catering
- **Pasos:** tab **Histórico** → rango de fechas (día-ART) → GET `/api/dietas?history=1&from&to`. Buscar por paciente/cama/sector/turno/comanda/obs → **Exportar PDF** (orden de despacho piso→cama→turno→comensal) o **Excel** (tabla plana).
- **Resultado esperado:** el export refleja lo **filtrado en pantalla**. El histórico es solo lectura (las acciones se hacen en "De hoy").

### CU-NUT-07 — Planificar el menú por rango de fechas

- **Actor:** Nutrición / Planificador (permiso `abm_planificacion`; ver-solo con `ver_planificacion`)
- **Objetivo:** definir "del {desde} al {hasta}, en el {turno}, el {tipo} es {comanda}".
- **Pasos:**
  1. Gestión de Comandas → botón **Planificación** (abre `PlanificacionMenuModal`; las vencidas se ocultan, botón "Ver vencidas").
  2. **Nueva planificación** → turno, tipo (**Menú / Opción** — Otros no es planificable), Desde, Hasta, texto de comanda (≤255) → **Crear**.
- **Resultado esperado:** POST `/api/carga-menu` valida **sin solapamiento** por `(turno, tipo)`. Si pisa otro rango del mismo turno+tipo → **409** con `conflictingId` y mensaje inline. La copia a las comandas es **por valor** (editar la plantilla después NO reescribe lo ya cargado).
- **Archivo:** `PlanificacionMenuModal.tsx`; `api/carga-menu.ts`.

### CU-NUT-08 — Editar / eliminar una planificación

- **Actor:** Planificador (`abm_planificacion`)
- **Pasos:** en la grilla → lápiz = editar (PATCH) / papelera = eliminar (DELETE soft-delete, confirmación inline).
- **Resultado esperado:** solo sobre planificaciones **vivas**. Las **vencidas** (`hasta < hoy ART`) están read-only (botones disabled) y el server revalida con **409 `planificacion_vencida`**.

### CU-NUT-09 (borde) — `sin_dieta`: titular sin dieta en PROGAL

- **Actor:** Nutrición
- **Objetivo (negativo):** confirmar el bloqueo del titular sin dieta, y que los acompañantes sí cargan.
- **Resultado esperado:** el titular exige dieta cargada en PROGAL (backstop **híbrido**: lee `12.EnrichCamas` en SharePoint). **Fail-open total**: solo el dato **confirmado** "sin tipo de dieta" devuelve **409 `sin_dieta`**; si el cross-read falla o el enrich está atrasado, la comanda **se guarda igual**. El bloqueo **no** aplica a acompañantes (banda ámbar "Los acompañantes sí se pueden cargar").
- **Archivo:** `api/dietas.ts` (backstop híbrido SP).

### CU-NUT-10 (borde) — La comanda sigue al paciente al trasladarse

- **Actor:** Sistema (disparado por el traslado)
- **Resultado esperado:** al confirmar recepción (y de nuevo al consolidar, idempotente) las bandejas **pendientes** del paciente (todos los turnos, titular + acompañantes) se **mudan a la cama destino** (`reubicar`). Las **entregadas/anuladas no se tocan**. El panel y el PDF muestran la habitación de **entrega real**.
- **Archivo:** `migratePendingMeals`; PATCH `/api/dietas action='reubicar'`.

---

## 5. Rol ADMIN — Configuración (ABM de usuarios y roles)

Módulo **Configuracion**. Cualquier rol con el módulo + permisos `abm_roles` / `abm_usuarios` entra (no hay
privilegio hardcodeado por rol). **Roles → Supabase `public.roles`**; **Usuarios → siguen en SharePoint
`00.Usuarios`** (no migraron). Vistas `RoleManagementView.tsx` / `UserManagementView.tsx`.

### CU-ADMIN-01 — Crear un rol

- **Actor:** Admin (`abm_roles`)
- **Objetivo:** definir un rol con sus módulos, permisos y flags.
- **Pasos:**
  1. Sidebar → Configuración → pestaña **Roles** → **Nuevo Rol**.
  2. Escribir el **Nombre**.
  3. Tildar **Módulos de acceso** (Home / Operativa / Historial / Mapa de Camas / Gestión de Limpieza / Gestión de Comandas / Configuración).
  4. Tildar **Permisos de acciones**: aparecen **agrupados por módulo** y cada grupo se renderiza **solo si su módulo está tildado** (excepto **Notificaciones**, que es cross-module y siempre visible).
  5. Toggles **Filtrado por pisos asignados** (Sí/No) y **Acceso sin restricción de ubicación IP/GPS** (Sí/No).
  6. **Crear Rol**.
- **Resultado esperado:** POST `/api/roles` → `public.roles` + `invalidateRoleCache()`. Nombre duplicado (case-insensitive) → **409** "Ya existe un rol con ese nombre".
- **Permiso / gating:** `abm_roles`.
- **Archivo:** `RoleManagementView.tsx`; `api/roles.ts`; `api/role-cache.ts`.

### CU-ADMIN-02 — Editar / eliminar un rol

- **Actor:** Admin (`abm_roles`)
- **Pasos:** lápiz = editar / tacho = eliminar (**soft-delete** `status='Inactivo'`).
- **Resultado esperado:**
  - Si el admin edita **su propio** rol, `onSessionRoleUpdate` refresca módulos/permisos **sin re-loguear**.
  - Quitar **todos** los permisos (`permissions:[]`) se escribe igual (con warning); los usuarios de ese rol pierden botones y dejan de recibir push en el próximo `syncSessionRole` (~60s).

### CU-ADMIN-03 — Crear un usuario

- **Actor:** Admin (`abm_usuarios`)
- **Pasos:**
  1. Configuración → **Usuarios** → **Nuevo Usuario**.
  2. Nombre / Apellido → **auto-genera username** (3 letras del nombre + apellido).
  3. Seleccionar **Rol** (dropdown poblado desde `/api/roles`).
  4. Usuario / Contraseña / Email.
  5. Si el rol tiene `filterByFloors`, aparece **Sectores Asignados** (checkboxes de las 10 áreas) → tildar.
  6. **Crear**.
- **Resultado esperado:** POST `/api/users` → SharePoint `00.Usuarios`. Editar propaga **rol y áreas a `push_subscriptions`** de Supabase en el acto. Eliminar = soft-delete `Status_U='Inactivo'`. El usuario interno "Admin" (Sumar) se oculta salvo que seas ese usuario.
- **Permiso / gating:** `abm_usuarios`.
- **Archivo:** `UserManagementView.tsx`; `api/users.ts`.

### CU-ADMIN-04 (borde) — Reasignar un usuario a otro rol

- **Actor:** Admin
- **Objetivo (limitación conocida):** entender por qué el cambio no toma en caliente.
- **Resultado esperado:** el resync en caliente (`syncSessionRole`, cada 60s) refresca por el **roleName viejo** (el rol al que ya pertenecía). Si se **reasigna a OTRO rol**, el usuario sigue con módulos/permisos viejos **hasta re-loguear**. QA clave: cambiar el rol de un usuario logueado y verificar que no cambia hasta cerrar sesión.

### CU-ADMIN-05 (borde) — Editar los sectores asignados de un usuario logueado

- **Actor:** Admin
- **Resultado esperado:** `api/users.ts` propaga a `push_subscriptions` en el acto (el **push** filtra bien), **pero** `user.assignedAreas` de la sesión del cliente **no** se refresca por `syncSessionRole` (solo módulos/permisos/flags) → el filtro de UI de camas usa las áreas viejas **hasta re-login**.

---

## 6. TODOS los roles — Login, sesión, notificaciones

### CU-AUTH-01 — Login

- **Actor:** cualquier rol
- **Pasos:**
  1. Pantalla de login → **username (o email)** + password.
  2. Enviar → POST `/api/auth` (valida `00.Usuarios` en SharePoint: `Aplicacion='Traslados'` + `Status='Activo'`).
- **Resultado esperado:**
  - Hidrata permisos/módulos del rol desde Supabase (role-cache).
  - Si `sede ≠ SUMAR` y el rol **no** tiene `bypassLocationCheck`, valida ubicación (IP/GPS) contra `99.ABM_GeoIPS`; si `allowed:false` → "Ubicación no autorizada" y **no** deja entrar.
  - Guarda `mediflow_token` / `mediflow_user` / `mediflow_version` en localStorage. Landing = **primer módulo accesible** (Home → Operativa → Mapa → Historial → Limpieza → Comandas).
  - Si el rol tiene notificaciones concedidas y hay permiso del navegador, `subscribeToPush` registra la sub en `push_subscriptions` (snapshot de rol+áreas+sede+entorno).
  - **Nota:** el token dura **~10 años** (`EXPIRY_DEFAULT='3650d'`), pese al comentario "8h" del código. El único logout automático es por ubicación revocada.
- **Archivo:** `api/auth.ts`; `hooks/useHospitalState.ts`.

### CU-AUTH-02 (borde) — Rol no encontrado en la tabla `roles`

- **Actor:** usuario cuyo `Perfil_U` no matchea ningún `roles.name` (borrado/renombrado/mal escrito)
- **Resultado esperado:** loguea igual pero queda `permissions:[] modules:[]` → **solo lectura**, landing potencialmente vacía. Modo seguro por diseño.

### CU-AUTH-03 — Recibir (o no) una notificación push

- **Actor:** cualquier suscriptor
- **Objetivo:** validar la matriz de filtrado.
- **Resultado esperado:** un suscriptor recibe el tipo X **sii** su rol tiene el permiso `NOTIF_TYPE_TO_PERMISSION[X]` **Y** pasa: entorno correcto, `filter_by_floors` (área), sub fresca (`last_seen_at ≤ 36h`), y **no** es el actor (`excludeUser`).

| Tipo de push | Permiso requerido | Camino de envío |
|---|---|---|
| `NEW_TICKET` | `notif_new_ticket` | Edge Function `notify-push` (webhook sobre `traslados`) |
| `STATUS_UPDATE` | `notif_status_update` | Edge Function `notify-push` |
| `RECEPTION_CONFIRMED` | `notif_reception_confirmed` | Edge Function `notify-push` (texto custom para Catering) |
| `DIET_CHANGE` | `notif_diet_change` | Vercel `push-utils` (cron `cron-diet-changes`) |
| `FASTING_CHANGE` | `notif_fasting_change` | Vercel `push-utils` (cron) |
| `ROOM_CLEANED` | `notif_habitacion_limpia` | Vercel `push-utils` (`api/limpiezas.ts`) |

- **Bordes QA:** el **actor no** recibe su propio push (pero sí ve una notificación in-app local). `Esperando Habitacion` (WAITING_ROOM) **no** dispara push. Sub **stale >36h** no recibe. Entorno cruzado (TESTING vs PRODUCTIVO) **no** llega. Una sola burbuja por transición (idempotencia `push_dispatch_log`, mató el "TIN TIN TIN").
- **Archivo:** `supabase/functions/notify-push/index.ts`; `api/push-utils.ts`; `lib/permissions.ts` (`canReceiveNotif`).

---

## 7. Monitor e Historial (KPIs y auditoría)

### CU-MON-01 — Ver el Monitor (Dashboard / KPIs)

- **Actor:** roles con el módulo **Home / Operativa** (Admisión, Admin, Dirección…)
- **Pasos:** entrar a **Monitor** (`DashboardView.tsx`).
- **Resultado esperado:** se ven los KPIs de traslados (activos, por estado, tiempos). Los datos llegan por Realtime + GET `/api/tickets?all=1` on-demand.
- **Archivo:** `views/DashboardView.tsx`.

### CU-HIS-01 — Historial en modo Lista

- **Actor:** roles con el módulo **Historial**
- **Pasos:** Historial → modo **Lista** → filtrar por fecha/estado/tipo → **Auditar** un ticket (AuditModal) o **exportar XLSX**.
- **Resultado esperado:** se listan los tickets **cerrados** con sus filtros; el export refleja lo filtrado. Desde Auditar se pueden cargar observaciones sobre tickets ya cerrados.
- **Archivo:** `views/HistoryView.tsx`.

### CU-HIS-02 — Trayectoria del paciente

- **Actor:** cualquiera con acceso a Historial
- **Pasos:** Historial → **Trayectoria** → elegir un paciente.
- **Resultado esperado:** se ve su historia agrupada en episodios: **"Camino de Camas"** (origen → destino1 → destino2…, con cancelados tachados) + **"Línea de Tiempo"** con los hitos de cada ticket (eventos de `traslado_eventos`: Solicitud Creada, Habitación Preparada, Inicio Traslado, Paciente Recibido, Consolidado en PROGAL, Modificación, Cancelación).
- **Archivo:** `components/PatientJourney.tsx`.

### CU-CLEAN-01 — Supervisor de limpieza: consolidar limpiezas

- **Actor:** rol con módulo **Gestión Limpieza** + permiso `consolidar_limpieza`
- **Pasos:** Gestión Limpieza (`CleaningManagementView.tsx`) → tab **Activas** (camas con overlay "Limpia" pendientes) → botón **Consolidado PROGAL** → confirmar.
- **Resultado esperado:** cierra la limpieza con motivo **CONSOLIDADO**; la cama vuelve a reflejar el estado real de PROGAL. Tab **Histórico**: filtra limpiezas cerradas por rango de `fecha_cierre` (motivos agrupados GAMMA/TICKET="Traslado", ANULADA="Anulada", CONSOLIDADO="Consolidado").
- **Permiso / gating:** `consolidar_limpieza` (el resto ve solo lectura).

---

## Apéndice A — Quién dispara cada paso del traslado

| Transición | Estado destino | Permiso | Quién (rol / piso) |
|---|---|---|---|
| Crear | `WAITING_ROOM` o `IN_TRANSIT` | `crear_ticket` | Admisión / Admin |
| Confirmar habitación lista | `IN_TRANSIT` | `confirmar_limpieza` | Azafata de **destino** |
| Iniciar traslado | `IN_TRANSPORT` | `iniciar_traslado` | Azafata de **origen** |
| Confirmar recepción | `WAITING_CONSOLIDATION` | `confirmar_recepcion` | Azafata de **destino** |
| Consolidar PROGAL | `COMPLETED` | `consolidar` | Admisión / Admin |
| Cancelar | `REJECTED` | `cancelar_ticket` + rol `ADMISSION`/`ADMIN` | Admisión / Admin |
| Editar | (recalcula) | `editar_ticket` | Admisión / Admin, solo si `intervino_azafata='NO'` |

## Apéndice B — Códigos de error a verificar en QA

| Código | Cuándo | Dominio |
|---|---|---|
| **400** | falta id/spItemId (PATCH) o ticketId/tipo/texto; detalle "Otros" vacío; >6 acompañantes | tickets / dietas |
| **403** | azafata fuera de sus pisos asignados; turno de comanda no permitido | tickets / dietas |
| **409** | cama destino ya asignada a otro traslado activo (`conflictingTicketId`); nombre de rol duplicado; `comanda_entregada`; `sin_dieta`; solapamiento/`planificacion_vencida` | tickets / roles / dietas / carga-menu |
| **429** | rate-limit de login (brute-force), con `Retry-After` | auth |
| **503** | Supabase no configurado (falta env) | todos los endpoints Supabase |

## Apéndice C — Recordatorios de arquitectura para QA

- **Realtime, no poll**: traslados / limpiezas / comandas se actualizan solos (canales `*-live`). **Beds** es el único con poll (60s). Al reconectar la red hay catch-up por refetch — Realtime no reenvía lo perdido.
- **Aislamiento de entorno**: TESTING y PRODUCTIVO comparten proyecto Supabase; la RLS de lectura por el "pase" JWT ES256 (`/api/supabase-token`) impide que un entorno vea filas del otro. Verificar que el claim `entorno` del pase sea el correcto.
- **Versionado de build**: cada escritura estampa `APP_VERSION` (`lib/version.ts`) en la columna `version`; badge en login/sidebar. Sirve para detectar clientes con build viejo cacheado.
- **Feature planificada (NO construida)**: "Traslados a Cirugía" (`docs/plan-traslados-cirugia.html`) — es un plan, todavía no existe en la app. No testear como si estuviera.
