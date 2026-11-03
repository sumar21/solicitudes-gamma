
import React, { useEffect, useMemo, useState } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, ReferenceDot, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { Activity, ArrowRight, BedDouble, CalendarRange, CheckCircle2, Hourglass, RefreshCw, Route, Timer, XCircle } from 'lucide-react';
import { Ticket, TicketStatus, WorkflowType } from '../types';
import { Card } from '../components/ui/card';
import { DateRangePicker } from '../components/ui/date-picker';
import { StatusBadge } from '../components/ui/status-badge';
import { Vacio } from '../components/ui/estados';
import { ESTADOS_TICKET } from '../lib/estados';
import { aIso, deIso } from '../lib/fechaIso';
import { diaMes, fecha, fechaHora, numero } from '../lib/formato';
import { cn, formatBedName } from '../lib/utils';
import {
  BarraSegmentada, C, CURSOR_BARRA, ChartCard, Delta, EJE_TICK, FilaDistribucion, GRILLA, HBarList, Leyenda, SIN_LINEA,
  StatTile, TipRow, TooltipShell, type FilaRanking,
} from '../components/dashboard/shared';

interface DashboardViewProps {
  tickets: Ticket[];
  /** Recarga el histórico. El Monitor ya NO se pollea: se carga al entrar y con este botón. */
  onRefresh?: () => void | Promise<void>;
  refreshing?: boolean;
  /** Pide al hook cargar el histórico de un rango [from,to] (ART) SERVER-SIDE. */
  onRangeChange?: (from: string, to: string) => void;
}

// ── Fechas (YYYY-MM-DD locales = hora del dispositivo = ART en uso real) ──
const isoToday = (): string => aIso(new Date());
const shiftDays = (iso: string, n: number): string => {
  const d = deIso(iso)!;
  return aIso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};
const daysInclusive = (start: string, end: string): number => {
  const [ys, ms, ds] = start.split('-').map(Number);
  const [ye, me, de] = end.split('-').map(Number);
  return Math.max(0, (Date.UTC(ye, me - 1, de) - Date.UTC(ys, ms - 1, ds)) / 86_400_000) + 1;
};
const diaDe = (t: Ticket) => (t.date || t.createdAt || '').slice(0, 10);
// El ticket pertenece al rango si su fecha de inicio cae en [start, end] (misma lógica que HistoryView).
const inRange = (t: Ticket, start: string, end: string): boolean => {
  const d = diaDe(t);
  return !!d && d >= start && d <= end;
};

// ── Tiempos ──
// Minutos entre dos marcas; se descarta lo negativo o de más de un día (carga tardía o dato roto) para
// que un valor raro no mueva la mediana.
const minutos = (desde?: string, hasta?: string): number | null => {
  if (!desde || !hasta) return null;
  const m = (new Date(hasta).getTime() - new Date(desde).getTime()) / 60_000;
  return Number.isFinite(m) && m >= 0 && m <= 24 * 60 ? m : null;
};
const percentil = (valores: number[], p: number): number | null => {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const i = (v.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
};
const mediana = (v: number[]) => percentil(v, 0.5);
const soloNum = (v: (number | null)[]) => v.filter((x): x is number => x != null);
/** "12 min", "1 h 05". */
const enMin = (m: number | null): string => {
  if (m == null) return '—';
  const r = Math.round(m);
  return r < 60 ? `${r} min` : `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, '0')}`;
};
/** Partes de "enMin" para la cifra grande: valor + unidad aparte. */
const partesMin = (m: number | null): { valor: string; unidad?: string } => {
  if (m == null) return { valor: '—' };
  const r = Math.round(m);
  return r < 60 ? { valor: String(r), unidad: 'min' } : { valor: `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, '0')}` };
};
const cambio = (actual: number | null, anterior: number | null): number | null =>
  actual == null || anterior == null || anterior === 0 ? null : ((actual - anterior) / anterior) * 100;

/** Las etapas de un traslado: la marca que abre y la que cierra cada una. Las urgencias no entran. */
const ETAPAS = [
  { id: 'habitacion', label: 'Espera de habitación', desde: (t: Ticket) => t.createdAt, hasta: (t: Ticket) => t.cleaningDoneAt },
  { id: 'inicio', label: 'Espera de inicio', desde: (t: Ticket) => t.cleaningDoneAt ?? t.createdAt, hasta: (t: Ticket) => t.transportStartedAt },
  { id: 'traslado', label: 'Traslado', desde: (t: Ticket) => t.transportStartedAt, hasta: (t: Ticket) => t.receptionConfirmedAt },
  { id: 'consolidacion', label: 'Consolidación', desde: (t: Ticket) => t.porConsolidarAt ?? t.receptionConfirmedAt, hasta: (t: Ticket) => t.completedAt },
] as const;
const pedidoACama = (t: Ticket) => (t.urgencia ? null : minutos(t.createdAt, t.receptionConfirmedAt));

/** Tramos de la escala divergente de espera: polo bueno / centro neutro / polo malo. */
const TRAMOS = [
  { label: 'Hasta 10 min', color: C.serie, cae: (m: number) => m <= 10 },
  { label: '10 a 30 min', color: C.medio, cae: (m: number) => m > 10 && m <= 30 },
  { label: 'Más de 30 min', color: C.lento, cae: (m: number) => m > 30 },
] as const;

/** Tipos de traslado con su color FIJO (el color sigue a la entidad, no al ranking). */
const TIPOS = [
  { label: 'Traslado interno', color: C.categorias[0], es: (w: WorkflowType) => w === WorkflowType.INTERNAL || w === WorkflowType.ROOM_CHANGE },
  { label: 'Sala de espera', color: C.categorias[1], es: (w: WorkflowType) => w === WorkflowType.ITR_TO_FLOOR },
  { label: 'Ingreso a ITR', color: C.categorias[2], es: (w: WorkflowType) => w === WorkflowType.INGRESO_A_ITR },
  { label: 'Pre-ticket', color: C.categorias[3], es: (w: WorkflowType) => w === WorkflowType.PRE_TICKET },
] as const;

export const DashboardView: React.FC<DashboardViewProps> = ({ tickets, onRefresh, refreshing, onRangeChange }) => {
  const today = isoToday();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  // Cada vez que cambia el período, pide al hook cargar el histórico SERVER-SIDE, con el período
  // anterior de igual duración (para comparar). Las colas ("ahora") no dependen del rango.
  useEffect(() => {
    if (!onRangeChange) return;
    const len = daysInclusive(startDate, endDate);
    const prevEnd = shiftDays(startDate, -1);
    onRangeChange(shiftDays(prevEnd, -(len - 1)), endDate);
  }, [startDate, endDate, onRangeChange]);

  const presets = [
    { key: 'today', label: 'Hoy', start: today, end: today, previo: 'ayer' },
    { key: '7d', label: '7 días', start: shiftDays(today, -6), end: today, previo: 'los 7 días anteriores' },
    { key: '30d', label: '30 días', start: shiftDays(today, -29), end: today, previo: 'los 30 días anteriores' },
  ] as const;
  const preset = presets.find(p => p.start === startDate && p.end === endDate);
  const dias = daysInclusive(startDate, endDate);
  const porHoras = dias === 1;
  const periodoLabel = preset?.key === 'today' ? 'Hoy' : preset ? `Últimos ${preset.label}` : `${fecha(deIso(startDate)!)} – ${fecha(deIso(endDate)!)}`;
  const contra = `vs. ${preset?.previo ?? 'el período anterior'}`;

  const d = useMemo(() => {
    const prevEnd = shiftDays(startDate, -1);
    const prevStart = shiftDays(prevEnd, -(dias - 1));
    const actual = tickets.filter(t => inRange(t, startDate, endDate));
    const anterior = tickets.filter(t => inRange(t, prevStart, prevEnd));

    // Baldes: horas (un día) o días; el período anterior se alinea punto a punto.
    const nB = porHoras ? 24 : dias;
    const balde = (t: Ticket, desde: string): number => {
      if (porHoras) { const h = new Date(t.createdAt).getHours(); return Number.isNaN(h) ? -1 : h; }
      return daysInclusive(desde, diaDe(t)) - 1;
    };
    const agrupar = (set: Ticket[], desde: string) => {
      const g: Ticket[][] = Array.from({ length: nB }, () => []);
      for (const t of set) { const b = balde(t, desde); if (b >= 0 && b < nB) g[b].push(t); }
      return g;
    };
    const gA = agrupar(actual, startDate);
    const gP = agrupar(anterior, prevStart);
    const etiqueta = (i: number) => (porHoras ? `${String(i).padStart(2, '0')} h` : diaMes(deIso(shiftDays(startDate, i))!));

    const serie = gA.map((g, i) => ({
      i,
      label: etiqueta(i),
      titulo: porHoras ? `${etiqueta(i)} a ${String(i + 1).padStart(2, '0')} h` : fecha(deIso(shiftDays(startDate, i))!),
      actual: g.length,
      anterior: gP[i]?.length ?? 0,
    }));
    const pico = serie.reduce((a, b) => (b.actual > a.actual ? b : a), serie[0]);

    const tiempos = (set: Ticket[]) => soloNum(set.map(pedidoACama));
    const etapa = (set: Ticket[], e: typeof ETAPAS[number]) => soloNum(set.filter(t => !t.urgencia).map(t => minutos(e.desde(t), e.hasta(t))));

    const etapas = ETAPAS.map(e => {
      const v = etapa(actual, e);
      return { ...e, n: v.length, mediana: mediana(v), p90: percentil(v, 0.9), tramos: TRAMOS.map(tr => ({ label: tr.label, color: tr.color, n: v.filter(tr.cae).length })) };
    });

    // Pedidos por hora del día (siempre por hora, sobre todo el período).
    const horas = Array.from({ length: 24 }, (_, h) => ({ h, label: `${String(h).padStart(2, '0')} h`, n: 0 }));
    for (const t of actual) { const h = new Date(t.createdAt).getHours(); if (!Number.isNaN(h)) horas[h].n++; }
    const horaPico = horas.reduce((a, b) => (b.n > a.n ? b : a), horas[0]);

    // Destinos con más espera de habitación (mediana; al menos 2 traslados para que sea un dato).
    const porSector = new Map<string, number[]>();
    for (const t of actual) {
      if (t.urgencia || !t.destinationSector) continue;
      const m = minutos(t.createdAt, t.cleaningDoneAt);
      if (m != null) porSector.set(t.destinationSector, [...(porSector.get(t.destinationSector) ?? []), m]);
    }
    const sectores = [...porSector.entries()]
      .filter(([, v]) => v.length >= 2)
      .map(([s, v]) => ({ s: formatBedName(s), med: mediana(v)!, n: v.length }))
      .sort((a, b) => b.med - a.med)
      .slice(0, 6);

    const cancel = (set: Ticket[]) => set.filter(t => t.status === TicketStatus.REJECTED).length;
    const consolidTarde = actual.filter(t => !t.urgencia && (minutos(t.porConsolidarAt ?? t.receptionConfirmedAt, t.completedAt) ?? 0) > 15).length;

    return {
      actual, anterior, serie, pico, horas, horaPico, sectores, etapas,
      tipos: TIPOS.map(tp => ({ ...tp, n: actual.filter(t => tp.es(t.workflow)).length })),
      total: { med: mediana(tiempos(actual)), p90: percentil(tiempos(actual), 0.9), n: tiempos(actual).length, medPrev: mediana(tiempos(anterior)) },
      sparks: {
        volumen: gA.map(g => g.length),
        total: gA.map(g => mediana(tiempos(g))),
        habitacion: gA.map(g => mediana(etapa(g, ETAPAS[0]))),
        consolidacion: gA.map(g => mediana(etapa(g, ETAPAS[3]))),
        cancelados: gA.map(g => cancel(g)),
      },
      prev: {
        habitacion: mediana(etapa(anterior, ETAPAS[0])),
        consolidacion: mediana(etapa(anterior, ETAPAS[3])),
        tasaCancel: anterior.length ? cancel(anterior) / anterior.length : null,
      },
      cancelados: cancel(actual),
      tasaCancel: actual.length ? cancel(actual) / actual.length : null,
      consolidTarde,
      consolidados: actual.filter(t => t.status === TicketStatus.COMPLETED).length,
      activos: actual.filter(t => t.status !== TicketStatus.COMPLETED && t.status !== TicketStatus.REJECTED).length,
      urgencias: actual.filter(t => t.urgencia).length,
    };
  }, [tickets, startDate, endDate, dias, porHoras]);

  // Colas operativas: siempre en vivo, no dependen del período.
  const live = useMemo(() => ({
    pending: tickets.filter(t => t.status === TicketStatus.WAITING_CONSOLIDATION),
    inProcess: tickets.filter(t => t.status === TicketStatus.WAITING_ROOM || t.status === TicketStatus.IN_TRANSIT || t.status === TicketStatus.IN_TRANSPORT),
  }), [tickets]);

  // ── Lecturas (el hallazgo de cada gráfico, en una oración) ──
  const hab = d.etapas[0];
  const colaLarga = [...d.etapas].filter(e => e.n > 0).map(e => ({ e, pct: e.tramos[2].n / e.n })).sort((a, b) => b.pct - a.pct)[0];
  const tiposOrden = [...d.tipos].filter(t => t.n > 0).sort((a, b) => b.n - a.n);
  const pctHoraPico = d.actual.length ? Math.round((d.horaPico.n / d.actual.length) * 100) : 0;
  const deltaVol = cambio(d.actual.length, d.anterior.length);
  const heroe = partesMin(d.total.med);

  return (
    <div className={cn('flex w-full flex-col gap-4 p-3 pb-8 transition-opacity duration-300 md:p-8', refreshing && 'opacity-60')}>
      {/* HEADER + filtros en UNA fila arriba de todo lo que acotan (skill: interaction) */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="hidden md:block">
          <div className="flex items-center gap-2.5">
            <h2 className="text-2xl font-bold tracking-tight">Monitor</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/[0.08] px-2.5 py-0.5 text-[11px] font-semibold text-brand">
              <CalendarRange className="size-3.5" aria-hidden="true" />{periodoLabel}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">Cuánto tarda un traslado, dónde se va el tiempo y cuándo hay más pedidos.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <div className="inline-flex items-center rounded-lg bg-muted p-1" role="group" aria-label="Período">
            {presets.map(p => (
              <button
                key={p.key}
                type="button"
                aria-pressed={preset?.key === p.key}
                onClick={() => { setStartDate(p.start); setEndDate(p.end); }}
                className={cn('rounded-md px-3 py-1 text-sm font-medium transition-all outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                  preset?.key === p.key ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}
              >
                {p.label}
              </button>
            ))}
          </div>
          <DateRangePicker
            className="h-9 w-auto min-w-56"
            value={{ from: deIso(startDate), to: deIso(endDate) }}
            onChange={(r) => { if (r?.from) { setStartDate(aIso(r.from)); setEndDate(aIso(r.to ?? r.from)); } }}
          />
          {onRefresh && (
            <button
              type="button"
              onClick={() => onRefresh()}
              disabled={refreshing}
              aria-label="Actualizar"
              title="Actualizar"
              className="flex size-9 items-center justify-center rounded-lg border bg-background text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
            </button>
          )}
        </div>
      </div>

      {/* CIFRA HÉROE + 4 stat tiles (skill: una sola cifra héroe por vista) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          heroe
          className="col-span-2 md:col-span-3 xl:col-span-2"
          icono={Timer}
          label="Del pedido a la cama"
          ayuda="Mediana desde que se pide el traslado hasta que el paciente se recibe en la cama de destino. La mitad de los traslados tarda menos. No incluye urgencias."
          valor={heroe.valor}
          unidad={heroe.unidad}
          delta={<Delta valor={cambio(d.total.med, d.total.medPrev)} mejorSiSube={false} contra={contra} />}
          spark={d.sparks.total}
          sub={d.total.n ? <>9 de cada 10 en menos de <b className="font-semibold text-foreground">{enMin(d.total.p90)}</b> · {numero(d.total.n)} traslados recibidos</> : 'Todavía no hay traslados recibidos en el período'}
        />
        <StatTile
          icono={Route}
          label="Traslados"
          valor={numero(d.actual.length)}
          delta={<Delta valor={deltaVol} contra={contra} />}
          spark={d.sparks.volumen}
          sub={`${numero(d.consolidados)} consolidados · ${numero(d.activos)} activos`}
        />
        <StatTile
          icono={BedDouble}
          label="Espera de habitación"
          ayuda="Mediana desde el pedido hasta que la habitación de destino quedó lista. Solo los traslados que tuvieron que esperar."
          valor={enMin(hab.mediana)}
          delta={<Delta valor={cambio(hab.mediana, d.prev.habitacion)} mejorSiSube={false} contra={contra} />}
          spark={d.sparks.habitacion}
          sub={`${numero(hab.n)} esperaron habitación`}
        />
        <StatTile
          icono={Hourglass}
          label="Consolidación"
          ayuda="Mediana desde que el paciente se recibe hasta que se consolida en PROGAL. A los 15 min se avisa."
          valor={enMin(d.etapas[3].mediana)}
          delta={<Delta valor={cambio(d.etapas[3].mediana, d.prev.consolidacion)} mejorSiSube={false} contra={contra} />}
          spark={d.sparks.consolidacion}
          sub={d.consolidTarde ? <span className="font-medium text-amber-700">{numero(d.consolidTarde)} pasaron los 15 min</span> : 'Ninguno pasó los 15 min'}
        />
        <StatTile
          icono={XCircle}
          label="Cancelados"
          valor={d.tasaCancel == null ? '—' : `${Math.round(d.tasaCancel * 100)} %`}
          delta={<Delta valor={cambio(d.tasaCancel, d.prev.tasaCancel)} mejorSiSube={false} contra={contra} />}
          spark={d.sparks.cancelados}
          sub={`${numero(d.cancelados)} de ${numero(d.actual.length)}`}
        />
      </div>

      {/* VOLUMEN (tendencia con el período anterior de fondo) + COMPOSICIÓN POR TIPO */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          titulo={porHoras ? 'Traslados por hora' : 'Traslados por día'}
          bajada={`${periodoLabel} contra ${preset?.previo ?? 'el período anterior'}`}
          vacio={!d.actual.length && !d.anterior.length}
          lectura={d.pico.actual > 0 ? <>El pico fue <b className="font-semibold">{porHoras ? `a las ${d.pico.label}` : `el ${d.pico.titulo}`}</b> con {numero(d.pico.actual)} traslados{deltaVol != null ? <>; en total, {deltaVol >= 0 ? '+' : ''}{Math.round(deltaVol)} % {contra}</> : null}.</> : undefined}
          tabla={{ columnas: [porHoras ? 'Hora' : 'Día', 'Período', 'Anterior'], filas: d.serie.map(s => [s.titulo, s.actual, s.anterior]) }}
        >
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={d.serie} margin={{ top: 22, right: 16, bottom: 0, left: -12 }}>
              <defs>
                <linearGradient id="volFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.serie} stopOpacity={0.14} />
                  <stop offset="100%" stopColor={C.serie} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRILLA} />
              <XAxis dataKey="label" tick={EJE_TICK} {...SIN_LINEA} interval="preserveStartEnd" minTickGap={16} dy={4} />
              <YAxis tick={EJE_TICK} {...SIN_LINEA} allowDecimals={false} width={40} tickCount={4} />
              <Tooltip
                cursor={{ stroke: C.grilla }}
                content={({ active, payload }) => active && payload?.length ? (
                  <TooltipShell title={payload[0].payload.titulo}>
                    <TipRow label="Período" value={numero(payload[0].payload.actual)} color={C.serie} />
                    <TipRow label="Anterior" value={numero(payload[0].payload.anterior)} color={C.comparar} punteada />
                  </TooltipShell>
                ) : null}
              />
              <Line type="monotone" dataKey="anterior" stroke={C.comparar} strokeWidth={2} strokeDasharray="4 3" dot={false} activeDot={{ r: 4 }} animationDuration={800} />
              <Area type="monotone" dataKey="actual" stroke={C.serie} strokeWidth={2} fill="url(#volFill)" dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: C.superficie }} animationDuration={800} />
              {d.pico.actual > 0 && (
                <ReferenceDot
                  x={d.pico.label}
                  y={d.pico.actual}
                  r={4}
                  fill={C.serie}
                  stroke={C.superficie}
                  strokeWidth={2}
                  label={{ value: `Pico: ${numero(d.pico.actual)}`, position: 'top', offset: 10, fill: C.tinta, fontSize: 11, fontWeight: 600 }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
          <Leyenda items={[{ label: periodoLabel, color: C.serie, linea: true }, { label: preset?.previo ? preset.previo.charAt(0).toUpperCase() + preset.previo.slice(1) : 'Período anterior', color: C.comparar, linea: true, punteada: true }]} />
        </ChartCard>

        <ChartCard
          titulo="Por tipo de traslado"
          bajada={`${numero(d.actual.length)} traslados`}
          vacio={!d.actual.length}
          lectura={tiposOrden[0] ? <><b className="font-semibold">{tiposOrden[0].label}</b> es el {Math.round((tiposOrden[0].n / d.actual.length) * 100)} % de los traslados.</> : undefined}
          tabla={{ columnas: ['Tipo', 'Traslados', '%'], filas: d.tipos.map(t => [t.label, t.n, `${d.actual.length ? Math.round((t.n / d.actual.length) * 100) : 0} %`]) }}
        >
          <BarraSegmentada partes={d.tipos.map(t => ({ label: t.label, valor: t.n, color: t.color, texto: `${numero(t.n)} traslados` }))} />
          <ul className="mt-4 space-y-1.5 px-2">
            {d.tipos.filter(t => t.n > 0).sort((a, b) => b.n - a.n).map(t => (
              <li key={t.label} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ backgroundColor: t.color }} aria-hidden="true" />{t.label}</span>
                <span className="font-semibold tabular-nums">{numero(t.n)}</span>
              </li>
            ))}
          </ul>
        </ChartCard>
      </div>

      {/* DÓNDE SE VA EL TIEMPO (distribución divergente por etapa) + PEDIDOS POR HORA (énfasis) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          titulo="¿Dónde se va el tiempo?"
          bajada="Cuánto tarda cada etapa, en tramos; a la derecha, la mediana"
          vacio={!d.etapas.some(e => e.n > 0)}
          lectura={colaLarga && colaLarga.pct > 0 ? <><b className="font-semibold">{colaLarga.e.label}</b> es la etapa con más cola larga: el {Math.round(colaLarga.pct * 100)} % tarda más de 30 min.</> : undefined}
          tabla={{
            columnas: ['Etapa', 'Mediana', 'p90', 'Hasta 10', '10 a 30', 'Más de 30'],
            filas: d.etapas.map(e => [e.label, enMin(e.mediana), enMin(e.p90), e.tramos[0].n, e.tramos[1].n, e.tramos[2].n]),
          }}
        >
          <div className="pt-3">
            {d.etapas.map(e => (
              <FilaDistribucion key={e.id} label={e.label} detalle={`${numero(e.n)} medidos`} tramos={e.tramos} derecha={enMin(e.mediana)} />
            ))}
          </div>
          <Leyenda items={TRAMOS.map(t => ({ label: t.label, color: t.color }))} />
        </ChartCard>

        <ChartCard
          titulo="Pedidos por hora del día"
          bajada="Todo el período, por hora en que se pidió el traslado"
          vacio={!d.actual.length}
          lectura={d.horaPico.n > 0 ? <>Entre las <b className="font-semibold">{d.horaPico.label.replace(' h', '')} y las {String(d.horaPico.h + 1).padStart(2, '0')} h</b> entra el {pctHoraPico} % de los pedidos.</> : undefined}
          tabla={{ columnas: ['Hora', 'Pedidos'], filas: d.horas.map(h => [h.label, h.n]) }}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={d.horas} margin={{ top: 22, right: 4, bottom: 0, left: -12 }} barCategoryGap={2}>
              <CartesianGrid {...GRILLA} />
              <XAxis dataKey="label" tick={EJE_TICK} {...SIN_LINEA} interval={2} dy={4} />
              <YAxis tick={EJE_TICK} {...SIN_LINEA} allowDecimals={false} width={40} tickCount={4} />
              <Tooltip
                cursor={CURSOR_BARRA}
                content={({ active, payload }) => active && payload?.length ? (
                  <TooltipShell title={`${payload[0].payload.label} a ${String(payload[0].payload.h + 1).padStart(2, '0')} h`}>
                    <TipRow label="Pedidos" value={numero(payload[0].payload.n)} color={payload[0].payload.h === d.horaPico.h ? C.serie : C.comparar} />
                  </TooltipShell>
                ) : null}
              />
              {/* Énfasis: la hora pico en el color de la serie, el resto en el gris de comparación. */}
              <Bar dataKey="n" radius={[4, 4, 0, 0]} maxBarSize={24} animationDuration={700}>
                {d.horas.map(h => <Cell key={h.h} fill={h.h === d.horaPico.h && h.n > 0 ? C.serie : C.comparar} />)}
                <LabelList dataKey="n" position="top" fontSize={11} fontWeight={600} fill={C.tinta} formatter={(v: unknown) => (v === d.horaPico.n && d.horaPico.n > 0 ? String(v) : '')} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* DESTINOS CON MÁS ESPERA + COLAS EN VIVO */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard
          titulo="Destinos con más espera"
          bajada="Mediana de espera de habitación por sector (2 traslados o más)"
          vacio={!d.sectores.length}
          lectura={d.sectores[0] && hab.mediana != null ? <><b className="font-semibold">{d.sectores[0].s}</b> espera {enMin(d.sectores[0].med)}, {enMin(Math.max(0, d.sectores[0].med - hab.mediana))} más que la mediana general.</> : undefined}
          tabla={{ columnas: ['Sector', 'Mediana', 'Traslados'], filas: d.sectores.map(s => [s.s, enMin(s.med), s.n]) }}
        >
          <HBarList
            etiquetaValor="Mediana"
            anchoEtiqueta={130}
            filas={d.sectores.map((s): FilaRanking => ({ label: s.s, valor: Math.round(s.med), texto: enMin(s.med), detalle: [{ label: 'Traslados', value: numero(s.n) }] }))}
          />
        </ChartCard>
        <ColaEnVivo icono={Hourglass} titulo="Admisión pendiente" bajada="Recibidos, falta consolidar en PROGAL" tickets={live.pending} vacio="No hay traslados por consolidar" />
        <ColaEnVivo icono={Activity} titulo="En ejecución" bajada="Esperando habitación, listos o en traslado" tickets={live.inProcess} vacio="No hay traslados en curso" conLimpieza />
      </div>

      <p className="text-xs text-muted-foreground/70">
        {periodoLabel} · {numero(d.actual.length)} traslados ({numero(d.urgencias)} urgencias, que no entran en los tiempos) · los tiempos son medianas: la mitad de los traslados tarda menos.
      </p>
    </div>
  );
};

/** Cola en vivo: card con la lista de traslados (filas de dos líneas, §7.2) y su conteo. */
const ColaEnVivo: React.FC<{
  icono: React.ComponentType<{ className?: string }>;
  titulo: string;
  bajada: string;
  tickets: Ticket[];
  vacio: string;
  conLimpieza?: boolean;
}> = ({ icono: Icono, titulo, bajada, tickets, vacio, conLimpieza }) => (
  <Card className="flex min-w-0 flex-col gap-0 py-0">
    <div className="flex items-start justify-between gap-3 p-4 pb-2">
      <div className="min-w-0">
        <h3 className="flex items-center gap-1.5 text-sm leading-tight font-semibold"><Icono className="size-4 text-brand" />{titulo}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{bajada}</p>
      </div>
      <span className="text-2xl font-bold">{numero(tickets.length)}</span>
    </div>
    <div className="flex-1 px-4 pb-4">
      {tickets.length === 0 ? (
        <Vacio icono={CheckCircle2} titulo={vacio} className="py-8" />
      ) : (
        <ul className="max-h-[300px] divide-y overflow-y-auto rounded-md border">
          {tickets.map(t => (
            <li key={t.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-[13px] hover:bg-muted/50">
              <div className="min-w-0">
                <div className="font-medium">{t.patientName}</div>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="truncate">{formatBedName(t.origin)}</span>
                  <ArrowRight className="size-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{t.destination ? formatBedName(t.destination) : 'Destino pendiente'}</span>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <StatusBadge tono={ESTADOS_TICKET[t.status].tono}>{ESTADOS_TICKET[t.status].label}</StatusBadge>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {conLimpieza && t.status === TicketStatus.WAITING_ROOM ? (t.isBedClean ? 'Cama limpia · ' : 'Cama sucia · ') : ''}{fechaHora(t.createdAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  </Card>
);
