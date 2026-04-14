# CLAUDE.md — MediFlow (Gestión de Traslados Hospitalarios)

## Resumen del proyecto

MediFlow es una aplicación web para gestionar traslados de pacientes dentro del Hospital Privado de Rosario (HPR), parte del Grupo Gamma. Orquesta el ciclo de vida completo de un traslado: solicitud, asignación de cama, limpieza, transporte, recepción y consolidación.

**Stack:** React 18 + TypeScript + Tailwind CSS + Vite + Vercel Serverless + SharePoint Online + API Grupo Gamma + Web Push (PWA).

**Usuarios principales:** Admisión (crea traslados), Azafatas (ejecutan traslados por piso), Enfermería/Catering (visualizan mapa de camas).

**Módulos:** Monitor (KPIs), Operativa (tickets activos), Historial (auditoría), Mapa de Camas (grilla visual + detalle paciente), Configuración (ABM usuarios/roles).

## Documentación detallada

Para contexto completo, consultá estos archivos:

- [docs/arquitectura.md](docs/arquitectura.md) — Estructura del proyecto, flujo de datos, API endpoints, listas SharePoint, sistema de roles, notificaciones, PWA, desarrollo local.
- [docs/decisiones.md](docs/decisiones.md) — Decisiones técnicas con justificación, alternativas descartadas e impacto. Incluye: arquitectura, base de datos, autenticación, polling vs websockets, integración Gamma.
- [docs/convenciones.md](docs/convenciones.md) — Convenciones de código: nombrado, estructura de archivos, patrones de componentes, manejo de estado, estilos Tailwind, imports.

## Reglas clave para desarrollo

- **Estado centralizado** en `hooks/useHospitalState.ts` — todo cambio de negocio pasa por este hook.
- **Serverless functions** en `api/` — cada archivo es un endpoint independiente. Registrar rutas nuevas en `dev-server.ts`.
- **SharePoint como DB** — queries lentas, sin JOINs, usar `$filter` con `Prefer: HonorNonIndexedQueriesWarningMayFailRandomly`.
- **API Gamma inestable** — usar `safeJson()`, mantener datos anteriores en error, no saturar con llamadas masivas.
- **Soft-delete** — nunca borrar registros de SP, cambiar `Status` a `'Inactivo'`.
- **localStorage** para sesión (PWA) — `mediflow_token` y `mediflow_user`.
- **Imports en api/**: usar extensión `.js` (`import { x } from './file.js'`). Frontend: sin extensión.
