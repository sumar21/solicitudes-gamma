import * as React from 'react';
import { TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent } from '../ui/card';
import { cn } from '../../lib/utils';
import { SERIES } from '../../lib/dataviz';

/**
 * Piezas del dashboard (DESIGN.md §4.6, con el protocolo dataviz de §10.0). Los gráficos usan los
 * tokens de `lib/dataviz.ts` (cambian solos de día a noche); el color de la serie es `chart-1`, validado
 * con el script de la skill dataviz contra la card de día y de noche.
 */

// Ejes y marcas comunes (§10.0.4: grilla sólida y tenue, barras ≤ 24 px, punta redondeada de 4 px).
export const EJE_TICK = { fontSize: 11, fill: 'var(--color-muted-foreground)' } as const;
export const SIN_LINEA = { axisLine: false as const, tickLine: false as const };
export const GRILLA = { stroke: 'var(--color-border)', vertical: false } as const;
export const CURSOR_BARRA = { fill: 'var(--color-muted)', opacity: 0.6 } as const;
export const COLOR_SERIE = SERIES[0];

/** Encabezado de sección: ícono de marca + texto micro (§4.6). */
export const SectionTitle: React.FC<{ icon: LucideIcon; children: React.ReactNode; right?: React.ReactNode }> = ({ icon: Icon, children, right }) => (
  <div className="mb-4 flex items-start justify-between gap-3">
    <div className="flex items-center gap-2">
      <Icon className="size-4 shrink-0 text-brand" aria-hidden="true" />
      <h3 className="text-xs font-bold tracking-wider text-muted-foreground uppercase">{children}</h3>
    </div>
    {right}
  </div>
);

/** Pill de tendencia vs el período anterior. `mejorSiSube` define si subir es verde (cantidad) o rojo (espera). */
export const DeltaChip: React.FC<{ valor: number; label: string; mejorSiSube?: boolean }> = ({ valor, label, mejorSiSube = true }) => {
  const sube = valor >= 0;
  const bueno = sube === mejorSiSube || valor === 0;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', bueno ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
      {sube ? <TrendingUp className="size-3.5" aria-hidden="true" /> : <TrendingDown className="size-3.5" aria-hidden="true" />}
      <span className="tabular-nums">{sube ? '+' : ''}{Math.round(valor)} %</span>
      <span className="font-normal text-muted-foreground">{label}</span>
    </span>
  );
};

/** Tarjeta de métrica canónica (§4.6 KpiCard): ícono + label micro, valor grande, pie opcional. */
export const KpiCard: React.FC<{
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  accent?: boolean;
  delta?: React.ReactNode;
  sub?: React.ReactNode;
  title?: string;
}> = ({ icon: Icon, label, value, accent, delta, sub, title }) => (
  <Card className={cn(accent && 'border-brand/20 bg-brand/[0.03]')} title={title}>
    <CardContent className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className={cn('size-4 shrink-0', accent && 'text-brand')} aria-hidden="true" />
        <span className="truncate text-[11px] font-semibold tracking-wider uppercase">{label}</span>
      </div>
      <div className={cn('mt-1.5 text-2xl font-bold tracking-tight', accent && 'text-brand')}>{value}</div>
      {(delta || sub) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2.5 text-xs text-muted-foreground">
          {delta}
          {sub && <span className="min-w-0">{sub}</span>}
        </div>
      )}
    </CardContent>
  </Card>
);

/** Tooltip de recharts (§4.6): siempre TooltipShell + TipRow, nunca el default. */
export const TooltipShell: React.FC<{ title?: React.ReactNode; children: React.ReactNode }> = ({ title, children }) => (
  <div className="min-w-[160px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
    {title && <p className="mb-1.5 font-semibold">{title}</p>}
    <div className="space-y-1">{children}</div>
  </div>
);
export const TipRow: React.FC<{ label: React.ReactNode; value: React.ReactNode; color?: string }> = ({ label, value, color }) => (
  <div className="flex items-center gap-3">
    {color && <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />}
    <span className="text-muted-foreground">{label}</span>
    <span className="ml-auto font-semibold tabular-nums">{value}</span>
  </div>
);

/** Chart dentro de una Card (§4.6 "la receta que importa"): p-5, SectionTitle, alto fijo, vacío adentro. */
export const ChartCard: React.FC<{
  icon: LucideIcon;
  titulo: string;
  bajada?: React.ReactNode;
  vacio?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ icon, titulo, bajada, vacio, className, children }) => (
  <Card className={className}>
    <CardContent className="p-5">
      <SectionTitle icon={icon}>{titulo}</SectionTitle>
      {bajada && <p className="-mt-2 mb-4 text-xs text-muted-foreground">{bajada}</p>}
      {vacio ? <p className="py-8 text-center text-sm text-muted-foreground">Sin datos en el período</p> : children}
    </CardContent>
  </Card>
);

export interface FilaRanking {
  label: string;
  valor: number;
  /** Texto del valor al final de la barra y en el tooltip ("12 min", "34"). */
  texto: string;
  /** Filas extra del tooltip. */
  detalle?: { label: string; value: React.ReactNode }[];
}

/**
 * Ranking de barras horizontales (§4.6 HBarList): una sola serie, un solo color (§10.0.4: nunca
 * shade(i) en barras nominales), etiqueta del valor al final, tooltip con el detalle.
 */
export const HBarList: React.FC<{ filas: FilaRanking[]; etiquetaValor: string; anchoEtiqueta?: number }> = ({ filas, etiquetaValor, anchoEtiqueta = 132 }) => (
  <ResponsiveContainer width="100%" height={Math.max(120, filas.length * 36 + 8)}>
    <BarChart data={filas} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }} barCategoryGap={8}>
      <XAxis type="number" hide domain={[0, 'dataMax']} />
      <YAxis type="category" dataKey="label" width={anchoEtiqueta} tick={{ ...EJE_TICK, fill: 'var(--color-foreground)' }} {...SIN_LINEA} interval={0} />
      <Tooltip
        cursor={CURSOR_BARRA}
        content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const f = payload[0].payload as FilaRanking;
          return (
            <TooltipShell title={f.label}>
              <TipRow label={etiquetaValor} value={f.texto} color={COLOR_SERIE} />
              {f.detalle?.map((d) => <TipRow key={d.label} label={d.label} value={d.value} />)}
            </TooltipShell>
          );
        }}
      />
      <Bar dataKey="valor" fill={COLOR_SERIE} radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false}>
        <LabelList dataKey="texto" position="right" fontSize={11} fill="var(--color-foreground)" />
      </Bar>
    </BarChart>
  </ResponsiveContainer>
);
