# Validación

- **Fecha:** 2026-11-03
- **Estilo:** 01-minimal-zinc v2.0.0
- **Resultado:** 3 errores · 7 avisos · 15 ok

| | Grupo | Chequeo | Dónde |
|---|---|---|---|
| 🔴 | Diseño | Colores crudos fuera de los tokens (white, black, gray, slate, neutral, stone) | App.tsx:89<br>App.tsx:91<br>App.tsx:92<br>App.tsx:95<br>App.tsx:100 |
| 🔴 | Diseño | Hex hardcodeado en clases o estilos | App.tsx:110<br>App.tsx:372<br>components/modals/PlanificacionMenuModal.tsx:302<br>components/modals/PlanificacionMenuModal.tsx:316<br>views/DashboardView.tsx:178 |
| 🔴 | Diseño | z-index fuera de los tokens de capa (z-[9999], z-50, z-100, zIndex: 999) | components/modals/PlanificacionMenuModal.tsx:268<br>views/CirugiasView.tsx:590<br>views/CirugiasView.tsx:599<br>views/CleaningManagementView.tsx:66<br>views/CleaningManagementView.tsx:314 |
| 🟡 | Diseño | <button> sin type (dentro de un form hace submit) | components/AuditModal.tsx:247<br>components/PatientJourney.tsx:306<br>components/PatientJourney.tsx:400<br>components/modals/PlanificacionMenuModal.tsx:212<br>components/modals/PlanificacionMenuModal.tsx:322 |
| 🟡 | Diseño | h-screen / min-h-screen (en mobile va dvh) | App.tsx:89<br>App.tsx:311 |
| 🟡 | Diseño | rounded pelado / none / 3xl / arbitrario | App.tsx:95<br>App.tsx:320<br>components/modals/AssignBedModal.tsx:34<br>components/modals/ConfigureDestinoModal.tsx:71<br>components/modals/ConsolidarUrgenciaModal.tsx:79 |
| 🟡 | Diseño | shadow-sm (en v4 es más fuerte; la base del kit es shadow-xs) | views/BedsView.tsx:1033 |
| 🟡 | Diseño | shadow-lg / shadow-xl fuera de modales, toasts y tooltips | App.tsx:95<br>App.tsx:320<br>App.tsx:371<br>components/AuditModal.tsx:445<br>views/CleaningManagementView.tsx:66 |
| 🟡 | Diseño | text-base como cuerpo fuera de components/ui (el cuerpo del kit es text-sm) | components/AuditModal.tsx:537<br>components/modals/PlanificacionMenuModal.tsx:417<br>views/BedsView.tsx:3174<br>views/BedsView.tsx:3388<br>views/HistoryView.tsx:576 |
| 🟡 | Diseño | font-light / thin (el kit no usa pesos livianos) | components/AuditModal.tsx:273<br>components/PatientJourney.tsx:421 |

## Por archivo

Orden de ataque: los que más 🔴 tienen, primero (las ubicaciones completas, con `--json`).

| Archivo | 🔴 | 🟡 | Reglas |
|---|---|---|---|
| `views/BedsView.tsx` | 245 | 27 | colores-crudos, boton-sin-type, rounded-pelado, sombra-base, cuerpo-text-base |
| `views/CirugiasView.tsx` | 95 | 5 | colores-crudos, z-magicos, boton-sin-type, rounded-pelado |
| `views/CleaningManagementView.tsx` | 90 | 4 | colores-crudos, z-magicos, boton-sin-type, rounded-pelado, sombras-pesadas |
| `views/ComandasManagementView.tsx` | 83 | 8 | colores-crudos, z-magicos, boton-sin-type, rounded-pelado |
| `components/AuditModal.tsx` | 59 | 4 | colores-crudos, boton-sin-type, sombras-pesadas, cuerpo-text-base, font-light |
| `components/PatientJourney.tsx` | 59 | 3 | colores-crudos, boton-sin-type, font-light |
| `views/RoleManagementView.tsx` | 55 | 9 | colores-crudos, z-magicos, boton-sin-type, rounded-pelado, sombras-pesadas |
| `App.tsx` | 55 | 7 | colores-crudos, hex, alto-screen, rounded-pelado, sombras-pesadas |
| `views/UserManagementView.tsx` | 49 | 8 | colores-crudos, z-magicos, boton-sin-type, rounded-pelado, sombras-pesadas |
| `views/HistoryView.tsx` | 48 | 2 | colores-crudos, z-magicos, boton-sin-type, cuerpo-text-base |
| `views/DashboardView.tsx` | 38 | — | colores-crudos, hex, z-magicos |
| `components/modals/PlanificacionMenuModal.tsx` | 31 | 7 | colores-crudos, hex, z-magicos, boton-sin-type, cuerpo-text-base |
| `components/modals/PreTicketModal.tsx` | 26 | 1 | colores-crudos, rounded-pelado |
| `components/modals/ConsolidarUrgenciaModal.tsx` | 15 | 1 | colores-crudos, rounded-pelado |
| `components/modals/EditRequestModal.tsx` | 14 | 1 | colores-crudos, rounded-pelado |
| `components/modals/ConfigureDestinoModal.tsx` | 13 | 1 | colores-crudos, rounded-pelado |
| `components/modals/NewRequestModal.tsx` | 10 | 1 | colores-crudos, rounded-pelado |
| `components/dashboard/VolumeBarChart.tsx` | 9 | — | colores-crudos |
| `components/dashboard/StatusDonutChart.tsx` | 6 | — | colores-crudos |
| `components/modals/RestablecerDestinoModal.tsx` | 5 | 1 | colores-crudos, rounded-pelado |
| `components/dashboard/StatCard.tsx` | 5 | — | colores-crudos |
| `components/modals/RejectionModal.tsx` | 4 | 1 | colores-crudos, rounded-pelado |
| `components/modals/AssignBedModal.tsx` | 3 | 1 | colores-crudos, rounded-pelado |
| `components/modals/AreaSelectionModal.tsx` | 1 | — | colores-crudos |

## Excepciones

- `recorrido` — todo el repo: app en producción: sin demo ni datos de ejemplo (regla del repo: nunca mocks como estado inicial). Ver PRODUCTO.md

## Alcance de este rediseño

Rama `rediseno/01-minimal-zinc`: capas 0–2 (tokens, componentes, shell y componentes globales) y
**Operativa** como vista piloto de la capa 3. Los 🔴 que quedan son de las vistas sin migrar: se
listan arriba por archivo, no se exceptúan (REDISENO §R.4).

**Antes / después por regla** (mismo validador sobre `develop` y sobre esta rama, sin typecheck ni build):

| Regla | `develop` | Rama |
|---|---|---|
| Tailwind 4 · clases de v3 eliminadas · renombradas | 🔴 · 🔴 7 · 🟡 40 | ✅ · ✅ · ✅ |
| DESIGN.md · AGENTS.md · PRODUCTO.md · CLAUDE importa AGENTS | 🔴 · 🔴 · 🔴 · 🟡 | ✅ · ✅ · ✅ · ✅ |
| Colores crudos | 🔴 1.233 | 🔴 992 (vistas sin migrar) |
| z-index fuera de los tokens | 🔴 31 | 🔴 17 (vistas sin migrar) |
| Hex | 🔴 9 | 🔴 9 (login, Monitor, Planificación) |
| `shadow-sm` · sombras pesadas · `rounded` pelado | 🟡 70 · 12 · 38 | 🟡 1 · 7 · 19 |
| Botón sin `type` · `text-base` · `h-screen` · `font-light` | 🟡 59 · 9 · 3 · 2 | 🟡 56 · 5 · 2 · 2 |
| **Total** | **9 🔴 · 9 🟡** | **3 🔴 · 7 🟡** |

## Revisión visual

Capturas con Playwright contra TESTING (usuario Admin, solo navegación: no se envió nada), desktop
1440 y 1280, mobile 390. Modo noche: tokens definidos y con AA, selector apagado hasta migrar todas las
vistas (se revisa entonces).

**Shell:** sidebar verde Gamma (gris pizarra en TESTING), colapsada a riel con tooltips, menú de
usuario, Sheet mobile, avisos, ayuda por módulo, notificaciones y aviso de versión nueva. ✅

**Operativa — checklist de REDISENO §R.6:**

- [x] Validador: cero 🔴 en `views/RequestsView.tsx` y `components/TicketStatusFilter.tsx`.
- [x] Inter, cuerpo `text-sm`, tabla `text-[13px]`, micro-etiquetas; fechas con `fechaHora()`.
- [x] Colores solo por token; `primary` en acciones y selección; semánticos en estados y avisos.
- [x] Superficies, radios y sombras del estilo.
- [x] Íconos lucide; `aria-label` en los botones-ícono (limpiar búsqueda, ayuda).
- [x] Toolbar de §3.1 (búsqueda con ícono, altas; en mobile, búsqueda en su fila).
- [x] `DataTable` con tarjeta mobile; columna de acciones fija; a 1280 la grilla entra entera.
- [x] Modal de observaciones con header / cuerpo / redactor (`Field` + `Textarea`).
- [x] Estados de negocio con `StatusBadge` y `lib/estados.ts`.
- [x] Cargando / vacío; error con aviso arriba de la grilla (el hook reintenta solo, no hay "Reintentar").
- [x] Foco visible y Escape en modales (Radix).
- [x] Capturas 1440, 1280 y 390 revisadas; controles de la toolbar con la misma altura (las pestañas
      de "Ver como" miden 32 dentro de su contenedor de 36: es el control segmentado).
- [ ] Noche: pendiente de habilitar el selector (ver arriba).

## Pendientes (orden sugerido)

1. **Login** y "cuenta compartida" (`App.tsx`): DESIGN §3.5, con `panel-marca` en verde Gamma.
2. **Mapa de Camas** (`views/BedsView.tsx`, 245 🔴) con la leyenda de `App.tsx`: es la vista más usada
   después de Operativa. Los colores de estado de cama y de aislamiento necesitan su mapa a tonos.
3. **Modales de traslado** (`components/modals/*`): el Dialog ya es el del kit; falta el contenido.
4. **Limpiezas · Cirugías · Comandas · Historial · Usuarios · Roles**, una por commit.
5. **Monitor** (`DashboardView` + `components/dashboard/*`) con `DATAVIZ.md`: KPIs a `Kpi`, gráficos a recharts.
6. Al final: habilitar el selector de tema y revisar todo de noche.
