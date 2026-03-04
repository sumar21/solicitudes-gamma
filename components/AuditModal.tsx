
import React from 'react';
import { Ticket, WorkflowType, TicketStatus, BedStatus } from '../types';
import { 
  X, MapPin, Plus, TrendingUp, Activity, Users, CheckCircle2, Calendar, Info, SprayCan, Hash, XCircle, ArrowRightLeft
} from './Icons';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { calculateTicketMetrics, cn } from '../lib/utils';

interface AuditModalProps {
  ticket: Ticket | null;
  isOpen: boolean;
  onClose: () => void;
  workflowLabels: Record<WorkflowType, string>;
}

export const AuditModal: React.FC<AuditModalProps> = ({ ticket, isOpen, onClose, workflowLabels }) => {
  if (!ticket) return null;

  const isRejected = ticket.status === TicketStatus.REJECTED;
  const isDirectTransfer = ticket.targetBedOriginalStatus === BedStatus.AVAILABLE;
  
  const { 
    totalCycleTime, 
    waitAdmission, 
    cleaningTime, 
    transportTime,
    adminTime
  } = calculateTicketMetrics(ticket);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[1000px] w-[94vw] md:w-full p-0 overflow-hidden border border-slate-200 shadow-2xl rounded-2xl md:rounded-3xl bg-white [&>button]:hidden">
        <div className="flex flex-col h-full max-h-[90vh]">
          
          {/* HEADER ADAPTATIVO */}
          <div className="bg-white px-5 py-5 md:px-8 md:py-6 flex flex-col border-b border-slate-100 shrink-0">
            <div className="flex items-start justify-between">
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={isRejected ? "destructive" : "outline"} className="text-[9px] font-semibold uppercase tracking-wider px-2 py-0 border-slate-200">
                    {isRejected ? 'Ticket Rechazado' : 'Auditoría Operativa'}
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
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {ticket.date}</span>
                  <span className="flex items-center gap-1 font-semibold text-slate-900"><Activity className="w-3 h-3" /> {workflowLabels[ticket.workflow]}</span>
                </div>
              </div>
              <button onClick={onClose} className="h-9 w-9 md:h-10 md:w-10 bg-slate-50 hover:bg-slate-100 text-slate-400 rounded-xl transition-colors border border-slate-100 flex items-center justify-center shrink-0 ml-2">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* SOLO MÓVIL: TRAYECTORIA COMPACTA EN HEADER */}
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
            
            {/* SIDEBAR ORIGINAL: SOLO VISIBLE EN DESKTOP */}
            <div className="hidden md:block md:w-[320px] bg-slate-50/50 border-r border-slate-100 p-8 space-y-8 overflow-y-auto shrink-0">
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest block mb-3">Tiempo Total en Sistema</span>
                <div className="flex items-baseline gap-2">
                  <span className={cn("text-5xl font-light tracking-tighter tabular-nums leading-none", isRejected ? "text-red-600" : "text-slate-950")}>
                    {totalCycleTime}
                  </span>
                  <span className="text-xs font-medium text-slate-400 uppercase">min</span>
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
                      <XCircle className="w-3 h-3" /> Motivo de Rechazo
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
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500 font-medium">Asignación (Admisión)</span>
                      <span className="font-semibold text-slate-900 tabular-nums">{waitAdmission}m</span>
                    </div>
                    {!isDirectTransfer && (
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-500 font-medium">Preparación (Higiene)</span>
                        <span className="font-semibold text-slate-900 tabular-nums">{cleaningTime}m</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500 font-medium">Traslado (Camillería)</span>
                      <span className="font-semibold text-slate-900 tabular-nums">{transportTime}m</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500 font-medium">Administrativo (Cierre)</span>
                      <span className="font-semibold text-slate-900 tabular-nums">{adminTime}m</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* CONTENIDO PRINCIPAL (TIMELINE + MÉTRICAS MÓVILES) */}
            <div className="flex-1 bg-white p-5 md:p-12 overflow-y-auto">
              
              {/* SOLO MÓVIL: MÉTRICAS COMPACTAS ARRIBA DEL TIMELINE */}
              <div className="md:hidden grid grid-cols-2 gap-3 mb-8">
                 <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-1">Tiempo Total</span>
                    <span className={cn("text-2xl font-bold tabular-nums", isRejected ? "text-red-600" : "text-slate-900")}>{totalCycleTime} min</span>
                 </div>
                 {!isRejected && (
                   <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 flex flex-col justify-center">
                      <span className="text-[8px] font-black text-blue-400 uppercase tracking-widest block mb-1">Traslado</span>
                      <span className="text-2xl font-bold text-blue-900 tabular-nums">{transportTime} min</span>
                   </div>
                 )}
                 {isRejected && ticket.rejectionReason && (
                    <div className="col-span-2 p-3 bg-red-50 rounded-xl border border-red-100 text-[11px] font-medium text-red-900 italic">
                       "{ticket.rejectionReason}"
                    </div>
                 )}
              </div>

              <h4 className="text-[10px] uppercase font-bold text-slate-950 tracking-[0.2em] mb-10 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 opacity-30" /> Trazabilidad de Hitos
              </h4>

              <div className="relative pl-8 space-y-12 before:content-[''] before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[1px] before:bg-slate-100">
                
                <div className="relative">
                  <div className="absolute -left-[32px] top-0 w-6 h-6 rounded-full bg-white border border-slate-200 flex items-center justify-center z-10">
                    <Plus className="w-3 h-3 text-slate-400" />
                  </div>
                  <div className="flex justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Solicitud Creada / Cama Asignada</p>
                      <p className="text-xs text-slate-400 font-medium">Admisión</p>
                    </div>
                    <span className="text-xs font-medium text-slate-400 tabular-nums">{ticket.createdAt}</span>
                  </div>
                </div>

                {isRejected ? (
                  <div className="relative">
                    <div className="absolute -left-[36px] -top-1 w-8 h-8 rounded-full bg-red-600 flex items-center justify-center z-10 shadow-lg animate-pulse">
                      <XCircle className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex justify-between">
                      <div>
                        <p className="text-sm font-semibold text-red-950">Solicitud Rechazada</p>
                        <p className="text-xs text-red-500 font-medium">Fin del ciclo</p>
                      </div>
                      <Badge className="bg-red-600 text-white font-mono font-medium px-2 py-0.5 rounded-md tabular-nums border-none">{ticket.completedAt}</Badge>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Hito: Limpieza (Solo si existió) */}
                    {ticket.cleaningDoneAt && !isDirectTransfer && (
                      <div className="relative">
                        <div className="absolute -left-[32px] top-0 w-6 h-6 rounded-full bg-white border border-slate-200 flex items-center justify-center z-10">
                          <SprayCan className="w-3 h-3 text-slate-400" />
                        </div>
                        <div className="flex justify-between">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Habitación Preparada</p>
                            <p className="text-xs text-slate-400 font-medium">Servicio de Higiene</p>
                          </div>
                          <span className="text-xs font-medium text-slate-400 tabular-nums">{ticket.cleaningDoneAt}</span>
                        </div>
                      </div>
                    )}

                    {/* Hito: Inicio Traslado (Solo si existió explícitamente) */}
                    {ticket.transportStartedAt && !isDirectTransfer && (
                      <div className="relative">
                        <div className="absolute -left-[32px] top-0 w-6 h-6 rounded-full bg-white border border-slate-200 flex items-center justify-center z-10">
                          <ArrowRightLeft className="w-3 h-3 text-slate-400" />
                        </div>
                        <div className="flex justify-between">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Traslado Iniciado</p>
                            <p className="text-xs text-slate-400 font-medium">Azafata Origen</p>
                          </div>
                          <span className="text-xs font-medium text-slate-400 tabular-nums">{ticket.transportStartedAt}</span>
                        </div>
                      </div>
                    )}

                    {/* Hito: Recepción Confirmada */}
                    {ticket.receptionConfirmedAt && (
                      <div className="relative">
                        <div className="absolute -left-[32px] top-0 w-6 h-6 rounded-full bg-white border border-slate-200 flex items-center justify-center z-10">
                          <MapPin className="w-3 h-3 text-slate-400" />
                        </div>
                        <div className="flex justify-between">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Paciente Recibido</p>
                            <p className="text-xs text-slate-400 font-medium">Azafata Destino</p>
                          </div>
                          <span className="text-xs font-medium text-slate-400 tabular-nums">{ticket.receptionConfirmedAt}</span>
                        </div>
                      </div>
                    )}

                    {/* Hito: Consolidación (Fin) */}
                    {ticket.completedAt && (
                      <div className="relative">
                        <div className="absolute -left-[36px] -top-1 w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center z-10 shadow-lg">
                          <CheckCircle2 className="w-4 h-4 text-white" />
                        </div>
                        <div className="flex justify-between">
                          <div>
                            <p className="text-sm font-semibold text-slate-950">Consolidado en PROGAL</p>
                            <p className="text-xs text-slate-500 font-medium">Admisión</p>
                          </div>
                          <Badge className="bg-slate-900 text-white font-mono font-medium px-2 py-0.5 rounded-md tabular-nums border-none">{ticket.completedAt}</Badge>
                        </div>
                      </div>
                    )}
                  </>
                )}

              </div>
            </div>
          </div>

          <div className="bg-slate-50/80 px-6 py-4 flex items-center justify-center md:justify-end border-t border-slate-100 shrink-0">
             <Button onClick={onClose} variant="outline" className="w-full md:w-auto h-11 px-8 rounded-xl font-semibold text-xs uppercase tracking-widest bg-white hover:bg-slate-50 border-slate-200 text-slate-600 transition-all">
               Cerrar Auditoría
             </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
