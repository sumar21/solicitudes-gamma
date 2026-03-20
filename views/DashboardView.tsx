
import React, { useMemo } from 'react';
import { Ticket, TicketStatus, WorkflowType } from '../types';
import { Activity, ArrowRightLeft, Clock, CheckCircle2 } from '../components/Icons';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { StatusBadge } from '../components/StatusBadge';
import { StatCard } from '../components/dashboard/StatCard';
import { VolumeBarChart } from '../components/dashboard/VolumeBarChart';
import { StatusDonutChart } from '../components/dashboard/StatusDonutChart';
import { calculateTicketMetrics, formatBedName } from '../lib/utils';

interface DashboardViewProps {
  tickets: Ticket[];
}

export const DashboardView: React.FC<DashboardViewProps> = ({ tickets }) => {
  // --- CÁLCULOS DINÁMICOS ---
  
  const metrics = useMemo(() => {
    const active = tickets.filter(t => t.status !== TicketStatus.COMPLETED);
    const completed = tickets.filter(t => t.status === TicketStatus.COMPLETED);
    const pending = tickets.filter(t => t.status === TicketStatus.WAITING_CONSOLIDATION);
    const inProcess = tickets.filter(t => 
      t.status === TicketStatus.WAITING_ROOM || 
      t.status === TicketStatus.IN_TRANSIT
    );

    // Espera Media: usa calculateTicketMetrics (misma lógica que la auditoría)
    const completedWithTime = completed.filter(t => t.createdAt && t.completedAt);
    const totalCycleTime = completedWithTime.reduce((acc, t) => {
      return acc + calculateTicketMetrics(t).totalCycleTime;
    }, 0);

    const avgWait = completedWithTime.length > 0
      ? Math.round(totalCycleTime / completedWithTime.length)
      : null;

    return { active, completed, pending, inProcess, avgWait };
  }, [tickets]);

  // --- LÓGICA DE TENDENCIAS (Basada en umbrales operativos) ---
  
  const trends = useMemo(() => {
    // Umbral de Casos Activos: 5 es considerado "normal"
    const activeTrendValue = Math.abs(metrics.active.length - 5) * 10;
    const isActiveHigh = metrics.active.length > 8;

    // Umbral de Espera: 40 min es el target hospitalario
    const waitDiff = 40 - (metrics.avgWait ?? 0);
    const isWaitPositive = waitDiff >= 0;

    return {
      active: {
        value: `${isActiveHigh ? '+' : '-'}${activeTrendValue}%`,
        positive: !isActiveHigh // En salud, menos casos activos es positivo
      },
      wait: {
        value: `${isWaitPositive ? '-' : '+'}${Math.abs(waitDiff)}m`,
        positive: isWaitPositive
      },
      productivity: {
        value: `+${metrics.completed.length * 15}%`,
        positive: true
      }
    };
  }, [metrics]);

  // Data para Gráficos
  const volumeData = [
    { label: 'Traslado Interno', value: tickets.filter(t => t.workflow === WorkflowType.INTERNAL).length, type: WorkflowType.INTERNAL },
    { label: 'Ingreso ITR', value: tickets.filter(t => t.workflow === WorkflowType.ITR_TO_FLOOR).length, type: WorkflowType.ITR_TO_FLOOR },
    { label: 'Cambio Habitación', value: tickets.filter(t => t.workflow === WorkflowType.ROOM_CHANGE).length, type: WorkflowType.ROOM_CHANGE },
  ];

  const statusDistribution = [
    { status: TicketStatus.WAITING_ROOM, count: tickets.filter(t => t.status === TicketStatus.WAITING_ROOM).length, color: '#f59e0b', label: 'Esperando Habitación' },
    { status: TicketStatus.IN_TRANSIT, count: tickets.filter(t => t.status === TicketStatus.IN_TRANSIT).length, color: '#3b82f6', label: 'En Tránsito' },
    { status: TicketStatus.WAITING_CONSOLIDATION, count: tickets.filter(t => t.status === TicketStatus.WAITING_CONSOLIDATION).length, color: '#8b5cf6', label: 'Por Consolidar' },
    { status: TicketStatus.COMPLETED, count: tickets.filter(t => t.status === TicketStatus.COMPLETED).length, color: '#10b981', label: 'Completados' },
  ];

  return (
    <div className="p-4 lg:p-8 space-y-8 animate-in fade-in duration-500 max-w-7xl mx-auto pb-20">
      
      {/* Upper Metrics Grid con Datos Reales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard 
          title="Casos Activos"
          value={metrics.active.length}
          description="Tickets en curso actualmente"
          trend={trends.active}
          icon={<Activity />}
        />
        <StatCard 
          title="Espera Media"
          value={metrics.avgWait !== null ? metrics.avgWait : "--"}
          description="Minutos promedio solicitud-cama"
          trend={trends.wait}
          icon={<Clock />}
        />
        <StatCard 
          title="Productividad"
          value={metrics.completed.length}
          description="Traslados finalizados hoy"
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
            <Badge variant="warning" className="rounded-full px-2 py-0 text-[10px] font-black">{metrics.pending.length}</Badge>
          </div>
          
          {metrics.pending.length === 0 ? (
            <div className="p-12 border-2 border-dashed border-slate-100 rounded-2xl text-center text-slate-300 bg-slate-50/50">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-3 opacity-20" />
              <p className="text-[10px] font-black uppercase tracking-widest">No hay solicitudes críticas</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {metrics.pending.map(t => (
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
                      <span className="text-[10px] font-black text-slate-400 tabular-nums">{t.createdAt}</span>
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
            <Badge variant="info" className="rounded-full px-2 py-0 text-[10px] font-black">{metrics.inProcess.length}</Badge>
          </div>
          
          {metrics.inProcess.length === 0 ? (
            <div className="p-12 border-2 border-dashed border-slate-100 rounded-2xl text-center text-slate-300 bg-slate-50/50">
              <Activity className="w-8 h-8 mx-auto mb-3 opacity-20" />
              <p className="text-[10px] font-black uppercase tracking-widest">Área operativa despejada</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {metrics.inProcess.map(t => (
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
                      <span className="text-[10px] font-black text-slate-400 tabular-nums">{t.createdAt}</span>
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
