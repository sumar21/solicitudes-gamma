# AGENTS.md — MediFlow (Gestión de Traslados Hospitalarios)

> Guía canónica para cualquier agente (Claude Code, Codex, Cursor) y para quien se sume al repo. `CLAUDE.md` la importa.

## Resumen del proyecto

MediFlow es una aplicación web para gestionar traslados de pacientes dentro del Hospital Privado de Rosario (HPR), parte del Grupo Gamma. Orquesta el ciclo de vida completo de un traslado: solicitud, asignación de cama, limpieza, transporte, recepción y consolidación.

**Stack:** React 19 + TypeScript + Tailwind 4 (`@tailwindcss/vite`, tema en `index.css`) + Vite + Vercel Serverless + Supabase + SharePoint Online + API Grupo Gamma + Web Push (PWA).

**Usuarios principales:** Admisión (crea traslados), Azafatas (ejecutan traslados por piso), Enfermería/Catering (visualizan mapa de camas).

**Módulos:** Monitor (KPIs), Operativa (tickets activos), Historial (auditoría), Mapa de Camas (grilla visual + detalle paciente), Configuración (ABM usuarios/roles).

## Documentación detallada

- [PRODUCTO.md](PRODUCTO.md) — Qué es la app, módulos, reglas del negocio y roles en una página (el detalle, en los docs de abajo).

Para contexto completo, consultá estos archivos (índice completo en [docs/README.md](docs/README.md)):

La carpeta `docs/` está organizada por propósito: `arquitectura/` (referencia técnica), `qa/`
(testing y soporte), `guias/`, `planes/`, `historial/` (runbooks/incidentes/reportes) y `referencia/`.

- [docs/arquitectura/arquitectura.md](docs/arquitectura/arquitectura.md) — Estructura del proyecto, flujo de datos, API endpoints, tablas Supabase + listas SharePoint, sistema de roles, notificaciones, Realtime, PWA, desarrollo local.
- [docs/arquitectura/decisiones.md](docs/arquitectura/decisiones.md) — Decisiones técnicas con justificación, alternativas descartadas e impacto. Incluye: arquitectura, base de datos, migración a Supabase, autenticación, Realtime vs polling, integración Gamma.
- [docs/arquitectura/convenciones.md](docs/arquitectura/convenciones.md) — Convenciones de código: nombrado, estructura de archivos, patrones de componentes, manejo de estado, estilos Tailwind, imports.
- [docs/qa/casos-de-uso.md](docs/qa/casos-de-uso.md) — Casos de uso por rol, paso a paso (Admisión, Azafata, Enfermería/Catering, Nutrición, Admin + transversales). Mapa central para arrancar QA.
- [docs/qa/escenarios-qa.md](docs/qa/escenarios-qa.md) — Escenarios testeables (`QA-<módulo>-NN`) en formato Precondición → Acción → Resultado esperado, con charter para TestSprite, códigos de error y regresiones a vigilar.
- [docs/arquitectura/roles-permisos-notificaciones.md](docs/arquitectura/roles-permisos-notificaciones.md) — Catálogo de módulos/permisos, matriz notificación → permiso, dos caminos de push, `filter_by_floors`/`assigned_areas`, `bypass_location_check`, excepciones hardcodeadas.
- [docs/qa/troubleshooting.md](docs/qa/troubleshooting.md) — Síntoma → causa probable → qué mirar/escalar, para soporte/QA (push/campanita, Realtime, entorno, comandas, limpiezas, Monitor, Trayectoria, PDF).

## Reglas clave para desarrollo

- **Estado centralizado** en `hooks/useHospitalState.ts` — todo cambio de negocio pasa por este hook.
- **Serverless functions** en `api/` — cada archivo es un endpoint independiente. Registrar rutas nuevas en `dev-server.ts`.
- **SharePoint como DB** — queries lentas, sin JOINs, usar `$filter` con `Prefer: HonorNonIndexedQueriesWarningMayFailRandomly`.
- **API Gamma inestable** — usar `safeJson()`, mantener datos anteriores en error, no saturar con llamadas masivas.
- **Soft-delete** — nunca borrar registros de SP, cambiar `Status` a `'Inactivo'`.
- **localStorage** para sesión (PWA) — `mediflow_token` y `mediflow_user`.
- **Imports en api/**: usar extensión `.js` (`import { x } from './file.js'`). Frontend: sin extensión.
- **Nunca `alert()` / `confirm()` / `prompt()` nativos** — salen como cartel de Chrome ("mediflow.sumar.dev dice…"). Usar `appAlert()` de `lib/appDialog.ts`. El build falla si aparece uno (`scripts/check-no-native-dialogs.mjs`). Ver [convenciones.md §4.5](docs/arquitectura/convenciones.md).
- **Fallas de carga visibles y con reintento; nunca mocks como estado inicial; los filtros de visibilidad fallan abierto** (incidente 14/10/2026: grilla vacía con datos de prueba). Ver [convenciones.md §4.6](docs/arquitectura/convenciones.md).

## Diseño / UI — Estilo 1 · Minimalista zinc

La estética es el **Estilo 1 · Minimalista zinc** de Sumar (`./DESIGN.md`, sello `01-minimal-zinc`),
con el **verde Gamma** como color principal (`primary`, marca y sidebar; de noche, verde salvia apagado y sidebar negra). En TESTING la sidebar y el panel del login son **gris neutro** (zinc), de día y de noche. La API
de componentes es la de la base de Sumar ([docs/BASE.md](docs/BASE.md) §4); este repo la implementa como
dice la tabla de abajo. Cómo se llegó y qué falta: [docs/REDISENO.md](docs/REDISENO.md) y `VALIDACION.md`.

**Antes de tocar UI:** leé la sección de `DESIGN.md` que corresponde a la tarea (ruteo al principio). El JSX completo de cada patrón (modal §4.1, filtros §4.7, columnas agrupadas §7.2, acciones de fila §7.6, login §12.1) está en [docs/RECETAS.md](docs/RECETAS.md): los "§" que cita el código de este repo son los de ese archivo.

**Tableros (Monitor), KPIs y gráficos: siempre con las skills `business-intelligence` (qué se mide y
cómo se calcula: preguntas, medianas / p90, ventanas, comparaciones, lecturas, ancla para verificar)
y `dataviz` (cómo se dibuja: forma, color validado con su script, marcas, tabla), en ese orden, y
después [docs/DATAVIZ.md](docs/DATAVIZ.md)** ([docs/BASE.md](docs/BASE.md) §10). La referencia es el
Monitor (`views/DashboardView.tsx` + `components/dashboard/shared.tsx`): cifra héroe, stat tiles con
delta y sparkline, lectura y vista tabla en cada gráfico. Los colores de gráfico son los `chart-*` de
`index.css`, validados con el script de `dataviz`; uno nuevo se valida antes de usarlo.

La vista de referencia ya migrada es **Operativa** (`views/RequestsView.tsx`): una vista nueva o
migrada se arma igual.

**Inventario:** Vite + React 19 sin router (la vista vive en `useHospitalState.currentView`) · Tailwind 4 ·
componentes copiados del starter del kit en `components/ui/` · tokens en `index.css` (día y noche; selector
de tema en el header, `SelectorTema` de `components/layout/partes-shell.tsx`, default "según el sistema") · Inter · lucide (re-exportado en
`components/Icons.tsx`) · gráficos con recharts (`components/dashboard/shared.tsx`) · marca `#022c22` en `--brand` y
`lib/marca.ts`. El código está en la raíz (no hay `src/`); el alias `@/` apunta a la raíz.

**Equivalencias (kit → este repo):**

| Kit | Acá |
|---|---|
| `src/index.css` | `index.css` (raíz). Sidebar de TESTING: `[data-entorno="testing"]`, lo pone `index.tsx`. |
| `src/components/ui/*` (BASE §4) | `components/ui/*` |
| `AppShell` (`src/components/layout/app-shell.tsx`) | `components/layout/app-shell.tsx`, **sin router**: `ItemNav.id` + `activo` / `onNavegar` sobre `currentView`; suma `ubicacion` (título + ayuda) y `avisos` (banners). Menú de usuario, aviso y pastilla de entorno en `components/layout/partes-shell.tsx`. |
| `src/lib/formato.ts` · `estados.ts` · `dataviz.ts` · `marca.ts` · `tema.ts` | `lib/formato.ts` · `lib/estados.ts` (estados del traslado → tonos) · `lib/dataviz.ts` · `lib/marca.ts` · `lib/tema.ts` (default claro) |
| `StatusBadge` + tonos | `components/ui/status-badge.tsx` + `ESTADOS_TICKET` de `lib/estados.ts` (un tono por etapa) |
| `Combobox` | `components/ui/combobox.tsx`; en campos obligatorios, `obligatorio` (ex `SearchableSelect`) |
| `DatePicker` / `DateRangePicker` | `components/ui/date-picker.tsx`. Las vistas sin migrar usan `Calendar` + `lib/fechaIso.ts` (fechas `YYYY-MM-DD`); al migrar la vista, pasan a `DatePicker`. |
| `DataTable` | `components/ui/data-table.tsx`, con orden controlado (`orden` / `onOrden`), `claseFila` y `clase` por columna |
| Confirmar (`useConfirm`) | Para avisos: `appAlert()` (`lib/appDialog.ts` + `components/AppAlertHost.tsx`, sobre `Dialog`). Nunca `alert` / `confirm` nativos (el build falla). |
| Toasts (`sonner`) | `components/NotificationToast.tsx` (notificaciones push, `z-toast`) |
| `Kpi` | `components/dashboard/StatCard.tsx` (pendiente: pasar a `Kpi` al migrar el Monitor) |
| Capas `z-*` | `z-nav` · `z-header` · `z-overlay` · `z-tour` · `z-toast`; `z-0` / `z-10` solo locales |

**Validación:** `node <kit>/validador/validar.mjs .` (kit: `sumar21/sumar-design-systems`) tiene que dar
cero 🔴 en los archivos que se tocan antes de mergear. Excepciones aceptadas (`.sumar-validar.json`): sin
recorrido guiado (app en producción; ver `PRODUCTO.md`).

**Colores acordados con el hospital (no se cambian por una regla del kit):** Mapa de Camas — verde Disponible, rojo Ocupada, ámbar En preparación, índigo Asignada, gris Inhabilitada, violeta Bloqueada, cian contigua a Contacto preventivo, anillo del color de la cartelería en camas aisladas; pill Cx — ámbar Listo, naranja Búsqueda, amarillo En traslado, cian En cirugía, violeta Regreso, verde Dieta, rojo Cancelada. Fuente: `lib/estados-camas.ts` y `lib/estados-cirugia.ts` (comentarios con el porqué); documentado en [docs/qa/casos-de-uso.md](docs/qa/casos-de-uso.md). Un rediseño los respeta tal cual. **Densidad del mapa (también acordada):** la celda del mapa es un RESUMEN mínimo — número de cama, paciente y marcas con ícono, sin pill de estado (el estado es el color) — para que entre la mayor cantidad de camas por pantalla; todo lo demás va en el tooltip y en el detalle.

**Reglas fijas:** solo tokens (nada de `bg-white`, `text-slate-*`, `emerald-*`, hex, `dark:`); `primary`
para acciones y selección, la marca solo donde dice `DESIGN.md` §1.1; estados con `StatusBadge` y
`lib/estados.ts`; fechas con `fechaHora()` / `fecha()`; listas con cargando / vacío / error. Una vista
está terminada con la checklist de [docs/REDISENO.md](docs/REDISENO.md) §R.6 completa.
