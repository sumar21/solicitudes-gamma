/**
 * Props comunes para recharts (BASE §4). Los colores son tokens del tema:
 * cambian solos de día a noche y por estilo. Nada de hex en los gráficos.
 * Las reglas de uso (qué gráfico, cuántas series) están en docs/DATAVIZ.md del estilo.
 */

/** Colores de serie, en orden. La serie principal es SERIES[0]. */
export const SERIES = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
] as const;

/** Para <XAxis {...EJES} /> y <YAxis {...EJES} />. */
export const EJES = {
  stroke: "var(--color-border)",
  tick: { fill: "var(--color-muted-foreground)", fontSize: 12 },
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
} as const;

/** Para <CartesianGrid {...GRILLA} />: solo líneas horizontales, sólidas (DATAVIZ: grilla sólida y tenue). */
export const GRILLA = {
  stroke: "var(--color-border)",
  vertical: false,
} as const;

/** Para <Tooltip {...TOOLTIP} /> de recharts: el globo con los tokens de popover. */
export const TOOLTIP = {
  cursor: { fill: "var(--color-muted)", opacity: 0.6 },
  contentStyle: {
    background: "var(--color-popover)",
    color: "var(--color-popover-foreground)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    fontSize: 12,
  },
  labelStyle: { color: "var(--color-muted-foreground)", marginBottom: 2 },
  itemStyle: { color: "var(--color-popover-foreground)" },
} as const;
