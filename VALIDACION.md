# Validación

- **Fecha:** 2026-11-03
- **Estilo:** 01-minimal-zinc v2.1.0
- **Resultado:** 0 errores · 0 avisos · 25 ok

Sin errores ni avisos.


## Antes / después

Mismo validador (kit 2.1.0, `--rapido`) sobre `develop` antes del rediseño (`94bdbad`) y sobre esta rama.
Antes: **9 🔴 · 4 🟡**. Después: **0 🔴 · 0 🟡**.

| Chequeo | Antes | Después |
|---|---|---|
| Colores crudos fuera de los tokens | 🔴 1233 | ✅ |
| Hex hardcodeado en clases o estilos | 🔴 9 | ✅ |
| z-index fuera de los tokens de capa | 🔴 31 | ✅ |
| Clases de Tailwind 3 que en v4 ya no existen | 🔴 7 | ✅ |
| Clases de Tailwind 3 renombradas | 🟡 40 | ✅ |
| `<button>` sin `type` | 🟡 59 | ✅ |
| `h-screen` / `min-h-screen` | 🟡 3 | ✅ |
| Recorrido guiado | 🔴 | ✅ exceptuado (app en producción) |

## Excepciones

- `colores-crudos` — components/dashboard/shared.tsx:257: rótulo DENTRO de un relleno de serie (skill dataviz: blanco sobre el color)
- `colores-crudos` — components/dashboard/shared.tsx:303: rótulo DENTRO de un relleno de serie (skill dataviz: blanco sobre el color)
- `numero-montos` — components/dashboard/shared.tsx:332: eje numérico de recharts, no un input
- `sombras-pesadas` — App.tsx:84: halo de marca del botón del login (receta DESIGN §12.1)
- `cuerpo-text-base` — App.tsx:82: botón grande del login (receta DESIGN §12.1)
- `recorrido` — todo el repo: app en producción: sin demo ni datos de ejemplo (regla del repo: nunca mocks como estado inicial). Ver PRODUCTO.md

## Revisión visual

Capturas en TESTING, solo navegando (sin escribir), a 1440 y 390, de día y de noche. Mapa de Camas
con datos sintéticos (TESTING devolvía 503 en `/api/beds`), interceptados solo en el navegador de prueba.

| Vista | Día 1440 / 390 | Noche 1440 / 390 | Notas |
|---|---|---|---|
| Login y cuenta compartida (§12.1) | ✅ | ✅ | Panel sobre tokens del sidebar: verde Gamma de día, negro de noche, gris en TESTING |
| Monitor (tablero, BI + dataviz) | ✅ | ✅ | TESTING sin traslados "Hoy": se ven los estados vacíos |
| Operativa · Traslados (referencia) | ✅ | ✅ | |
| Operativa · Limpiezas | ✅ | ✅ | |
| Operativa · Cirugías | ✅ | ✅ | |
| Historial (+ auditoría y trayectoria) | ✅ | ✅ | |
| Mapa de Camas (+ detalle, leyenda) | ✅ | ✅ | Colores acordados restaurados (04/11/2026): Ocupada roja, Asignada índigo, Bloqueada violeta, Contacto prev. cian, Cx por etapa; celda compacta sin pill de estado (el estado es el color) y grilla con columnas automáticas (~15 a 1280 px, 4 en celular) para que entren la mayor cantidad de camas. Ver `lib/estados-camas.ts` |
| Comandas (hoy, histórico, cambios de dieta) | ✅ | ✅ | |
| Usuarios y Roles | ✅ | ✅ | |

Checklist §R.6 por vista: tokens solos, `StatusBadge` + `lib/estados*.ts`, columnas agrupadas (§7.2),
filtros §4.7, cargando / vacío / error con reintento, modal canónico §4.1, fechas con `fechaHora()`.
