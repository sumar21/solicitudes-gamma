# Estilo 1 · Minimalista zinc — Dashboards y gráficos

Obligatorio antes de crear o tocar un dashboard, un gráfico o un KPI. Complementa `DESIGN.md` §3.4 (cómo se arma la pantalla de inicio) y BASE §3–§4 (colores de gráficos por token, `src/lib/dataviz.ts`).

Los gráficos son la parte de la UI donde más se nota un rediseño a medias y donde más reglas hay. Todos los ejemplos de este documento cumplen el protocolo de §1: si copiás uno, copiás algo correcto.

---

## 1. Protocolo

Antes de escribir código de un gráfico, invocá la skill **`dataviz`** de Claude Code y seguí su procedimiento en orden. La skill es agnóstica del sistema de diseño; §3 le da los parámetros de este estilo.

**Regla corta:** *forma → color → validar → marcas → hover → accesibilidad → mirar el render.* El color es lo último y se valida con el script, nunca a ojo.

1. **Forma, por el trabajo del dato.** Un número → `Kpi`, no un gráfico de una barra ni un donut de dos porciones. Tendencia → línea o área. Comparar magnitudes → barras. Parte de un todo → barra apilada (donut solo con 3 a 6 segmentos). Una serie que importa entre varias → énfasis: esa en color, el resto en gris. Presupuesto contra real → barras agrupadas. Radar, no.
2. **Color, por el trabajo de la serie.** Identidad → categórica (orden fijo, nunca ciclada). Magnitud ordenada → secuencial (la marca en pasos de opacidad). Polaridad → divergente (dos tonos y gris al medio). Bien / mal → status (con ícono y texto). **Barras nominales de una sola serie → un solo color** (`SERIES[0]`), nunca "más oscuro cuanto más grande".
3. **Validá la paleta** con el script (§3.2). Ningún FAIL.
4. **Marcas.** Barras ≤ 24 px con punta redondeada de 4 px y base recta · líneas de 2 px · marcadores ≥ 8 px (`r: 4`) · área al ~10 % · grilla **sólida**, horizontal, finita · 2 px entre barras o segmentos.
5. **Hover.** Tooltip en todo gráfico (`TooltipGrafico`, §2), con **todas** las series de ese punto. El valor también tiene que poder leerse sin hover: label directo o vista tabla.
6. **Accesibilidad.** Leyenda con 2 series o más; ninguna con una sola (el título la nombra). Hasta 4 series, labels directos selectivos, nunca un número en cada punto. **Vista tabla para todo gráfico** (§4.10). Texto siempre en tokens de texto, nunca del color de la serie.
7. **Mirá el render** (captura o navegador), de día y de noche: labels superpuestos, eje X cortado, desbordes.

Después, contrastá con `references/anti-patterns.md` de la skill: si el gráfico coincide con una entrada, está mal.

**Prohibido**: dos ejes Y · grilla punteada · colorear barras nominales por índice · ciclar colores · donut de 2 porciones · radar · hex en el código del gráfico · más de 5 series categóricas en un mismo gráfico.

---

## 2. Piezas del estilo

**Colores y ejes** salen de `src/lib/dataviz.ts` (BASE §4): `SERIES` (los cinco `var(--color-chart-N)`), `EJES` (props comunes de `XAxis` / `YAxis`: sin línea de eje ni ticks, texto de 12 px en `muted-foreground`) y `GRILLA` (props de `CartesianGrid`: solo horizontales, color `border`, **sólida**: §1 prohíbe la grilla punteada, así que si `GRILLA` trae `strokeDasharray` es un bug de `dataviz.ts`, no una excepción). `TOOLTIP` da un globo rápido con los tokens de popover para prototipos; en este estilo el tooltip es `TooltipGrafico` (abajo). Como todo son variables CSS, cambian solas con el modo noche.

**Dinero y fechas** salen de `src/lib/formato.ts` (es-AR): `dinero()` en tooltips y tablas, `porcentaje()` (recibe una fracción: `0.125` → "12,5 %"), `diaMes()` para fechas en ejes. Para montos en ejes hace falta una versión corta, `ejeDinero`.

Piezas propias de los dashboards de este estilo, en `src/components/dashboard/comun.tsx` del proyecto:

```tsx
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { numero } from "@/lib/formato";

/** Título de una card de gráfico: ícono de marca + micro-etiqueta. `derecha`: leyenda o acción. */
export function TituloSeccion({ icono: Icono, children, derecha }: { icono: LucideIcon; children: ReactNode; derecha?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Icono className="h-4 w-4 text-brand" />
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{children}</h3>
      </div>
      {derecha}
    </div>
  );
}

/** Caja del tooltip de recharts: `<Tooltip content={<MiTooltip />} />`. */
export function TooltipGrafico({ titulo, children }: { titulo?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-40 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {titulo && <p className="mb-1.5 font-semibold">{titulo}</p>}
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

/** Una fila por serie: punto de color, nombre, valor. */
export function FilaTooltip({ nombre, valor, color }: { nombre: ReactNode; valor: ReactNode; color?: string }) {
  return (
    <div className="flex items-center gap-3">
      {color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />}
      <span className="text-muted-foreground">{nombre}</span>
      <span className="ml-auto font-semibold tabular-nums">{valor}</span>
    </div>
  );
}

/** Leyenda propia (la de recharts no se usa). Línea: `forma="linea"`. */
export function Leyenda({ items }: { items: { nombre: string; color: string; forma?: "barra" | "linea" }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.nombre} className="flex items-center gap-1.5">
          <span className={i.forma === "linea" ? "h-0.5 w-3 rounded-full" : "h-2 w-3 rounded-full"} style={{ background: i.color }} />
          {i.nombre}
        </span>
      ))}
    </div>
  );
}

/** Eje de dinero en es-AR: "$ 850 mil", "$ 1,2 M". Para el tooltip, `dinero()` completo. */
export const ejeDinero = (v: number) =>
  v === 0 ? "0" : Math.abs(v) >= 1_000_000 ? `$ ${numero(v / 1_000_000, { decimales: 1 })} M` : `$ ${numero(v / 1_000, { decimales: 0 })} mil`;
```

`style={{ background: color }}` recibe `var(--color-chart-N)`, nunca un hex.

**Gráfico dentro de una card** (todos, sin excepción):

```tsx
<Card>
  <CardContent>
    <TituloSeccion icono={TrendingUp} derecha={<Leyenda items={…} />}>Ingresos por mes</TituloSeccion>
    {datos.length ? (
      <ResponsiveContainer width="100%" height={250}>{/* el gráfico */}</ResponsiveContainer>
    ) : (
      <p className="py-8 text-center text-sm text-muted-foreground">Sin datos para el período</p>
    )}
  </CardContent>
</Card>
```

- `Card` default (24 px de aire; los KPI van en `Card size="sm"`). Título con `TituloSeccion`, nunca un `<h3>` suelto. Nunca un gráfico sin card.
- Alto fijo y ancho fluido: **250** (principal), **200** (secundario), **150** (donut, ancho fijo), **52** (sparkline). Ranking horizontal: `Math.max(120, filas * 36)`.
- Vacío adentro de la card; filtros nunca adentro de una card (van en la barra de `DESIGN.md` §3.8).

---

## 3. Paleta y parámetros

### 3.1 Parámetros para la skill

Es la tabla "Plugging in a design system" de la skill, completada para este estilo. **No** uses la paleta de referencia de la skill en apps del estudio. Los valores de día son de referencia; los vigentes, de día y de noche, están en `src/index.css`.

| Parámetro | Valor | Nota |
|---|---|---|
| **Categórica (orden fijo)** | `SERIES` = `chart-1` … `chart-5`. Día: `chart-1` marca (o su paso validado) · `chart-2` azul `#2563eb` · `chart-3` esmeralda `#059669` · `chart-4` ámbar `#d97706` · `chart-5` violeta `#7c3aed` | Máximo 5 series. Más → agrupá en "Otros" (énfasis) o separá en gráficos chicos. Con los valores de referencia, esmeralda ↔ ámbar da ΔE 7,9 (WARN): cuando aparecen juntos, labels directos o separación. |
| **Secuencial / ordinal** | `var(--color-brand)` con `fillOpacity` en 5 pasos: `0.35 · 0.5 · 0.65 · 0.8 · 1` | Solo para escalas ordenadas (etapas, rangos), nunca ciclada. Se valida con los colores resultantes (§3.2). |
| **Divergente** | `chart-1` ↔ `chart-2`, punto medio `var(--color-muted)` | Si la marca del cliente es fría (azulada), el lado cálido es `chart-4`. Nunca dos fríos ni un color al medio. |
| **Status** | `var(--color-success)` · `var(--color-warning)` · `var(--color-destructive)` | Solo si la serie **significa** bien / mal, con ícono y texto. No es la "serie 4". |
| **Énfasis / "Otros" / período anterior** | `var(--color-muted-foreground)` con `strokeOpacity` o `fillOpacity` 0.4 | La serie que importa en `chart-1`, el resto en gris. |
| **Superficie** | `card` (día `#ffffff`; noche, la del bloque `.dark`) | Validar contra la card, no contra el lienzo. |
| **Cromo** | `GRILLA` (sólida, `border`) · `EJES` (`muted-foreground`, 11 px) · línea de referencia `var(--color-muted-foreground)` | Nada de `strokeDasharray` en la grilla. |
| **Filtros** | Barra colapsable de `DESIGN.md` §3.8, una fila arriba de los gráficos, fechas primero (`DateRangePicker`) | — |
| **Tipografía** | Inter. Valores grandes (`Kpi`) con figuras proporcionales; `tabular-nums` en tooltips, ejes y tablas | — |

**`chart-1` y la marca.** Para series, la marca tiene que caer en la banda de luminosidad OKLCH 0,43–0,77 (día). Si el hex del cliente queda afuera (los bordós y azules muy oscuros suelen quedar), `--chart-1` en `index.css` es un paso más claro de la marca, y la UI sigue usando `--brand` puro. De noche, el mismo criterio contra la card de noche.

### 3.2 Validar (nunca a ojo)

El script está en la carpeta de la skill (`<skill>/scripts/validate_palette.js`, Claude Code muestra la ruta al cargarla). Los hex salen de `src/index.css`.

```bash
# Categórica, día: pares adyacentes contra la card
node <skill>/scripts/validate_palette.js "<chart-1>,<chart-2>,<chart-3>,<chart-4>,<chart-5>" --mode light --surface "<card>"

# Formas donde cualquier par se toca (dispersión, mapa, gráficos chicos): máximo 3 series
node <skill>/scripts/validate_palette.js "<chart-1>,<chart-2>,<chart-3>" --mode light --surface "<card>" --pairs all

# Noche: los valores del bloque .dark contra la card de noche
node <skill>/scripts/validate_palette.js "<chart-1 noche>,…,<chart-5 noche>" --mode dark --surface "<card noche>"
```

Para la secuencial, calculá los colores resultantes de la marca sobre la card a cada opacidad y pasalos con `--ordinal`:

```js
// node -e '…' — mezcla de la marca sobre la card a cada paso de opacidad
const mezcla = (a, b, t) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * t + parseInt(b.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, "0")).join("");
console.log([0.35, 0.5, 0.65, 0.8, 1].map((t) => mezcla("<marca>", "<card>", t)).join(","));
```

Lectura: **FAIL** → se corrige antes de seguir (otro paso, o menos series). **WARN de daltonismo** → solo con codificación secundaria (labels directos, separación). **WARN de contraste** → label visible o vista tabla, obligatorio.

---

## 4. Catálogo

Imports comunes de los ejemplos:

```tsx
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SERIES, EJES, GRILLA } from "@/lib/dataviz";
import { dinero, porcentaje } from "@/lib/formato";
import { TituloSeccion, TooltipGrafico, FilaTooltip, Leyenda, ejeDinero } from "@/components/dashboard/comun";
const GRIS = "var(--color-muted-foreground)";
```

### 4.1 Área (tendencia de una serie)

```tsx
function TipMes({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <TooltipGrafico titulo={label}>
      <FilaTooltip nombre="Ingresos" valor={dinero(d.ingresos)} color={SERIES[0]} />
      <FilaTooltip nombre="Costo" valor={dinero(d.costo)} />
      <FilaTooltip nombre="Neto" valor={dinero(d.neto)} />
    </TooltipGrafico>
  );
}

<ResponsiveContainer width="100%" height={250}>
  <AreaChart data={porMes} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
    <CartesianGrid {...GRILLA} />
    <XAxis dataKey="mes" {...EJES} interval="preserveStartEnd" minTickGap={12} />
    <YAxis {...EJES} width={64} tickFormatter={ejeDinero} />
    <Tooltip content={<TipMes />} cursor={{ stroke: GRIS, strokeOpacity: 0.3 }} />
    <Area type="monotone" dataKey="ingresos" stroke={SERIES[0]} strokeWidth={2} fill={SERIES[0]} fillOpacity={0.1} activeDot={{ r: 4 }} />
  </AreaChart>
</ResponsiveContainer>
```

Una serie: sin leyenda (el título la nombra). Costo y neto van en el tooltip como contexto, sin color.

### 4.2 Línea: actual contra período anterior

El anterior en gris punteado (acá el punteado **significa** comparación; la grilla sigue sólida); el actual en `chart-1`.

```tsx
<TituloSeccion icono={TrendingUp} derecha={<Leyenda items={[{ nombre: "Este año", color: SERIES[0], forma: "linea" }, { nombre: "Año anterior", color: GRIS, forma: "linea" }]} />}>
  Ventas por mes
</TituloSeccion>
<ResponsiveContainer width="100%" height={250}>
  <LineChart data={porMes} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
    <CartesianGrid {...GRILLA} />
    <XAxis dataKey="mes" {...EJES} />
    <YAxis {...EJES} width={64} tickFormatter={ejeDinero} />
    <Tooltip content={<TipComparacion />} />
    <Line type="monotone" dataKey="anterior" stroke={GRIS} strokeOpacity={0.5} strokeWidth={2} strokeDasharray="5 4" dot={false} />
    <Line type="monotone" dataKey="actual" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
  </LineChart>
</ResponsiveContainer>
```

`TipComparacion` lleva las dos filas (actual y anterior) y la variación con `porcentaje()`.

### 4.3 Ranking (barras horizontales nominales)

Una sola serie → **un solo color**. El orden lo da el valor (mayor arriba), no el color.

```tsx
<ResponsiveContainer width="100%" height={Math.max(120, filas.length * 36)}>
  <BarChart data={filas} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }} barCategoryGap={2}>
    <XAxis type="number" hide />
    <YAxis type="category" dataKey="nombre" {...EJES} width={120} />
    <Tooltip content={<TipRanking />} cursor={{ fill: "var(--color-muted)", fillOpacity: 0.5 }} />
    <Bar dataKey="total" fill={SERIES[0]} maxBarSize={24} radius={[0, 4, 4, 0]}
      label={{ position: "right", formatter: ejeDinero, fill: GRIS, fontSize: 11 }} />
  </BarChart>
</ResponsiveContainer>
```

Más de 10 filas: top 9 + "Otros" en gris (`<Cell fill={GRIS} fillOpacity={0.4} />` solo en esa fila).

### 4.4 Barras con signo (entradas arriba, salidas abajo)

Polaridad → divergente. Las salidas se precalculan negativas.

```tsx
const datos = meses.map((m) => ({ ...m, salidasNeg: -m.salidas }));

<TituloSeccion icono={ArrowLeftRight} derecha={<Leyenda items={[{ nombre: "Entradas", color: SERIES[1] }, { nombre: "Salidas", color: SERIES[0] }]} />}>
  Flujo de caja
</TituloSeccion>
<ResponsiveContainer width="100%" height={250}>
  <BarChart data={datos} stackOffset="sign" margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
    <CartesianGrid {...GRILLA} />
    <XAxis dataKey="mes" {...EJES} />
    <YAxis {...EJES} width={64} tickFormatter={ejeDinero} />
    <ReferenceLine y={0} stroke={GRIS} strokeOpacity={0.6} />
    <Tooltip content={<TipFlujo />} cursor={{ fill: "var(--color-muted)", fillOpacity: 0.5 }} />
    <Bar dataKey="entradas" stackId="f" fill={SERIES[1]} maxBarSize={24} radius={[4, 4, 0, 0]} />
    <Bar dataKey="salidasNeg" stackId="f" fill={SERIES[0]} maxBarSize={24} radius={[0, 0, 4, 4]} />
  </BarChart>
</ResponsiveContainer>
```

`TipFlujo` muestra entradas, salidas (en positivo) y el neto. Si la marca es fría, salidas en `SERIES[3]` (§3.1).

### 4.5 Barras y porcentaje (sin doble eje)

"Ventas y % de margen por sucursal" **no** va en un gráfico con dos ejes Y: la alineación de dos escalas es arbitraria e inventa correlaciones. Van **dos gráficos apilados en la misma card**, con el mismo eje X y `syncId` para que el hover vaya junto:

```tsx
<ResponsiveContainer width="100%" height={180}>
  <BarChart data={sucursales} syncId="sucursales" margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
    <CartesianGrid {...GRILLA} />
    <XAxis dataKey="nombre" {...EJES} hide />
    <YAxis {...EJES} width={64} tickFormatter={ejeDinero} />
    <Tooltip content={<TipSucursal />} cursor={{ fill: "var(--color-muted)", fillOpacity: 0.5 }} />
    <Bar dataKey="ventas" fill={SERIES[0]} maxBarSize={24} radius={[4, 4, 0, 0]} />
  </BarChart>
</ResponsiveContainer>
<ResponsiveContainer width="100%" height={120}>
  <LineChart data={sucursales} syncId="sucursales" margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
    <CartesianGrid {...GRILLA} />
    <XAxis dataKey="nombre" {...EJES} interval={0} />
    <YAxis {...EJES} width={64} domain={[0, 100]} tickFormatter={(v) => `${v} %`} />
    <Tooltip content={<TipSucursal />} />
    <Line type="monotone" dataKey="margen" stroke={SERIES[1]} strokeWidth={2} dot={{ r: 4 }} />
  </LineChart>
</ResponsiveContainer>
```

Alternativa: las dos series indexadas a base 100 en **un** eje.

### 4.6 Presupuesto contra real (barras agrupadas)

Reemplaza al radar. Dos series → leyenda; real en `chart-1`, presupuesto en gris.

```tsx
<BarChart data={rubros} barGap={2} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
  <CartesianGrid {...GRILLA} />
  <XAxis dataKey="rubro" {...EJES} />
  <YAxis {...EJES} width={64} tickFormatter={ejeDinero} />
  <Tooltip content={<TipPresupuesto />} cursor={{ fill: "var(--color-muted)", fillOpacity: 0.5 }} />
  <Bar dataKey="presupuesto" fill={GRIS} fillOpacity={0.4} maxBarSize={24} radius={[4, 4, 0, 0]} />
  <Bar dataKey="real" fill={SERIES[0]} maxBarSize={24} radius={[4, 4, 0, 0]} />
</BarChart>
```

`TipPresupuesto` muestra los dos montos y el cumplimiento (`porcentaje(real / presupuesto)`); si pasarse es malo, el desvío va con `text-destructive` e ícono, en el texto, no en la barra.

### 4.7 Donut (parte de un todo, 3 a 6 segmentos)

Con 2 segmentos no es un donut: es un `Kpi` o una barra de proporción (§4.8). Con más de 6: barra apilada o ranking.

```tsx
// el sexto segmento, si existe, es "Otros" en gris
const colorMix = (i: number) => (i < SERIES.length ? SERIES[i] : GRIS);

<div className="flex flex-col items-center gap-4 sm:flex-row">
  <div className="relative">
    <ResponsiveContainer width={150} height={150}>
      <PieChart>
        <Pie data={mix} dataKey="valor" nameKey="nombre" innerRadius={48} outerRadius={70} paddingAngle={2} stroke="none">
          {mix.map((_, i) => <Cell key={i} fill={colorMix(i)} />)}
        </Pie>
        <Tooltip content={<TipMix />} />
      </PieChart>
    </ResponsiveContainer>
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="text-sm font-bold">{dinero(total)}</span>
    </div>
  </div>
  <ul className="flex w-full flex-col gap-1.5 text-xs">
    {mix.map((m, i) => (
      <li key={m.nombre} className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorMix(i) }} />
        <span className="text-muted-foreground">{m.nombre}</span>
        <span className="ml-auto font-semibold tabular-nums">{dinero(m.valor)}</span>
        <span className="w-12 text-right tabular-nums text-muted-foreground">{porcentaje(m.valor / total)}</span>
      </li>
    ))}
  </ul>
</div>
```

Hasta 5 segmentos con color; el sexto, si existe, es "Otros" en gris. La leyenda es la lista, con valor y porcentaje: el dato se lee sin hover.

### 4.8 Barra de proporción (sin recharts)

Para un ratio ("cobrado sobre facturado"), liviano y sin librería:

```tsx
<div className="flex flex-col gap-1.5">
  <div className="flex items-baseline justify-between text-xs">
    <span className="text-muted-foreground">Cobrado</span>
    <span className="font-semibold tabular-nums">{porcentaje(cobrado / facturado)}</span>
  </div>
  <div className="h-2.5 overflow-hidden rounded-full bg-muted">
    <div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.min(100, (cobrado / facturado) * 100)}%` }} />
  </div>
</div>
```

Un color y el riel `bg-muted`; el texto dice el número.

### 4.9 Sparkline (dentro de una card de métrica)

`AreaChart` de alto `52`, sin ejes, grilla ni tooltip; `stroke={SERIES[0]} strokeWidth={2} fill={SERIES[0]} fillOpacity={0.1} dot={false}`. Siempre acompaña a un número escrito: la sparkline sola no comunica valores.

### 4.10 Vista tabla y drill-down

Todo gráfico tiene su vista tabla. La forma del estilo es el **drill-down**: click en la card (o en un punto, o un botón "Ver detalle" `ghost sm`) abre un `Dialog` `sm:max-w-6xl` (`DESIGN.md` §3.3) con:

- header con el título del gráfico, el período y, si hace falta, búsqueda y exportar (`outline sm`, `Download`);
- `DataTable` con las mismas cifras del gráfico (montos con `dinero()`, `alinear: "der"`) y paginación;
- los mismos filtros activos del dashboard, no otros.

### 4.11 Mapas

Para pocos lugares conocidos (provincias, sucursales): SVG propio con el contorno simplificado y burbujas proporcionales en `chart-1` con `fillOpacity={0.6}`, tooltip con `TooltipGrafico`. No una librería de mapas.

---

## 5. Layout de un dashboard

```
PageHeader (título + período + refrescar)            DESIGN.md §3.4
Barra de filtros (si hay más de uno)                 DESIGN.md §3.8
KpiGrid (3 a 6 Kpi)                                  DESIGN.md §3.4
grid lg:grid-cols-3 → principal (lg:col-span-2) + secundario
grid lg:grid-cols-2 → dos rankings o dos comparaciones
Lo de hoy / detalle accionable
```

- Contenedor `flex flex-col gap-4 pb-8`. Las grillas de gráficos usan `gap-4`; la de KPIs, `gap-3`.
- Tabs entre secciones del dashboard: subrayadas, `DESIGN.md` §3.8. El panel activo re-anima con `key={tab}` y `animate-in fade-in-0`.
- **Estados**, los tres siempre: carga inicial con `Cargando`; error con `ErrorEstado` (reintentar `outline`); recarga por filtro con `opacity-60` en el contenedor, sin desmontar los gráficos ni mostrar skeletons.
- Un KPI destacado no se pinta con la marca: el acento de marca del dashboard está en los íconos de `TituloSeccion`, en `chart-1` y en el tab o filtro activo.

---

## 6. Checklist (se pega en el PR)

- [ ] Invoqué la skill `dataviz` y elegí la forma antes del color (un número = `Kpi`, no un gráfico).
- [ ] Cada serie tiene color por su trabajo; barras nominales de una serie en un solo color; nada ciclado; máximo 5 series.
- [ ] Colores con `SERIES` / `var(--color-*)`; ningún hex en el código del gráfico.
- [ ] Paleta validada con el script, de día y de noche (salida pegada); sin FAIL; WARN cubiertos con labels o vista tabla.
- [ ] Ningún gráfico con dos ejes Y; ningún radar; ningún donut de 2.
- [ ] Marcas: barras ≤ 24 px con punta de 4 px, líneas de 2 px, marcadores `r: 4`, área al 10 %, grilla sólida.
- [ ] Tooltip con todas las series; leyenda si hay 2 o más; vista tabla (drill-down) disponible.
- [ ] Dinero con `dinero()` en tooltips y tablas, `ejeDinero` en ejes; nada de `toFixed` ni formatos en inglés.
- [ ] Texto en tokens de texto; valores de `Kpi` sin `tabular-nums`.
- [ ] Filtros en una fila arriba (`DESIGN.md` §3.8); recarga con `opacity-60`.
- [ ] Miré el render en 1440 y 390, de día y de noche: sin labels encimados ni eje X cortado.
- [ ] Contrastado con `references/anti-patterns.md`.
