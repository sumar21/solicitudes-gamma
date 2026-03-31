import React, { useState, useMemo } from 'react';
import { Incident, IncidentStatus } from '../types';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  Settings, Clock, CheckCircle2, AlertCircle, BedDouble, Check
} from '../components/Icons';
import { cn } from '../lib/utils';

interface IncidentsViewProps {
  incidents: Incident[];
  onResolve: (incidentId: string, notes?: string) => void;
  onStartProgress: (incidentId: string) => void;
}

const STATUS_CONFIG: Record<IncidentStatus, { label: string; color: string; bg: string; border: string }> = {
  [IncidentStatus.OPEN]: { label: 'Abierto', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
  [IncidentStatus.IN_PROGRESS]: { label: 'En Proceso', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
  [IncidentStatus.RESOLVED]: { label: 'Resuelto', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
};

const AREA_SHORT: Record<string, string> = {
  'Internacion 4° Piso HPR': 'Piso 4',
  'Internacion 5° Piso HPR': 'Piso 5',
  'Internacion 6° Piso HPR': 'Piso 6',
  'Internacion 7° Piso HPR': 'Piso 7',
  'Internacion 8° Piso HPR': 'Piso 8',
};

export const IncidentsView: React.FC<IncidentsViewProps> = ({
  incidents,
  onResolve,
  onStartProgress,
}) => {
  const [activeTab, setActiveTab] = useState<'open' | 'progress' | 'resolved' | 'all'>('open');

  const filtered = useMemo(() => {
    let result = [...incidents];
    if (activeTab === 'open') result = result.filter(i => i.status === IncidentStatus.OPEN);
    if (activeTab === 'progress') result = result.filter(i => i.status === IncidentStatus.IN_PROGRESS);
    if (activeTab === 'resolved') result = result.filter(i => i.status === IncidentStatus.RESOLVED);
    result.sort((a, b) => {
      const order = { [IncidentStatus.OPEN]: 0, [IncidentStatus.IN_PROGRESS]: 1, [IncidentStatus.RESOLVED]: 2 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return result;
  }, [incidents, activeTab]);

  const openCount = incidents.filter(i => i.status === IncidentStatus.OPEN).length;
  const progressCount = incidents.filter(i => i.status === IncidentStatus.IN_PROGRESS).length;
  const resolvedCount = incidents.filter(i => i.status === IncidentStatus.RESOLVED).length;

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    } catch { return '--:--'; }
  };

  return (
    <div className="p-4 md:p-8 animate-in slide-in-from-right-4 duration-300 max-w-full space-y-4 md:space-y-6 pb-24 md:pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-orange-100 rounded-xl">
            <Settings className="w-5 h-5 text-orange-700" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">Incidentes de Mantenimiento</h1>
            <p className="text-xs text-slate-400 font-bold">
              {openCount + progressCount} pendiente{openCount + progressCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-100 rounded-xl">
            <AlertCircle className="w-3 h-3 text-red-500" />
            <span className="text-[10px] font-black text-red-700 uppercase">{openCount} Abierto{openCount !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-100 rounded-xl">
            <Clock className="w-3 h-3 text-amber-500" />
            <span className="text-[10px] font-black text-amber-700 uppercase">{progressCount} En proceso</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-200 shadow-sm w-full sm:w-auto overflow-x-auto no-scrollbar">
        {([
          { key: 'open', label: 'Abiertos', count: openCount },
          { key: 'progress', label: 'En Proceso', count: progressCount },
          { key: 'resolved', label: 'Resueltos', count: resolvedCount },
          { key: 'all', label: 'Todos', count: incidents.length },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-tight whitespace-nowrap transition-all",
              activeTab === tab.key
                ? "bg-emerald-950 text-white shadow-md scale-105"
                : "text-slate-400 hover:bg-slate-100"
            )}
          >
            {tab.label}
            <span className={cn(
              "text-[8px] px-1.5 py-0.5 rounded-full font-black",
              activeTab === tab.key ? "bg-white/20 text-white" : "bg-slate-100 text-slate-400"
            )}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Incident cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filtered.length === 0 ? (
          <div className="col-span-full py-20 text-center">
            <CheckCircle2 className="w-16 h-16 mx-auto mb-4 text-emerald-200" />
            <p className="text-sm font-black uppercase tracking-widest text-slate-300">
              Sin incidentes
            </p>
          </div>
        ) : (
          filtered.map(incident => {
            const sc = STATUS_CONFIG[incident.status];
            return (
              <Card
                key={incident.id}
                className={cn(
                  "relative overflow-hidden transition-all duration-200",
                  incident.status === IncidentStatus.RESOLVED
                    ? "opacity-50 border-slate-100 bg-slate-50"
                    : incident.status === IncidentStatus.OPEN
                      ? "border-red-200 bg-white shadow-sm"
                      : "border-amber-200 bg-white shadow-sm"
                )}
              >
                {incident.status === IncidentStatus.OPEN && (
                  <div className="absolute top-0 left-0 w-1 h-full bg-red-500" />
                )}
                {incident.status === IncidentStatus.IN_PROGRESS && (
                  <div className="absolute top-0 left-0 w-1 h-full bg-amber-500" />
                )}

                <div className="p-4 space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", sc.bg, sc.color)}>
                        <Settings className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-sm font-black text-slate-900">Hab. {incident.roomCode} - Cama {incident.bedCode}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          {AREA_SHORT[incident.area] || incident.area}
                        </p>
                      </div>
                    </div>
                    <Badge className={cn("text-[8px] font-black uppercase px-1.5 py-0", sc.bg, sc.color, sc.border)}>
                      {sc.label}
                    </Badge>
                  </div>

                  {/* Issue detail */}
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <p className="text-[9px] font-black uppercase text-slate-400 mb-1">{incident.category}</p>
                    <p className="text-sm font-bold text-slate-800">{incident.issue}</p>
                  </div>

                  {/* Meta */}
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1 font-bold">
                      <Clock className="w-3 h-3" /> {formatTime(incident.createdAt)}
                    </span>
                    <span className="font-medium">Reportado por: <span className="font-bold text-slate-600">{incident.createdBy}</span></span>
                  </div>

                  {/* Resolution info */}
                  {incident.status === IncidentStatus.RESOLVED && incident.resolvedBy && (
                    <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100">
                      <CheckCircle2 className="w-3 h-3" />
                      Resuelto por {incident.resolvedBy} a las {incident.resolvedAt ? formatTime(incident.resolvedAt) : '--:--'}
                    </div>
                  )}

                  {/* Actions */}
                  {incident.status === IncidentStatus.OPEN && (
                    <Button
                      onClick={() => onStartProgress(incident.id)}
                      className="w-full h-10 rounded-xl font-black text-xs uppercase tracking-widest bg-amber-500 hover:bg-amber-600 text-white"
                    >
                      <Settings className="w-4 h-4 mr-2" /> Tomar Incidente
                    </Button>
                  )}
                  {incident.status === IncidentStatus.IN_PROGRESS && (
                    <Button
                      onClick={() => onResolve(incident.id)}
                      className="w-full h-10 rounded-xl font-black text-xs uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/20"
                    >
                      <Check className="w-4 h-4 mr-2" strokeWidth={3} /> Marcar Resuelto
                    </Button>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
};
