import React, { useState, useEffect, useMemo } from 'react';
import { Ticket, WorkflowType, TicketStatus, CirugiaTraslado, CirugiaEstado } from '../types';
import {
  MapPin, MoveRight, Activity, Calendar, Hash, User, CheckCircle2, XCircle,
  Clock, History,
} from './Icons';
import { ArrowRight, Loader2, MessageSquare } from 'lucide-react';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { StatusBadge, PUNTO_TONO } from './ui/status-badge';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Cargando, Vacio } from './ui/estados';
import { cn, formatBedName, formatTicketDestination } from '../lib/utils';
import { fecha, fechaHora, hora } from '../lib/formato';
import { ESTADOS_TICKET } from '../lib/estados';
import { estadoCirugia } from '../lib/estados-cirugia';
import { eventConfigFor, parseModification } from '../lib/ticketEvents';
import { CIRUGIA_ESTADO_LABEL, CIRUGIA_TIPO_PREVIA } from '../lib/constants';
import { cirugiaEventoLabel, esRetroceso } from '../lib/cirugiaEventos';

// Formato es-AR del kit (lib/formato). date-fns tira con una fecha inválida: un dato roto del histórico
// no puede tumbar el modal entero, así que van con guarda ("—").
const valida = (iso?: string | null): iso is string => !!iso && !Number.isNaN(Date.parse(iso));
const f = (iso?: string | null) => (valida(iso) ? fecha(iso) : '—');
const fh = (iso?: string | null) => (valida(iso) ? fechaHora(iso) : '—');
const h = (iso?: string | null) => (valida(iso) ? hora(iso) : '—');

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

  if (loading) return <Cargando texto="Cargando cirugías…" className="py-10" />;
  if (!patientCode) return <Vacio icono={Activity} titulo="Sin código de paciente" descripcion="Sin código no se pueden buscar sus cirugías." className="py-8" />;
  if (sorted.length === 0) return <Vacio icono={Activity} titulo="Sin cirugías registradas" descripcion="Este paciente no tiene cirugías en MediFlow." className="py-8" />;

  return (
    <section>
      <TituloSeccion icono={Activity}>Cirugías del paciente</TituloSeccion>
      <div className="space-y-3">
        {sorted.map(c => {
          const est = c.estado as CirugiaEstado;
          const cambio = !!c.camaDestino && c.camaDestino !== c.camaOrigen;
          const cerrada = c.estado === 'TOLERANCIA_EVALUADA' || c.estado === 'CANCELADO';
          // Cirugía previa registrada a mano ("Ya se operó (fuera de MediFlow)"): no tiene pasos ni duración.
          const previa = c.tipo === CIRUGIA_TIPO_PREVIA;
          const evs = eventsByCx.get(String(c.id)) ?? [];
          return (
            <div key={c.id} className="overflow-hidden rounded-lg border bg-card shadow-xs">
              {/* Cabecera: estado (tono del mapa de cirugías §3.11) + tipo + fecha, y el recorrido de camas. */}
              <div className="border-b bg-muted/30 px-3 py-2.5">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <StatusBadge tono={estadoCirugia(est).tono}>
                    <Activity className="size-3" aria-hidden="true" />
                    {previa ? (c.estado === 'CANCELADO' ? 'Cirugía previa anulada' : 'Cirugía previa (fuera de MediFlow)') : <>Cx · {CIRUGIA_ESTADO_LABEL[est] ?? c.estado}</>}
                  </StatusBadge>
                  {c.tipo && !previa && <Badge variant="outline" className="px-2 py-0 text-[10px] font-medium">{c.tipo}</Badge>}
                  <span className="text-[10px] text-muted-foreground tabular-nums">{fh(c.createdAt)}</span>
                </div>
                <div className="flex min-w-0 items-center gap-1.5 text-sm">
                  <span className="truncate text-muted-foreground">{formatBedName(c.camaOrigen)}</span>
                  {cambio && (<><ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate font-medium">{formatBedName(c.camaDestino!)}</span></>)}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1 tabular-nums"><Clock className="size-3" aria-hidden="true" /> Inicio {fh(c.createdAt)}</span>
                {cerrada && c.fechaCierre && <span className="flex items-center gap-1 tabular-nums"><CheckCircle2 className="size-3" aria-hidden="true" /> Cierre {fh(c.fechaCierre)}</span>}
                {cerrada && c.fechaCierre && !previa && <span className="font-medium text-foreground tabular-nums">Duración {dur(c.createdAt, c.fechaCierre)}</span>}
                {c.motivoCancelacion && <span className="text-destructive italic">Cancelada: {c.motivoCancelacion}</span>}
              </div>
              {evs.length > 0 && (
                // Pasos de la operatoria: timeline con punto de marca; una corrección (retroceso) va en ámbar.
                <div className="border-t px-3 pt-2.5 pb-3">
                  <p className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Pasos</p>
                  <ol className="ml-1 border-l">
                    {evs.map((e, i) => {
                      const d = i > 0 ? dur(evs[i - 1].at, e.at) : null;
                      const quien = e.operador || e.usuario;
                      return (
                        <li key={i} className="relative pb-3 pl-4 last:pb-0">
                          <span className={cn('absolute top-1.5 -left-[4.5px] size-2 rounded-full ring-2 ring-card', esRetroceso(e) ? 'bg-amber-500' : 'bg-primary')} aria-hidden="true" />
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium">{cirugiaEventoLabel(e)}</span>
                            {esRetroceso(e) && <StatusBadge tono="aviso">Corrección</StatusBadge>}
                            {d && <span className="text-[10px] text-muted-foreground tabular-nums" title="Tiempo desde el paso anterior">+{d}</span>}
                          </div>
                          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                            <Clock className="size-2.5" aria-hidden="true" /><span className="tabular-nums">{fh(e.at)}</span>
                            {quien && (<><span aria-hidden="true">·</span><User className="size-2.5" aria-hidden="true" />{quien}</>)}
                          </p>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
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
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tono="neutro"><History className="size-3" aria-hidden="true" /> Historia de traslados</StatusBadge>
                  <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Sede {patient.sede}</span>
                </div>
                <DialogTitle className="block truncate">
                  {patient.patientName}
                </DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 md:gap-x-4">
                  {summary.code && <span className="flex items-center gap-1"><Hash className="size-3 shrink-0" aria-hidden="true" /> {summary.code}</span>}
                  {summary.financier && <span className="flex items-center gap-1"><User className="size-3 shrink-0" aria-hidden="true" /> {summary.financier}</span>}
                  <span className="flex items-center gap-1 tabular-nums">
                    <Calendar className="size-3 shrink-0" aria-hidden="true" />
                    {f(summary.firstDate)} – {f(summary.lastDate)}
                  </span>
                </DialogDescription>

            {/* Resumen: conteos (no son KPIs, son el resumen del paciente) + ubicación. Superficies neutras;
                el color vive solo en el punto de cada conteo (§1.4). */}
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              <Conteo label="Traslados" valor={episodes.length} punto={PUNTO_TONO.neutro} />
              <Conteo label="Consolidados" valor={summary.completed} punto={PUNTO_TONO.exito} />
              <Conteo label="Cancelados" valor={summary.cancelled} punto={PUNTO_TONO.peligro} />
              <div className="col-span-2 flex flex-col justify-center rounded-lg border bg-card p-2.5 md:col-span-1">
                <span className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  <MapPin className="size-3" aria-hidden="true" />
                  {summary.locationLabel}
                </span>
                <span className="flex items-center gap-1.5 text-sm leading-tight font-semibold wrap-break-word">
                  {summary.currentTone !== 'unknown' && (
                    <span className={cn('size-2 shrink-0 rounded-full', summary.currentTone === 'live' ? PUNTO_TONO.info : PUNTO_TONO.exito)} aria-hidden="true" />
                  )}
                  <span className={cn(summary.currentTone === 'unknown' && 'text-muted-foreground')}>
                    {summary.currentLocation ? formatBedName(summary.currentLocation) : (ubicacionProgal === null && summary.active === 0 ? 'No internado' : '—')}
                  </span>
                </span>
                {summary.locationHint && <span className="mt-0.5 text-[10px] text-muted-foreground">{summary.locationHint}</span>}
              </div>
            </div>
          </DialogHeader>

          {/* SCROLL: trayectoria + timeline */}
          <DialogBody className="space-y-6 overflow-x-hidden">

            {/* Solapa: Traslados / Cirugías del paciente (control segmentado §6.6) */}
            <Tabs value={journeyTab} onValueChange={(v) => setJourneyTab(v as 'traslados' | 'cirugias')}>
              <TabsList className="h-9" aria-label="Traslados o cirugías del paciente">
                <TabsTrigger value="traslados">Traslados</TabsTrigger>
                <TabsTrigger value="cirugias">Cirugías</TabsTrigger>
              </TabsList>
            </Tabs>

            {journeyTab === 'traslados' && (<>
            {/* CAMINO DE CAMAS */}
            <section>
              <TituloSeccion icono={MapPin}>Camino de camas</TituloSeccion>
              <div className="flex flex-wrap items-center gap-1.5">
                <PathStop label={formatBedName(patient.origin)} tone="origin" sub="Inicio" />
                {episodes.map((t) => (
                  <React.Fragment key={t.id}>
                    <MoveRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <PathStop
                      label={formatTicketDestination(t)}
                      tone={
                        t.status === TicketStatus.REJECTED ? 'cancelled'
                        : isActive(t) ? 'live'
                        : 'done'
                      }
                      sub={f(episodeEnd(t))}
                    />
                  </React.Fragment>
                ))}
              </div>
            </section>

            {/* LÍNEA DE TIEMPO: un punto de marca por episodio sobre la línea, y su card al lado. */}
            <section>
              <TituloSeccion icono={Activity}>Línea de tiempo</TituloSeccion>
              <ol className="ml-1.5 space-y-4 border-l">
                {episodes.map((t) => (
                  <li key={t.id} className="relative pl-5">
                    <span className="absolute top-4 -left-[5.5px] size-2.5 rounded-full bg-primary ring-4 ring-background" aria-hidden="true" />
                    <EpisodeCard
                      ticket={t}
                      events={eventsByTicket.get(t.id) ?? []}
                      loading={loading}
                      workflowLabels={workflowLabels}
                    />
                  </li>
                ))}
              </ol>
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

// Título de sección: micro-label del kit (§R.6) con el ícono de marca.
const TituloSeccion: React.FC<{ icono: React.ComponentType<{ className?: string }>; children: React.ReactNode }> = ({ icono: Icono, children }) => (
  <h4 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
    <Icono className="size-3.5 text-brand" aria-hidden="true" /> {children}
  </h4>
);

const Conteo: React.FC<{ label: string; valor: number; punto: string }> = ({ label, valor, punto }) => (
  <div className="rounded-lg border bg-card p-2.5">
    <span className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
      <span className={cn('size-2 shrink-0 rounded-full', punto)} aria-hidden="true" /> {label}
    </span>
    <span className="text-2xl leading-none font-bold tabular-nums">{valor}</span>
  </div>
);

// Parada del camino de camas: chip neutro; el estado del tramo va en el punto (y tachado si se canceló).
const PUNTO_PARADA = { origin: PUNTO_TONO.neutro, done: PUNTO_TONO.exito, live: PUNTO_TONO.info, cancelled: PUNTO_TONO.peligro } as const;
const PathStop: React.FC<{ label: string; sub: string; tone: keyof typeof PUNTO_PARADA }> = ({ label, sub, tone }) => (
  <div className="flex min-w-0 items-start gap-1.5 rounded-md border bg-card px-2.5 py-1.5">
    <span className={cn('mt-1 size-2 shrink-0 rounded-full', PUNTO_PARADA[tone])} aria-hidden="true" />
    <div className="min-w-0">
      <span className={cn('block text-xs leading-tight font-medium', tone === 'cancelled' && 'text-muted-foreground line-through')}>{label}</span>
      <span className="block text-[10px] text-muted-foreground tabular-nums">{sub}</span>
    </div>
  </div>
);

const EpisodeCard: React.FC<{
  ticket: Ticket;
  events: TicketEvent[];
  loading: boolean;
  workflowLabels: Record<WorkflowType, string>;
}> = ({ ticket, events, loading, workflowLabels }) => {
  const isRejected = ticket.status === TicketStatus.REJECTED;
  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime()),
    [events],
  );

  return (
    <div className="rounded-lg border bg-card p-3 shadow-xs">
      {/* Cabecera del episodio: estado (mapa canónico §3.11) + tipo + fecha, y el tramo de camas. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tono={ESTADOS_TICKET[ticket.status].tono}>{ESTADOS_TICKET[ticket.status].label}</StatusBadge>
            <Badge variant="outline" className="px-2 py-0 text-[10px] font-medium">{workflowLabels[ticket.workflow]}</Badge>
            <span className="text-[10px] text-muted-foreground tabular-nums">{fh(ticket.createdAt)}</span>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            <span className="truncate text-muted-foreground">{formatBedName(ticket.origin)}</span>
            <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className={cn('truncate font-medium', isRejected && 'text-muted-foreground line-through')}>
              {formatTicketDestination(ticket)}
            </span>
          </div>
        </div>
        <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground sm:block">{ticket.id}</span>
      </div>

      {/* Motivo de cancelación: banner suave (§9.4). */}
      {isRejected && ticket.rejectionReason && (
        <div className="mt-3 flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
          <XCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span><span className="font-semibold">Motivo de cancelación:</span> <span className="italic">“{ticket.rejectionReason}”</span></span>
        </div>
      )}

      {/* Observación con la que Admisión cargó la solicitud (campo del ticket, no un evento). */}
      {(ticket.observations ?? '').trim() && (
        <div className="mt-3 rounded-md bg-muted/40 p-2.5">
          <StatusBadge tono="aviso"><MessageSquare className="size-3" aria-hidden="true" /> Observación de la solicitud</StatusBadge>
          <p className="mt-1.5 text-sm leading-snug whitespace-pre-wrap wrap-break-word">{ticket.observations!.trim()}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="font-medium text-foreground">{ticket.createdBy ?? 'Admisión'}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{fh(ticket.createdAt)}</span>
          </p>
        </div>
      )}

      {/* Hitos del episodio */}
      <div className="mt-3 border-t pt-3">
        {loading ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Cargando hitos…</p>
        ) : sortedEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin movimientos registrados</p>
        ) : (
          <div className="relative space-y-3 pl-7 before:absolute before:top-1.5 before:bottom-1.5 before:left-[9px] before:w-px before:bg-border before:content-['']">
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
                    : mod ? "left-[-27px] size-[18px] border border-amber-200 bg-amber-100 text-amber-700"
                    : "left-[-26px] size-4 border bg-card text-muted-foreground",
                  )}>
                    <Icon className="size-2.5" aria-hidden="true" />
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold">{config.label}</p>
                      <p className="text-[10px] text-muted-foreground">{evt.operador || evt.usuario || config.sublabel}</p>
                      {mod && (
                        // Detalle de la modificación: banner suave ámbar (§9.4).
                        <div className="mt-1.5 space-y-0.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] leading-snug text-amber-700">
                          {mod.changes.map((c, ix) => (
                            <p key={ix}><span aria-hidden="true">·</span> {c}</p>
                          ))}
                          {mod.motivo && (
                            <p className="mt-1 border-t border-amber-200 pt-1 font-semibold italic">
                              Motivo: {mod.motivo}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
                      <Clock className="size-2.5" aria-hidden="true" /> {h(evt.fecha)}
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
