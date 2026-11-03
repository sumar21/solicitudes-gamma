# Validación

- **Fecha:** 2026-11-03
- **Estilo:** 01-minimal-zinc v2.1.0
- **Resultado:** 3 errores · 6 avisos · 16 ok

| | Grupo | Chequeo | Dónde |
|---|---|---|---|
| 🔴 | Diseño | Colores crudos fuera de los tokens (white, black, gray, slate, neutral, stone) | App.tsx:89<br>App.tsx:91<br>App.tsx:92<br>App.tsx:95<br>App.tsx:100 |
| 🔴 | Diseño | Hex hardcodeado en clases o estilos | App.tsx:110<br>App.tsx:372 |
| 🔴 | Diseño | z-index fuera de los tokens de capa (z-[9999], z-50, z-100, zIndex: 999) | views/ComandasManagementView.tsx:371<br>views/ComandasManagementView.tsx:378<br>views/ComandasManagementView.tsx:837<br>views/ComandasManagementView.tsx:844<br>views/HistoryView.tsx:396 |
| 🟡 | Diseño | <button> sin type (dentro de un form hace submit) | views/BedsView.tsx:721<br>views/BedsView.tsx:739<br>views/BedsView.tsx:867<br>views/BedsView.tsx:871<br>views/BedsView.tsx:878 |
| 🟡 | Diseño | h-screen / min-h-screen (en mobile va dvh) | App.tsx:89<br>App.tsx:311 |
| 🟡 | Diseño | rounded pelado / none / 3xl / arbitrario | App.tsx:95<br>App.tsx:320 |
| 🟡 | Diseño | shadow-sm (en v4 es más fuerte; la base del kit es shadow-xs) | components/AuditModal.tsx:440<br>views/BedsView.tsx:1033 |
| 🟡 | Diseño | shadow-lg / shadow-xl fuera de modales, toasts y tooltips | App.tsx:95<br>App.tsx:320<br>App.tsx:371<br>views/RoleManagementView.tsx:408<br>views/UserManagementView.tsx:275 |
| 🟡 | Diseño | text-base como cuerpo fuera de components/ui (el cuerpo del kit es text-sm) | views/HistoryView.tsx:576 |

## Por archivo

Orden de ataque: los que más 🔴 tienen, primero (las ubicaciones completas, con `--json`).

| Archivo | 🔴 | 🟡 | Reglas |
|---|---|---|---|
| `views/BedsView.tsx` | 165 | 23 | colores-crudos, boton-sin-type, sombra-base |
| `views/ComandasManagementView.tsx` | 78 | 7 | colores-crudos, z-magicos, boton-sin-type |
| `App.tsx` | 55 | 7 | colores-crudos, hex, alto-screen, rounded-pelado, sombras-pesadas |
| `views/HistoryView.tsx` | 48 | 2 | colores-crudos, z-magicos, boton-sin-type, cuerpo-text-base |
| `views/UserManagementView.tsx` | 34 | 6 | colores-crudos, z-magicos, boton-sin-type, sombras-pesadas |
| `views/RoleManagementView.tsx` | 27 | 6 | colores-crudos, z-magicos, boton-sin-type, sombras-pesadas |
| `components/AuditModal.tsx` | — | 1 | sombra-base |

## Excepciones

- `numero-montos` — components/dashboard/shared.tsx:123: eje numérico de recharts, no un input
- `sombras-pesadas` — components/dashboard/shared.tsx:75: tooltip de gráfico (§1.4: shadow-lg es de toasts y tooltips)
- `recorrido` — todo el repo: app en producción: sin demo ni datos de ejemplo (regla del repo: nunca mocks como estado inicial). Ver PRODUCTO.md

## Revisión visual

<!-- La completa el agente con /validar: capturas desktop (1440) y mobile (390) y la checklist por vista. -->
