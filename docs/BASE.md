# Base común de los estilos de Sumar

Todo estilo de Sumar es **un tema sobre esta base**. La base fija el stack, la estructura del proyecto, los nombres de los tokens, la **API de los componentes** y las recetas; cada estilo pone los valores de los tokens, las clases de los componentes y el layout. Por eso una pantalla escrita contra la base se ve bien en cualquier estilo, y pasar de un estilo a otro es cambiar el tema, no reescribir pantallas.

> **Para agentes:** leé esta base una vez (es corta) y después el `DESIGN.md` del estilo del proyecto. Para una tarea puntual, el ruteo del `DESIGN.md` te dice qué sección leer.

| Archivo | Qué tiene |
|---|---|
| `base/BASE.md` | Este documento: stack, estructura, tokens, API de componentes, recetas comunes, reglas. |
| `base/starter/` | El esqueleto común que compila: app, rutas, formato es-AR, store de demo, kit de demo, pantallas de muestra. |
| `estilos/<id>/starter/` | Lo propio del estilo: `src/index.css`, `src/components/ui/*`, `src/components/layout/*`. Se copia **encima** de la base. |
| `estilos/<id>/DESIGN.md` | Reglas visuales del estilo: carácter, tokens con sus valores, tipografía, cómo se compone cada pantalla, reglas de oro. |
| `estilos/<id>/REDISENO.md` | Cómo llevar una app existente a ese estilo. |
| `estilos/<id>/reglas.json` | Lo que el validador chequea de ese estilo. |

Un proyecto nuevo se arma con `node scripts/armar.mjs <estilo> <carpeta>` (lo hace `/nuevo-proyecto`).

---

## 1. Stack

- **Vite + React 19 + TypeScript** (template `react-ts`), código en `src/`, alias `@/` → `src/`.
- **Tailwind 4** con `@tailwindcss/vite`. Sin `tailwind.config.js` ni PostCSS: el tema vive en `src/index.css` (`@theme`).
- **Componentes: shadcn/ui sobre Radix** (paquete `radix-ui`), `class-variance-authority`, `clsx` + `tailwind-merge` 3 (`cn`), `tw-animate-css` para animaciones de entrada/salida.
- **Íconos:** solo `lucide-react`.
- **Otros:** `react-router-dom` 7 (hash router en demos, así el portal vive en `#/portal`), `zustand` (store persistido de la demo), `sonner` (toasts), `cmdk` (comboboxes), `react-day-picker` + `date-fns` (fechas), `recharts` solo si hay dashboards.
- **Navegadores:** Safari 16.4+, Chrome 111+, Firefox 128+ (requisito de Tailwind 4).

### Tailwind 3 → 4 (para leer código viejo o rediseñar)

| Tailwind 3 | Tailwind 4 | |
|---|---|---|
| `shadow-sm` · `shadow` | `shadow-xs` · `shadow-sm` | La escala se corrió un paso. |
| `blur-sm` / `backdrop-blur-sm` · `blur` / `backdrop-blur` | `-xs` · `-sm` | Idem. |
| `rounded-sm` · `rounded` | `rounded-xs` · `rounded-sm` | Idem (salvo que el tema redefina los radios). |
| `outline-none` | `outline-hidden` | `outline-none` de v4 saca el outline también en alto contraste. |
| `ring` (3px) | `ring-3` | `ring` pelado es 1px. |
| `bg-gradient-to-r` | `bg-linear-to-r` | |
| `flex-shrink-0` · `flex-grow` | `shrink-0` · `grow` | Las viejas no existen. |
| `bg-opacity-50` | `bg-x/50` | Idem. |
| `!font-bold` | `font-bold!` | |
| `bg-[--x]` | `bg-(--x)` | |
| `tailwindcss-animate` | `tw-animate-css` | Mismas clases. |
| `tailwind.config.js` · `@tailwind base` | `@theme` · `@import "tailwindcss"` | |

Cambios de comportamiento: `hover:` solo aplica con puntero (`@media (hover:hover)`); `space-y-*` cambió de selector (preferí `gap`); los defaults de borde, placeholder y cursor de botón cambiaron (cada `index.css` de estilo los fija en `@layer base`). Para migrar un repo entero: `npx @tailwindcss/upgrade`.

---

## 2. Tokens (nombres obligatorios)

Cada estilo define **todos** estos tokens en su `index.css`, como variables en `:root` (día) y `.dark` (noche), expuestas con `@theme inline` (`--color-<token>: var(--<token>)`). Las pantallas usan **solo** estos nombres: nunca `bg-white`, `text-gray-500` ni hex.

| Token | Uso |
|---|---|
| `background` / `foreground` | Lienzo de la app y texto principal. |
| `card` / `card-foreground` | Tarjetas y paneles. |
| `popover` / `popover-foreground` | Lo que flota: menús, popovers, modales, toasts. |
| `primary` / `primary-foreground` | La acción principal ("decidir": guardar, aprobar, confirmar). |
| `secondary` / `secondary-foreground` | Acción secundaria con relleno. |
| `muted` / `muted-foreground` | Superficie sutil y texto secundario (labels, ayudas, metadatos). |
| `accent` / `accent-foreground` | Hover y selección en listas y menús. |
| `destructive` / `destructive-foreground` | Borrar, errores. |
| `success` · `warning` · `info` (+ `-foreground`) | Estados semánticos. La superficie es el mismo color con opacidad (`bg-success/10`). |
| `border` · `input` · `ring` | Bordes, borde de controles, anillo de foco. |
| `brand` / `brand-foreground` | **El color del cliente.** Ver §3. |
| `chart-1` … `chart-5` | Series de gráficos (ver el DATAVIZ del estilo). |
| `sidebar`, `sidebar-foreground`, `sidebar-primary(-foreground)`, `sidebar-accent(-foreground)`, `sidebar-border`, `sidebar-ring` | El riel o sidebar de navegación (set completo de shadcn). |

Los `-foreground` pueden ser **oscuros**: de noche los semánticos y la marca suelen ser tonos claros con texto oscuro encima (con un solo valor no se puede tener a la vez texto legible sobre oscuro y fondo de texto blanco). Lo que manda es el contraste (§7).

**Fuente:** la importa el `index.css` del estilo (`@import "@fontsource-variable/…"`), nunca un `.ts`.

**Radios:** `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl` (el estilo fija los valores). **Fuente:** `--font-sans` (y `--font-mono` si hace falta).

**Capas (z-index):** tokens fijos, iguales en todos los estilos. Prohibido cualquier otro número.

| Clase | Valor | Qué va |
|---|---|---|
| `z-nav` | 20 | Sidebar, header sticky, barras de acción fijas. |
| `z-header` | 30 | Header mobile. |
| `z-overlay` | 50 | **Todo lo de Radix** (Dialog, Sheet, Popover, Select, DropdownMenu, Tooltip) y paneles flotantes propios (el celular abajo de `xl`). Entre ellos se ordenan solos por orden de apertura. |
| `z-tour` | 100 | Recorrido guiado. |
| `z-toast` | 110 | Toasts (sonner). |

Adentro de un componente se permiten capas locales `z-0` / `z-10` si el contenedor tiene `isolate` (no escapan de él).

---

**Utilidades semánticas** (cada estilo las define con `@utility` en su `index.css`; las pantallas de la base las usan en vez de escribir clases que dependen del estilo):

| Utilidad | Qué es | Estilo 1 | Copiloto |
|---|---|---|---|
| `micro` | Micro-etiqueta: encabezado de sección chica, label de KPI, header de tabla. | `text-[11px] font-medium uppercase tracking-wider` | su `micro` |
| `display` | Título grande (página, cifra protagonista). | `text-2xl font-bold tracking-tight` | peso 400, tracking cerrado |
| `cifra` | Monto o número destacado dentro de un texto o una fila. | `font-semibold tabular-nums` | `font-medium tabular-nums` |
| `recuadro` | Caja de aviso o nota dentro de un panel. Un aviso semántico le suma su color (`recuadro bg-success/10 border-success/30`). | `rounded-lg border bg-muted/50 p-3` | `rounded-md bg-card p-4` |
| `titulo` | Título de bloque chico: nombre de la app, encabezado de una sección o de una tarjeta suelta (el mismo aspecto que `CardTitle`). | `text-sm font-semibold` | `text-[15px] font-medium` |
| `ficha` | Cuadrado con iniciales o un ícono (logo provisorio, tile de ícono); tamaño y color los pone quien la usa. | `grid place-items-center rounded-lg font-semibold` | idem con radio 28 % y `font-medium` |
| `acento` | Texto de acento (un dato o un link que tiene que resaltar sin ser acción ni estado). | `text-brand` | `text-foreground` (la marca no va en textos) |
| `flotante` | Panel que flota sin ser de Radix (tarjeta del recorrido, celular flotante): el material de un modal. | `rounded-xl border bg-popover shadow-2xl` | `rounded-xl bg-popover shadow-modal ring-1 ring-foreground/5` |
| `lista` | Lista de filas dentro de una `Card` (cada fila pone su padding). | línea fina entre filas | sin líneas: cada fila en `bg-popover` redondeada, separadas por aire |
| `panel-marca` | Panel grande en el color de la marca (la mitad de marca del login). | `bg-brand text-brand-foreground`, de borde a borde | idem, desde `md` despegado del borde con `rounded-2xl` |
| `barra-superior` · `barra-inferior` | Barra fija arriba (header sticky) o abajo (barra de acción) fuera del `AppShell`. | lienzo al 95 % con blur y `border-b` / `border-t` | lienzo translúcido con blur; la de abajo con `shadow-barra` |

Todas salen de tokens (funcionan de día y de noche) y lo que se escribe al lado les gana (`display text-[38px]`, `recuadro bg-success/10`, `micro text-muted-foreground`): el color de `micro`, el tamaño fino de `display` y los márgenes los pone quien la usa. Lo que no es de estilo se escribe directo: layout (`flex`, `grid`, `gap`, padding de contenido), tamaños de texto del cuerpo (`text-sm`, `text-xs`), `font-medium` como énfasis y `tabular-nums`. Los radios por paso de la escala (`rounded-md` en un control o ítem, `rounded-lg` en una card, `rounded-xl` en un modal, `rounded-full` en una pastilla) significan lo mismo en todos los estilos.

Los **bordes y el espaciado de los encabezados y pies** de `Dialog`, `Sheet` y `Card` los pone el componente del estilo (con o sin línea divisoria); las pantallas no agregan `border-b` / `border-t` ni padding a `DialogHeader`, `SheetHeader`, `SheetFooter`, etc. El cuerpo de un `Sheet` (lo que va entre encabezado y pie) lleva `p-4 sm:px-6`, alineado con el encabezado y el pie de todos los estilos.

## 3. Color del cliente (marca)

- **Un token**, `--brand` (hex) en `:root` de `src/index.css`, y su espejo `MARCA` en `src/lib/marca.ts` para lo que no lee CSS (emails, PDF, `<meta theme-color>`). El validador chequea que coincidan.
- **De noche** `.dark` redefine `--brand` (y su foreground) con una versión aclarada del mismo color que pase contraste sobre el fondo oscuro; es obligatorio porque la marca de día casi nunca se lee sobre oscuro. Si algo fuera del CSS la necesita, `MARCA_NOCHE` en `marca.ts`.
- **Dónde va la marca:** logo, login, portal de clientes, emails, acentos de dashboard y filtros/tabs activos si el estilo lo permite. **Dónde no:** botones de acción (eso es `primary`), estados (eso son los semánticos). Cada estilo precisa la lista en su `DESIGN.md`.
- Gráficos: `var(--color-brand)` o `var(--color-chart-N)` directo en las props de recharts; nada de hex.

---

## 4. Componentes (API común)

Todos en `src/components/ui/`, archivos en kebab-case, exports con nombre. **La API es la misma en todos los estilos**; cambian las clases. Un estilo puede **agregar** variantes (el Copiloto suma `variant="ai"`), nunca quitar.

Un estilo también puede **sumar componentes propios** en otra carpeta (el Copiloto trae `src/components/ai/*`, sus patrones de IA) y **reemplazar pantallas de muestra** de la base para mostrarlos (su `starter/src/pages/Inicio.tsx` pisa al de la base). Lo que suma va en su `DESIGN.md`; lo que reemplaza tiene que seguir usando el store y la API comunes.

**De shadcn** (la API es la de shadcn/ui; ver ui.shadcn.com): `button` (variants `default | secondary | outline | ghost | destructive | link`; sizes `default | sm | lg | icon | icon-sm`), `input`, `label`, `textarea`, `field` (Field, FieldLabel, FieldDescription, FieldError, FieldGroup), `select`, `checkbox`, `switch`, `radio-group`, `input-group` (input con ícono o botón adentro: la búsqueda del listado), `dialog`, `alert-dialog`, `sheet`, `dropdown-menu`, `popover`, `command`, `tabs`, `tooltip` (trae su propio Provider), `badge`, `card`, `table`, `skeleton`, `separator`, `sonner` (Toaster), `calendar`, `scroll-area`, `avatar`, `progress`.

**Del kit de Sumar** (misma API en todos los estilos):

| Archivo | Exports | API |
|---|---|---|
| `page-header.tsx` | `PageHeader` | `{ titulo: string; antetitulo?: ReactNode; descripcion?: ReactNode; acciones?: ReactNode }` — título de la página, va adentro de la página. |
| `kpi.tsx` | `KpiGrid`, `Kpi` | `Kpi { etiqueta: string; valor: ReactNode; delta?: { valor: number; sufijo?: string; invertido?: boolean }; ayuda?: string }`. `delta.valor` en puntos (12.4 → "+12,4 %"; `sufijo` por defecto `" %"`). `invertido`: bajar es bueno. |
| `status-badge.tsx` | `StatusBadge`, `type Tono` | `{ tono: "neutro" \| "info" \| "exito" \| "aviso" \| "peligro" \| "marca"; children }`. Cada app mapea sus estados a tonos en `src/lib/estados.ts`. |
| `money-input.tsx` | `MoneyInput` | `{ value: number \| null; onValueChange(v: number \| null); decimales?: number }` + props de `input`. Máscara es-AR (`1.234,56`). |
| `date-picker.tsx` | `DatePicker`, `DateRangePicker` | `{ value?: Date; onChange(d?: Date); placeholder?: string }` · `{ value?: DateRange; onChange(r?: DateRange); placeholder?: string }`. Popover + Calendar, en castellano. Aceptan `id`, `disabled`, `className` y `aria-*` (para atarlos a `FieldLabel htmlFor` y marcar errores). |
| `combobox.tsx` | `Combobox`, `MultiCombobox` | `{ opciones: { value: string; label: string }[]; value: string \| null; onChange(v: string \| null); placeholder?: string; vacio?: string }` · idem con `value: string[]`. Aceptan `id`, `disabled`, `className` y `aria-*`. |
| `estados.tsx` | `Cargando`, `Vacio`, `ErrorEstado` | `Cargando { texto? }` · `Vacio { icono?: LucideIcon; titulo; descripcion?; accion?: ReactNode }` · `ErrorEstado { titulo?; descripcion?; onReintentar() }`. |
| `confirm.tsx` | `ConfirmProvider`, `useConfirm` | `const confirmar = useConfirm(); await confirmar({ titulo, descripcion?, accion?, peligro? })` → `boolean`. Reemplaza a `confirm()`. |
| `data-table.tsx` | `DataTable`, `type Columna<T>` | `{ filas: T[]; columnas: Columna<T>[]; clave(f: T): string; tarjeta?(f: T): ReactNode; onFila?(f: T); porPagina?: number; vacio?: ReactNode; cargando?: boolean; error?: { mensaje?: string; onReintentar() } }`. `Columna { id; titulo; celda(f): ReactNode; alinear?: "izq" \| "der"; ocultarEn?: "md" \| "lg"; ordenar?(f): string \| number }`. `ocultarEn: "md"` = columna secundaria que aparece desde `lg`; `"lg"` = aparece desde `xl`. Desktop: tabla con orden y paginación. Mobile: lista de `tarjeta` (o una tarjeta automática con las columnas). |

**Librerías comunes** (`src/lib/`, las pone la base; los componentes del estilo las importan):

| Archivo | Exports |
|---|---|
| `utils.ts` | `cn(...clases)` |
| `formato.ts` | `dinero(n, { decimales? })` → `$ 1.234,50`, `numero(n, { decimales? })`, `porcentaje(fraccion)` (0,125 → `12,5 %`), `fecha(d)` → `2 nov 2026`, `fechaHora(d)` → `2 nov 2026, 15:20` (24 h), `hora(d)` → `15:20`, `fechaLarga(d)` → `Lunes, 2 de noviembre`, `diaMes(d)` → `2/11`, `relativo(d)` → `hace 5 min`. Todo es-AR, moneda ARS. `parseDinero(texto)` → `number \| null`. |
| `tema.ts` | `useTema()` → `{ tema: "claro" \| "oscuro" \| "sistema"; resuelto: "claro" \| "oscuro"; setTema(t) }`. Pone/saca la clase `.dark` en `<html>` y lo recuerda en `localStorage` con la clave `<proyecto>-tema`, la misma que lee el script de `index.html` que lo aplica antes del primer render (`armar.mjs` la reemplaza). No se usa `next-themes`. |
| `marca.ts` | `MARCA` (hex del cliente, igual a `--brand`), `MARCA_NOCHE?`, `NOMBRE_APP`, `CLIENTE`, `INICIALES` (los completa `armar.mjs`). |
| `dataviz.ts` | `SERIES` (los `var(--color-chart-N)`), `EJES`, `GRILLA` (horizontal, sólida) y `TOOLTIP` (props comunes de recharts). |

**Layout** (`src/components/layout/`):

| Archivo | Exports | API |
|---|---|---|
| `app-shell.tsx` | `AppShell`, `type ItemNav` | `{ nav: ItemNav[]; marca: ReactNode; marcaCompacta?: ReactNode; usuario?: ReactNode; usuarioCompacto?: ReactNode; acciones?: ReactNode; lateral?: ReactNode; children }`. `marcaCompacta` / `usuarioCompacto` (logo y avatar) se usan cuando la navegación es un riel de íconos; si no vienen, el riel no los muestra. `ItemNav { to; label; icon: LucideIcon; grupo?; badge?: number }`. `lateral` es la columna derecha opcional (el celular del portal): el shell la muestra **solo desde `xl`**, con ancho y borde; abajo de `xl` la app la dibuja flotante con `z-overlay` (patrón en `src/demo/CelularPortal.tsx`: `useEsXl()` y un solo iframe por vez).  Resuelve sidebar o riel desktop, header y navegación mobile. |

---

## 5. Estructura del proyecto

```
src/
├─ index.css              tema del estilo (tokens día/noche, capas, base)
├─ main.tsx · App.tsx     entrada y rutas
├─ components/
│  ├─ ui/                 componentes (API §4) — no duplicar, no crear variantes ad hoc
│  ├─ layout/             AppShell
│  └─ <dominio>/          componentes del negocio
├─ pages/                 pantallas del panel
├─ portal/                portal de clientes (si hay)
├─ lib/                   utils (cn) · formato · marca · tema · estados · dataviz · reglas de negocio puras
├─ store/                 db.ts (persistido) · seed.ts · ui.ts
└─ demo/                  recorrido, celular, antes/después, menú demo (KIT-DEMO)
```

---

## 6. Recetas comunes

Cada estilo dice **cómo se ven**; acá está **qué llevan**. Las pantallas de muestra de `base/starter/src/pages/` implementan las cuatro primeras.

1. **Listado** — `PageHeader` (título + acción principal) → barra de herramientas (búsqueda con ícono, filtros con `Select`/`Combobox`/`DateRangePicker`, que en mobile se apilan) → `DataTable` con `tarjeta` para mobile → estados `Cargando` / `Vacio` / `ErrorEstado`.
2. **Detalle** — `Sheet` lateral (derecha) con encabezado (título, `StatusBadge`), cuerpo con secciones clave-valor y acciones al pie. En mobile ocupa todo el ancho.
3. **Formulario** — `Dialog` (o página si es largo): `FieldGroup` → `Field` + `FieldLabel` + control + `FieldDescription` / `FieldError`; `aria-invalid` en el control con error; montos con `MoneyInput`, fechas con `DatePicker`, opciones con `Select` (pocas y fijas, como regla ≤ 7) o `Combobox` (muchas, dinámicas o con búsqueda). Footer: cancelar (`outline`) + confirmar (`default`), en mobile apilados y a lo ancho. Guardar deshabilita y muestra spinner.
4. **Inicio / dashboard** — `PageHeader` → `KpiGrid` de 3–6 `Kpi` → gráficos según el DATAVIZ del estilo → lo que hay que hacer hoy (lista accionable).
5. **Login** — pantalla dividida (marca a la izquierda, formulario a la derecha; en mobile solo el formulario), mensajes de error en castellano, sin revelar si existe el usuario.
6. **Confirmaciones** — `useConfirm()`, nunca `confirm()`. Borrar = `peligro: true`.
7. **Feedback** — `toast.success / toast.error` (sonner) para el resultado de una acción; errores de campo en `FieldError`; errores de carga en `ErrorEstado`.

**Mobile:** se diseña para 390 px. Breakpoints: `md` (768) pasa de tarjetas a tabla y de header mobile a sidebar; `lg` (1024) muestra columnas secundarias y paneles laterales; `xl` (1280) el celular del portal como columna. Alturas con `dvh`, nunca `h-screen`. Targets táctiles ≥ 40 px.

---

## 7. Accesibilidad y textos

- Todo control tiene label visible o `aria-label` (botones de ícono incluidos). `<img>` con `alt`.
- `<button type="button">` salvo el submit del formulario.
- Foco visible siempre (`focus-visible:ring-*` con el token `ring`); nunca `outline-hidden` sin reemplazo.
- Contraste AA: texto normal ≥ 4.5, texto grande y bordes de controles ≥ 3. Cada estilo publica sus pares verificados.
- **Textos en castellano rioplatense** (vos, "Guardar", "Cancelar", "No hay pedidos todavía"). **Formato es-AR** siempre con `src/lib/formato.ts`: `dinero(1234.5)` → `$ 1.234,50`, `numero`, `fecha`, `fechaHora`, `relativo` ("hace 5 min"). Nunca `toFixed` ni `toLocaleString()` sueltos.

---

## 8. Reglas de oro comunes

1. Solo tokens (§2). Hex únicamente en `index.css`, `lib/marca.ts` y `lib/dataviz.ts`.
2. Solo los componentes de `components/ui/` (§4). Si falta algo, se compone con ellos; no se instala otra librería de UI.
3. Solo `lucide-react`.
4. Capas solo con los tokens `z-*` (§2).
5. Nada de `confirm()` / `alert()` / `<select>` / `<input type="date">` nativos.
6. Toda lista tiene sus tres estados: cargando, vacío y error.
7. Toda pantalla funciona en 390 px.
8. Textos en castellano y números con `formato.ts`.
9. Lo que el validador marca 🔴 no se mergea. Una excepción lleva motivo (`// sumar-validar-ignorar: <regla> <motivo>`).
