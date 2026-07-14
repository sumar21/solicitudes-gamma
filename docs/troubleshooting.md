# Troubleshooting — MediFlow

Guía de soporte/QA: **síntoma → causa probable → qué mirar o escalar**. Para el "por qué"
de cada diseño, ver [decisiones.md](decisiones.md); para el "qué hay", [arquitectura.md](arquitectura.md).

## Limpieza de camas (14.Limpiezas / overlay "Opción B")

| Síntoma | Causa probable | Qué mirar / escalar |
|---------|----------------|---------------------|
| Marqué una cama "Limpia" y **no aparece como disponible** en el mapa | La cama es origen o destino de un **traslado activo** → el overlay se suprime a propósito (`ticketTouched` en `mergeBeds`), o el POST a `14.Limpiezas` falló y se hizo rollback optimista | Ver si hay un ticket activo sobre esa cama (Operativa). Si no, revisar consola/red: `POST /api/limpiezas` con error → la cama no queda marcada. La azafata solo puede marcar camas que PROGAL reporta "En preparación" |
| Una cama figura **"Limpia ✓" pero está sucia/ocupada** | Overlay stale: el auto-cierre no cerró la limpieza en SP (PATCH falló) y la cama volvió a "En preparación" | Confirmar en `14.Limpiezas` que la fila tenga `Status_L=Inactivo`. Desde el fix de 2026-07-02 el cierre reintenta ante fallo; si persiste, cerrar la fila a mano (PATCH `ANULADA`) o revisar conectividad a Graph |
| La limpieza **no se cierra sola** tras un traslado | El cierre se dispara cuando un ticket toma la cama (`TICKET`) o PROGAL avanza el estado (`GAMMA`); ambos dependen de los polls (tickets 8s, camas 60s) | Esperar hasta ~60s. Si no cierra: verificar que el ticket tenga esa cama como origen/destino, y que `GET /api/limpiezas` y `/api/tickets` respondan OK |
| Click en "Marcar limpia" **sin efecto visible** en una cama recién desocupada | La cama es el **origen de un traslado sin consolidar** (`WAITING_CONSOLIDATION`): se crea la limpieza pero se auto-cierra al instante (defensivo, evita mostrarla reutilizable antes de consolidar) | Comportamiento esperado. La cama se puede marcar limpia una vez que Admin consolida el traslado saliente |
| No aparece el botón "Marcar limpia" | Falta permiso `confirmar_limpieza` en el rol, o la azafata filtra por pisos y la cama no está en sus `assignedAreas`, o la cama no está "En preparación" | Revisar `99.ABMRoles_Traslados` (permiso) y las áreas asignadas del usuario |

## Monitor (DashboardView)

| Síntoma | Causa probable | Qué mirar / escalar |
|---------|----------------|---------------------|
| El **desglose de motivos** de Traslado Interno aparece vacío | No hay traslados internos en el período seleccionado, o los tickets no tienen `changeReason` cargado (se agrupan como "Sin motivo") | Cambiar el rango de fechas. Los motivos se cuentan de `changeReason` de los tickets `INTERNAL`/`ROOM_CHANGE` |
| No veo la barra "Cambio Habitación" | Es esperado: `ROOM_CHANGE` (deprecado) se pliega dentro de "Traslado Interno" | — |

## Historial → Trayectoria

| Síntoma | Causa probable | Qué mirar / escalar |
|---------|----------------|---------------------|
| No encuentro un paciente en el combobox "Seleccionar paciente" | Solo aparecen pacientes con al menos un ticket en el entorno actual, ya cargado en memoria por el poll global | Verificar que el paciente tenga traslados y que sean del mismo `Entorno_T`. El buscador filtra por nombre/código |
| Elegí un paciente y la línea de tiempo no carga los movimientos | `PatientJourney` fetchea `/api/ticket-events` por cada ticket al abrir; si falla, quedan "Sin movimientos" | Revisar red: `GET /api/ticket-events?ticketId=…`. Los datos base del ticket igual se muestran |

## PDF de camas (BedsView)

| Síntoma | Causa probable | Qué mirar / escalar |
|---------|----------------|---------------------|
| Los **totales del zócalo no cuadran** con lo esperado | Ocupadas = `OCCUPIED + ASSIGNED`; las "En preparación" quedan fuera de ambos porcentajes (ver [decisiones 26.3](decisiones.md)) | `% s/Habilitadas = Ocup/(Ocup+Libres)`; `% s/Total = Ocup/(Ocup+Libres+Inhab)`. El zócalo cuenta las camas **filtradas** que se exportan |
| Una cama "limpia" (overlay) cuenta como **Libre** en el PDF | El PDF refleja lo que muestra el mapa: una cama con overlay `cleaned` se ve Disponible | Esperado — el overlay es la fuente de verdad de la vista |

## Notificaciones

| Síntoma | Causa probable | Qué mirar / escalar |
|---------|----------------|---------------------|
| **"Lluvia" de notificaciones nativas duplicadas** abajo a la derecha (Chrome desktop), animación rota, casi idénticas | Reintroducción del canal `window.Notification` de página que se sumaba al Web Push del SW para el mismo evento (ver [decisiones 27.1](decisiones.md)). Fue **eliminado el 2026-07-06** | Confirmar que en [useHospitalState.ts](../hooks/useHospitalState.ts) NO exista un `new window.Notification()` dentro del change-detection. La única fuente de notifs nativas debe ser el SW (`showNotification` en [src-sw/sw.ts](../src-sw/sw.ts)) |
| **No llega ninguna notificación nativa** con la app cerrada / en segundo plano (desde el fix) | Web Push es ahora el único canal; si la suscripción push falló o el permiso está denegado, no hay fallback de página | Revisar permiso de notificaciones del navegador, que exista la suscripción en `09.PushSubscriptions`, y el push-log en IndexedDB (`mediflow-push-log`, snippet en [sw.ts](../src-sw/sw.ts)). Con la pestaña abierta igual se ve el toast in-app |
| Se ve el **toast in-app (arriba-centro) pero NO** la notif nativa, con pestaña en foco | Comportamiento esperado post-fix: en foreground alcanza con el toast; la notif nativa del SW puede no mostrar heads-up con la pestaña activa | Esperado. No es el bug de duplicados |
