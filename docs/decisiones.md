# Decisiones Técnicas — MediFlow

Registro de decisiones técnicas inferidas del código fuente. Cada entrada documenta qué se decidió, por qué, qué alternativas se descartaron y qué impacto tiene en el proyecto.

---

## 1. Arquitectura

### 1.1. SPA monolítica con routing por estado (sin react-router)

**Qué:** La navegación se resuelve con un `useState<ViewMode>` en `App.tsx`. No hay rutas URL, no hay `react-router`, no hay deep linking.

**Por qué:** La app tiene un número acotado de vistas (~6) y un único punto de entrada post-login. No se necesita compartir URLs individuales ni navegar con el botón "atrás" del browser. Simplifica el código eliminando una dependencia y la complejidad de route guards.

**Alternativas descartadas:**
- `react-router`: agregaría deep linking y navegación por URL, pero no aporta valor en un contexto hospitalario donde la app se usa como herramienta interna instalada como PWA.
- Framework fullstack (Next.js, Remix): sobredimensionado para una app que es fundamentalmente un CRUD con polling.

**Impacto:**
- No hay deep linking: no se puede compartir un link a un ticket específico.
- Toda la lógica de acceso por rol vive en `App.tsx` como condicionales de renderizado, no como route guards.
- Refrescar la página siempre lleva al usuario a la vista por defecto de su rol.

---

### 1.2. Estado global en un único custom hook (`useHospitalState`)

**Qué:** Todo el estado de la aplicación (sesión, datos, UI, polling) está en un solo hook de ~600 líneas que retorna `{ state, actions }`. Se consume exclusivamente desde `App.tsx` y se distribuye como props.

**Por qué:** Centraliza la lógica de negocio en un único lugar predecible. Evita prop drilling excesivo porque `App.tsx` orquesta las vistas como "páginas" que reciben sus datos como props. No hay componentes intermedios profundamente anidados que necesiten contexto global.

**Alternativas descartadas:**
- Redux / Zustand: agrega boilerplate y complejidad (actions, reducers, stores) para una app con un número manejable de estados. El hook centralizado logra lo mismo con menos código.
- React Context: podría aliviar algo de prop drilling, pero introduce re-renders innecesarios si no se segmenta bien. El hook ya centraliza todo, así que Context no suma claridad.
- Múltiples hooks especializados: dividiría la lógica (ej: `useAuth`, `useTickets`, `useBeds`) pero complicaría la coordinación entre ellos (ej: bloquear polls durante escritura, logout cruzado).

**Impacto:**
- `App.tsx` es un archivo grande (~500 líneas) porque orquesta modales, layout y distribución de props.
- `useHospitalState.ts` es el archivo más complejo del proyecto (~600 líneas). Todo cambio de negocio pasa por acá.
- Las vistas son componentes presentacionales puros: reciben datos y callbacks, no gestionan estado global.

---

### 1.3. Vercel Serverless Functions como backend

**Qué:** Cada endpoint es un archivo en `api/` que exporta una función `handler(req, res)`. En producción Vercel los despliega como Lambda functions. En desarrollo, `dev-server.ts` los emula.

**Por qué:** La app no necesita un servidor persistente. Cada request es independiente (stateless excepto por cache de tokens en memoria). Vercel simplifica el deploy (push to deploy) y escala automáticamente. El equipo no necesita gestionar infraestructura.

**Alternativas descartadas:**
- Express/Fastify en un servidor dedicado: requiere gestionar hosting, uptime, scaling. No aporta valor para endpoints CRUD simples.
- Edge Functions (Cloudflare Workers): incompatibles con `web-push` que requiere Node.js APIs (`crypto`).
- tRPC o GraphQL: la API tiene un número pequeño de endpoints REST predecibles. Un layer de abstracción adicional agregaría complejidad sin beneficio claro.

**Impacto:**
- Cada endpoint es autocontenido: importa sus dependencias, maneja CORS, parsea body.
- No hay middleware compartido excepto `requireAuth` (importado manualmente en cada handler).
- El `dev-server.ts` emula la interfaz de Vercel (`req.body`, `req.query`, `res.status().json()`) para desarrollo local sin depender de `vercel dev`.
- Los tokens de Gamma y Graph se cachean en memoria del módulo, lo que funciona bien con invocaciones "warm" de Vercel pero se pierde en cold starts.

---

### 1.4. Dev server custom en lugar de `vercel dev`

**Qué:** `dev-server.ts` es un servidor HTTP de ~145 líneas que carga dinámicamente los handlers de `api/` y adapta `req`/`res` al formato Vercel.

**Por qué:** `vercel dev` puede ser lento, inestable, o requerir configuración adicional. Un servidor custom en `tsx` arranca instantáneamente, es predecible y fácil de debuggear. Además, permite correr sin tener la CLI de Vercel instalada.

**Alternativas descartadas:**
- `vercel dev`: la opción oficial, pero agrega una dependencia pesada y a veces tiene bugs con hot reload.
- Mock server (MSW, json-server): no ejecuta la lógica real de los handlers, solo simula respuestas.

**Impacto:**
- El proxy de Vite (`/api → localhost:3000`) conecta frontend y backend en desarrollo.
- La tabla de rutas en `dev-server.ts` debe mantenerse sincronizada manualmente con los archivos en `api/`.

---

## 2. Base de datos

### 2.1. SharePoint Online como base de datos

**Qué:** Todos los datos persistentes (usuarios, tickets, aislamientos, notificaciones, roles, suscripciones push, configuración de geo/IP) se almacenan en listas de SharePoint, accedidas vía Microsoft Graph API.

**Por qué:** El Grupo Gamma ya tiene infraestructura Microsoft 365. SharePoint elimina la necesidad de provisionar, mantener y pagar una base de datos separada. El equipo de IT del hospital puede inspeccionar y modificar datos directamente desde SharePoint sin herramientas adicionales. La autenticación Azure AD (client credentials) ya está configurada para otros sistemas internos.

**Alternativas descartadas:**
- PostgreSQL / MySQL (ej: Supabase, PlanetScale): requiere provisionar, gestionar migraciones, y pagar hosting. Mejor rendimiento y consultas, pero overhead operativo para un equipo que ya tiene SharePoint.
- Firebase / Firestore: real-time nativo eliminaría la necesidad de polling, pero agrega una dependencia fuera del ecosistema Microsoft del hospital. Costos menos predecibles.
- SQLite / Turso: liviano pero requiere hosting. No aprovecha la infraestructura existente.

**Impacto:**
- **Rendimiento:** las queries a SharePoint son lentas (~200-800ms) comparadas con una DB tradicional. Esto justifica el polling con ETag en vez de consultas frecuentes.
- **Limitaciones de consulta:** SharePoint no soporta JOINs, agregaciones ni índices eficientes. La API usa `$filter` con el header `Prefer: HonorNonIndexedQueriesWarningMayFailRandomly` que literalmente advierte que puede fallar. Se mitiga trayendo datos en bulk (`$top=500`) y procesando en el servidor.
- **Esquema acoplado:** los nombres de campos de SP (`IDUnivocoTraslado_T`, `Paciente_T`, `Status_T`) están hardcodeados en los handlers. Cada handler tiene funciones de mapeo bidireccional (`spToTicket`/`ticketToFields`).
- **Sin transacciones:** no hay atomicidad. Si un PATCH al ticket falla después de un POST al evento, quedan datos inconsistentes. Se mitiga con try/catch y logging.
- **Sin relaciones:** las "relaciones" entre listas (ej: ticket → eventos) se resuelven por filtros en campos de texto (`IDUnivocoTraslado_DT eq '...'`), no por foreign keys.

---

### 2.2. Soft-delete universal

**Qué:** Usuarios (`Status_U = 'Inactivo'`), roles (`Status_RT = 'Inactivo'`) y aislamientos (`Status_A = 'Inactivo'`) nunca se borran de SharePoint. Se desactivan cambiando un campo de estado.

**Por qué:** Mantiene trazabilidad completa. En un entorno hospitalario, poder auditar quién existió y cuándo es más valioso que ahorrar espacio. Además, SharePoint no tiene papelera programática vía Graph API, así que un DELETE real es irreversible.

**Alternativas descartadas:**
- Hard delete (`DELETE` vía Graph): irreversible, pierde historial.
- Archivado a otra lista: más complejo, mismo resultado.

**Impacto:**
- Los queries de GET siempre filtran por `Status = 'Activo'`, lo que agrega un filtro a todas las consultas.
- Los aislamientos se pueden "reactivar" reutilizando el registro existente (PATCH) en vez de crear uno nuevo.

---

## 3. Autenticación y seguridad

### 3.1. JWT con `jose` (sin bcrypt para contraseñas)

**Qué:** La autenticación compara la contraseña en texto plano contra el campo `Password_Usr` de SharePoint. Si coincide, se firma un JWT con HS256 usando la librería `jose`.

**Por qué se eligió `jose`:** es una implementación pura en JavaScript (sin dependencias nativas), compatible tanto con Node.js como con Vercel Edge Runtime. Alternativas como `jsonwebtoken` dependen de `crypto` nativo y pueden fallar en Edge.

**Por qué no se hashean contraseñas:** las contraseñas se almacenan en SharePoint, que no soporta funciones de hash como bcrypt. La comparación se hace server-side y las credenciales nunca viajan al browser (solo el JWT resultante). Es un compromiso pragmático dado las limitaciones de SharePoint como "DB".

**Alternativas descartadas:**
- `jsonwebtoken`: dependencia de `crypto` nativo, problemas en Edge Runtime.
- OAuth / SAML contra Azure AD: requeriría que cada usuario del hospital tenga una cuenta Azure AD, lo cual no es el caso (las Azafatas y Mucamas no tienen cuentas corporativas).
- Sesiones server-side: incompatible con serverless stateless.

**Impacto:**
- **Seguridad:** las contraseñas están en texto plano en SharePoint. Cualquiera con acceso a la lista puede verlas. Es el punto más débil de la arquitectura.
- **Token lifetime diferenciado:** 8h para usuarios normales (una jornada laboral), ~10 años para Azafatas (dispositivos compartidos sin re-login).
- **Expiración activa:** el frontend monitorea la expiración cada 60s y muestra un banner a los 15 minutos restantes.
- **No hay refresh tokens:** al expirar, el usuario debe re-loguearse. No hay renovación silenciosa.

---

### 3.2. Middleware `requireAuth` manual

**Qué:** Cada handler se wrappea con `requireAuth(handler)` que verifica el JWT del header `Authorization: Bearer <token>` y agrega `req.user` con el payload.

**Por qué:** Vercel Serverless Functions no tienen un sistema de middleware nativo. El patrón de Higher-Order Function es la forma idiomática de agregar middleware en este contexto.

**Alternativas descartadas:**
- Vercel Middleware (Edge): podría centralizar la auth, pero ejecuta en Edge Runtime donde algunas dependencias no funcionan.
- Decoradores: no soportados nativamente en TypeScript sin configuración extra.

**Impacto:**
- Cada endpoint debe importar y aplicar `requireAuth` manualmente. Si se olvida, el endpoint queda expuesto.
- El endpoint `auth.ts` es el único que NO usa `requireAuth` (es el login).
- `req.user` no tiene tipo fuerte — se accede como `(req as any).user`.

---

### 3.3. Validación de ubicación (IP + geolocalización)

**Qué:** `validate-location.ts` verifica que el usuario acceda desde una red o ubicación física autorizada, usando datos de la lista `99.ABM_GeoIPS`.

**Por qué:** En un hospital, la app maneja datos de pacientes. Restringir el acceso a la red interna (por IP) o al edificio (por geolocalización, radio 100m) agrega una capa de seguridad física. La configuración en SharePoint permite al equipo de IT actualizar IPs y coordenadas sin desplegar código.

**Alternativas descartadas:**
- VPN obligatoria: más seguro pero más fricción. Las Azafatas con tablets necesitan acceso rápido.
- Sin restricción: menos seguro para datos de salud.

**Impacto:**
- **Fail-open:** si la validación falla técnicamente (SP caído, error de red), se permite el acceso. Decisión explícita: en un hospital, bloquear el sistema es peor que un falso positivo de seguridad.
- **Localhost bypass:** en desarrollo, `::1` y `127.0.0.1` siempre pasan.

---

## 4. Comunicación y tiempo real

### 4.1. Polling con ETag en lugar de WebSockets / SSE

**Qué:** El frontend consulta `/api/tickets` cada 8 segundos y `/api/beds` cada 60 segundos. El endpoint de tickets genera un ETag basado en un hash DJB2 de `id:status:destBedStatus` y responde `304 Not Modified` si no hay cambios.

**Por qué:** WebSockets y SSE requieren conexiones persistentes, incompatibles con serverless (Vercel mata la conexión tras la respuesta). Polling con ETag es simple, predecible, y funciona con la arquitectura stateless. El intervalo de 8s es un compromiso entre latencia y carga.

**Alternativas descartadas:**
- WebSockets (Socket.io, Pusher): requiere un servidor persistente o un servicio externo. Agrega complejidad y costo.
- Server-Sent Events: misma limitación de serverless.
- Vercel Realtime / Ably / Supabase Realtime: servicios externos que agregan dependencia y costo.

**Impacto:**
- Latencia máxima de ~8s para ver cambios de otros usuarios. Aceptable para el dominio.
- El ETag evita transferir ~500 tickets si no hay cambios, reduciendo ancho de banda y procesamiento.
- El hash DJB2 es rápido y no criptográfico — suficiente para detectar cambios, no para seguridad.
- **Detección de cambios local:** al recibir tickets nuevos, el hook compara un snapshot `Map<id, status>` contra los datos anteriores para generar notificaciones in-app. Esto permite detectar tickets nuevos y cambios de estado sin un sistema de eventos del servidor.

---

### 4.2. Web Push con VAPID + Service Worker

**Qué:** Además del polling, la app envía notificaciones push nativas usando la Web Push API (protocolo VAPID). Las suscripciones se guardan en SharePoint (`09.PushSubscriptions`).

**Por qué:** El polling solo funciona mientras la app está abierta. Push permite notificar a usuarios que tienen la pestaña cerrada o el dispositivo en standby. Crítico para Azafatas que necesitan responder rápido a nuevos traslados.

**Alternativas descartadas:**
- Firebase Cloud Messaging (FCM): funciona bien pero agrega dependencia de Google en un ecosistema Microsoft.
- Solo polling: insuficiente si la app está cerrada.
- Notificaciones SMS / WhatsApp: costo por mensaje, requiere números de teléfono.

**Impacto:**
- Las suscripciones push son por dispositivo + usuario. Se limpian automáticamente cuando expiran (HTTP 410/404 del push endpoint).
- El filtrado por rol/área se hace server-side: Admin y Admisión reciben todo; Azafatas solo lo de sus áreas.
- El usuario que dispara la acción se excluye de la notificación push (`excludeUserId`).
- Cada push se registra en `10.Notificaciones` para historial.

---

### 4.3. Sonido de notificación con Web Audio API

**Qué:** En vez de un archivo `.mp3`/`.wav`, el sonido de notificación se genera programáticamente con `AudioContext`: dos osciladores sinusoidales (G5 784Hz + C6 1047Hz) con fade suave.

**Por qué:** Elimina un asset estático del bundle. Permite un sonido limpio y consistente sin preocuparse por formatos, licencias o tamaño de archivo. El resultado es un "ding-ding" corto y profesional.

**Alternativas descartadas:**
- Archivo de audio estático: requiere un asset, manejo de formato y posibles problemas de caché.
- Librería de sonido (Howler.js): dependencia extra para algo que se resuelve en ~20 líneas.

**Impacto:**
- Hay un cooldown para evitar spam de sonido cuando llegan múltiples cambios en un mismo poll.
- El `AudioContext` puede estar suspendido por política de autoplay del browser; se intenta `resume()` y se ignora el error silenciosamente.

---

## 5. Integración con API externa (Grupo Gamma)

### 5.1. Proxy server-side con cache de tokens por scope

**Qué:** `api/beds.ts` actúa como proxy entre el frontend y la API REST de Grupo Gamma (VM `35.224.5.114`). Los tokens OAuth se cachean en un `Map<scope, {token, exp}>` que sobrevive invocaciones warm.

**Por qué:** Las credenciales de Gamma (`CLIENT_ID`, `CLIENT_SECRET`) no deben llegar al browser. El proxy centraliza la autenticación y transformación de datos. El cache evita hacer el flujo OAuth completo (3 requests) en cada invocación.

**Alternativas descartadas:**
- Llamar a Gamma directamente desde el frontend: expone credenciales, CORS bloqueado.
- BFF dedicado: sobredimensionado; el serverless function cumple la misma función.

**Impacto:**
- El endpoint `/api/beds` es el más complejo (~320 líneas) porque combina múltiples fuentes de datos de Gamma.
- En cold starts el cache está vacío: se hacen flujos OAuth concurrentes (`Promise.all`).
- El enriquecimiento (Fase 2) se activa solo con `?enrich=1` y se ejecuta una sola vez por sesión desde el frontend (`bedsEnrichedRef`), reduciendo drásticamente la carga sobre la API de Gamma en cada poll de 60s.
- Las respuestas de Gamma se parsean con `safeJson()` que devuelve `[]` ante JSON inválido, evitando que un error de formato rompa toda la carga.

---

### 5.2. Carga de camas en dos fases (fast/enrich)

**Qué:** La carga de camas se divide en dos fases. La Fase 1 (`GET /api/beds`) obtiene solo el mapa y las camas ocupadas (2 llamadas a Gamma, rápido). La Fase 2 (`GET /api/beds?enrich=1`) agrega datos de paciente y evento de internación (N llamadas a Gamma, lento). El frontend ejecuta la Fase 2 una sola vez por sesión via `bedsEnrichedRef`.

**Por qué:** El endpoint original hacía 4 flujos OAuth + N llamadas de enriquecimiento en cada invocación, incluyendo los polls de 60 segundos. En un hospital con muchas camas ocupadas, esto generaba demasiados requests a la API de Gamma y timeouts frecuentes en el serverless function. Separar en dos fases permite que el polling sea rápido (~2s) y el enriquecimiento pesado se haga una sola vez.

**Alternativas descartadas:**
- Cache de enriquecimiento server-side: los serverless functions no comparten estado entre invocaciones (cold starts).
- Enriquecimiento en background job: requiere infraestructura adicional (cron, queue).

**Impacto:**
- El polling de 60s solo ejecuta Fase 1: rápido, sin riesgo de timeout.
- Los datos de paciente (DNI, edad, obra social, diagnóstico) se cargan una vez y no se actualizan durante la sesión. Si un paciente cambia de cama post-enrichment, el dato se desactualiza hasta re-login.
- El backend parsea respuestas de Gamma con `safeJson()` para manejar respuestas no-JSON sin romper la carga.

---

### 5.3. Merge de camas con estado de tickets (función `mergeBeds`)

**Qué:** Los datos de Gamma reflejan el estado "real" de las camas. Pero la app tiene estados intermedios (cama asignada a un traslado en curso) que Gamma no conoce. `mergeBeds()` combina ambas fuentes.

**Por qué:** El sistema de Gamma se actualiza cuando el traslado se consolida. Durante el proceso (que puede durar horas), la app necesita mostrar que una cama está "Asignada" o "En preparación" aunque Gamma la reporte como "Disponible".

**Alternativas descartadas:**
- Actualizar Gamma en cada paso: la API de Gamma no expone endpoints de escritura (o no se tienen permisos).
- Usar solo datos locales: se perdería el estado real de camas que no están en un traslado.

**Impacto:**
- El merge se ejecuta en `useMemo` cada vez que cambian `rawBeds` o `tickets`.
- Los aislamientos siguen la misma lógica derivada: se miran los `patientCode` de las camas y tickets activos para determinar qué camas están aisladas.
- Si un dato de Gamma y un ticket activo colisionan, el ticket gana (el estado operativo de la app tiene prioridad).

---

## 6. Librerías clave

### 6.1. Radix UI para componentes interactivos

**Qué:** Se usan `@radix-ui/react-dialog`, `react-popover` y `react-select` como primitivas para modales, popovers y selects.

**Por qué:** Radix provee componentes accesibles (ARIA), sin estilos, y composables. Se integran naturalmente con Tailwind. A diferencia de librerías "con opinión" como MUI o Ant Design, Radix no impone un sistema de diseño.

**Alternativas descartadas:**
- Material UI / Ant Design: más completo pero con estilos difíciles de customizar y bundle más grande.
- Headless UI: similar a Radix pero con menos componentes y comunidad más chica.
- shadcn/ui completo: la app usa algunos patrones de shadcn (el directorio `components/ui/`) pero no lo integra como sistema completo.

**Impacto:**
- Los componentes en `components/ui/` (Card, Button, Input, Table, etc.) siguen el patrón shadcn: wrappers ligeros sobre Radix + Tailwind con `cn()` para merge de clases.
- No se usa un theme system centralizado; los colores (`#022C22`, `emerald-*`) están hardcodeados en los componentes.

---

### 6.2. `xlsx` para exportación de historial

**Qué:** `HistoryView` permite exportar tickets a Excel usando la librería `xlsx` (SheetJS).

**Por qué:** Los stakeholders del hospital necesitan datos en Excel para reportes internos y auditoría. `xlsx` genera archivos `.xlsx` nativos sin servidor.

**Impacto:**
- `xlsx` pesa ~1MB en el bundle. Se importa directamente en `HistoryView`, no se hace lazy loading.
- La exportación se hace client-side: los datos ya están en memoria por el polling.

---

### 6.3. `jsPDF` para exportación del mapa de camas

**Qué:** `BedsView` permite exportar el estado de las camas a PDF.

**Por qué:** Las Azafatas y Mucamas necesitan una vista imprimible del mapa de camas para rondas. PDF es el formato estándar para documentos impresos en el ámbito hospitalario.

**Impacto:**
- La generación del PDF es client-side. No requiere un servicio de rendering server-side.

---

### 6.4. `web-push` para notificaciones del servidor

**Qué:** El paquete `web-push` se usa en el backend para enviar notificaciones push a los browsers suscritos vía protocolo VAPID.

**Por qué:** Es la librería estándar de Node.js para Web Push. Soporta VAPID nativo, maneja la criptografía de los endpoints, y reporta suscripciones expiradas.

**Alternativas descartadas:**
- Firebase Admin SDK: más pesado, agrega dependencia de Google.
- Implementación manual del protocolo: innecesariamente complejo.

**Impacto:**
- Requiere Node.js (no funciona en Edge Runtime), lo que ancla los serverless functions a Node.
- Las claves VAPID deben estar configuradas tanto en el servidor (`VAPID_PRIVATE_KEY`) como en el cliente (`VITE_VAPID_PUBLIC_KEY`).

---

## 7. Manejo de errores

### 7.1. Conservar datos anteriores en vez de fallback a mock

**Qué:** Si `fetchBeds()` falla (error HTTP, JSON inválido, array vacío), se conservan los datos anteriores en `rawBeds` en vez de reemplazarlos. No se usa `MOCK_BEDS` como fallback (el import fue removido). Los tickets tampoco tienen fallback a mock.

**Por qué:** En versiones anteriores se cargaban datos mock ante cualquier fallo, lo que podía confundir al usuario mostrando camas ficticias como si fueran reales. La estrategia actual es más segura: si Gamma tiene un error transitorio, el usuario sigue viendo los últimos datos reales. Si es la primera carga y no hay datos previos, se muestra el mapa vacío con un mensaje de error.

**Impacto:**
- Si Gamma está caído, la UI muestra los últimos datos válidos (no mock) o un mapa vacío si es la primera carga.
- `bedsError` se expone en la UI para que el usuario sepa que hubo un problema.
- Los mensajes de error se simplificaron (ej: `'HTTP ${status}'` en vez de volcar el body truncado).
- Los tickets NO tienen fallback mock: si SharePoint está caído, la operativa queda bloqueada.

---

### 7.2. Errores silenciosos en polling

**Qué:** `fetchTickets()` tiene un `catch { /* keep mock/current data */ }` vacío. Si falla, simplemente mantiene los datos actuales.

**Por qué:** El polling ocurre cada 8 segundos. Un error transitorio (timeout, blip de red) no debería borrar los datos que ya se tienen. Al siguiente poll se reintentará automáticamente.

**Impacto:**
- Errores persistentes de red pasan desapercibidos para el usuario hasta que el token expira (verificación cada 60s).
- No hay indicador visual de "sin conexión" o "última actualización hace X minutos".

---

### 7.3. Auto-logout en HTTP 401

**Qué:** Si cualquier `authFetch()` recibe un `401`, se ejecuta `handleLogout()` inmediatamente.

**Por qué:** Un 401 significa que el token expiró o es inválido. No tiene sentido seguir operando sin autenticación. Forzar re-login garantiza un token fresco.

**Impacto:**
- Si hay un problema transitorio de verificación de JWT (ej: clock skew), el usuario pierde la sesión sin aviso.
- No se intenta refresh del token antes de hacer logout.

---

## 8. Estructura de datos

### 8.1. Enums TypeScript para estados y roles

**Qué:** Se usan `enum` de TypeScript (no union types) para `TicketStatus`, `BedStatus`, `Role`, `Area`, `WorkflowType`, `SedeType`, `IsolationType`.

**Por qué:** Los enums proveen un namespace agrupado (`TicketStatus.COMPLETED`), autocompletado en el IDE, y valores de string legibles ("Consolidado") que se muestran directamente en la UI sin mapeo adicional.

**Alternativas descartadas:**
- Union types (`type Role = 'ADMIN' | 'ADMISSION' | ...`): más idiomático en TypeScript moderno, pero no agrupa valores ni permite iteración.
- Constantes de objeto: similar pero sin la verificación de exhaustividad que da `switch` sobre enums.

**Impacto:**
- Los valores de los enums son strings en español (`'Esperando Habitacion'`, `'Consolidado'`) que se usan directamente como labels en la UI y como valores almacenados en SharePoint. Esto acopla la capa de presentación con la de persistencia.
- Si se necesita internacionalización, habría que separar el valor interno del label de UI.

---

### 8.2. IDs generados client-side con hash

**Qué:** Los tickets se crean con un ID tipo `TKT-{hash}` generado en el frontend antes de enviar a SharePoint. SharePoint asigna además su propio `spItemId` (numérico).

**Por qué:** Permite tener un ID amigable y predecible antes de que SharePoint responda. El `spItemId` se usa para PATCHs posteriores, pero el `TKT-xxx` es el ID visible para el usuario.

**Impacto:**
- Hay dos IDs por ticket: `id` (app) y `spItemId` (SharePoint). Ambos se necesitan.
- El hash DJB2 no garantiza unicidad (colisiones posibles pero improbables para el volumen esperado).
- La detección de "puede cancelarse" (`canCancel`) compara `createdDateTime` vs `lastModifiedDateTime` del item de SP con un margen de 2 segundos.

---

### 8.3. Timestamps como strings ISO

**Qué:** Todas las fechas (`createdAt`, `completedAt`, `bedAssignedAt`, etc.) se almacenan como strings ISO 8601. No se usan objetos `Date` en el estado.

**Por qué:** Los strings se serializan/deserializan trivialmente de/hacia JSON y SharePoint. Evita problemas de timezone que surgen al parsear `Date` en diferentes contextos (server UTC vs browser local).

**Impacto:**
- Cada vez que se necesita calcular una diferencia o formatear, hay que parsear el string con `new Date()`.
- `lib/utils.ts` centraliza las funciones de formateo (`formatDateReadable`, `formatDateTime`, `formatTime`, `getMinutesBetween`) para evitar parseo duplicado.
- La función `calculateTicketMetrics()` calcula tiempos operativos (ciclo total, limpieza, transporte, administrativo) a partir de estos strings.

---

## 9. UI y experiencia

### 9.1. Responsive con enfoque mobile-first para azafatas

**Qué:** El layout tiene un sidebar fijo en desktop y un drawer deslizable en mobile. Los tamaños de toque son grandes (`h-10`, `w-10`) para uso en tablet.

**Por qué:** Las Azafatas usan tablets durante rondas. Los botones y áreas de toque deben ser suficientemente grandes para uso con guantes o en movimiento.

**Impacto:**
- El diseño mobile y desktop son experiencias distintas (drawer vs sidebar), no solo responsive.
- Los breakpoints clave son `md:` (768px) para la transición mobile/desktop.

---

### 9.2. Colores del Grupo Gamma hardcodeados

**Qué:** El color primario `#022C22` (verde muy oscuro) y la paleta `emerald-*` están hardcodeados directamente en los componentes y estilos inline.

**Por qué:** La app tiene un único cliente (Grupo Gamma) con identidad visual fija. No se necesita un theme system configurable.

**Alternativas descartadas:**
- CSS custom properties / theme tokens: más flexible pero agrega indirección innecesaria para un cliente único.
- Tailwind theme extendido: el `tailwind.config.js` tiene configuración mínima; los colores se aplican directamente.

**Impacto:**
- Cambiar la identidad visual requiere buscar y reemplazar valores hex y clases Tailwind en múltiples archivos.
- No hay dark mode ni themes alternativos.

---

## 10. Resumen de trade-offs principales

| Decisión | Ganancia | Costo |
|----------|----------|-------|
| SharePoint como DB | Sin infraestructura adicional, IT puede inspeccionar datos | Queries lentas, sin transacciones, campos en texto plano |
| Polling 8s con ETag | Simple, compatible con serverless | Latencia de hasta 8s vs real-time |
| JWT sin refresh | Implementación simple | Re-login obligatorio al expirar |
| Contraseñas en texto plano | Compatible con SP como DB | Seguridad comprometida si SP es accedido |
| Estado en un hook | Un solo lugar para toda la lógica | Hook y App.tsx grandes |
| SPA sin router | Simple, sin deep linking | No se pueden compartir URLs a vistas |
| Merge camas local | Refleja estado operativo en tiempo real | Divergencia posible con Gamma |
| Fail-open en geolocalización | No bloquea operaciones hospitalarias | Posible acceso no autorizado si SP falla |
| Enums con valores en español | Labels directos sin mapeo | Acoplamiento presentación-persistencia |
| Conservar datos previos en error | UI no muestra datos falsos | Mapa vacío en primera carga si Gamma está caído |
| Enrichment on-demand por cama | Polls rápidos (60s), 0 llamadas extra | Datos de paciente solo visibles al click |
| Cache server-side beds 45s + ETag | Múltiples tabs = 1 llamada a Gamma | Datos stale por hasta 45s |
| Supresión notificaciones 15s | No spam al abrir app | Puede perder notificación si llega justo al abrir |
| localStorage en vez de sessionStorage | PWA mantiene sesión al cerrar app | Sesión persiste hasta logout manual o token expire |

---

## 11. Decisiones recientes (2026-04-13)

### 11.1. Refactor de beds: de Phase 1+2 a on-demand enrichment

**Qué:** Se eliminó el enriquecimiento masivo (Phase 2, ~170 llamadas a Gamma) y se reemplazó por un endpoint on-demand `/api/bed-enrich` que enriquece una sola cama al click.

**Por qué:** El Phase 2 saturaba la API de Gamma ("Too many connections", 504 timeouts) y hacía que el mapa tardara mucho en cargar. Con el endpoint mejorado de Gamma (`obtenermapacamasocupadas` ahora trae profesional e institución), solo faltan DNI/edad/sexo/diagnóstico que se cargan al click.

**Impacto:** Mapa carga en 2-3s. Filtros de financiador y profesional funcionan sin enrich. DNI/edad/sexo/diagnóstico aparecen con spinner al click.

### 11.2. Extracción de gamma-client.ts

**Qué:** Se extrajo el token cache, fetch helpers y types de `beds.ts` a un módulo compartido `gamma-client.ts`.

**Por qué:** `bed-enrich.ts` necesita las mismas funciones. Evita duplicación y comparte el token cache entre endpoints.

### 11.3. Push subscription cleanup al logout

**Qué:** Al hacer logout, se borra la push subscription del usuario en SP y se desuscribe el browser.

**Por qué:** Si un usuario se loguea en un dispositivo y después se loguea otro usuario, la subscription del primero quedaba activa y recibía pushes del segundo. Ahora al hacer logout se limpia.

### 11.4. Inline warning para traslados duplicados

**Qué:** En vez de un `alert()` nativo cuando hay traslado activo para la misma cama, se muestra un warning inline amber debajo del selector de origen y se deshabilita el botón "Generar Ticket".

**Por qué:** El `alert()` era feo y bloqueante. El warning inline es visible antes de intentar crear el ticket.

---

## 12. Decisiones recientes (2026-04-22)

### 12.1. Aislamientos multi-tipo almacenados en un único campo SP con separador `;`

**Qué:** La columna `Tipo_A` de `08.Aislamientos` guarda los tipos de aislamiento activos por paciente concatenados con `;` (ej: `"Covid;Contacto;Neutropénico"`). En el frontend se modela como `Map<string, IsolationType[]>` (key = `patientCode`).

**Por qué:**
- **Alternativa descartada 1: multi-choice de SharePoint.** Las columnas de tipo Choice multi-valor en SP devuelven arrays en Graph API pero el editor y la API son frágiles (orden inestable, chequeos adicionales). La lectura vía `$expand=fields` a veces serializa inconsistentemente.
- **Alternativa descartada 2: una fila por (paciente, tipo).** Requería `Promise.all` para crear/borrar varias filas en cada toggle y manejar parcialmente el fracaso de alguna. Además romper el esquema "un paciente = un registro" complicaba la UI de ABM.
- **Ventaja del string con `;`:** cambios atómicos (un solo PATCH), backward-compat (los valores viejos con un solo tipo se parsean como array de uno), fácil de inspeccionar desde SP directamente.

**Impacto:** toda la cadena (modal de nueva solicitud, modal de edición, mapa de camas, operativa) se actualizó para trabajar con arrays. El mapa sigue eligiendo el primer tipo del array para pintar el color del ring de la cama.

### 12.2. `IntervinoAzafata_T` reemplaza la heurística de timestamps para `canCancel`

**Qué:** La lógica anterior determinaba `canCancel` comparando `createdDateTime` vs `lastModifiedDateTime` del item de SP con margen de 2 segundos. Se reemplazó por una columna explícita `IntervinoAzafata_T` que pasa de `"NO"` a `"SI"` en la primera acción de azafata.

**Por qué:**
- La heurística de timestamps era frágil: cualquier PATCH (ej: actualizar observaciones desde SP directo, renombrar) rompía el check aunque nadie del flujo hubiera intervenido.
- Una columna dedicada hace el contrato explícito y auditablemente correcto.
- El bloqueo aplica no solo a cancelar sino también a editar (feature nuevo), manteniendo una sola fuente de verdad.

### 12.3. `requireInteraction: false` en push (Android)

**Qué:** Se quitó `requireInteraction: true` del `showNotification()` del Service Worker.

**Por qué (contraintuitivo):** la flag estaba puesta para que la notif no se auto-descarte hasta que el usuario interactúe. **Pero** varias versiones de Chrome Android interpretan `requireInteraction: true` como "notif persistente/ongoing" y **saltan el heads-up banner**, enviando la notif directo al centro de notificaciones sin mostrar toast. Causó que el cliente reportara "suena y llega al centro pero no sale el toast".

**Trade-off aceptado:** la notif se auto-descarta tras ~5-10s, pero sí aparece el heads-up. Prioriza que el personal vea el alerta en el momento.

**Refuerzos adicionales combinados:** `silent: false` explícito (algunos builds lo asumen silent si falta), vibración más agresiva `[300, 120, 300, 120, 300]`, y acción `[{ action: 'open', title: 'Ver' }]` (Android bumpea la importance de notifs con acciones).

### 12.4. Tag único por evento en push para evitar colapso silencioso

**Qué:** El payload del push ahora incluye `tag = ${ticketId}-${type}-${Date.now()}` en vez de solo `ticketId`. El SW lo usa al crear la notif.

**Por qué:** con un `tag` fijo por ticket, Chrome Android colapsaba las notifs consecutivas (crear → status update → modificación) reemplazando la anterior **sin mostrar heads-up**, aunque `renotify: true` debería forzarlo (varios builds lo ignoran). Un tag único por evento hace que cada notif sea "nueva" desde la óptica del sistema y siempre dispare el banner.

### 12.5. Cache `/api/beds` fail-open con staleness flag ante 504 del proxy Gamma

**Qué:** Si `obtenermapacamas` u `obtenermapacamasocupadas` devuelven algo que no sea JSON array válido con status 2xx (típicamente el proxy nginx responde 504 HTML), el handler **no sobrescribe el caché** y sirve el último snapshot bueno con header `X-Beds-Stale: 1` y body `{ stale: true }`. Si no hay caché, responde 503 explícito.

**Por qué:** la versión anterior tenía una función `safeJson` que devolvía `[]` cuando el parse fallaba, y el handler seguía como si hubiera sido exitoso. Resultado: durante un 504 de `obtenermapacamasocupadas` se guardaba un array vacío como `occData` y **las camas ocupadas se mostraban como disponibles** — riesgo operativo real (admin podía asignar una cama que ya tenía paciente). Ahora la falla es visible y los datos viejos se conservan hasta que Gamma vuelva.

### 12.6. Supresión de notif de status change al editar destino

**Qué:** El change-detection del polling solo emite la notif de "status cambió" (ej: "Habitación Lista") **cuando NO hubo cambio de destino en la misma actualización**. Si cambió el destino, solo emite las tres notifs de modificación (cancelación destino viejo / nueva destino nuevo / modificación origen).

**Por qué:** al editar destino, el status del ticket se recalcula automáticamente (WAITING_ROOM ↔ IN_TRANSIT según si la nueva cama estaba AVAILABLE o PREPARATION). Eso disparaba un "Habitación Lista" inesperado en los clientes, confuso porque ninguna azafata había marcado nada — era consecuencia técnica de la edición. Las notifs de modificación ya cubren el evento real.

### 12.7. Radio GPS a 200m + prefix matching de IP con longitud arbitraria

**Qué:**
- `GEO_RADIUS_METERS` subió de 100 m a 200 m en `validate-location.ts`.
- La comparación de IP dejó de asumir prefijo /24 exacto; ahora usa `startsWith` con separador `.` de seguridad, aceptando prefijos de 1, 2, 3 u 4 octetos (y IPs completas).

**Por qué:**
- 100 m no cubría un hospital multi-pabellón con una sola coordenada configurada. Subirlo a 200 m evita falsos negativos por estar en la punta opuesta del edificio. Si 200 m sigue siendo chico para un caso particular, el sistema ya soporta agregar varias coords por sede en `99.ABM_GeoIPS`.
- Para IP: si el admin configuraba algo que no fuera exactamente un prefijo de 3 octetos (ej: `"192.168"` queriendo /16, o una IP completa), nada matcheaba. Era bug silencioso. Ahora acepta cualquier longitud con el truco del `.` al final para evitar falsos positivos entre `"192.168.1"` y `"192.168.10.5"`.

### 12.8. Mensajes de error específicos por tipo de rechazo de ubicación

**Qué:** El endpoint `validate-location` ahora devuelve `method: 'ip_no_match' | 'geo_no_match' | 'geo_unavailable' | 'no_ip'` en los rechazos con `reason` accionable ("Permití la geolocalización...", "Estás fuera del área autorizada para la sede X (radio 200m)", etc.).

**Por qué:** antes todos los rechazos devolvían el mismo string genérico ("Ubicación o red no autorizada"). El user no sabía si el problema era su red, el GPS denegado por el browser, o estar fuera del rango. El mensaje específico guía al usuario a la acción correcta (permitir GPS, usar wifi del hospital, etc.).

### 12.9. `localStorage` como única fuente del token (no `sessionStorage`)

**Qué:** Corregido el bug en `UserManagementView`, `RoleManagementView` y `AuditModal` que leían el token de `sessionStorage` cuando el login lo guarda en `localStorage`.

**Por qué:** era inconsistencia histórica — el resto de la app siempre usó `localStorage` (clave `TOKEN_KEY = 'mediflow_token'`). Los tres archivos afectados hacían fetch directo en vez de usar el `authFetch` centralizado y copiaron mal la lectura del token. Efecto: esos tres componentes recibían `null` → mandaban `Authorization: Bearer null` → SP respondía 401 → el endpoint de roles convertía 401 en 200 con array vacío → la UI mostraba "sin resultados" silenciosamente. El fix es un cambio de una palabra por archivo. **Convención reforzada:** siempre `localStorage.getItem('mediflow_token')`; idealmente, usar el `authFetch` del hook y evitar duplicar la lectura.

---

## 13. Decisiones recientes (2026-04-27)

### 13.1. Fusión `WorkflowType.ROOM_CHANGE` → `INTERNAL` sin migración de datos

**Qué:** El dropdown de "Tipo de Traslado" en el modal de Nueva Solicitud se redujo de 3 opciones a 2 (`Traslado Interno`, `Ingreso ITR`). El antiguo `WorkflowType.ROOM_CHANGE` (con su motivo obligatorio) se fusionó con `INTERNAL`, que ahora también pide motivo siempre. `ROOM_CHANGE` queda como `@deprecated` en el enum pero no se borra.

**Por qué:** el cliente reportó que tener "Cambio de Habitación" y "Traslado Interno" como opciones distintas confundía al cargar — funcionalmente eran lo mismo. Unificar simplifica la UX y deja el motivo como un dato siempre auditado.

**Alternativas descartadas:**
- **Migrar tickets viejos en SP** (`UPDATE Status_T='ROOM_CHANGE' SET TipoTraslado_T='INTERNAL'`): Graph API permite hacerlo en bulk, pero modifica registros históricos cerrados, perdiendo trazabilidad de qué workflow se usó originalmente. Además, sin transacciones, una falla parcial deja datos mixtos.
- **Eliminar `ROOM_CHANGE` del enum**: rompería la lectura de tickets viejos en `07.Traslados` (TS error en runtime al castear `f.TipoTraslado_T as WorkflowType`).

**Impacto:**
- `WORKFLOW_LABELS[WorkflowType.ROOM_CHANGE]` se mapea a `'Traslado Interno'` → tickets legacy se ven idénticos a los nuevos en Historial y Operativa.
- `EditRequestModal` auto-mapea `ROOM_CHANGE → INTERNAL` al prefilear el form: el motivo prefilled se mantiene.
- Validación de motivo obligatorio: en `useHospitalState.handleCreateTicket` y `EditRequestModal.tsx` se valida `workflow === INTERNAL && !reason`.
- `AuditModal` muestra el motivo para ambos workflows (`INTERNAL || ROOM_CHANGE`) preservando la auditoría histórica.

### 13.2. Validación de doble asignación de cama destino — combo frontend + backend 409

**Qué:** Una cama destino solo puede ser objetivo de **un** ticket activo a la vez. Hoy, dos admins simultáneos podían asignar la misma cama a dos pacientes distintos sin que la app lo detectara.

**Estrategia: defensa en profundidad.**
- **Frontend (UX preventiva):** `App.tsx` calcula `activeTransferDestinations: Set<string>` y lo pasa a ambos modales. Las camas ya tomadas se ocultan del dropdown de destino.
- **Backend (race-condition safe):** `api/tickets.ts` POST/PATCH consultan SP antes de escribir. Si hay otro ticket activo con la misma `CamaDestino_T`, devuelven `409 { error, conflictingTicketId }`.
- **Frontend (rollback):** ante un 409, `_createTicket` remueve el ticket optimista del state y `handleEditTicket` restaura el snapshot del ticket pre-cambio. Alert con el ID del ticket conflictivo.

**Por qué esta estrategia (no solo backend):** el frontend solo no es suficiente (dos pestañas con el mismo state pueden disparar POST simultáneos antes de que llegue el primer response). El backend solo no es suficiente para UX (el dropdown debe avisar al admin antes de que intente). Combinar las dos capas resuelve UX + atomicidad.

**Trade-off aceptado:** la query a SP antes de cada write agrega ~200-400ms al POST/PATCH. Aceptable porque crear/editar tickets no es operación de alta frecuencia.

**Limitación conocida:** no hay locking real en SP. Entre la query de validación y el POST, otro admin puede insertar. La ventana es de ~200ms. Para el volumen del HPR (5-15 traslados activos en simultáneo, 1-2 admins) es suficiente; si fuera necesario eliminar la ventana, habría que migrar a una DB con `INSERT ... WHERE NOT EXISTS`.

### 13.3. Admin actúa como Azafata sin filtro de áreas

**Qué:** El admin, al elegir el tab "Azafata" en Operativa, ve TODOS los tickets activos en estados `WAITING_ROOM/IN_TRANSIT/IN_TRANSPORT` y puede ejecutar las acciones operativas (Habitación Lista, Iniciar Traslado, Recepción OK) sin filtro de áreas asignadas.

**Por qué:** cuando una azafata está ausente o un ticket queda atascado, el admin necesitaba poder destrabarlo. Antes solo podía cancelar y rehacer, lo cual perdía trazabilidad.

**Alternativas descartadas:**
- **Botones de azafata en el tab "Admin":** mezcla las dos UIs y satura visualmente el tab del admin. Confunde porque las acciones de azafata son contextuales por status, no por permisos.
- **Asignar todas las áreas al admin en `00.Usuarios`:** funcional pero acopla el rol con la configuración de áreas. Frágil si alguien edita el usuario admin.

**Impacto:**
- Cambio mínimo en código: bypass de `assignedAreas` en `RequestsView.tsx` cuando `currentUser.role === Role.ADMIN`.
- Los handlers (`handleRoomReady`, etc.) no validan rol y siguen funcionando — siempre confiaron en la UI para gatekeeping.
- Cuando el admin actúa, el flag `intervenedByHostess` pasa a `'SI'`. Decisión consciente: el contrato de "una vez intervenida la azafata, no se edita" se respeta aunque haya sido el admin.

### 13.4. Indicador visual de aislamiento múltiple — tag con contador, no gradient

**Qué:** Cuando un paciente tiene 2+ aislamientos activos, además del color del primer aislamiento (ring sólido) se muestra un tag negro con un dot del color del segundo aislamiento + el número total (ej. `● 2`) en la esquina inferior izquierda de la tarjeta de cama.

**Alternativas descartadas:**
- **Borde con bandas multicolor (linear-gradient):** se intentó primero pero no se renderizaba: el span con `-z-10` quedaba detrás del fondo del grid. Hubiera requerido cambiar la estructura DOM (wrapper extra) y romper el layout aspect-square.
- **Cambiar icono shield → layers:** sutil pero requiere conocer el código. El cliente prefería un indicador explícito.
- **Badge solo numérico:** funcional pero menos visual; el dot del segundo color "ata" el tag al concepto de aislamiento secundario.

**Impacto:** sin cambios en estructura DOM ni stacking context. Solo se agrega un `div` absolute en la esquina libre. Tooltip en desktop con la lista completa.

### 13.5. Push de Catering acotado a `RECEPTION_CONFIRMED` con mensaje formateado

**Qué:** El rol Catering recibe **una sola notificación push** por traslado: cuando se confirma la recepción del paciente. El mensaje es human-readable: `"{Paciente} pasó de Habitación {N} ({Piso X}) a Habitación {M} ({Piso Y})"`.

**Por qué:** el equipo de cocina no necesita saber del flujo intermedio (creación, asignación, en tránsito) — solo cuándo coordinar la próxima entrega de comida. Inundarlos con notifs de cada cambio de status sería ruido. La forma del mensaje los abstrae de los códigos internos (cama labels) y los habla en términos de habitación + piso, que es como ellos navegan el hospital.

**Implementación:** `api/push-utils.ts` recibe `cateringTitle` y `cateringBody` opcionales en `sendPushToSubscribers`. Si el subscriber tiene `Role = 'CATERING'`, usa esos campos en lugar del título/cuerpo normales. Si no se pasa `cateringBody`, los suscriptores Catering no reciben push (filtrado natural por rol + opcional).

### 13.6. PWA auto-update sin prompt al usuario

**Qué:** `vite-plugin-pwa` está en modo `registerType: 'autoUpdate'` con `skipWaiting: true` y `clientsClaim: true`. Cuando se despliega una nueva versión, los SW activos detectan la actualización, la activan y refrescan la página automáticamente. No hay banner ni prompt.

**Por qué:** el cliente reportó que su personal (azafatas, admisión, enfermería) no tiene cómo refrescar manualmente y no entiende mensajes técnicos tipo "hay una nueva versión, click acá". La actualización tiene que ser invisible.

**Trade-off aceptado:** un usuario que esté completando un formulario al momento del deploy puede perder estado si la página se recarga. Mitigación: los modales modales (`NewRequestModal`, `EditRequestModal`) son cortos y se completan en segundos. Decisión documentada para no agregar complejidad de "guardar estado pre-update".

---

## 14. Decisiones recientes (2026-05-06)

### 14.1. Sector HRA reemplaza HIT como origen de "Ingreso ITR"

**Qué:** El workflow `Ingreso ITR` (código interno `WorkflowType.ITR_TO_FLOOR`) cambió su origen de **HIT** (Internación Transitoria) a **HRA** (sillones de sala de espera de Recepción Admisión). El nombre visible "Ingreso ITR" se mantiene aunque ya no use HIT como origen. HIT pasó a ser un sector más, accesible como origen del workflow `Traslado Interno`.

**Por qué:**
- El cliente aclaró que el flujo real de "ingreso a internación" empieza en los sillones de espera de Admisión, no en ITR. Pacientes esperan sentados en HRA hasta que se les asigna habitación.
- Renombrar el workflow visible a "Ingreso a Internación" se descartó: el equipo conoce "Ingreso ITR" desde hace meses y no había razón fuerte para romper el vocabulario.
- HIT se libera para `Traslado Interno`: pacientes que estaban en ITR (sector real de internación transitoria) ahora se pueden mover a piso usando el workflow estándar.

**Reglas de filtrado nuevas:**

| Workflow | Origen | Destino |
|----------|--------|---------|
| `INTERNAL` | Cualquier sector **excepto HRA** (incluye HIT) | Cualquier sector excepto HRA y HIT |
| `ITR_TO_FLOOR` | **Solo HRA** | Cualquier sector excepto HRA y HIT |

**Impacto:** dos helpers en `lib/utils.ts` (`isHraArea`, `isHitArea`) hacen matching tolerante por substring para que el filtrado no se rompa si Gamma envía variaciones de string (con/sin tilde, casing distinto). Los tests con datos reales mostraron que el match estricto fallaba en tests previos, así que ahora todo el filtrado de origen/destino usa estos helpers.

### 14.2. Una sola azafata interviene en `Ingreso ITR` (la de destino)

**Qué:** El workflow `Ingreso ITR` ahora hace que **toda la operativa la ejecute la azafata destino**: marca "Habitación Lista" si aplica, "Iniciar Traslado", y "Recepción OK". La azafata "origen" no existe en este flujo.

**Por qué:** los sillones HRA no tienen una azafata estable asignada (es un sector administrativo, no de internación). Mantener el handoff origen/destino del Traslado Interno ahí dejaba el ticket trabado en `IN_TRANSIT` esperando que alguien marcara "Iniciar Traslado", sin nadie operativo en HRA. La simplificación es honesta: una sola persona es responsable de mover al paciente desde el sillón.

**Trade-off:** la azafata destino tiene que apretar 3 botones en lugar de 1, pero los apreta ella misma sin esperar a otro rol — más rápido en práctica.

**Implementación:** `views/RequestsView.tsx` calcula `isIngresoFlow = ticket.workflow === ITR_TO_FLOOR` y, en el estado `IN_TRANSIT`, deriva el botón "Iniciar Traslado" a la azafata destino en vez de la origen.

### 14.3. Plan médico desde dos fuentes (poll + enrich)

**Qué:** El campo `medicalPlan` se rellena desde **dos fuentes Gamma** combinadas:

1. **`obtenermapacamasocupadas`** (en cada poll de 60s, sin enrich): trae `plan_codigo` y `plan`.
2. **`obtenereventointernacion`** (al click, dentro del enrich): trae `IPM_PLAN_MEDICO` y `IPM_DESCRIPCION`.

El frontend prioriza el dato del poll (rápido, sin spinner) y el enrich agrega `medicalPlanDescription` cuando completa.

**Por qué dos fuentes:** Gamma agregó el plan en ambos endpoints simultáneamente. Aprovechamos: el dato del poll asegura que el plan aparezca **inmediatamente** al abrir el modal (incluso antes del enrich), y el dato del enrich agrega la descripción larga si Gamma la envía.

**Alternativas descartadas:**
- Solo usar el enrich: el plan aparecía con un delay incómodo de 1-3s.
- Solo usar el poll: perdíamos la descripción larga (`IPM_DESCRIPCION`).

### 14.4. Observaciones de cama inhabilitada en tooltip + modal

**Qué:** Cuando una cama está en estado `DISABLED` y Gamma envía `observaciones`, ese texto aparece en dos lugares:
1. **Tooltip nativo del browser** al hover del cuadrado en el grid (desktop).
2. **Panel ámbar destacado** dentro del modal de detalle (desktop + mobile).

**Por qué dual:** el cliente reportó que necesitaba saber el motivo de inhabilitación rápido, sin necesariamente abrir el modal. El tooltip nativo no funciona bien en mobile (no hay hover), pero ahí el modal cubre el caso. Con ambos, todo dispositivo puede ver el motivo en una interacción.

**Decisión técnica:** se usa el atributo `title` del `<button>` en el grid para el tooltip — sin librería extra. Compatible con el tooltip de multi-aislamiento que ya existía: la lógica condicional prioriza `disabledReason` cuando aplica.

### 14.5. Catering filtrado por área — fix de pipeline

**Qué:** El rol Catering venía sin filtrar áreas pese a tenerlas configuradas. La causa raíz era que `handleLogin` en `useHospitalState.ts` parseaba `assignedFloors` → `assignedAreas` **solo para HOSTESS**.

**Por qué la auditoría completa:** el primer fix superficial (sumar `Role.CATERING` a `ROLES_WITH_AREA_FILTER` en BedsView) no funcionó. Ese filtro requería que `assignedAreas.length > 0`, pero el array nunca se poblaba. Auditar el pipeline completo de SP → frontend reveló el bug en `handleLogin`.

**Side effect descubierto:** la suscripción Web Push de Catering también iba con `assignedAreas = []`, así que el filtro server-side no la limitaba a su piso → recibían push de todos los traslados. Se arregló automáticamente con el mismo fix del login (no requiere migración manual; el upsert al re-login sobrescribe la suscripción huérfana).

**Lección:** cuando un rol nuevo se suma al sistema (Catering vino después de Hostess), los `if (role === HOSTESS)` chequear si deberían ser `if (role === HOSTESS || role === CATERING)` o más amplios. Es un patrón común de bug.

### 14.6. Áreas críticas sin bloqueo por aislamiento

**Qué:** Las áreas `HUC` (UCO), `HUT` (UTI), `HIT` (ITR) y `HRA` (Sala Espera) están en `CRITICAL_AREAS_NO_BLOCK`. Cuando un paciente tiene aislamiento en una de estas, **no se bloquean las demás camas del mismo sector**.

**Por qué:** estas áreas tienen cubículos físicamente independientes (cada cama UTI es un box separado, los sillones HRA están separados, las camas ITR están separadas con cortinas/biombos). El bloqueo "todas las camas de la misma habitación" solo aplica a habitaciones compartidas reales (típicamente piso 4-8 con habitaciones de 2 camas).

**Implementación:** lista hard-coded en `BedsView.tsx`. Si se suman más áreas con esta característica, agregar al array. La decisión de qué áreas "no bloquean" es médica/operativa, no se infiere del response Gamma.

### 14.7. Rate limiting del login con Upstash + circuit breaker

**Qué:** El endpoint `/api/auth` ahora chequea un rate limit antes de validar credenciales. Con **5 intentos fallidos en 5 minutos → 15 min de bloqueo**. Login exitoso resetea.

**Por qué:** el hospital es un target real para brute force (datos médicos = valiosos). Las contraseñas se almacenan en plain text en SP, así que un brute force exitoso compromete cuentas inmediatamente. Sin rate limit, un atacante con un diccionario de contraseñas puede tirar miles de requests/min.

**Decisión clave: Upstash Redis con fallback a memoria.**

**Por qué Upstash y no solo in-memory:**
- Vercel puede tener múltiples instancias warm en simultáneo. In-memory significa contadores fragmentados → un atacante reparte intentos entre instancias y multiplica por N el rate efectivo.
- Cold start de Vercel resetea memoria → atacante recupera intentos cada vez que la instancia rota.
- Upstash centraliza el contador y persiste entre cold starts.

**Por qué fallback a memoria si Upstash está configurado:**
- El plan free tiene 10k commands/día. Aunque generosos para HPR, vale el cinturón: si Upstash falla (cuota, downtime, latencia alta), no podemos dejar el login expuesto sin rate limiting.
- Circuit breaker (3 fallos consecutivos → 5 min de cooldown) evita pagar el costo del timeout en cada login si Upstash está caído.

**Por qué key = `username:ip`:**
- Solo `username`: un atacante desde 100 IPs lo bypassea.
- Solo `ip`: si dos usuarios legítimos están en la misma red corporativa, comparten cuota.
- Combinado: cada par único tiene su propia cuota; un usuario legítimo no se ve afectado por intentos contra otro username desde otra IP.

**Limitaciones aceptadas:**
- No protege contra DDoS distribuido (miles de IPs distintas atacando muchas cuentas). Para eso hace falta protección a nivel infraestructura (Vercel Pro Edge, Cloudflare). Decisión: documentar y diferir hasta que sea problema real.
- El timestamp del bloqueo no migra entre Upstash y memoria si el breaker se abre/cierra durante un ataque activo. En el peor caso, el atacante recupera 5 intentos extra en el switch. Aceptable.

### 14.8. Ingreso ITR con financiador autocompletado readonly

**Qué:** En `NewRequestModal` y `EditRequestModal`, cuando el workflow es `Ingreso ITR`, el campo "Origen ITR / Financiador" se autocompleta desde `bed.institution` de la cama de origen y queda **readonly** (no editable manualmente).

**Por qué:** el financiador es información administrativa que ya viene de Gamma con la cama. Permitir edición manual abre la puerta a errores de tipeo o inconsistencias con PROGAL. Si por algún motivo Gamma no envió el financiador para esa cama, el campo queda con placeholder "Sin financiador registrado" — visible pero sin opción de "completarlo a mano".

**Trade-off:** si el operador necesita corregir el financiador (caso muy raro), tiene que hacerlo en PROGAL primero. Aceptable por consistencia entre sistemas.

---

## 15. Decisiones recientes (2026-05-11)

### 15.1. Separación testing/producción por columna en SP, no por proyecto

**Qué:** En lugar de tener listas SP separadas para producción y testing, se sumó una columna `Entorno_*` (texto, valores `PRODUCTIVO` / `TESTING`) a 5 listas:`07.Traslados`, `08.Aislamientos`, `09.PushSubscriptions`, `10.Notificaciones`, `11.DietaSnapshot`. Una variable `ENTORNO` en backend filtra y estampa el valor según el deploy.

**Por qué:**
- **Alternativa descartada — duplicar listas**: requeriría crear `07.Traslados-Test`, `08.Aislamientos-Test`, etc. Multiplica configuración, requiere mantenerlas sincronizadas (cambios de columna en una se replican manualmente en la otra), y el código tiene que decidir dinámicamente qué `LIST_ID` usar.
- **Alternativa descartada — site SP separado**: peor todavía. Site nuevo con replicación de configuración, costo operativo alto.
- **Ventaja de la columna**: una sola lista, un solo `LIST_ID` hardcoded por archivo, mismas columnas. El filtro `Entorno_X eq 'TESTING'` es trivial. La separación es **lógica**, no física.

**Default seguro `'TESTING'`**: cada `const ENTORNO = process.env.ENTORNO ?? 'TESTING'` evita que un misconfig en producción dispare push a usuarios reales sin querer. Si la env no está cargada, el deploy queda "aislado" en testing — falla cerrada.

**Caveat operativo aceptado**: la separación funciona **si y solo si** cada deploy de Vercel tiene su propia env `ENTORNO` cargada correctamente. Production debe tener `PRODUCTIVO`, Preview/local debe tener `TESTING`. El default fail-closed mitiga errores humanos.

**Lista exenta**: `08.DetalleTraslados` no tiene columna `Entorno_DT` — filtrado por transitividad porque los eventos se consultan por `IDUnivocoTraslado_DT` específico, y el frontend solo conoce IDs de su entorno actual (porque vinieron de un GET filtrado a `07.Traslados`).

### 15.2. Cron de cambio de dieta via GitHub Actions (no Vercel Cron)

**Qué:** Un cron job externo (GitHub Actions `*/30 * * * *`) llama un endpoint nuestro que detecta cambios de dieta en PROGAL y dispara push a Catering.

**Por qué GitHub Actions:**
- **Vercel Cron Hobby (free)**: solo 1 job/día. Insuficiente.
- **Vercel Cron Pro**: 40 jobs/día, pero plan pago.
- **GitHub Actions**: 2.000 min/mes gratis en repos privados. Cron de 30 min × 48 ejec/día × ~10-30s = ~24 min/día → cabe sobrado.

**Tradeoff aceptado**: el cron de GitHub Actions es best-effort, puede tener delays de hasta ~15 min reales. Para el caso de uso (notificar cambios de dieta), una latencia de 30-45 min es aceptable.

**Alternativa descartada — webhook directo desde Gamma**: lo más limpio pero Gamma no soporta webhooks de cambio. Tendría que pedir cambio en su API.

### 15.3. Bootstrap silencioso del cron (anti-spam en primer ciclo)

**Qué:** Cuando el cron corre por primera vez y un paciente no tiene snapshot previo en `11.DietaSnapshot`, **se crea el snapshot pero no se dispara push**. Solo a partir del segundo ciclo (cuando ya hay snapshot para comparar) se notifican cambios.

**Por qué:** sin esto, el primer ciclo después del deploy detectaría 50-80 "cambios" simultáneos (todos los pacientes vs estado vacío) → spam masivo de notifs a Catering en un solo golpe. El bootstrap silencioso es por **paciente**, no global: nuevos pacientes que ingresan en el medio también pasan por bootstrap silencioso individual.

### 15.4. LIST_ID hardcoded vs env var

**Qué:** Los GUIDs de listas SharePoint están hardcoded en cada archivo (`const LIST_ID = 'c7417674-...';`) en lugar de leerse desde envs.

**Por qué:** los `LIST_ID` son **constantes estructurales del proyecto**, no secretos ni configurables. Cambiar de lista implica cambiar también el contrato de columnas, código de mapeo, etc — no es algo que se haga por env. La inicial `11.DietaSnapshot` (último incorporado) primero se planteó como env var, pero por consistencia con las otras 4 listas se hardcodeó.

**Ventaja**: una env var menos para gestionar. La estructura del proyecto vive en el código.

### 15.5. Cache split en bed-enrich (paciente largo + evento corto)

**Qué:** El endpoint `/api/bed-enrich` cachea por separado dos bloques: el del paciente (DNI, edad, sexo, financiador) con TTL 10 min, y el del evento (diagnóstico, plan, fechas, **dieta**) con TTL 30 segundos.

**Por qué:** antes había un solo cache de 10 min para todo el response. Los cambios de dieta en PROGAL quedaban invisibles 10 minutos. Bajar el TTL a 30s para todo hubiera obligado a re-consultar `consultarpacientecodigo` cada vez sin necesidad (DNI/edad/sexo no cambian durante una internación → desperdicia carga sobre Gamma).

**Solución**: dos caches independientes con TTL apropiado para cada tipo de dato. El bloque "paciente" usa el TTL largo porque es estable; el bloque "evento" usa TTL corto porque cambia en vivo.

### 15.6. Bypass del cache al click del modal (?fresh=1)

**Qué:** El modal de detalle del paciente pasa siempre `?fresh=1` al endpoint `/api/bed-enrich`. El backend ignora el cache del evento en ese caso, pero mantiene el de paciente.

**Por qué:** queremos garantizar que cada vez que un usuario abra la card vea la dieta y diagnóstico más recientes (caso edge: cambio en PROGAL en el segundo 5 después del último request → con cache de 30s seguiríamos viendo el dato viejo durante 25s).

**Trade-off aceptado:** carga extra sobre Gamma cada vez que se abre un modal (~1.5s por apertura). Como Catering típicamente abre 1-3 cards/hora, no es batch ni saturación.

**Los PDFs sí mantienen el cache**: `enrichBedsForPdf` no pasa `fresh=1` porque procesa muchas camas en serie y se beneficia del cache de 30s. Casos de uso distintos → defaults distintos.

### 15.7. SW push log en IndexedDB para diagnóstico

**Qué:** El Service Worker registra cada push recibido en una IndexedDB local (`mediflow-push-log`, TTL 24h, cap 50 entradas) con timestamp, ticketId, type, title, body, `Notification.permission`, scope.

**Por qué:** cuando el cliente reporta "no me llegan notifs", hay dos hipótesis muy distintas:
1. **El push no llega al SW** (red, sub inválida, server) → problema en el pipeline server-side.
2. **El push llega al SW pero el banner heads-up no aparece** (channel Android en importancia baja, battery optimization) → problema de config del dispositivo, no de código.

Sin el log, no podemos distinguir. Con el log, abrimos la consola del cliente, vemos las entradas (si las hay) y diagnosticamos en segundos.

**Por qué IndexedDB y no localStorage**: el SW no tiene acceso a localStorage del browser context. IndexedDB es la única opción de persistencia cross-session disponible al SW.

### 15.8. Badge SVG dedicado (no logo full color)

**Qué:** El payload del Web Push usa `badge: '/badge.svg'` — un SVG sin fondo, shapes en blanco sólido. Antes usaba `/logo.svg` que tiene `fill="#022C22"` como background.

**Por qué:** Android trata el `badge` como **alpha mask** para el ícono pequeño de la status bar (color del sistema). Algunos builds de Chrome Android no manejan bien SVGs con fondo color o transparencias mal definidas — degradan la notif a menor prioridad visual (banner no aparece). El badge monocromático es lo que recomienda la documentación oficial.

**Alternativa descartada — PNG monocromático**: lo más conservador. Se descartó por ahora porque crear un PNG correcto requiere un editor de imágenes; el SVG sin fondo cumple la misma función en la mayoría de los Chrome Android modernos. Si igualmente da problemas, se puede reemplazar con un PNG sin tocar código.

### 15.9. Bloquear notifs in-app del polling para Catering (separar push del browser)

**Qué:** La función `isRelevant` del detector de cambios en `useHospitalState` ahora bloquea TODAS las notifs in-app para el rol Catering. Solo reciben push via server-side (`RECEPTION_CONFIRMED` + `DIET_CHANGE`).

**Por qué:** El frontend hacía doble trabajo. Por un lado, el server-side push filtraba correctamente: para Catering solo permitía `RECEPTION_CONFIRMED` (y desde el último deploy, `DIET_CHANGE`). Por otro lado, el detector local del polling tenía la lógica simplista `role !== Role.HOSTESS → return true`, que incluía Catering como "ve todo". Cuando el polling detectaba un ticket nuevo o un cambio de status, el cliente disparaba `new window.Notification(...)` — una notificación del SO desde el browser, INDEPENDIENTE del push del server.

Resultado del bug: Catering recibía "Nueva Solicitud de Traslado" (NEW_TICKET) cada vez que se creaba un ticket en cualquier piso, aunque el push del server explícitamente lo bloqueaba. Los logs de Vercel confirmaron que el push server NO le mandó NEW_TICKET → la notif venía del cliente.

**Alternativas consideradas:**
- **Filtrar in-app por tipo + área (similar al server)**: más simétrico pero más código. Requeriría duplicar la lógica de `isRelevant` del server en el cliente. Frágil cuando se agregan tipos nuevos.
- **Eliminar `new window.Notification(...)` del cliente**: rompería el caso Hostess donde sí queremos notifs locales del polling para tickets de su área.
- **Bloqueo total para Catering (elegido)**: simple, robusto, y consistente con el modelo mental "Catering solo recibe pushes del server". La app abierta no agrega valor extra para Catering — los pushes llegan igual.

**Trade-off aceptado:** si Catering tiene la app abierta y otro user marca "Recepción OK", no verá toast in-app instantáneo. El push del server llegará en ms-segundos (más confiable, y único punto de verdad). Aceptable porque Catering usa la app más como visualización que como operativa en tiempo real.

**Para futuras notifs específicas de Catering**: que vengan exclusivamente del server-side via push. El cliente NO disparará nada local para este rol.

---

## 16. Decisiones recientes (2026-05-13)

### 16.1. Permisos por rol configurables desde SP (no hardcoded en código)

**Qué:** Cada rol en `99.ABMRoles_Traslados` tiene un campo `Permisos_RT` con un catálogo cerrado de 12 permisos de acción (`crear_ticket`, `editar_ticket`, etc.). El frontend usa un helper `can(user, 'permiso')` en vez de checks `role === Role.X`. Configurable desde el ABM de Roles sin deploy.

**Por qué:** El sistema venía creciendo con roles ad-hoc (CATERING, DIRECCION) y cada uno requería ~15 cambios de gates hardcodeados en el frontend. Cuando Jorge pidió "DIRECCION read-only de todo", el cambio implicó tocar App.tsx, useHospitalState, RequestsView, BedsView. Mover los permisos a SP permite que el admin agregue/modifique roles sin pedirle al equipo de desarrollo cada vez.

**Alternativas descartadas:**
- **Por-role config en `lib/constants.ts`**: más simple, pero requiere deploy ante cualquier cambio. Solo movería el problema de hardcode a un archivo central, no lo resolvía.
- **Permisos por user, no por rol**: máxima flexibilidad pero ABM de Usuarios se complejiza (tildar 12 permisos por cada user). No hay caso real donde dos users del mismo rol deban tener permisos distintos.
- **Permisos en el JWT**: dispara revocación complicada — si Jorge cambia los permisos de Dirección, los tokens viejos (8h-10 años) seguirían vigentes. Decidimos enriquecer el `User` object (que vive en localStorage, separado del JWT) — al cerrar+abrir sesión se refresca; un logout silencioso fuerza el ciclo cuando detecta que faltan permisos.

**Trade-off aceptado:** un cambio en SP tarda hasta 5 min en propagarse (TTL del cache) + ciclo de re-login del usuario. Para una app con ~30 usuarios y cambios mensuales, aceptable.

### 16.2. Cache server-side de roles con TTL 5 min

**Qué:** [api/role-cache.ts](api/role-cache.ts) guarda la lista de roles activos en memoria por 5 minutos. Reutilizado por `api/auth.ts` (login) y `api/push-utils.ts` (filtrado de subscriptions).

**Por qué:** Sin cache, cada login y cada filtro de push haría un fetch a SharePoint. El polling de tickets cada 8s acumula muchos triggers cuando hay updates frecuentes. SP es lento (300-800ms por query, sin indices buenos para nuestros filtros). El cache pasa de "N requests por segundo" a "1 request cada 5 min por cold start de Vercel".

**Alternativas descartadas:**
- **Sin cache**: latencia inaceptable y costo de SP.
- **Cache más largo (1h)**: cambios en ABM de Roles tardarían 1h en reflejarse. Por debajo de 5 min ya tiene buen ratio sin sentirse "stale".
- **Cache-stampede protection (singleflight)**: relevante solo bajo carga muy alta. Para nuestra escala el caso patológico es un cold start con 5 logins simultáneos — 5 fetches en paralelo, aceptable.

**Trade-off aceptado:** después de editar un rol en el ABM, los users en sesión activa no ven el cambio hasta re-login. El cache se invalida explícitamente al hacer POST/PATCH/DELETE en `api/roles.ts` para el lado server, pero cada user mantiene su copia en localStorage del momento del login.

### 16.3. Logout silencioso para tokens viejos sin `permissions`

**Qué:** [App.tsx](App.tsx) tiene un useEffect que detecta si el `currentUser` (de localStorage) no tiene `permissions` o `modules` (campos nuevos del refactor) y dispara `handleLogout()` automáticamente.

**Por qué:** Al desplegar el refactor de permisos, los users logueados tenían tokens válidos (JWT de 8h o 10 años para HOSTESS) pero el objeto `User` en localStorage no contenía `permissions`. Sin el logout forzado, los `can()` retornarían false en todo y el user perdería todos los botones de acción sin saber por qué. El re-login los sincroniza con la nueva config de SP.

**Alternativas descartadas:**
- **Migration on read**: detectar el user viejo y enriquecerlo on-the-fly llamando un nuevo endpoint `/api/me/refresh`. Más complejo, agrega un endpoint, requiere coordinación con el flow de auth.
- **Esperar a que expire el JWT**: para HOSTESS con tokens de 10 años no es viable.

**Trade-off aceptado:** un blip de "fui deslogueado al refrescar" la primera vez post-deploy. Mejor que botones que no funcionan sin feedback.

### 16.4. Mark-by-event vs spItemId para marcar notif como leída

**Qué:** El endpoint `PATCH /api/notifications` acepta `{ ticketId, type }` además de `{ notificationId }`. Busca y marca **todas las filas SP del user logueado** que machean `TicketId_N + Type_N + Status_N='Enviada'`.

**Por qué:** Hay dos streams de notifs: las locales (`NOTIF-POLL-*`, generadas por polling) y las SP (numéricas, generadas server-side por push). Cuando el user clickea una notif local del dropdown, el cliente conoce `ticketId+type` pero NO el `spItemId` de la fila SP correspondiente (porque el push es fire-and-forget, no devuelve el id creado). Lo mismo para el tap de push: el SW recibe `ticketId+type` en el payload, no el spItemId.

**Alternativas descartadas:**
- **Devolver `spItemId` en el push payload**: requeriría que `api/push-utils.ts` espere el POST en `10.Notificaciones` antes de mandar el push (hoy es Promise.allSettled fire-and-forget). Suma latencia al push (~300ms) y acopla dos operaciones que hoy son independientes.
- **Almacenar `spItemId` en la notif local**: necesitaría una sincronización post-hoc — el cliente recibe el push y matchea con la local. Race conditions complejas.
- **Mark-by-event (elegido)**: simple, lookup determinístico, funciona para los casos cubiertos. La fila SP siempre tiene `TicketId_N` (excepto DIET_CHANGE que es edge case sin notif local).

**Trade-off aceptado:** un lookup extra en SP por cada click. Con `filterByFloors` activo + filtros por Status_N=Enviada, el query devuelve 0-3 filas típicamente — costo mínimo.

### 16.5. SW → cliente vía `postMessage` (en vez de fetch directo desde el SW)

**Qué:** El service worker no hace fetch a `/api/notifications` al tap de una push. Delega al cliente: si hay un client abierto le manda `postMessage({kind, ticketId, type})`; si no, abre la app con `?notifTicketId=X&notifType=Y` y el cliente lee los params al mount.

**Por qué:** El SW no tiene acceso al JWT del user (vive en localStorage del browser context, separado del SW). Las alternativas eran:
- **Signed URLs en el push payload**: el server firma un token único para "marcar esta notif" que el SW puede usar sin JWT. Funciona pero suma criptografía y manejo de revocation.
- **Almacenar JWT en IndexedDB para que el SW lo lea**: rompe el aislamiento de la sesión y agrega vector de ataque (XSS leyendo IndexedDB).
- **postMessage al client (elegido)**: el cliente ya tiene el JWT y el fetch infra completa. El SW solo decide "qué cliente avisar".

**Trade-off aceptado:** si el user tapea la push pero antes de que la app cargue la cierra → la notif no se marca (no llegó a disparar el fetch). El polling de 30s la traerá de vuelta al banner y el user la puede marcar manualmente. Aceptable porque en práctica el user que tapea quiere abrir la app (no cerrarla inmediatamente).

### 16.6. Filtro server-side de `Status_N='Enviada'` en GET de notifications

**Qué:** [api/notifications.ts](api/notifications.ts) GET filtra `fields/Status_N eq 'Enviada'` directamente en el query a SP, no en el cliente.

**Por qué:** El filtro de "20 min sin confirmar" sigue siendo client-side (por simpleza — no requiere indexar `Fecha_N` en SP), pero el filtro por estado es fundamental: sin él el endpoint traía todas las notifs históricas del user (incluyendo las ya leídas). Para un user con miles de notifs en su histórico, el payload se hacía pesado y el cliente filtraba después. Mover el filtro a SP reduce el payload típico de ~500 KB a ~5 KB.

**Trade-off aceptado:** el endpoint ahora es estricto sobre el campo `Status_N`. Si SP no propagó el PATCH (eventual consistency), una notif marcada como Leída puede aparecer brevemente en el siguiente GET. El cliente refresca automáticamente — el efecto es invisible en práctica.

### 16.7. Eliminar permiso `editar_cama` del catálogo (YAGNI)

**Qué:** Originalmente el catálogo tenía 13 permisos, incluido `editar_cama` como placeholder para una acción futura (habilitar/inhabilitar cama manualmente desde el Mapa). Se sacó.

**Por qué:** No hay UI ni handler que lo use. Cumple con la regla "Don't design for hypothetical future requirements". El catálogo se mantiene cerrado y extensible — si en el futuro Jorge pide la feature, se agrega el permiso en una sola línea de `types.ts`.

**Cómo se removió:** script one-shot PATCHeó Admin (13 → 12 permisos) y Admision (8 → 7 permisos). El script se borró tras correr.

## 17. Decisiones recientes (2026-05-27)

### 17.1. Enrich upfront en `/api/beds` vs. endpoint separado vs. cron

**Qué:** `/api/beds` ahora enriquece todas las camas ocupadas con data del evento (diet, ayunos, diagnóstico, plan, fechas) usando 5 workers paralelos sobre un cache compartido de 60s.

**Alternativas descartadas:**
- **Endpoint separado en background** (`/api/beds-fasting`): beds carga rápido, el ícono aparece segundos después. Menos riesgo pero 2 endpoints + flash visual.
- **Cron pre-computa a SP** (estilo cron-diet-changes): frontend siempre instantáneo pero más complejo (cron + SP list + join), latencia de hasta 10 min para reflejar cambios.

**Por qué upfront:** si ya pagamos el costo de fetchear el evento para los ayunos, no tiene sentido deferirlo — aprovechamos para traer todo (dieta, diagnóstico, plan, fechas). El modal abre instantáneamente. Cold load ~5–8s, warm ~500ms (beds cache 45s + event cache 60s absorben el poll de 60s).

**Impacto:** `bed-enrich` ya no usa `fresh=1` en el click — lee del cache compartido. Solo fetch del paciente (DNI/edad/sexo). Latencia de modal: ~500ms primera vez, ~50ms subsiguiente.

### 17.2. Permisos granulares de notificación (4 permisos vs. 1 `recibe_push`)

**Qué:** Reemplazar el permiso único `recibe_push` por 4 granulares: `notif_new_ticket`, `notif_status_update`, `notif_reception_confirmed`, `notif_diet_change`.

**Alternativas descartadas:**
- **Mantener `recibe_push` + filtro hardcoded por rol**: sencillo pero inflexible. Catering necesitaba solo dieta + recepción; con `recibe_push` binario era todo o nada.
- **Filtro por `type` en la UI de roles** (sin backend): permite al user elegir pero el server sigue mandando todo, desperdicia bandwidth.

**Por qué granular:** cada tipo de notif tiene público distinto. `NOTIF_TYPE_TO_PERMISSION` mapea `NotificationType → Permission`. El push-utils y el polling detector del cliente comparten la misma función `canReceiveNotif(user, type)`.

### 17.3. Cache compartido de eventos en gamma-client.ts

**Qué:** `getEventCached()` en `gamma-client.ts` con Map módulo-nivel (60s TTL). Reemplaza los caches locales de `bed-enrich.ts`.

**Alternativas descartadas:**
- **Cache por endpoint** (cada uno mantiene su Map): duplica fetch cuando `/api/beds` carga y luego el user clickea una cama.
- **Redis / external cache**: overengineering para Vercel serverless. El Map vive en la invocación warm y es suficiente.

**Por qué:** single source of truth para eventos. Si `/api/beds` pobló el cache hace 30s, el click en bed-enrich lo lee sin tocar Gamma. `setEventCache()` permite al path `fresh=1` actualizar el cache compartido.

### 17.4. toggleModule restaura permisos al reactivar módulo

**Qué:** Al desactivar un módulo, sus permisos se borran del Set. Antes, reactivarlo NO los restauraba. Ahora se guarda un `originalPermissions` snapshot al abrir el modal y se restaura al reactivar.

**Por qué:** bug reportado por Agustín — editó notificaciones de un rol y los permisos se vaciaron. Análisis mostró que el flujo de togglePermission (solo notifs) es seguro, pero un toggle accidental de módulo destruía permisos irrecuperablemente.

**Impacto:** solo cambia `RoleManagementView.tsx`. El backend agrega log warning cuando se escribe `Permisos_RT` vacío para trazabilidad futura.

## 18. Decisiones recientes (mapa de camas, notifs, ayunos, geo)

### 18.1. Enrich del mapa de camas precomputado en SharePoint (cron) vs. on-request

**Qué:** `/api/beds` ya no hace N llamadas a `obtenereventointernacion` por cama en el request del usuario. Un cron (`cron-enrich-beds`, cada 15min, 8 workers paralelos) precomputa todo el enrich en la lista `12.EnrichCamas` y `/api/beds` lo lee de SP (1 query + merge en memoria).

**Por qué:** con ~150 camas ocupadas, las N llamadas (incluso con cache y workers) llevaban el request a >60s y Vercel mataba la conexión — se vio en una demo. El enfoque clásico de "fast/enrich en dos fases" (sección 5.2) ya no alcanza con la cantidad de campos que requiere el modal (DNI, edad, sexo, diagnóstico, dieta, ayunos, fechas, plan).

**Alternativas descartadas:**
- **Mantener el on-request + bajar el TTL del cache de evento**: igual el primer request post-cold-start hace las N llamadas. No resuelve el caso de la demo.
- **Vercel KV / Redis externo**: agrega infra. SharePoint ya es la DB de la app y se reusa el patrón de `11.DietaSnapshot`.
- **Mapa también desde SP (no live)**: el estado de cama (ocupada/disponible) es operativamente crítico (riesgo de doble asignación) y debe ser real-time. Solo cacheamos el enrich.

**Impacto:** `bed-enrich` queda como fallback on-demand (`fresh=1` o cama sin `enriched` flag). Hay duplicación de fetch de evento (cron-enrich-beds + cron-diet-changes), aceptada como deuda; se evalúa unificar si crece.

### 18.2. ETag de `/api/beds` incluye firma del enrich

**Qué:** El ETag se calcula como `simpleHash(mapSig + '#' + enrichSig)` donde `enrichSig` es hash de `EventKey:UpdatedAt_EC` de las filas aplicadas.

**Por qué:** sin esto, el polling del cliente recibe 304 cuando el cron actualizó el enrich pero los beds del mapa no cambiaron de estado → la app nunca refleja cambios de ayuno/dieta/diagnóstico hasta recargar. Con el enrichSig, cada actualización del cron rompe el ETag y la app baja el payload nuevo en su próximo poll.

**Trade-off:** el cron reescribe `UpdatedAt_EC` cada ciclo aunque nada haya cambiado → el cliente baja el payload completo cada ~15min. Trivial.

### 18.3. Detección de cambio de fasting en `cron-enrich-beds`, no en `cron-diet-changes`

**Qué:** Originalmente la detección de cambios de ayuno vivía en `cron-diet-changes` con una columna `FastingHash_DS` en `11.DietaSnapshot`. Se movió a `cron-enrich-beds` que ya escribe el `fasting` en `Payload_EC` y puede comparar viejo vs nuevo trivialmente.

**Por qué:** la columna `FastingHash_DS` debía crearse a mano en SP (el app de Graph no tiene `Sites.Manage.All`). Más importante: era duplicar estado. El cron que escribe el dato es el que mejor sabe cuándo cambia.

**Cómo:** `fetchEnrichRows` parsea `Payload_EC` y extrae `oldFasting`. El worker compara `hashFastingSummary(oldFasting)` vs el nuevo y, si difieren **y la fila ya existía** (no es bootstrap del paciente), manda push `FASTING_CHANGE`. Bootstrap silencioso solo para pacientes nuevos (sin fila previa), no para el campo fasting per se — así un ayuno cargado tras el deploy SÍ dispara push aunque sea la primera vez que se detecta para ese paciente.

### 18.4. `markAllForUser` con Microsoft Graph `$batch`

**Qué:** El modo PATCH `{ markAllForUser: true }` marca **todas** las `Enviada` del user (no el top-50 visible del banner) usando el endpoint `/$batch` de Graph (20 PATCH por request).

**Por qué:** un Admin con 1003 `Enviada` acumuladas requería 1003 PATCH individuales (~150-300ms cada uno) = >5 minutos. El user refresca antes de que termine, el optimistic se revierte, el banner sigue. Con `$batch` baja a ~10s.

**Alternativa descartada:** subir el pool de workers a 20+ — sigue siendo 1003 requests HTTP individuales, no resuelve el problema de fondo.

### 18.5. Cron de cleanup de notificaciones (no destructivo, 2 días)

**Qué:** `cron-cleanup-notifs` (diario 4am) marca `Status_N = 'Leida'` las notifs `Enviada` con `Fecha_N` < hoy - 2 días. NO borra.

**Por qué:** la raíz del backlog (Admin acumulando 1000+ notifs) requiere prevención automática. Una notif sin confirmar tras 2 días ya no es accionable. Mantiene el volumen sano y el banner refleja solo lo realmente reciente.

**Por qué "marcar Leida" y no "borrar":** preservar historial (auditoría), reversibilidad si hubo error. El volumen de la lista sigue creciendo lentamente, pero no impacta al banner (que filtra `Status_N='Enviada'`).

### 18.6. Geo: IP-first + persistencia en localStorage + `Permissions API`

**Qué:** El cliente valida ubicación **sin coords primero**. Solo pide GPS si el server responde `geo_unavailable` Y `navigator.permissions.query({name:'geolocation'})` devuelve `granted`. La última geo válida se persiste en `localStorage` (key `mediflow_geo`, TTL 30min) para sobrevivir recargas.

**Por qué:** los prompts de geolocalización se repetían tras cada deploy (autoUpdate del SW recarga la PWA → re-mount → `useRef` vacío → revalidate llama `getCurrentPosition`). En mobile el permiso es efímero (allow-once / iOS standalone) → prompt sorpresa. La combinación IP-first + persistencia + check de permiso elimina prompts en uso normal:
- WiFi del hospital → IP autoriza, GPS nunca se pide.
- Datos móviles con geo cacheada → se reusa, no prompt.
- Datos móviles sin cache en background → fail-open (no expulsa, no prompt sorpresa).

**Trade-off de seguridad aceptado:** la geo cacheada sobrevive 30min a recargas. Si alguien se va del hospital con la app abierta, la expulsión por GPS puede tardar hasta 30min (ya era el TTL en memoria; ahora también persiste). La expulsión por IP (al perder la WiFi) sigue siendo inmediata.

### 18.7. Cerrar notificaciones del SO al marcar leído (WhatsApp-like)

**Qué:** Cuando el usuario marca una notif como leída en la app (o el push se tap-ea), el cliente postMessage al SW con `{ type: 'CLOSE_NOTIFICATIONS', ticketId }`. El SW usa `registration.getNotifications()` y cierra las que matcheen `data.ticketId` ("el hilo del ticket"). Sin args → cierra todas (mark-all).

**Por qué:** las notificaciones del SO (lock screen) persistían aunque el usuario las leyera en la app — desconectado del modelo mental de "ya lo vi". Patrón estándar de Web Push.

**Caveat:** funciona prolijo en Android. En iOS PWA el SO controla más estrictamente la bandeja; puede no responder al `close()` programático.

### 18.8. Ayunos: cálculo client-side en hora Argentina

**Qué:** Las "próximas" ocurrencias de ayuno se recalculan en el cliente en cada render usando `Date.UTC(Y, M-1, D+d, H+3, ...)` (UTC-3 fijo). El servidor (`api/ayunos.ts`) sigue calculando para el cron pero el cliente lo ignora y recalcula con su `now`.

**Por qué:** dos razones combinadas:
1. **TZ bug**: el cron corre en Vercel (UTC), `new Date()`+`setHours(15)` daba 15:00 UTC = 12:00 ART, corriendo todo 3hs.
2. **Reloj inteligente**: el cron precomputaba `upcoming` y lo congelaba 15min; el cliente lo reemplaza con cálculo en vivo (gracia 1h por ocurrencia, así el ayuno de las 15 se ve hasta las 16).

**Trade-off:** Argentina no tiene DST, UTC-3 hardcoded es seguro. Si alguna vez cambiara, ajustar `ART_OFFSET_H` o usar `Intl` con `timeZone`.

### 18.9. Modal de cama: `min-w-0` en el wrapper + tabs scrolleables

**Qué:** El `DialogContent` base usa CSS grid en su contenedor scrollable; sus hijos directos heredan `min-width: auto` y no encogen por debajo del contenido → overflow. El wrapper del modal de cama lleva `min-w-0` para respetar el ancho del modal. Los tabs (mobile) usan `overflow-x-auto` + `shrink-0 whitespace-nowrap` (no `flex-1`).

**Por qué:** en mobile la sección de aislamiento desbordaba a la izquierda ("MARCAR" cortado), y los 4 tabs no entraban en el fondo gris. El fix está acotado al modal de cama; no se toca el `DialogContent` base para no afectar otros modales.

### 18.10. La pill de ayuno/dieta "acompaña al paciente" (snapshot cliente-side)

**Qué:** El cliente mantiene un `Map<patientCode, EnrichSnapshot>` (en `useRef`, mutado in-place) derivado de los polls. En cada `fetchBeds`, los beds con `enriched === true` actualizan su entrada del mapa (incluso con valores `undefined`). Al construir `beds` para render, después de `mergeBeds` corre `reapplyEnrichFromMap` que sobreescribe los campos del enrich con el snapshot del paciente actual de cada cama. Resultado: la pill de ayuno (y dieta/diagnóstico/etc.) aparece donde está el `patientCode`, no donde el server o el cron creían.

**Por qué:** el problema reportado por Catering — tras mover un paciente con ayuno de 805 → 801, la pill quedaba en 805 hasta el próximo cron (15min); peor, si BOTTOLI (sin ayuno) entraba a 805 antes del cron, la pill se "heredaba" al nuevo paciente. Hay múltiples ventanas donde el server puede devolver inconsistencia transitoria (cache 45s + Gamma desincronizado entre `obtenermapacamas` general y `obtenermapacamasocupadas` + cron cada 15min + tickets COMPLETED que dejan de aplicar `mergeBeds`). La solución a nivel server no cubre el caso "Progal directo sin ticket". El snapshot client-side combina **PROGAL + tickets activos + ENRICH "histórico por paciente"** — la pill sigue al patientCode siempre.

**Alternativas descartadas:**
- **Limpieza retroactiva por ticket COMPLETED reciente**: cubre solo el caso con ticket MediFlow. Falla si Admisión mueve directamente en Progal (no hay ticket que limpiar). Además, no garantiza que la pill aparezca en el destino antes del cron.
- **Hardening server-side adicional**: ya hay un filtro por `occEventKeys` en [api/beds.ts:131](api/beds.ts#L131). Reforzarlo no resolvía el caso del cliente (que reportaba el bug aún con el filtro activo). El problema vive en el desfase temporal, no en el filtro.
- **Reducir el cron a 5min**: 3× más carga + 3× más calls a Gamma. El usuario decidió mantener 15min.

**Trade-off aceptado:** si un ayuno se **cancela** en Gamma y el cron aún no procesó al paciente, el snapshot mantiene la pill por hasta 15min. Mismo comportamiento que el flujo anterior — el fix no empeora ese caso. Eliminarlo requeriría disparar el cron on-demand al confirmar el ticket o al detectar el cambio en Gamma — fuera de alcance.

### 18.11. Push del primer ayuno: rama explícita "paciente recién ingresado"

**Qué:** En `cron-enrich-beds`, además de la rama "fila existente y el hash cambió", hay una segunda rama: si la fila es **nueva** (no había estado previo) Y el paciente tiene fasting Y su `admissionDate` es ≤24h atrás → enviar push (`FASTING_CHANGE`, body "Nuevo ayuno programado: HH:MM").

**Por qué:** la rama original ("solo push si la fila YA existía") trataba a todo paciente nuevo como bootstrap silencioso, perdiendo el push del primer ayuno cuando coincidía con la primera vez que el cron procesaba a ese paciente. Caso real: paciente HECTOR EDUARDO ingresa al hospital, le cargan ayuno a las 09:24 ART, el cron 09:30 crea la fila en `12.EnrichCamas` con el fasting → bootstrap silencioso → push perdido.

**Por qué con `admissionDate ≤ 24h` y no "siempre que sea nuevo":** sin la condición, un futuro reset de la lista `12.EnrichCamas` (o el primer deploy del cron) crearía filas para TODOS los pacientes pre-existentes con ayuno → spam masivo de "Nuevo ayuno programado". El umbral 24h asegura que solo dispare para pacientes **realmente recién ingresados**.

**Alternativas descartadas:**
- **Flag global "bootstrap completado" en SP**: una fila extra en otra lista para saber si el cron ya hizo su primer ciclo. Más complejidad y otra dependencia operativa.
- **Notificar siempre paciente nuevo (sin umbral)**: simple pero introduce el riesgo de spam mencionado.
- **Comparar el count de filas nuevas por ciclo**: heurística frágil (ej. múltiples ingresos simultáneos darían falso positivo de bootstrap).

## 19. Decisiones recientes (robustez de crons y consolidación, 2026-06-08)

### 19.1. Timeout por llamada a Gamma con `AbortController`

**Qué:** todas las llamadas a la VM de Gamma pasan por `fetchWithTimeout` (default 30s, env `GAMMA_FETCH_TIMEOUT_MS`).

**Por qué:** la VM proxy single-node respondía en 20-25s o se colgaba; sin techo por llamada un request colgado mataba la función entera (status 0 / `FUNCTION_INVOCATION_TIMEOUT`). El timeout convierte "Gamma colgada" en "error de esa cama" y la corrida sigue.

**Alternativas descartadas:** subir `maxDuration` (no ataca el cuelgue, solo lo posterga); bajar concurrencia (no evita un único request infinito).

### 19.2. Presupuesto de tiempo por corrida vs. dejar que Vercel mate la función

**Qué:** `deadline = now + CRON_BUDGET_MS` (default 240s); el loop corta al alcanzarlo y devuelve 200 con stats parciales (`skippedByBudget`).

**Por qué:** un timeout de plataforma deja status 0 sin diagnóstico y sin garantía de idempotencia. Cortar nosotros mismos es prolijo: se reporta qué quedó pendiente y se retoma el ciclo siguiente. El patrón persist-before-notify hace que ninguna notificación se pierda por el corte.

**Alternativas descartadas:** subir `maxDuration` (no resuelve, solo corre el límite); procesar menos camas por corrida con un tope fijo (no se adapta a la latencia real de Gamma).

### 19.3. Detección de dieta consolidada en `cron-enrich-beds` (eliminar `cron-diet-changes`)

**Qué:** la detección de cambio de dieta se movió a `cron-enrich-beds`; el cron de dietas se desprogramó de `vercel.json`.

**Por qué:** ambos crons fetcheaban el mismo evento por cama — el doble de carga sobre la VM lenta. Enrich ya tiene `dietTags` en su payload; reusar ese baseline (`oldDietTags` del `Payload_EC`) elimina la duplicación y unifica las notis (ayuno + dieta) en una sola corrida. El hash es idéntico al viejo → sin falsos positivos al migrar.

**Alternativas descartadas:**
- **Mantener los dos crons desfasados** (`enrich` en `0,15,30,45`, `diet` en `7,22,37,52`): funciona contra la contención pero NO elimina la duplicación de llamadas a Gamma. Fue el paso intermedio antes de consolidar.
- **Borrar el archivo `cron-diet-changes.ts`**: se conserva para rebaseline manual (`?silent=1`) y como referencia; solo se desprogramó.

### 19.4. `eventFetchFailed`: no tratar un fetch fallido como "dato vacío"

**Qué:** `buildEnrich` devuelve `eventFetchFailed`; los crons saltean upsert/push cuando el evento no se pudo traer. `cron-diet-changes` hace `continue` si `event === null`.

**Por qué:** `fetchEventDetails` devuelve `null` tanto en "sin evento" como en "fetch falló/timeout". Tratarlo como dieta/ayuno vacíos disparaba falsos "dieta removida" / "Ayuno cancelado" y pisaba el cache bueno de `12.EnrichCamas`. Con los timeouts (19.1) el caso se vuelve más frecuente, así que el guard es necesario.

### 19.5. Dieta sin push en "paciente recién ingresado" (a diferencia del ayuno)

**Qué:** la dieta solo notifica cuando una fila existente cambia de hash; NO usa la rama "admisión ≤24h" que sí tiene el ayuno (§18.11).

**Por qué:** decisión de negocio confirmada con el cliente — el ayuno recién cargado es operativamente urgente para catering (preparar/suspender comida según horario), la dieta de un ingreso no agrega valor como alerta. Mantener la dieta en bootstrap silencioso evita ruido innecesario.

## 20. Decisiones recientes (2026-06-12)

### 20.1. Una fila de `10.Notificaciones` por usuario, no por suscripción

**Qué:** `sendPushToSubscribers` deduplica `relevant` por `userId` antes de escribir en `10.Notificaciones` (una fila por usuario por evento). La ENTREGA de push se mantiene por endpoint.

**Por qué:** el loop de guardado reusaba el array de suscripciones (una por endpoint en `09.PushSubscriptions`), generando N filas idénticas por evento para usuarios multi-dispositivo → campanita duplicada/triplicada (565 filas de exceso sobre 257 eventos reales en un día, confirmado con query read-only). El registro in-app es conceptualmente **por-usuario**; la entrega es **por-dispositivo**. Separar ambas dimensiones arregla la campanita sin perder pushes en ningún dispositivo.

**Alternativas descartadas:**
- **Deduplicar también la entrega de push:** un usuario con celular + PC recibiría el aviso del SO en un solo dispositivo. Operativamente indeseable (tablets compartidas de azafatas, admin multi-dispositivo). El default seguro es deduplicar **solo la escritura**.
- **Solo arreglar el render (sin tocar el write):** dejaría `10.Notificaciones` creciendo con basura y el badge server-side (`Status_N='Enviada'`) inflado. El render-dedup se suma como defensa, no como cura.

### 20.2. Dedup defensivo en el render de la campanita (defense-in-depth)

**Qué:** el memo `bellNotifications` colapsa filas duplicadas por `ticketId|type|minuto` (fallback `type|title|message|minuto` cuando no hay `ticketId`), conservando el id de SP y haciendo OR del flag `isRead`.

**Por qué:** aunque el fix write-side (20.1) corta la fuente, las filas ya escritas —y cualquier duplicado en vuelo durante el deploy— seguirían visibles. El render-dedup garantiza que el usuario nunca vea un duplicado, sin depender de limpiar SP. **Trade-off aceptado:** el bucket de minuto puede fusionar dos transiciones reales del mismo ticket en el mismo minuto (caso raro); timestamps espaciados se preservan.

### 20.3. Limpieza de duplicados: read+delete conservador por `Fecha_N` exacto

**Qué:** el one-off borra solo filas con `UserId_N|TicketId_N|Type_N|Fecha_N` idéntico (el fanout por suscripción), conservando 1 por grupo. Hard delete, con dry-run obligatorio antes de `--apply`.

**Por qué:** los duplicados de fanout son byte-idénticos salvo el id de SP — no son registros de negocio a preservar (la regla de **soft-delete** aplica a tickets/usuarios/aislamientos, no a copias redundantes de notificaciones ni a tokens efímeros). Usar `Fecha_N` **exacto** (no por minuto) evita borrar eventos legítimamente separados en el tiempo (cambios reales de dieta/status a lo largo del día); esos los colapsa el render-dedup en la UI sin tocarlos en SP.

## 21. Decisiones recientes (observaciones de traslado + notif habitación, 2026-06-18)

### 21.1. Auditoría: línea de tiempo cronológica vs. anclar cada obs al evento de su status

**Qué:** En el `AuditModal`, las observaciones se renderizan como nodos propios mergeados con los eventos y ordenados por `fecha`, en vez de colgarlas del hito que "abre" su status (mapa `EVENT_TIPO_TO_STATUS`, que se eliminó).

**Por qué:** El mapa anclaba cada obs al evento que abría su status. Pero hay flujos donde ese evento **no existe**: un **traslado directo** (cama destino `AVAILABLE`) nace en `Habitacion Lista` (IN_TRANSIT) sin registrar `Habitacion Preparada` ([useHospitalState.ts](hooks/useHospitalState.ts) — `createTicket` setea el status directo), y los tickets `Cancelado` no tienen entrada en el mapa. Resultado: la obs quedaba **huérfana, nunca se mostraba** (bug reportado). El merge cronológico elimina el hueco de raíz —no depende de qué eventos existan— y es más fiel al "cuándo pasó cada cosa".

**Alternativa descartada:** fallback "anclar al hito anterior existente". Más código y sigue siendo un mapa frágil; el merge por fecha es más simple y correcto. **Validación:** se replicó `formatDietForPDF`/el merge sobre los casos reportados para confirmar el orden y la inclusión antes de cerrar.

### 21.2. Un solo modal "hilo + redactor" para observaciones (no split cargar/ver por rol)

**Qué:** Botón único "Observaciones" para **todos** los roles que abre un modal con el historial (hilo) arriba y el redactor abajo. Se carga y se ve en el mismo lugar; la nota nueva se agrega optimista sin cerrar el modal.

**Por qué:** una observación es un comentario sobre la línea de tiempo del ticket; el modelo mental correcto es un **hilo de comentarios** (chat/Jira), no un formulario. El diseño previo tenía dos botones/modales (cargar vs. ver, partidos por rol) → fricción, y quien escribía no veía el contexto de lo ya anotado. La auditoría mantiene el **mismo hilo** pero con redactor solo para notas post-cierre.

**Alternativa descartada:** notas inline expandibles en la fila de la grilla. La grilla ya es densa (se venía peleando el ancho de la columna de acciones); no hay lugar.

### 21.3. Azafata: corte de carga de observaciones en "Por Consolidar"

**Qué:** una vez que el ticket pasa a `WAITING_CONSOLIDATION`, la Azafata ya no puede cargar observaciones (el redactor se oculta; sigue leyendo el hilo). Admisión/Admin sí pueden. Gateado en UI (por `activeRole`) y en `handleAddObservation` (por `currentUser.role`).

**Por qué:** en "Por Consolidar" la azafata ya recibió al paciente — su parte operativa terminó y el ticket queda en manos de Admisión. Cargar notas ahí no le corresponde. (En la práctica la azafata real ni ve esos tickets por el filtro de pisos a estados operativos; el gate cubre el caso "admin actuando como azafata".)

### 21.4. Habitación en TODAS las notificaciones de dieta/ayuno (no solo Catering)

**Qué:** el `body` genérico de los push `DIET_CHANGE`/`FASTING_CHANGE` ahora incluye la habitación, no solo el `cateringBody`.

**Por qué:** el diseño previo agregaba la ubicación solo para Catering (asumiendo que el resto abría la app para ubicar al paciente). Pedido explícito: que cualquier rol vea la habitación en el aviso. Es un solo texto reutilizado para `body` y `cateringBody`.

### 21.5. Redactor de obs en mobile: botón → modal (no input fijo a la vista)

**Qué:** en el `AuditModal` mobile, el redactor no está fijo a la vista; hay un botón compacto que abre un modal de carga. En desktop sigue inline al pie.

**Por qué:** el input fijo + su footer comían ~80px de alto en pantallas chicas, dejando ver muy poca trazabilidad y obligando a scrollear para llegar a él. El botón libera ese espacio; el modal enfocado es mejor para escribir en mobile. El composer (desktop) y la trazabilidad quedan en zonas separadas: trazabilidad scrollea, composer fijo (ver convención).

## 22. Aislamientos: migración a PROGAL como fuente única (2026-06-22)

### 22.1. Aislamientos desde el enrich (PROGAL), no carga manual

**Qué:** los aislamientos dejan de cargarse/editarse desde la app y pasan a tomarse del array `AISLAMIENTOS` del evento Gamma (`obtenereventointernacion`), procesados en el enrich y persistidos en `12.EnrichCamas`. Se elimina la edición manual (toggle en mapa, modales, permiso `editar_aislamiento`) y deja de usarse `/api/isolations` + `08.Aislamientos`.

**Por qué:** Gamma empezó a exponer los aislamientos prescriptos en enfermería; mantenerlos a mano en la app duplicaba un dato que ahora es autoritativo en PROGAL y quedaba desincronizado. Una sola fuente de verdad elimina el doble registro.

**Alternativas descartadas:**
- **Híbrido (Gamma + override manual):** había que resolver precedencia/conflictos entre lo cargado a mano y lo de PROGAL. Más complejo y con riesgo de mostrar info contradictoria.
- **Dejar la carga manual en paralelo:** perpetúa la desincronización que justamente se quiere eliminar.

**Impacto:** `08.Aislamientos`, `/api/isolations` y el enum `IsolationType` quedan sin uso. La migración fue validada con un probe contra PROGAL (estructura, nombres y 0 desconocidos) antes de cablear — ver [scripts/probe-isolations.mts](scripts/probe-isolations.mts).

### 22.2. `isolations` como campo de enrich que "sigue al paciente" (no `Map<patientCode>` aparte)

**Qué:** el aislamiento se modela como `bed.isolations: IsolationEntry[]` y se suma a `ENRICH_FIELDS`. Se descartó el `isolatedPatients: Map<patientCode, ...>` con su polling independiente.

**Por qué:** al vivir en el enrich, el aislamiento se beneficia del mismo mecanismo que dieta/ayuno (`mergeBeds`/`reapplyEnrichFromMap`): acompaña al paciente en los traslados sin lógica extra de "seguir al ticket", y se refresca con `/api/beds` (sin un segundo poll). `isolatedBeds` se deriva directo de las camas. Menos estado, menos requests, comportamiento consistente con el resto del enrich.

### 22.3. Normalización Gamma→canónico + color en el backend; el front solo mapea color→clases

**Qué:** `summarizeIsolations` ([api/isolations-summary.ts](api/isolations-summary.ts)) traduce el `HCG_DESCRIPCION` de Gamma a `{ name, color }` canónico (color = clave semántica: `green`/`teal`/`fuchsia`/…). El front mapea esa clave a clases Tailwind en un único `ISOLATION_COLORS` keyed por color.

**Por qué:** los nombres de Gamma no coinciden con los de la app ("De contacto"→"Contacto", "COVID 19"→"Covid", "De contacto C. Difficile"→"C. Difficile") y apareció un tipo nuevo ("Contacto preventivo"). Centralizar el mapeo nombre+color en un solo lugar (backend) evita duplicarlo; el front queda solo con presentación. Un tipo no mapeado cae a `violet` (default) en vez de desaparecer.

## 23. Enrich de TESTING vía Vercel Cron "forwarder" al Preview (2026-06-23)

**Qué:** el enrich de la partición TESTING se dispara con un Vercel Cron mínimo ([api/cron-trigger-testing.ts](api/cron-trigger-testing.ts), `5,20,35,50`) que **no enriquece él mismo**: hace un POST al `/api/cron-enrich-beds` del deployment **Preview de develop** (env `TESTING_BASE_URL`, header `X-Cron-Secret`). Reemplaza al GitHub Action `enrich-testing.yml`, que se borra.

**Por qué:** el scheduler de GitHub Actions es best-effort y se atrasa (la misma razón por la que prod se movió a Vercel). El de Vercel es confiable. Pero los Vercel Cron corren **solo en Production = código de `main`**, y el enrich de TESTING tiene que correr **código de develop** (para validar cambios de backend antes de mergear). El forwarder concilia ambas cosas: el scheduler confiable de Vercel dispara, pero el enrich sigue ocurriendo en el Preview (develop + `ENTORNO=TESTING` + PROGAL test).

**Alternativa descartada — un segundo Vercel Cron que enriquezca TESTING en prod:** correría con código de main (no refleja cambios de develop sin mergear); además los caches de token/evento de [api/gamma-client.ts](api/gamma-client.ts) están keyed solo por `scope`/`origin-number` (no por URL base) → en una instancia tibia compartida un token de PROGAL prod podría reusarse contra PROGAL test; y `sendPushToSubscribers` filtra suscriptores por el `ENTORNO` del deployment (PRODUCTIVO) → habría que forzar push silencioso. El forwarder evita todo eso sin tocar la lógica del enrich.

**Requiere:** env var `TESTING_BASE_URL` en Production (alias del Preview de develop) y `CRON_SECRET` presente en Production (Bearer que manda Vercel) y en Preview (lo valida el `/api/cron-enrich-beds`). El Preview no debe tener Deployment Protection. El cron se activa recién cuando el `vercel.json` está en `main`.

## 24. Decisiones recientes (mapa de camas + traslados, 2026-06-25)

> Tres cambios acotados pedidos por el cliente, validados con una revisión adversarial multi-agente (los tres cumplen la intención; 6 hallazgos refutados, 3 confirmados de severidad baja/nit en la cosmética del ítem de aislamiento).

### 24.1. Contacto preventivo: la cama contigua se SEÑALIZA (cyan), no se bloquea

**Qué:** Para los demás aislamientos, las camas no aisladas de la misma habitación quedan **bloqueadas** (violeta, `opacity-60`, ícono "X" — look "inhabilitada"). Para el tipo **Contacto preventivo** (Gamma "De contacto preventivo", color `teal`), las contiguas dejan de bloquearse y pasan a marcarse con un **color propio (`cyan`)** que no se usa para ningún estado de cama (Disponible/Ocupada/En preparación/Asignada/Inhabilitada) ni para el bloqueo duro (violeta). La cama queda **habilitada** (no inhabilitada); el modal muestra un aviso cyan "usar con precaución".

**Por qué:** pedido del cliente — Contacto preventivo es una precaución de baja restricción; la cama de al lado sigue siendo usable y no debería verse como fuera de servicio. Un color distinto comunica "precaución cerca" sin sacar la cama de la operatoria.

**Cómo ([views/BedsView.tsx](views/BedsView.tsx)):** el `useMemo` que devolvía un solo `blockedByIsolation` ahora devuelve `{ blockedByIsolation, preventiveContactAdjacent }`. Por habitación (excluyendo `CRITICAL_AREAS_NO_BLOCK`): `roomHasHard = isolatedInRoom.some(b => !isPreventiveOnlyBed(b))`. Si hay aislamiento duro → contiguas a `blocked` (**el bloqueo duro tiene prioridad**, aun si convive con un preventivo); si solo hay preventivo → a `preventive`. Detección por nombre canónico normalizado (`norm(name).includes('preventivo')`), robusto a tildes/casing.

**Trade-off conocido (bajo, no regresión):** el cyan reemplaza el color de estado de la celda; una cama contigua **ocupada por otro paciente no aislado** (habitación compartida) muestra cyan en vez de su rojo "Ocupada". Mismo trade-off que ya tenía el bloqueo violeta; mitigado por el nombre del paciente visible en desktop y por el modal de detalle (la ocupación se lee al click). Otro detalle menor: en una habitación con aislamiento **mixto** (una cama solo-preventiva + otra dura), el subtítulo del modal de la cama solo-preventiva ("contiguas señalizadas, no bloqueadas") describe el efecto de ESE aislamiento, no el del cuarto (que sí queda bloqueado por el duro).

### 24.2. `WAITING_CONSOLIDATION`: la cama ORIGEN toma PROGAL como fuente de verdad

**Qué:** En `mergeBeds`, cuando un ticket está en `WAITING_CONSOLIDATION` (azafata completó, PROGAL aún sin consolidar), la cama **origen** ya no se fuerza incondicionalmente a "En preparación". Solo se limpia/prepara si PROGAL **sigue mostrando al mismo paciente del ticket** ahí (`progalStillHasTicketPatientOnOrigin`: status OCCUPIED + mismo `patientCode`, con fallback por nombre). Si PROGAL ya **inhabilitó / liberó / reasignó** la cama origen, se respeta su estado real de `gammaBeds`. La cama **destino** mantiene el **ticket** como fuente de verdad. `IN_TRANSPORT` **no se modifica** (queda con su comportamiento original).

**Por qué:** caso real — movieron un paciente A→B, la azafata completó pero no consolidaron en PROGAL; desde PROGAL inhabilitaron A. Como el ticket forzaba A a "En preparación", el mapa la mostraba reutilizable y se la podía elegir como destino de otro traslado. Al respetar PROGAL, A queda "Inhabilitada" y `availableDestinations` (solo lista Disponible/En preparación) deja de ofrecerla.

**Bonus (bug latente):** antes, si PROGAL reasignaba el origen a otro paciente antes de consolidar, `copyPatientToBed(origin, dest)` copiaba el enrich (dieta/diagnóstico) del paciente **equivocado** al destino. Ahora la copia se omite cuando el origen ya cambió; el destino toma su enrich de `reapplyEnrichFromMap` por `patientCode`.

**Refina** [docs/arquitectura.md](docs/arquitectura.md) §38.2, que describía el comportamiento previo de `mergeBeds` en `WAITING_CONSOLIDATION`.

### 24.3. "Ingreso a ITR": origen filtrado a `eventOrigin === 'HIN'` (no 'HIT')

**Qué:** En `NewRequestModal`, el flujo `INGRESO_A_ITR` listaba como origen todas las camas ocupadas de HIT (las 8 de Internación Transitoria). Ahora además exige que el `origen_evento` del paciente sea **`HIN`** (internación definitiva): `isHitArea(b.area) && normEventOrigin(b.eventOrigin) === 'HIN'`. Quedan excluidos los pacientes con evento `HIT` (transitoria).

**Por qué:** pedido del cliente — por este flujo solo deben poder moverse a piso los pacientes con internación definitiva (HIN) que ocupan transitoriamente una cama de ITR; los HIT (transitoria propiamente dicha) no.

**Datos:** `bed.eventOrigin` viene de `origen_evento` de `obtenermapacamasocupadas` ([api/beds.ts](api/beds.ts) `transformBeds`), presente en toda cama ocupada de la fuente live. El filtro se aplica **solo** dentro de la rama `isIngresoItrFlow`; `INTERNAL` e `ITR_TO_FLOOR` no cambian. `EditRequestModal` no lo necesita (su origen es read-only).
