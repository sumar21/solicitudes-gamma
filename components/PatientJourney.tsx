import React, { useState, useEffect, useMemo } from 'react';
import { Ticket, WorkflowType, TicketStatus, CirugiaTraslado, CirugiaEstado } from '../types';
import {
  MapPin, MoveRight, Activity, Calendar, Hash, User, CheckCircle2, XCircle,
  Clock, ArrowRightLeft, History,
} from './Icons';
import { MessageSquare } from 'lucide-react';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { StatusBadge } from './ui/status-badge';
import { cn, formatDateTime, formatTime, formatBedName, formatDateReadable, formatTicketDestination } from '../lib/utils';
import { eventConfigFor, parseModification } from '../lib/ticketEvents';
import { CIRUGIA_ESTADO_LABEL, CIRUGIA_PILL_CLASS, CIRUGIA_TIPO_PREVIA } from '../lib/constants';
import { cirugiaEventoLabel, esRetroceso } from '../lib/cirugiaEventos';

interface TicketEvent {
  id: string;
  ticketId: string;
  tipo: string;
  fecha: string;
  usuario: string;
  usuarioId: string;
  operador?: string;
}

interface PatientJourneyProps {
  /** Todos los tickets del paciente (activos + históricos). */
  patientTickets: Ticket[];
  isOpen: boolean;
  onClose: () => void;
  workflowLabels: Record<WorkflowType, string>;
  /**
   * Dónde tiene HOY PROGAL al paciente: label de la cama, `null` si el mapa está cargado y no figura
   * internado, `undefined` si no se sabe (mapa sin cargar). Sin esto, "Ubicación actual" era el destino del
   * último traslado de MediFlow y un paciente dado de alta seguía "en" esa cama (consulta del 26/10/2026).
   */
  ubicacionProgal?: string | null;
}

const ACTIVE_STATUSES = new Set<TicketStatus>([
  TicketStatus.WAITING_ROOM,
  TicketStatus.IN_TRANSIT,
  TicketStatus.IN_TRANSPORT,
  TicketStatus.WAITING_CONSOLIDATION,
  // Un pre-ticket está VIVO: sin esto el journey lo pintaba verde con el badge 'Consolidado'.
  TicketStatus.PRESOLICITUD,
]);

const isActive = (t: Ticket) => ACTIVE_STATUSES.has(t.status);

// Fecha de referencia para ordenar/cerrar un episodio.
const episodeEnd = (t: Ticket) => t.completedAt || t.createdAt;

// Un paso de la operatoria (cirugia_eventos) — para el timeline auditable dentro del journey.
interface CxEvento { tipo: string; at: string; usuario?: string; operador?: string; meta?: { de?: unknown; a?: unknown } | null; }

// Panel "Cirugías" del journey: trae todas las rondas del paciente (GET /api/cirugia?paciente=) y,
// por cada una, sus pasos (GET ?eventos=<id> → cirugia_eventos) para mostrar el timeline auditable
// completo (retiro, en cirugía, devolución, recepción, tolerancia), no solo el estado actual.
const CirugiaJourney: React.FC<{ patientCode?: string; isOpen: boolean }> = ({ patientCode, isOpen }) => {
  const [cirugias, setCirugias] = useState<CirugiaTraslado[]>([]);
  const [eventsByCx, setEventsByCx] = useState<Map<string, CxEvento[]>>(new Map());
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!isOpen || !patientCode) { setCirugias([]); setEventsByCx(new Map()); return; }
    let cancelled = false;
    setLoading(true);
    const token = localStorage.getItem('mediflow_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(`/api/cirugia?paciente=${encodeURIComponent(patientCode)}`, { headers })
      .then(r => r.ok ? r.json() : { cirugias: [] })
      .then(async (d: { cirugias?: CirugiaTraslado[] }) => {
        if (cancelled) return;
        const list = Array.isArray(d.cirugias) ? d.cirugias : [];
        setCirugias(list);
        // Pasos por operatoria, en paralelo → timeline auditable de cada cirugía.
        const pairs = await Promise.all(list.map(async (c): Promise<[string, CxEvento[]]> => {
          try {
            const rr = await fetch(`/api/cirugia?eventos=${encodeURIComponent(c.id)}`, { headers });
            if (!rr.ok) return [String(c.id), []];
            const dd = await rr.json();
            return [String(c.id), Array.isArray(dd.eventos) ? dd.eventos : []];
          } catch { return [String(c.id), []]; }
        }));
        if (!cancelled) setEventsByCx(new Map(pairs));
      })
      .catch(() => { if (!cancelled) { setCirugias([]); setEventsByCx(new Map()); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, patientCode]);

  const sorted = useMemo(
    () => [...cirugias].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    [cirugias],
  );
  const dur = (a?: string, b?: string) => {
    const t1 = Date.parse(String(a ?? '')), t2 = Date.parse(String(b ?? ''));
    if (!Number.isFinite(t1) || !Number.isFinite(t2)) return '';
    const min = Math.max(0, Math.round((t2 - t1) / 60000));
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  };

  if (loading) return <p className="text-center text-xs text-muted-foreground py-10">Cargando cirugías…</p>;
  if (!patientCode) return <p className="text-center text-xs text-muted-foreground py-10">Sin código de paciente para buscar cirugías.</p>;
  if (sorted.length === 0) return <p className="text-center text-xs text-muted-foreground py-10">Este paciente no tiene cirugías registradas.</p>;

  return (
    <section>
      <h4 className="text-[10px] uppercase font-bold text-primary tracking-wider mb-4 flex items-center gap-2">
        <Activity className="w-4 h-4 opacity-30" /> Cirugías del paciente
      </h4>
      <div className="space-y-3">
        {sorted.map(c => {
          const est = c.estado as CirugiaEstado;
          const cambio = !!c.camaDestino && c.camaDestino !== c.camaOrigen;
          const cerrada = c.estado === 'TOLERANCIA_EVALUADA' || c.estado === 'CANCELADO';
          // Cirugía previa registrada a mano ("Ya se operó (fuera de MediFlow)"): no tiene pasos ni duración.
          const previa = c.tipo === CIRUGIA_TIPO_PREVIA;
          return (
            <div key={c.id} className="rounded-lg border border-violet-100 bg-card overflow-hidden">
              <div className="px-4 py-3 flex items-start justify-between gap-3 border-b border-violet-100 bg-violet-50/40">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase', CIRUGIA_PILL_CLASS[est] ?? '')}>
                      <Activity className="w-2.5 h-2.5" strokeWidth={3} /> {previa ? (c.estado === 'CANCELADO' ? 'Cirugía previa anulada' : 'Cirugía previa (fuera de MediFlow)') : <>Cx · {CIRUGIA_ESTADO_LABEL[est] ?? c.estado}</>}
                    </span>
                    {c.tipo && !previa && <Badge variant="outline" className="text-[8px] font-bold uppercase bg-card text-cyan-700 border-cyan-200 px-1.5 py-0">{c.tipo}</Badge>}
                    <span className="text-[10px] font-bold text-muted-foreground tabular-nums">{formatDateTime(c.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-tight text-foreground min-w-0">
                    <span className="truncate text-muted-foreground">{formatBedName(c.camaOrigen)}</span>
                    {cambio && (<><ArrowRightLeft className="w-3 h-3 text-violet-400 shrink-0" /><span className="truncate text-violet-700">{formatBedName(c.camaDestino!)}</span></>)}
                  </div>
                </div>
              </div>
              <div className="px-4 py-2.5 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-muted-foreground" /> Inicio {formatDateTime(c.createdAt)}</span>
                {cerrada && c.fechaCierre && <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Cierre {formatDateTime(c.fechaCierre)}</span>}
                {cerrada && c.fechaCierre && !previa && <span className="font-bold text-violet-700">Duración {dur(c.createdAt, c.fechaCierre)}</span>}
                {c.motivoCancelacion && <span className="text-red-600 italic">Cancelada: {c.motivoCancelacion}</span>}
              </div>
              {(() => {
                const evs = eventsByCx.get(String(c.id)) ?? [];
                if (evs.length === 0) return null;
                return (
                  <div className="px-4 pb-3 pt-2.5 border-t border-violet-50">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Pasos</p>
                    <div className="pl-0.5">
                      {evs.map((e, i) => {
                        const d = i > 0 ? dur(evs[i - 1].at, e.at) : null;
                        const last = i === evs.length - 1;
                        const quien = e.operador || e.usuario;
                        return (
                          <div key={i} className="flex gap-2.5">
                            <div className="flex flex-col items-center">
                              <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', esRetroceso(e) ? 'bg-amber-500' : 'bg-violet-500')} />
                              {!last && <div className="w-px flex-1 bg-violet-100 my-0.5" />}
                            </div>
                            <div className={cn('min-w-0', last ? 'pb-0.5' : 'pb-3')}>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={cn('text-[11px] font-bold uppercase tracking-tight', esRetroceso(e) ? 'text-amber-700' : 'text-foreground')}>{cirugiaEventoLabel(e)}</span>
                                {d && <span className="text-[9px] font-bold text-violet-600" title="Tiempo desde el paso anterior">+{d}</span>}
                              </div>
                              <p className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-0.5 flex-wrap">
                                <Clock className="w-2.5 h-2.5 text-muted-foreground" />{formatDateTime(e.at)}
                                {quien && (<><span className="text-muted-foreground/60">·</span><User className="w-2.5 h-2.5 text-muted-foreground" />{quien}</>)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export const PatientJourney: React.FC<PatientJourneyProps> = ({
  patientTickets, isOpen, onClose, workflowLabels, ubicacionProgal,
}) => {
  const [eventsByTicket, setEventsByTicket] = useState<Map<string, TicketEvent[]>>(new Map());
  const [loading, setLoading] = useState(false);
  // Solapa del journey: traslados (default) o cirugías del paciente.
  const [journeyTab, setJourneyTab] = useState<'traslados' | 'cirugias'>('traslados');
  useEffect(() => { if (isOpen) setJourneyTab('traslados'); }, [isOpen]);

  // Episodios ordenados cronológicamente (más antiguo primero) — así se lee como historia.
  const episodes = useMemo(
    () => [...patientTickets].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [patientTickets],
  );

  const patient = episodes[0];

  useEffect(() => {
    if (!isOpen || episodes.length === 0) { setEventsByTicket(new Map()); return; }
    let cancelled = false;
    setLoading(true);
    const token = localStorage.getItem('mediflow_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const BATCH = 10;
    (async () => {
      const acc = new Map<string, TicketEvent[]>();
      for (let i = 0; i < episodes.length; i += BATCH) {
        const batch = episodes.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(t =>
          fetch(`/api/ticket-events?ticketId=${encodeURIComponent(t.id)}`, { headers })
            .then(r => r.ok ? r.json() : { events: [] })
            .then((d: { events?: TicketEvent[] }) => [t.id, d.events ?? []] as const)
            .catch(() => [t.id, [] as TicketEvent[]] as const),
        ));
        for (const [tid, evts] of results) acc.set(tid, evts);
      }
      if (!cancelled) { setEventsByTicket(acc); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [isOpen, episodes]);

  // ── Resumen del paciente ────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const code = episodes.find(t => t.patientCode)?.patientCode;
    const financier = episodes.find(t => t.financier)?.financier;
    const completed = episodes.filter(t => t.status === TicketStatus.COMPLETED).length;
    const cancelled = episodes.filter(t => t.status === TicketStatus.REJECTED).length;
    const active = episodes.filter(isActive).length;
    const firstDate = episodes[0]?.createdAt;
    const lastDate = episodes.reduce((acc, t) => {
      const e = episodeEnd(t);
      return e > acc ? e : acc;
    }, episodes[0] ? episodeEnd(episodes[0]) : '');

    // Ubicación actual: episodio más reciente por inicio.
    const latest = [...episodes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    let currentLocation = '';
    let currentTone: 'live' | 'done' | 'unknown' = 'unknown';
    if (latest) {
      if (isActive(latest)) {
        currentLocation = latest.destination || latest.origin;
        currentTone = 'live';
      } else if (latest.status === TicketStatus.COMPLETED) {
        currentLocation = latest.destination || latest.origin;
        currentTone = 'done';
      } else {
        // Cancelado: la última ubicación conocida es el destino consolidado previo, si lo hay.
        const lastDone = [...episodes].reverse().find(t => t.status === TicketStatus.COMPLETED);
        currentLocation = lastDone?.destination || latest.origin;
        currentTone = lastDone ? 'done' : 'unknown';
      }
    }
    // Sin traslado en curso manda el mapa de PROGAL: la cama de hoy, o "No internado" (con el último destino
    // de MediFlow como referencia). Si el mapa no está cargado, se rotula "Último destino" (no "actual").
    let locationLabel = active > 0 ? 'En curso' : 'Ubicación actual';
    let locationHint = '';
    if (active === 0) {
      if (typeof ubicacionProgal === 'string' && ubicacionProgal) {
        currentLocation = ubicacionProgal;
        currentTone = 'done';
      } else if (ubicacionProgal === null) {
        locationHint = currentLocation ? `Última cama en MediFlow: ${formatBedName(currentLocation)}` : '';
        currentLocation = '';
        currentTone = 'unknown';
      } else {
        locationLabel = 'Último destino';
      }
    }
    return { code, financier, completed, cancelled, active, firstDate, lastDate, currentLocation, currentTone, locationLabel, locationHint };
  }, [episodes, ubicacionProgal]);

  if (!patient) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      {/* Modal canónico (DESIGN §4.1), panel denso (4xl): header con resumen → cuerpo con scroll → footer. */}
      <DialogContent className="sm:max-w-4xl">

          {/* HEADER */}
          <DialogHeader className="gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0 flex items-center gap-1">
                    <History className="size-3" /> Historia de Traslados
                  </Badge>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sede {patient.sede}</span>
                </div>
                <DialogTitle className="block truncate">
                  {patient.patientName}
                </DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 md:gap-x-4">
                  {summary.code && <span className="flex items-center gap-1"><Hash className="size-3 shrink-0" /> {summary.code}</span>}
                  {summary.financier && <span className="flex items-center gap-1"><User className="size-3 shrink-0" /> {summary.financier}</span>}
                  <span className="flex items-center gap-1">
                    <Calendar className="size-3 shrink-0" />
                    {formatDateReadable(summary.firstDate)} – {formatDateReadable(summary.lastDate)}
                  </span>
                </DialogDescription>

            {/* Stats + ubicación actual */}
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="Traslados" value={String(episodes.length)} tone="neutral" />
              <Stat label="Consolidados" value={String(summary.completed)} tone="emerald" />
              <Stat label="Cancelados" value={String(summary.cancelled)} tone="red" />
              <div className={cn(
                "col-span-2 md:col-span-1 rounded-lg border p-2.5 flex flex-col justify-center",
                summary.currentTone === 'live' ? "bg-blue-50 border-blue-200"
                : summary.currentTone === 'done' ? "bg-emerald-50 border-emerald-200"
                : "bg-card",
              )}>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5 flex items-center gap-1">
                  <MapPin className="size-2.5" />
                  {summary.locationLabel}
                </span>
                <span className={cn(
                  "text-xs font-bold uppercase tracking-tight leading-tight wrap-break-word",
                  summary.currentTone === 'live' ? "text-blue-800"
                  : summary.currentTone === 'done' ? "text-emerald-700" : "text-muted-foreground",
                )}>
                  {summary.currentLocation ? formatBedName(summary.currentLocation) : (ubicacionProgal === null && summary.active === 0 ? 'No internado' : '—')}
                </span>
                {summary.locationHint && <span className="text-[10px] font-medium text-muted-foreground mt-0.5">{summary.locationHint}</span>}
              </div>
            </div>
          </DialogHeader>

          {/* SCROLL: trayectoria + timeline */}
          <DialogBody className="overflow-x-hidden space-y-6">

            {/* Solapa: Traslados / Cirugías del paciente */}
            <div className="flex items-center bg-muted rounded-md p-0.5 w-fit">
              {([['traslados', 'Traslados'], ['cirugias', 'Cirugías']] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setJourneyTab(key)}
                  className={cn('px-4 h-8 text-xs font-medium rounded-sm transition-colors',
                    journeyTab === key ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}>
                  {label}
                </button>
              ))}
            </div>

            {journeyTab === 'traslados' && (<>
            {/* CAMINO DE CAMAS */}
            <section>
              <h4 className="text-[10px] uppercase font-bold text-primary tracking-wider mb-3 flex items-center gap-2">
                <MapPin className="w-4 h-4 opacity-30" /> Camino de Camas
              </h4>
              <div className="flex flex-wrap items-center gap-1.5">
                <PathStop label={formatBedName(patient.origin)} tone="origin" sub="Inicio" />
                {episodes.map((t) => (
                  <React.Fragment key={t.id}>
                    <MoveRight className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                    <PathStop
                      label={formatTicketDestination(t)}
                      tone={
                        t.status === TicketStatus.REJECTED ? 'cancelled'
                        : isActive(t) ? 'live'
                        : 'done'
                      }
                      sub={formatDateReadable(episodeEnd(t))}
                    />
                  </React.Fragment>
                ))}
              </div>
            </section>

            {/* TIMELINE DE EPISODIOS */}
            <section>
              <h4 className="text-[10px] uppercase font-bold text-primary tracking-wider mb-4 flex items-center gap-2">
                <Activity className="w-4 h-4 opacity-30" /> Línea de Tiempo
              </h4>
              <div className="space-y-4">
                {episodes.map((t) => (
                  <EpisodeCard
                    key={t.id}
                    ticket={t}
                    events={eventsByTicket.get(t.id) ?? []}
                    loading={loading}
                    workflowLabels={workflowLabels}
                  />
                ))}
              </div>
            </section>
            </>)}

            {journeyTab === 'cirugias' && <CirugiaJourney patientCode={summary.code} isOpen={isOpen} />}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cerrar
            </Button>
          </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ── Subcomponentes ────────────────────────────────────────────────────────────

const Stat: React.FC<{ label: string; value: string; tone: 'neutral' | 'emerald' | 'red' }> = ({ label, value, tone }) => (
  <div className={cn(
    "rounded-lg border p-2.5",
    tone === 'emerald' ? "bg-emerald-50/60 border-emerald-100"
    : tone === 'red' ? "bg-red-50/50 border-red-100"
    : "bg-muted/50 border-border",
  )}>
    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-0.5">{label}</span>
    <span className={cn(
      "text-2xl font-bold tabular-nums leading-none",
      tone === 'emerald' ? "text-emerald-700" : tone === 'red' ? "text-red-600" : "text-foreground",
    )}>{value}</span>
  </div>
);

const PathStop: React.FC<{ label: string; sub: string; tone: 'origin' | 'done' | 'live' | 'cancelled' }> = ({ label, sub, tone }) => (
  <div className={cn(
    "rounded-lg border px-2.5 py-1.5 min-w-0",
    tone === 'origin' ? "bg-muted border-border"
    : tone === 'live' ? "bg-blue-50 border-blue-200"
    : tone === 'cancelled' ? "bg-red-50 border-red-100"
    : "bg-emerald-50 border-emerald-100",
  )}>
    <span className={cn(
      "block text-[11px] font-bold uppercase tracking-tight leading-tight",
      tone === 'origin' ? "text-foreground"
      : tone === 'live' ? "text-blue-800"
      : tone === 'cancelled' ? "text-red-500 line-through"
      : "text-emerald-800",
    )}>{label}</span>
    <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground tabular-nums">{sub}</span>
  </div>
);

const EpisodeCard: React.FC<{
  ticket: Ticket;
  events: TicketEvent[];
  loading: boolean;
  workflowLabels: Record<WorkflowType, string>;
}> = ({ ticket, events, loading, workflowLabels }) => {
  const isRejected = ticket.status === TicketStatus.REJECTED;
  const active = isActive(ticket);
  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime()),
    [events],
  );

  return (
    <div className={cn(
      "rounded-lg border bg-card overflow-hidden",
      isRejected ? "border-red-100" : active ? "border-blue-200" : "border-border",
    )}>
      {/* Cabecera del episodio */}
      <div className={cn(
        "px-4 py-3 flex items-start justify-between gap-3 border-b",
        isRejected ? "bg-red-50/40 border-red-100" : active ? "bg-blue-50/40 border-blue-100" : "bg-muted/50 border-border",
      )}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {isRejected ? (
              <Badge variant="destructive" className="text-[8px] uppercase font-bold px-1.5 py-0">Cancelado</Badge>
            ) : active ? (
              <Badge className="text-[8px] uppercase font-bold px-1.5 py-0 bg-blue-100 text-blue-700 border-none">{ticket.status}</Badge>
            ) : (
              <StatusBadge tono="exito">Consolidado</StatusBadge>
            )}
            <Badge variant="outline" className="text-[8px] font-bold uppercase tracking-wide bg-card text-muted-foreground border-border px-1.5 py-0">
              {workflowLabels[ticket.workflow]}
            </Badge>
            <span className="text-[10px] font-bold text-muted-foreground tabular-nums">{formatDateTime(ticket.createdAt)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-tight text-foreground min-w-0">
            <span className="truncate text-muted-foreground">{formatBedName(ticket.origin)}</span>
            <ArrowRightLeft className="w-3 h-3 text-muted-foreground/60 shrink-0" />
            <span className={cn("truncate", isRejected ? "text-red-500" : "text-foreground")}>
              {formatTicketDestination(ticket)}
            </span>
          </div>
        </div>
        <span className="text-[9px] font-mono font-bold text-muted-foreground/60 uppercase shrink-0">{ticket.id}</span>
      </div>

      {/* Hitos del episodio */}
      <div className="px-4 py-3">
        {isRejected && ticket.rejectionReason && (
          <div className="mb-3 p-2.5 bg-red-50 rounded-lg border border-red-100">
            <p className="text-[9px] uppercase font-bold text-red-600 tracking-wider mb-1 flex items-center gap-1">
              <XCircle className="w-3 h-3" /> Motivo de Cancelación
            </p>
            <p className="text-xs font-bold text-red-900 leading-snug italic">"{ticket.rejectionReason}"</p>
          </div>
        )}

        {/* Observación con la que Admisión cargó la solicitud (campo del ticket, no un evento). */}
        {(ticket.observations ?? '').trim() && (
          <div className="mb-3 p-3 bg-amber-50/60 rounded-lg border border-amber-100">
            <span className="inline-flex items-center gap-1 mb-1.5 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 text-[9px] font-bold uppercase tracking-wider">
              <MessageSquare className="w-2.5 h-2.5" /> Observación de la solicitud
            </span>
            <p className="text-sm text-foreground leading-snug whitespace-pre-wrap wrap-break-word">{ticket.observations!.trim()}</p>
            <p className="text-[10px] text-muted-foreground font-medium mt-2 flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-muted-foreground">{ticket.createdBy ?? 'Admisión'}</span>
              <span>·</span>
              <span>{formatDateTime(ticket.createdAt)}</span>
            </p>
          </div>
        )}

        {loading ? (
          <p className="text-xs text-muted-foreground py-2">Cargando hitos…</p>
        ) : sortedEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Sin movimientos registrados</p>
        ) : (
          <div className="relative pl-7 space-y-3 before:content-[''] before:absolute before:left-[9px] before:top-1.5 before:bottom-1.5 before:w-px before:bg-border">
            {sortedEvents.map((evt) => {
              const mod = parseModification(evt.tipo);
              const config = eventConfigFor(evt.tipo, evt.operador || evt.usuario);
              const Icon = config.icon;
              const isFinal = evt.tipo === 'Consolidado Progal';
              return (
                <div key={evt.id} className="relative">
                  <div className={cn(
                    "absolute -top-0.5 flex items-center justify-center rounded-full",
                    isFinal ? "left-[-28px] size-5 bg-primary text-primary-foreground"
                    : mod ? "left-[-27px] size-[18px] bg-amber-100 border border-amber-200 text-amber-600"
                    : "left-[-26px] size-4 bg-card border border-border text-muted-foreground",
                  )}>
                    <Icon className="size-2.5" />
                  </div>
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-xs font-semibold", isFinal ? "text-primary" : mod ? "text-amber-700" : "text-foreground")}>
                        {config.label}
                      </p>
                      <p className="text-[10px] text-muted-foreground font-medium">{evt.operador || evt.usuario || config.sublabel}</p>
                      {mod && (
                        <div className="mt-1.5 p-2 bg-amber-50/70 border border-amber-100 rounded-lg space-y-0.5">
                          {mod.changes.map((c, ix) => (
                            <p key={ix} className="text-[11px] text-foreground font-medium leading-snug">
                              <span className="text-amber-600 font-bold">·</span> {c}
                            </p>
                          ))}
                          {mod.motivo && (
                            <p className="text-[10px] text-amber-800 font-semibold italic mt-1 pt-1 border-t border-amber-100/80">
                              Motivo: {mod.motivo}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    <span className={cn("text-[10px] font-medium tabular-nums shrink-0 flex items-center gap-1", isFinal ? "text-emerald-700" : "text-muted-foreground")}>
                      <Clock className="w-2.5 h-2.5" /> {formatTime(evt.fecha)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
