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
