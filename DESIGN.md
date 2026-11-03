<!-- sumar:estilo=01-minimal-zinc version=2.2.0 -->
# Estilo 1 · Minimalista zinc (Sumar UI Kit)

Reglas visuales del estilo. Es **un tema sobre la base común** (`base/BASE.md`): la base fija stack, tokens, API de componentes, recetas, accesibilidad y textos; este documento dice **cómo se ven** acá. Es prescriptivo: si algo no está, se compone con los componentes de `src/components/ui/` y los tokens de §1, no se inventa.

> **Ruteo — leé solo lo que tu tarea necesita:**
>
> | Situación | Qué hacer | Qué leer |
> |---|---|---|
> | **Repo nuevo** | `node scripts/armar.mjs 01-minimal-zinc <carpeta>` (o `/nuevo-proyecto`). Copia la base y el starter del estilo; no hay código para pegar. | BASE entera (es corta) + este documento. |
> | **Repo existente** (otra estética) | `/rediseno` | **`REDISENO.md`** entero, después la sección de acá que pida cada capa. |
> | **Dashboard, gráfico o KPI** | Las skills **`business-intelligence`** (qué se mide y cómo se calcula) y **`dataviz`** (cómo se dibuja), siempre y en ese orden (BASE §10). | **`DATAVIZ.md`** + §3.4 de este documento. |
> | **Patrón de negocio** (cuenta corriente, checkout, emails, permisos, tipo de cambio) | Son opcionales. | **`EJEMPLOS.md`**. |
> | **Receta citada por número del DESIGN.md original** (`§4.1`, `§4.7`, `§7.2`, `§12.1`…) o **el JSX completo** de un patrón | Recetas del original adaptadas al kit. | **`RECETAS.md`**, la sección con ese número (índice al principio). |
> | **Tarea puntual** | — | Colores → §1.1 · tipografía → §1.2 · superficies, radios, sombras → §1.3–§1.5 · densidad → §1.6 · íconos → §1.7 · foco → §1.8 · animaciones → §1.9 · cómo se ve un componente → §2 · listado → §3.1 · detalle → §3.2 · formulario → §3.3 · inicio → §3.4 · login → §3.5 · confirmar → §3.6 · toasts y banners → §3.7 · filtros → §3.8 · tablas → §3.9 · sidebar, header, mobile, celular → §4 · modo noche → §5 · reglas de oro → §6. · JSX completo: modal de formulario → `RECETAS.md` §4.1 · página de listado → §4.4 · barra de filtros → §4.7 · toolbar → §5.2 · columnas progresivas y tarjeta mobile → §5.4 · celdas de dos líneas → §7.2 · acciones de fila → §7.6 · edición inline → §6.11 · cambios sin guardar → §8.8 · login → §12.1 |
>
> Dónde están los otros documentos: en un proyecto armado con `scripts/armar.mjs`, `BASE.md`, `REDISENO.md`, `DATAVIZ.md`, `RECETAS.md` y `KIT-DEMO.md` están en `docs/`. `EJEMPLOS.md` y `CHANGELOG.md` se leen del kit (`estilos/01-minimal-zinc/`), igual que cualquiera que falte en el proyecto.

**Dónde está el código** (este documento no pega código de componentes; la fuente de verdad son los archivos):

| Qué | Dónde (en el kit) | En el proyecto |
|---|---|---|
| Tokens día y noche, capas, `@layer base`, scrollbar | `estilos/01-minimal-zinc/starter/src/index.css` | `src/index.css` |
| Componentes con las clases de este estilo | `estilos/01-minimal-zinc/starter/src/components/ui/*.tsx` | `src/components/ui/` |
| Shell (sidebar, header, mobile, celular) | `estilos/01-minimal-zinc/starter/src/components/layout/app-shell.tsx` | `src/components/layout/` |
| Pantallas de muestra | `base/starter/src/pages/{Inicio,Pedidos,PedidoDetalle,NuevoPedido,Login}.tsx` | `src/pages/` |
| Formato, tema, marca, dataviz, estados | `base/starter/src/lib/{formato,tema,marca,dataviz,estados}.ts` | `src/lib/` |
| Lo que chequea el validador | `base/reglas.json` + `estilos/01-minimal-zinc/reglas.json` | — |

---

## 0. Carácter

**Blanco y negro por defecto, cards blancas con borde fino y sombra mínima, Inter en tamaños chicos, micro-etiquetas en mayúsculas espaciadas y el color del cliente solo donde importa.** Se siente una herramienta de trabajo prolija: densa sin ser apretada, sin decoración que compita con los datos.

| Conviene | No conviene |
|---|---|
| Backoffices y ERPs densos: tablas largas, finanzas, cuentas corrientes, stock, muchos módulos y formularios. | Demos donde la IA tiene que verse trabajando (para eso, el Copiloto). |
| Clientes con marca propia fuerte: la marca cambia un token y el resto queda neutro. | Pantallas táctiles de operario con guantes o kioscos (los controles son chicos). |
| Usuarios que pasan el día en la app y valoran leer rápido. | Landing pages o apps de consumo que necesitan personalidad visual. |

Cinco decisiones hacen el 80 % del look; si están, la app ya "es" el estilo: **Inter con cuerpo `text-sm`** (§1.2) · **neutros zinc + `primary` negro (en un rediseño, el color de la app) + marca como único acento** (§1.1) · **cards planas con borde de 1 px y `shadow-xs`** (§1.3, §1.5) · **radios `md` / `lg` / `xl`** (§1.4) · **micro-etiquetas (`micro`: `text-[11px] font-medium uppercase tracking-wider`) y números `tabular-nums`** (§1.2).

---

## 1. Fundaciones

### 1.1 Color

Los nombres de token son los de BASE §2. Los valores exactos, de día y de noche, están en `src/index.css`: **ese archivo manda**. La tabla da los valores clave de día como referencia.

| Token | Día | Se usa para | No se usa para |
|---|---|---|---|
| `background` / `foreground` | `#ffffff` / `#09090b` | Lienzo y texto principal. | — |
| `card` · `popover` | `#ffffff` (de noche, un paso y dos pasos más claros que el lienzo) | Tarjetas, paneles · lo que flota: menús, popovers, modales, sheets, toasts. | Fondos grandes de sección (eso es `secondary/30`). |
| `primary` / `primary-foreground` | `#1a1a1a` / `#fafafa` | **La acción y la selección**: botón default, nav activo, checkbox / switch / radio marcados, día elegido del calendario, pill o card seleccionada, barra de progreso. | Decorar. En un proyecto nuevo es este negro para todos los clientes; **en un rediseño, el color principal de la app** (BASE §9.1). |
| `secondary` | `#f4f4f5` | Botón secundario; header de modal (`/20`); área de contenido (`/30`); cajas de agrupación (`/20`). | — |
| `muted` / `muted-foreground` | `#f4f4f5` / `#6b6b73` | Superficies sutiles (`/20`, `/50`), fila seleccionada, texto secundario, labels, micro-etiquetas, placeholder, ejes de gráficos. | Texto principal. |
| `accent` | `#f4f4f5` | Hover y opción activa en listas, menús y comboboxes. | Selección persistente (eso es `primary`). |
| `destructive` | `#c81e1e` | Borrar, cerrar sesión, errores, montos negativos, contador de pendientes del nav. | Advertencias (eso es `warning`). |
| `success` · `warning` · `info` | `#047857` · `#a8490b` · `#1d4ed8` | Positivo / listo · pendiente / falta algo · informativo / en curso. Superficie con opacidad: `bg-success/10 text-success`. | Series de gráficos que no significan bien / mal. |
| `border` · `input` · `ring` | `#e4e4e7` · `#e4e4e7` · `#71717a` | Bordes de cards y divisores · borde de controles · anillo de foco. | — |
| `brand` / `brand-foreground` | el del cliente | Ver la tabla de marca. | Ver la tabla de marca. |
| `chart-1` … `chart-5` | `chart-1` = paso validado de la marca · `#2563eb` · `#059669` · `#d97706` · `#7c3aed` | Series de gráficos. Reglas en `DATAVIZ.md`. | UI (botones, badges, texto). |
| `sidebar*` | `#fafafa`, borde `border`, ítem activo `sidebar-accent` | El sidebar (§4.1). En un rediseño puede ser del color de la app: el `AppShell` usa solo tokens `sidebar-*` (BASE §9.1). | — |

**Marca del cliente.** Un token, `--brand` en `:root` de `src/index.css`, y su espejo `MARCA` en `src/lib/marca.ts` para emails, PDF y `<meta theme-color>`; el validador chequea que coincidan (BASE §3). Las opacidades salen solas porque `brand` está en `@theme inline`: `bg-brand/10`, `border-brand/20`. Nunca `bg-(--brand)` ni el hex.

| La marca **va** en | La marca **no va** en |
|---|---|
| Logo e isotipo; panel izquierdo del login (§3.5); portal de clientes; emails (`EJEMPLOS.md` §6). | Botones de acción, incluido "Reintentar" (eso es `primary` u `outline`). |
| Ícono de `TituloSeccion` en dashboards; serie principal de un gráfico (`chart-1`). | Nav activo, checkbox, switch, día elegido, pill seleccionada (eso es `primary`). |
| Tab o filtro **activo de un dashboard** (§3.8) y su contador. | Estados y feedback (eso son los semánticos). |
| Fallback del avatar (`bg-brand/10 text-brand`); tile de ícono del encabezado de un detalle (`bg-brand/10` + ícono `text-brand`). | Anillo de foco (eso es `ring`). |
| Un total destacado por pantalla (`font-bold tabular-nums text-brand`). | Fondos grandes, texto de cuerpo, bordes de cards comunes. |

**Semánticos.** Siempre el mismo patrón, cambiando el token:

| Pieza | Clases |
|---|---|
| Badge / pill / chip | `bg-<sem>/10 text-<sem>` |
| Banner suave | `rounded-lg border border-<sem>/20 bg-<sem>/10 p-3 text-sm text-<sem>` + ícono `h-4 w-4`. Es el componente `Aviso` (`estados.tsx`, BASE §4): no se arma a mano. |
| Tile de ícono | `h-9 w-9 rounded-lg bg-<sem>/10` + ícono `h-4 w-4 text-<sem>` |
| Valor con signo | `text-success` (positivo) · `text-destructive` (negativo), con prefijo `+` / `−` |

`<sem>` = `success` · `warning` · `info` · `destructive`. Nada de `emerald-*`, `amber-*`, `red-*`, `blue-*` crudos en pantallas: eso era el kit anterior (de noche quedan crema y pastel sobre negro; en un rediseño, el puente es BASE §9.4).

**Estados → tonos.** Los estados de cada app se mapean a los tonos de `StatusBadge` (BASE §4) en `src/lib/estados.ts`, nunca en la pantalla: los seis de base (`neutro` · `aviso` · `exito` · `info` · `peligro` · `marca`) y tres extra para circuitos largos y categorías que no son estado, `cielo` (todavía no empezó, pospuesto) · `indigo` (en proceso) · `violeta` (despachado, el otro camino). Los extra son tokens (`--cielo`, `--indigo`, `--violeta`: sky / indigo / violet 700 de día, 400 de noche) y salen de la paleta §3.11 del DESIGN original (`RECETAS.md`). Dos reglas:

1. **Un tono por etapa del circuito, no uno por estado.** Estados distintos que significan "falta lo mismo" comparten tono; los distingue el texto. Y el badge muestra el estado **de lectura**, no el enum del backend: una compra "Activa" que todavía se debe no puede llevar el mismo tono que una "Pagada".
2. **Tonos que conviven en una columna tienen que separarse en matiz (≥ 25°).** Los estados usan los semánticos y `neutro`, nunca `marca` (BASE §3). Si en la misma columna aparece una etiqueta en tono `marca` (un canal, una categoría), no puede convivir con `info` si la marca del cliente es azulada, ni con `peligro` si es roja.

Ejemplo de eje para una cuenta corriente: `aviso` = falta algo · `info` = comprometido · `exito` = liquidado · `neutro` = anulado o cerrado · `peligro` = vencido.

**Pares de contraste verificados (WCAG 2).** BASE §7 pide AA. Están medidos con los valores del starter y documentados en la cabecera de `src/index.css`; si cambiás un valor, recalculá su par ahí. "Sup. 10 %" es el color como texto sobre `bg-<color>/10` apoyado en una card, que es como se usan badges, banners y chips.

| Par | Día | Noche |
|---|---|---|
| `foreground` / `background` | 19,9 | 19,1 |
| `muted-foreground` / `background` · `card` · `muted` | 5,3 · 5,3 · 4,8 | 7,8 · 7,4 · 6,4 |
| `primary-foreground` / `primary` | 16,7 | 17,0 |
| `brand-foreground` / `brand` · `brand` / `card` | 10,8 · 10,8 | 7,2 · 6,8 |
| `destructive-foreground` / `destructive` · `destructive` / sup. 10 % | 5,7 · 4,9 | 7,2 · 6,0 |
| `success` · `warning` · `info` / sup. 10 % | 4,8 · 5,0 · 5,7 | 8,4 · 9,5 · 6,5 |
| `ring` / `background` (foco, ≥ 3) | 4,8 | 7,8 |
| `input` / `background` (borde de controles) | 1,3 ⚠️ | 1,9 ⚠️ |

El borde liviano de los controles (`input`) queda por debajo del 3:1 de BASE §7 y es una **excepción declarada del estilo**: es parte de su carácter, y el control se identifica igual por el label visible, el placeholder, la sombra `shadow-xs` y el anillo de foco. Checkbox y radio, que no tienen label adentro, usan borde `muted-foreground` (≥ 3). Si un cliente exige AA estricto en bordes, se oscurece `--input` y se anota en `CHANGELOG.md`.

### 1.2 Tipografía

**Inter** es la única fuente (`--font-sans`; la carga el starter). `antialiased` en `body`. Sin pesos livianos: `font-medium` (énfasis por defecto), `font-semibold` (labels, encabezados), `font-bold` (títulos y valores).

| Uso | Clases |
|---|---|
| Título de página (`PageHeader`) | `text-2xl font-bold tracking-tight` |
| Título de login | `text-3xl font-bold tracking-tight` |
| Título de modal / sheet | `text-lg font-bold tracking-tight` |
| Título de card (`CardTitle`) | `text-base font-semibold tracking-tight` (`text-sm` en `Card size="sm"`) |
| Título de sección de un formulario | `text-sm font-semibold` (con ícono `h-4 w-4` si suma) |
| Título de sección de dashboard (`TituloSeccion`) | `text-xs font-bold uppercase tracking-wider text-muted-foreground` + ícono `h-4 w-4 text-brand` |
| **Cuerpo de la app** | `text-sm` |
| Tabla | `text-[13px]` |
| Label de campo · texto secundario | `text-xs font-medium text-muted-foreground` |
| **Micro-etiqueta** (encabezado de tabla, label de KPI, grupo del nav, clave de un clave-valor) | `text-[11px] font-semibold uppercase tracking-wider text-muted-foreground` |
| Badge de estado, metadato bajo un valor | `text-[10px]` (el mínimo; nada de `text-[9px]` ni `[8px]`) |
| Valor de KPI | `text-2xl font-bold tracking-tight` (figuras proporcionales: sin `tabular-nums`) |
| Monto o cantidad en columna, total, eje | `tabular-nums` (+ `font-mono` solo en grillas densas y totales de formulario) |

Prohibido: `text-base` como cuerpo, `font-light` / `font-thin` (el validador los marca). Dos usos legítimos de `text-base` viven en `components/ui/`: `CardTitle` y los campos (`input`, `textarea`), que en mobile van a 16 px para que iOS no haga zoom al enfocarlos (`text-base md:text-sm`). Los números siempre pasan por `src/lib/formato.ts` (BASE §7).

### 1.3 Superficies y bordes

Jerarquía de fondos, de atrás hacia adelante:

| Capa | Clases |
|---|---|
| Lienzo | `bg-background` |
| Área de contenido (al lado del sidebar) | `bg-secondary/30` |
| Card / panel | `rounded-lg border bg-card shadow-xs` |
| Superficie sutil dentro de una card (caja de agrupación, footer de modal, barra de filtros) | `bg-muted/20` |
| Hover de fila · encabezado sticky de grilla | `bg-muted/50` · `bg-muted/60 backdrop-blur-sm` |
| Header de modal | `bg-secondary/20` |
| Fila seleccionada · card u opción elegida | `bg-muted` · `bg-primary/5` con borde `border-primary/40` |
| Lo que flota (menús, modales, sheets, toasts) | `bg-popover` |
| Fondo de modal / sheet · lightbox de imagen | `bg-black/60 backdrop-blur-xs` · `bg-black/80` |

Bordes: `border` pelado = 1 px color `border` (lo fija el `@layer base` de `index.css`) · `border-input` en controles · `border-2 border-dashed` en vacíos y dropzones · `border-l-4 border-<sem>` en banners con acento · `border-t-2 border-foreground/15` sobre la fila de total. Hairlines de una grilla de totales: `gap-px bg-border` en el contenedor. Sin zebra en tablas.

### 1.4 Radios

| Clase | Valor | Qué |
|---|---|---|
| `rounded-sm` | 4 px | Items de menú y de lista, checkbox, tabs del segmented, chips mínimos. |
| `rounded-md` | 6 px | **Controles**: botones, inputs, selects, triggers. |
| `rounded-lg` | 8 px | **Cards**, tiles de ícono, cards mobile de fila, banners, tooltips de gráfico. |
| `rounded-xl` | 12 px | **Modales**, barra de filtros, vacíos. |
| `rounded-2xl` | 16 px | Solo el borde superior del bottom-sheet (`rounded-t-2xl`) y la confirmación transaccional (`EJEMPLOS.md` §5). |
| `rounded-full` | — | Pills, badges, avatares, dots, switch, contadores. |

Nada de `rounded` pelado, `rounded-none`, `rounded-3xl` ni arbitrarios (el validador los marca). Excepción declarada: el marco del celular de la demo (§4.4).

### 1.5 Sombras

Elevación mínima: la separación la dan el borde y el fondo, no la sombra.

| Clase | Qué |
|---|---|
| `shadow-xs` | Cards, inputs, tab activa del segmented, nav activo. **La base.** (`shadow-sm` de Tailwind 4 es más fuerte: no se usa.) |
| `shadow-md` | **Todo lo que flota sin fondo**: popovers, selects, comboboxes, dropdowns, calendario, tooltip de gráfico; hover de cards clickeables. |
| `shadow-lg` | Toasts y tooltips (solo dentro de `components/ui/`). |
| `shadow-2xl` | Modales y sheets. |
| `shadow-[0_-8px_30px_rgba(0,0,0,0.12)]` | Barra de acción fija al pie (sombra hacia arriba). |

En modo noche las sombras casi no se ven; el borde hace el trabajo (§5).

### 1.6 Densidad y espaciado

Escala implícita: `1 · 1.5 · 2 · 3 · 4 · 5 · 6 · 8`. Preferí `gap` a `space-*` (BASE §1).

| Dónde | Valor |
|---|---|
| Altura de controles | `h-10` (40 px, el mínimo táctil de BASE §6). En toolbars de desktop, `md:h-9`. Botón-ícono en filas de tabla de desktop: `size="icon-sm"` (32 px); en mobile, `size="icon"`. |
| Gutter de página | `p-3 md:p-8` |
| Separación entre bloques de una página | `gap-4` |
| `Card` default · `Card size="sm"` (KPI) · card de fila mobile | 24 px · 16 px · `p-3` |
| Modal (`Dialog`) · formulario largo en bandas | `p-6 gap-5` · header `px-6 py-4`, body `p-6`, footer `p-4` (§3.3) |
| Celdas de tabla · encabezado | `px-4 py-2.5` · `h-10 px-4` |
| Grilla de formulario | `grid grid-cols-1 sm:grid-cols-2 gap-4`; campo ancho `sm:col-span-2` |
| Grillas de gráficos | `gap-4` · KPIs `gap-3` |
| Badges | `px-2 py-0.5` |

**Todo lo que vive en la misma fila mide lo mismo**: inputs, selects, el botón de quitar de una línea. Un `icon-sm` metido en una fila de inputs se ve desalineado y ningún grep lo detecta: se mide (`REDISENO.md` §R.6).

### 1.7 Íconos

Solo `lucide-react` (BASE §8). Tamaño por contexto:

| Tamaño | Contexto |
|---|---|
| `h-4 w-4` | **Default**: botones, inputs, ítems de nav, inline con `text-sm`. |
| `h-3.5 w-3.5` | Con `text-xs`: badges, chips, toolbars, búsqueda. |
| `h-3 w-3` | Con micro-etiquetas, flechas de orden. |
| `h-5 w-5` | Títulos de sección, header mobile (hamburguesa `h-6 w-6`). |
| `h-8 w-8` a `h-16 w-16` | Tiles e íconos de estados vacíos (§3.7). |
| `h-2 w-2` · `h-2.5 w-2.5` | Dots de leyenda y de estado. |

**Tile de ícono**: `h-9 w-9 rounded-lg flex items-center justify-center` + `bg-brand/10` e ícono `text-brand` (acento) o `bg-<sem>/10` e ícono `text-<sem>`. Botón con texto: ícono a la izquierda con `gap-2`, sin `mr-*`.

### 1.8 Foco e interacción

- **Foco, igual en todos los controles** (botón, input, trigger de select, combobox y fecha, tab, checkbox): `focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`. Nunca `ring-primary/40` ni anillos de marca.
- **Trigger abierto** (select, combobox, fecha): `data-[state=open]:border-ring`.
- **Inválido**: `aria-invalid:border-destructive aria-invalid:ring-destructive/20` (el control lleva `aria-invalid`, BASE §6).
- **Hover**: `hover:bg-accent hover:text-accent-foreground` en ghost, outline e ítems; `hover:bg-primary/90` en default; `hover:shadow-md` en cards clickeables. Recordá que en Tailwind 4 `hover:` solo aplica con puntero.
- **Presionado** (cards de fila en mobile): `active:scale-[0.99]`.
- **Deshabilitado**: `disabled:pointer-events-none disabled:opacity-50` (botones) · `disabled:cursor-not-allowed disabled:opacity-50` (campos).
- **Seleccionado**: `primary` (§1.1). Fila de tabla: `data-[state=selected]:bg-muted`. Opción-card elegida: `border-primary/40 bg-primary/5`.

La accesibilidad de teclado de modales, selects, menús y tabs la dan Radix (foco atrapado, Escape, flechas, `aria-*`): no se reimplementa.

### 1.9 Motion

Animaciones de `tw-animate-css` sobre los `data-state` de Radix (BASE §1). Nada de `framer-motion`.

| Qué | Cómo | Duración |
|---|---|---|
| Popover, select, menú, calendario | `fade-in-0 zoom-in-95` (salida `fade-out-0 zoom-out-95`) | 100 ms |
| Tooltip | `fade-in-0` | 150 ms |
| Fondo de modal | `fade-in-0` | 200 ms |
| Panel de modal | `fade-in-0 zoom-in-95` | 200 ms |
| Toast | `slide-in-from-top-2 fade-in-0` | 200 ms |
| Sheet (detalle a la derecha, nav mobile a la izquierda) | `slide-in-from-right` / `slide-in-from-left`, `ease-out` | 300 ms |
| Contenido de tab · banner de error | `fade-in slide-in-from-bottom-2` · `fade-in-0 slide-in-from-top-2` | 200 ms |
| Acordeón (grupos del nav) | `grid transition-[grid-template-rows]` entre `grid-rows-[0fr]` y `grid-rows-[1fr]` | 300 ms |
| Chevron | `transition-transform` + `rotate-180` / `-rotate-90` | 200 ms |
| Recarga silenciosa | `transition-opacity` + `opacity-60` en el contenedor, ícono `animate-spin` | 300 ms |
| Entrada del login | `animate-in fade-in-0` | 500 ms |

**No se anima**: filas de tabla, números (nada de contadores que suben), cambios de layout, el sidebar al navegar. Spinners con `animate-spin`, "en vivo" con `animate-ping`. Todo lo propio respeta `motion-reduce:animate-none`.

---


### 1.10 Utilidades semánticas

Las pantallas de la base usan utilidades en vez de clases que dependen del estilo (BASE §2). En este estilo valen: `micro` = `text-[11px] font-medium uppercase tracking-wider` · `display` = `text-2xl font-bold tracking-tight` · `cifra` = `font-semibold tabular-nums` · `titulo` = `text-sm font-semibold` · `recuadro` = caja `rounded-lg border bg-muted/50 p-3` · `ficha` = tile de ícono/logo `rounded-lg` · `acento` = texto en `brand` · `flotante` = `rounded-xl border bg-popover shadow-2xl` · `barra-superior` / `barra-inferior` = barras fijas con línea y blur · `lista` = filas con línea fina · `panel-marca` = `bg-brand text-brand-foreground`. Valores exactos en `starter/src/index.css` (`@utility`). Una pantalla nueva usa estas utilidades y los componentes; no reescribe sus clases a mano.

## 2. Componentes en este estilo

La API es la de BASE §4; el código, `starter/src/components/ui/<archivo>`. Esto es lo que lo hace "zinc":

| Archivo | Cómo se ve |
|---|---|
| `button.tsx` | `rounded-md text-sm font-medium h-10 px-4 gap-2`, íconos `size-4`. `default` `bg-primary text-primary-foreground shadow-xs hover:bg-primary/90` · `secondary` `bg-secondary hover:bg-secondary/80` · `outline` `border border-input bg-background shadow-xs hover:bg-accent` · `ghost` `hover:bg-accent` · `destructive` `bg-destructive text-destructive-foreground` · `link` `text-primary underline-offset-4`. Sizes: `sm` `h-9 px-3` · `lg` `h-11 px-8` · `icon` `size-10` · `icon-sm` `size-8`. `type="button"` por defecto. Guardando: `disabled` + `<Loader2 className="animate-spin" />` delante del texto. |
| `input.tsx` · `textarea.tsx` · `input-group.tsx` | `h-10 rounded-md border border-input bg-background px-3 py-2 shadow-xs placeholder:text-muted-foreground` (`text-base md:text-sm`). Textarea `min-h-20 field-sizing-content`. Ícono o prefijo adentro del control (búsqueda, `$`): `InputGroup` + `InputGroupAddon`, ícono `size-4 text-muted-foreground`. |
| `field.tsx` · `label.tsx` | `FieldLabel` `text-xs text-muted-foreground` (en rojo si el campo es inválido); requerido con `<span className="text-destructive">*</span>`; `FieldDescription` `text-xs text-muted-foreground`; `FieldError` `text-xs text-destructive`, `role="alert"`; `FieldGroup` `gap-5`; `FieldLegend` como micro-etiqueta. Un `FieldLabel` que envuelve un `Field` con checkbox o radio es la **opción-card**: `rounded-md border p-3`, elegida `border-primary/40 bg-primary/5`. |
| `money-input.tsx` | Igual que `input`, `inputMode="decimal"`, `$` como prefijo `text-muted-foreground` dentro del control, texto `tabular-nums text-right`. |
| `select.tsx` · `combobox.tsx` · `date-picker.tsx` | Trigger idéntico a `input` (`h-10`, `size="sm"` `h-9`) con `ChevronDown` (`ChevronsUpDown` en combobox, `Calendar` a la izquierda en fecha) `size-4 text-muted-foreground`; abierto, `border-ring`. Panel `rounded-md border bg-popover p-1 shadow-md`, `min-w-36`; opción `rounded-sm px-2 py-1.5 text-sm`, con foco `bg-accent`, elegida `font-medium` con `Check` a la derecha; grupos con micro-etiqueta. Combobox: búsqueda `h-10` arriba, vacío `py-6 text-center text-sm text-muted-foreground`. `MultiCombobox`: trigger "3 elegidos"; al pie, "Limpiar". |
| `calendar.tsx` | Semana desde el **lunes**, en castellano. Día elegido `bg-primary text-primary-foreground`; hoy `ring-1 ring-brand/40`; fuera de mes `text-muted-foreground/50`. |
| `checkbox.tsx` · `switch.tsx` · `radio-group.tsx` | Marcado = `primary`. Checkbox `size-4 rounded-sm border-muted-foreground shadow-xs`; radio `size-4 rounded-full`; switch `rounded-full`. Área táctil ampliada con `after:-inset-*`. |
| `card.tsx` | `rounded-lg border bg-card text-sm text-card-foreground shadow-xs`, espaciado interno 24 px (`size="sm"`: 16 px). `CardTitle` `text-base font-semibold tracking-tight`, `CardDescription` `text-sm text-muted-foreground`, `CardAction` arriba a la derecha. |
| `badge.tsx` | `rounded-full border border-transparent px-2.5 py-0.5 text-xs font-semibold`, íconos `size-3`. Para estados, siempre `StatusBadge`. |
| `status-badge.tsx` | `inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap` + `bg-<tono>/10 text-<tono>`; `neutro` `bg-muted text-muted-foreground`; `marca` `bg-brand/10 text-brand`. |
| `kpi.tsx` | `Card size="sm"` (16 px): micro-etiqueta, valor `mt-1.5 text-2xl font-bold tracking-tight`, delta `rounded-full px-2 py-0.5 text-xs font-semibold` con `TrendingUp` / `TrendingDown h-3.5 w-3.5` en `bg-success/10 text-success` o `bg-destructive/10 text-destructive` (al revés si `invertido`), `ayuda` al pie `mt-3 border-t pt-2.5 text-xs text-muted-foreground`. `KpiGrid`: ver §3.4. |
| `page-header.tsx` | `flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3`. Título y descripción (`text-sm text-muted-foreground mt-1`) en `hidden md:block`: en mobile el nombre de la pantalla ya está en el header (§4.2). Acciones siempre visibles. |
| `table.tsx` · `data-table.tsx` | Ver §3.9. |
| `dialog.tsx` · `alert-dialog.tsx` | Ver §3.3 y §3.6. |
| `sheet.tsx` | `bg-popover shadow-2xl`, mismo fondo que el modal. Derecha (detalle): `w-full sm:max-w-md border-l` (más ancho con `className="sm:max-w-xl"`). Izquierda (nav mobile): `w-72 max-w-[85vw] border-r`. Abajo: `max-h-[85dvh] rounded-t-2xl`. `SheetHeader` `border-b p-4 sm:px-6`, título `text-lg font-bold tracking-tight`; `SheetFooter` `border-t p-4 sm:px-6`, botones apilados en mobile. Cerrar: `ghost icon-sm` arriba a la derecha. |
| `popover.tsx` · `dropdown-menu.tsx` · `command.tsx` | `rounded-md border bg-popover shadow-md` (menú `p-1 min-w-40`; popover `w-72 p-4`); ítems `rounded-sm px-2 py-1.5 text-sm`, íconos `size-4 text-muted-foreground`, foco `bg-accent`; grupo con micro-etiqueta; separador `-mx-1 my-1 h-px bg-border`; atajo `ml-auto text-xs tracking-widest text-muted-foreground`; ítem destructivo `text-destructive`, foco `bg-destructive/10`. |
| `tabs.tsx` | Dos variantes de lista. **`default`** (segmented, para cambiar de vista dentro de una pantalla): `rounded-md bg-muted p-1`, tab `rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground`, activa `bg-background text-foreground shadow-xs`. **`line`** (secciones de un dashboard, §3.8): tab `px-4`, activa `text-brand` con subrayado `h-0.5 rounded-full bg-brand`. Contenido con `fade-in slide-in-from-bottom-2`. |
| `tooltip.tsx` | `rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-lg` con flecha, delay 100 ms. Va en todo botón-ícono, además del `aria-label`. |
| `sonner.tsx` | Arriba a la derecha, `z-toast`, `rounded-lg shadow-lg text-sm`. Neutro sobre `popover`; los semánticos con tinte al 10 % del color, borde al 30 % y texto del color, ícono `size-4` (`CircleCheck`, `OctagonX`, `TriangleAlert`, `Info`). Sigue el tema (`useTema`). |
| `estados.tsx` | Ver §3.7. |
| `skeleton.tsx` · `progress.tsx` · `avatar.tsx` | Skeleton `animate-pulse rounded-md bg-muted motion-reduce:animate-none`. Progreso `h-2 rounded-full bg-muted` con relleno `bg-primary`. Avatar `size-9` (`sm` 28 px, `lg` 44 px), fallback `bg-brand/10 text-brand text-sm font-semibold` con la inicial; indicador de presencia `bg-success`. |

---

## 3. Recetas en este estilo

Qué lleva cada receta está en BASE §6. Acá, cómo se ve.

### 3.1 Listado

Muestra: `base/starter/src/pages/Pedidos.tsx`.

- Página: `flex flex-col gap-4`.
- `PageHeader` con la acción principal en `acciones` (`Button` default, `Plus`).
- **Toolbar** `flex flex-wrap items-center gap-2 lg:justify-end` (o a la derecha del título, dentro de `acciones`):
  - Búsqueda `relative flex-1 sm:w-56 sm:flex-none min-w-28`, input `pl-8 md:h-9`.
  - Filtros `flex-1 sm:flex-none sm:w-40`. Para que dos filtros queden en dos columnas en mobile y en línea en desktop con el mismo markup: envolverlos en `grid grid-cols-2 gap-2 md:contents`.
  - Botones secundarios que en mobile quedan solo con ícono: label en `<span className="hidden sm:inline">`, botón `px-3 gap-1.5 md:h-9`, con `aria-label`.
  - Más de tres filtros, o filtros de un dashboard: barra colapsable (§3.8).
- `DataTable` (§3.9) con `tarjeta` para mobile y `vacio` con `Vacio` (ícono de la entidad, "No hay pedidos todavía", acción "Nuevo pedido").
- Estados: `Cargando` en la carga inicial; `ErrorEstado` con `onReintentar`; en recargas por filtro, `opacity-60` sin desmontar.

### 3.2 Detalle

Muestra: `base/starter/src/pages/PedidoDetalle.tsx`. **`Sheet` a la derecha** (`sm:max-w-md`; `sm:max-w-xl` si el detalle tiene tablas; a todo el ancho en mobile).

- `SheetHeader` (`border-b p-4 sm:px-6`): fila `flex items-start gap-3` con tile de ícono `bg-brand/10` (§1.7), título `text-lg font-bold tracking-tight` + `SheetDescription` (código, fecha) y `StatusBadge`. El cerrar lo pone el `Sheet`.
- Cuerpo `flex-1 overflow-y-auto p-4 sm:px-6 flex flex-col gap-6`. Cada sección: micro-etiqueta como título y pares clave-valor en `grid grid-cols-[auto_1fr] gap-x-6 gap-y-2` (clave `text-xs text-muted-foreground`, valor `text-sm text-right`; montos `tabular-nums`). Listas de ítems: tabla compacta dentro de `rounded-md border` o cards `p-3` en mobile.
- `SheetFooter`: acciones de la entidad, apiladas en mobile (la principal arriba) y en fila desde `sm` (la principal a la derecha).
- Entidades con movimientos (cuentas corrientes, caja, stock): son dos pantallas, no un sheet. Ver `EJEMPLOS.md` §1.

### 3.3 Formulario

Muestra: `base/starter/src/pages/NuevoPedido.tsx`. **`Dialog`**; si tiene más de ~10 campos o secciones, página con la misma estructura dentro de una card y barra de acción fija al pie.

| Parte | Clases |
|---|---|
| Fondo | `bg-black/60 backdrop-blur-xs` (lo pone `DialogOverlay`) |
| Panel | `rounded-xl border bg-popover p-6 gap-5 shadow-2xl max-h-[calc(100dvh-2rem)]` (lo pone `DialogContent`) |
| Ancho | `sm:max-w-md` confirmación · `sm:max-w-lg` formulario simple (default) · `sm:max-w-2xl` formulario extenso · `sm:max-w-4xl` dos columnas · `sm:max-w-6xl` tabla de drill-down |
| `DialogHeader` | título `text-lg font-bold tracking-tight`, `DialogDescription` `text-sm text-muted-foreground`; cerrar `ghost icon-sm` arriba a la derecha |
| Cuerpo | `FieldGroup` (en `grid grid-cols-1 sm:grid-cols-2 gap-4` si los campos son cortos) |
| `DialogFooter` | `flex flex-col-reverse gap-2 sm:flex-row sm:justify-end`: en mobile apilados a lo ancho con la acción principal arriba; desde `sm`, en fila a la derecha. Cancelar `outline`, confirmar `default` |

**Formulario largo (más de una pantalla de alto): en bandas.** Header y footer quedan fijos y scrollea solo el medio. Se escribe con un **`DialogBody`** entre el header y el pie: el `dialog.tsx` del kit ve el cuerpo y pasa solo a bandas (header `border-b bg-secondary/20 px-6 py-4`, cuerpo `p-6` con scroll, pie `border-t bg-muted/20 p-4`). La pantalla pone solo el ancho (`DialogContent className="sm:max-w-2xl"`); el esqueleto completo, en `RECETAS.md` §4.1.

En mobile **no es pantalla completa**: card centrada con 1 rem de margen a cada lado (`max-w-[calc(100%-2rem)]`), y lo que no entra scrollea. (El que ocupa todo el ancho en mobile es el `Sheet` del detalle.)

Piezas del formulario:

| Pieza | Cómo |
|---|---|
| Sección dentro del body | título `text-sm font-semibold flex items-center gap-2` con ícono `h-4 w-4` |
| Caja de agrupación | `flex flex-col gap-3 rounded-lg border border-border/50 bg-secondary/20 p-4` (variante `border-dashed bg-muted/20 p-3`) |
| Error de formulario (arriba o al pie) | `rounded-r-md border-l-4 border-destructive bg-destructive/10 p-3 text-sm font-medium text-destructive flex items-center gap-2`, `role="alert"` |
| **Por qué no se puede guardar** | Si el submit está deshabilitado, la razón al lado del botón, una sola: `text-xs text-warning sm:mr-auto` con `AlertCircle h-3.5 w-3.5`. Un botón gris sin motivo no vale. |
| Opción-card (elegir uno, con descripción) | `RadioGroup` con cada opción en un `FieldLabel` que envuelve un `Field` (§2): `rounded-md border p-3`, elegida `border-primary/40 bg-primary/5`, hover `bg-muted/50`. |
| Pill seleccionable (chips de tipo) | `h-8 rounded-md border px-3 text-xs font-medium`; activa `bg-primary text-primary-foreground border-primary` |
| Contraseña | `InputGroup` con un `InputGroupButton` al final (`Eye` / `EyeOff`, `aria-label="Mostrar contraseña"`) |
| Cantidad (+/−) | dos `Button outline size="icon"` + `Input type="number" inputMode="numeric"` `w-16 text-center` sin flechas (`[appearance:textfield]`); deshabilitar en los límites. Montos, nunca: `MoneyInput`. |
| Calculado / solo lectura | `h-10 flex items-center rounded-md border border-input bg-muted/30 px-3 text-sm tabular-nums` |
| Bloqueado por rol | `h-10 flex items-center rounded-md border border-input bg-muted px-3 text-sm font-medium text-muted-foreground` |
| Subir archivo | dropzone `h-24 flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-input bg-muted/10 hover:border-primary/40 hover:bg-primary/5` con `Upload h-5 w-5 text-muted-foreground/50` y "Arrastrá o hacé click"; con archivo, fila `rounded-lg border bg-muted/20 p-2.5` con miniatura `h-12 w-12 rounded-md object-cover` |
| Total del formulario | fila `border-t-2 border-foreground/15 bg-muted/40 px-6 py-4`, monto `text-lg font-bold font-mono tabular-nums text-brand` |

### 3.4 Inicio / dashboard

Muestra: `base/starter/src/pages/Inicio.tsx`. Tableros y gráficos: las skills **`business-intelligence`** (qué se mide y cómo se calcula) y **`dataviz`** (cómo se dibuja), siempre y en ese orden (BASE §10), y después **`DATAVIZ.md`**.

- Contenedor `flex flex-col gap-4 pb-8`; recarga silenciosa `transition-opacity` + `opacity-60`.
- `PageHeader` (título + período como badge `rounded-full bg-brand/10 px-2.5 py-0.5 text-[11px] font-semibold text-brand` con `CalendarRange h-3.5 w-3.5`) y, en `acciones`, refrescar (`outline icon`, `RefreshCw` que gira mientras carga).
- **`KpiGrid`**: 4 KPIs es el default → `grid grid-cols-2 lg:grid-cols-4 gap-3`. Las otras cantidades las resuelve el componente: **3** → `grid-cols-1 sm:grid-cols-3` (en 2 columnas uno quedaría huérfano) · **5** → `grid-cols-2 lg:grid-cols-5`, el último ocupa dos columnas en mobile · **6** → `grid-cols-2 md:grid-cols-3 xl:grid-cols-6`. Más de 6 no: es otro dashboard.
- Gráficos en cards (`DATAVIZ.md` §2): grande + chico `grid grid-cols-1 lg:grid-cols-3 gap-4` (el grande `lg:col-span-2`); dos iguales `grid grid-cols-1 lg:grid-cols-2 gap-4`.
- **Lo de hoy**: card con lista accionable (filas `flex items-center gap-3 border-b py-3 last:border-0`, `StatusBadge`, acción `ghost sm`), vacío con `Vacio` ("Nada pendiente para hoy").
- Pie opcional `text-xs text-muted-foreground/70`: período y cantidad de registros leídos.

### 3.5 Login

Muestra: `base/starter/src/pages/Login.tsx`. Contenedor `min-h-dvh flex bg-background animate-in fade-in-0 duration-500`.

- **Panel de marca** (solo `md+`): `hidden md:flex md:w-1/2 lg:w-3/5 flex-col justify-between p-12 bg-brand text-brand-foreground`. Logo arriba (`h-10`), título `text-4xl lg:text-5xl font-bold tracking-tight` y una línea `text-sm opacity-80 border-l-2 border-brand-foreground/30 pl-4`, pie `text-xs uppercase tracking-wider opacity-60`. Si hay foto, va como fondo `opacity-30 mix-blend-luminosity`: el texto sigue en `text-brand-foreground`.
- **Formulario**: `flex-1 flex items-center justify-center p-6`, ancho `w-full max-w-sm`. En mobile, isotipo `h-12 w-12 mb-6` arriba. Título `text-3xl font-bold tracking-tight`, bajada `text-sm text-muted-foreground mb-6`. Campos `h-11`; contraseña con mostrar / ocultar (§3.3). Botón `w-full h-11` con `ArrowRight` (o spinner). Debajo, versión `text-xs text-muted-foreground/70 text-center`.
- Error: banner de §3.3 con un texto que **no revela si el usuario existe** ("El email o la contraseña no coinciden"). Bloqueo por intentos y recuperar contraseña: `EJEMPLOS.md` §8.

### 3.6 Confirmaciones

`useConfirm()` (BASE §4) sobre `alert-dialog`. Panel `rounded-xl border bg-popover p-6 shadow-2xl sm:max-w-md`:

- Ícono en círculo (`AlertDialogMedia`, `size-10 rounded-full`): con `peligro`, `bg-destructive/10 text-destructive` y `Trash2` o `AlertTriangle`; si no, `bg-muted text-muted-foreground`. En mobile, ícono, título y descripción centrados; desde `sm`, alineados a la izquierda con el ícono al costado.
- Título `text-lg font-bold tracking-tight`, descripción `text-sm text-muted-foreground` que dice qué se pierde ("Se borra el pedido #1042 y sus pagos. No se puede deshacer.").
- Pie como el del `Dialog`: apilados en mobile (la acción arriba), en fila a la derecha desde `sm`. Cancelar `outline`; confirmar `destructive` con `peligro`, si no `default`. Mientras confirma, los dos deshabilitados y spinner en el de confirmar.
- Texto del botón = el verbo de la acción ("Borrar pedido"), nunca "Aceptar".

### 3.7 Feedback y estados

| Caso | Cómo se ve |
|---|---|
| Resultado de una acción | `toast.success` / `toast.error` (sonner, §2). Texto en pasado y concreto: "Pedido guardado". |
| Error de un campo | `FieldError` (§2) + `aria-invalid` en el control. |
| Error del formulario | Banner con acento (§3.3). |
| Aviso en una pantalla | Banner suave (§1.1) `warning` / `info`; con progreso, `border-l-4` y contador `text-xs font-semibold` a la derecha. |
| `Cargando` | Centrado `py-20`: `Loader2 h-6 w-6 animate-spin text-muted-foreground` + texto `mt-3 text-sm text-muted-foreground`. Para bloques chicos dentro de una página ya pintada, `Skeleton`. |
| `Vacio` | `flex flex-col items-center justify-center rounded-xl border-2 border-dashed bg-muted/5 p-12 text-center`: círculo `h-16 w-16 rounded-full bg-muted` con ícono `h-8 w-8 text-muted-foreground/40`, título `text-sm font-medium`, descripción `text-sm text-muted-foreground`, acción opcional (`outline`). Dentro de una card o tabla, la versión compacta: sin borde, `py-12`. |
| `ErrorEstado` | Centrado `py-16`: círculo `h-12 w-12 rounded-full bg-destructive/10` con `AlertCircle h-6 w-6 text-destructive`, título `text-sm font-semibold`, descripción `text-sm text-muted-foreground`, botón "Reintentar" `outline` con `RotateCw`. |
| Guardando algo largo | Overlay sobre el panel (`absolute inset-0 flex items-center justify-center bg-background/85 backdrop-blur-xs`) con `Cargando`. |
| Confirmación transaccional que se queda en pantalla (POS, caja) | `EJEMPLOS.md` §5. |

### 3.8 Filtros

**Un filtro no es un modal.** Tres casos:

| Caso | Cómo |
|---|---|
| Una sola dimensión, en la toolbar de una tabla | `MultiCombobox` en la toolbar (§3.1). |
| Elegir un valor de una lista larga | `Combobox`. |
| Varias dimensiones a la vez (dashboards, vistas ricas) | **Barra colapsable**, abajo. |
| Pocos estados (≤ 8) de una grilla operativa, donde **la cantidad por estado es información** | **Chips de estado**, abajo. |

Barra colapsable (componentes `BotonFiltros`, `BarraFiltros` y `CampoFiltro` de `filtros.tsx`, BASE §4; las clases de abajo ya están adentro):

- **Botón** (a la derecha del `PageHeader` o de la barra de tabs): `outline` con `SlidersHorizontal` "Filtros" y chevron; abierto o con filtros activos, `border-brand/30 bg-brand/5 text-brand`; contador `rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-brand-foreground`.
- **Barra** (inline, debajo del header, no flota): `rounded-xl border bg-muted/20 p-3`, fila `flex flex-wrap items-end gap-3`.
- **Cada campo**: label micro-etiqueta con ícono `h-3.5 w-3.5 text-brand`; ancho `w-full sm:w-44` (en mobile se apilan solos). Rango de fechas primero (`DateRangePicker`), después los `MultiCombobox`.
- **Limpiar** (si hay alguno activo): `ghost` `text-xs` con `X`, resetea todo de una vez.
- El estado vive en un contexto o en la URL; la vista solo lee los filtros. La barra la muestra o esconde la vista (`useState`), no se auto-oculta.

Chips de estado (selección múltiple; sin ninguno, se ve todo):

- Fila `flex flex-wrap items-center gap-2`. Primero **"Todos"** con el total; después un chip por estado, en el orden del circuito; al final "Limpiar" (`ghost` `text-xs` con `X`) si hay alguno activo.
- **Chip**: `inline-flex h-8 items-center gap-1.5 rounded-full border bg-card pl-2.5 pr-2 text-xs font-medium hover:bg-accent`, con `aria-pressed`. Adentro: punto `size-2 rounded-full` con el color del tono del estado (`PUNTO_TONO[tono]` de `status-badge.tsx`, el mismo de `lib/estados.ts`), el nombre y el contador `rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground` (al 60 % si es 0).
- **Elegido**: `border-primary bg-primary text-primary-foreground`, contador `bg-primary-foreground/20` (la selección es `primary`, §1.1).
- Un filtro que no es un estado (p. ej. "Urgencias") va al final con su ícono en el color semántico.
- **Mobile**: los chips quedan detrás de un botón `outline` "Filtrar" con el contador de activos (`bg-primary` chico) y se despliegan abajo.

**Tabs de un dashboard** (navegar entre secciones, no filtrar): `Tabs` con `TabsList variant="line"` (§2) sobre un `border-b`, con scroll horizontal en mobile (`overflow-x-auto no-scrollbar`). La activa va en `text-brand` con subrayado de marca.

### 3.9 Tablas

`DataTable` resuelve tabla en desktop y tarjetas en mobile sobre el mismo array (BASE §4).

| Parte | Cómo se ve |
|---|---|
| Contenedor (`md+`) | `rounded-lg border bg-card shadow-xs overflow-hidden` |
| Encabezado | `h-10 px-4 text-left whitespace-nowrap` micro-etiqueta (§1.2); ordenable con `ArrowUpDown h-3 w-3 opacity-40` (activo `ArrowUp` / `ArrowDown` sin opacidad) |
| Fila | `border-b last:border-0 hover:bg-muted/50`, clickeable `cursor-pointer`; seleccionada o expandida `bg-muted`. Sin zebra. |
| Celda | `px-4 py-2.5 align-middle text-[13px]`; dos líneas: valor `font-medium` + metadato `text-[10px] text-muted-foreground` |
| Número / monto | `text-right tabular-nums` (`alinear: "der"`); destacado `font-semibold`; con signo `text-success` / `text-destructive` |
| Diferencia como chip | `rounded-full px-2 py-0.5 text-xs font-semibold`: negativo `bg-destructive/10 text-destructive`, positivo `bg-success/10 text-success`, cero `bg-muted text-muted-foreground` |
| Columnas secundarias | `ocultarEn: "lg"` (o `"md"`); cuanto menos importa, más tarde aparece. En mobile, ese dato va como subtítulo de la tarjeta. |
| Acciones de fila | última columna `text-right`, `flex justify-end gap-1`, botones `ghost icon-sm` `text-muted-foreground` (borrar: `hover:text-destructive hover:bg-destructive/10`), cada uno con `aria-label` y tooltip; `stopPropagation` si la fila navega |
| Tarjeta mobile | `rounded-lg border bg-card p-3 shadow-xs active:scale-[0.99]`: arriba `flex items-start justify-between gap-2` (identidad + `StatusBadge`), abajo `mt-2 pt-2 border-t` con métricas `tabular-nums` |
| Paginación | `flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground`: "Página 2 de 7" + `outline icon-sm` con `ChevronLeft` / `ChevronRight`; `porPagina` 30 |
| Subgrupo | fila `colSpan` `bg-muted/50` con micro-etiqueta; respeta el orden de primera aparición |
| Fila expandible | chevron en la primera celda; el detalle en una fila `colSpan` `p-0` con `bg-muted/10 p-4` |
| Totales | `TableFooter` (`border-t-2 bg-muted/40 font-semibold`) para una fila de totales por columna; o una barra debajo de la tabla `grid grid-cols-2 sm:grid-cols-4 gap-px border-t bg-border`, cada celda `bg-muted/30 px-4 py-2.5` con micro-etiqueta y valor `text-sm font-bold tabular-nums` |
| Selección masiva | checkbox en el encabezado y por fila; barra de acción fija al pie (§4.3) con "N elegidos" y la acción (`destructive` si borra) |
| Grilla densa con scroll en todos los tamaños (planillas) | `<th>` `sticky top-0 z-nav bg-muted/60 backdrop-blur-sm px-3 py-2.5` micro-etiqueta; sin tarjetas mobile; montos `font-mono` |

---

## 4. Layout

Implementación: `starter/src/components/layout/app-shell.tsx` (API en BASE §4). Breakpoints y mobile: BASE §6.

### 4.1 Sidebar (desktop, `md+`)

Implementación: `app-shell.tsx`. Usa **solo tokens `sidebar-*`** (también para el texto secundario), así funciona igual con la sidebar clara del estilo o con una de color (rediseño, BASE §9.1).

- `hidden md:flex flex-col w-60 border-r border-sidebar-border bg-sidebar text-sidebar-foreground z-nav`; colapsado `w-16` (solo íconos, tooltip con el nombre), `transition-[width] duration-300`; el estado se recuerda en `localStorage`.
- Arriba, `h-14 px-4 flex items-center border-b border-sidebar-border` con la marca y el botón de colapsar (`ghost icon-sm`, `PanelLeftClose`). Colapsado: arriba `marcaCompacta` (el isotipo); al pie, el botón de expandir y `usuarioCompacto`. Si la app maneja sucursales o empresas, debajo de la marca un `Combobox` para elegirla (texto fijo si el rol no puede cambiar).
- Grupos (`ItemNav.grupo`): título `px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/70`; colapsado, una línea divisoria.
- **Ítem**: `relative flex h-9 items-center gap-3 rounded-md px-3 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground`; **activo `bg-sidebar-accent font-medium text-sidebar-foreground`** (y `aria-current="page"`). Ícono `size-4`. Contador (`badge`): `ml-auto min-w-5 h-5 rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground` (colapsado: `absolute -top-1 -right-1 ring-2 ring-sidebar`; más de 99, "99+").
- Pie `border-t border-sidebar-border p-3`: `usuario` = menú del usuario (avatar + nombre `text-sm font-medium` + rol `text-xs text-sidebar-foreground/70`), con "Cerrar sesión" adentro.

### 4.2 Header

- **Desktop** (si hay `ubicacion` o `acciones`): `z-nav hidden md:flex h-14 items-center justify-between gap-4 border-b bg-background px-6`. A la izquierda, `ubicacion`: el nombre de la pantalla (`text-sm font-semibold`) y, si la app la tiene, su ayuda; las apps cuyas pantallas traen `PageHeader` no la pasan. A la derecha, `acciones`: menú Demo si corresponde, botón del celular (§4.4), selector de tema (§5).
- **Mobile**: `md:hidden z-header h-14 flex items-center gap-2 border-b bg-background px-3`. Hamburguesa (`ghost icon`, `Menu`, `aria-label="Abrir menú"`) + `ubicacion` si viene (nombre de la pantalla `truncate text-lg font-bold`) o la marca; a la derecha, `acciones`. La hamburguesa abre el nav en un `Sheet` izquierdo con el mismo contenido del sidebar, en sus tokens.
- **Avisos** (`avisos`): banners de toda la app (sesión por vencer, permisos), a lo ancho entre el header y el contenido: `border-b px-4 md:px-6 py-2 text-xs` con el patrón de banner semántico (§1.1).
- **Contenido**: `<main>` con scroll propio, `bg-secondary/30`; adentro `mx-auto max-w-7xl px-4 py-5 md:px-8 md:py-8` (`relleno={false}` lo saca: vistas que traen su padding, BASE §9.3). No hay barra de navegación inferior.

### 4.3 Mobile

Se diseña para 390 px (BASE §6). Además de lo de cada receta:

- Alturas con `dvh`: vista a pantalla completa `h-[calc(100dvh-4rem)]`.
- **Barra de acción fija** (formularios largos, selección masiva): `sticky bottom-0 z-nav border-t bg-background/95 backdrop-blur-sm p-3 md:p-4 shadow-[0_-8px_30px_rgba(0,0,0,0.12)]`, contenido `flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3`. Con `pb-[env(safe-area-inset-bottom)]` si la app es PWA.
- **Bottom-sheet** que en desktop es panel lateral (carrito, selección acumulable): `EJEMPLOS.md` §4.
- Tamaños de texto fijos: no se agranda el cuerpo en desktop. Lo que crece es el gutter (`p-3 md:p-8`).

### 4.4 Celular lateral (portal en la demo)

`AppShell.lateral`, implementado en `src/demo/` (KIT-DEMO §5). En este estilo: columna `xl:flex w-[420px] border-l bg-secondary/30` con el celular centrado; marco `rounded-[42px] border-[9px] border-foreground bg-background shadow-2xl`, alto `max-h-[780px]`, ancho `max-w-[370px]`. Debajo de `xl` el celular flota a la derecha como un `Sheet`. El botón que lo abre (`Smartphone`) va en el header y queda `default` mientras está abierto. El radio del marco es la única excepción declarada a §1.4 (`sumar-validar-ignorar: rounded-pelado marco del celular`).

---

## 5. Modo noche

Los tokens de noche están en el bloque `.dark` de `src/index.css`; `useTema()` (BASE §4) pone la clase en `<html>`. **Las pantallas no cambian**: todo sale de los tokens.

| Qué | Día | Noche |
|---|---|---|
| Lienzo · card · popover | blanco | zinc casi negro; card y popover un paso más claros que el lienzo |
| Texto · secundario | casi negro · zinc 500 | casi blanco · zinc 400 |
| `primary` | negro con texto blanco | **se invierte**: casi blanco con texto casi negro (sigue siendo "el que decide") |
| Bordes | zinc 200 | zinc 800 |
| Semánticos | tonos 700 | tonos 400 (los 700 no contrastan sobre negro) |
| `brand` | el del cliente | el mismo matiz, **aclarado y apagado** (saturación ~30–40 %): un tono claro saturado pasa el contraste pero encandila (BASE §3; `contraste.mjs` lo avisa). `MARCA` (emails, PDF) sigue siendo el de día. |
| `panel-marca` (login) | la marca | un tinte oscuro de la marca (`color-mix` 22 % sobre el lienzo) con texto claro: nunca un bloque claro |
| Avisos y estados | `bg-<sem>/10 text-<sem>` | los mismos tokens, de noche solos. Pasos crudos de paleta (`bg-amber-50`) no: quedan crema sobre negro |
| `chart-*` | pasos de día | pasos más claros, validados contra la card de noche (`DATAVIZ.md` §3) |
| Sombras | `shadow-xs` / `md` / `2xl` | casi invisibles; el borde separa. No se compensa con sombras más fuertes. |
| Fondo de modal | `bg-black/60` | igual |

Reglas:

1. **Cero `dark:` en pantallas y componentes de dominio.** Si algo se ve mal de noche, falta o está mal un token. Única excepción: logos e imágenes (`dark:invert` en un logo negro).
2. **Nada que no sea token** (BASE §8): `bg-white` o un hex se quedan blancos de noche. El validador lo marca.
3. **El selector de tema** es `SelectorTema` (`src/components/layout/selector-tema.tsx`, BASE §4), en las `acciones` del `AppShell`: Claro / Oscuro / Según el sistema, con el ícono actual. Default: Sistema.
4. **Revisión visual de las dos caras** (`REDISENO.md` §R.6): cada pantalla se mira de día y de noche, con capturas. "Pasa el contraste" no alcanza: de noche se mira además que nada encandile (botones rellenos, tabs, avisos).
5. Los gráficos leen `var(--color-chart-N)`: cambian solos. Un hex en un gráfico es un bug de noche.

---

## 6. Reglas de oro del estilo

Se suman a las comunes (BASE §8). Las que dicen "validador" las chequea `validador/validar.mjs`; el resto se revisa con la checklist de `REDISENO.md` §R.6.

1. **Inter es la única fuente.** Validador: `fuente`.
2. **Cuerpo `text-sm`, tablas `text-[13px]`, micro-etiquetas (`micro`: `text-[11px] font-medium uppercase tracking-wider`), nada por debajo de `text-[10px]`, sin pesos livianos** (§1.2). Validador: `cuerpo-text-base`, `font-light`.
3. **Cards `rounded-lg border bg-card shadow-xs`.** `shadow-sm` nunca; `shadow-lg` / `xl` solo dentro de `components/ui/` (§1.5). Validador: `sombra-base`, `sombras-pesadas`.
4. **Radios por la tabla de §1.4.** Validador: `rounded-pelado`.
5. **`primary` es el único color de acción y de selección.** La marca nunca va en un `Button` ni en un estado (§1.1). Revisión: `grep -rn "bg-brand" src --include=*.tsx` solo devuelve los lugares de la tabla de marca.
6. **La marca vive en `--brand` y `MARCA`, con el mismo hex**, y se usa con opacidad (`bg-brand/10`), nunca como `bg-(--brand)`. Validador: chequeo de marca y `hex`.
7. **Semánticos solo con los tokens `success` · `warning` · `info` · `destructive`**; nada de `emerald-*`, `amber-*`, `red-*`, `blue-*` en pantallas (§1.1). Revisión: `grep -rnE "(emerald|amber|red|blue|sky|indigo|violet)-[0-9]" src/pages src/components`.
8. **Estados con `StatusBadge` y tonos mapeados en `src/lib/estados.ts`** (§1.1). Un `<span>` de estado armado a mano es un error.
9. **Montos: `MoneyInput` para cargar, `dinero()` para mostrar, `tabular-nums` en columnas y totales.** Validador: `numero-montos`.
10. **Toda colección se muestra con `DataTable`** y su `tarjeta` para mobile (§3.9). Código: `components/ui/data-table.tsx`.
11. **Modales con header / body / footer de §3.3**, footer `flex-col sm:flex-row`, nunca a pantalla completa en mobile. Código: `components/ui/dialog.tsx`.
12. **Lo que flota sin fondo lleva `shadow-md`; modales y sheets, `shadow-2xl`** (§1.5). Código: `popover.tsx`, `select.tsx`, `combobox.tsx`, `dialog.tsx`, `sheet.tsx`.
13. **Foco con el token `ring` en todos los controles**, igual en todos (§1.8). Revisión: `grep -rn "ring-primary/" src` vacío.
14. **Los filtros no son modales** (§3.8).
15. **Controles de una misma fila miden lo mismo** (§1.6). Revisión visual con el script de `REDISENO.md` §R.6.
16. **Dashboards y gráficos pasan por `DATAVIZ.md`**: forma antes que color, colores con `var(--color-chart-N)`, paleta validada.
17. **Cero `dark:` fuera de logos e imágenes** (§5). Revisión: `grep -rn "dark:" src/pages src/components --include=*.tsx`.
18. **Toda pantalla se revisa en 1440 y 390, de día y de noche**, antes de darla por terminada (`REDISENO.md` §R.6).
