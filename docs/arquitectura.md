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
- **Geolocalización:** calcula distancia Haversine contra coordenadas permitidas (radio 100m).
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
