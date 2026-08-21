
import React, { useState, useEffect, useRef } from 'react';
import { Ticket, WorkflowType, TicketStatus, BedStatus } from '../types';
import {
  X, MapPin, Plus, TrendingUp, Activity, CheckCircle2, Calendar, Info, SprayCan, Hash, XCircle, ArrowRightLeft, Pencil
} from './Icons';
import { MessageSquare } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogFooter } from './ui/dialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { cn, formatDateTime, formatTime } from '../lib/utils';
import { APP_VERSION } from '../lib/version';

interface TicketEvent {
  id: string;
  ticketId: string;
  tipo: string;
  fecha: string;
  usuario: string;
  usuarioId: string;
  operador?: string;
}

interface Observation {
  id: string;
  ticketId: string;
  status: string;
  texto: string;
  usuario: string;
  usuarioId: string;
  operador?: string;
  fecha: string;
}

// Las observaciones se renderizan como nodos propios en la MISMA línea de tiempo que los
// hitos, ordenadas por fecha. Antes se anclaban al evento que "abría" su status (mapeo
// frágil): si ese evento no existía —p. ej. traslado directo con cama limpia, que arranca
// en "Habitacion Lista" sin hito "Habitacion Preparada", o un ticket cancelado— la obs
// quedaba huérfana y no se mostraba. Con el merge cronológico, toda obs aparece siempre.

// Una observación es "post cierre" si se cargó con el ticket ya cerrado (Consolidado/
// Cancelado) — típicamente desde esta misma auditoría. Se marca distinto.
const isPostCloseObs = (status: string) =>
  status === TicketStatus.COMPLETED || status === TicketStatus.REJECTED;

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

// Parse a modification audit event. Stored format:
//   "Modificacion - {change} | {change} | ... - Motivo: {reason}"
function parseModification(tipo: string): { changes: string[]; motivo: string } | null {
  if (!tipo || !tipo.startsWith('Modificacion')) return null;
  const content = tipo.replace(/^Modificacion\s*-\s*/, '');
  const motivoIdx = content.lastIndexOf(' - Motivo:');
  let changesStr = content;
  let motivo = '';
  if (motivoIdx >= 0) {
    changesStr = content.slice(0, motivoIdx);
    motivo = content.slice(motivoIdx + ' - Motivo:'.length).trim();
  }
  const changes = changesStr.split(' | ').map(s => s.trim()).filter(Boolean);
  return { changes, motivo };
}

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
  const [observations, setObservations] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(false);
  // Redactor para cargar una observación post-cierre desde la auditoría.
  const [obsText, setObsText]     = useState('');
  const [obsSaving, setObsSaving] = useState(false);
  const [obsError, setObsError]   = useState('');
  // En mobile la carga abre un modal aparte (botón) para no comer espacio del timeline.
  const [obsComposerOpen, setObsComposerOpen] = useState(false);
  const auditScrollRef = useRef<HTMLDivElement>(null);
  const pendingScrollRef = useRef(false); // true tras agregar → scrollea el timeline al fondo

  useEffect(() => {
    if (!isOpen || !ticket) { setEvents([]); setObservations([]); setObsText(''); setObsError(''); setObsComposerOpen(false); return; }
    setLoading(true);
    setObsText(''); setObsError(''); setObsComposerOpen(false);
    const token = localStorage.getItem('mediflow_token');
    const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    fetch(`/api/ticket-events?ticketId=${encodeURIComponent(ticket.id)}`, { headers })
      .then(r => r.ok ? r.json() : { events: [] })
      .then(data => setEvents(data.events ?? []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
    // Observaciones — carga on-demand al abrir el modal (no bloquea el render de hitos).
    fetch(`/api/ticket-observations?ticketId=${encodeURIComponent(ticket.id)}`, { headers })
      .then(r => r.ok ? r.json() : { observations: [] })
      .then(data => setObservations(data.observations ?? []))
      .catch(() => setObservations([]));
  }, [isOpen, ticket]);

  // Línea de tiempo unificada: hitos + observaciones, ordenados por fecha. Cada obs es un
  // nodo propio → siempre se muestra, sin depender de que exista el evento de su etapa.
  type TimelineItem =
    | { kind: 'event'; key: string; fecha: string; evt: TicketEvent }
    | { kind: 'obs';   key: string; fecha: string; obs: Observation };
  const timeline: TimelineItem[] = React.useMemo(() => {
    const items: TimelineItem[] = [
      ...events.map(e => ({ kind: 'event' as const, key: `e-${e.id}`, fecha: e.fecha, evt: e })),
      ...observations.map(o => ({ kind: 'obs' as const, key: `o-${o.id}`, fecha: o.fecha, obs: o })),
    ];
    // Observación ORIGINAL de la solicitud (la que cargó Admisión al crear el reclamo). Vive en
    // ticket.observations (NO en /api/ticket-observations, que trae solo las post-cierre) → antes solo
    // salía en el Excel. Se inyecta como nodo, fechado en la creación, para que aparezca en la auditoría.
    const original = (ticket?.observations ?? '').trim();
    if (original) {
      const fecha = ticket!.createdAt || ticket!.date || '';
      items.push({
        kind: 'obs', key: 'o-original', fecha,
        obs: {
          id: 'original', ticketId: ticket!.id, status: '', texto: original,
          usuario: ticket!.createdBy ?? 'Admisión', usuarioId: ticket!.createdById ?? '', fecha,
        },
      });
    }
    items.sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
    return items;
  }, [events, observations, ticket]);

  // Tras agregar una observación, scrollea el timeline al fondo (NO en la carga inicial).
  useEffect(() => {
    if (pendingScrollRef.current && auditScrollRef.current) {
      auditScrollRef.current.scrollTop = auditScrollRef.current.scrollHeight;
      pendingScrollRef.current = false;
    }
  }, [timeline]);

  // Carga una observación post-cierre desde la auditoría. La API ya acepta cualquier estado;
  // posteamos directo (como el resto de la auditoría) con el usuario de la sesión.
  const submitObs = async () => {
    const text = obsText.trim();
    if (!ticket || !text) return;
    setObsSaving(true); setObsError('');
    let usuario = '', usuarioId = '';
    try {
      const u = JSON.parse(localStorage.getItem('mediflow_user') || 'null');
      usuario = u?.name ?? ''; usuarioId = u?.id ?? '';
    } catch { /* sesión sin user → se guarda sin autor */ }
    try {
      const token = localStorage.getItem('mediflow_token');
      const r = await fetch('/api/ticket-observations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ ticketId: ticket.id, status: ticket.status, texto: text, usuario, usuarioId, version: APP_VERSION }),
      });
      if (!r.ok) throw new Error('post failed');
      // Append optimista: aparece al instante en la línea de tiempo (marcada post-cierre).
      setObservations(prev => [...prev, {
        id: `local-${Date.now()}`, ticketId: ticket.id, status: ticket.status,
        texto: text, usuario, usuarioId, fecha: new Date().toISOString(),
      }]);
      setObsText('');
      setObsComposerOpen(false); // cierra el modal de carga (mobile); en desktop ya está false
      pendingScrollRef.current = true; // scrollea el timeline al fondo para ver la nota nueva
    } catch {
      setObsError('No se pudo guardar. Reintentá.');
    } finally {
      setObsSaving(false);
    }
  };

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
    <>
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[1000px] w-[94vw] md:w-full max-h-[92vh] p-0 overflow-hidden border border-slate-200 shadow-2xl rounded-2xl md:rounded-3xl bg-white [&>button]:hidden">
        <div className="flex flex-col max-h-[92vh] min-h-0 min-w-0 overflow-hidden">

          {/* HEADER */}
          <div className="bg-white px-5 py-3 md:px-6 md:py-4 flex flex-col border-b border-slate-100 shrink-0">
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
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:gap-x-4 text-[10px] md:text-[11px] text-slate-400 font-medium">
                  <span className="flex items-center gap-1 min-w-0"><Hash className="w-3 h-3 shrink-0" /> <span className="truncate">{ticket.id}</span></span>
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3 shrink-0" /> {formatDateTime(ticket.createdAt)}</span>
                  <span className="flex items-center gap-1 font-semibold text-slate-900"><Activity className="w-3 h-3 shrink-0" /> {workflowLabels[ticket.workflow]}</span>
                </div>
              </div>
              <button onClick={onClose} className="h-9 w-9 md:h-10 md:w-10 bg-slate-50 hover:bg-slate-100 text-slate-400 rounded-xl transition-colors border border-slate-100 flex items-center justify-center shrink-0 ml-2">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* SOLO MÓVIL: TRAYECTORIA — doble fila apilada (origen arriba, destino abajo).
                Texto completo que envuelve; nada de truncar ni cruzarse en pantallas chicas. */}
            <div className="md:hidden mt-4 p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-2">
               <div className="min-w-0">
                 <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Origen</span>
                 <p className="text-[11px] font-bold text-slate-700 break-words leading-tight">{ticket.origin}</p>
               </div>
               <div className="min-w-0 pt-2 border-t border-slate-200/60">
                 <span className="text-[8px] font-bold text-blue-400 uppercase tracking-widest">Destino</span>
                 <p className="text-[11px] font-black text-blue-900 break-words leading-tight">{ticket.destination || (isRejected ? 'ANULADO' : 'Pendiente')}</p>
               </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row overflow-hidden flex-1 min-h-0">

            {/* SIDEBAR DESKTOP */}
            <div className="hidden md:block md:w-[300px] bg-slate-50/50 border-r border-slate-100 p-5 space-y-5 overflow-y-auto shrink-0">
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest block mb-2">Tiempo Total en Sistema</span>
                <div className="flex items-baseline gap-2">
                  <span className={cn("text-4xl font-light tracking-tighter tabular-nums leading-none", isRejected ? "text-red-600" : "text-emerald-950")}>
                    {loading ? '...' : totalCycleTime}
                  </span>
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t border-slate-100">
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

                {(ticket.workflow === WorkflowType.INTERNAL || ticket.workflow === WorkflowType.ROOM_CHANGE) && ticket.changeReason && (
                  <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
                    <p className="text-[9px] uppercase font-bold text-amber-600 tracking-widest mb-1.5 flex items-center gap-1">
                      <Info className="w-3 h-3" /> Motivo del Traslado
                    </p>
                    <p className="text-xs font-semibold text-amber-900 leading-relaxed">{ticket.changeReason}</p>
                  </div>
                )}
              </div>

              {!isRejected && (
                <div className="space-y-2 pt-4 border-t border-slate-100">
                  <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">Tiempos por Servicio</p>
                  {loading ? (
                    <p className="text-xs text-slate-400">Cargando...</p>
                  ) : (
                    <div className="space-y-1.5">
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

            {/* CONTENIDO PRINCIPAL: trazabilidad scrolleable + redactor fijo abajo */}
            <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-white">

              {/* SCROLL — sólo la trazabilidad (y métricas en móvil) scrollea */}
              <div ref={auditScrollRef} className="flex-1 overflow-y-auto overflow-x-hidden p-5 md:p-6 min-h-0 min-w-0">

              {/* SOLO MÓVIL: MÉTRICAS */}
              <div className="md:hidden grid grid-cols-2 gap-3 mb-6">
                 <div className={cn("bg-slate-50 p-3 rounded-xl border border-slate-100", isRejected && "col-span-2")}>
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

              <h4 className="text-[10px] uppercase font-bold text-emerald-950 tracking-[0.2em] mb-5 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 opacity-30" /> Trazabilidad de Hitos
              </h4>

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
                </div>
              ) : timeline.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-12">Sin movimientos registrados</p>
              ) : (
                <div className="relative pl-8 space-y-5 before:content-[''] before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[1px] before:bg-slate-100">
                  {timeline.map((item) => {
                    // ── Nodo de OBSERVACIÓN ───────────────────────────────────
                    if (item.kind === 'obs') {
                      const o = item.obs;
                      const post = isPostCloseObs(o.status);
                      const isOriginal = o.id === 'original';
                      return (
                        <div key={item.key} className="relative">
                          <div className={cn(
                            "absolute -top-0.5 -left-[31px] flex items-center justify-center z-10 w-5 h-5 rounded-full border",
                            post ? "bg-violet-100 border-violet-200" : "bg-amber-100 border-amber-200"
                          )}>
                            <MessageSquare className={cn("w-2.5 h-2.5", post ? "text-violet-600" : "text-amber-600")} />
                          </div>
                          <div className={cn(
                            "rounded-xl border p-3",
                            post ? "bg-violet-50/70 border-violet-200" : "bg-amber-50/60 border-amber-100"
                          )}>
                            {post && (
                              <span className="inline-flex items-center gap-1 mb-1.5 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200 text-[9px] font-bold uppercase tracking-wider">
                                Post cierre
                              </span>
                            )}
                            {isOriginal && (
                              <span className="inline-flex items-center gap-1 mb-1.5 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 text-[9px] font-bold uppercase tracking-wider">
                                Observación de la solicitud
                              </span>
                            )}
                            <p className="text-sm text-slate-800 leading-snug whitespace-pre-wrap break-words">{o.texto}</p>
                            <p className="text-[10px] text-slate-400 font-medium mt-2 flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-slate-600">{o.operador || o.usuario || 'Usuario'}</span>
                              <span>·</span>
                              <span>{formatDateTime(o.fecha)}</span>
                              {o.status && !post && (<><span>·</span><span className="italic">{o.status}</span></>)}
                            </p>
                          </div>
                        </div>
                      );
                    }

                    // ── Nodo de HITO (evento) ─────────────────────────────────
                    const evt = item.evt;
                    const modification = parseModification(evt.tipo);
                    const isModification = !!modification;
                    const config = isModification
                      ? { label: 'Modificación de Traslado', sublabel: 'Admisión', icon: Pencil }
                      : (EVENT_CONFIG[evt.tipo] ?? { label: evt.tipo, sublabel: evt.operador || evt.usuario, icon: Plus });
                    const Icon = config.icon;
                    const isFinal = evt.tipo === 'Consolidado Progal';

                    return (
                      <div key={item.key} className="relative">
                        <div className={cn(
                          "absolute -top-0.5 flex items-center justify-center z-10",
                          isFinal ? "-left-[36px] w-8 h-8 rounded-full bg-emerald-950 shadow-lg"
                          : isModification ? "-left-[34px] w-7 h-7 rounded-full bg-amber-500 shadow-sm"
                          : "-left-[32px] w-6 h-6 rounded-full bg-white border border-slate-200"
                        )}>
                          <Icon className={cn("w-3.5 h-3.5", isFinal || isModification ? "text-white" : "text-slate-400")} />
                        </div>
                        <div className="flex justify-between items-start">
                          <div className="flex-1 min-w-0 pr-3">
                            <p className={cn("text-sm font-semibold", isFinal ? "text-emerald-950" : isModification ? "text-amber-700" : "text-slate-900")}>{config.label}</p>
                            <p className="text-xs text-slate-400 font-medium">{evt.operador || evt.usuario || config.sublabel}</p>
                            {modification && (
                              <div className="mt-2 p-3 bg-amber-50/70 border border-amber-100 rounded-lg space-y-1">
                                {modification.changes.map((c, ix) => (
                                  <p key={ix} className="text-xs text-slate-700 font-medium leading-snug">
                                    <span className="text-amber-600 font-bold">·</span> {c}
                                  </p>
                                ))}
                                {modification.motivo && (
                                  <p className="text-[11px] text-amber-800 font-semibold italic mt-2 pt-2 border-t border-amber-100/80">
                                    Motivo: {modification.motivo}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                          {isFinal ? (
                            <Badge className="bg-emerald-950 text-white font-mono font-medium px-2 py-0.5 rounded-md tabular-nums border-none text-[11px] shrink-0">
                              {formatTime(evt.fecha)}
                            </Badge>
                          ) : (
                            <span className={cn("text-xs font-medium tabular-nums shrink-0", isModification ? "text-amber-600" : "text-slate-400")}>{formatTime(evt.fecha)}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              </div>{/* /SCROLL trazabilidad */}

              {/* BARRA FIJA abajo. Desktop: composer inline (hay espacio). Mobile: botón
                  que abre un modal → libera alto y se ve más trazabilidad. */}
              {!loading && (
                <div className="shrink-0 border-t border-slate-100 px-5 py-3 md:px-6 md:py-4 bg-white">
                  {/* DESKTOP: composer inline */}
                  <div className="hidden md:block space-y-2">
                    <textarea
                      value={obsText}
                      onChange={e => setObsText(e.target.value)}
                      maxLength={500}
                      rows={2}
                      placeholder="Agregar observación post-cierre… (ej.: faltó firma del parte)"
                      className="w-full min-h-[44px] max-h-[120px] rounded-xl border border-slate-200 p-2.5 text-sm leading-relaxed focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 outline-none resize-y"
                    />
                    {obsError && <p className="text-red-500 text-xs font-bold">{obsError}</p>}
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="text-[10px] text-slate-400">Quedará marcada como <span className="font-semibold text-violet-600">post cierre</span>.</span>
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-slate-300 tabular-nums">{obsText.length}/500</span>
                        <Button onClick={submitObs} disabled={obsSaving || !obsText.trim()} className="rounded-xl h-9 px-5 bg-violet-600 hover:bg-violet-700 text-white">
                          {obsSaving ? 'Guardando…' : 'Agregar'}
                        </Button>
                      </div>
                    </div>
                  </div>
                  {/* MOBILE: botón compacto → abre el modal de carga */}
                  <button
                    type="button"
                    onClick={() => { setObsError(''); setObsComposerOpen(true); }}
                    className="md:hidden w-full flex items-center justify-center gap-2 h-11 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 font-bold text-xs uppercase tracking-wide active:scale-[0.98] transition-transform"
                  >
                    <MessageSquare className="w-4 h-4" /> Agregar observación
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="bg-slate-50/80 px-4 py-2.5 flex items-center justify-center md:justify-end border-t border-slate-100 shrink-0">
             <Button onClick={onClose} variant="outline" className="w-full md:w-auto h-8 px-5 rounded-xl font-semibold text-xs uppercase tracking-widest bg-white hover:bg-slate-50 border-slate-200 text-slate-600 transition-all">
               Cerrar Auditoría
             </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* MOBILE: modal de carga de observación post-cierre (se abre desde el botón) */}
    <Dialog open={obsComposerOpen} onOpenChange={(open) => { if (!open && !obsSaving) setObsComposerOpen(false); }}>
      <DialogContent className="sm:max-w-[440px] rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2 pr-6">
            <MessageSquare className="w-4 h-4 text-violet-600" /> Agregar observación
          </DialogTitle>
          <p className="text-[11px] text-slate-400 font-medium">
            <span className="font-semibold text-violet-600">Post cierre</span> · {ticket.patientName}
          </p>
        </DialogHeader>

        <div className="grid gap-2">
          <textarea
            value={obsText}
            onChange={e => setObsText(e.target.value)}
            maxLength={500}
            rows={5}
            autoFocus
            placeholder="Nota post-cierre… (ej.: faltó firma del parte, corrección administrativa)"
            className="w-full min-h-[120px] rounded-xl border border-slate-200 p-3 text-sm leading-relaxed focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 outline-none resize-y"
          />
          <div className="flex items-center justify-between gap-2 px-0.5">
            <span className="text-[11px] text-slate-400">Queda en la auditoría del traslado.</span>
            <span className="text-[11px] text-slate-300 tabular-nums shrink-0">{obsText.length}/500</span>
          </div>
          {obsError && <p className="text-red-500 text-xs font-bold">{obsError}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setObsComposerOpen(false)} disabled={obsSaving} className="rounded-xl h-10 px-6">
            Cancelar
          </Button>
          <Button onClick={submitObs} disabled={obsSaving || !obsText.trim()} className="rounded-xl h-10 px-6 bg-violet-600 hover:bg-violet-700 text-white">
            {obsSaving ? 'Guardando…' : 'Agregar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};
