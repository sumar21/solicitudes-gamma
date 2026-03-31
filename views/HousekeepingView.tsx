import React, { useState, useMemo } from 'react';
import { CleaningTask, CleaningTaskType, MaintenanceStatus } from '../types';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  SprayCan, Clock, BedDouble, CheckCircle2, Sparkles,
  CheckCircle, ListChecks, AlertCircle, Check, Settings, X
} from '../components/Icons';
import { cn } from '../lib/utils';

interface HousekeepingViewProps {
  tasks: CleaningTask[];
  onToggleItem: (taskId: string, itemId: string) => void;
  onComplete: (taskId: string) => void;
  onMaintenanceStatus: (taskId: string, itemId: string, status: MaintenanceStatus) => void;
}

const AREA_SHORT: Record<string, string> = {
  'Internacion 4° Piso HPR': 'Piso 4',
  'Internacion 5° Piso HPR': 'Piso 5',
  'Internacion 6° Piso HPR': 'Piso 6',
  'Internacion 7° Piso HPR': 'Piso 7',
  'Internacion 8° Piso HPR': 'Piso 8',
  'Internación Transitoria HPR': 'ITR',
  'Unidad Coronaria HPR': 'UCO',
  'Unidad de Terapia Intensiva HPR': 'UTI',
};

export const HousekeepingView: React.FC<HousekeepingViewProps> = ({
  tasks,
  onToggleItem,
  onComplete,
  onMaintenanceStatus,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'discharge' | 'daily'>('all');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  // Track which section is active inside expanded card: 'cleaning' or 'maintenance'
  const [activeSection, setActiveSection] = useState<'cleaning' | 'maintenance'>('cleaning');

  const filtered = useMemo(() => {
    let result = [...tasks];
    if (activeTab === 'discharge') result = result.filter(t => t.type === CleaningTaskType.POST_DISCHARGE);
    if (activeTab === 'daily') result = result.filter(t => t.type === CleaningTaskType.DAILY_ROUTINE);
    result.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (a.priority !== b.priority) return a.priority === 'urgent' ? -1 : 1;
      return new Date(a.assignedAt).getTime() - new Date(b.assignedAt).getTime();
    });
    return result;
  }, [tasks, activeTab]);

  const pendingCount = tasks.filter(t => !t.completed).length;
  const dischargeCount = tasks.filter(t => t.type === CleaningTaskType.POST_DISCHARGE && !t.completed).length;
  const dailyCount = tasks.filter(t => t.type === CleaningTaskType.DAILY_ROUTINE && !t.completed).length;

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
          <div className="p-2.5 bg-amber-100 rounded-xl">
            <SprayCan className="w-5 h-5 text-amber-700" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">Tareas de Limpieza</h1>
            <p className="text-xs text-slate-400 font-bold">
              {pendingCount} pendiente{pendingCount !== 1 ? 's' : ''} hoy
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-100 rounded-xl">
            <AlertCircle className="w-3 h-3 text-red-500" />
            <span className="text-[10px] font-black text-red-700 uppercase">{dischargeCount} Alta{dischargeCount !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-100 rounded-xl">
            <Sparkles className="w-3 h-3 text-blue-500" />
            <span className="text-[10px] font-black text-blue-700 uppercase">{dailyCount} Diaria{dailyCount !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-200 shadow-sm w-full sm:w-auto overflow-x-auto no-scrollbar">
        {([
          { key: 'all', label: 'Todas', count: pendingCount },
          { key: 'discharge', label: 'Por Alta', count: dischargeCount },
          { key: 'daily', label: 'Diarias', count: dailyCount },
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

      {/* Task cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filtered.length === 0 ? (
          <div className="col-span-full py-20 text-center">
            <CheckCircle className="w-16 h-16 mx-auto mb-4 text-emerald-200" />
            <p className="text-sm font-black uppercase tracking-widest text-slate-300">
              Todas las tareas completadas
            </p>
          </div>
        ) : (
          filtered.map(task => {
            const isExpanded = expandedTask === task.id;
            const checkedCount = task.checklist.filter(c => c.checked).length;
            const totalCount = task.checklist.length;
            const allChecked = checkedCount === totalCount;
            const isDischarge = task.type === CleaningTaskType.POST_DISCHARGE;
            const progressPct = totalCount > 0 ? (checkedCount / totalCount) * 100 : 0;

            // Maintenance stats
            const mItems = task.maintenanceChecklist ?? [];
            const mReviewed = mItems.filter(m => m.status !== 'pending').length;
            const mFaults = mItems.filter(m => m.status === 'fault').length;
            const allMaintenanceReviewed = mItems.length > 0 ? mReviewed === mItems.length : true;
            const canComplete = allChecked && allMaintenanceReviewed;

            return (
              <Card
                key={task.id}
                className={cn(
                  "relative overflow-hidden transition-all duration-200",
                  isExpanded && "md:col-span-2",
                  task.completed
                    ? "opacity-50 border-slate-100 bg-slate-50"
                    : isDischarge
                      ? "border-red-200 bg-white shadow-sm hover:shadow-md"
                      : "border-slate-200 bg-white shadow-sm hover:shadow-md"
                )}
              >
                {isDischarge && !task.completed && (
                  <div className="absolute top-0 left-0 w-1 h-full bg-red-500" />
                )}

                {/* Card header */}
                <button
                  className="w-full text-left p-4 pb-3"
                  onClick={() => { setExpandedTask(isExpanded ? null : task.id); setActiveSection('cleaning'); }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                        task.completed
                          ? "bg-emerald-100 text-emerald-600"
                          : isDischarge
                            ? "bg-red-50 text-red-500"
                            : "bg-blue-50 text-blue-500"
                      )}>
                        {task.completed ? <CheckCircle2 className="w-5 h-5" /> : <BedDouble className="w-5 h-5" />}
                      </div>
                      <div>
                        <p className="text-sm font-black text-slate-900">Hab. {task.roomCode} - Cama {task.bedCode}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          {AREA_SHORT[task.area] || task.area}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge
                        variant={isDischarge ? 'destructive' : 'outline'}
                        className={cn("text-[8px] font-black uppercase px-1.5 py-0", !isDischarge && "bg-blue-50 text-blue-600 border-blue-200")}
                      >
                        {isDischarge ? 'Alta' : 'Diaria'}
                      </Badge>
                      {task.completed ? (
                        <span className="text-[9px] font-bold text-emerald-600">Completada</span>
                      ) : (
                        <span className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />{formatTime(task.assignedAt)}
                        </span>
                      )}
                    </div>
                  </div>

                  {isDischarge && task.patientName && !task.completed && (
                    <div className="mt-2 ml-[52px] px-2 py-1.5 bg-red-50 border border-red-100 rounded-lg">
                      <p className="text-[9px] font-black text-red-400 uppercase">Paciente dado de alta</p>
                      <p className="text-xs font-bold text-red-800">{task.patientName}</p>
                    </div>
                  )}

                  {/* Progress bar */}
                  {!task.completed && (
                    <div className="mt-3 ml-[52px]">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                          <ListChecks className="w-3 h-3" />
                          {checkedCount}/{totalCount} limpieza
                          {mItems.length > 0 && <> · {mReviewed}/{mItems.length} revisión</>}
                          {mFaults > 0 && <span className="text-red-500 ml-1">({mFaults} falla{mFaults > 1 ? 's' : ''})</span>}
                        </span>
                        <span className="text-[9px] font-black text-slate-500">{Math.round(progressPct)}%</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            allChecked ? "bg-emerald-500" : isDischarge ? "bg-red-400" : "bg-blue-400"
                          )}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  )}
                </button>

                {/* Expanded content */}
                {isExpanded && !task.completed && (
                  <div className="px-4 pb-4 space-y-3 animate-in slide-in-from-top-2 duration-200">
                    <div className="border-t border-slate-100 pt-3" />

                    {/* Section tabs for daily tasks with maintenance */}
                    {mItems.length > 0 && (
                      <div className="flex gap-1 bg-slate-50 p-0.5 rounded-lg">
                        <button
                          onClick={(e) => { e.stopPropagation(); setActiveSection('cleaning'); }}
                          className={cn(
                            "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-[10px] font-black uppercase tracking-tight transition-all",
                            activeSection === 'cleaning' ? "bg-white shadow-sm text-emerald-700" : "text-slate-400"
                          )}
                        >
                          <SprayCan className="w-3 h-3" /> Limpieza
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setActiveSection('maintenance'); }}
                          className={cn(
                            "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-[10px] font-black uppercase tracking-tight transition-all",
                            activeSection === 'maintenance' ? "bg-white shadow-sm text-orange-700" : "text-slate-400",
                            mFaults > 0 && activeSection !== 'maintenance' && "text-red-500"
                          )}
                        >
                          <Settings className="w-3 h-3" /> Revisión
                          {mFaults > 0 && (
                            <span className="bg-red-500 text-white text-[7px] px-1 py-0.5 rounded-full">{mFaults}</span>
                          )}
                        </button>
                      </div>
                    )}

                    {/* Cleaning checklist */}
                    {activeSection === 'cleaning' && (
                      <div className="space-y-2">
                        {task.checklist.map(item => (
                          <label
                            key={item.id}
                            className={cn(
                              "flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-all active:scale-[0.98]",
                              item.checked ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-100 hover:border-slate-200"
                            )}
                          >
                            <div className={cn(
                              "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors",
                              item.checked ? "bg-emerald-600 border-emerald-600" : "border-slate-300 bg-white"
                            )}>
                              {item.checked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                            </div>
                            <span className={cn(
                              "text-xs font-medium transition-colors",
                              item.checked ? "text-emerald-700 line-through" : "text-slate-700"
                            )}>
                              {item.label}
                            </span>
                            <input type="checkbox" className="sr-only" checked={item.checked} onChange={() => onToggleItem(task.id, item.id)} />
                          </label>
                        ))}
                      </div>
                    )}

                    {/* Maintenance checklist */}
                    {activeSection === 'maintenance' && mItems.length > 0 && (
                      <div className="space-y-2">
                        {/* Group by category */}
                        {Object.entries(
                          mItems.reduce((acc: Record<string, typeof mItems>, item) => {
                            if (!acc[item.category]) acc[item.category] = [];
                            acc[item.category].push(item);
                            return acc;
                          }, {} as Record<string, typeof mItems>)
                        ).map(([category, items]: [string, typeof mItems]) => (
                          <div key={category}>
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5 px-1">{category}</p>
                            {items.map(item => (
                              <div
                                key={item.id}
                                className={cn(
                                  "flex items-center gap-2 p-2.5 rounded-xl border mb-1.5 transition-all",
                                  item.status === 'ok' && "bg-emerald-50 border-emerald-200",
                                  item.status === 'fault' && "bg-red-50 border-red-200",
                                  item.status === 'pending' && "bg-white border-slate-100"
                                )}
                              >
                                <span className={cn(
                                  "text-xs font-medium flex-1",
                                  item.status === 'ok' && "text-emerald-700",
                                  item.status === 'fault' && "text-red-700",
                                  item.status === 'pending' && "text-slate-600"
                                )}>
                                  {item.label}
                                </span>
                                <div className="flex gap-1">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onMaintenanceStatus(task.id, item.id, 'ok'); }}
                                    className={cn(
                                      "w-8 h-8 rounded-lg flex items-center justify-center transition-all text-xs font-black",
                                      item.status === 'ok'
                                        ? "bg-emerald-600 text-white shadow-sm"
                                        : "bg-slate-100 text-slate-400 hover:bg-emerald-100 hover:text-emerald-600"
                                    )}
                                    title="OK"
                                  >
                                    <Check className="w-4 h-4" strokeWidth={3} />
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onMaintenanceStatus(task.id, item.id, 'fault'); }}
                                    className={cn(
                                      "w-8 h-8 rounded-lg flex items-center justify-center transition-all text-xs font-black",
                                      item.status === 'fault'
                                        ? "bg-red-600 text-white shadow-sm"
                                        : "bg-slate-100 text-slate-400 hover:bg-red-100 hover:text-red-600"
                                    )}
                                    title="Falla"
                                  >
                                    <X className="w-4 h-4" strokeWidth={3} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Complete button */}
                    <Button
                      onClick={(e) => { e.stopPropagation(); onComplete(task.id); }}
                      disabled={!canComplete}
                      className={cn(
                        "w-full h-11 rounded-xl font-black text-xs uppercase tracking-widest transition-all",
                        canComplete
                          ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/20"
                          : "bg-slate-100 text-slate-400 cursor-not-allowed"
                      )}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      {canComplete ? 'Completar Tarea' : !allChecked ? `Faltan ${totalCount - checkedCount} items de limpieza` : `Revisar ${mItems.length - mReviewed} items de mantenimiento`}
                    </Button>
                  </div>
                )}

                {task.completed && (
                  <div className="px-4 pb-3">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100">
                      <CheckCircle2 className="w-3 h-3" />
                      Completada a las {task.completedAt ? formatTime(task.completedAt) : '--:--'}
                    </div>
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
};
