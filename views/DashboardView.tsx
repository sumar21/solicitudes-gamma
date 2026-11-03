
import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Activity, AlarmClock, ArrowRight, BedDouble, CalendarRange, CheckCircle2, Clock, Hourglass, ListTree,
  MapPin, RefreshCw, Route, Timer, XCircle, type LucideIcon,
} from 'lucide-react';
import { Ticket, TicketStatus, WorkflowType } from '../types';
import { Card, CardContent } from '../components/ui/card';
import { DateRangePicker } from '../components/ui/date-picker';
import { StatusBadge } from '../components/ui/status-badge';
import { Vacio } from '../components/ui/estados';
import { ESTADOS_TICKET } from '../lib/estados';
import { aIso, deIso } from '../lib/fechaIso';
import { diaMes, fecha, fechaHora, numero } from '../lib/formato';
import { cn, formatBedName } from '../lib/utils';
import {
  COLOR_SERIE, CURSOR_BARRA, ChartCard, DeltaChip, EJE_TICK, GRILLA, HBarList, KpiCard, SIN_LINEA, SectionTitle,
  TipRow, TooltipShell, type FilaRanking,
} from '../components/dashboard/shared';

interface DashboardViewProps {
  tickets: Ticket[];
  /** Recarga el histórico. El Monitor ya NO se pollea: se carga al entrar y con este botón. */
  onRefresh?: () => void | Promise<void>;
  refreshing?: boolean;
  /** Pide al hook cargar el histórico de un rango [from,to] (ART) SERVER-SIDE. */
  onRangeChange?: (from: string, to: string) => void;
}

// ── Helpers de fecha (YYYY-MM-DD locales = hora del dispositivo = ART en uso real) ──
const isoToday = (): string => aIso(new Date());
const shiftDays = (iso: string, n: number): string => {
  const d = deIso(iso)!;
  return aIso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};
const daysInclusive = (start: string, end: string): number => {
  const [ys, ms, ds] = start.split('-').map(Number);
  const [ye, me, de] = end.split('-').map(Number);
  const diff = (Date.UTC(ye, me - 1, de) - Date.UTC(ys, ms - 1, ds)) / 86_400_000;
  return Math.max(0, diff) + 1;
};
// El ticket pertenece al rango si su fecha de inicio cae en [start, end].
// Misma lógica que HistoryView (slice de t.date) → ambas vistas cuentan igual.
const inRange = (t: Ticket, start: string, end: string): boolean => {
  const d = (t.date || t.createdAt || '').slice(0, 10);
  return !!d && d >= start && d <= end;
};

// ── Tiempos ──
// Minutos entre dos marcas; se descarta lo que no tiene sentido (negativo o más de un día: carga
// tardía o un dato roto) para que un valor raro no mueva la mediana.
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
/** "12 min", "1 h 05 min". */
const enMinutos = (m: number | null): string => {
  if (m == null) return '—';
  const r = Math.round(m);
  if (r < 60) return `${r} min`;
  return `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, '0')} min`;
};

const LABEL_WORKFLOW: Record<string, string> = {
  [WorkflowType.INTERNAL]: 'Traslado interno',
  [WorkflowType.ROOM_CHANGE]: 'Traslado interno',
  [WorkflowType.ITR_TO_FLOOR]: 'Sala de espera Admisión',
  [WorkflowType.INGRESO_A_ITR]: 'Ingreso a ITR',
  [WorkflowType.PRE_TICKET]: 'Pre-ticket',
};

/**
 * Las etapas de un traslado, con la marca de tiempo que abre y la que cierra cada una. Las urgencias no
 * entran (no tienen tramos de azafata: miden "hasta que Admisión la vincula").
 */
const ETAPAS = [
  { id: 'habitacion', label: 'Espera de habitación', desde: (t: Ticket) => t.createdAt, hasta: (t: Ticket) => t.cleaningDoneAt },
  { id: 'inicio', label: 'Espera de inicio', desde: (t: Ticket) => t.cleaningDoneAt ?? t.createdAt, hasta: (t: Ticket) => t.transportStartedAt },
  { id: 'traslado', label: 'Traslado', desde: (t: Ticket) => t.transportStartedAt, hasta: (t: Ticket) => t.receptionConfirmedAt },
  { id: 'consolidacion', label: 'Consolidación', desde: (t: Ticket) => t.porConsolidarAt ?? t.receptionConfirmedAt, hasta: (t: Ticket) => t.completedAt },
] as const;

/** Métricas de un período. */
function analizar(set: Ticket[]) {
  const normales = set.filter(t => !t.urgencia);
  const total = normales.map(t => minutos(t.createdAt, t.receptionConfirmedAt)).filter((m): m is number => m != null);
  const etapas = ETAPAS.map(e => {
    const v = normales.map(t => minutos(e.desde(t), e.hasta(t))).filter((m): m is number => m != null);
    return { ...e, n: v.length, mediana: mediana(v), p90: percentil(v, 0.9) };
  });
  const consolidacion = etapas.find(e => e.id === 'consolidacion')!;
  const consolidacionTarde = normales.filter(t => {
    const m = minutos(t.porConsolidarAt ?? t.receptionConfirmedAt, t.completedAt);
    return m != null && m > 15;
  }).length;
  const cancelados = set.filter(t => t.status === TicketStatus.REJECTED).length;
  return {
    cantidad: set.length,
    consolidados: set.filter(t => t.status === TicketStatus.COMPLETED).length,
    activos: set.filter(t => t.status !== TicketStatus.COMPLETED && t.status !== TicketStatus.REJECTED).length,
    urgencias: set.filter(t => t.urgencia).length,
    totalMediana: mediana(total),
    totalP90: percentil(total, 0.9),
    totalN: total.length,
    etapas,
    consolidacion,
    consolidacionTarde,
    cancelados,
    tasaCancelacion: set.length ? cancelados / set.length : 0,
  };
}

/** Cambio porcentual vs el período anterior; sin base de comparación, nada. */
const cambio = (actual: number | null, anterior: number | null): number | null =>
  actual == null || anterior == null || anterior === 0 ? null : ((actual - anterior) / anterior) * 100;

export const DashboardView: React.FC<DashboardViewProps> = ({ tickets, onRefresh, refreshing, onRangeChange }) => {
  const today = isoToday();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  // Cada vez que cambia el período, pide al hook cargar el histórico SERVER-SIDE. Se pide el rango
  // EXTENDIDO [prevStart .. end] porque las tendencias comparan contra el período anterior de igual
  // duración; si solo trajéramos [start..end] los deltas quedarían sin base. Las colas ("ahora") no
  // dependen del rango: salen del merge live del prop.
  useEffect(() => {
    if (!onRangeChange) return;
    const len = daysInclusive(startDate, endDate);
    const prevEnd = shiftDays(startDate, -1);
    const prevStart = shiftDays(prevEnd, -(len - 1));
    onRangeChange(prevStart, endDate);
  }, [startDate, endDate, onRangeChange]);

  const presets = [
    { key: 'today', label: 'Hoy', start: today, end: today },
    { key: '7d', label: '7 días', start: shiftDays(today, -6), end: today },
    { key: '30d', label: '30 días', start: shiftDays(today, -29), end: today },
  ] as const;
  const activePreset = presets.find(p => p.start === startDate && p.end === endDate)?.key ?? 'custom';
  const dias = daysInclusive(startDate, endDate);
  const periodLabel =
    activePreset === 'today' ? 'Hoy'
    : activePreset === '7d' ? 'Últimos 7 días'
    : activePreset === '30d' ? 'Últimos 30 días'
    : `${fecha(deIso(startDate)!)} – ${fecha(deIso(endDate)!)}`;

  // Período actual vs anterior de igual duración.
  const { set, actual, anterior } = useMemo(() => {
    const currentSet = tickets.filter(t => inRange(t, startDate, endDate));
    const prevEnd = shiftDays(startDate, -1);
    const prevStart = shiftDays(prevEnd, -(daysInclusive(startDate, endDate) - 1));
    return { set: currentSet, actual: analizar(currentSet), anterior: analizar(tickets.filter(t => inRange(t, prevStart, prevEnd))) };
  }, [tickets, startDate, endDate]);

  // ¿Dónde se va el tiempo? Mediana por etapa.
  const etapas: FilaRanking[] = actual.etapas
    .filter(e => e.mediana != null)
    .map(e => ({
      label: e.label,
      valor: Math.round(e.mediana!),
      texto: enMinutos(e.mediana),
      detalle: [
        { label: 'p90 (9 de cada 10)', value: enMinutos(e.p90) },
        { label: 'Traslados medidos', value: numero(e.n) },
      ],
    }));

  // Pedidos por hora del día (cuándo se concentran las solicitudes).
  const porHora = useMemo(() => {
    const c = Array.from({ length: 24 }, (_, h) => ({ hora: h, label: `${String(h).padStart(2, '0')} h`, cantidad: 0 }));
    for (const t of set) {
      const d = new Date(t.createdAt);
      if (!Number.isNaN(d.getTime())) c[d.getHours()].cantidad++;
    }
    return c;
  }, [set]);
  const horaPico = porHora.reduce((a, b) => (b.cantidad > a.cantidad ? b : a), porHora[0]);

  // Traslados por día (solo si el período tiene más de un día).
  const porDia = useMemo(() => {
    if (dias < 2) return [];
    return Array.from({ length: dias }, (_, i) => {
      const iso = shiftDays(startDate, i);
      return { iso, label: diaMes(deIso(iso)!), cantidad: set.filter(t => (t.date || t.createdAt || '').slice(0, 10) === iso).length };
    });
  }, [set, dias, startDate]);

  // Por tipo de traslado.
  const porTipo: FilaRanking[] = useMemo(() => {
    const c = new Map<string, number>();
    for (const t of set) {
      const l = LABEL_WORKFLOW[t.workflow] ?? 'Otro';
      c.set(l, (c.get(l) ?? 0) + 1);
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => ({
      label, valor: n, texto: numero(n),
      detalle: [{ label: 'Del total', value: `${Math.round((n / Math.max(1, set.length)) * 100)} %` }],
    }));
  }, [set]);

  // Sectores de destino con más espera de habitación (mediana; al menos 2 traslados para que sea un dato).
  const sectoresEspera: FilaRanking[] = useMemo(() => {
    const g = new Map<string, number[]>();
    for (const t of set) {
      if (t.urgencia || !t.destinationSector) continue;
      const m = minutos(t.createdAt, t.cleaningDoneAt);
      if (m == null) continue;
      g.set(t.destinationSector, [...(g.get(t.destinationSector) ?? []), m]);
    }
    return [...g.entries()]
      .filter(([, v]) => v.length >= 2)
      .map(([sector, v]) => ({ sector, med: mediana(v)!, n: v.length }))
      .sort((a, b) => b.med - a.med)
      .slice(0, 6)
      .map(r => ({
        label: formatBedName(r.sector), valor: Math.round(r.med), texto: enMinutos(r.med),
        detalle: [{ label: 'Traslados', value: numero(r.n) }],
      }));
  }, [set]);

  // Colas operativas: siempre en vivo, no dependen del período.
  const live = useMemo(() => ({
    pending: tickets.filter(t => t.status === TicketStatus.WAITING_CONSOLIDATION),
    inProcess: tickets.filter(t => t.status === TicketStatus.WAITING_ROOM || t.status === TicketStatus.IN_TRANSIT || t.status === TicketStatus.IN_TRANSPORT),
  }), [tickets]);

  const deltaCantidad = cambio(actual.cantidad, anterior.cantidad);
  const deltaTotal = cambio(actual.totalMediana, anterior.totalMediana);
  const etapaMasLarga = [...actual.etapas].filter(e => e.mediana != null).sort((a, b) => b.mediana! - a.mediana!)[0];

  return (
    <div className={cn('flex w-full flex-col gap-4 p-3 pb-8 md:p-8', refreshing && 'opacity-60 transition-opacity duration-300')}>
      {/* HEADER (§4.6): título + período + controles */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="hidden md:block">
          <div className="flex items-center gap-2.5">
            <h2 className="text-2xl font-bold tracking-tight">Monitor</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/[0.08] px-2.5 py-0.5 text-[11px] font-semibold text-brand">
              <CalendarRange className="size-3.5" aria-hidden="true" />{periodLabel}
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
                aria-pressed={activePreset === p.key}
                onClick={() => { setStartDate(p.start); setEndDate(p.end); }}
                className={cn('rounded-md px-3 py-1 text-sm font-medium transition-all outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                  activePreset === p.key ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}
              >
                {p.label}
              </button>
            ))}
          </div>
          <DateRangePicker
            className="h-9 w-auto min-w-56"
            aria-label="Período personalizado"
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

      {/* KPIs (§4.6): grid 2 → 3 → 5 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          icon={Route}
          label="Traslados"
          accent
          value={<span className="tabular-nums">{numero(actual.cantidad)}</span>}
          delta={deltaCantidad != null ? <DeltaChip valor={deltaCantidad} label="vs. anterior" /> : undefined}
          sub={`${numero(actual.consolidados)} consolidados · ${numero(actual.activos)} activos`}
        />
        <KpiCard
          icon={Timer}
          label="Del pedido a la cama"
          title="Mediana desde la solicitud hasta que el paciente se recibe en la cama de destino"
          value={enMinutos(actual.totalMediana)}
          delta={deltaTotal != null ? <DeltaChip valor={deltaTotal} label="vs. anterior" mejorSiSube={false} /> : undefined}
          sub={actual.totalP90 != null ? `9 de cada 10 en menos de ${enMinutos(actual.totalP90)}` : 'Sin traslados recibidos'}
        />
        <KpiCard
          icon={BedDouble}
          label="Espera de habitación"
          title="Mediana desde la solicitud hasta que la habitación de destino quedó lista"
          value={enMinutos(actual.etapas[0].mediana)}
          sub={`${numero(actual.etapas[0].n)} traslados esperaron habitación`}
        />
        <KpiCard
          icon={Hourglass}
          label="Consolidación"
          title="Mediana desde que el paciente se recibe hasta que se consolida en PROGAL"
          value={enMinutos(actual.consolidacion.mediana)}
          sub={actual.consolidacionTarde > 0
            ? <span className="font-medium text-amber-700">{numero(actual.consolidacionTarde)} pasaron los 15 min</span>
            : 'Ninguno pasó los 15 min'}
        />
        <KpiCard
          icon={XCircle}
          label="Cancelados"
          value={<span className="tabular-nums">{Math.round(actual.tasaCancelacion * 100)} %</span>}
          sub={`${numero(actual.cancelados)} de ${numero(actual.cantidad)}`}
        />
      </div>

      {/* Fila 1: dónde se va el tiempo (grande) + por tipo */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard
          icon={Clock}
          titulo="¿Dónde se va el tiempo?"
          bajada={etapaMasLarga ? <>Mediana por etapa. La más larga es <b className="font-semibold text-foreground">{etapaMasLarga.label.toLowerCase()}</b>.</> : 'Mediana por etapa.'}
          vacio={!etapas.length}
          className="lg:col-span-2"
        >
          <HBarList filas={etapas} etiquetaValor="Mediana" anchoEtiqueta={150} />
        </ChartCard>
        <ChartCard icon={ListTree} titulo="Por tipo de traslado" vacio={!porTipo.length}>
          <HBarList filas={porTipo} etiquetaValor="Traslados" anchoEtiqueta={150} />
        </ChartCard>
      </div>

      {/* Fila 2: pedidos por hora (grande) + sectores con más espera */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard
          icon={AlarmClock}
          titulo="Pedidos por hora del día"
          bajada={set.length ? <>El pico es a las <b className="font-semibold text-foreground">{horaPico.label}</b> ({numero(horaPico.cantidad)} pedidos).</> : undefined}
          vacio={!set.length}
          className="lg:col-span-2"
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={porHora} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid {...GRILLA} />
              <XAxis dataKey="label" tick={EJE_TICK} {...SIN_LINEA} interval={2} />
              <YAxis tick={EJE_TICK} {...SIN_LINEA} allowDecimals={false} width={40} />
              <Tooltip
                cursor={CURSOR_BARRA}
                content={({ active, payload }) => active && payload?.length ? (
                  <TooltipShell title={`${payload[0].payload.label} a ${String(payload[0].payload.hora + 1).padStart(2, '0')} h`}>
                    <TipRow label="Pedidos" value={numero(payload[0].payload.cantidad)} color={COLOR_SERIE} />
                  </TooltipShell>
                ) : null}
              />
              <Bar dataKey="cantidad" fill={COLOR_SERIE} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard
          icon={MapPin}
          titulo="Destinos con más espera"
          bajada="Mediana de espera de habitación, por sector."
          vacio={!sectoresEspera.length}
        >
          <HBarList filas={sectoresEspera} etiquetaValor="Mediana" anchoEtiqueta={130} />
        </ChartCard>
      </div>

      {/* Fila 3: volumen por día (solo con más de un día) */}
      {porDia.length > 0 && (
        <ChartCard icon={CalendarRange} titulo="Traslados por día" vacio={!set.length}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={porDia} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid {...GRILLA} />
              <XAxis dataKey="label" tick={EJE_TICK} {...SIN_LINEA} interval="preserveStartEnd" minTickGap={12} />
              <YAxis tick={EJE_TICK} {...SIN_LINEA} allowDecimals={false} width={40} />
              <Tooltip
                cursor={CURSOR_BARRA}
                content={({ active, payload }) => active && payload?.length ? (
                  <TooltipShell title={fecha(deIso(payload[0].payload.iso)!)}>
                    <TipRow label="Traslados" value={numero(payload[0].payload.cantidad)} color={COLOR_SERIE} />
                  </TooltipShell>
                ) : null}
              />
              <Bar dataKey="cantidad" fill={COLOR_SERIE} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* AHORA: colas en vivo (no dependen del período) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ColaEnVivo
          icon={Hourglass}
          titulo="Admisión pendiente"
          bajada="Recibidos, falta consolidar en PROGAL"
          tickets={live.pending}
          vacio="No hay traslados por consolidar"
        />
        <ColaEnVivo
          icon={Activity}
          titulo="En ejecución"
          bajada="Esperando habitación, listos o en traslado"
          tickets={live.inProcess}
          vacio="No hay traslados en curso"
          conLimpieza
        />
      </div>

      <p className="text-xs text-muted-foreground/70">
        {periodLabel} · {numero(actual.cantidad)} traslados ({numero(actual.urgencias)} urgencias, que no entran en los tiempos por etapa) · los tiempos son medianas: la mitad de los traslados tarda menos.
      </p>
    </div>
  );
};

/** Cola en vivo: card con la lista de traslados (2 líneas por fila, §7.2) y su conteo. */
const ColaEnVivo: React.FC<{
  icon: LucideIcon;
  titulo: string;
  bajada: string;
  tickets: Ticket[];
  vacio: string;
  conLimpieza?: boolean;
}> = ({ icon, titulo, bajada, tickets, vacio, conLimpieza }) => (
  <Card>
    <CardContent className="p-5">
      <SectionTitle icon={icon} right={<span className="text-sm font-bold tabular-nums">{numero(tickets.length)}</span>}>{titulo}</SectionTitle>
      <p className="-mt-2 mb-3 text-xs text-muted-foreground">{bajada}</p>
      {tickets.length === 0 ? (
        <Vacio icono={CheckCircle2} titulo={vacio} className="py-8" />
      ) : (
        <ul className="max-h-[360px] divide-y overflow-y-auto rounded-md border">
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
    </CardContent>
  </Card>
);
