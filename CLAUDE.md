# CLAUDE.md — MediFlow (Gestión de Traslados Hospitalarios)

## Resumen del proyecto

MediFlow es una aplicación web para gestionar traslados de pacientes dentro del Hospital Privado de Rosario (HPR), parte del Grupo Gamma. Orquesta el ciclo de vida completo de un traslado: solicitud, asignación de cama, limpieza, transporte, recepción y consolidación.

**Stack:** React 18 + TypeScript + Tailwind CSS + Vite + Vercel Serverless + SharePoint Online + API Grupo Gamma + Web Push (PWA).

**Usuarios principales:** Admisión (crea traslados), Azafatas (ejecutan traslados por piso), Enfermería/Catering (visualizan mapa de camas).

**Módulos:** Monitor (KPIs), Operativa (tickets activos), Historial (auditoría), Mapa de Camas (grilla visual + detalle paciente), Configuración (ABM usuarios/roles).

## Documentación detallada

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
