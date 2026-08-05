# Troubleshooting — MediFlow

Guía de soporte/QA: **síntoma → causa probable → qué mirar o escalar**. Para el "por qué"
de cada diseño, ver [decisiones.md](../arquitectura/decisiones.md); para el "qué hay", [arquitectura.md](../arquitectura/arquitectura.md).

> **Contexto de arquitectura (post-migración a Supabase).** El dominio transaccional
> (traslados, limpiezas, comandas, roles, notificaciones, push_subscriptions) vive hoy en
> **Supabase** (`public.*`), no en SharePoint. Las lecturas del cliente entran por **Realtime**
> (canales `*-live`) bajo RLS filtrada por un "pase" JWT ES256 (`/api/supabase-token`); las
> escrituras van por los endpoints `api/*` con `service_role`. **Sigue en SharePoint/Gamma:** el
> mapa de camas (`/api/beds`, único que aún pollea, 60s), los usuarios/login (`00.Usuarios`), el
> enrich del mapa (`12.EnrichCamas`) y la validación de ubicación. Muchos síntomas nuevos nacen de
> esa capa: entorno mal seteado, pase vencido, canal Realtime caído, build viejo cacheado.

## Notificaciones push nativas + campanita in-app

| Síntoma | Causa probable | Qué mirar / escalar |
|---------|----------------|---------------------|
| **La campanita in-app aparece pero NUNCA llega la notificación nativa** del sistema (celular/desktop) | El permiso de notificaciones del **navegador/SO** (device-side) está denegado o no concedido. Es DISTINTO del permiso "del sitio": en iOS/Android hay que además habilitar notificaciones para la PWA a nivel sistema operativo | Revisar en el dispositivo: (1) permiso de notificaciones del sitio en el navegador; (2) permiso de notificaciones de la **app/PWA** en Ajustes del SO (iOS exige instalar la PWA a home screen para recibir Web Push); (3) que exista la sub en `public.push_subscriptions` para ese `user_id`+`entorno`. La campanita (tabla `public.notificaciones`, `GET /api/notifications`) NO depende del permiso del SO → por eso se ve igual |
| **No llega ninguna push nativa con la app cerrada / en segundo plano** | Web Push es el único canal en background: si la sub falló, está stale o el VAPID no coincide, no hay fallback de página | **Primero: mirar si aparece el banner naranja "No tenés las notificaciones activadas"** — con el permiso del navegador en `denied` la app nunca se suscribe (causa #1 medida en Admisión el 05/08/2026). Después, ver que la sub exista y esté fresca (`last_seen_at` ≤ 90 días, `STALE_SUB_MS` en [push-utils.ts](../api/push-utils.ts)); que el `entorno` de la sub coincida con el `ENTORNO` del server; y que el trío VAPID coincida (ver fila de VAPID). Con la pestaña abierta igual se ve el toast/campanita in-app |
| **Push nativa duplicada de un traslado** ("TIN TIN TIN") | Regresión del envío duplicado. Hoy los traslados los manda **una sola vez por versión de fila** la Edge Function `notify-push` (webhook `pg_net` sobre `public.traslados`), con idempotencia por `public.push_dispatch_log` (key `id_univoco:status:updated_at`) | Confirmar en `push_dispatch_log` que haya UNA fila por `(id_univoco, status, updated_at)`. Si se duplica: revisar que el webhook no dispare dos veces y que `notify-push` inserte el idempotency_key ([notify-push/index.ts:123](../supabase/functions/notify-push/index.ts)). Nota: dietas/ayunos/limpieza van por el OTRO camino (`push-utils.ts`, guard in-memory 60s por lambda, no cross-instance) |
| **"Lluvia" de notificaciones nativas casi idénticas** abajo a la derecha (Chrome desktop), animación rota | Bug histórico distinto al anterior: el canal `window.Notification` de página se sumaba al Web Push del SW para el mismo evento (ver [decisiones 27.1](../arquitectura/decisiones.md)). **Eliminado el 2026-07-06** | Confirmar que en [useHospitalState.ts](../hooks/useHospitalState.ts) NO exista un `new window.Notification()` dentro del change-detection. La única fuente de notifs nativas debe ser el SW (`showNotification` en [src-sw/sw.ts](../src-sw/sw.ts)) |
| **El que ejecuta la acción no recibe su propia push** | Esperado: `excludeUser` = actor (`created_by_id` en INSERT, `last_actor_id` en UPDATE) en [notify-push/index.ts:109](../supabase/functions/notify-push/index.ts) | No es bug. El actor igual ve su acción en la campanita in-app (add optimista local). El resto del piso sí recibe la push |
| **Un rol no recibe un tipo de push** aunque tenga notificaciones activas | El filtrado es por **permiso granular** (`NOTIF_TYPE_TO_PERMISSION`), no por rol: `notif_new_ticket`, `notif_status_update`, `notif_reception_confirmed`, `notif_diet_change`, `notif_fasting_change`, `notif_habitacion_limpia`. Además filtra por `filter_by_floors` (áreas), sede y freshness | Ver que el rol (`public.roles.permissions`) tenga el permiso del tipo; que las `assigned_areas` de la sub cubran el área origen/destino; y que `last_seen_at` esté fresco. El mapa está duplicado a propósito en cliente ([permissions.ts](../lib/permissions.ts)), `push-utils.ts` y `notify-push` |
| **Se rotó el VAPID y nadie recibe push** (403 silencioso) | El trío VAPID debe coincidir: `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (Vercel Production) = secrets de la Edge Function en Supabase = `VITE_VAPID_PUBLIC_KEY` (build cliente). Si no coinciden → 403 y no entrega | Verificar las 3 puntas. El cliente se **auto-cura**: `subscribeToPush` compara la `applicationServerKey` de la sub con el VAPID actual y re-suscribe si difiere ([pushSubscription.ts:57](../lib/pushSubscription.ts)). El 403 **no** borra la sub (solo 404/410, [push-utils.ts:250](../api/push-utils.ts)) para no vaciar la tabla por un misconfig global |
| **Un dispositivo dejó de recibir push tras días sin abrirse** | La sub quedó **stale** (`last_seen_at` > 90 días). El heartbeat (`touchPushSubscription`, cada ~6h con la app abierta) la mantiene viva | Al reabrir la PWA se refresca el `last_seen_at` y vuelve a entrar en el envío. Si pasó con pocos días, NO es staleness: revisar el permiso del navegador (banner naranja) — el síntoma clásico es el usuario que crea traslados todos los días y no tiene ninguna fila en `push_subscriptions` |

## Realtime — el mapa / la lista no se actualizan solos

| Síntoma | Causa probable | Qué mirar / escalar |
|---------|----------------|---------------------|
| Otro usuario movió un traslado / cargó una comanda / marcó limpia y **mi pantalla no se refresca** | Se cayó el canal Realtime, o el pase JWT venció y la reconexión quedó anónima (sin RLS no ve nada) | En consola, ver que los canales `traslados-live` ([useHospitalState.ts:1307](../hooks/useHospitalState.ts)), `limpiezas-live` (:1319) y `comandas-live` (:1335) lleguen a estado `SUBSCRIBED`. Al (re)suscribir se hace **catch-up** con un fetch completo (Realtime NO reenvía lo perdido). Si sigue mudo, forzar F5 |
| **Nada llega por Realtime pese a estar logueado** | El "pase" ES256 (`/api/supabase-token`) no se mintea o venció (TTL 1h) y el cliente quedó como `anon` → RLS lo deja sin filas | Ver que `GET /api/supabase-token` devuelva 200 y que el fetch use `cache: 'no-store'` ([supabase.ts:47](../lib/supabase.ts)) — sin eso el browser sirve un pase viejo vencido en loop. Confirmar que `mediflow_token` esté en localStorage (sin él, el pase es `''` = anon, fallback seguro) |
| **Una tabla NO empuja cambios** aunque las otras sí | La tabla no está en la publicación `supabase_realtime` (una migración la agrega) | Las 4 publicadas hoy: `traslados` ([migración …163447:74](../supabase/migrations/20260729163447_traslados_dominio_inicial.sql)), `comandas`, `limpiezas`, `notificaciones`. Si se agrega una tabla nueva y no se refleja en vivo, falta el `alter publication supabase_realtime add table …` (y `replica identity` para ver el `old_record` en UPDATE/DELETE) `(verificar en la migración correspondiente)` |
| **El mapa de camas no se actualiza en vivo** al mover un paciente en PROGAL | Esperado: **beds NO usa Realtime**, sigue con poll cada 60s (`POLL_BEDS_MS`) contra `/api/beds` (Gamma/SharePoint) | Esperar hasta ~60s. Beds es el único dominio que no se migró a Realtime |
| Tras cortar y reconectar la red, la grilla queda **desincronizada** | Realtime no reenvía eventos perdidos durante el corte; la reconciliación es el fetch de catch-up al volver a `SUBSCRIBED` | Verificar que al reconectar se dispare el refetch (`fetchTickets`/`fetchCleanings`/`triggerMealRefetch` en el callback de `.subscribe`). Si no reconcilia, F5 fuerza el fetch completo |

## Entorno TESTING / PRODUCTIVO (aislamiento por columna)

| Síntoma | Causa probable | Qué mirar / escalar |
|---------|----------------|---------------------|
| **El mapa / la lista aparecen VACÍOS** en Producción (o muestran datos que no son) | `ENTORNO` mal seteado en el server: el pase firma el claim `entorno` equivocado y la RLS filtra por él. Default `'TESTING'` si la env falta ([supabase-token.ts:27](../api/supabase-token.ts)) | Golpear `/api/supabase-token` en el entorno afectado y decodificar el JWT: el claim `entorno` debe ser `PRODUCTIVO` en Production. Todos los endpoints usan `process.env.ENTORNO ?? 'TESTING'` (tickets/limpiezas/dietas/carga-menu/notifications/push-utils) → si la env no está cargada en Vercel, todo cae a TESTING |
| **FUGA cross-entorno**: la app de Producción muestra/escribe filas de TESTING (o viceversa) | Mismo caso anterior con impacto PHI: mismo proyecto Supabase compartido, la única barrera es la columna `entorno` + RLS. Si el claim miente, se cruzan | Alta severidad. Verificar el claim `entorno` del pase Y el `ENTORNO` de las escrituras. Confirmar que Preview/develop = TESTING y Production = PRODUCTIVO |
| **No llega push aunque todo lo demás funciona** | `push-utils`/`notify-push` filtran subs por `entorno` ([push-utils.ts:77](../api/push-utils.ts)); si la sub se creó en un entorno y el envío corre en otro, no matchea | Confirmar que `push_subscriptions.entorno` de la sub coincida con el `ENTORNO` del sender. Suscribir en PRODUCTIVO no recibe eventos TESTING |
| Un traslado **existe pero es invisible** tras un cutover/backfill | Fila con `entorno` distinto al del cliente, o creada entre el backfill y el deploy del código nuevo | Ver el `entorno` de la fila en Supabase. Nunca re-correr un backfill sobre datos vivos (ver [cutover-supabase-main.md](../historial/cutover-supabase-main.md)) |

## Comandas (carga de Nutrición · `public.comandas`)

| Síntoma | Causa probable | Qué mirar / escalar |
|---------|----------------|---------------------|
| Al guardar la comanda del titular salta **`409 sin_dieta`** | Backstop híbrido: el titular exige tener un **tipo de dieta cargado en PROGAL** (se lee `12.EnrichCamas` en SharePoint, [dietas.ts:251](../api/dietas.ts)). El dato confirmado "sin tipo de dieta" bloquea | Cargar/verificar la dieta del paciente en PROGAL. Es **fail-open**: si el cross-read a SharePoint falla o el enrich aún no procesó la cama, la comanda se guarda igual (solo el "sin dieta" confirmado bloquea). Los **acompañantes** NO están sujetos a esta regla (banda ámbar "los acompañantes sí se pueden cargar") |
| No puedo **editar ni anular** una comanda → **`409 comanda_entregada`** | La bandeja ya está **Entregada** (estado congelado). No se edita (POST 409) ni se anula directo (PATCH 409) | Hay que "volver a pendiente" primero desde **Gestión de Comandas → De hoy** (paso explícito auditable), y recién ahí editar/anular ([dietas.ts:315](../api/dietas.ts), :458). En BedsView se ve banda verde + campos deshabilitados |
| Dos usuarios cargan el **mismo turno del titular** y no se pisan / no se duplica | Índice único parcial sobre el titular vivo → `23505` → re-lookup y reuso de la fila | Esperado. El **acompañante** en cambio siempre hace INSERT (dos altas simultáneas dejan dos filas borrables, no se pisan) |
| Una comanda **pendiente de ayer** sigue apareciendo en "De hoy" | Diseño: las pendientes de días previos no desaparecen (si no, nadie podría cerrarlas); al re-guardarlas se reactivan y su `dia` pasa a hoy. Las **entregadas** de días previos sí se ocultan | Esperado. No confundir con arrastre automático (no hay: se carga de cero cada día) |
| El modal de **planificación** dice "no hay comanda planificada" y Nutrición carga a mano | Puede ser real, o la DB de `carga_menu` cayó. El GET de `carga-menu` falla **DURO (502)**, nunca `[]` mentiroso | Si aparece un error en el modal, es la DB caída → no cargar a mano asumiendo que no existe. Verificar `GET /api/carga-menu`. Una planificación **vencida** (`fecha_fin` < hoy-ART) es read-only y da `409 planificacion_vencida` al editar |
| Un rol de piso (`filter_by_floors`) **ve/edita comandas de otros pisos** | No debería: `areaOk` sobre `assigned_areas` filtra mapa, panel, histórico y PDF | Revisar `assigned_areas` del usuario. **Ojo**: el PATCH de estado (entregar/pendiente/anular/reubicar) NO enforcea permiso server-side — la restricción es de UI (tener el módulo Gestión Comandas). Edge de seguridad a validar |

## Versión de build / clientes con build viejo

| Síntoma | Causa probable | Qué mirar / escalar |
|---------|----------------|---------------------|
| Un usuario reporta un comportamiento **que ya se arregló** hace deploys | Corre un **build viejo cacheado** (no recargó / SW sirvió el bundle anterior) | Mirar el **badge de versión** en login/sidebar del usuario, y la columna `version` de sus últimas escrituras en Supabase. `APP_VERSION` (hoy `v20260731_1.0.1`, [version.ts:11](../lib/version.ts)) se estampa en cada escritura transaccional (traslados/limpiezas/comandas). Una fila con `version` vieja o `''`/NULL (pre-feature) = ese cliente no recargó → pedir hard-refresh / reinstalar PWA |
| Quiero **saber quién corre qué versión** | La columna `version` está en todas las tablas transaccionales y en `push_subscriptions` | Query por `version` en `public.traslados`/`limpiezas`/`comandas` filtrando por `entorno`. El badge del sidebar muestra la versión corriendo en ese cliente |

## Limpieza de camas (`public.limpiezas` / overlay "Opción B")

| Síntoma | Causa probable | Qué mirar / escalar |
|---------|----------------|---------------------|
| Marqué una cama "Limpia" y **no aparece como disponible** en el mapa | La cama es origen o destino de un **traslado activo** → el overlay se suprime a propósito (`ticketTouched` en `mergeBeds`), o el `POST /api/limpiezas` falló y se hizo rollback optimista | Ver si hay un ticket activo sobre esa cama (Operativa). Si no, revisar consola/red: `POST /api/limpiezas` con error → la cama no queda marcada. La azafata solo puede marcar camas que PROGAL reporta "En preparación" |
| Una cama figura **"Limpia ✓" pero está sucia/ocupada** | Overlay stale: el auto-cierre no cerró la limpieza (PATCH falló) y la cama volvió a "En preparación" | Confirmar en `public.limpiezas` que la fila tenga `status = 'Inactivo'` (motivo `GAMMA`/`TICKET`). El cierre reintenta soltando el candado ante fallo; si persiste, cerrar la fila a mano (PATCH `ANULADA`) o revisar conectividad a Supabase |
| La limpieza **no se cierra sola** tras un traslado | El cierre se dispara cuando un ticket toma la cama (`TICKET`) o PROGAL avanza el estado (`GAMMA`); depende de los eventos Realtime de limpiezas y del **poll de beds (60s)** | Esperar hasta ~60s. Si no cierra: verificar que el ticket tenga esa cama como origen/destino, y que `GET /api/limpiezas` y el mapa respondan OK |
| Click en "Marcar limpia" **sin efecto visible** en una cama recién desocupada | La cama es el **origen de un traslado sin consolidar** (`WAITING_CONSOLIDATION`): se crea la limpieza pero se auto-cierra al instante (defensivo, evita mostrarla reutilizable antes de consolidar) | Comportamiento esperado. La cama se puede marcar limpia una vez que Admin consolida el traslado saliente |
| No aparece el botón "Marcar limpia" (veo un panel índigo "Reservada por un traslado") | La cama es **destino de un traslado en curso**: la limpieza previa al ingreso se confirma con "Habitación Lista" desde Operativa, no con "Marcar limpia" | Esperado. La marca de limpieza no aplica ahí (el auto-cierre la anularía con motivo `TICKET`) |
| No aparece el botón "Marcar limpia" (sin panel índigo) | Falta permiso `confirmar_limpieza` en el rol, o la azafata filtra por pisos y la cama no está en sus `assignedAreas`, o la cama no está "En preparación" | Revisar el rol en `public.roles` (permiso) y las áreas asignadas del usuario (`00.Usuarios` en SharePoint) |
| No veo el módulo **Gestión de Limpieza** ni el botón "Consolidado PROGAL" | El módulo requiere `Gestion Limpieza` en `modules`; el botón requiere el permiso `consolidar_limpieza` | Revisar `public.roles` del usuario. Sin `consolidar_limpieza` la vista es solo-lectura |

## Monitor (DashboardView)

| Síntoma | Causa probable | Qué mirar / escalar |
|---------|----------------|---------------------|
| El **desglose de motivos** de Traslado Interno aparece vacío | No hay traslados internos en el período seleccionado, o los tickets no tienen `changeReason` cargado (se agrupan como "Sin motivo") | Cambiar el rango de fechas. Los motivos se cuentan de `changeReason` de los tickets `INTERNAL`. El Monitor lee el histórico completo (`GET /api/tickets?all=1`) |
| No veo la barra "Cambio Habitación" | Es esperado: `ROOM_CHANGE` (deprecado) se pliega dentro de "Traslado Interno" | — |

## Historial → Trayectoria

| Síntoma | Causa probable | Qué mirar / escalar |
|---------|----------------|---------------------|
| No encuentro un paciente en el combobox "Seleccionar paciente" | Solo aparecen pacientes con al menos un ticket **del entorno actual**, cargados en memoria por el fetch del histórico (`?all=1`) | Verificar que el paciente tenga traslados y que sean del mismo `entorno`. El buscador filtra por nombre/código |
| Elegí un paciente y la línea de tiempo no carga los movimientos | `PatientJourney` fetchea `/api/ticket-events` por cada ticket al abrir; si falla, quedan "Sin movimientos" | Revisar red: `GET /api/ticket-events?ticketId=…`. Los datos base del ticket igual se muestran |

## PDF de camas (BedsView)

| Síntoma | Causa probable | Qué mirar / escalar |
|---------|----------------|---------------------|
| Los **totales del zócalo no cuadran** con lo esperado | Ocupadas = `OCCUPIED + ASSIGNED`; las "En preparación" quedan fuera de ambos porcentajes (ver [decisiones 26.3](../arquitectura/decisiones.md)) | `% s/Habilitadas = Ocup/(Ocup+Libres)`; `% s/Total = Ocup/(Ocup+Libres+Inhab)`. El zócalo cuenta las camas **filtradas** que se exportan |
| Una cama "limpia" (overlay) cuenta como **Libre** en el PDF | El PDF refleja lo que muestra el mapa: una cama con overlay `cleaned` se ve Disponible | Esperado — el overlay es la fuente de verdad de la vista |
