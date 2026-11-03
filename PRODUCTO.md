# MediFlow · Grupo Gamma

Gestión de traslados de pacientes del **Hospital Privado de Rosario** (Grupo Gamma). Antes, un traslado
se coordinaba por teléfono entre Admisión, las azafatas de cada piso y quien limpia la cama; nadie veía
en qué paso estaba ni cuánto se esperaba. MediFlow orquesta el circuito completo —solicitud, cama
destino, limpieza, traslado, recepción y consolidación en PROGAL— con avisos push a quien tiene que
actuar, y suma el mapa de camas, las comandas de Nutrición y las cirugías.

> Este documento es el resumen de producto en una página. El detalle paso a paso por rol está en
> [docs/qa/casos-de-uso.md](docs/qa/casos-de-uso.md); permisos y notificaciones, en
> [docs/arquitectura/roles-permisos-notificaciones.md](docs/arquitectura/roles-permisos-notificaciones.md).

## Partes y pantallas

**Panel (web y PWA instalable)**

- **Monitor**: KPIs del día / 7 / 30 días (casos activos, espera media solicitud → cama, traslados
  finalizados), volumen por workflow y las colas de Admisión pendiente y En ejecución.
- **Operativa**: el tablero del día a día, en tres solapas.
  - *Traslados*: la grilla de traslados activos con un chip por estado (y Urgencias), búsqueda y las
    acciones de cada paso según el rol; "ver como" Admisión / Azafata para Admin y Admisión.
  - *Limpiezas*: limpiezas de cama pendientes y de rutina.
  - *Cirugías*: el circuito de la cirugía paso a paso (buscar, entregar, operar, devolver).
- **Historial**: traslados cerrados en modo lista (con rango de fechas) y la trayectoria de un paciente.
- **Mapa de Camas**: la grilla de camas por sector sobre PROGAL, con el detalle del paciente
  (aislamientos, dieta, acompañante) y exportación a PDF.
- **Comandas**: entrega de bandejas por turno, histórico y planificación del menú.
- **Configuración**: ABM de usuarios y de roles (módulos y permisos finos).

## Reglas del negocio que ya refleja

- **Circuito del traslado**: Esperando habitación → Habitación lista → En traslado → Por consolidar →
  Consolidado (o Cancelado, con motivo). Un pre-ticket (Presolicitud) espera que Admisión le configure
  el destino; una urgencia nace directo en Por consolidar y se vincula al paciente real al consolidar.
- **Quién dispara cada paso**: Admisión crea, edita, cancela y consolida; la azafata de destino marca la
  habitación lista y confirma la recepción; la de origen inicia el traslado (casos de uso, apéndice A).
- **Habitación a verificar**: si la cama destino tiene requisitos o la habitación es compartida, el
  traslado espera que la azafata confirme que está armada aunque la cama figure disponible.
- **Edición**: se bloquea en cuanto interviene una azafata; cancelar se puede hasta el cierre.
- **Pisos**: las azafatas (y cualquier rol con "filtrar por pisos") ven solo sus sectores; la Sala de
  Espera de Admisión se remapea al piso del otro extremo.
- **Por consolidar**: a los 15 minutos sin consolidar avisa a los roles con ese permiso.
- **PROGAL manda**: el mapa de camas lo lee de la API de Gamma; MediFlow pinta encima lo propio
  (limpiezas, traslados) sin escribir en PROGAL.

## Usuarios y roles

| Rol | Qué ve y qué hace |
|---|---|
| Admisión | Crea y gestiona traslados y pre-tickets, consolida en PROGAL, ve Monitor e Historial. |
| Azafata | Ejecuta los pasos físicos del traslado en sus pisos y marca camas limpias. |
| Coordinación | Carga pre-tickets y urgencias. |
| Enfermería / Catering | Consulta el mapa de camas (solo lectura). |
| Nutrición | Carga y entrega comandas, planifica el menú. |
| Admin | Todo, más la configuración de usuarios y roles. |

Los roles son configurables desde el ABM: los módulos y permisos de cada uno viven en la tabla `roles`.

## Demo

**No hay recorrido guiado ni datos de demo**: MediFlow está en producción y la regla del repo es
"nunca mocks como estado inicial" (incidente del 14/10/2026). Para mostrarla se usa el entorno de
prueba (`ENTORNO=TESTING`: sidebar gris pizarra y pastilla "Entorno de prueba"), con usuarios de prueba.

## Integraciones (todo real)

| Qué | Con qué |
|---|---|
| Camas, pacientes, aislamientos, dietas | API de Grupo Gamma (PROGAL), solo lectura |
| Traslados, eventos, comandas, limpiezas | Supabase (Realtime para la grilla y las comandas) |
| Usuarios y roles | Supabase (tabla `roles`); SharePoint en las listas que no migraron |
| Avisos | Web Push (PWA) + campanita |

## Cómo levantarla

```bash
npm install
npm run dev:full   # API (localhost:3000) + panel (localhost:5173)
```

Necesita el `.env` del proyecto (ver [docs/guias/](docs/guias/) y `.env.example`).

## Pendientes del rediseño

El rediseño al Estilo 1 (rama `rediseno/01-minimal-zinc`) dejó hechos los tokens, los componentes, el
shell y Operativa. Falta llevar el resto de las vistas (lista y orden en `VALIDACION.md`).
