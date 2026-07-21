
import React, { useMemo, useState } from 'react';
import { Ticket, TicketStatus, WorkflowType } from '../types';
import { Activity, ArrowRightLeft, Clock, CheckCircle2, Calendar as CalendarIcon } from '../components/Icons';
import { RefreshCw } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Popover, PopoverTrigger, PopoverContent } from '../components/ui/popover';
import { Calendar } from '../components/ui/calendar';
import { StatusBadge } from '../components/StatusBadge';
import { StatCard } from '../components/dashboard/StatCard';
import { VolumeBarChart } from '../components/dashboard/VolumeBarChart';
import { StatusDonutChart } from '../components/dashboard/StatusDonutChart';
import { calculateTicketMetrics, formatBedName, formatDateReadable, formatDateTime, cn } from '../lib/utils';

interface DashboardViewProps {
  tickets: Ticket[];
  /** Recarga el histórico. El Monitor ya NO se pollea: se carga al entrar y con este botón. */
  onRefresh?: () => void | Promise<void>;
  refreshing?: boolean;
}

// ── Helpers de fecha (YYYY-MM-DD locales = hora del dispositivo = ART en uso real) ──
const isoToday = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const shiftDays = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};
const daysInclusive = (start: string, end: string): number => {
  const [ys, ms, ds] = start.split('-').map(Number);
  const [ye, me, de] = end.split('-').map(Number);
  const diff = (Date.UTC(ye, me - 1, de) - Date.UTC(ys, ms - 1, ds)) / 86_400_000;
  return Math.max(0, diff) + 1;
};
// El ticket pertenece al rango si su fecha de inicio (createdAt) cae en [start, end].
// Misma lógica que HistoryView (slice de t.date) → ambas vistas cuentan igual.
const inRange = (t: Ticket, start: string, end: string): boolean => {
  const d = (t.date || '').slice(0, 10);
  return !!d && d >= start && d <= end;
};

// Cambio porcentual real vs período anterior. `betterWhenUp` define si subir es bueno
// (verde) o malo (rojo). Devuelve undefined cuando no hay base de comparación.
function pctTrend(
  current: number,
  prev: number,
  betterWhenUp: boolean,
): { value: string; positive: boolean } | undefined {
  if (prev === 0) return undefined;
  const diff = current - prev;
  const pct = Math.round((diff / prev) * 100);
  return { value: `${pct > 0 ? '+' : ''}${pct}%`, positive: betterWhenUp ? diff >= 0 : diff <= 0 };
}

// Métricas analíticas de un subconjunto de tickets (un período).
function computeStats(subset: Ticket[]) {
  const active = subset.filter(
    t => t.status !== TicketStatus.COMPLETED && t.status !== TicketStatus.REJECTED,
  );
  const completed = subset.filter(t => t.status === TicketStatus.COMPLETED);

  const completedWithTime = completed.filter(t => t.createdAt && t.completedAt);
  const totalCycleTime = completedWithTime.reduce(
    (acc, t) => acc + calculateTicketMetrics(t).totalCycleTime,
    0,
  );
  const avgWait = completedWithTime.length > 0
    ? Math.round(totalCycleTime / completedWithTime.length)
    : null;

  return { activeCount: active.length, completedCount: completed.length, avgWait };
}

export const DashboardView: React.FC<DashboardViewProps> = ({ tickets, onRefresh, refreshing }) => {
  const today = isoToday();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [openStart, setOpenStart] = useState(false);
  const [openEnd, setOpenEnd] = useState(false);

  // Presets → setean el rango. El activo se deriva comparando contra el rango actual.
  const presets = [
    { key: 'today', label: 'Hoy',      start: today,                end: today },
    { key: '7d',    label: '7 días',   start: shiftDays(today, -6), end: today },
    { key: '30d',   label: '30 días',  start: shiftDays(today, -29), end: today },
  ] as const;
  const activePreset = presets.find(p => p.start === startDate && p.end === endDate)?.key ?? 'custom';

  const periodLabel = useMemo(() => {
    switch (activePreset) {
      case 'today': return 'hoy';
      case '7d':    return 'últimos 7 días';
      case '30d':   return 'últimos 30 días';
      default:      return `${formatDateReadable(startDate)} – ${formatDateReadable(endDate)}`;
    }
  }, [activePreset, startDate, endDate]);

  // Período actual vs período anterior de igual duración (para tendencias reales).
  const { current, trends } = useMemo(() => {
    const currentSet = tickets.filter(t => inRange(t, startDate, endDate));
    const len = daysInclusive(startDate, endDate);
    const prevEnd = shiftDays(startDate, -1);
    const prevStart = shiftDays(prevEnd, -(len - 1));
    const prevSet = tickets.filter(t => inRange(t, prevStart, prevEnd));

    const cur = computeStats(currentSet);
    const prv = computeStats(prevSet);

    return {
      current: { ...cur, set: currentSet },
      trends: {
        active: pctTrend(cur.activeCount, prv.activeCount, false), // menos activos = mejor
        wait: cur.avgWait != null && prv.avgWait != null
          ? pctTrend(cur.avgWait, prv.avgWait, false)              // menos espera = mejor
          : undefined,
        productivity: pctTrend(cur.completedCount, prv.completedCount, true), // más = mejor
      },
    };
  }, [tickets, startDate, endDate]);

  // Worklists operativas: siempre en vivo (estado "ahora"), no dependen del período.
  const live = useMemo(() => ({
    pending: tickets.filter(t => t.status === TicketStatus.WAITING_CONSOLIDATION),
    inProcess: tickets.filter(
      t => t.status === TicketStatus.WAITING_ROOM
        || t.status === TicketStatus.IN_TRANSIT
        || t.status === TicketStatus.IN_TRANSPORT, // "En Traslado": el ticket sigue en ejecución mientras la azafata lo traslada
    ),
  }), [tickets]);

  // Gráficos: sobre el set del período seleccionado. Workflows vigentes: Traslado Interno
  // (ROOM_CHANGE legacy se pliega acá, se muestra igual en toda la app), Sala de Espera
  // Admisión e Ingreso a ITR. Bajo Traslado Interno se desglosan los motivos (changeReason),
  // contados dinámicamente para captar también motivos viejos ("Pase a piso", etc.).
  const volumeData = useMemo(() => {
    const internalSet = current.set.filter(
      t => t.workflow === WorkflowType.INTERNAL || t.workflow === WorkflowType.ROOM_CHANGE,
    );
    const reasonCounts = new Map<string, number>();
    for (const t of internalSet) {
      const r = (t.changeReason ?? '').trim() || 'Sin motivo';
      reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
    }
    const breakdown = [...reasonCounts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

    return [
      { label: 'Traslado Interno', value: internalSet.length, type: WorkflowType.INTERNAL, breakdown },
      { label: 'Sala de Espera Admisión', value: current.set.filter(t => t.workflow === WorkflowType.ITR_TO_FLOOR).length, type: WorkflowType.ITR_TO_FLOOR },
      { label: 'Ingreso a ITR', value: current.set.filter(t => t.workflow === WorkflowType.INGRESO_A_ITR).length, type: WorkflowType.INGRESO_A_ITR },
    ];
  }, [current.set]);

  const statusDistribution = useMemo(() => [
    { status: TicketStatus.WAITING_ROOM, count: current.set.filter(t => t.status === TicketStatus.WAITING_ROOM).length, color: '#f59e0b', label: 'Esperando Habitación' },
    { status: TicketStatus.IN_TRANSIT, count: current.set.filter(t => t.status === TicketStatus.IN_TRANSIT).length, color: '#3b82f6', label: 'En Tránsito' },
    { status: TicketStatus.IN_TRANSPORT, count: current.set.filter(t => t.status === TicketStatus.IN_TRANSPORT).length, color: '#06b6d4', label: 'En Traslado' },
    { status: TicketStatus.WAITING_CONSOLIDATION, count: current.set.filter(t => t.status === TicketStatus.WAITING_CONSOLIDATION).length, color: '#8b5cf6', label: 'Por Consolidar' },
    { status: TicketStatus.COMPLETED, count: current.set.filter(t => t.status === TicketStatus.COMPLETED).length, color: '#10b981', label: 'Completados' },
  ], [current.set]);

  return (
    <div className="p-4 lg:p-8 space-y-8 animate-in fade-in duration-500 max-w-7xl mx-auto pb-20">

      {/* Selector de período */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
          {presets.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => { setStartDate(p.start); setEndDate(p.end); }}
              className={cn(
                'px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wide transition-colors',
                activePreset === p.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Rango personalizado (Desde / Hasta) */}
        <div className="flex items-center rounded-xl border border-slate-200 bg-white overflow-hidden divide-x divide-slate-100">
          <Popover open={openStart} onOpenChange={setOpenStart}>
            <PopoverTrigger asChild>
              <button type="button" className="px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 transition-colors">
                <CalendarIcon className="w-3.5 h-3.5 text-slate-400" />
                <span className="flex flex-col items-start">
                  <span className="text-[7px] uppercase font-bold text-slate-400 leading-none mb-0.5">Desde</span>
                  <span className="text-xs font-bold text-slate-900 leading-none">{formatDateReadable(startDate)}</span>
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-4 bg-white shadow-2xl z-50">
              <Calendar selected={startDate} onSelect={(d) => { setStartDate(d); if (d > endDate) setEndDate(d); setOpenStart(false); }} />
            </PopoverContent>
          </Popover>
          <Popover open={openEnd} onOpenChange={setOpenEnd}>
            <PopoverTrigger asChild>
              <button type="button" className="px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 transition-colors">
                <CalendarIcon className="w-3.5 h-3.5 text-slate-400" />
                <span className="flex flex-col items-start">
                  <span className="text-[7px] uppercase font-bold text-slate-400 leading-none mb-0.5">Hasta</span>
                  <span className="text-xs font-bold text-slate-900 leading-none">{formatDateReadable(endDate)}</span>
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-4 bg-white shadow-2xl z-50">
              <Calendar selected={endDate} onSelect={(d) => { setEndDate(d); if (d < startDate) setStartDate(d); setOpenEnd(false); }} />
            </PopoverContent>
          </Popover>
        </div>

        {/* El Monitor ya no se pollea: carga al entrar y se refresca desde acá. */}
        {onRefresh && (
          <button
            type="button"
            onClick={() => onRefresh()}
            disabled={refreshing}
            className="ml-auto flex items-center gap-2 h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
            Actualizar
          </button>
        )}
      </div>

      {/* Upper Metrics Grid con Datos Reales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard
          title="Casos Activos"
          value={current.activeCount}
          description={`Tickets sin finalizar (${periodLabel})`}
          trend={trends.active}
          icon={<Activity />}
        />
        <StatCard
          title="Espera Media"
          value={current.avgWait !== null ? current.avgWait : "--"}
          description={`Minutos promedio solicitud-cama (${periodLabel})`}
          trend={trends.wait}
          icon={<Clock />}
        />
        <StatCard
          title="Productividad"
          value={current.completedCount}
          description={`Traslados finalizados (${periodLabel})`}
          trend={trends.productivity}
          icon={<CheckCircle2 />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <VolumeBarChart data={volumeData} />
        <StatusDonutChart data={statusDistribution} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Pending Column */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2">
              <div className="w-1 h-4 bg-amber-500 rounded-full" />
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Admisión Pendiente</h3>
            </div>
            <Badge variant="warning" className="rounded-full px-2 py-0 text-[10px] font-black">{live.pending.length}</Badge>
          </div>

          {live.pending.length === 0 ? (
            <div className="p-12 border-2 border-dashed border-slate-100 rounded-2xl text-center text-slate-300 bg-slate-50/50">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-3 opacity-20" />
              <p className="text-[10px] font-black uppercase tracking-widest">No hay solicitudes críticas</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {live.pending.map(t => (
                <Card key={t.id} className="hover:border-slate-300 transition-colors border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black font-mono text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">{t.id}</span>
                        <StatusBadge status={t.status} />
                      </div>
                      <h4 className="font-bold text-slate-900 text-sm tracking-tight">{t.patientName}</h4>
                      <p className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1.5">
                        <ArrowRightLeft className="w-3 h-3" /> {formatBedName(t.origin)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="text-[10px] font-black text-slate-400 tabular-nums">{formatDateTime(t.createdAt)}</span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* In Process Column */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2">
              <div className="w-1 h-4 bg-blue-500 rounded-full" />
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">En Ejecución</h3>
            </div>
            <Badge variant="info" className="rounded-full px-2 py-0 text-[10px] font-black">{live.inProcess.length}</Badge>
          </div>

          {live.inProcess.length === 0 ? (
            <div className="p-12 border-2 border-dashed border-slate-100 rounded-2xl text-center text-slate-300 bg-slate-50/50">
              <Activity className="w-8 h-8 mx-auto mb-3 opacity-20" />
              <p className="text-[10px] font-black uppercase tracking-widest">Área operativa despejada</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {live.inProcess.map(t => (
                <Card key={t.id} className="hover:border-slate-300 transition-colors border-slate-200 bg-white shadow-sm overflow-hidden border-l-4 border-l-blue-500">
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black font-mono text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">{t.id}</span>
                        <StatusBadge status={t.status} />
                      </div>
                      <h4 className="font-bold text-slate-900 text-sm tracking-tight">{t.patientName}</h4>
                      <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase">
                        <span>{formatBedName(t.origin)}</span>
                        <ArrowRightLeft className="w-2.5 h-2.5 text-slate-300" />
                        <span className="text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{t.destination ? formatBedName(t.destination) : 'Pendiente'}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                       {t.isBedClean ?
                        <Badge variant="success" className="text-[8px] font-black uppercase tracking-widest py-0">Limpia</Badge> :
                        <Badge variant="destructive" className="text-[8px] font-black uppercase tracking-widest py-0">Sucia</Badge>
                      }
                      <span className="text-[10px] font-black text-slate-400 tabular-nums">{formatDateTime(t.createdAt)}</span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
