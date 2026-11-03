import * as React from 'react';
import { ArrowDownRight, ArrowUpRight, Lightbulb, Minus, type LucideIcon } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '../ui/card';
import { Tooltip as Ayuda, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../../lib/utils';

/**
 * Piezas del dashboard (DESIGN.md §4.6 + protocolo dataviz §10.0, con la skill `dataviz`).
 * Colores: tokens de index.css validados con scripts/validate_palette.js contra la card, de día y de
 * noche. Reglas que estas piezas ya cumplen: marcas finas (barra ≤ 24 px, punta de 4 px, línea de
 * 2 px), grilla sólida y tenue, el texto nunca lleva el color de la serie, leyenda con ≥ 2 series,
 * etiquetas selectivas, tooltip que muestra pero no esconde (cada gráfico tiene su tabla).
 */

export const C = {
  serie: 'var(--color-chart-1)',
  comparar: 'var(--color-chart-comparar)',
  medio: 'var(--color-chart-medio)',
  lento: 'var(--color-chart-lento)',
  categorias: ['var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-chart-3)', 'var(--color-chart-4)'],
  eje: 'var(--color-muted-foreground)',
  grilla: 'var(--color-border)',
  tinta: 'var(--color-foreground)',
  superficie: 'var(--color-card)',
} as const;

export const EJE_TICK = { fontSize: 11, fill: C.eje } as const;
export const SIN_LINEA = { axisLine: false as const, tickLine: false as const };
export const GRILLA = { stroke: C.grilla, vertical: false } as const;
export const CURSOR_BARRA = { fill: 'var(--color-muted)', opacity: 0.5 } as const;

// ── Leyenda: identidad por color + nombre (nunca color solo). Rect para barras/áreas, línea para líneas.
export const Leyenda: React.FC<{ items: { label: string; color: string; linea?: boolean; punteada?: boolean }[] }> = ({ items }) => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pt-2">
    {items.map((it) => (
      <span key={it.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {it.linea ? (
          <svg width="16" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="16" y2="4" stroke={it.color} strokeWidth="2" strokeDasharray={it.punteada ? '3 2' : undefined} strokeLinecap="round" />
          </svg>
        ) : (
          <span className="size-2.5 rounded-sm" style={{ backgroundColor: it.color }} aria-hidden="true" />
        )}
        {it.label}
      </span>
    ))}
  </div>
);

// ── Tooltip: el valor manda (fuerte), el nombre acompaña; la serie se marca con una línea corta.
export const TooltipShell: React.FC<{ title?: React.ReactNode; children: React.ReactNode; pie?: React.ReactNode }> = ({ title, children, pie }) => (
  <div className="min-w-[170px] rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
    {title && <p className="mb-1 font-medium">{title}</p>}
    <div className="space-y-0.5">{children}</div>
    {pie && <p className="mt-1 border-t pt-1 text-[11px] text-muted-foreground">{pie}</p>}
  </div>
);
export const TipRow: React.FC<{ label: React.ReactNode; value: React.ReactNode; color?: string; punteada?: boolean }> = ({ label, value, color, punteada }) => (
  <div className="flex items-center justify-between gap-4">
    <span className="flex items-center gap-1.5 text-muted-foreground">
      {color && (
        <svg width="12" height="6" aria-hidden="true">
          <line x1="0" y1="3" x2="12" y2="3" stroke={color} strokeWidth="2.5" strokeDasharray={punteada ? '3 2' : undefined} strokeLinecap="round" />
        </svg>
      )}
      {label}
    </span>
    <span className="font-semibold text-foreground tabular-nums">{value}</span>
  </div>
);

// ── Delta vs. un período CON NOMBRE: flecha + color por "subir es bueno/malo"; cero = gris, sin flecha.
export const Delta: React.FC<{ valor: number | null; mejorSiSube?: boolean; contra: string }> = ({ valor, mejorSiSube = true, contra }) => {
  if (valor == null || !Number.isFinite(valor)) return <span className="text-xs text-muted-foreground">Sin base para comparar</span>;
  const r = Math.round(valor);
  const Icono = r === 0 ? Minus : r > 0 ? ArrowUpRight : ArrowDownRight;
  const bueno = r === 0 ? null : (r > 0) === mejorSiSube;
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      <span className={cn('inline-flex items-center gap-0.5 font-semibold', bueno == null ? 'text-muted-foreground' : bueno ? 'text-emerald-700' : 'text-red-700')}>
        <Icono className="size-3.5" aria-hidden="true" />
        {r > 0 ? '+' : ''}{r} %
      </span>
      <span>{contra}</span>
    </span>
  );
};

// ── Sparkline: la serie en el gris de énfasis y el último punto en el color de acento.
const Sparkline: React.FC<{ datos: (number | null)[]; id: string; alto?: number }> = ({ datos, id, alto = 36 }) => {
  const filas = datos.map((v, i) => ({ i, v }));
  const ultimo = [...filas].reverse().find((f) => f.v != null);
  return (
    <ResponsiveContainer width="100%" height={alto}>
      <AreaChart data={filas} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.serie} stopOpacity={0.12} />
            <stop offset="100%" stopColor={C.serie} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={C.comparar}
          strokeWidth={1.5}
          fill={`url(#spark-${id})`}
          connectNulls
          isAnimationActive={false}
          dot={(p: { cx?: number; cy?: number; index?: number }) =>
            p.index === ultimo?.i && p.cx != null && p.cy != null
              ? <circle key="ultimo" cx={p.cx} cy={p.cy} r={3} fill={C.serie} stroke={C.superficie} strokeWidth={2} />
              : <g key={`p${p.index}`} />}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

/**
 * Stat tile (skill dataviz "Figures"): label · valor (cifras proporcionales) · delta vs un período con
 * nombre · sparkline. `heroe` = LA cifra con la que abre la vista (≥ 48 px, una sola por vista).
 */
export const StatTile: React.FC<{
  icono: LucideIcon;
  label: string;
  valor: React.ReactNode;
  unidad?: string;
  delta?: React.ReactNode;
  sub?: React.ReactNode;
  spark?: (number | null)[];
  heroe?: boolean;
  ayuda?: string;
  className?: string;
}> = ({ icono: Icono, label, valor, unidad, delta, sub, spark, heroe, ayuda, className }) => (
  <Card className={cn('flex min-w-0 flex-col gap-0 p-4', heroe && 'border-brand/20 bg-brand/[0.03]', className)}>
    <div className="flex items-center gap-2 text-muted-foreground">
      <Icono className={cn('size-4 shrink-0', heroe && 'text-brand')} aria-hidden="true" />
      <span className="truncate text-[11px] font-semibold tracking-wider uppercase">{label}</span>
      {ayuda && (
        <Ayuda>
          <TooltipTrigger asChild>
            <button type="button" aria-label={`Qué mide: ${label}`} className="ml-auto rounded-full text-[10px] font-bold text-muted-foreground/70 hover:text-foreground">ⓘ</button>
          </TooltipTrigger>
          <TooltipContent className="max-w-60">{ayuda}</TooltipContent>
        </Ayuda>
      )}
    </div>
    <div className="mt-1.5 flex items-baseline gap-1.5">
      <span className={cn('font-bold tracking-tight', heroe ? 'text-5xl text-brand' : 'text-2xl')}>{valor}</span>
      {unidad && <span className={cn('font-medium text-muted-foreground', heroe ? 'text-lg' : 'text-sm')}>{unidad}</span>}
    </div>
    {delta && <div className="mt-1.5">{delta}</div>}
    {spark && spark.some((v) => v != null) && (
      <div className={cn('-mx-1', heroe ? 'mt-3' : 'mt-2')}>
        <Sparkline datos={spark} id={label.replace(/\W+/g, '')} alto={heroe ? 56 : 32} />
      </div>
    )}
    {sub && <div className="mt-auto border-t pt-2 text-xs text-muted-foreground">{sub}</div>}
  </Card>
);

export interface TablaChart {
  columnas: string[];
  filas: (string | number)[][];
}

/**
 * Chart dentro de una Card (§4.6 + tablero de Gamma): título + bajada, la LECTURA (el hallazgo en
 * lenguaje natural) y un toggle Gráfico | Tabla: cada gráfico tiene su tabla (el equivalente accesible,
 * y donde vive todo valor que no se rotula).
 */
export const ChartCard: React.FC<{
  titulo: string;
  bajada?: React.ReactNode;
  lectura?: React.ReactNode;
  tabla?: TablaChart;
  vacio?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ titulo, bajada, lectura, tabla, vacio, className, children }) => {
  const [verTabla, setVerTabla] = React.useState(false);
  return (
    <Card className={cn('flex min-w-0 flex-col gap-0 py-0', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 p-4 pb-2">
        <div className="min-w-0">
          <h3 className="text-sm leading-tight font-semibold">{titulo}</h3>
          {bajada && <p className="mt-0.5 text-xs text-muted-foreground">{bajada}</p>}
        </div>
        {tabla && !vacio && (
          <div className="inline-flex items-center rounded-md bg-muted p-0.5 text-xs" role="group" aria-label={`Ver ${titulo} como`}>
            {(['Gráfico', 'Tabla'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={(m === 'Tabla') === verTabla}
                onClick={() => setVerTabla(m === 'Tabla')}
                className={cn('rounded-sm px-2 py-0.5 font-medium transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                  (m === 'Tabla') === verTabla ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>
      {lectura && !vacio && (
        <div className="mx-4 mb-1 flex items-start gap-1.5 rounded-md bg-brand/[0.06] px-2.5 py-1.5 text-xs text-foreground">
          <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden="true" />
          <span>{lectura}</span>
        </div>
      )}
      <div className="flex-1 px-2 pb-3">
        {vacio ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Sin datos en el período</p>
        ) : verTabla && tabla ? (
          <div className="mx-2 mt-2 max-h-[300px] overflow-auto rounded-md border">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-muted/60 backdrop-blur-sm">
                <tr>{tabla.columnas.map((c, i) => <th key={c} className={cn('px-3 py-2 text-[11px] font-semibold tracking-wider whitespace-nowrap text-muted-foreground uppercase', i === 0 ? 'text-left' : 'text-right')}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {tabla.filas.map((f, r) => (
                  <tr key={r} className="border-t">
                    {f.map((v, i) => <td key={i} className={cn('px-3 py-1.5', i === 0 ? 'text-left' : 'text-right whitespace-nowrap tabular-nums')}>{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
    </Card>
  );
};

/**
 * Barra segmentada ALTA (skill "Figures"): una sola totalidad partida en ≤ 6 partes, de un vistazo.
 * 28 px, bloques con 2 px de aire entre sí, el % adentro solo si entra; leyenda con los nombres.
 */
export const BarraSegmentada: React.FC<{ partes: { label: string; valor: number; color: string; texto: string }[] }> = ({ partes }) => {
  const total = partes.reduce((a, p) => a + p.valor, 0) || 1;
  return (
    <div className="px-2 pt-3">
      <div className="flex h-7 w-full gap-0.5" role="img" aria-label={partes.map((p) => `${p.label}: ${p.texto} (${Math.round((p.valor / total) * 100)} %)`).join('; ')}>
        {partes.filter((p) => p.valor > 0).map((p) => {
          const pct = (p.valor / total) * 100;
          return (
            <Ayuda key={p.label}>
              <TooltipTrigger asChild>
                <div
                  tabIndex={0}
                  // sumar-validar-ignorar: colores-crudos rótulo DENTRO de un relleno de serie (skill dataviz: blanco sobre el color)
                  className="flex min-w-0 items-center rounded-sm px-2 text-[11px] font-semibold text-white outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ width: `${pct}%`, backgroundColor: p.color }}
                >
                  {pct >= 12 && <span className="truncate">{Math.round(pct)} %</span>}
                </div>
              </TooltipTrigger>
              <TooltipContent>{p.label}: {p.texto} ({Math.round(pct)} %)</TooltipContent>
            </Ayuda>
          );
        })}
      </div>
      <Leyenda items={partes.map((p) => ({ label: p.label, color: p.color }))} />
    </div>
  );
};

/**
 * Una fila de distribución 100 % (escala DIVERGENTE: polo bueno = chart-1, centro neutro, polo malo =
 * rojo). Para "¿cuánto tarda cada etapa?": no solo la mediana, también cuánto cae en la cola larga.
 */
export const FilaDistribucion: React.FC<{
  label: string;
  tramos: { label: string; n: number; color: string }[];
  derecha: React.ReactNode;
  detalle?: string;
}> = ({ label, tramos, derecha, detalle }) => {
  const total = tramos.reduce((a, t) => a + t.n, 0);
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 px-2 py-1.5">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium">{label}</div>
        {detalle && <div className="text-[10px] text-muted-foreground">{detalle}</div>}
      </div>
      <div className="flex h-6 w-full gap-0.5">
        {total === 0 ? (
          <div className="h-full w-full rounded-sm bg-muted" />
        ) : (
          tramos.filter((t) => t.n > 0).map((t) => {
            const pct = (t.n / total) * 100;
            return (
              <Ayuda key={t.label}>
                <TooltipTrigger asChild>
                  <div
                    tabIndex={0}
                    className={cn('flex min-w-0 items-center justify-center rounded-sm text-[10px] font-semibold outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                      // sumar-validar-ignorar: colores-crudos rótulo DENTRO de un relleno de serie (skill dataviz: blanco sobre el color)
                      t.color === C.medio ? 'text-foreground' : 'text-white')}
                    style={{ width: `${pct}%`, backgroundColor: t.color }}
                  >
                    {pct >= 14 && `${Math.round(pct)} %`}
                  </div>
                </TooltipTrigger>
                <TooltipContent>{label} · {t.label}: {t.n} ({Math.round(pct)} %)</TooltipContent>
              </Ayuda>
            );
          })
        )}
      </div>
      <div className="w-24 text-right text-sm font-semibold">{derecha}</div>
    </div>
  );
};

export interface FilaRanking {
  label: string;
  valor: number;
  texto: string;
  detalle?: { label: string; value: React.ReactNode }[];
}

/** Ranking de barras horizontales (§4.6 HBarList): una serie, un color, el valor en la punta. */
export const HBarList: React.FC<{ filas: FilaRanking[]; etiquetaValor: string; anchoEtiqueta?: number; color?: string }> = ({ filas, etiquetaValor, anchoEtiqueta = 132, color = C.serie }) => (
  <ResponsiveContainer width="100%" height={Math.max(120, filas.length * 34 + 8)}>
    <BarChart data={filas} layout="vertical" margin={{ top: 4, right: 64, left: 0, bottom: 0 }} barCategoryGap={8}>
      {/* sumar-validar-ignorar: numero-montos eje numérico de recharts, no un input */}
      <XAxis type="number" hide domain={[0, 'dataMax']} />
      <YAxis type="category" dataKey="label" width={anchoEtiqueta} tick={{ ...EJE_TICK, fill: C.tinta }} {...SIN_LINEA} interval={0} />
      <Tooltip
        cursor={CURSOR_BARRA}
        content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const f = payload[0].payload as FilaRanking;
          return (
            <TooltipShell title={f.label}>
              <TipRow label={etiquetaValor} value={f.texto} color={color} />
              {f.detalle?.map((d) => <TipRow key={d.label} label={d.label} value={d.value} />)}
            </TooltipShell>
          );
        }}
      />
      <Bar dataKey="valor" fill={color} radius={[0, 4, 4, 0]} maxBarSize={22} animationDuration={700}>
        <LabelList dataKey="texto" position="right" fontSize={11} fontWeight={600} fill={C.tinta} />
      </Bar>
    </BarChart>
  </ResponsiveContainer>
);
