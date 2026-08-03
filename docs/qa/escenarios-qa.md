# Escenarios de QA — MediFlow (Gestión de Traslados HPR)

Casos de prueba **testeables** en formato **Precondición → Acción → Resultado esperado**, cada uno con
un ID (`QA-<módulo>-NN`) para trazabilidad. Este documento es la **fuente de requisitos que se le pasa
a [TestSprite](https://docs.testsprite.com/mcp/getting-started/overview)** (vía su MCP) para generar el
plan y los tests; también sirve para QA manual.

> Fuente de verdad = el código actual (post-migración SharePoint → Supabase). Si esta doc y otra doc
> vieja se contradicen, gana el código. Referencia de arquitectura: [arquitectura.md](../arquitectura/arquitectura.md)
> (algunas secciones quedaron desactualizadas por la migración; ver [cutover-supabase-main.md](../historial/cutover-supabase-main.md)).

---

# Parte A · Charter de QA para TestSprite (leer primero)

Esta parte es el **contexto que TestSprite necesita** para poder loguear, saber dónde probar y qué NO
tocar. Las [secciones 1–12](#1-traslados--camino-feliz-por-transición) (Parte B) son los casos.

### A.1 · Cómo correrlo con TestSprite

Arrancá el run en tu IDE con un prompt como:

> **"Testeá este proyecto con TestSprite usando `docs/qa/escenarios-qa.md` como requisitos. Probá SOLO
> contra el entorno de TESTING (deploy de `develop`), nunca PRODUCTIVO. Priorizá la suite P0."**

TestSprite hace 8 pasos: lee requisitos → analiza el código → genera un PRD normalizado → arma el test
plan → **genera y corre los tests en la nube** (Playwright/Cypress) → reporte → propone fixes vía IDE.

### A.2 · Producto (una línea)

MediFlow gestiona el ciclo de vida de traslados de pacientes del Hospital Privado de Rosario:
solicitud → asignación de cama → limpieza → transporte → recepción → consolidación; más Mapa de Camas,
Comandas (dietas por turno) y ABM de usuarios/roles. Stack: React 18 + TS + Vite (PWA), backend
serverless en Vercel (`api/*`), datos en Supabase (Postgres + RLS + Realtime), integración API Gamma.

### A.3 · Entorno de prueba (¡crítico!)

- **Base URL a testear:** el **deploy de `develop`** (Vercel Preview) → mapea a `entorno = TESTING`.
  Completá la URL real acá: **`BASE_URL = https://<deploy-develop>.vercel.app`**
- **PROHIBIDO** correr contra Production (`entorno = PRODUCTIVO`): tiene datos reales de pacientes (PHI).
- Un solo proyecto Supabase compartido, separado por columna `entorno`. Las lecturas del cliente pasan
  por **RLS por entorno** (pase JWT ES256, `/api/supabase-token`, TTL 1h); las escrituras van por
  backend con `service_role` (bypassa RLS).

### A.4 · Credenciales de prueba (completar antes de correr)

TestSprite necesita un login por rol para cubrir la matriz de permisos. El login acepta **usuario o
email**; password en texto plano (ver QA-ROL-10). Usá cuentas de **TESTING** (no reutilices las de
PRODUCTIVO):

| Rol de prueba | Usuario/email | Password | Piso(s) `filter_by_floors` |
|---|---|---|---|
| **Admisión** | `<...>` | `<...>` | — |
| **Azafata Piso 5** | `<...>` | `<...>` | Piso 5 |
| **Azafata Piso 6** | `<...>` | `<...>` | Piso 6 |
| **Enfermería** | `<...>` | `<...>` | — |
| **Catering** | `<...>` | `<...>` | (opcional) |
| **Nutrición** | `<...>` | `<...>` | — |
| **Supervisor Limpieza** | `<...>` | `<...>` | (opcional) |
| **Admin** | `<...>` | `<...>` | — |

> ⚠️ **No commitees credenciales reales** en este archivo (el repo es compartido): pasáselas a TestSprite
> por su config/entorno, o usá un archivo local ignorado por git. Los `<...>` son placeholders.

### A.5 · Alcance de automatización

**Automatizable con TestSprite (priorizar):**
- Flujos de UI (frontend): crear/mover/cancelar traslados, marcar limpiezas, cargar comandas, ABM.
- API (backend): códigos de error (400/401/403/409/429/502/503), idempotencia, validaciones.
- Permisos por rol (qué botón ve / qué endpoint responde 403).
- Auto-refresh por Realtime **dentro de la misma corrida** (esperar el cambio, sin F5).

**NO automatizable por browser/API → prueba manual o de dispositivo** (marcados 📵/🔒/🌐/🧪 en el índice):
- 📵 **Push nativo** (banner del SO): depende del permiso de dispositivo/OS → verificá la **campanita
  in-app** (tabla `public.notificaciones`) como proxy, no el banner.
- 🔒 **Validación de ubicación** (IP/GPS, `validate-location`): puede patear el login → usá un rol con
  `bypass_location_check`, o corré desde una IP permitida.
- 🌐 **Dependencia de la API Gamma / PROGAL** (mapa de camas real): datos externos volátiles → los casos
  de "fail-open/stale" se validan mejor de forma dirigida/manual.
- 🧪 **Setup especial fuera del browser:** multi-dispositivo, >36h stale, rotación de VAPID, escritura
  directa contra RLS.

### A.6 · Datos de prueba que hay que preparar (en TESTING)

Muchos casos necesitan camas en estados concretos. Antes de correr, asegurá:
- ≥1 cama **Ocupada** (origen), ≥1 **En preparación** y ≥1 **Disponible** (destino) en el mismo piso.
- ≥1 paciente con **dieta cargada en PROGAL** (para comandas) y alguno **sin dieta confirmada** (409).
- Al menos un piso con azafata asignada que coincida con las camas de prueba.

### A.7 · Guardrails para TestSprite (no negociable)

1. Correr **solo en TESTING** (BASE_URL de `develop`). Nunca en Production.
2. **No** enviar push a usuarios reales; validar por campanita/DB, no por notificación de dispositivo.
3. No hay hard-delete que testear: la app es **soft-delete** (`Status` → `Inactivo`).
4. Las escrituras crean filas reales en TESTING → usá pacientes/camas de prueba, no "vivos".

### A.8 · Cómo leer cada caso (convención)

Cada caso: `QA-<módulo>-NN` + **Precondición → Acción → Resultado esperado**. En el índice (Parte B)
cada grupo lleva:

- **Tipo:** `FE` (flujo de UI) · `BE` (API / estado) · `FE+BE`.
- **Prioridad:** `P0` (camino crítico / seguridad) · `P1` (importante) · `P2` (borde / regresión).
- **Marcador de "manual":** 📵 push de dispositivo · 🔒 geo/ubicación · 🌐 depende de Gamma · 🧪 setup especial.
- **Oráculo de verificación:** UI (Realtime, sin F5) · HTTP (código del endpoint en Network) · DB (fila
  en Supabase, incl. columna `version`) · campanita (`public.notificaciones`).

### A.9 · Máquina de estados de un traslado (referencia)

```
crear ──▶ WAITING_ROOM ('Esperando Habitacion')   [cama destino EN PREPARACIÓN]
      └▶ IN_TRANSIT   ('Habitacion Lista')         [cama destino DISPONIBLE → salta limpieza]

WAITING_ROOM ──(azafata destino: "Habitación Lista")──▶ IN_TRANSIT
IN_TRANSIT   ──(azafata origen:  "Iniciar Traslado")──▶ IN_TRANSPORT ('En Traslado')
IN_TRANSPORT ──(azafata destino: "Recepción OK")─────▶ WAITING_CONSOLIDATION ('Por Consolidar')
WAITING_CONSOLIDATION ──(Admisión/Admin: "Consolidar PROGAL")──▶ COMPLETED ('Consolidado')  [TERMINAL]

cualquier estado activo ──(Admisión/Admin: "Cancelar")──▶ REJECTED ('Cancelado')  [TERMINAL]
```

---

# Parte B · Casos de prueba

Arrancá por la **suite P0** (camino crítico + seguridad). Dejá los casos marcados 📵/🔒/🌐/🧪 para una
pasada manual aparte (no son automatizables por browser/API).

### Suite P0 — correr primero
`QA-TRA-01..08`, `QA-TRA-15`, `QA-TRA-19`, `QA-LIM-01`, `QA-LIM-10`, `QA-COM-01`, `QA-COM-09`,
`QA-ROL-01`, `QA-ROL-10`, `QA-NOT-05`, `QA-NOT-09`, `QA-RT-01`, `QA-INF-01`, `QA-INF-02`.

### Cobertura por módulo

| Módulo | Sección | Casos | Tipo dominante |
|---|---|---|---|
| Traslados (flujo feliz) | 1 | `QA-TRA-01..07` | FE |
| Traslados (cancelar/editar/obs) | 2 | `QA-TRA-08..14` | FE + BE (409) |
| Traslados (borde / errores) | 3 | `QA-TRA-15..24` | BE (409/403) |
| Limpiezas / Mapa de Camas | 4 | `QA-LIM-01..13` | FE (🌐 en 12) |
| Comandas / Planificación | 5 | `QA-COM-01..22` | FE + BE (409/400) |
| Roles y permisos | 6 | `QA-ROL-01..12` | FE + BE (auth, 🔒 en 11) |
| Notificaciones | 7 | `QA-NOT-01..10` | BE (📵 device en 01–08) |
| Realtime | 8 | `QA-RT-01..05` | FE (🌐 en 05) |
| Versionado de build | 9 | `QA-VER-01..02` | FE + BE |
| Infra / RLS / pase | 10 | `QA-INF-01..03` | BE (seguridad, 🧪 en 02) |

### Casos NO automatizables por browser/API (marcar como manuales)

- 📵 **Push de dispositivo:** `QA-NOT-01..08` (banner nativo) → validar por campanita (`QA-NOT-10`) + DB.
- 🔒 **Geo/ubicación:** `QA-ROL-11` (usar rol con `bypass_location_check` o IP permitida).
- 🌐 **Dependencia Gamma / stale:** `QA-LIM-12`, `QA-RT-05` (y `QA-COM-07/08` dependen del cross-read a SP).
- 🧪 **Setup especial:** `QA-NOT-07` (>36h), `QA-NOT-08` (rotar VAPID), `QA-INF-02` (escritura directa a RLS).

---

## 1. Traslados — camino feliz por transición

### QA-TRA-01 · Crear traslado con cama destino EN PREPARACIÓN (arranca en WAITING_ROOM)
- **Precondición**: logueado como **Admisión**. Existe una cama origen **Ocupada** y una cama destino
  **En preparación** en el mismo entorno.
- **Acción**: Operativa → "Nueva Solicitud" → elegí workflow **Traslado Interno**, cama origen (Ocupada),
  cama destino (En preparación), escribí **motivo** (obligatorio en INTERNAL) → Confirmar.
- **Resultado esperado**:
  - El ticket aparece en Operativa en estado **'Esperando Habitacion'** (WAITING_ROOM).
  - `intervino_azafata = 'NO'` → el ticket sigue **editable y cancelable**.
  - Se registra evento **'Solicitud Creada'** en la trayectoria.
  - Push **NEW_TICKET** ("Nueva Solicitud de Traslado") a azafatas/roles con `notif_new_ticket` del
    piso **destino** (el creador **no** se autonotifica).
  - **NO** llega un STATUS_UPDATE (WAITING_ROOM no tiene label → no notifica).
  - HTTP `POST /api/tickets` → 200/201.

### QA-TRA-02 · Crear traslado con cama destino DISPONIBLE (salta limpieza → IN_TRANSIT)
- **Precondición**: Admisión; cama origen Ocupada, cama destino **Disponible**.
- **Acción**: crear el traslado igual que QA-TRA-01.
- **Resultado esperado**:
  - El ticket arranca **directo en 'Habitacion Lista'** (IN_TRANSIT): **NO** aparece el botón
    "Habitación Lista" porque se salteó el paso de limpieza.
  - La azafata de **origen** ya ve el botón verde "Iniciar Traslado".
  - Evento 'Solicitud Creada'. Push NEW_TICKET.

### QA-TRA-03 · Azafata destino confirma habitación lista (WAITING_ROOM → IN_TRANSIT)
- **Precondición**: ticket en 'Esperando Habitacion'. Logueado como **Azafata cuyo piso = área de la
  cama DESTINO**, con permiso `confirmar_limpieza`.
- **Acción**: Operativa → en el ticket, botón azul **"Habitación Lista"**.
- **Resultado esperado**:
  - status → **IN_TRANSIT** ('Habitacion Lista'); cama destino → **'Asignada'**.
  - `intervino_azafata = 'SI'` → **desde acá ya NO se puede editar** (sí cancelar).
  - Evento **'Habitacion Preparada'** + constancia en histórico de limpiezas (nace **cerrada**, tipo
    'Traslado', sin overlay ni push ROOM_CLEANED).
  - Push **STATUS_UPDATE** "Habitación Lista".
  - La azafata de **origen** ve el badge "Esperando inicio de traslado"; solo la azafata del piso
    destino ve el botón.

### QA-TRA-04 · Azafata origen inicia el traslado (IN_TRANSIT → IN_TRANSPORT)
- **Precondición**: ticket en 'Habitacion Lista'. Azafata del piso **ORIGEN**, permiso `iniciar_traslado`.
- **Acción**: botón verde **"Iniciar Traslado"**.
- **Resultado esperado**:
  - status → **IN_TRANSPORT** ('En Traslado'); cama origen → **'En preparación'** (el paciente sale de
    origen, y su enrich de dieta/ayuno "sigue" al paciente al destino en el mapa).
  - Evento **'Inicio Traslado'**. Push STATUS_UPDATE "Traslado en Curso".
  - La azafata de destino ve el badge "Esperando inicio de traslado" → cambia a esperar recepción.

### QA-TRA-05 · Azafata destino confirma recepción (IN_TRANSPORT → WAITING_CONSOLIDATION)
- **Precondición**: ticket 'En Traslado'. Azafata del piso **DESTINO**, permiso `confirmar_recepcion`.
- **Acción**: botón verde **"Recepción OK"**.
- **Resultado esperado**:
  - status → **WAITING_CONSOLIDATION** ('Por Consolidar'); cama destino → **'Ocupada'**.
  - Evento **'Paciente Recibido'**.
  - Se disparan las **comandas pendientes** del paciente a mudarse a la cama destino
    (`migratePendingMeals` → PATCH `/api/dietas action=reubicar`). Las entregadas/anuladas **no** se tocan.
  - Push **RECEPTION_CONFIRMED** "Recepción Confirmada". **Catering** recibe texto custom:
    "Traslado concretado — {paciente} pasó de Habitación X (Piso) a Habitación Y (Piso)".
  - Desde acá la azafata **ya no carga observaciones** (su parte operativa terminó).

### QA-TRA-06 · Admisión/Admin consolida en PROGAL (WAITING_CONSOLIDATION → COMPLETED)
- **Precondición**: ticket 'Por Consolidar'. Logueado como **Admisión/Admin**, permiso `consolidar`.
- **Acción**: botón violeta **"Consolidar PROGAL"**.
- **Resultado esperado**:
  - status → **COMPLETED** ('Consolidado', **terminal**); cama origen → 'En preparación'; se setea
    `completedAt`.
  - Evento **'Consolidado Progal'**. Migra comandas otra vez (red idempotente). Refresca el mapa.
  - Push STATUS_UPDATE "Traslado Finalizado".
  - El ticket sale de Operativa activa; queda en Historial.

### QA-TRA-07 · Camino feliz completo end-to-end (multi-usuario)
- **Precondición**: 3 sesiones (Admisión, Azafata origen, Azafata destino) con los pisos correctos.
- **Acción**: crear (destino En preparación) → Habitación Lista → Iniciar Traslado → Recepción OK →
  Consolidar PROGAL.
- **Resultado esperado**: la secuencia de estados
  `WAITING_ROOM → IN_TRANSIT → IN_TRANSPORT → WAITING_CONSOLIDATION → COMPLETED` se refleja **en las 3
  pantallas sin recargar** (Realtime). Cada transición emite su evento y su push al piso correcto.

---

## 2. Traslados — cancelación, edición, observaciones

### QA-TRA-08 · Cancelar traslado con motivo (→ REJECTED)
- **Precondición**: ticket en cualquier estado activo. Logueado como **Admisión o Admin** (doble-check
  hardcodeado: `cancelar_ticket` + rol ADMISSION|ADMIN).
- **Acción**: botón rojo **"Cancelar"** → RejectionModal → escribí motivo → Confirmar.
- **Resultado esperado**:
  - status → **REJECTED** ('Cancelado', terminal); se guarda `motivo_cancelacion` y `completedAt`.
  - Evento **'Cancelado: {motivo}'**. Push STATUS_UPDATE "Traslado Cancelado".
  - Se puede cancelar **aunque la azafata ya haya intervenido** (a diferencia de editar).

### QA-TRA-09 · Cancelar sin motivo → bloqueado
- **Precondición**: ticket activo; RejectionModal abierto.
- **Acción**: confirmar con el campo motivo **vacío**.
- **Resultado esperado**: alert / validación; **no persiste** (no hay cambio de estado ni evento).

### QA-TRA-10 · Editar traslado antes de que intervenga la azafata
- **Precondición**: ticket recién creado, `intervino_azafata = 'NO'`. Admisión/Admin, permiso `editar_ticket`.
- **Acción**: botón ámbar **"Editar"** → EditRequestModal → cambiá cama destino (revalidá que siga
  Disponible/Preparación), o motivo/financiador/observaciones → escribí **motivo de modificación** → Guardar.
- **Resultado esperado**:
  - Se aplica el cambio; **recalcula status** (IN_TRANSIT si destino Disponible, WAITING_ROOM si En
    preparación). La cama vieja se libera implícitamente (mergeBeds recomputa el mapa).
  - Registra **un único evento** `'Modificacion - {cambios} - Motivo: {motivo}'`.
  - Si cambió el destino **entre áreas distintas**, se emiten **3 notifs**: cancelación al área vieja,
    nueva solicitud al área nueva, modificación al origen.

### QA-TRA-11 · Editar tras intervención de azafata → bloqueado
- **Precondición**: ticket que ya pasó por una acción de azafata (`intervino_azafata = 'SI'`, p.ej. ya
  en IN_TRANSIT o más adelante).
- **Acción**: intentar **"Editar"**.
- **Resultado esperado**: bloqueado en cliente (`canCancel === false` → alert "la azafata ya intervino").
  **Cancelar sí** sigue permitido.

### QA-TRA-12 · Editar destino que otro admin ya tomó → 409
- **Precondición**: dos sesiones de Admisión. Ambas editan el mismo ticket apuntando a la **misma cama
  destino** nueva (o una crea a esa cama mientras la otra edita hacia ella).
- **Acción**: guardar el segundo cambio de destino.
- **Resultado esperado**: `PATCH /api/tickets` → **409** "Cama destino ya asignada a otro traslado
  activo." con `conflictingTicketId`. Rollback del optimista.

### QA-TRA-13 · Cargar observación con el ticket activo
- **Precondición**: ticket activo (no terminal, no en 'Por Consolidar' si sos azafata). Usuario con acceso a Operativa.
- **Acción**: cargar una observación en el ticket.
- **Resultado esperado**: `POST /api/ticket-observations` → la observación **snapshotea el status
  actual** del ticket. Aparece en la trayectoria.
- **Borde**: la **azafata deja de poder cargar** al llegar a 'Por Consolidar'; **Admisión/Admin sí**
  pueden. En tickets ya cerrados no se anota desde Operativa (se hace desde Historial → Auditar).

### QA-TRA-14 · Ver trayectoria del paciente
- **Precondición**: un paciente con ≥1 traslado (idealmente varios, alguno cancelado).
- **Acción**: Historial → Trayectoria → elegí el paciente.
- **Resultado esperado**: se ve **'Camino de Camas'** (origen → destino1 → destino2…, cancelados
  tachados) + **'Línea de Tiempo'** con los hitos (Solicitud Creada, Habitación Preparada, Inicio
  Traslado, Paciente Recibido, Consolidado en PROGAL, Modificación, Cancelación).

---

## 3. Traslados — casos borde y códigos de error

### QA-TRA-15 · Carrera por la misma cama destino (dos admisiones) → 409
- **Precondición**: dos sesiones de Admisión, misma cama destino Disponible.
- **Acción**: ambas confirman "Nueva Solicitud" a esa cama **casi simultáneamente**.
- **Resultado esperado**: la primera OK; la segunda → `POST /api/tickets` **409** "Cama destino ya
  asignada… (ticket X)" (índice único parcial `traslados_cama_destino_activa_idx`). Rollback + alert.

### QA-TRA-16 · Doble traslado sobre la misma cama origen → bloqueado
- **Precondición**: ya existe un traslado activo con cierta cama **origen**.
- **Acción**: intentar crear un segundo traslado con la **misma cama origen**.
- **Resultado esperado**: bloqueado en cliente ("Ya existe un traslado activo para esta cama").

### QA-TRA-17 · Validaciones de cama al crear
- **Acción/Resultado**:
  - Cama origen **no** Ocupada → no se puede elegir / se rechaza.
  - Cama destino que **no** esté Disponible ni En preparación → se rechaza.
  - Workflow **INGRESO_A_ITR**: origen debe ser una de las **8 camas HIT**.
  - Workflow **ITR_TO_FLOOR** (Sala de Espera): origen solo **HRA/sillones**.
  - Workflow **INTERNAL**: origen cualquier sector salvo HRA/HIT y **exige motivo**.

### QA-TRA-18 · Crear INTERNAL sin motivo → bloqueado (400 conceptual)
- **Precondición**: NewRequestModal con workflow **Traslado Interno**.
- **Acción**: confirmar sin escribir motivo.
- **Resultado esperado**: bloqueado (motivo obligatorio en INTERNAL).

### QA-TRA-19 · Enforcement de piso server-side (azafata fuera de su piso) → 403
- **Precondición**: **Azafata Piso 5** (`filter_by_floors`, sin "full access"). Traslado que requiere
  acción en **Piso 6**.
- **Acción**: forzar el PATCH de la acción de azafata (aunque el botón no se muestre) sobre ese traslado.
- **Resultado esperado**: `PATCH /api/tickets` → **403** "No autorizado: el traslado no pertenece a tus
  pisos asignados." Mapeo status→extremo: IN_TRANSIT→destino, IN_TRANSPORT→origen,
  WAITING_CONSOLIDATION→destino.

### QA-TRA-20 · Regla HRA (Sala de Espera) en enforcement
- **Precondición**: traslado **HRA → Piso 6**. Azafata de **Piso 6**.
- **Acción**: la azafata de Piso 6 confirma habitación lista / recepción (extremos que "pertenecen" a HRA).
- **Resultado esperado**: **permitido** — si el extremo requerido es HRA, se remapea al **piso real del
  otro extremo** (`effectiveAreaNames`), así la azafata de destino es dueña de ambos extremos.

### QA-TRA-21 · "Full access" por ≥9 áreas
- **Precondición**: rol con `filter_by_floors` pero **9 de 10 áreas** asignadas.
- **Acción**: actuar sobre traslados de cualquier piso.
- **Resultado esperado**: **no filtra** (≥9 áreas = full access); ninguna acción da 403 por piso.

### QA-TRA-22 · Falla de red en POST de creación (no-409) → sin ticket fantasma
- **Precondición**: Admisión creando un traslado.
- **Acción**: cortar la red justo al confirmar (o forzar 500).
- **Resultado esperado**: **rollback** del ticket optimista + alert. **No** queda un ticket fantasma en
  la grilla (regresión del bug histórico "se cargan y desaparecen").

### QA-TRA-23 · Terminal inmutable
- **Precondición**: ticket **Consolidado** o **Cancelado**.
- **Acción**: intentar editar / cancelar / avanzar.
- **Resultado esperado**: no se puede; los terminales no se editan ni cancelan.

### QA-TRA-24 · Idempotencia de creación (reintento)
- **Precondición**: crear un traslado y reintentar el mismo `POST` (mismo `id_univoco`).
- **Resultado esperado**: **no duplica** (upsert `onConflict (id_univoco,entorno) ignoreDuplicates`).

---

## 4. Limpiezas (Mapa de Camas + overlay "Opción B")

### QA-LIM-01 · Azafata marca una cama limpia (overlay + push)
- **Precondición**: **Azafata** cuyo piso incluye el área de la cama. Cama en **'En preparación'**, que
  **ningún ticket activo** esté usando. Permiso `confirmar_limpieza`.
- **Acción**: Mapa de Camas → abrir la cama → botón verde **"Marcar habitación limpia"** (SprayCan).
- **Resultado esperado**:
  - Optimista: la cama pasa a **'Disponible'** con chip **"Limpia ✓"** al instante; se cierra el modal.
  - `POST /api/limpiezas` (upsert por cama+entorno, `version = APP_VERSION`).
  - Push **ROOM_CLEANED** "Habitación Limpia" (vía **api/push-utils.ts**, web-push desde Vercel, **NO**
    la Edge Function) a roles con `notif_habitacion_limpia` del **mismo piso** (excluye a quien marcó).
  - El overlay se ve en **todos** los clientes por Realtime `limpiezas-live`, sin F5.

### QA-LIM-02 · POST de limpieza falla → rollback
- **Precondición**: como QA-LIM-01, pero forzá error en el POST (red caída / 500).
- **Resultado esperado**: **rollback** → la cama vuelve a 'En preparación'.

### QA-LIM-03 · Deshacer una limpieza
- **Precondición**: cama ya marcada "Limpia ✓". Azafata con `confirmar_limpieza` y la cama en sus
  `assignedAreas`.
- **Acción**: reabrir la cama → botón **"Deshacer"**.
- **Resultado esperado**: optimista quita el overlay; `PATCH /api/limpiezas` con motivo **ANULADA**
  (cierra la fila, status → Inactivo).

### QA-LIM-04 · Cama reservada por un traslado (panel índigo, sin botón limpiar)
- **Precondición**: cama 'En preparación' que es **DESTINO** de un traslado en curso.
- **Acción**: abrir esa cama en el Mapa.
- **Resultado esperado**: en vez del botón "Marcar limpia" se ve **panel índigo**: "Reservada por un
  traslado en curso (paciente X). La limpieza previa al ingreso se confirma con Habitación Lista desde
  Operativa." (marcar limpia ahí sería anulado por el auto-cierre con motivo TICKET).

### QA-LIM-05 · "Habitación Lista" crea limpieza que nace cerrada
- **Precondición**: flujo del ticket, azafata destino confirmando la limpieza previa al ingreso.
- **Acción**: tocar "Habitación Lista" (QA-TRA-03).
- **Resultado esperado**: `logRoomPreparedCleaning` → `POST /api/limpiezas` con `closed:true` → fila que
  **nace cerrada** (status Inactivo, motivo **TICKET** → histórico la muestra como **'Traslado'**).
  **No** crea overlay 'Limpia' ni dispara push; es solo constancia histórica.

### QA-LIM-06 · Marcar limpia una cama que es ORIGEN de un traslado sin consolidar → sin efecto visible
- **Precondición**: cama **origen** de un traslado en **WAITING_CONSOLIDATION**.
- **Acción**: marcar esa cama limpia.
- **Resultado esperado**: la limpieza se crea pero el **auto-cierre la anula al instante** (defensivo,
  motivo TICKET). Es esperado: se podrá marcar una vez que Admin **consolide**.

### QA-LIM-07 · Cama en "limbo" (Esperando Consolidación) sí se puede marcar
- **Precondición**: cama **destino** en 'Por Consolidar' donde PROGAL crudo aún muestra Ocupada (paciente
  viejo) pero el merge la muestra 'En preparación'.
- **Acción**: marcar limpia.
- **Resultado esperado**: **se puede** (el gate mira el status **mergeado**, no el crudo Gamma); el
  auto-cierre **NO** la mata durante la ventana de gracia del limbo.

### QA-LIM-08 · Concurrencia entre azafatas sobre la misma cama
- **Precondición**: dos azafatas marcan limpia la **misma cama+entorno** casi a la vez.
- **Resultado esperado**: índice único parcial `limpiezas_activa_uidx` → el POST maneja **23505**
  re-buscando y **refrescando** la existente (una sola fila activa, sin duplicado ni parpadeo).

### QA-LIM-09 · Supervisor consolida limpieza (CleaningManagementView)
- **Precondición**: **Supervisor** con `consolidar_limpieza`. Módulo **Gestión Limpieza**. Hay camas con
  overlay "Limpia" vigente.
- **Acción**: tab **Activas** → botón **"Consolidado PROGAL"** → confirmar.
- **Resultado esperado**: cierra la limpieza con motivo **CONSOLIDADO**; la cama vuelve a reflejar el
  estado real de PROGAL. Tab **Histórico** filtra por rango de `fecha_cierre` (motivos agrupados:
  GAMMA/TICKET='Traslado', ANULADA='Anulada', CONSOLIDADO='Consolidado').

### QA-LIM-10 · Enfermería/Catering NO ven botones de limpieza
- **Precondición**: **Enfermería** o **Catering** (solo lectura del mapa, sin `confirmar_limpieza`).
- **Acción**: abrir el detalle de una cama 'En preparación'.
- **Resultado esperado**: **no** ven "Marcar habitación limpia" ni "Deshacer". El aislamiento y datos
  del paciente son solo lectura.

### QA-LIM-11 · Techo por área (azafata de otro piso no ve la cama)
- **Precondición**: **Azafata Piso 8** (`filter_by_floors`).
- **Acción**: intentar ver/filtrar camas de otro piso.
- **Resultado esperado**: nunca ve camas de otro piso (el `allowedAreas` se aplica en `filteredBeds`
  **antes** que cualquier filtro UI, aunque toque `areaFilters`).

### QA-LIM-12 · Fail-open del mapa ante caída parcial de Gamma
- **Precondición**: `obtenermapacamasocupadas` devuelve 504/no-array.
- **Resultado esperado**: `/api/beds` sirve **cache stale** (header `X-Beds-Stale`) en vez de mostrar
  todas las camas como Disponibles (evita riesgo de doble-asignar). Si no hay cache → 503.

### QA-LIM-13 · Bloqueo por aislamiento duro
- **Precondición**: paciente con aislamiento **no-preventivo** en una habitación con camas libres.
- **Resultado esperado**: las camas **libres (Disponible/En preparación)** de esa habitación se
  bloquean (celda violeta, X). **'Contacto preventivo'** NO bloquea: solo señaliza camas contiguas en
  cyan. Exento en áreas críticas **HUC/HUT/HIT/HRA**.

### Códigos de error — Limpiezas
- `400`: falta `bedLabel` (POST) o falta `spItemId`/`bedLabel` (PATCH).
- `405`: método no permitido. `503`: Supabase no configurado (POST/PATCH; GET degrada a `{cleanings:[]}`
  con 200). `500`: fallo de escritura.

---

## 5. Comandas (carga por turno + planificación)

### QA-COM-01 · Nutrición carga comanda del titular
- **Precondición**: **Nutrición** con `cargar_dieta` (o el `cargar_comanda_<turno>` del turno). Cama con
  paciente que tiene dieta cargada en PROGAL.
- **Acción**: Mapa de Camas → abrir la cama → turno (Desayuno/Almuerzo/Merienda/Cena) → tipo
  **Menú/Opción/Otros** → detalle → Guardar.
- **Resultado esperado**:
  - `POST /api/dietas` (upsert del titular por identidad+comida+día). Fila **status Activo**
    (pendiente), `version = APP_VERSION`.
  - Si eligió **Menú/Opción** y hay planificación vigente hoy, el detalle **autocompleta** (editable).
  - **Comandas NO emite push** (módulo silencioso). Se refleja por Realtime `comandas-live`.

### QA-COM-02 · Agregar acompañante
- **Precondición**: turno con titular cargado.
- **Acción**: "Agregar acompañante" → CompanionEditor → tipo/detalle/obs → Guardar.
- **Resultado esperado**: alta **sin optimistic update** (el `orden` lo asigna el server → la fila
  aparece recién con la respuesta). `POST /api/dietas` hace **INSERT** (nunca upsert). Tope **6**
  acompañantes.

### QA-COM-03 · Séptimo acompañante → 400
- **Acción**: intentar cargar el 7º acompañante en un turno.
- **Resultado esperado**: **400** "No se pueden cargar más de 6 acompañantes por turno." (backstop).

### QA-COM-04 · Tipo "Otros" exige detalle → 400
- **Acción**: guardar una comanda tipo **Otros** con detalle vacío.
- **Resultado esperado**: **400** "detalle is required for tipo OTROS". (Otros no es planificable ni
  autocompleta.)

### QA-COM-05 · Comanda entregada no es editable → 409
- **Precondición**: bandeja marcada **Entregado** (desde Gestión de Comandas).
- **Acción**: intentar editar esa comanda (POST) desde el Mapa.
- **Resultado esperado**: **409 `comanda_entregada`** "La comanda ya fue entregada. Volvela a pendiente
  desde el panel…". En BedsView: banda verde + campos disabled.

### QA-COM-06 · Anular directo una entregada → 409 (hay que volver a pendiente primero)
- **Precondición**: bandeja **Entregado**.
- **Acción**: PATCH `action=anular` sobre ella.
- **Resultado esperado**: **409 `comanda_entregada`**. Flujo correcto: **volver a pendiente** →
  entonces sí anular (paso explícito auditable).

### QA-COM-07 · Backstop `sin_dieta` del titular (híbrido SharePoint) → 409
- **Precondición**: cama cuyo titular tiene **dato confirmado "sin tipo de dieta"** en PROGAL
  (`12.EnrichCamas` en SharePoint, `enriched === true`).
- **Acción**: cargar la comanda del **titular**.
- **Resultado esperado**: **409 `sin_dieta`**. El **titular queda bloqueado** (badge "sin dieta") pero
  los **acompañantes SÍ** se pueden cargar (banda ámbar).

### QA-COM-08 · `sin_dieta` es fail-open
- **Precondición**: el cross-read a `12.EnrichCamas` **falla / timeoutea / aún no procesó** la cama.
- **Acción**: cargar la comanda del titular.
- **Resultado esperado**: la comanda **se guarda igual** (fail-open total). Solo el dato **confirmado**
  "sin dieta" bloquea con 409.

### QA-COM-09 · Marcar entregada / volver a pendiente / anular (panel)
- **Precondición**: **Gestión de Comandas** → tab **"De hoy"**.
- **Acción**: en una fila Pendiente → **check verde** (entregar) o **X roja** (anular con modal de motivo
  obligatorio); en una Entregada → **undo** (volver a pendiente).
- **Resultado esperado**: `PATCH /api/dietas` (entregar/pendiente/anular). Estados:
  `Activo (pendiente) → Entregado → Activo`; `→ Inactivo (anulada)` con `motivo_anulacion`.

### QA-COM-10 · Reubicar comandas al trasladar el paciente
- **Precondición**: paciente con **almuerzo pendiente** que se traslada de cama.
- **Acción**: confirmar recepción y/o consolidar el traslado (QA-TRA-05/06).
- **Resultado esperado**: `PATCH /api/dietas action=reubicar` mueve las bandejas **pendientes** (titular
  + acompañantes, todos los turnos) a la **cama destino**. Las **entregadas/anuladas NO** se mueven. El
  panel y el PDF muestran la habitación de **entrega real**. Idempotente (recepción + consolidación).

### QA-COM-11 · Comanda pendiente de un día previo no desaparece
- **Precondición**: comanda **Pendiente** cargada ayer.
- **Acción**: abrir "De hoy" hoy.
- **Resultado esperado**: **sigue apareciendo** (si desapareciera, nadie podría cerrarla). Al
  re-guardarla se **reactiva a pendiente** y su `dia` pasa a hoy. Las **entregadas** de días previos
  **no** aparecen en "De hoy".

### QA-COM-12 · Concurrencia del titular vs acompañante
- **Precondición**: dos usuarios cargan el mismo (paciente, turno, día).
- **Resultado esperado**: **Titular** → índice único parcial `comandas_titular_viva_uidx` → 23505 →
  re-lookup y **reuso** (una sola fila). **Acompañante** → siempre INSERT: dos altas simultáneas dejan
  **dos filas** visibles y borrables.

### QA-COM-13 · filter_by_floors en comandas
- **Precondición**: **Catering de piso** (`filter_by_floors`).
- **Resultado esperado**: solo ve/acciona comandas de **sus pisos** (`areaOk`) en el mapa, el panel, el
  histórico y el PDF. No ve las de otros pisos.

### QA-COM-14 · Autocompletado por VALOR (no destructivo)
- **Precondición**: hay planificación vigente para (turno, tipo).
- **Acción**: elegir **Menú** → se copia el texto planificado → luego editar la **planificación**.
- **Resultado esperado**: las comandas **ya cargadas NO cambian** (copia por valor). El autocompletado
  solo pisa el detalle si estaba vacío o era exactamente el texto autocompletado del otro tipo.

### QA-COM-15 · Histórico + export (PDF/Excel)
- **Acción**: tab **Histórico** → rango de fechas (día-ART) → buscar → Exportar PDF/Excel.
- **Resultado esperado**: `GET /api/dietas?history=1&from&to`. Buscador (frase exacta primero, luego
  AND). Exporta **lo filtrado** en pantalla; PDF con orden de despacho piso→cama→turno→comensal.

### QA-COM-16 · PATCH de estado sin permiso server-side (edge de seguridad)
- **Precondición**: cualquier usuario que tenga el **módulo Gestión Comandas**.
- **Acción**: entregar/anular/volver-a-pendiente/reubicar.
- **Resultado esperado**: **el PATCH NO chequea permiso** server-side (la restricción es de UI). QA a
  validar contra el diseño esperado. (La única puerta server-side de comandas es `sin_dieta` y la carga
  por turno con `permitsMealSlotLoad`.)

### QA-COM-17 · Rol solo-granular (p.ej. solo `cargar_comanda_almuerzo`) → 403 en otros turnos
- **Precondición**: rol con **solo** `cargar_comanda_almuerzo`.
- **Acción**: cargar **cena**.
- **Resultado esperado**: UI esconde los turnos no habilitados (candado); el server responde **403** en
  los demás. Se resuelve por **user-id del JWT** (un token viejo con permisos de más no sirve).

### Planificación de menú

### QA-COM-18 · Crear planificación
- **Precondición**: `abm_planificacion`. Gestión de Comandas → "Planificación" → "Nueva planificación".
- **Acción**: turno, tipo (**Menú/Opción**), Desde, Hasta, texto ≤255 → Crear.
- **Resultado esperado**: `POST /api/carga-menu` → 201, sin solapamiento por (turno,tipo).

### QA-COM-19 · Solapamiento de planificación → 409
- **Acción**: crear/editar un rango que pisa otro del mismo (turno,tipo), aunque toquen un solo día.
- **Resultado esperado**: **409** con `conflictingId` y mensaje inline en el modal.

### QA-COM-20 · Planificación vencida es read-only → 409
- **Precondición**: planificación con `fecha_fin < hoy-ART`.
- **Acción**: intentar editar/eliminar (aunque la grilla stale muestre botones).
- **Resultado esperado**: **409 `planificacion_vencida`**. En la grilla, las vencidas están disabled.

### QA-COM-21 · DB de planificación caída → 502 (no `[]` mentiroso)
- **Precondición**: la lectura de `carga_menu` falla.
- **Acción**: abrir el modal de planificación / disparar autocompletado.
- **Resultado esperado**: `GET /api/carga-menu` → **502** (falla DURA visible), **no** una lista vacía
  (para que Nutrición no escriba a mano creyendo que no había planificación).

### QA-COM-22 · Fechas / zona horaria (off-by-one cerca de medianoche)
- **Acción**: cargar comandas cerca de medianoche ART; usar rangos de planificación que cruzan de día.
- **Resultado esperado**: "hoy" = **día-ART (UTC-3)**; las fechas de planificación se comparan como
  string `'YYYY-MM-DD'` (nunca `new Date()`). Verificar que no haya corrimiento de día.

### Códigos de error — Comandas
- `POST /api/dietas`: 400 (bedLabel/comida/tipo/comensal inválidos, detalle OTROS vacío, >6
  acompañantes), 403 (turno no permitido), 409 (`sin_dieta`, `comanda_entregada`, "ya no existe"), 500,
  503.
- `PATCH /api/dietas`: 409 `comanda_entregada`; 400 (action inválido / falta spItemId o bedLabel+comida);
  200 idempotente ("No active meal found"); reubicar → 400 / 502 / 500.
- `GET /api/dietas`: siempre **200** (fail-soft `{meals:[]}`).
- `carga-menu`: GET 403/502/200 · POST 403/400/409(solapamiento)/502/201 · PATCH
  403/400/409(no-existe|vencida|solapamiento)/502 · DELETE 403/400/200(alreadyInactive)/409(vencida)/502.

---

## 6. Permisos por rol — qué ve / qué hace cada uno

### QA-ROL-01 · Matriz de visibilidad por rol
- **Precondición**: un usuario por rol (sección 0.2).
- **Resultado esperado** (login → landing = primer módulo accesible;
  orden Home→Operativa→Mapa→Historial→Limpieza→Comandas):

| Rol | Ve en sidebar | Puede hacer |
|---|---|---|
| Admisión | Home, Operativa, Historial, Mapa | Crear/editar/cancelar/consolidar traslados |
| Azafata | Operativa, Mapa | Habitación Lista / Iniciar Traslado / Recepción OK (**solo su piso**), marcar limpia |
| Enfermería | Mapa | Solo lectura del mapa |
| Catering | Mapa | Solo lectura + ver comandas (`ver_dieta`) |
| Nutrición | Mapa, Gestión de Comandas | Cargar comandas + planificación |
| Supervisor Limpieza | Gestión Limpieza | Consolidar limpiezas |
| Admin | Todos | Todo + ABM usuarios/roles |

### QA-ROL-02 · Rol NO encontrado en `public.roles` → solo-lectura
- **Precondición**: usuario cuyo `Perfil_U` **no matchea** ningún `roles.name` (borrado/renombrado/typo).
- **Acción**: login.
- **Resultado esperado**: **loguea igual** pero queda `permissions:[]`, `modules:[]` → **solo-lectura**,
  landing HOME potencialmente vacío.

### QA-ROL-03 · ABM de Roles (crear/editar/eliminar)
- **Precondición**: Admin con módulo Configuración + `abm_roles`.
- **Acción**: Configuración → Roles → "Nuevo Rol" → nombre + tildar Módulos → tildar Permisos
  (agrupados por módulo; un grupo solo se renderiza si su módulo está tildado, salvo "Notificaciones"
  que es cross-module) + toggles `filter_by_floors` / `bypass_location_check` → Crear.
- **Resultado esperado**: `POST /api/roles` → `public.roles` + `invalidateRoleCache()`. Editar/Eliminar
  (soft-delete `status='Inactivo'`). Si el admin edita **su propio** rol, la sesión se refresca sin
  re-loguear.

### QA-ROL-04 · Nombre de rol duplicado (case-insensitive) → 409
- **Acción**: crear "Enfermeria" y luego "ENFERMERIA".
- **Resultado esperado**: **409** "Ya existe un rol con ese nombre" (unique index `lower(name)`, PG 23505).

### QA-ROL-05 · Reasignar un usuario a OTRO rol → recién al re-loguear
- **Precondición**: usuario logueado con rol A.
- **Acción**: Admin cambia su rol a B.
- **Resultado esperado**: **sigue con permisos/módulos de A** hasta **cerrar sesión** (el
  `syncSessionRole` de 60s refresca por el `roleName` **viejo**, no capta el cambio de rol).

### QA-ROL-06 · Editar permisos del rol propio → efecto en ≤60s (sin re-login)
- **Precondición**: rol con usuarios logueados.
- **Acción**: quitar/agregar un permiso al rol (sin cambiar de rol).
- **Resultado esperado**: los usuarios de ese rol ven cambiar botones y push en el próximo
  `syncSessionRole` (~60s) / re-envío. `role-cache` TTL 5min pero `invalidateRoleCache()` lo acelera.

### QA-ROL-07 · Quitar TODOS los permisos a un rol
- **Acción**: PATCH con `permissions:[]`.
- **Resultado esperado**: escribe el array vacío (warning en log). Los usuarios pierden botones y dejan
  de recibir push.

### QA-ROL-08 · ABM de Usuarios (siguen en SharePoint)
- **Precondición**: Admin con `abm_usuarios`.
- **Acción**: Configuración → Usuarios → "Nuevo Usuario" (username auto: 3 letras nombre + apellido) →
  Rol → credenciales → si el rol tiene `filterByFloors`, aparece **"Sectores Asignados"** → Crear.
- **Resultado esperado**: `POST /api/users` → **SharePoint `00.Usuarios`** (los usuarios **NO** migraron
  a Supabase). Editar propaga rol/áreas a `push_subscriptions` de Supabase **en el acto**. Eliminar =
  soft-delete `Status_U='Inactivo'`.

### QA-ROL-09 · Editar áreas de un usuario logueado
- **Acción**: cambiar los sectores asignados de un usuario logueado.
- **Resultado esperado**: `users.ts` propaga a `push_subscriptions` **al instante** (el push filtra
  bien), **pero** `user.assignedAreas` de la sesión del cliente **no** se refresca por `syncSessionRole`
  (solo módulos/permisos/flags) → el filtro de UI del mapa usa las áreas **viejas** hasta re-login.

### QA-ROL-10 · Login con username o email; password en texto plano
- **Acción**: loguear con `UsuarioApp_Usr` y también con `Mail_U`.
- **Resultado esperado**: ambos válidos (mismo campo). `POST /api/auth` valida contra `00.Usuarios`
  (`Aplicacion_U='Traslados' AND Status_U='Activo'`). Password comparado en **texto plano**.
- **Bordes**: usuario inexistente/inactivo o password incorrecto → **401**; falta username/password →
  **400**; brute-force → **429** con `Retry-After`.

### QA-ROL-11 · Validación de ubicación con bypass por rol
- **Precondición**: rol con `bypass_location_check=true`, usuario logueado **fuera del hospital**.
- **Acción**: dejar la sesión abierta (revalida cada 60s).
- **Resultado esperado**: **NO** lo patea — la decisión es **server-side fresca** (`validate-location`
  hace lookup del rol; no confía en el flag del cliente). Sin bypass y `sede≠SUMAR`: valida IP/GPS
  contra `99.ABM_GeoIPS`; 3 fallos consecutivos (~3 min, histéresis) antes de logout; fail-open ante
  errores de red.

### QA-ROL-12 · Token "no expira" (10 años)
- **Resultado esperado**: la sesión sobrevive tiempo indefinido (`EXPIRY_DEFAULT='3650d'`, pese a
  comentarios "8h" en `api/jwt.ts`/`api/auth.ts` que **mienten**). El único logout automático es por
  ubicación revocada.

---

## 7. Notificaciones — quién recibe qué

> **Dos caminos de push** (ambos leen `push_subscriptions` + `roles` de Supabase y filtran por
> entorno): (1) **Traslados** → Edge Function `notify-push` (webhook pg_net sobre `public.traslados`).
> (2) **Dietas/ayunos/limpieza** → `api/push-utils.ts` (web-push desde Vercel).
> **Comandas NO emite push.**

### QA-NOT-01 · Matriz notificación → permiso
- **Resultado esperado** (`NOTIF_TYPE_TO_PERMISSION`, idéntico client/server): un suscriptor recibe el
  tipo X **sii** su rol tiene el permiso mapeado **y** pasa los demás filtros.

| Evento | Tipo push | Permiso requerido |
|---|---|---|
| Traslado creado | NEW_TICKET | `notif_new_ticket` |
| 'Habitacion Lista' / 'En Traslado' / 'Cancelado' / 'Consolidado' | STATUS_UPDATE | `notif_status_update` |
| 'Por Consolidar' (recepción) | RECEPTION_CONFIRMED | `notif_reception_confirmed` |
| Cambio de dieta (cron) | DIET_CHANGE | `notif_diet_change` |
| Cambio de ayuno (cron) | FASTING_CHANGE | `notif_fasting_change` |
| Habitación limpia | ROOM_CLEANED | `notif_habitacion_limpia` |

### QA-NOT-02 · El actor NO se autonotifica
- **Precondición**: Admisión crea un traslado.
- **Resultado esperado**: **NO** le llega su propio NEW_TICKET (`excludeUser = created_by_id` en INSERT,
  `last_actor_id` en UPDATE). El resto del piso destino **sí**. El actor **sí** ve una notificación
  **in-app local** (addNotification optimista).

### QA-NOT-03 · Filtro por piso en el push (azafata)
- **Precondición**: traslado a **Piso 6**. Azafatas de Piso 5 y Piso 6 suscriptas con
  `notif_status_update`.
- **Resultado esperado**: solo la de **Piso 6** recibe (subAreaMatches, con remapeo HRA→piso real del
  otro extremo). ≥9 áreas = full access (recibe todo).

### QA-NOT-04 · WAITING_ROOM no dispara push
- **Precondición**: crear traslado que arranca en 'Esperando Habitacion' (destino En preparación).
- **Resultado esperado**: llega el **NEW_TICKET** del INSERT, pero **NO** un STATUS_UPDATE ('Esperando
  Habitacion' no tiene label en STATUS_LABELS).

### QA-NOT-05 · Sin duplicados ("TIN TIN TIN")
- **Precondición**: forzar dos updates a la misma versión de fila / reintento del webhook / multi-device.
- **Resultado esperado**: **una sola** burbuja por transición (webhook 1-vez-por-fila +
  `push_dispatch_log` idempotente key `id_univoco:status:updated_at` + UNIQUE(endpoint)).

### QA-NOT-06 · Catering recibe texto custom en recepción
- **Precondición**: recepción confirmada (RECEPTION_CONFIRMED).
- **Resultado esperado**: **Catering** ve "Traslado concretado — {paciente} pasó de Habitación X (Piso)
  a Habitación Y (Piso)", distinto del resto ("Recepción Confirmada").

### QA-NOT-07 · Suscripción stale (>36h) no recibe
- **Precondición**: dispositivo sin abrir la PWA **>36h** (sin heartbeat).
- **Resultado esperado**: **no** recibe push aunque el rol tenga el permiso (`last_seen_at > 36h` se
  descarta). El heartbeat cada 6h la mantiene viva mientras la app esté abierta.

### QA-NOT-08 · Self-heal ante VAPID rotado
- **Precondición**: rotar el par VAPID (las 3 puntas: Vercel Production, secrets de la Edge Function,
  `VITE_VAPID_PUBLIC_KEY` del build).
- **Acción**: reabrir la PWA (mount/F5).
- **Resultado esperado**: `subscribeToPush` detecta que la `applicationServerKey` no matchea →
  **unsubscribe + re-suscribe**. Los **403** de push **NO** borran la sub (solo 404/410). Si las 3
  puntas no coinciden → nadie recibe (403 silencioso).

### QA-NOT-09 · Aislamiento entre entornos (PHI)
- **Precondición**: suscribir en **PRODUCTIVO**.
- **Acción**: disparar un evento en **TESTING**.
- **Resultado esperado**: **no** le llega (el push filtra por entorno; default 'TESTING'). Verificar
  también que `/api/supabase-token` en Production firme `entorno=PRODUCTIVO` (si firmara TESTING → fuga
  cross-entorno de datos vía Realtime+RLS).

### QA-NOT-10 · Campanita in-app
- **Acción**: recibir un evento y abrir la campana.
- **Resultado esperado**: `GET /api/notifications` (no-leídas o `?window=24h`). Marcar leída: `PATCH
  /api/notifications` (por id, por evento `ticketId+type`, o `markAllForUser`).

---

## 8. Realtime (auto-refresh sin recargar)

### QA-RT-01 · Auto-refresh de traslados/limpiezas/comandas
- **Precondición**: dos sesiones abiertas en el mismo entorno.
- **Acción**: en la sesión A, mover un traslado / marcar una cama limpia / cargar una comanda.
- **Resultado esperado**: la sesión B se actualiza **sola, sin F5** (canales `traslados-live`,
  `limpiezas-live`, `comandas-live` → refetch debounced 300ms). **Beds NO usa Realtime**: poll cada 60s.

### QA-RT-02 · Catch-up tras desconexión
- **Precondición**: sesión con Realtime activo.
- **Acción**: cortar la red ~2 min, mover un traslado desde otro dispositivo, reconectar.
- **Resultado esperado**: al (re)SUBSCRIBE se hace **fetch fresco** (catch-up) — Realtime no reenvía lo
  perdido. La grilla se pone al día.

### QA-RT-03 · Realtime no pisa una edición local en vuelo
- **Precondición**: cargar una comanda (optimista) mientras llega un evento `comandas-live`.
- **Resultado esperado**: el refetch respeta el optimistic update en vuelo (`mealsWritingRef`) — no
  parpadea ni revierte.

### QA-RT-04 · Pase vence a la hora, Realtime sigue vivo
- **Precondición**: dejar la app abierta **>1h**.
- **Resultado esperado**: el cliente **re-mintea** el pase ES256 on-demand (cache `no-store`
  obligatorio) y Realtime sigue funcionando. Si el pase caducara sin renovarse, Realtime caería.

### QA-RT-05 · Beds stale ante fallo de Gamma
- **Precondición**: Gamma responde parcial/504.
- **Resultado esperado**: el poll de beds conserva los datos anteriores (fail-open, header
  `X-Beds-Stale`); nunca pisa el cache con datos parciales.

---

## 9. Versionado de build (APP_VERSION)

### QA-VER-01 · Badge de versión en login y sidebar
- **Precondición**: build actual (hoy `v20260731_1.0.1`, `lib/version.ts`).
- **Resultado esperado**: se muestra el badge de versión en **login** y **sidebar**; en login se guarda
  en `localStorage.mediflow_version`.

### QA-VER-02 · Columna `version` estampada en cada escritura
- **Acción**: crear/mover un traslado, marcar una cama limpia, cargar una comanda.
- **Resultado esperado**: la fila en Supabase (`traslados`/`limpiezas`/`comandas`) tiene
  `version = APP_VERSION`. Un cliente con **build viejo cacheado** escribe una versión distinta (o `''`
  si es pre-feature) → señal para soporte de quién corre build viejo.

---

## 10. Infra / RLS / pase (aislamiento y seguridad)

### QA-INF-01 · Sin token → sin datos (fallback seguro)
- **Precondición**: cliente sin `mediflow_token`.
- **Resultado esperado**: el pase queda `''` → conexión anon → **RLS no deja ver nada**.

### QA-INF-02 · RLS de escritura denegada al cliente
- **Precondición**: intentar escribir directo a Supabase con el pase `authenticated` (no vía backend).
- **Resultado esperado**: **denegado** (las tablas transaccionales solo tienen policy de SELECT por
  entorno; las escrituras van por `service_role` a través de los endpoints). `roles` y
  `push_subscriptions`: RLS ON **sin policies** (candado total, solo backend).

### QA-INF-03 · 503 si faltan envs de Supabase
- **Precondición**: entorno sin las envs de Supabase / sin `SUPABASE_JWT_PRIVATE_KEY`.
- **Resultado esperado**: los endpoints devuelven **503** ("Supabase no configurado"); `/api/supabase-token`
  falla si falta la clave privada.

---

## 11. Resumen de códigos de error esperados

| Código | Dónde | Significado |
|---|---|---|
| **400** | tickets/eventos/obs/dietas/carga-menu | falta campo obligatorio; detalle OTROS vacío; >6 acompañantes; action inválido |
| **401** | auth / requireAuth | credenciales incorrectas / usuario inactivo / token inválido |
| **403** | tickets PATCH | azafata fuera de sus pisos asignados |
| **403** | dietas POST | turno no permitido (`permitsMealSlotLoad`) |
| **403** | carga-menu | sin `ver_planificacion` / `abm_planificacion` |
| **409** | tickets POST/PATCH | cama destino ya asignada a otro traslado activo (`conflictingTicketId`) |
| **409** | dietas | `sin_dieta` · `comanda_entregada` · "ya no existe" |
| **409** | carga-menu | solapamiento (`conflictingId`) · `planificacion_vencida` |
| **409** | roles POST | nombre de rol duplicado (case-insensitive, PG 23505) |
| **429** | auth | rate-limit anti brute-force (`Retry-After`) |
| **502** | carga-menu GET / dietas reubicar | la DB de planificación/lookup cayó (falla dura, no `[]`) |
| **503** | tickets/limpiezas/dietas/carga-menu/roles | Supabase no configurado (falta env) |
| **500** | todos | fallo de escritura / error interno |
| **200 fail-soft** | dietas GET · limpiezas GET | devuelve `{meals:[]}` / `{cleanings:[]}` en vez de error |
| **304** | beds | `If-None-Match` sin cambios (poll con ETag) |
| **X-Beds-Stale** (header) | beds | cache servido ante fallo parcial de Gamma |

---

## 12. Regresiones históricas a vigilar (no romper)

- **"Se cargan y desaparecen"** (traslados): un POST de creación fallido (no-409) debe hacer **rollback**
  del optimista, sin ticket fantasma (QA-TRA-22).
- **"TIN TIN TIN"** (push duplicado): una sola notif por transición (QA-NOT-05).
- **Doble-asignación de cama destino**: garantizada por índice único parcial → 409 (QA-TRA-15/12).
- **Ayuno/dieta fantasma** en cama que el paciente recién dejó: el enrich solo se aplica a camas cuyo
  eventKey está en `obtenermapacamasocupadas` (QA-LIM-12, mapa).
- **Comanda de ayer se pisa**: resuelto con columna GENERATED `dia` + reuso/reactivación de pendientes
  (QA-COM-11).

---

## Próximamente (planificado, NO construido)

- **Traslados a Cirugía** — feature **planificada**, no implementada (ver
  [plan-traslados-cirugia.html](../planes/plan-traslados-cirugia.html)). No debe testearse como existente todavía.
