<!-- sumar:estilo=01-minimal-zinc version=2.0.0 -->
# Estilo 1 · Minimalista zinc — Rediseño de una app existente

Cómo llevar una app que ya existe (otro diseño, otro kit, o una app generada con AI Studio / v0 / Lovable) al Estilo 1, **sin cambiar su lógica de negocio**. Lo usa el skill `/rediseno`; también sirve a mano.

Se lee entero antes de tocar código. Después, de `DESIGN.md`, solo la sección que pida cada capa. Lo común a todos los estilos (stack, tabla Tailwind 3 → 4, API de componentes) está en `base/BASE.md`.

## Principios

1. **Se rediseña la estética, no la lógica.** Las reglas de negocio, el store, las APIs y las rutas no se tocan. Los componentes que funcionan se **reconfiguran** para que se vean como el estilo; no se reescriben por gusto.
2. **El estilo manda en cómo se ve y se compone** (tokens, tipografía, superficies, radios, sombras, densidad, recetas, reglas de oro de `DESIGN.md` §6). La API de componentes es la de BASE §4: si el repo tiene otra, se mapea en la tabla de equivalencias (§R.3).
3. **Por capas, de mayor a menor impacto** (§R.2). Cada commit cierra una capa, un componente o una vista entera; nunca "un poco de todo".
4. **Verificable.** Una vista está terminada cuando el validador da cero 🔴 en sus archivos y cumple la checklist de §R.6. "Se ve parecido" no es un criterio.

**El caso típico: app generada con AI Studio / v0 / Lovable.** Tiene Tailwind por CDN o sin configurar, cero tokens (colores clase por clase: `bg-gray-100`, `bg-blue-600`, hex), otra fuente y todos los componentes inline, sin `components/ui/`. Por eso "tirarle el DESIGN.md" no alcanza: no hay tokens que ajustar ni componentes que reconfigurar, y el agente termina retocando clases sueltas. La solución es hacer en el rediseño lo mismo que en un proyecto nuevo: instalar Tailwind 4 bien → capa 0 (tokens del starter) → copiar `components/ui/` del starter **entero** → shell → cada vista a su receta **reemplazando el JSX inline por componentes del kit**, no ajustando sus clases. Es más trabajo que cambiar tokens, pero es el único camino que da el mismo resultado que hacerla de cero.

---

## R.1 Qué cambia la cara

El 70–80 % del look no vive en los componentes sino en cinco decisiones globales. Aplicadas sin tocar un solo componente, la app ya cambia:

| # | Decisión | Qué se ve | Dónde |
|---|---|---|---|
| 1 | **Inter** como única fuente, `antialiased`, cuerpo `text-sm` | Densidad y textura de toda la app | `DESIGN.md` §1.2 |
| 2 | **Neutros zinc + `primary` negro + `--brand` como único acento**, día y noche | Blanco y negro por defecto, marca solo donde importa | `DESIGN.md` §1.1, §5 · `starter/src/index.css` |
| 3 | **Superficies**: lienzo → área `secondary/30` → card blanca `shadow-xs` → `muted/20` | Cards planas con borde de 1 px, sin sombras pesadas ni fondos grises grandes | `DESIGN.md` §1.3 |
| 4 | **Radios y sombras**: `md` controles · `lg` cards · `xl` modales · `shadow-xs` base · `shadow-2xl` solo modales | Esquinas consistentes, elevación mínima | `DESIGN.md` §1.4, §1.5 |
| 5 | **Micro-tipografía**: encabezados de tabla y labels `text-[11px] uppercase tracking-wider text-muted-foreground`, números `tabular-nums` | Lo que distingue una tabla del estudio de una tabla default | `DESIGN.md` §1.2, §3.9 |

## R.2 Capas

| Capa | Qué incluye | Impacto | Costo | Cuándo parar |
|---|---|---|---|---|
| **0 · Tokens** | `src/index.css` del starter (tokens día y noche, capas `z-*`, `@layer base`, radios, fuente, scrollbar), `src/lib/marca.ts` con el hex del cliente, `src/lib/tema.ts` + script de `index.html` | **Alto**: toda la app cambia a la vez | 1 commit, sin tocar vistas | Nunca: es el mínimo |
| **1 · Componentes** | `src/components/ui/` con las clases del estilo + `src/lib/{utils,formato,estados,dataviz}.ts` | Alto | 1 commit por componente (o uno para la copia entera) | Cuando button, input, card, badge, table, select y dialog coinciden con el starter |
| **2 · Shell** | `AppShell`: sidebar, header, nav mobile, selector de tema (`DESIGN.md` §4) | Alto | 1 commit | — |
| **3 · Vistas** | Cada pantalla llevada a su receta (`DESIGN.md` §3) | Medio por vista, alto acumulado | 1 commit (o PR) por vista | Cuando todas pasan §R.6 |
| **Dashboards** | `DATAVIZ.md` entero | Alto donde están | 1 PR por dashboard | — |

Si el pedido es "pasá la app al estilo" sin más precisión: capas 0 → 1 → 2, y después las vistas por orden de uso.

## R.3 Inventario y tabla de equivalencias

Antes de tocar código, relevá el repo. La tabla resultante **va al `AGENTS.md` del repo** (§R.8): es lo que deja a cualquier agente traducir sin adivinar.

**Inventario** (10 minutos):

| Dato | Cómo se encuentra | Qué anotar |
|---|---|---|
| Framework | `package.json` | Vite + React Router · Next.js App Router · otro |
| Tailwind | `@import "tailwindcss"` + `@theme` → **v4** · `tailwind.config.*` o `@tailwind base` → **v3** · `<script src="https://cdn.tailwindcss.com">` → **CDN** | v4 · v3 (migrar con `npx @tailwindcss/upgrade`, BASE §1) · CDN (instalar `@tailwindcss/vite` antes de la capa 0) |
| Componentes | `components/ui/*` con `cva` y `radix-ui` / `@radix-ui/*` → **shadcn** · MUI, Chakra, Ant → **librería pesada** · nada → **sin librería** (JSX inline) | shadcn · pesada · ninguna |
| Tokens | `:root {}` del CSS global · bloque `@theme` · `theme.extend.colors` · en ningún lado | archivo, o "ninguno" |
| Fuente | `index.html`, `layout.tsx`, `next/font` | Inter ya está · otra |
| Íconos | `grep -rlE "lucide-react\|@heroicons\|react-icons" src` | lucide · otra |
| Gráficos | `recharts` · `chart.js` · nada | — |
| Modo noche | `.dark` con tokens · `dark:` sueltas sin tokens · nada | — |
| Color del cliente | pedirlo o tomarlo del logo | hex |

**Tabla de equivalencias.** El kit **es** shadcn sobre Radix con nombres de token de shadcn. Por eso:

- **Repo con shadcn**: no se copia un segundo juego de componentes. Se reemplazan los **tokens** (`index.css`) y se igualan las **clases** de sus `components/ui/*.tsx` a las del starter (diff archivo por archivo). Los componentes del kit que no existan (`page-header`, `kpi`, `status-badge`, `money-input`, `date-picker`, `combobox`, `estados`, `confirm`, `data-table`) se copian del starter.
- **Repo sin librería** (o con una pesada que se va a sacar): se copian `components/ui/`, `components/layout/` y `src/lib/` del starter enteros y se instalan sus dependencias (BASE §1). Las vistas se migran en la capa 3.
- **Lo que no exista se crea con el nombre del kit**; no se inventa un tercer nombre.

| Concepto | Dónde en el kit | Repo con **shadcn + Tailwind 4** | Repo **sin librería** |
|---|---|---|---|
| Tokens día / noche, capas `z-*`, radios, fuente | `starter/src/index.css` | Reemplazar los valores de `:root` y `.dark` por los del starter; sumar los tokens que falten (`success`, `warning`, `info`, `brand`, `chart-*`, `sidebar-*`) y las capas | Copiar el archivo |
| Color del cliente | `--brand` + `src/lib/marca.ts` | Poner el hex en los dos | Idem |
| Modo noche | `src/lib/tema.ts` + script en `index.html` | Reemplazar `next-themes` u otro toggle por `useTema()` | Copiar |
| `cn()` | `src/lib/utils.ts` | Ya existe | Copiar |
| Formato es-AR | `src/lib/formato.ts` | Copiar y reemplazar cada `toFixed` / `toLocaleString` / `Intl` suelto | Idem |
| `Button`, `Input`, `Card`, `Badge`, `Table`, `Tabs`, `Tooltip` | `starter/src/components/ui/*` | Igualar clases y variantes (incluido `size="icon-sm"`) | Copiar |
| `Select` · `Combobox` · `DatePicker` | `select.tsx` · `combobox.tsx` · `date-picker.tsx` | `Select` igualado; los otros dos, copiar | Copiar; reemplazar cada `<select>` y `<input type="date">` |
| Modal | `dialog.tsx` + `DESIGN.md` §3.3 | `Dialog` con la estructura header / body / footer | Copiar; reemplazar portales y modales a mano |
| Confirmar | `confirm.tsx` (`useConfirm`) | Copiar; reemplazar cada `confirm()` y cada modal de confirmación propio | Idem |
| Detalle lateral | `sheet.tsx` + `DESIGN.md` §3.2 | `Sheet side="right"` | Copiar |
| Toasts | `sonner.tsx` | `sonner` igualado; reemplazar otros providers de toasts | Copiar |
| Tablas | `data-table.tsx` + `DESIGN.md` §3.9 | Copiar; migrar tablas vista por vista | Idem |
| Estados de lista | `estados.tsx` | Copiar; reemplazar spinners y vacíos propios | Idem |
| Estados de negocio → color | `status-badge.tsx` + `src/lib/estados.ts` | Copiar; mover el mapa estado → color a `estados.ts` | Idem |
| KPIs · título de página | `kpi.tsx` · `page-header.tsx` | Copiar; reemplazar tiles de métrica propios | Idem |
| Montos | `money-input.tsx` | Copiar; reemplazar `type="number"` en montos | Idem |
| Shell | `starter/src/components/layout/app-shell.tsx` | Reemplazar el layout propio; las rutas no cambian | Idem |
| Capas | `z-nav` · `z-header` · `z-overlay` · `z-tour` · `z-toast` (BASE §2) | Radix ya usa `z-overlay`; borrar todo `z-[…]` y `zIndex` numérico | Idem |
| Animaciones | `tw-animate-css` | Ya viene con shadcn en Tailwind 4 | Instalar |
| Gráficos | `src/lib/dataviz.ts` + `DATAVIZ.md` | recharts con `SERIES`, `EJES`, `GRILLA` | Idem |

**Lo que no se traduce**: la lógica de negocio, el store, los servicios, las rutas. Si el repo usa Next.js, el starter no se copia como proyecto: se toman `index.css`, `components/` y `lib/`, y la fuente va por `next/font`.

## R.4 Auditoría: el validador

Los greps manuales del kit anterior se reemplazaron por el validador, que corre las reglas comunes (`base/reglas.json`), las del estilo (`estilos/01-minimal-zinc/reglas.json`), el stack, las clases que no generan CSS, la documentación, la demo y typecheck + build.

```bash
# línea base, antes de tocar nada (es el "antes" del PR)
node <kit>/validador/validar.mjs . --estilo 01-minimal-zinc --json > /tmp/validacion-antes.json

# al cerrar cada capa (rápido: sin typecheck ni build)
node <kit>/validador/validar.mjs . --estilo 01-minimal-zinc --rapido

# al final, con reporte (deja VALIDACION.md en la raíz)
node <kit>/validador/validar.mjs . --reporte
```

Con el `DESIGN.md` del estilo copiado en la raíz del repo, el sello de la primera línea alcanza y `--estilo` sobra. 🔴 = error (bloquea el merge); 🟡 = aviso (deuda a bajar). El orden de ataque sale del conteo por regla.

**El starter del estilo pasa el validador con cero 🔴.** Si un archivo copiado del starter da 🔴, es un bug del kit: se reporta, no se esconde con una excepción.

**Excepciones legítimas.** Solo estas, y siempre con motivo:

| Regla | Cuándo vale | Cómo |
|---|---|---|
| `numero-montos` (🟡) | `type="number"` para **cantidades** (unidades, stock), nunca montos | En la línea: `{/* sumar-validar-ignorar: numero-montos cantidad de unidades */}` |
| `rounded-pelado` (🟡) | Marco del celular de la demo (`DESIGN.md` §4.4) | Idem, en la línea del marco |
| `colores-crudos` (🔴) | Texto sobre una foto (no sobre un token) | Idem; preferí `text-brand-foreground` sobre `bg-brand` (`DESIGN.md` §3.5) |
| Cualquiera | Un archivo entero que no es del producto (vendor, código generado) | `.sumar-validar.json` en la raíz: `{"excepciones":[{"regla":"hex","archivo":"src/vendor/**","motivo":"librería de terceros"}]}` |

El comentario va en la línea o en la anterior; el validador lista cada excepción usada con su motivo. **Nunca** se agrega una excepción para que la validación pase: si dudás, es un error. Si el alcance era solo capas 0–2, los 🔴 de vistas sin tocar quedan listados como pendientes, no exceptuados.

**Lo que el validador no ve** (va a la revisión visual de §R.6): la marca en un botón, tonos de estado que no se distinguen, controles de una fila con alturas distintas, superposiciones de capas, la cara de noche.

## R.5 Orden de ataque

1. **Capa 0, un commit** (`style(ui): tokens del estilo 1`): `index.css` del starter (ajustando los tokens existentes, no agregando otros nombres), Inter, `marca.ts`, `tema.ts`. Resultado esperado: sin tocar vistas, la app ya cambió de fuente, paleta y esquinas, y el modo noche funciona en lo que ya usa tokens.
2. **Capa 1, un commit por componente**, en este orden: button → input / field → card → badge / status-badge → table / data-table → select / combobox / date-picker → dialog / sheet / confirm → sonner, tooltip, estados. Si el repo tiene shadcn, se editan sus archivos; **nunca un segundo `Button`**.
3. **Capa 2, un commit**: `AppShell`. Es lo que se ve siempre; sin esto el resto parece un parche.
4. **Capa 3, una vista por commit**, empezando por la más usada. Cada vista se lleva **entera** a su receta: listado → `DESIGN.md` §3.1 y §3.9 · alta o edición → `DESIGN.md` §3.3 · detalle → `DESIGN.md` §3.2 · inicio → `DESIGN.md` §3.4. Una vista a medias es peor que una sin tocar.
5. **Dashboards al final**, con `DATAVIZ.md`: son donde más se nota y donde más reglas hay.

## R.6 Definición de terminado (por vista)

Se copia en la descripción del PR y se tilda.

- [ ] Validador: cero 🔴 en los archivos de la vista (`--rapido` alcanza durante el trabajo).
- [ ] Inter, cuerpo `text-sm`, tabla `text-[13px]`, micro-etiquetas de `DESIGN.md` §1.2, números con `formato.ts` y `tabular-nums` en columnas.
- [ ] Colores solo por token; marca solo en los lugares de la tabla de `DESIGN.md` §1.1; semánticos con `success` / `warning` / `info` / `destructive`.
- [ ] Superficies, radios y sombras según `DESIGN.md` §1.3–§1.5.
- [ ] Íconos lucide con los tamaños de `DESIGN.md` §1.7; `aria-label` y tooltip en cada botón-ícono.
- [ ] `PageHeader` + toolbar de `DESIGN.md` §3.1 (búsqueda con ícono, botones que quedan solo con ícono en mobile).
- [ ] Colecciones con `DataTable` y `tarjeta` mobile; columnas secundarias con `ocultarEn`.
- [ ] Modales con header / body / footer de `DESIGN.md` §3.3; confirmaciones con `useConfirm`.
- [ ] Formularios con `Field`, `FieldError` + `aria-invalid`, `MoneyInput` para montos, `DatePicker` para fechas, y la razón visible cuando no se puede guardar.
- [ ] Estados `Cargando`, `Vacio` y `ErrorEstado`, los tres.
- [ ] Estados de negocio con `StatusBadge`, tonos desde `src/lib/estados.ts`.
- [ ] Foco visible con `ring` en todo control; teclado: Tab recorre en orden, Escape cierra.
- [ ] Si tiene gráficos: checklist de `DATAVIZ.md` §6.
- [ ] Si lista entidades con movimientos: `EJEMPLOS.md` §1 (resumen + detalle, todos los componentes del total).
- [ ] **Capturas desktop 1440 y mobile 390, de día y de noche**, revisadas. Defectos que ningún grep ve: alturas distintas en una fila, una capa tapando a otra, un texto que de noche no se lee.
- [ ] Controles de una misma fila con la misma altura. Para medirlo (consola del navegador o Playwright, con `panel` = el diálogo o la toolbar):

```js
const filas = new Map();
for (const el of panel.querySelectorAll("input, button, [role=combobox]")) {
  const r = el.getBoundingClientRect(); if (!r.height) continue;
  const k = Math.round(r.top / 6); filas.set(k, [...(filas.get(k) ?? []), Math.round(r.height)]);
}
[...filas.values()].filter((f) => new Set(f).size > 1); // tiene que quedar vacío
```

## R.7 Prompts

Lo normal es correr los skills: **`/rediseno`** (pregunta estilo, marca y alcance, trabaja en rama, sigue este documento por capas) y **`/validar`** (validador + revisión visual + `VALIDACION.md`). Estos prompts sirven para repetir un tramo a mano o en otra herramienta. Completá los `<…>`.

**Global (capas 0–2, una vez):**

```text
Rediseñá la estética de esta app con el Estilo 1 · Minimalista zinc de Sumar (kit en <ruta del kit>), sin cambiar la lógica de negocio. Rama: rediseno/01-minimal-zinc.

Contexto: la app se generó con <AI Studio / v0 / otro> y tiene su propio diseño. Color del cliente: <#hex>. Código en <src | .>.

1. Leé estilos/01-minimal-zinc/REDISENO.md entero y base/BASE.md. De DESIGN.md, solo la sección que pida cada capa.
2. Paso 0: completá el inventario y la tabla de equivalencias (§R.3) y corré la línea base del validador (§R.4). Mostrame las dos cosas y el orden de ataque. PARÁ y esperá mi OK.
3. Capa 0 (un commit), capa 1 (un commit por componente), capa 2 (un commit), según §R.5. Nunca dos componentes con el mismo rol.
4. No toques vistas en esta pasada.
5. Al cerrar cada capa: validador --rapido, typecheck y build en verde, y mirá la app de día y de noche. Al final, /validar y el antes / después por regla.
```

**Una vista (una por pantalla, con `/clear` entre una y otra):**

```text
Llevá la vista <ruta o componente> al Estilo 1 (DESIGN.md §3.<1 listado | 2 detalle | 3 formulario | 4 inicio>). Usá la tabla de equivalencias de AGENTS.md.

- Reemplazá el JSX inline por los componentes de src/components/ui/; no ajustes clases sobre el markup viejo.
- La vista entera: desktop, mobile y los tres estados (cargando, vacío, error).
- Si tiene gráficos, DATAVIZ.md antes de tocarlos.
- No toques otras vistas ni los componentes.
- Terminá con la checklist de REDISENO.md §R.6 tildada y el validador en cero 🔴 para los archivos de la vista.
```

**Señal de que funcionó:** después de la capa 0, cualquier pantalla ya tiene otra fuente, otra paleta, otros botones y modo noche. Si no pasó, la capa 0 no está hecha: pedí el validador y el diff de `index.css`.

## R.8 Snippet para el `AGENTS.md` del repo

Va en la sección "Diseño / UI" (plantilla en `plantillas/AGENTS.md`). `CLAUDE.md` importa `@AGENTS.md`.

```md
## Diseño / UI — Estilo 1 · Minimalista zinc

La estética es el **Estilo 1 · Minimalista zinc** de Sumar (`./DESIGN.md`, sello
`01-minimal-zinc`). La API de componentes es la de la base de Sumar (BASE §4); este repo la
implementa como dice la tabla de abajo.

**Antes de tocar UI:** leé la sección de `DESIGN.md` que corresponde a la tarea (ruteo al
principio). Dashboards y gráficos: `DATAVIZ.md` es obligatorio.

**Inventario:** <framework> · Tailwind 4 · componentes <shadcn | copiados del starter> ·
tokens en `src/index.css` (día y noche) · Inter · lucide · gráficos <recharts | —> ·
marca `<#hex>` en `--brand` y `src/lib/marca.ts`.

**Equivalencias (kit → este repo):**
| Kit | Acá |
|---|---|
| `src/components/ui/*` (BASE §4) | <`src/components/ui/*` | otra ruta> |
| `AppShell` | <`src/components/layout/app-shell.tsx` | …> |
| `formato.ts` · `estados.ts` · `dataviz.ts` | <`src/lib/…`> |
| … | … |

**Validación:** `node <kit>/validador/validar.mjs .` tiene que dar cero 🔴 antes de mergear.
Excepciones aceptadas: <lista con motivo, o "ninguna">.

**Reglas fijas:** solo tokens (nada de `bg-white`, `text-gray-*`, hex, `dark:`); `primary` para
acciones, la marca solo donde dice `DESIGN.md` §1.1; `MoneyInput` y `dinero()` para montos;
estados con `StatusBadge`; listas con cargando / vacío / error. Una vista está terminada con la
checklist de `REDISENO.md` §R.6 completa.
```
