# Documentación — MediFlow (Gestión de Traslados HPR · Grupo Gamma)

Índice de toda la documentación del repo. Cada fila dice **qué contiene** el archivo y **para quién**
es (👩‍💻 dev / 🧪 QA / 🛟 soporte). La **fuente de verdad siempre es el código actual**
(post-migración SharePoint → Supabase, en producción); cuando una doc general contradice al código,
gana el código.

> **Contexto rápido.** MediFlow gestiona el ciclo de vida de un traslado de paciente (solicitud →
> cama → limpieza → transporte → recepción → consolidación). Stack: React 18 + TS + Vite + Vercel
> Serverless (`api/`) + **Supabase** (dominio transaccional, Realtime, RLS por "pase" JWT ES256) +
> **SharePoint/Gamma** (mapa de camas, usuarios/login, enrich, geo-IP). Ver `../CLAUDE.md` para el
> resumen y las reglas de desarrollo.

---

## Estructura de la carpeta

```
docs/
├── README.md                 ← este índice
├── arquitectura/             👩‍💻 referencia técnica (cómo está hecho y por qué)
│   ├── arquitectura.md
│   ├── decisiones.md
│   ├── convenciones.md
│   └── roles-permisos-notificaciones.md
├── qa/                       🧪 testing y soporte (qué probar / qué mirar cuando falla)
│   ├── casos-de-uso.md
│   ├── escenarios-qa.md
│   └── troubleshooting.md
├── guias/                    🛟 guías para usuarios finales
│   └── instalacion-movil.md
├── planes/                   📐 diseño de features (registro de decisiones)
│   ├── plan-comandas-planificacion.md
│   ├── plan-3-features.md
│   └── plan-traslados-cirugia.html
├── historial/                🗂️ runbooks, incidentes y reportes de sesión
│   ├── cutover-supabase-main.md
│   ├── issue-notifs-admision-vapid.md
│   ├── reporte-sesion-22abril-2026.html
│   └── reporte-sesion-27abril-2026.html
├── referencia/               📎 material externo del proveedor
│   └── Grupo Gamma - APIv30 (3).pdf
└── vercel-logs/              (gitignored — dumps CSV para diagnóstico)
```

---

## Por dónde empezar

- **Soy dev y recién entro** → [arquitectura/arquitectura.md](arquitectura/arquitectura.md) → [arquitectura/convenciones.md](arquitectura/convenciones.md) → [arquitectura/decisiones.md](arquitectura/decisiones.md).
- **Voy a hacer QA** → [qa/casos-de-uso.md](qa/casos-de-uso.md) (qué hace cada rol) → [qa/escenarios-qa.md](qa/escenarios-qa.md) (casos testeables, alineados a **TestSprite**) → [arquitectura/roles-permisos-notificaciones.md](arquitectura/roles-permisos-notificaciones.md) (matriz de permisos/push).
- **Estoy dando soporte / algo falla** → [qa/troubleshooting.md](qa/troubleshooting.md) (síntoma → causa → qué mirar).
- **Voy a instalar la app en un celular** → [guias/instalacion-movil.md](guias/instalacion-movil.md).
- **Voy a mergear la migración de Supabase a prod** → [historial/cutover-supabase-main.md](historial/cutover-supabase-main.md).

---

## Documentación viva (se mantiene al día con el código)

| Archivo | Qué contiene | Para quién |
|---------|--------------|:----------:|
| [arquitectura/arquitectura.md](arquitectura/arquitectura.md) | Visión general y stack, estructura del proyecto, flujo de datos, endpoints `api/`, tablas Supabase + listas SharePoint, sistema de roles, notificaciones (dos caminos de push), Realtime, PWA, desarrollo local. | 👩‍💻 dev |
| [arquitectura/decisiones.md](arquitectura/decisiones.md) | Registro de decisiones técnicas (qué se decidió, por qué, alternativas descartadas, impacto): arquitectura, base de datos, migración a Supabase, autenticación, Realtime vs polling, integración Gamma, notificaciones. | 👩‍💻 dev |
| [arquitectura/convenciones.md](arquitectura/convenciones.md) | Convenciones de código con ejemplos reales: nombrado, estructura de archivos, patrones de componentes, manejo de estado, estilos Tailwind, imports (`.js` en `api/`). | 👩‍💻 dev |
| [qa/casos-de-uso.md](qa/casos-de-uso.md) | Casos de uso **por rol**, paso a paso (Admisión, Azafata, Enfermería/Catering, Nutrición, Admin, y transversales de login/notificaciones/Monitor/Historial). Formato actor → objetivo → pasos → resultado esperado → permiso/gating → archivo. Mapa central para arrancar QA. | 🧪 QA · 🛟 soporte |
| [qa/escenarios-qa.md](qa/escenarios-qa.md) | Escenarios **testeables** (`QA-<módulo>-NN`) en formato Precondición → Acción → Resultado esperado, **con charter para TestSprite** (entorno, credenciales, alcance, suite P0): traslados, limpiezas, comandas, permisos/roles, notificaciones, Realtime, versionado, infra/RLS; incluye códigos de error y regresiones históricas a vigilar. | 🧪 QA |
| [arquitectura/roles-permisos-notificaciones.md](arquitectura/roles-permisos-notificaciones.md) | Referencia de permisos: catálogo de módulos y permisos (`types.ts`), qué habilita cada uno, matriz notificación → permiso, dos caminos de push, `filter_by_floors`/`assigned_areas`, `bypass_location_check`, ABM de Roles y excepciones hardcodeadas. | 🧪 QA · 👩‍💻 dev |
| [qa/troubleshooting.md](qa/troubleshooting.md) | Síntoma → causa probable → qué mirar/escalar: push nativa + campanita, Realtime, entorno TESTING/PRODUCTIVO, comandas, versión de build, limpiezas, Monitor, Trayectoria, PDF de camas. | 🛟 soporte · 🧪 QA |

---

## Runbooks y guías operativas

| Archivo | Qué contiene | Para quién |
|---------|--------------|:----------:|
| [historial/cutover-supabase-main.md](historial/cutover-supabase-main.md) | Runbook del cutover de la migración Supabase a `main` (PRODUCTIVO): qué migra y qué queda en SharePoint, cómo cargar envs, backfill por `entorno` con allowlist, merge. Incluye los fixes de la revisión adversarial (NO-GO → GO). | 👩‍💻 dev |
| [guias/instalacion-movil.md](guias/instalacion-movil.md) | Cómo instalar la PWA en el celular (Android/Chrome e iOS/Safari), paso a paso, para usuarios finales. | 🛟 soporte · usuarios |

---

## Registros de incidentes / issues

| Archivo | Qué contiene | Para quién |
|---------|--------------|:----------:|
| [historial/issue-notifs-admision-vapid.md](historial/issue-notifs-admision-vapid.md) | Issue **RESUELTO** (device-side): Admisión no recibía push nativo tras el cutover. La hipótesis VAPID/403 quedó descartada por los logs de Vercel (entrega OK, 201) → causa en el dispositivo (permiso SO/navegador). Lección: verificar antes de afirmar. | 🛟 soporte · 👩‍💻 dev |

---

## Planes de features (registro de diseño)

| Archivo | Qué contiene | Estado | Para quién |
|---------|--------------|--------|:----------:|
| [planes/plan-comandas-planificacion.md](planes/plan-comandas-planificacion.md) | Diseño de planificación de comandas + carga por turno con acompañantes. | ✅ **Implementado** (2026-07-15) — vale como registro de decisiones. | 👩‍💻 dev |
| [planes/plan-3-features.md](planes/plan-3-features.md) | Diseño consolidado de tres features (tag de sexo sugerido, buscador en el monitor de comandas, limpiezas dentro de Operativa). | ✅ Implementado (registro de decisiones). | 👩‍💻 dev |
| [planes/plan-traslados-cirugia.html](planes/plan-traslados-cirugia.html) | Plan de la feature "Traslados a Cirugía". | 🔜 **Planificada, NO construida** — no testear como existente. | 👩‍💻 dev |

---

## Reportes de sesión y material de referencia

| Archivo | Qué contiene | Para quién |
|---------|--------------|:----------:|
| [historial/reporte-sesion-22abril-2026.html](historial/reporte-sesion-22abril-2026.html) | Reporte de la sesión de desarrollo del 22/04/2026 (items desarrollados). | 👩‍💻 dev · histórico |
| [historial/reporte-sesion-27abril-2026.html](historial/reporte-sesion-27abril-2026.html) | Reporte de la sesión de desarrollo del 27/04/2026 (items desarrollados). | 👩‍💻 dev · histórico |
| `referencia/Grupo Gamma - APIv30 (3).pdf` | Documentación de la API REST de Grupo Gamma (v30) — referencia externa del proveedor. | 👩‍💻 dev |
| `vercel-logs/` | Exports CSV de logs de Vercel (`push-utils`) usados para diagnosticar el issue de push de Admisión. | 🛟 soporte · 👩‍💻 dev |

---

> **Mantenimiento.** Estos docs se sincronizan con el código con la skill `update-docs`. Si encontrás
> una contradicción entre una doc y la app, gana el código y hay que actualizar la doc (o avisar).
