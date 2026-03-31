import React, { useState, useMemo } from 'react';
import { Incident, IncidentStatus } from '../types';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  Settings, Clock, CheckCircle2, AlertCircle, BedDouble, Check, ArrowLeft
} from '../components/Icons';
import { cn } from '../lib/utils';

interface IncidentsViewProps {
  incidents: Incident[];
  onResolve: (incidentId: string | string[], notes?: string) => void;
  onStartProgress: (incidentId: string | string[]) => void;
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

const formatTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  } catch { return '--:--'; }
};

// Group key for a bed
const bedKey = (inc: Incident) => `${inc.roomCode}-${inc.bedCode}`;

// ── Grouped type ────────────────────────────────────────────────────────────
interface BedGroup {
  key: string;
  roomCode: string;
  bedCode: string;
  area: string;
  incidents: Incident[];
  openCount: number;
  progressCount: number;
  resolvedCount: number;
}

// ── Bed Detail View ─────────────────────────────────────────────────────────
const BedDetail: React.FC<{
  group: BedGroup;
  onBack: () => void;
  onResolve: (id: string | string[], notes?: string) => void;
  onStartProgress: (id: string | string[]) => void;
}> = ({ group, onBack, onResolve, onStartProgress }) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sorted = [...group.incidents].sort((a, b) => {
    const order = { [IncidentStatus.OPEN]: 0, [IncidentStatus.IN_PROGRESS]: 1, [IncidentStatus.RESOLVED]: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const pending = group.openCount + group.progressCount;
  const actionable = sorted.filter(i => i.status !== IncidentStatus.RESOLVED);
  const openIds = actionable.filter(i => i.status === IncidentStatus.OPEN).map(i => i.id);
  const inProgressIds = actionable.filter(i => i.status === IncidentStatus.IN_PROGRESS).map(i => i.id);

  const selectedOpen = openIds.filter(id => selected.has(id));
  const selectedInProgress = inProgressIds.filter(id => selected.has(id));
  const totalSelected = selectedOpen.length + selectedInProgress.length;

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const allActionableIds = actionable.map(i => i.id);
    const allSelected = allActionableIds.every(id => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(allActionableIds));
  };

  const handleBatchTake = () => {
    onStartProgress(selectedOpen);
    setSelected(prev => {
      const next = new Set(prev);
      selectedOpen.forEach(id => next.delete(id));
      return next;
    });
  };

  const handleBatchResolve = () => {
    onResolve(selectedInProgress);
    setSelected(prev => {
      const next = new Set(prev);
      selectedInProgress.forEach(id => next.delete(id));
      return next;
    });
  };

  return (
    <div className="p-4 md:p-8 animate-in slide-in-from-right-4 duration-200 max-w-2xl mx-auto space-y-4 pb-32 md:pb-8">
      <button onClick={onBack} className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Volver a incidentes
      </button>

      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center shrink-0">
          <BedDouble className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-lg font-black text-slate-900">Hab. {group.roomCode} - Cama {group.bedCode}</h1>
          <p className="text-xs font-bold text-slate-400">{AREA_SHORT[group.area] || group.area} · {group.incidents.length} incidente{group.incidents.length > 1 ? 's' : ''}</p>
        </div>
        {pending > 0 && (
          <Badge className="ml-auto text-[9px] font-black uppercase px-2 py-0.5 bg-red-50 text-red-700 border-red-200">
            {pending} pendiente{pending > 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      {/* Select all toggle */}
      {actionable.length > 1 && (
        <button
          onClick={selectAll}
          className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors"
        >
          <div className={cn(
            "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors",
            totalSelected === actionable.length ? "bg-emerald-600 border-emerald-600" : "border-slate-300 bg-white"
          )}>
            {totalSelected === actionable.length && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
          </div>
          Seleccionar todos ({actionable.length})
        </button>
      )}

      {/* Incident cards with checkboxes */}
      <div className="space-y-3">
        {sorted.map(incident => {
          const sc = STATUS_CONFIG[incident.status];
          const isResolved = incident.status === IncidentStatus.RESOLVED;
          const isChecked = selected.has(incident.id);

          return (
            <Card
              key={incident.id}
              onClick={() => !isResolved && toggleSelect(incident.id)}
              className={cn(
                "relative overflow-hidden transition-all duration-200",
                isResolved
                  ? "opacity-50 border-slate-100 bg-slate-50"
                  : isChecked
                    ? "border-emerald-300 bg-emerald-50/50 shadow-sm cursor-pointer"
                    : cn(sc.border, "bg-white cursor-pointer hover:shadow-md")
              )}
            >
              {!isResolved && (
                <div className={cn("absolute top-0 left-0 w-1 h-full",
                  isChecked ? "bg-emerald-500" : incident.status === IncidentStatus.OPEN ? "bg-red-500" : "bg-amber-500"
                )} />
              )}

              <div className="p-4 space-y-2">
                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  {!isResolved && (
                    <div className={cn(
                      "w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 mt-1 transition-colors",
                      isChecked ? "bg-emerald-600 border-emerald-600" : "border-slate-300 bg-white"
                    )}>
                      {isChecked && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                    </div>
                  )}

                  <div className="flex-1 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[9px] font-black uppercase text-slate-400">{incident.category}</p>
                        <p className="text-sm font-bold text-slate-800">{incident.issue}</p>
                      </div>
                      <Badge className={cn("text-[8px] font-black uppercase px-1.5 py-0 shrink-0", sc.bg, sc.color, sc.border)}>
                        {sc.label}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span className="flex items-center gap-1 font-bold">
                        <Clock className="w-3 h-3" /> {formatTime(incident.createdAt)}
                      </span>
                      <span className="font-medium">Por: <span className="font-bold text-slate-600">{incident.createdBy}</span></span>
                    </div>
                  </div>
                </div>

                {isResolved && incident.resolvedBy && (
                  <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100">
                    <CheckCircle2 className="w-3 h-3" />
                    Resuelto por {incident.resolvedBy} a las {incident.resolvedAt ? formatTime(incident.resolvedAt) : '--:--'}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Batch action buttons — sticky at bottom */}
      {totalSelected > 0 && (
        <div className="sticky bottom-4 flex gap-2 animate-in slide-in-from-bottom-4 duration-200">
          {selectedOpen.length > 0 && (
            <Button
              onClick={handleBatchTake}
              className="flex-1 h-12 rounded-xl font-black text-xs uppercase tracking-widest bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-500/30"
            >
              <Settings className="w-4 h-4 mr-2" />
              Tomar {selectedOpen.length > 1 ? `${selectedOpen.length} incidentes` : 'incidente'}
            </Button>
          )}
          {selectedInProgress.length > 0 && (
            <Button
              onClick={handleBatchResolve}
              className="flex-1 h-12 rounded-xl font-black text-xs uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/30"
            >
              <Check className="w-4 h-4 mr-2" strokeWidth={3} />
              Resolver {selectedInProgress.length > 1 ? `${selectedInProgress.length} incidentes` : 'incidente'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

// ── Main Incidents View ─────────────────────────────────────────────────────
export const IncidentsView: React.FC<IncidentsViewProps> = ({
  incidents,
  onResolve,
  onStartProgress,
}) => {
  const [activeTab, setActiveTab] = useState<'open' | 'progress' | 'resolved' | 'all'>('open');
  const [selectedBedKey, setSelectedBedKey] = useState<string | null>(null);

  // Group incidents by bed
  const groups = useMemo(() => {
    const map = new Map<string, BedGroup>();
    for (const inc of incidents) {
      const key = bedKey(inc);
      if (!map.has(key)) {
        map.set(key, {
          key,
          roomCode: inc.roomCode,
          bedCode: inc.bedCode,
          area: inc.area,
          incidents: [],
          openCount: 0,
          progressCount: 0,
          resolvedCount: 0,
        });
      }
      const g = map.get(key)!;
      g.incidents.push(inc);
      if (inc.status === IncidentStatus.OPEN) g.openCount++;
      else if (inc.status === IncidentStatus.IN_PROGRESS) g.progressCount++;
      else g.resolvedCount++;
    }
    return Array.from(map.values());
  }, [incidents]);

  // Filter groups by tab
  const filtered = useMemo(() => {
    let result = [...groups];
    if (activeTab === 'open') result = result.filter(g => g.openCount > 0);
    if (activeTab === 'progress') result = result.filter(g => g.progressCount > 0);
    if (activeTab === 'resolved') result = result.filter(g => g.openCount === 0 && g.progressCount === 0 && g.resolvedCount > 0);
    result.sort((a, b) => {
      const aPending = a.openCount + a.progressCount;
      const bPending = b.openCount + b.progressCount;
      if (aPending !== bPending) return bPending - aPending;
      return a.key.localeCompare(b.key);
    });
    return result;
  }, [groups, activeTab]);

  const selectedGroup = selectedBedKey ? groups.find(g => g.key === selectedBedKey) : null;

  const openCount = incidents.filter(i => i.status === IncidentStatus.OPEN).length;
  const progressCount = incidents.filter(i => i.status === IncidentStatus.IN_PROGRESS).length;
  const resolvedCount = incidents.filter(i => i.status === IncidentStatus.RESOLVED).length;

  // ── Detail view ──────────────────────────────────────────────────────────
  if (selectedGroup) {
    return (
      <BedDetail
        group={selectedGroup}
        onBack={() => setSelectedBedKey(null)}
        onResolve={onResolve}
        onStartProgress={onStartProgress}
      />
    );
  }

  // ── Grouped list ─────────────────────────────────────────────────────────
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
              {openCount + progressCount} pendiente{openCount + progressCount !== 1 ? 's' : ''} en {groups.filter(g => g.openCount + g.progressCount > 0).length} cama{groups.filter(g => g.openCount + g.progressCount > 0).length !== 1 ? 's' : ''}
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

      {/* Bed group cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filtered.length === 0 ? (
          <div className="col-span-full py-20 text-center">
            <CheckCircle2 className="w-16 h-16 mx-auto mb-4 text-emerald-200" />
            <p className="text-sm font-black uppercase tracking-widest text-slate-300">
              Sin incidentes
            </p>
          </div>
        ) : (
          filtered.map(group => {
            const pending = group.openCount + group.progressCount;
            const allResolved = pending === 0;

            return (
              <Card
                key={group.key}
                onClick={() => setSelectedBedKey(group.key)}
                className={cn(
                  "relative overflow-hidden transition-all duration-200 cursor-pointer",
                  allResolved
                    ? "opacity-50 border-slate-100 bg-slate-50"
                    : group.openCount > 0
                      ? "border-red-200 bg-white shadow-sm hover:shadow-md"
                      : "border-amber-200 bg-white shadow-sm hover:shadow-md"
                )}
              >
                {!allResolved && (
                  <div className={cn("absolute top-0 left-0 w-1 h-full",
                    group.openCount > 0 ? "bg-red-500" : "bg-amber-500"
                  )} />
                )}

                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                        allResolved ? "bg-emerald-100 text-emerald-600" : group.openCount > 0 ? "bg-red-50 text-red-500" : "bg-amber-50 text-amber-500"
                      )}>
                        <BedDouble className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-sm font-black text-slate-900">Hab. {group.roomCode} - Cama {group.bedCode}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          {AREA_SHORT[group.area] || group.area}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[9px] font-black text-slate-500">
                        {group.incidents.length} incidente{group.incidents.length > 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>

                  {/* Issue summary */}
                  <div className="mt-3 ml-[52px] flex flex-wrap gap-1.5">
                    {group.openCount > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 border border-red-100 text-[9px] font-black text-red-600">
                        <AlertCircle className="w-2.5 h-2.5" /> {group.openCount} abierto{group.openCount > 1 ? 's' : ''}
                      </span>
                    )}
                    {group.progressCount > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-100 text-[9px] font-black text-amber-600">
                        <Clock className="w-2.5 h-2.5" /> {group.progressCount} en proceso
                      </span>
                    )}
                    {group.resolvedCount > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-100 text-[9px] font-black text-emerald-600">
                        <CheckCircle2 className="w-2.5 h-2.5" /> {group.resolvedCount} resuelto{group.resolvedCount > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  {/* Categories preview */}
                  <div className="mt-2 ml-[52px]">
                    <p className="text-[10px] font-bold text-slate-400 truncate">
                      {[...new Set(group.incidents.filter(i => i.status !== IncidentStatus.RESOLVED).map(i => i.category))].join(' · ') || 'Todo resuelto'}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
};
