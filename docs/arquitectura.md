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
| Base de datos | SharePoint Online (listas) vía Microsoft Graph API |
| API externa | Grupo Gamma REST API (mapa de camas, pacientes, eventos) |
| Autenticación | JWT (jose) con tokens de 8h |
| Notificaciones | Web Push (VAPID) + Service Worker |
| Deploy | Vercel |

---

## 2. Estructura de directorios

```
solicitudes-gamma/
├── App.tsx                  # Componente raíz: login, layout, routing, modales
├── index.tsx                # Entry point React
├── types.ts                 # Tipos, enums e interfaces compartidas
├── api/                     # Serverless functions (Vercel / dev-server)
│   ├── auth.ts              # Login contra SP (00.Usuarios)
│   ├── beds.ts              # Proxy a API Gamma (mapa de camas)
│   ├── tickets.ts           # CRUD de traslados (07.Traslados)
│   ├── ticket-events.ts     # Log de movimientos (08.DetalleTraslados)
│   ├── users.ts             # ABM de usuarios (00.Usuarios)
│   ├── roles.ts             # ABM de roles (99.ABMRoles_Traslados)
│   ├── isolations.ts        # Aislamientos (08.Aislamientos)
│   ├── notifications.ts     # Historial de notificaciones (10.Notificaciones)
│   ├── push-subscribe.ts    # Registro de suscripciones push (09.PushSubscriptions)
│   ├── push-utils.ts        # Envío de push a suscriptores
│   ├── validate-location.ts # Validación IP/geolocalización (99.ABM_GeoIPS)
│   ├── graph.ts             # Helper Microsoft Graph (token cache + fetch)
│   ├── jwt.ts               # Sign/verify JWT + middleware requireAuth
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
│   ├── Icons.tsx            # Re-exports de lucide-react
│   ├── GammaLogo.tsx        # Logo SVG
│   ├── NotificationToast.tsx
│   ├── NotificationsDropdown.tsx
│   └── StatusBadge.tsx
├── lib/
│   ├── utils.ts             # cn(), formatDate, calculateTicketMetrics
│   ├── constants.ts         # Áreas, mock data, constantes de negocio
│   ├── mock-api-data.ts     # Datos de prueba (camas y tickets)
│   ├── pushSubscription.ts  # Suscripción push client-side
│   └── real-beds-data.ts    # Datos reales de referencia
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
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (React SPA)                  │
│                                                         │
│  App.tsx ──► useHospitalState() ──► Views + Components  │
│                   │                                     │
│           authFetch() con JWT                           │
│                   │                                     │
│         ┌─────────▼──────────┐                         │
│         │   /api/* endpoints │                         │
│         └─────────┬──────────┘                         │
└───────────────────┼─────────────────────────────────────┘
                    │
        ┌───────────┼───────────┐
        ▼                       ▼
 Microsoft Graph API      Grupo Gamma API
 (SharePoint Online)      (VM 35.224.5.114)
        │                       │
        ▼                       ▼
 Listas SharePoint        Endpoints REST
 (00.Usuarios,            (obtenermapacamas,
  07.Traslados,            consultarpaciente,
  08.Aislamientos,         obtenereventointernacion)
  09.PushSubscriptions,
  10.Notificaciones,
  99.ABMRoles_Traslados,
  99.ABM_GeoIPS)
```

### 3.2. Flujo de autenticación

1. El usuario ingresa email y contraseña en el formulario de login (`App.tsx`).
2. `useHospitalState.handleLogin()` envía `POST /api/auth` con las credenciales.
3. `api/auth.ts` busca en la lista SharePoint `00.Usuarios` un usuario activo cuyo `UsuarioApp_Usr` coincida y verifica la contraseña contra `Password_Usr`.
4. Si es válido, firma un JWT (HS256, 8h de vida) con `jose` conteniendo `id`, `name`, `role`, `sede`, `email`.
5. El token se guarda en `localStorage` (`mediflow_token`) y se envía como `Authorization: Bearer <token>` en todos los requests posteriores via `authFetch()`.
6. El middleware `requireAuth` en cada endpoint verifica el token antes de procesar.
7. Se monitorea la expiración del token cada 60s; a los 15 min restantes se muestra un banner de advertencia. Al expirar, se hace logout automático.

**Excepción:** las Azafatas (`HOSTESS`) reciben un token con expiración de ~10 años para evitar re-login frecuente en dispositivos compartidos.

### 3.3. Flujo de un traslado (ciclo de vida del Ticket)

```
 WAITING_ROOM ──► IN_TRANSIT ──► IN_TRANSPORT ──► WAITING_CONSOLIDATION ──► COMPLETED
 (Esperando       (Habitación    (En Traslado)    (Por Consolidar)          (Consolidado)
  Habitación)      Lista)
                                                                      ──► REJECTED
                                                                          (Cancelado)
```

| Estado | Quién actúa | Acción |
|--------|-------------|--------|
| `WAITING_ROOM` | Admisión crea el ticket | `POST /api/tickets` + `POST /api/ticket-events` |
| `IN_TRANSIT` | Housekeeping confirma limpieza o cama ya limpia | `PATCH /api/tickets` (status + cleaningDoneAt) |
| `IN_TRANSPORT` | Se inicia el traslado físico | `PATCH /api/tickets` (status + transportStartedAt) |
| `WAITING_CONSOLIDATION` | Se confirma recepción del paciente | `PATCH /api/tickets` (status + receptionConfirmedAt) |
| `COMPLETED` | Admisión consolida | `PATCH /api/tickets` (status + completedAt) |
| `REJECTED` | Cualquiera con permiso cancela | `PATCH /api/tickets` (status + rejectionReason) |

Cada transición genera:
- Un evento en `08.DetalleTraslados` (via `POST /api/ticket-events`) para trazabilidad.
- Una notificación push a los suscriptores relevantes (via `push-utils.ts`).
- Una notificación in-app detectada por polling (en `useHospitalState`).

### 3.4. Polling y sincronización en tiempo real

El hook `useHospitalState` implementa polling dual:

- **Tickets:** cada **8 segundos** (`GET /api/tickets?all=1`). Usa **ETag** para evitar transferir datos sin cambios (responde `304 Not Modified`).
- **Camas:** cada **60 segundos** (`GET /api/beds`). La API de Gamma cambia menos frecuentemente.
- **Aislamientos:** se cargan al inicio de la sesión junto con camas y tickets (`fetchIsolations()`).

**Camas con cache y ETag:** El endpoint `/api/beds` tiene cache server-side de 45s y soporte ETag. El frontend envía `If-None-Match` y recibe `304` si nada cambió, evitando transferir datos innecesarios.

**Enriquecimiento on-demand:** Los datos detallados del paciente (DNI, edad, sexo, diagnóstico) se cargan al click en una cama via `/api/bed-enrich`, con cache server-side de 10 minutos por paciente. Solo 2 llamadas a Gamma por click.

**Resiliencia en camas:** Si un poll de camas falla (error HTTP, JSON inválido, array vacío), se conservan los datos anteriores. Si Gamma responde con camas sin ocupación pero el estado anterior tenía ocupadas, se descarta la respuesta (fallo parcial de Gamma).

**Detección de cambios:** Al recibir tickets actualizados, se compara un snapshot previo (`Map<id, status>`) contra los datos nuevos. Los cambios generan notificaciones in-app con sonido (Web Audio API, dos notas: G5 + C6).

**Protección de escritura:** Un `writingRef` bloquea el polling mientras se está escribiendo a SharePoint para evitar condiciones de carrera donde datos obsoletos sobrescriban el estado optimista.

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

### 4.3. `api/tickets.ts` — CRUD de Traslados

Mapea bidireccionalmente entre el modelo `Ticket` de la app y los campos internos de SharePoint (`IDUnivocoTraslado_T`, `Paciente_T`, `Status_T`, etc.). Soporta:
- `GET` — tickets activos o historial completo (`?all=1`). Genera ETag para optimizar polling.
- `POST` — crea ticket en SharePoint. Dispara push notification asíncrona.
- `PATCH` — actualiza campos. Dispara push notification en cambios de estado relevantes.

### 4.4. `api/validate-location.ts` — Validación de ubicación

Verifica que el usuario acceda desde una ubicación autorizada:
- **IP:** compara el subnet del cliente contra prefijos permitidos en la lista `99.ABM_GeoIPS`.
- **Geolocalización:** calcula distancia Haversine contra coordenadas permitidas (radio 200m, ver `GEO_RADIUS_METERS` en [api/location-check.ts](api/location-check.ts)).
- **Fail-open:** si la validación falla técnicamente, se permite el acceso para no bloquear operaciones hospitalarias.

### 4.5. Otros endpoints

| Endpoint | Lista SP | Función |
|----------|----------|---------|
| `api/users.ts` | `00.Usuarios` | CRUD de usuarios (soft-delete via `Status_U = 'Inactivo'`) |
| `api/roles.ts` | `99.ABMRoles_Traslados` | CRUD de roles con permisos por módulo |
| `api/isolations.ts` | `08.Aislamientos` | Activar/desactivar aislamiento por paciente |
| `api/ticket-events.ts` | `08.DetalleTraslados` | Log de movimientos por ticket |
| `api/notifications.ts` | `10.Notificaciones` | Historial de notificaciones por usuario |
| `api/push-subscribe.ts` | `09.PushSubscriptions` | Registro de suscripciones Web Push |

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
- `handleCreateTicket`, `handleEditTicket`, `handleValidateTicket`, `handleAssignBedAction`, `handleHousekeepingAction`, `handleStartTransport`, `handleCompleteTransport`, `handleRoomReady`, `handleConfirmReception`, `handleConsolidate`, `handleRejectTicket` — ciclo de vida del ticket.
- `fetchBeds`, `fetchTickets`, `refreshAll` — fetch manual (este último invalida ETags y trae camas + tickets + aislamientos en paralelo; se dispara desde el botón "Refrescar" del mapa).
- `toggleIsolation(bedLabel, nextTypes?)` — aislamientos multi-tipo (`nextTypes` es array; `undefined` o `[]` borra todos los tipos del paciente).
- `handleUpdateUserAreas` — áreas de azafata.
- Setters: `setCurrentView`, `setActiveRole`, `setLoginEmail`, etc.

**Merge de camas:** la función `mergeBeds()` combina los datos reales de Gamma con el estado de los tickets activos para reflejar camas asignadas, en preparación u ocupadas por un traslado en curso.

**Edición de ticket (`handleEditTicket`):** admite cambiar workflow, destino, motivo de cambio, financiador ITR, observaciones y aislamiento (este último afecta al paciente globalmente, no solo al ticket). Valida que la nueva cama destino siga `AVAILABLE` o `PREPARATION` al momento del guardado (protege contra race conditions con otros admins), recalcula `status` y `targetBedOriginalStatus` según el estado Gamma de la nueva cama, y registra un único evento `"Modificacion - {cambios} - Motivo: {motivo}"` en `08.DetalleTraslados` con los cambios concatenados por ` | `. La liberación de la cama vieja es **implícita** gracias a `mergeBeds`: al dejar de apuntar a ella, el overlay se retira y la cama vuelve a mostrar su estado Gamma original (respeta AVAILABLE vs PREPARATION).

**Polling:**
- `tickets`: cada 8 s.
- `beds`: cada 60 s.
- `isolations`: cada 30 s (antes solo se cargaba al login, lo que causaba que cambios de aislamiento no se propagaran a otros dispositivos hasta re-loguear).

### 5.3. Vistas

| Vista | Acceso | Descripción |
|-------|--------|-------------|
| `DashboardView` | Admin, Admisión | KPIs (activos, completados, espera media), gráficos (volumen por hora, donut de estados), tickets recientes |
| `RequestsView` | Admin, Admisión, Azafata | Tabla de tickets activos con acciones contextuales por rol. Tabs de filtro por perfil operativo. Búsqueda y ordenamiento |
| `HistoryView` | Todos | Tickets completados/cancelados. Filtros por fecha, estado, tipo. Exportación a Excel (XLSX). Modal de auditoría con timeline |
| `BedsView` | Todos | Grilla visual de camas por sector/piso. Código de colores por estado. Detalle expandido del paciente. Exportación a PDF. Aislamientos |
| `UserManagementView` | Admin | ABM de usuarios. CRUD contra SharePoint. Asignación de pisos a azafatas |
| `RoleManagementView` | Admin | ABM de roles. Permisos por módulo (Home, Operativa, Historial, Mapa, Config) |

---

## 6. Sistema de roles y permisos

Los roles y sus permisos se gestionan dinámicamente desde la lista SharePoint `99.ABMRoles_Traslados`. El campo `Acceso_RT` define qué módulos puede ver cada rol, separados por `/`.

### 6.1. Roles configurados en SharePoint

| Rol (NombreRol_RT) | Status_RT | Acceso_RT (módulos permitidos) |
|---------------------|-----------|-------------------------------|
| **Admin** | Activo | Home / Operativa / Historial / Mapa de Camas / Configuracion |
| **Admision** | Activo | Home / Operativa / Historial / Mapa de Camas |
| **Azafata** | Activo | Operativa / Historial / Mapa de Camas |
| **Enfermeria** | Activo | Mapa de Camas |
| **Catering** | Activo | Mapa de Camas |

> **Nota:** todos los registros tienen `Title = [sumar]` (convención de la app para identificar items propios en SharePoint).

### 6.2. Mapeo de módulos a vistas

| Módulo (Acceso_RT) | Vista en la app | Descripción |
|---------------------|-----------------|-------------|
| Home | `DashboardView` | Monitor con KPIs y gráficos |
| Operativa | `RequestsView` | Tabla de tickets con acciones por rol |
| Historial | `HistoryView` | Tickets completados/cancelados, export XLSX |
| Mapa de Camas | `BedsView` | Grilla visual de camas, detalle paciente, export PDF |
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
- **Admin:** es el único rol con acceso a Configuración, que incluye tanto el ABM de usuarios como el ABM de roles.

---

## 7. Notificaciones

### 7.1. In-app (polling)

El hook `useHospitalState` detecta cambios entre polls comparando el snapshot de `id → status`. Genera objetos `Notification` que se muestran como:
- **Toast:** banner efímero con sonido (Web Audio, dos tonos G5+C6).
- **Dropdown:** listado de notificaciones con marca de lectura.

Filtrado por relevancia: las Azafatas solo reciben notificaciones de tickets en sus áreas asignadas.

### 7.2. Web Push

Flujo:
1. Al login, `lib/pushSubscription.ts` registra la suscripción del navegador vía `POST /api/push-subscribe`.
2. Al crear o actualizar un ticket, `api/push-utils.ts` consulta `09.PushSubscriptions`, filtra por rol/área/sede, y envía la notificación con `web-push`.
3. El Service Worker (`src-sw/sw.ts`) recibe el push, muestra una notificación nativa, y al hacer click redirige a la app.
4. Cada notificación enviada se registra en `10.Notificaciones` para historial.

Las suscripciones expiradas (HTTP 404/410) se limpian automáticamente.

---

## 8. PWA (Progressive Web App)

- **vite-plugin-pwa** con estrategia `injectManifest` genera el Service Worker.
- El manifest configura la app como `standalone` con nombre "Grupo Gamma - Gestión de Traslados".
- El SW precachea assets estáticos y excluye `/api/` del fallback de navegación.
- `vercel.json` configura el header `Service-Worker-Allowed: /` para el SW.
- **Instalación en Android:** el sidebar mobile muestra un botón "Instalar App" (solo en Android) que captura el evento `beforeinstallprompt` del browser y dispara el prompt de instalación nativo. Desaparece tras instalar o si la app ya está instalada.

---

## 9. Listas SharePoint utilizadas

| Lista | ID | Propósito |
|-------|----|-----------|
| `00.Usuarios` | `e623ad06-ff62-441f-b67d-666224af5805` | Usuarios de la app (login, ABM) |
| `07.Traslados` | `c7417674-9084-416d-a955-7024161a3194` | Tickets de traslado |
| `08.DetalleTraslados` | `bd50c2be-0ec7-45d7-b1f5-abf10546675d` | Log de movimientos por ticket |
| `08.Aislamientos` | `0a36e3e2-1ca2-4951-86f9-afd288465022` | Aislamientos activos por paciente |
| `09.PushSubscriptions` | `648fde7b-89d2-40ac-bc4a-63661508b50a` | Suscripciones Web Push |
| `10.Notificaciones` | `240f00dd-715b-4c78-9661-3147b7650a0f` | Historial de notificaciones |
| `99.ABMRoles_Traslados` | `68836bbe-18c5-4cb2-8cc6-e21ecae96710` | Roles y permisos |
| `99.ABM_GeoIPS` | `c30a13f0-070a-45bf-9ff2-415b36325af5` | IPs y geolocalizaciones permitidas |

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

Variables de entorno necesarias en `.env.local`:
- `AZURE_TENANT_ID`, `AZURE_CLIENTE_ID`, `AZURE_CLIENT_SECRET` — Microsoft Graph
- `SHAREPOINT_SITE_ID` — Site de SharePoint
- `GAMMA_VM_URL`, `CLIENT_ID`, `CLIENT_SECRET` — API de Grupo Gamma
- `JWT_SECRET` — Secreto para firmar tokens
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — Web Push
- `VITE_VAPID_PUBLIC_KEY` — Clave pública VAPID expuesta al frontend

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

El modal de detalle de paciente (`BedsView.tsx`) ahora tiene tres tabs:
- **Generales**: DNI, edad, sexo, financiador, profesional, diagnóstico (datos enriquecidos via `/api/bed-enrich`).
- **Internación**: tipo de internación (mapeado desde códigos C/CO/H/K/O/Q/R/T), fecha/hora de ingreso, profesional prescriptor.
- **Dieta**: información de dieta del paciente.

Estado: `useState<'general' | 'internacion' | 'dieta'>('general')` con reset por `useEffect` al cambiar `selectedBed?.id`.

### 12.4. Auto-update de PWA sin intervención del usuario

`vite-plugin-pwa` se configuró con auto-actualización: el SW detecta una nueva versión, la activa y refresca la página automáticamente sin mostrar prompt al usuario. Decisión motivada por el perfil del usuario hospitalario (sin conocimiento técnico).

---

## 13. Workflow types — fusión de `ROOM_CHANGE` con `INTERNAL`

`WorkflowType.ROOM_CHANGE` quedó marcado como `@deprecated` pero **no se removió del enum**: tickets viejos en `07.Traslados` con `TipoTraslado_T = 'ROOM_CHANGE'` deben seguir leyéndose. La UI los renderiza como "Traslado Interno" (mismo label que `INTERNAL`) y al editarlos se auto-mapean a `INTERNAL`.

Reglas de filtrado de origen/destino por workflow en los modales:
- `INTERNAL`: origen y destino no pueden ser ITR (`bed.area !== Area.HIT`).
- `ITR_TO_FLOOR`: origen debe ser ITR (`bed.area === Area.HIT`), destino no.

`INTERNAL` siempre requiere un motivo del dropdown `ROOM_CHANGE_REASONS` (validado en frontend y backend).

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

## 20. Separación de entornos por columna SP

Para permitir que producción y testing convivan en las **mismas listas SharePoint** sin pisarse, se agregó un campo `Entorno` a 5 listas y una variable `ENTORNO` en backend (valores `PRODUCTIVO` / `TESTING`).

| Lista | Campo | Endpoint que filtra |
|-------|-------|---------------------|
| `07.Traslados` | `Entorno_T` | [api/tickets.ts](api/tickets.ts) — GET activos, GET historial, conflict-check POST/PATCH |
| `08.Aislamientos` | `Entorno_A` | [api/isolations.ts](api/isolations.ts) — GET, POST upsert, DELETE |
| `09.PushSubscriptions` | `Entorno_PS` | [api/push-subscribe.ts](api/push-subscribe.ts) y [api/push-utils.ts](api/push-utils.ts) `fetchSubscriptions` |
| `10.Notificaciones` | `Entorno_N` | [api/notifications.ts](api/notifications.ts) GET y POST desde push-utils |
| `11.DietaSnapshot` | `Entorno_DS` | [api/cron-diet-changes.ts](api/cron-diet-changes.ts) bulk read y upsert |

`08.DetalleTraslados` no tiene columna propia — filtrado por transitividad vía `IDUnivocoTraslado_DT` (los IDs son únicos globales y el frontend solo conoce los del entorno actual).

**Contrato**:
- Cada archivo declara `const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim()` — default seguro `TESTING` evita disparar push a usuarios reales si la env no está cargada.
- Las **lecturas** filtran SP-side con `$filter=fields/Entorno_X eq '{ENTORNO}'`.
- Las **escrituras** estampan el entorno en cada POST nuevo.
- Los **PATCH/DELETE de modificación** no tocan el campo Entorno (preservan el entorno original del item).

**Setup operativo**:
- `Vercel Production` → `ENTORNO=PRODUCTIVO`
- `Vercel Preview` / dev local → `ENTORNO=TESTING`

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

Gamma expone `AYUNOS[]` en `obtenereventointernacion`. Cada entrada es un par (indicación, hora):
- `PEA_ID_INDICACION` — identifica la indicación
- `PEA_FECHA_HORA_INICIO` — desde cuándo aplica (ISO datetime)
- `PAH_HORA` — hora del día (0–23)
- `PEA_CANTIDAD_REPETICIONES` — total de ocurrencias (ciclando por las horas, día por día)

El helper `summarizeFasting()` agrupa por indicación, genera la secuencia de timestamps, y devuelve `{ hasUpcoming, nextAt, indications[].upcoming[] }`.

**UI:**
- **Tarjeta de cama**: ícono `UtensilsCrossed` (lucide-react) en círculo ámbar abajo-derecha cuando `bed.fasting.hasUpcoming`. Tooltip con próximo horario.
- **Modal de detalle**: pestaña "Ayunos" con tarjetas por indicación mostrando horas programadas y próximas 5 ocurrencias.

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
