
import React, { useState, useEffect, useRef } from 'react';
import { Ticket, WorkflowType, TicketStatus, BedStatus } from '../types';
import {
  MapPin, Plus, TrendingUp, Activity, CheckCircle2, Calendar, Info, SprayCan, Hash, XCircle, ArrowRightLeft, Pencil
} from './Icons';
import { Loader2, MessageSquare, Siren } from 'lucide-react';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogTitle, DialogHeader, DialogFooter } from './ui/dialog';
import { Textarea } from './ui/textarea';
import { Cargando } from './ui/estados';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { cn, formatDateTime, formatTime, formatTicketDestination } from '../lib/utils';
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
      {/* Modal canónico (DESIGN §4.1) en variante split-view densa (5xl): header → cuerpo partido
          (sidebar + trazabilidad con su propio scroll y el redactor fijo abajo) → footer. */}
      <DialogContent className="sm:max-w-5xl">

          {/* HEADER */}
          <DialogHeader className="gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={isRejected ? "destructive" : "outline"} className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0">
                    {isRejected ? 'Ticket Cancelado' : 'Auditoría Operativa'}
                  </Badge>
                  {!isRejected && (
                    <Badge variant={isDirectTransfer ? "secondary" : "default"} className={cn("text-[10px] font-semibold uppercase tracking-wider px-2 py-0 border-none", isDirectTransfer ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700")}>
                      {isDirectTransfer ? 'Traslado Directo (Cama Limpia)' : 'Ciclo Completo (Cama en Prep.)'}
                    </Badge>
                  )}
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sede {ticket.sede}</span>
                </div>
                <DialogTitle className="block truncate">
                  {ticket.patientName}
                </DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 md:gap-x-4">
                  <span className="flex items-center gap-1 min-w-0"><Hash className="size-3 shrink-0" /> <span className="truncate">{ticket.id}</span></span>
                  <span className="flex items-center gap-1"><Calendar className="size-3 shrink-0" /> {formatDateTime(ticket.createdAt)}</span>
                  <span className="flex items-center gap-1 font-medium text-foreground"><Activity className="size-3 shrink-0" /> {workflowLabels[ticket.workflow]}</span>
                </DialogDescription>

            {/* SOLO MÓVIL: TRAYECTORIA — doble fila apilada (origen arriba, destino abajo).
                Texto completo que envuelve; nada de truncar ni cruzarse en pantallas chicas. */}
            <div className="md:hidden mt-3 p-3 bg-card rounded-lg border space-y-2">
               <div className="min-w-0">
                 <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Origen</span>
                 <p className="text-xs font-semibold text-foreground wrap-break-word leading-tight">{ticket.origin}</p>
               </div>
               <div className="min-w-0 pt-2 border-t">
                 <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">Destino</span>
                 <p className="text-xs font-bold text-foreground wrap-break-word leading-tight">{formatTicketDestination(ticket)}</p>
               </div>
            </div>
          </DialogHeader>

          {/* Cuerpo partido: el DialogBody no scrollea entero; scrollean la sidebar y la trazabilidad. */}
          <DialogBody className="flex flex-col md:flex-row overflow-hidden p-0 space-y-0">

            {/* SIDEBAR DESKTOP */}
            <div className="hidden md:block md:w-[300px] bg-muted/20 border-r p-5 space-y-5 overflow-y-auto shrink-0">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-2">Tiempo total en sistema</span>
                <div className="flex items-baseline gap-2">
                  <span className={cn("text-4xl font-bold tracking-tight tabular-nums leading-none", isRejected ? "text-red-600" : "text-foreground")}>
                    {loading ? '...' : totalCycleTime}
                  </span>
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t">
                <div className="flex gap-4">
                  <div className="mt-1 shrink-0"><MapPin className="size-4 text-muted-foreground" /></div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Trayectoria</p>
                    <p className="text-sm font-medium text-muted-foreground">{ticket.origin} → <span className="text-foreground font-semibold">{ticket.destination || (isRejected ? 'CANCELADO' : 'Pendiente')}</span></p>
                  </div>
                </div>

                {ticket.urgencia && (
                  <div className="p-3 bg-red-50 rounded-lg border border-red-200 text-red-700">
                    <p className="text-[11px] uppercase font-semibold tracking-wider mb-1.5 flex items-center gap-1">
                      <Siren className="size-3" /> Ingreso por urgencia
                    </p>
                    {ticket.pacienteDeclarado
                      ? <p className="text-xs leading-relaxed">Declarado por Coordinación: <b>{ticket.pacienteDeclarado}</b></p>
                      : <p className="text-xs leading-relaxed">Paciente ya internado (elegido del mapa de camas)</p>}
                    <p className="text-xs leading-relaxed">
                      {ticket.patientCode
                        ? `Vinculado al paciente ${ticket.patientCode}${ticket.eventoInternacion ? ` · evento ${ticket.eventoInternacion}` : ''}`
                        : 'Sin vincular a un paciente de PROGAL'}
                    </p>
                  </div>
                )}

                {isRejected && ticket.rejectionReason && (
                  <div className="p-3 bg-red-50 rounded-lg border border-red-200 text-red-700">
                    <p className="text-[11px] uppercase font-semibold tracking-wider mb-1.5 flex items-center gap-1">
                      <XCircle className="size-3" /> Motivo de cancelación
                    </p>
                    <p className="text-xs font-medium leading-relaxed italic">"{ticket.rejectionReason}"</p>
                  </div>
                )}

                {(ticket.workflow === WorkflowType.INTERNAL || ticket.workflow === WorkflowType.ROOM_CHANGE) && ticket.changeReason && (
                  <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-amber-700">
                    <p className="text-[11px] uppercase font-semibold tracking-wider mb-1.5 flex items-center gap-1">
                      <Info className="size-3" /> Motivo del traslado
                    </p>
                    <p className="text-xs font-medium leading-relaxed">{ticket.changeReason}</p>
                  </div>
                )}
              </div>

              {!isRejected && (
                <div className="space-y-2 pt-4 border-t">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tiempos por servicio</p>
                  {loading ? (
                    <p className="text-xs text-muted-foreground">Cargando...</p>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-muted-foreground font-medium">Asignación (Admisión)</span>
                        <span className="font-semibold text-foreground tabular-nums">{waitAdmission}</span>
                      </div>
                      {!isDirectTransfer && (
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-muted-foreground font-medium">Preparación (Higiene)</span>
                          <span className="font-semibold text-foreground tabular-nums">{cleaningTime}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-muted-foreground font-medium">Traslado (Camillería)</span>
                        <span className="font-semibold text-foreground tabular-nums">{transportTime}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-muted-foreground font-medium">Administrativo (Cierre)</span>
                        <span className="font-semibold text-foreground tabular-nums">{adminTime}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* CONTENIDO PRINCIPAL: trazabilidad scrolleable + redactor fijo abajo */}
            <div className="flex-1 flex flex-col min-h-0 min-w-0">

              {/* SCROLL — sólo la trazabilidad (y métricas en móvil) scrollea */}
              <div ref={auditScrollRef} className="flex-1 overflow-y-auto overflow-x-hidden p-5 md:p-6 min-h-0 min-w-0">

              {/* SOLO MÓVIL: MÉTRICAS */}
              <div className="md:hidden grid grid-cols-2 gap-3 mb-6">
                 <div className={cn("bg-card p-3 rounded-lg border", isRejected && "col-span-2")}>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Tiempo total</span>
                    <span className={cn("text-2xl font-bold tabular-nums", isRejected ? "text-red-600" : "text-foreground")}>{loading ? '...' : totalCycleTime}</span>
                 </div>
                 {!isRejected && (
                   <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 flex flex-col justify-center">
                      <span className="text-[11px] font-semibold text-blue-700 uppercase tracking-wider block mb-1">Traslado</span>
                      <span className="text-2xl font-bold text-blue-800 tabular-nums">{loading ? '...' : transportTime}</span>
                   </div>
                 )}
                 {isRejected && ticket.rejectionReason && (
                    <div className="col-span-2 p-3 bg-red-50 rounded-lg border border-red-200 text-xs font-medium text-red-700 italic">
                       "{ticket.rejectionReason}"
                    </div>
                 )}
              </div>

              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-5 flex items-center gap-2">
                <TrendingUp className="size-4" /> Trazabilidad de hitos
              </h4>

              {loading ? (
                <Cargando texto="Cargando trazabilidad…" className="py-12" />
              ) : timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">Sin movimientos registrados</p>
              ) : (
                <div className="relative pl-8 space-y-5 before:content-[''] before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-border">
                  {timeline.map((item) => {
                    // ── Nodo de OBSERVACIÓN ───────────────────────────────────
                    if (item.kind === 'obs') {
                      const o = item.obs;
                      const post = isPostCloseObs(o.status);
                      const isOriginal = o.id === 'original';
                      return (
                        <div key={item.key} className="relative">
                          <div className={cn(
                            "absolute -top-0.5 left-[-31px] flex items-center justify-center size-5 rounded-full border",
                            post ? "bg-violet-100 border-violet-200" : "bg-amber-100 border-amber-200"
                          )}>
                            <MessageSquare className={cn("size-2.5", post ? "text-violet-600" : "text-amber-600")} />
                          </div>
                          <div className={cn(
                            "rounded-lg border p-3",
                            post ? "bg-violet-50 border-violet-200" : "bg-amber-50 border-amber-200"
                          )}>
                            {post && (
                              <span className="inline-flex items-center gap-1 mb-1.5 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200 text-[10px] font-semibold uppercase tracking-wider">
                                Post cierre
                              </span>
                            )}
                            {isOriginal && (
                              <span className="inline-flex items-center gap-1 mb-1.5 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 text-[10px] font-semibold uppercase tracking-wider">
                                Observación de la solicitud
                              </span>
                            )}
                            <p className="text-sm text-foreground leading-snug whitespace-pre-wrap wrap-break-word">{o.texto}</p>
                            <p className="text-[11px] text-muted-foreground font-medium mt-2 flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-foreground">{o.operador || o.usuario || 'Usuario'}</span>
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
                          "absolute -top-0.5 flex items-center justify-center rounded-full",
                          isFinal ? "left-[-36px] size-8 bg-primary text-primary-foreground shadow-sm"
                          : isModification ? "left-[-34px] size-7 bg-amber-100 border border-amber-200 text-amber-600"
                          : "left-[-32px] size-6 bg-card border text-muted-foreground"
                        )}>
                          <Icon className="size-3.5" />
                        </div>
                        <div className="flex justify-between items-start">
                          <div className="flex-1 min-w-0 pr-3">
                            <p className={cn("text-sm font-semibold", isFinal ? "text-primary" : isModification ? "text-amber-700" : "text-foreground")}>{config.label}</p>
                            <p className="text-xs text-muted-foreground font-medium">{evt.operador || evt.usuario || config.sublabel}</p>
                            {modification && (
                              <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-1">
                                {modification.changes.map((c, ix) => (
                                  <p key={ix} className="text-xs text-foreground font-medium leading-snug">
                                    <span className="text-amber-600 font-bold">·</span> {c}
                                  </p>
                                ))}
                                {modification.motivo && (
                                  <p className="text-[11px] text-amber-700 font-semibold italic mt-2 pt-2 border-t border-amber-200">
                                    Motivo: {modification.motivo}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                          {isFinal ? (
                            <Badge className="bg-primary text-primary-foreground font-mono font-medium px-2 py-0.5 rounded-md tabular-nums border-none text-[11px] shrink-0">
                              {formatTime(evt.fecha)}
                            </Badge>
                          ) : (
                            <span className={cn("text-xs font-medium tabular-nums shrink-0", isModification ? "text-amber-600" : "text-muted-foreground")}>{formatTime(evt.fecha)}</span>
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
                <div className="shrink-0 border-t px-5 py-3 md:px-6 md:py-4">
                  {/* DESKTOP: composer inline */}
                  <div className="hidden md:block space-y-2">
                    <Textarea
                      value={obsText}
                      onChange={e => setObsText(e.target.value)}
                      maxLength={500}
                      rows={2}
                      aria-label="Observación post-cierre"
                      aria-invalid={!!obsError}
                      placeholder="Agregar observación post-cierre… (ej.: faltó firma del parte)"
                      className="min-h-[44px] max-h-[120px] leading-relaxed resize-y"
                    />
                    {obsError && <p role="alert" className="text-xs text-destructive">{obsError}</p>}
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="text-xs text-muted-foreground">Quedará marcada como <span className="font-semibold text-violet-600">post cierre</span>.</span>
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-muted-foreground tabular-nums">{obsText.length}/500</span>
                        <Button type="button" size="sm" onClick={submitObs} disabled={obsSaving || !obsText.trim()}>
                          {obsSaving && <Loader2 className="size-4 animate-spin" />}
                          {obsSaving ? 'Guardando…' : 'Agregar'}
                        </Button>
                      </div>
                    </div>
                  </div>
                  {/* MOBILE: botón compacto → abre el modal de carga */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { setObsError(''); setObsComposerOpen(true); }}
                    className="md:hidden w-full"
                  >
                    <MessageSquare className="size-4" /> Agregar observación
                  </Button>
                </div>
              )}
            </div>
          </DialogBody>

          <DialogFooter>
             <Button type="button" onClick={onClose} variant="outline">
               Cerrar auditoría
             </Button>
          </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* MOBILE: modal de carga de observación post-cierre (se abre desde el botón) */}
    <Dialog open={obsComposerOpen} onOpenChange={(open) => { if (!open && !obsSaving) setObsComposerOpen(false); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <MessageSquare className="size-5 text-violet-600" /> Agregar observación
          </DialogTitle>
          <DialogDescription>
            <span className="font-semibold text-violet-600">Post cierre</span> · <span className="font-medium text-foreground">{ticket.patientName}</span>
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-2">
          <Textarea
            value={obsText}
            onChange={e => setObsText(e.target.value)}
            maxLength={500}
            rows={5}
            autoFocus
            aria-label="Observación post-cierre"
            aria-invalid={!!obsError}
            placeholder="Nota post-cierre… (ej.: faltó firma del parte, corrección administrativa)"
            className="min-h-[120px] leading-relaxed resize-y"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Queda en la auditoría del traslado.</span>
            <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{obsText.length}/500</span>
          </div>
          {obsError && <p role="alert" className="text-xs text-destructive">{obsError}</p>}
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setObsComposerOpen(false)} disabled={obsSaving}>
            Cancelar
          </Button>
          <Button type="button" onClick={submitObs} disabled={obsSaving || !obsText.trim()} className="min-w-[140px]">
            {obsSaving && <Loader2 className="size-4 animate-spin" />}
            {obsSaving ? 'Guardando…' : 'Agregar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};
