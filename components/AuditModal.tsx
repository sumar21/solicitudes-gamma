
import React, { useState, useEffect } from 'react';
import { Ticket, WorkflowType, TicketStatus, BedStatus } from '../types';
import {
  X, MapPin, Plus, TrendingUp, Activity, CheckCircle2, Calendar, Info, SprayCan, Hash, XCircle, ArrowRightLeft
} from './Icons';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { cn, formatDateTime, formatTime } from '../lib/utils';

interface TicketEvent {
  id: string;
  ticketId: string;
  tipo: string;
  fecha: string;
  usuario: string;
  usuarioId: string;
}

interface AuditModalProps {
  ticket: Ticket | null;
  isOpen: boolean;
  onClose: () => void;
  workflowLabels: Record<WorkflowType, string>;
}

const EVENT_CONFIG: Record<string, { label: string; sublabel: string; icon: React.FC<any> }> = {
  'Solicitud Creada':      { label: 'Solicitud Creada / Cama Asignada', sublabel: 'Admisión',         icon: Plus },
  'Habitacion Preparada':  { label: 'Habitación Preparada',             sublabel: 'Azafata Destino',   icon: SprayCan },
  'Inicio Traslado':       { label: 'Traslado Iniciado',                sublabel: 'Azafata Origen',    icon: ArrowRightLeft },
  'Paciente Recibido':     { label: 'Paciente Recibido',                sublabel: 'Azafata Destino',   icon: MapPin },
  'Consolidado Progal':    { label: 'Consolidado en PROGAL',            sublabel: 'Admisión',          icon: CheckCircle2 },
};

function diffMinutes(a: string, b: string): string {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (isNaN(ta) || isNaN(tb)) return '0m';
  const diffMs = Math.max(0, tb - ta);
  if (diffMs === 0) return '0m';
  const totalMinutes = diffMs / 60000;
  if (totalMinutes < 1) return `${Math.round(diffMs / 1000)}s`;
  const hrs = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

export const AuditModal: React.FC<AuditModalProps> = ({ ticket, isOpen, onClose, workflowLabels }) => {
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !ticket) { setEvents([]); return; }
    setLoading(true);
    const token = sessionStorage.getItem('mediflow_token');
    fetch(`/api/ticket-events?ticketId=${encodeURIComponent(ticket.id)}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
      .then(r => r.ok ? r.json() : { events: [] })
      .then(data => setEvents(data.events ?? []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [isOpen, ticket]);

  if (!ticket) return null;

  const isRejected = ticket.status === TicketStatus.REJECTED;
  const isDirectTransfer = ticket.targetBedOriginalStatus === BedStatus.AVAILABLE;

  // Calculate times from events
  const findEvent = (tipo: string) => events.find(e => e.tipo === tipo);
  const createdEvt     = findEvent('Solicitud Creada');
  const preparedEvt    = findEvent('Habitacion Preparada');
  const transportEvt   = findEvent('Inicio Traslado');
  const receivedEvt    = findEvent('Paciente Recibido');
  const consolidatedEvt = findEvent('Consolidado Progal');

  const totalCycleTime = createdEvt && consolidatedEvt ? diffMinutes(createdEvt.fecha, consolidatedEvt.fecha) : '0m';

  // Tiempos por servicio
  const waitAdmission = createdEvt && (preparedEvt || transportEvt)
    ? diffMinutes(createdEvt.fecha, (preparedEvt || transportEvt)!.fecha) : '0m';
  const cleaningTime = preparedEvt && (transportEvt || receivedEvt)
    ? diffMinutes(preparedEvt.fecha, (transportEvt || receivedEvt)!.fecha) : '0m';
  const transportTime = (transportEvt || preparedEvt) && receivedEvt
    ? diffMinutes((transportEvt || preparedEvt)!.fecha, receivedEvt.fecha) : '0m';
  const adminTime = receivedEvt && consolidatedEvt
    ? diffMinutes(receivedEvt.fecha, consolidatedEvt.fecha) : '0m';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[1000px] w-[94vw] md:w-full p-0 overflow-hidden border border-slate-200 shadow-2xl rounded-2xl md:rounded-3xl bg-white [&>button]:hidden">
        <div className="flex flex-col max-h-[90vh]">

          {/* HEADER */}
          <div className="bg-white px-5 py-5 md:px-8 md:py-6 flex flex-col border-b border-slate-100 shrink-0">
            <div className="flex items-start justify-between">
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={isRejected ? "destructive" : "outline"} className="text-[9px] font-semibold uppercase tracking-wider px-2 py-0 border-slate-200">
                    {isRejected ? 'Ticket Cancelado' : 'Auditoría Operativa'}
                  </Badge>
                  {!isRejected && (
                    <Badge variant={isDirectTransfer ? "secondary" : "default"} className={cn("text-[9px] font-semibold uppercase tracking-wider px-2 py-0 border-none", isDirectTransfer ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700")}>
                      {isDirectTransfer ? 'Traslado Directo (Cama Limpia)' : 'Ciclo Completo (Cama en Prep.)'}
                    </Badge>
                  )}
                  <span className="text-[10px] font-medium text-slate-300 uppercase tracking-widest">Sede {ticket.sede}</span>
                </div>
                <DialogTitle className="text-lg md:text-2xl font-bold text-slate-900 tracking-tight truncate">
                  {ticket.patientName}
                </DialogTitle>
                <div className="flex items-center gap-3 md:gap-4 text-[10px] md:text-[11px] text-slate-400 font-medium">
                  <span className="flex items-center gap-1"><Hash className="w-3 h-3" /> {ticket.id}</span>
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {formatDateTime(ticket.createdAt)}</span>
                  <span className="flex items-center gap-1 font-semibold text-slate-900"><Activity className="w-3 h-3" /> {workflowLabels[ticket.workflow]}</span>
                </div>
              </div>
              <button onClick={onClose} className="h-9 w-9 md:h-10 md:w-10 bg-slate-50 hover:bg-slate-100 text-slate-400 rounded-xl transition-colors border border-slate-100 flex items-center justify-center shrink-0 ml-2">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* SOLO MÓVIL: TRAYECTORIA */}
            <div className="md:hidden mt-4 p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between gap-2">
               <div className="flex flex-col min-w-0">
                 <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Origen</span>
                 <span className="text-[11px] font-bold text-slate-700 truncate">{ticket.origin}</span>
               </div>
               <ArrowRightLeft className="w-3 h-3 text-slate-300 shrink-0" />
               <div className="flex flex-col items-end min-w-0 text-right">
                 <span className="text-[8px] font-bold text-blue-400 uppercase tracking-widest">Destino</span>
                 <span className="text-[11px] font-black text-blue-900 truncate">{ticket.destination || (isRejected ? 'ANULADO' : 'Pendiente')}</span>
               </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row overflow-hidden">

            {/* SIDEBAR DESKTOP */}
            <div className="hidden md:block md:w-[320px] bg-slate-50/50 border-r border-slate-100 p-8 space-y-8 overflow-y-auto shrink-0">
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest block mb-3">Tiempo Total en Sistema</span>
                <div className="flex items-baseline gap-2">
                  <span className={cn("text-5xl font-light tracking-tighter tabular-nums leading-none", isRejected ? "text-red-600" : "text-emerald-950")}>
                    {loading ? '...' : totalCycleTime}
                  </span>
                </div>
              </div>

              <div className="space-y-5 pt-6 border-t border-slate-100">
                <div className="flex gap-4">
                  <div className="mt-1 shrink-0"><MapPin className="w-4 h-4 text-slate-300" /></div>
                  <div>
                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mb-1">Trayectoria</p>
                    <p className="text-sm font-medium text-slate-700">{ticket.origin} → <span className="text-slate-900 font-semibold">{ticket.destination || (isRejected ? 'CANCELADO' : 'Pendiente')}</span></p>
                  </div>
                </div>

                {isRejected && ticket.rejectionReason && (
                  <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                    <p className="text-[9px] uppercase font-black text-red-600 tracking-widest mb-1.5 flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> Motivo de Cancelación
                    </p>
                    <p className="text-xs font-bold text-red-900 leading-relaxed italic">"{ticket.rejectionReason}"</p>
                  </div>
                )}

                {ticket.workflow === WorkflowType.ROOM_CHANGE && ticket.changeReason && (
                  <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
                    <p className="text-[9px] uppercase font-bold text-amber-600 tracking-widest mb-1.5 flex items-center gap-1">
                      <Info className="w-3 h-3" /> Motivo del Cambio
                    </p>
                    <p className="text-xs font-semibold text-amber-900 leading-relaxed">{ticket.changeReason}</p>
                  </div>
                )}
              </div>

              {!isRejected && (
                <div className="space-y-4 pt-6 border-t border-slate-100">
                  <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">Tiempos por Servicio</p>
                  {loading ? (
                    <p className="text-xs text-slate-400">Cargando...</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-500 font-medium">Asignación (Admisión)</span>
                        <span className="font-semibold text-slate-900 tabular-nums">{waitAdmission}</span>
                      </div>
                      {!isDirectTransfer && (
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-500 font-medium">Preparación (Higiene)</span>
                          <span className="font-semibold text-slate-900 tabular-nums">{cleaningTime}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-500 font-medium">Traslado (Camillería)</span>
                        <span className="font-semibold text-slate-900 tabular-nums">{transportTime}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-500 font-medium">Administrativo (Cierre)</span>
                        <span className="font-semibold text-slate-900 tabular-nums">{adminTime}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* CONTENIDO PRINCIPAL (TIMELINE) */}
            <div className="flex-1 bg-white p-5 md:p-12 overflow-y-auto">

              {/* SOLO MÓVIL: MÉTRICAS */}
              <div className="md:hidden grid grid-cols-2 gap-3 mb-8">
                 <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-1">Tiempo Total</span>
                    <span className={cn("text-2xl font-bold tabular-nums", isRejected ? "text-red-600" : "text-slate-900")}>{loading ? '...' : totalCycleTime}</span>
                 </div>
                 {!isRejected && (
                   <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 flex flex-col justify-center">
                      <span className="text-[8px] font-black text-blue-400 uppercase tracking-widest block mb-1">Traslado</span>
                      <span className="text-2xl font-bold text-blue-900 tabular-nums">{loading ? '...' : transportTime}</span>
                   </div>
                 )}
                 {isRejected && ticket.rejectionReason && (
                    <div className="col-span-2 p-3 bg-red-50 rounded-xl border border-red-100 text-[11px] font-medium text-red-900 italic">
                       "{ticket.rejectionReason}"
                    </div>
                 )}
              </div>

              <h4 className="text-[10px] uppercase font-bold text-emerald-950 tracking-[0.2em] mb-10 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 opacity-30" /> Trazabilidad de Hitos
              </h4>

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
                </div>
              ) : events.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-12">Sin movimientos registrados</p>
              ) : (
                <div className="relative pl-8 space-y-12 before:content-[''] before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[1px] before:bg-slate-100">
                  {events.map((evt, i) => {
                    const config = EVENT_CONFIG[evt.tipo] ?? { label: evt.tipo, sublabel: evt.usuario, icon: Plus };
                    const Icon = config.icon;
                    const isLast = i === events.length - 1;
                    const isFinal = evt.tipo === 'Consolidado Progal';

                    return (
                      <div key={evt.id} className="relative">
                        <div className={cn(
                          "absolute -top-0.5 flex items-center justify-center z-10",
                          isFinal ? "-left-[36px] w-8 h-8 rounded-full bg-emerald-950 shadow-lg" : "-left-[32px] w-6 h-6 rounded-full bg-white border border-slate-200"
                        )}>
                          <Icon className={cn("w-3.5 h-3.5", isFinal ? "text-white" : "text-slate-400")} />
                        </div>
                        <div className="flex justify-between items-start">
                          <div>
                            <p className={cn("text-sm font-semibold", isFinal ? "text-emerald-950" : "text-slate-900")}>{config.label}</p>
                            <p className="text-xs text-slate-400 font-medium">{evt.usuario || config.sublabel}</p>
                          </div>
                          {isFinal ? (
                            <Badge className="bg-emerald-950 text-white font-mono font-medium px-2 py-0.5 rounded-md tabular-nums border-none text-[11px]">
                              {formatTime(evt.fecha)}
                            </Badge>
                          ) : (
                            <span className="text-xs font-medium text-slate-400 tabular-nums">{formatTime(evt.fecha)}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="bg-slate-50/80 px-4 py-3 flex items-center justify-center md:justify-end border-t border-slate-100 shrink-0">
             <Button onClick={onClose} variant="outline" className="w-full md:w-auto h-9 px-6 rounded-xl font-semibold text-xs uppercase tracking-widest bg-white hover:bg-slate-50 border-slate-200 text-slate-600 transition-all">
               Cerrar Auditoría
             </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
