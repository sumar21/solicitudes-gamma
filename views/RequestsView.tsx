
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Ticket, Role, TicketStatus, SortConfig, SortKey, WorkflowType, User, Bed, BedStatus, Area, IsolationEntry } from '../types';
import { can } from '../lib/permissions';
import {
  Search, Plus, Timer, ArrowRightLeft,
  CheckCircle2, BedDouble, Users, ClipboardCheck, AlertCircle, X, XCircle, Info, MapPin, Pencil, UserCheck
} from '../components/Icons';
import { ArrowRight, CircleDot, ClipboardPlus, Eye, Loader2, ShieldAlert, MessageSquare, Siren, Undo2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Badge } from '../components/ui/badge';
import { DataTable, type Columna } from '../components/ui/data-table';
import { Cargando, Vacio } from '../components/ui/estados';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogTitle, DialogHeader } from '../components/ui/dialog';
import { StatusBadge } from '../components/ui/status-badge';
import { ESTADOS_TICKET, statusLabel } from '../lib/estados';
import { BarraFiltros, BotonFiltros, CampoFiltro } from '../components/ui/filtros';
import { MultiCombobox } from '../components/ui/combobox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { visibleStatusChips, countByStatus, applyStatusFilter, toggleStatus, showUrgenciasChip, applyUrgenciaFilter } from '../lib/ticketFilters';
import { cn, formatBedName, effectiveHostessAreas } from '../lib/utils';
import { fechaHora } from '../lib/formato';
import { realRequisitos } from '../lib/roomCheck';
import { puedeRestablecerDestino, type OrphanTicket } from '../lib/originBed';

interface RequestsViewProps {
  tickets: Ticket[];
  activeRole: Role;
  setActiveRole: (role: Role) => void;
  averageWaitTime: number | string;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  sortConfig: SortConfig;
  onSort: (key: SortKey) => void;
  onNewRequest: () => void;
  onNewPreTicket?: () => void;
  onConfigureDestino?: (id: string) => void;
  onValidateReason: (id: string) => void;
  onAssignBed: (id: string) => void;
  onHousekeepingAction: (id: string, action: 'mark_dirty' | 'mark_clean') => void;
  onStartTransport: (id: string) => void;
  onCompleteTransport: (id: string) => void;
  onRoomReady: (id: string) => void;
  onConfirmReception: (id: string) => void;
  onConsolidate: (id: string) => void;
  /** Urgencia / ingreso directo: abre el modal para VINCULAR un paciente real antes de consolidar. */
  onConsolidateUrgencia?: (id: string) => void;
  onReject?: (id: string) => void;
  onEdit?: (id: string) => void;
  /** "Restablecer destino" de un pre-ticket con la habitación lista marcada por la azafata (ahí "Editar" no está). */
  onResetDestino?: (id: string) => void;
  onAddObservation?: (id: string, texto: string) => Promise<boolean>;
  currentUser: User | null;
  beds: Bed[];
  /** Tickets cuyo paciente ya no está en la cama de origen según PROGAL (lib/originBed.ts → findOrphanTickets). */
  orphanTickets?: Map<string, OrphanTicket>;
  /** Ya llegó al menos una respuesta buena de /api/tickets (distingue "cargando" de "no hay traslados"). */
  ticketsLoaded?: boolean;
  /** El último GET de /api/tickets falló (el hook reintenta solo). */
  ticketsError?: string | null;
}

// Observación cargada por la azafata, ligada al status del ticket (lista 13.ObservacionesTraslados).
interface ObsItem {
  id: string;
  status: string;
  texto: string;
  usuario: string;
  fecha: string;
}

// Botones de acción dentro de una fila de la tabla: más bajos que sm para que tres apilados no estiren la fila.
const BOTON_FILA = 'h-8 gap-1.5 px-3 text-xs';

const ROLE_LABELS: Partial<Record<Role, string>> = {
  [Role.ADMIN]: 'Admin',
  [Role.ADMISSION]: 'Admisión',
  [Role.HOSTESS]: 'Azafata',
};

const WORKFLOW_SHORT: Record<WorkflowType, string> = {
  [WorkflowType.INTERNAL]: 'Int.',
  [WorkflowType.ITR_TO_FLOOR]: 'Sala Esp.',
  [WorkflowType.INGRESO_A_ITR]: 'ITR',
  [WorkflowType.PRE_TICKET]: 'Pre-Ticket',
  [WorkflowType.ROOM_CHANGE]: 'Hab.',
};

const WORKFLOW_LABEL_BADGE: Record<WorkflowType, string> = {
  [WorkflowType.INTERNAL]: 'Interno',
  [WorkflowType.ITR_TO_FLOOR]: 'Sala de Espera',
  [WorkflowType.INGRESO_A_ITR]: 'Ingreso ITR',
  [WorkflowType.PRE_TICKET]: 'Pre-Ticket',
  [WorkflowType.ROOM_CHANGE]: 'Interno',
};

export const RequestsView: React.FC<RequestsViewProps> = ({
  tickets, activeRole, setActiveRole, averageWaitTime,
  searchTerm, setSearchTerm, sortConfig, onSort,
  onNewRequest, onNewPreTicket, onConfigureDestino, onValidateReason, onAssignBed,
  onHousekeepingAction, onStartTransport, onCompleteTransport,
  onRoomReady, onConfirmReception, onConsolidate, onConsolidateUrgencia, onReject, onEdit, onResetDestino, onAddObservation, currentUser, beds, orphanTickets, ticketsLoaded = true, ticketsError = null
}) => {

  // Filtro por estado (botonera). Vacío = se ve todo. Es de la sesión de pantalla: NO se persiste a
  // propósito — un filtro viejo escondiendo traslados al día siguiente parecería que "no hay nada".
  const [statusFilter, setStatusFilter] = useState<Set<TicketStatus>>(new Set());
  const [onlyUrgencias, setOnlyUrgencias] = useState(false);
  // Barra de filtros (§4.7): abierta de entrada desde tablet (los conteos por estado se ven sin un clic);
  // en el celular arranca cerrada para no empujar la grilla.
  const [verFiltros, setVerFiltros] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768);

  // Observaciones por traslado: UN solo modal (hilo + redactor). Todos los roles ven el
  // historial y pueden cargar una nota nueva en el mismo lugar. La nota queda ligada al
  // status actual del ticket → se audita luego en el Historial (ahí es solo-lectura).
  const [obsTicket, setObsTicket]   = useState<Ticket | null>(null);
  const [obsList, setObsList]       = useState<ObsItem[]>([]);
  const [obsLoading, setObsLoading] = useState(false);
  const [obsText, setObsText]       = useState('');
  const [obsSaving, setObsSaving]   = useState(false);
  const [obsError, setObsError]     = useState('');
  // Cantidad de observaciones por traslado → circulito rojo en el botón "Observaciones" (pedido de Julián,
  // 07/10/2026: que se vea de un vistazo qué traslados tienen algo cargado). Una sola llamada por lote.
  const [obsCounts, setObsCounts]   = useState<Record<string, number>>({});
  const obsThreadRef = useRef<HTMLDivElement>(null);

  const openObs  = (ticket: Ticket) => { setObsTicket(ticket); setObsText(''); setObsError(''); };
  const closeObs = () => { if (!obsSaving) { setObsTicket(null); setObsList([]); setObsText(''); setObsError(''); } };

  // Pestaña por defecto: activeRole arranca del rol guardado en la sesión, que para roles custom
  // (p. ej. "sumar.ai" → READ_ONLY) no es ninguna pestaña → no se veía ninguna marcada y tampoco
  // las acciones de Admisión/Admin. Si el rol actual no es una pestaña visible, elegimos la primera.
  useEffect(() => {
    if (!can(currentUser, 'crear_ticket')) return;
    const tabs = can(currentUser, 'abm_usuarios') ? [Role.ADMIN, Role.ADMISSION, Role.HOSTESS] : [Role.ADMISSION, Role.HOSTESS];
    if (!tabs.includes(activeRole)) setActiveRole(tabs[0]);
  }, [currentUser, activeRole, setActiveRole]);

  // Trae el hilo al abrir el modal.
  useEffect(() => {
    if (!obsTicket) { setObsList([]); return; }
    setObsLoading(true);
    const token = localStorage.getItem('mediflow_token');
    const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    fetch(`/api/ticket-observations?ticketId=${encodeURIComponent(obsTicket.id)}`, { headers })
      .then(r => (r.ok ? r.json() : { observations: [] }))
      .then(data => setObsList(data.observations ?? []))
      .catch(() => setObsList([]))
      .finally(() => setObsLoading(false));
  }, [obsTicket]);

  // Ids de los traslados activos (los únicos con botón "Observaciones"). Ordenados → la clave solo cambia
  // cuando entra o sale un traslado, no en cada refetch de la grilla.
  const activeIdsKey = useMemo(() => tickets
    .filter(t => t.status !== TicketStatus.COMPLETED && t.status !== TicketStatus.REJECTED)
    .map(t => t.id).sort().join(','), [tickets]);
  // Depende de un BOOLEANO, no de la función: handleAddObservation se recrea en cada render del hook y
  // como dependencia re-dispararía la consulta en cada refresco de la grilla.
  const obsEnabled = !!onAddObservation;
  useEffect(() => {
    if (!activeIdsKey || !obsEnabled) { setObsCounts({}); return; }
    let cancelled = false;
    const load = () => {
      const token = localStorage.getItem('mediflow_token');
      fetch(`/api/ticket-observations?countsFor=${encodeURIComponent(activeIdsKey)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        .then(r => (r.ok ? r.json() : null))
        .then(data => { if (!cancelled && data?.counts) setObsCounts(data.counts); })
        .catch(() => { /* fail-soft: sin indicador, el botón sigue funcionando */ });
    };
    load();
    // Las observaciones de OTROS usuarios no tocan la fila del traslado (no llega Realtime): refresco cada minuto.
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeIdsKey, obsEnabled]);

  // Mantiene el scroll del hilo al final (lo más nuevo, pegado al redactor).
  useEffect(() => {
    const el = obsThreadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [obsList, obsLoading]);

  const submitObs = async () => {
    if (!obsTicket || !onAddObservation) return;
    const text = obsText.trim();
    if (!text) { setObsError('Escribí una observación.'); return; }
    setObsSaving(true); setObsError('');
    const ok = await onAddObservation(obsTicket.id, text);
    setObsSaving(false);
    if (ok) {
      // Append optimista: la nota aparece al instante en el hilo y NO cerramos el modal.
      // Al reabrir se refresca con la versión canónica (id/fecha del server).
      const optimistic: ObsItem = {
        id:      `local-${Date.now()}`,
        status:  obsTicket.status,
        texto:   text,
        usuario: currentUser?.name ?? '',
        fecha:   new Date().toISOString(),
      };
      setObsList(prev => [...prev, optimistic]);
      setObsCounts(prev => ({ ...prev, [obsTicket.id]: (prev[obsTicket.id] ?? 0) + 1 }));
      setObsText('');
    } else {
      setObsError('No se pudo guardar. Reintentá.');
    }
  };

  // Acción secundaria de una fila (DESIGN §7.6): en desktop, botón-ícono `ghost` con tooltip y color semántico;
  // en mobile, botón a lo ancho con texto (es la card entera).
  const accionSecundaria = (
    icono: React.ReactNode, label: string, onClick: () => void, isMobile: boolean,
    { peligro = false, extra }: { peligro?: boolean; extra?: React.ReactNode } = {},
  ) => isMobile ? (
    <Button type="button" variant="outline" className={cn('relative w-full', peligro && 'text-destructive hover:bg-destructive/10 hover:text-destructive')} onClick={onClick}>
      {icono} {label}{extra}
    </Button>
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          className={cn('relative text-muted-foreground', peligro ? 'hover:bg-destructive/10 hover:text-destructive' : 'hover:text-foreground')}
        >
          {icono}{extra}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  // Botón "Observaciones" — único para todos los roles. Abre el modal con el hilo + redactor.
  // Disponible en tickets activos (no consolidados ni cancelados); en cerrados se consulta
  // desde Historial → Auditar (solo-lectura).
  const renderObsButton = (ticket: Ticket, isMobile = false) => {
    const active = ticket.status !== TicketStatus.COMPLETED && ticket.status !== TicketStatus.REJECTED;
    if (!active || !onAddObservation) return null;
    const n = obsCounts[ticket.id] ?? 0;
    const contador = n > 0 ? (
      <span
        aria-hidden="true"
        className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-bold text-destructive-foreground tabular-nums ring-2 ring-card"
      >
        {n > 9 ? '9+' : n}
      </span>
    ) : null;
    const label = n > 0 ? `Observaciones (${n})` : 'Observaciones';
    return accionSecundaria(<MessageSquare className="size-4" />, label, () => openObs(ticket), isMobile, { extra: contador });
  };

  // "Solicitar limpieza OK": un traslado "Esperando Habitación" con requisitos de cama o habitación
  // compartida (la otra cama ocupada) NO sale directo: la azafata tiene que revisar que esté todo armado
  // antes de marcarla lista. Este recuadro le dice por qué y qué mirar. Ver lib/roomCheck.ts.
  // Compacto a propósito: una línea en "Tarea" + la etiqueta "Compartida" bajo la cama destino. Los requisitos
  // NO se repiten acá: ya están en Observaciones ("Requisitos: …"). Un recuadro en la columna Tarea (angosta)
  // quedaba altísimo y duplicaba esa info.
  const needsRoomCheck = (ticket: Ticket) =>
    ticket.status === TicketStatus.WAITING_ROOM && (!!ticket.habCompartida || realRequisitos(ticket.requisitosCama).length > 0);
  const renderSharedRoomTag = (ticket: Ticket) => (ticket.status === TicketStatus.WAITING_ROOM && ticket.habCompartida) ? (
    <span title="La otra cama de la habitación está ocupada: la cama libre puede no estar armada">
      <StatusBadge tono="info"><Users className="size-3" aria-hidden="true" /> Compartida</StatusBadge>
    </span>
  ) : null;

  // Ticket huérfano: todavía no salió de la cama de origen, pero PROGAL ya tiene a OTRO paciente ahí (se
  // fue sin pasar por MediFlow). Hay que cancelarlo: si no, traba cargar el ticket del nuevo ocupante
  // (caso real 14/10/2026). Los modales de alta remiten a esta marca. Ver lib/originBed.ts.
  // Dónde está hoy el paciente: si sigue en el mismo sector que el origen (p. ej. de ITR Cama 03 a ITR
  // Cama 05) basta "Cama 05"; si no, el nombre corto de la cama.
  const shortNowAt = (origin: string, nowAt: string) => {
    const sector = (label: string) => label.split(' - ')[0];
    return sector(origin) === sector(nowAt) && nowAt.includes(' - ') ? nowAt.split(' - ').slice(1).join(' - ') : formatBedName(nowAt);
  };
  // En mobile (sin hover) se muestra también quién ocupa la cama; en desktop va en el tooltip, para no
  // estirar la fila a 1280.
  const renderOrphanTag = (ticket: Ticket, mobile = false) => {
    const orphan = orphanTickets?.get(ticket.id);
    if (!orphan) return null;
    const enLaCama = orphan.occupantName ? ` En la cama hoy: ${orphan.occupantName}.` : '';
    return (
      // Bloque que se ACOMODA al ancho de la columna (sin nowrap ni max-w): una píldora de una línea
      // ensanchaba Origen ~55px y a 1280 con sidebar tapaba Observaciones. El min-w evita que en una
      // columna angosta ("517 - 01") quede una palabra por línea.
      <div
        className="recuadro mt-1.5 min-w-[96px] border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] leading-tight text-destructive wrap-break-word"
        title={orphan.patientNowAt
          ? `El paciente hoy está en ${formatBedName(orphan.patientNowAt)}: el ticket quedó apuntando a la cama anterior y traba cargar el del paciente nuevo. Hay que cancelarlo y volver a cargarlo desde la cama nueva.${enLaCama}`
          : `El paciente ya no figura ${orphan.patientNotInMap ? 'en ninguna cama del mapa' : 'en esta cama'}. Si se fue sin pasar por MediFlow, hay que cancelar este ticket: traba cargar el del paciente nuevo.${enLaCama}`}
      >
        <div className="micro flex items-start gap-1">
          <AlertCircle className="size-3 shrink-0" aria-hidden="true" /> <span>Ya no está en la cama</span>
        </div>
        {orphan.patientNowAt && <div className="mt-0.5 font-medium">Ahora en {shortNowAt(ticket.origin, orphan.patientNowAt)}</div>}
        {orphan.patientNotInMap && <div className="mt-0.5 font-medium">No figura en el mapa</div>}
        {mobile && orphan.occupantName && <div className="mt-0.5">En la cama: {orphan.occupantName}</div>}
      </div>
    );
  };

  // Urgencia / ingreso directo: tag rojo + aviso mientras el paciente es sólo un nombre libre, sin vincular
  // a un paciente real de PROGAL (se vincula al consolidar). Ver ConsolidarUrgenciaModal.
  const renderUrgenciaTags = (ticket: Ticket) => {
    if (!ticket.urgencia) return null;
    return (
      <>
        {/* Lleno (no al 10 %): es lo único de la fila que tiene que saltar a la vista. */}
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive px-2 py-0.5 text-[11px] leading-4 font-semibold tracking-wide text-destructive-foreground uppercase"
          title="Ingreso por urgencia / ingreso directo"
        >
          <Siren className="size-3" aria-hidden="true" /> Urgencia
        </span>
        {!ticket.patientCode && (
          <span title="Todavía no está vinculado a un paciente de PROGAL: se vincula al consolidar">
            <StatusBadge tono="aviso">Sin vincular</StatusBadge>
          </span>
        )}
      </>
    );
  };

  // Aislamientos (PROGAL): alerta clínica, en tono aviso con el escudo.
  const renderAislamientos = (ticket: Ticket) =>
    getTicketIsolationTypes(ticket).map((iso: IsolationEntry, i: number) => (
      <span key={`${iso.name}-${i}`} title={`Aislamiento: ${iso.name}${iso.observation ? ` — ${iso.observation}` : ''}`}>
        <StatusBadge tono="aviso"><ShieldAlert className="size-3" aria-hidden="true" /> {iso.name}</StatusBadge>
      </span>
    ));

  // Aislamientos del paciente del ticket, leídos del enrich de la cama (PROGAL).
  // Se busca por la cama de origen y, si no, por patientCode en cualquier cama.
  const getTicketIsolationTypes = (ticket: Ticket): IsolationEntry[] => {
    const originBed = beds.find(b => b.label === ticket.origin);
    if (originBed?.isolations?.length) return originBed.isolations;
    if (ticket.patientCode) {
      const byCode = beds.find(b => b.patientCode === ticket.patientCode && b.isolations?.length);
      if (byCode?.isolations?.length) return byCode.isolations;
    }
    return [];
  };

  // Pre-tickets (Presolicitud): solo los ven Admisión (completar_pre_ticket) y la Coordinadora
  // (crear_pre_ticket). El resto no los ve hasta que se convierten en traslado vivo.
  const canSeePreTickets = can(currentUser, 'completar_pre_ticket') || can(currentUser, 'crear_pre_ticket');
  // Quien puede CREAR (pre-)tickets no se recorta por estado aunque filtre por pisos (ver el filtro de abajo):
  // eso incluye a Coordinación, que carga las urgencias —nacen "Por Consolidar"— y tiene que verlas.
  const canCreateTickets = can(currentUser, 'crear_pre_ticket') || can(currentUser, 'crear_ticket');
  // Pestaña "Azafata" de Admin/Admisión (quien tiene pestañas = crear_ticket): la grilla se ve COMO LA VE UNA
  // AZAFATA — solo estados operativos (sin Presolicitud, sin Por Consolidar, sin urgencias). Antes la pestaña
  // solo cambiaba los botones y se veían pre-tickets con "Configurar destino" en modo azafata. Coordinación no
  // tiene pestañas (no tiene crear_ticket), así que esto no le toca.
  const actingAsHostess = can(currentUser, 'crear_ticket') && activeRole === Role.HOSTESS;

  // Lo que ESTE usuario puede ver (rol, pisos, búsqueda) ANTES del filtro por estado y del orden. De acá
  // salen los contadores de la botonera: así "Por Consolidar (3)" siempre dice cuántos hay, aunque haya
  // otro estado filtrado.
  const scopedTickets = useMemo(() => {
    // Azafatas (filterByFloors) ven los cancelados recientes (< 1h) para no creer que un traslado
    // "se borró" cuando admisión lo cargó y canceló. El resto de los roles NO los ve.
    const CANCEL_WINDOW_MS = 60 * 60 * 1000;
    const isRecentCancelado = (t: Ticket) =>
      t.status === TicketStatus.REJECTED && !!t.completedAt && (Date.now() - Date.parse(t.completedAt) < CANCEL_WINDOW_MS);

    let filtered = tickets.filter(t => {
      if (t.status === TicketStatus.COMPLETED) return false;
      if (t.status === TicketStatus.REJECTED) return !!currentUser?.filterByFloors && isRecentCancelado(t);
      return true;
    });

    filtered = filtered.filter(t => t.status !== TicketStatus.PRESOLICITUD || canSeePreTickets);

    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(t =>
        t.id.toLowerCase().includes(searchLower) ||
        t.patientName.toLowerCase().includes(searchLower)
      );
    } else {
      // Si el user no filtra por pisos (Admin/Admision/Direccion/etc.), ve todos
      // los tickets activos sin importar el tab activo (el tab solo gobierna
      // qué botones de acción aparecen para "actuar como" otro rol).
      // El recorte por SECTORES ya viene hecho del hook (scopeTickets → lib/ticketFilters.ts
      // makeAreaScope, que falla abierto si el mapa de camas no permite ubicar el ticket). Acá NO se
      // vuelve a filtrar por área: el filtro duplicado de esta grilla no tenía la excepción "lo que creó
      // no lo pierde" y con un mapa parcial de Gamma escondía todo (14/10/2026, grilla vacía).
      // Quien puede CREAR (pre-)tickets (Coordinación, y cualquier rol al que el ABM le dé
      // crear_ticket/crear_pre_ticket) NO se recorta por estado: ve todos los activos de sus pisos,
      // incluidos los Presolicitud y los que ya se convirtieron. El recorte por estado es para las
      // azafatas, que solo actúan sobre traslados operativos.
      filtered = filtered.filter(t => {
        if (!currentUser?.filterByFloors) return true;
        if (!canCreateTickets) {
          const validStatus = t.status === TicketStatus.WAITING_ROOM ||
            t.status === TicketStatus.IN_TRANSIT ||
            t.status === TicketStatus.IN_TRANSPORT ||
            isRecentCancelado(t); // cancelado reciente también pasa
          if (!validStatus) return false;
        }
        return true;
      });
    }

    if (actingAsHostess) {
      filtered = filtered.filter(t =>
        t.status === TicketStatus.WAITING_ROOM || t.status === TicketStatus.IN_TRANSIT || t.status === TicketStatus.IN_TRANSPORT);
    }
    return filtered;
  }, [tickets, searchTerm, currentUser, canSeePreTickets, canCreateTickets, actingAsHostess]);

  const statusChips = useMemo(
    () => visibleStatusChips({ filterByFloors: !!currentUser?.filterByFloors, canSeePreTickets, canCreateTickets, actingAsHostess }),
    [currentUser?.filterByFloors, canSeePreTickets, canCreateTickets, actingAsHostess],
  );
  const statusCounts = useMemo(() => countByStatus(scopedTickets), [scopedTickets]);
  const urgenciasChip = showUrgenciasChip(statusChips);
  const urgenciasCount = useMemo(() => scopedTickets.filter(t => t.urgencia).length, [scopedTickets]);
  const urgenciaFilterOn = urgenciasChip && onlyUrgencias; // si el rol cambia (pestaña Azafata) el chip desaparece y deja de filtrar

  const sortedTickets = useMemo(() => {
    const sortableItems = applyUrgenciaFilter(applyStatusFilter(scopedTickets, statusFilter), urgenciaFilterOn);
    sortableItems.sort((a, b) => {
      const aVal = a[sortConfig.key] || '';
      const bVal = b[sortConfig.key] || '';
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    // Pin: los pre-tickets (Presolicitud) SIEMPRE arriba de todo, sin importar el sort configurable.
    // Array.sort es estable → conserva el orden previo dentro de cada grupo.
    sortableItems.sort((a, b) => {
      const ap = a.status === TicketStatus.PRESOLICITUD ? 0 : 1;
      const bp = b.status === TicketStatus.PRESOLICITUD ? 0 : 1;
      return ap - bp;
    });
    return sortableItems;
  }, [scopedTickets, statusFilter, urgenciaFilterOn, sortConfig]);

  // Grilla vacía: decir POR QUÉ. Antes "Cargando..." salía siempre que no hubiera tickets (también si
  // simplemente no había traslados) y nunca se distinguía una carga fallida.
  const loadingTickets = !ticketsLoaded && !ticketsError;
  const emptyLabel = !ticketsLoaded
    ? (ticketsError ? 'No se pudieron cargar los traslados' : 'Cargando...')
    : (scopedTickets.length === 0 && !searchTerm ? 'Sin traslados activos' : 'Sin resultados');

  const renderActionButtons = (ticket: Ticket, isMobile = false) => {
    const size = isMobile ? "default" : "sm";
    const btnClass = isMobile ? "w-full" : BOTON_FILA;
    // Desktop: el paso del circuito con texto + lo secundario en íconos, en una fila a la derecha (§7.6).
    const fila = isMobile ? "flex flex-col gap-2" : "flex items-center justify-end gap-1";
    const cancelar = (id: string) => accionSecundaria(<XCircle className="size-4" />, 'Cancelar', () => onReject!(id), isMobile, { peligro: true });

    // ── Pre-ticket (Presolicitud): Admisión configura el destino + (si el rol lo tiene) Cancelar ──
    // No aplican las acciones de azafata/admisión de un traslado normal (todavía no tiene destino).
    // "Cancelar" es un permiso configurable por ABM (cancelar_pre_ticket): quien lo tenga puede
    // sacar de la grilla un pre-ticket cargado por error o que dejó de hacer falta.
    if (ticket.status === TicketStatus.PRESOLICITUD) {
      const canConfig = can(currentUser, 'completar_pre_ticket') && !!onConfigureDestino;
      const canCancelPre = can(currentUser, 'cancelar_pre_ticket') && !!onReject;
      if (!canConfig && !canCancelPre) return null;
      // Columna (no fila): "Configurar destino" + "Cancelar" + "Observaciones" en una sola fila medían ~470px y
      // sacaban la columna de Acciones de la pantalla. Apilados, con el mismo ancho, la columna queda en ~200px.
      // En mobile se conserva el espaciado de siempre (cada botón es un bloque de la card).
      return (
        <div className={fila}>
          {canConfig && (
            <Button type="button" size={size} onClick={() => onConfigureDestino!(ticket.id)} className={btnClass}>
              <MapPin /> Configurar destino
            </Button>
          )}
          {canCancelPre && cancelar(ticket.id)}
        </div>
      );
    }

    // ── Urgencia / ingreso directo (nace "Por Consolidar"): no hay circuito de azafata. Admisión VINCULA al
    // paciente real y consolida; no se edita (editar el destino la recalcularía como traslado normal).
    // Cancelar lo puede quien cancela traslados o quien cancela pre-tickets (Coordinación cargó la urgencia
    // y es quien se da cuenta del error).
    if (ticket.urgencia && ticket.status === TicketStatus.WAITING_CONSOLIDATION) {
      if (can(currentUser, 'crear_ticket') && activeRole === Role.HOSTESS) return null; // admin "actuando como" azafata
      // Urgencia de un paciente INTERNADO: ya viene con el paciente real de su cama → "Consolidar" directo,
      // como un traslado normal. Sólo la de un NO internado abre el modal de vinculación.
      const yaVinculada = !!ticket.patientCode;
      const canLink = can(currentUser, 'consolidar') && (yaVinculada ? !!onConsolidate : !!onConsolidateUrgencia);
      const canCancelUrg = (can(currentUser, 'cancelar_ticket') || can(currentUser, 'cancelar_pre_ticket')) && !!onReject;
      if (!canLink && !canCancelUrg) return null;
      return (
        <div className={fila}>
          {canLink && (
            yaVinculada ? (
              <Button type="button" size={size} className={btnClass} onClick={() => onConsolidate(ticket.id)}>
                <BedDouble /> Consolidar PROGAL
              </Button>
            ) : (
              <Button type="button" size={size} className={btnClass} onClick={() => onConsolidateUrgencia!(ticket.id)}>
                <UserCheck /> Vincular y consolidar
              </Button>
            )
          )}
          {canCancelUrg && cancelar(ticket.id)}
        </div>
      );
    }

    // ── Qué SET de acciones mostrar: por PERMISO, no por la categoría que mapRole saca del nombre ──
    // Los roles multi-tab (Admin/Admisión: tienen crear_ticket → ven el switcher) eligen el set con el
    // tab (activeRole). Un rol SIMPLE (sin switcher) muestra lo que habilitan sus PERMISOS, sin importar
    // cómo lo clasificó el enum: así un rol custom (p. ej. "Mucama UTI/UCO") con iniciar_traslado /
    // confirmar_recepcion ve los botones de azafata aunque mapRole lo haya tipado como HOUSEKEEPING.
    const canSwitchTabs = can(currentUser, 'crear_ticket');
    const hasHostessPerms = can(currentUser, 'confirmar_limpieza') || can(currentUser, 'iniciar_traslado') || can(currentUser, 'confirmar_recepcion');
    const hasAdminActionPerms = can(currentUser, 'consolidar') || can(currentUser, 'editar_ticket') || can(currentUser, 'cancelar_ticket');
    const showHostessActions = activeRole === Role.HOSTESS || (!canSwitchTabs && hasHostessPerms);
    const showAdminActions = activeRole === Role.ADMISSION || activeRole === Role.ADMIN || (!canSwitchTabs && !hasHostessPerms && hasAdminActionPerms);

    // ── Acciones de Azafata (iniciar traslado / recepción / habitación lista) ──────────────────
    // Cada botón está gateado por su permiso fino. El filtro de área se aplica solo si el usuario
    // filtra por pisos; sin él (admin/admisión "actuando como"), no hay restricción de área.
    if (showHostessActions) {
      const filtersFloors = !!currentUser?.filterByFloors;
      if (filtersFloors && !currentUser?.assignedAreas) return null;

      const allAreas = Object.values(Area);
      const hasAllAreas = !filtersFloors || (currentUser?.assignedAreas?.length ?? 0) >= allAreas.length - 1;

      const originBed = beds.find(b => b.label === ticket.origin);
      const destBed = ticket.destination ? beds.find(b => b.label === ticket.destination) : null;

      // Áreas efectivas: la Sala de Espera (HRA), que todas las azafatas tienen en sus
      // pisos, se remapea al piso real del otro extremo. Así, en un traslado HRA→Piso la
      // azafata de destino queda como dueña de origen Y destino (inicia y recibe) y las
      // demás no ven nada; en Piso→Piso cada una conserva su etapa.
      // Si la cama no está en el mapa del dispositivo (mapa parcial de Gamma), el sector guardado en el traslado.
      const originArea = originBed?.area ?? (ticket.originSector as Area | undefined);
      const destArea = destBed?.area ?? (ticket.destinationSector as Area | undefined);
      const { origin: effOriginArea, dest: effDestArea } = effectiveHostessAreas(originArea, destArea);

      // Mismo criterio que makeAreaScope (lib/ticketFilters.ts): solo si NI el mapa NI el sector guardado
      // ubican el traslado, no se recorta (la fila no queda sin botones).
      const unlocated = !originArea && !destArea;
      const isOriginHostess = hasAllAreas || unlocated || !!(effOriginArea && currentUser?.assignedAreas?.includes(effOriginArea));
      const isDestHostess   = hasAllAreas || unlocated || !!(effDestArea   && currentUser?.assignedAreas?.includes(effDestArea));

      if (!isOriginHostess && !isDestHostess) return null;

      // Los 3 workflows (INTERNAL, ITR_TO_FLOOR/Sala de Espera, INGRESO_A_ITR) usan
      // operativa idéntica: azafata de origen inicia el traslado, azafata de destino
      // confirma limpieza y recepción. (Antes ITR_TO_FLOOR era caso especial "todo
      // destino" porque se asumía HRA sin azafata; la operación confirmó que sí hay.)

      // Estado 1: WAITING_ROOM — confirmar limpieza (azafata destino)
      if (ticket.status === TicketStatus.WAITING_ROOM) {
        if (isDestHostess && can(currentUser, 'confirmar_limpieza'))
          return (
            <Button type="button" size={size} className={btnClass} onClick={() => onRoomReady(ticket.id)}>
              <ClipboardCheck /> Habitación lista
            </Button>
          );
        if (isOriginHostess)
          return <span className="text-xs text-muted-foreground">Esperando preparación del destino</span>;
      }

      // Estado 2: IN_TRANSIT — azafata de origen inicia el traslado
      if (ticket.status === TicketStatus.IN_TRANSIT) {
        if (isOriginHostess && can(currentUser, 'iniciar_traslado'))
          return (
            <Button type="button" size={size} className={btnClass} onClick={() => onStartTransport(ticket.id)}>
              <ArrowRightLeft /> Iniciar traslado
            </Button>
          );
        if (isDestHostess)
          return <span className="text-xs text-muted-foreground">Esperando inicio del traslado</span>;
      }

      // Estado 3: IN_TRANSPORT — azafata destino confirma recepción
      if (ticket.status === TicketStatus.IN_TRANSPORT) {
        if (isDestHostess && can(currentUser, 'confirmar_recepcion'))
          return (
            <Button type="button" size={size} className={btnClass} onClick={() => onConfirmReception(ticket.id)}>
              <CheckCircle2 /> Recepción OK
            </Button>
          );
        if (isOriginHostess)
          return <span className="text-xs text-muted-foreground">Traslado en curso…</span>;
      }

      return null;
    }

    // ── Acciones de Admisión/Admin (consolidar / editar / cancelar) ──────────
    // Cada botón gateado por su permiso fino. Igual que la azafata: un rol simple con estos permisos
    // los ve aunque el enum del nombre no sea ADMISSION/ADMIN.
    if (showAdminActions) {
      // notTerminal: el traslado sigue activo (no Consolidado ni Cancelado).
      const notTerminal = ticket.status !== TicketStatus.COMPLETED && ticket.status !== TicketStatus.REJECTED;
      // Editar sigue bloqueado tras intervención de azafata (canCancel === false).
      const canMutate = notTerminal && ticket.canCancel !== false;
      const showConsolidate = ticket.status === TicketStatus.WAITING_CONSOLIDATION && can(currentUser, 'consolidar');
      const showEdit        = canMutate && can(currentUser, 'editar_ticket')   && !!onEdit;
      // Cancelar disponible en cualquier etapa activa (independiente de la intervención).
      const showCancel      = notTerminal && can(currentUser, 'cancelar_ticket') && !!onReject;
      // Pre-ticket con "Habitación lista" ya marcada por la azafata: "Editar" no aparece, pero la cama se puede
      // liberar hasta que arranque el traslado (26/10/2026). Sin intervención, el link vive dentro de "Editar".
      const showReset       = !showEdit && puedeRestablecerDestino(ticket) && can(currentUser, 'completar_pre_ticket') && !!onResetDestino;
      if (!showConsolidate && !showEdit && !showCancel && !showReset) return null;
      // Desktop en columna (no fila): Consolidar + Editar + Cancelar en fila medían ~380px y empujaban la columna
      // de Acciones fuera de pantalla a 1280px.
      return (
        <div className={fila}>
          {showConsolidate && (
            <Button type="button" size={size} className={btnClass} onClick={() => onConsolidate(ticket.id)}>
              <BedDouble /> Consolidar PROGAL
            </Button>
          )}
          {showEdit && accionSecundaria(<Pencil className="size-4" />, 'Editar', () => onEdit!(ticket.id), isMobile)}
          {showReset && accionSecundaria(<Undo2 className="size-4" />, 'Restablecer destino (libera la cama)', () => onResetDestino!(ticket.id), isMobile, { peligro: true })}
          {showCancel && cancelar(ticket.id)}
        </div>
      );
    }

    return null;
  };

  // Texto de ayuda por estado ("qué falta"), el mismo en la tabla y en la tarjeta mobile.
  const ayudaEstado = (ticket: Ticket, corto: boolean) => {
    switch (ticket.status) {
      case TicketStatus.PRESOLICITUD:
        return corto ? 'Falta configurar el destino.' : 'Pre-ticket: falta que Admisión configure el destino.';
      case TicketStatus.WAITING_ROOM:
        return needsRoomCheck(ticket)
          ? <span className="font-medium text-sky-700">Verificar la habitación antes de marcarla lista{!corto && ticket.habCompartida ? ' (habitación compartida)' : ''}.</span>
          : corto ? 'Esperando habitación lista.' : 'Esperando que la habitación de destino esté lista.';
      case TicketStatus.IN_TRANSIT:
        return corto ? 'Esperando inicio de traslado.' : 'Habitación lista. Esperando inicio de traslado.';
      case TicketStatus.IN_TRANSPORT:
        return corto ? 'Esperando confirmación de recepción.' : 'Traslado en curso. Esperando confirmación de recepción.';
      case TicketStatus.WAITING_CONSOLIDATION:
        if (ticket.urgencia && !ticket.patientCode) return corto ? 'Ingresar al paciente en PROGAL y vincularlo.' : 'Urgencia: ingresar al paciente en PROGAL y vincularlo para consolidar.';
        if (ticket.urgencia) return corto ? 'Pendiente consolidar en PROGAL.' : 'Urgencia de un paciente internado: registrar el movimiento en PROGAL y consolidar.';
        return corto ? 'Pendiente consolidar en PROGAL.' : 'Paciente recibido. Pendiente consolidar en sistema.';
      default:
        return null;
    }
  };

  // Observación o motivo de cancelación: banner suave (DESIGN §9.4).
  const observacion = (ticket: Ticket) =>
    ticket.status === TicketStatus.REJECTED && ticket.rejectionReason ? (
      <div className="flex max-w-[260px] items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] leading-tight text-red-700">
        <AlertCircle className="mt-px size-3 shrink-0" aria-hidden="true" />
        <span className="line-clamp-3 italic">{ticket.rejectionReason}</span>
      </div>
    ) : ticket.observations ? (
      <div className="flex max-w-[260px] items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-tight text-amber-700">
        <Info className="mt-px size-3 shrink-0" aria-hidden="true" />
        <span className="wrap-break-word">{ticket.observations}</span>
      </div>
    ) : null;

  // Columnas AGRUPADAS (DESIGN §7.2 "2 líneas" + §5.4 disclosure progresivo): datos que se leen juntos
  // van en una celda, valor arriba y metadato `text-[10px] text-muted-foreground` abajo.
  const columnas: Columna<Ticket>[] = [
    {
      id: 'status',
      titulo: 'Estado',
      ordenar: (t) => t.status,
      clase: 'whitespace-nowrap',
      celda: (t) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge tono={ESTADOS_TICKET[t.status].tono}>{ESTADOS_TICKET[t.status].label}</StatusBadge>
          <span className="text-[10px] text-muted-foreground tabular-nums">{fechaHora(t.createdAt)}</span>
          {/* Sin la columna Tarea (< lg), el "qué falta" va acá. */}
          {ayudaEstado(t, true) && <span className="max-w-[160px] text-[10px] leading-snug whitespace-normal text-muted-foreground lg:hidden">{ayudaEstado(t, true)}</span>}
        </div>
      ),
    },
    {
      id: 'patientName',
      titulo: 'Paciente',
      ordenar: (t) => t.patientName,
      celda: (t) => (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{t.patientName}</span>
            {renderUrgenciaTags(t)}
            {renderAislamientos(t)}
          </div>
          <span className="font-mono text-[10px] text-muted-foreground">{t.id}</span>
        </div>
      ),
    },
    {
      id: 'origin',
      titulo: 'Traslado',
      ordenar: (t) => t.origin,
      celda: (t) => (
        <div className="flex max-w-[260px] flex-col gap-0.5">
          <span className="font-medium leading-tight wrap-break-word">{formatBedName(t.origin)}</span>
          {renderOrphanTag(t)}
          <span className="flex items-start gap-1 leading-tight">
            <ArrowRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t.destination
              ? <span className="font-medium wrap-break-word">{formatBedName(t.destination)}</span>
              : <span className="text-muted-foreground">Destino pendiente</span>}
          </span>
          {(t.targetBedOriginalStatus || t.bedAssignedAt) && (
            <span className="pl-4 text-[10px] text-muted-foreground">
              {t.targetBedOriginalStatus}{t.targetBedOriginalStatus && t.bedAssignedAt ? ' · ' : ''}{t.bedAssignedAt ? `cama ${t.bedAssignedAt}` : ''}
            </span>
          )}
          {renderSharedRoomTag(t) && <span className="pl-4 pt-0.5">{renderSharedRoomTag(t)}</span>}
        </div>
      ),
    },
    {
      id: 'tarea',
      titulo: 'Tarea y observaciones',
      ocultarEn: 'md',
      celda: (t) => (
        <div className="flex max-w-[280px] flex-col items-start gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="px-2 py-0 text-[10px] font-medium">{WORKFLOW_LABEL_BADGE[t.workflow] ?? 'Interno'}</Badge>
            {ayudaEstado(t, true) && <span className="text-xs text-muted-foreground">{ayudaEstado(t, true)}</span>}
          </div>
          {t.changeReason && (
            <span className="flex items-start gap-1 text-[11px] leading-snug font-medium text-amber-700">
              <Info className="mt-px size-3 shrink-0" aria-hidden="true" /> {t.changeReason}
            </span>
          )}
          {observacion(t)}
        </div>
      ),
    },
    {
      id: 'acciones',
      titulo: 'Acciones',
      alinear: 'der',
      celda: (t) => (
        <div className="flex items-center justify-end gap-1">
          {renderActionButtons(t)}
          {renderObsButton(t)}
        </div>
      ),
    },
  ];

  // Card mobile de fila (DESIGN §5.4b): identidad + estado arriba, el traslado, notas y acciones al pie.
  const tarjeta = (ticket: Ticket) => (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{ticket.patientName}</span>
            {renderUrgenciaTags(ticket)}
            {renderAislamientos(ticket)}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">{ticket.id} · {WORKFLOW_SHORT[ticket.workflow]}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge tono={ESTADOS_TICKET[ticket.status].tono}>{ESTADOS_TICKET[ticket.status].label}</StatusBadge>
          <span className="text-[10px] text-muted-foreground tabular-nums">{fechaHora(ticket.createdAt)}</span>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 rounded-md bg-muted/40 p-2.5">
        <div className="min-w-0">
          <p className="mb-0.5 text-[10px] tracking-wider text-muted-foreground uppercase">Origen</p>
          <p className="text-[13px] font-medium leading-tight wrap-break-word">{formatBedName(ticket.origin)}</p>
          {renderOrphanTag(ticket, true)}
        </div>
        <ArrowRight className="mt-4 size-4 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 text-right">
          <p className="mb-0.5 text-[10px] tracking-wider text-muted-foreground uppercase">Destino</p>
          <p className="text-[13px] font-medium leading-tight wrap-break-word">{ticket.destination ? formatBedName(ticket.destination) : 'Pendiente'}</p>
          {ticket.targetBedOriginalStatus && <p className="mt-0.5 text-[10px] text-muted-foreground">{ticket.targetBedOriginalStatus}</p>}
        </div>
      </div>

      {observacion(ticket)}
      {ayudaEstado(ticket, false) && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{ayudaEstado(ticket, false)}</span>
        </p>
      )}

      {(renderActionButtons(ticket, true) || renderObsButton(ticket, true)) && (
        <div className="flex flex-col gap-2 border-t pt-3">
          {renderActionButtons(ticket, true)}
          {renderObsButton(ticket, true)}
        </div>
      )}
    </div>
  );

  const rolesVisibles = Object.entries(ROLE_LABELS).filter(([k]) => {
    // Solo Admin (con todos los permisos) ve el tab Admin. Los demás (Admision) ven Admision + Azafata.
    if (can(currentUser, 'abm_usuarios')) return true;
    return k === Role.ADMISSION || k === Role.HOSTESS;
  });

  const filtrosActivos = statusFilter.size + (urgenciaFilterOn ? 1 : 0);
  const limpiarFiltros = () => { setStatusFilter(new Set()); setOnlyUrgencias(false); };
  const esperaMedia = typeof averageWaitTime === 'number' && averageWaitTime > 0 ? `${averageWaitTime} min` : '—';

  return (
    <div className="flex w-full flex-col gap-4 px-3 pb-3 md:px-8 md:pb-8">
      {/* HEADER + TOOLBAR (DESIGN §4.4 y §5.2) */}
      <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="hidden shrink-0 md:block">
          <h2 className="text-2xl font-bold tracking-tight">Traslados</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{scopedTickets.length}</span> activos · espera media{' '}
            <span className="font-medium text-foreground tabular-nums">{esperaMedia}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <div className="relative min-w-[7rem] flex-1 sm:w-56 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder="Paciente o ID…"
              aria-label="Buscar por paciente o ID"
              className="h-9 pr-8 pl-8 text-sm"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button type="button" onClick={() => setSearchTerm('')} aria-label="Limpiar búsqueda" className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <BotonFiltros abierto={verFiltros} activos={filtrosActivos} onClick={() => setVerFiltros(v => !v)} />
          {can(currentUser, 'crear_pre_ticket') && onNewPreTicket && (
            <Button type="button" variant="outline" onClick={onNewPreTicket} className="h-9 shrink-0 gap-1.5 px-3" aria-label="Nuevo pre-ticket">
              <ClipboardPlus className="size-3.5" /><span className="hidden sm:inline">Pre-ticket</span>
            </Button>
          )}
          {can(currentUser, 'crear_ticket') && (
            <Button type="button" onClick={onNewRequest} className="h-9 shrink-0 gap-1.5 px-3" aria-label="Nueva solicitud">
              <Plus className="size-3.5" /><span className="hidden sm:inline">Solicitud</span>
            </Button>
          )}
        </div>
      </div>

      {/* FILTROS (DESIGN §4.7): barra inline, no un modal. */}
      {verFiltros && (
        <BarraFiltros activos={filtrosActivos} onLimpiar={limpiarFiltros}>
          {/* "Ver como" otro rol (control segmentado, §6.6): cambia qué se ve y qué botones aparecen. Solo
              quien puede crear tickets. */}
          {can(currentUser, 'crear_ticket') && (
            <CampoFiltro icono={Eye} label="Ver como" className="sm:w-auto">
              <div className="flex h-10 w-full items-center rounded-lg bg-muted p-1 sm:w-auto" role="group" aria-label="Ver como">
                {rolesVisibles.map(([k, v]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={activeRole === k}
                    onClick={() => setActiveRole(k as Role)}
                    className={cn(
                      'h-full flex-1 rounded-md px-3 text-sm font-medium transition-all outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:flex-none',
                      activeRole === k ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </CampoFiltro>
          )}
          <CampoFiltro icono={CircleDot} label="Estado" className="sm:w-64">
            <MultiCombobox
              opciones={statusChips.map(st => ({ value: st, label: `${statusLabel(st)} (${statusCounts[st] ?? 0})` }))}
              value={[...statusFilter]}
              onChange={(v) => setStatusFilter(new Set(v as TicketStatus[]))}
              placeholder={`Todos (${scopedTickets.length})`}
              buscar="Buscar estado…"
            />
          </CampoFiltro>
          {urgenciasChip && (
            <CampoFiltro icono={Siren} label="Prioridad">
              <Select value={onlyUrgencias ? 'urgencias' : 'todas'} onValueChange={(v) => setOnlyUrgencias(v === 'urgencias')}>
                <SelectTrigger className="w-full" aria-label="Prioridad"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  <SelectItem value="urgencias">Solo urgencias ({urgenciasCount})</SelectItem>
                </SelectContent>
              </Select>
            </CampoFiltro>
          )}
        </BarraFiltros>
      )}

      {/* La carga de traslados falló: se avisa en vez de mostrar una grilla vacía (o vieja) sin explicación.
          El hook reintenta solo con espera creciente. Ver fetchTickets en useHospitalState. */}
      {ticketsError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold">No pudimos {ticketsLoaded ? 'actualizar' : 'cargar'} los traslados.</span>{' '}
            Reintentamos solos en unos segundos{ticketsLoaded ? '; lo que ves puede estar desactualizado' : ''}.{' '}
            <span className="font-mono text-[10px] opacity-70">({ticketsError})</span>
          </span>
        </div>
      )}

      {/* TABLA (desktop) + CARDS (mobile) sobre el mismo array (§4.4, §7.1) */}
      <DataTable
        filas={sortedTickets}
        columnas={columnas}
        clave={(t) => t.id}
        tarjeta={tarjeta}
        // Todos los activos en una página: es una grilla operativa, no un archivo.
        porPagina={Number.POSITIVE_INFINITY}
        cargando={loadingTickets}
        // El orden vive en el hook (sortConfig) y los pre-tickets van siempre arriba: la tabla no ordena sola.
        orden={{ id: sortConfig.key, dir: sortConfig.direction }}
        onOrden={(id) => onSort(id as SortKey)}
        claseFila={(t) => (t.status === TicketStatus.REJECTED ? 'bg-red-50/40' : undefined)}
        vacio={<Vacio icono={ticketsError && !ticketsLoaded ? AlertCircle : Search} titulo={emptyLabel} />}
      />

      {/* Modal único de Observaciones (§4.1): hilo en el cuerpo, redactor en el pie.
          Mismo lugar para leer y cargar; la nota queda ligada al status actual. */}
      <Dialog open={!!obsTicket} onOpenChange={(open) => { if (!open) closeObs(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              <MessageSquare className="size-5 text-brand" aria-hidden="true" /> Observaciones
              {!obsLoading && obsList.length > 0 && <StatusBadge tono="neutro">{obsList.length}</StatusBadge>}
            </DialogTitle>
            <DialogDescription>
              {obsTicket ? <><span className="font-medium text-foreground">{obsTicket.patientName}</span> · {ESTADOS_TICKET[obsTicket.status].label}</> : null}
            </DialogDescription>
          </DialogHeader>

          {/* HILO — historial cronológico (lo más nuevo abajo, pegado al redactor) */}
          <DialogBody ref={obsThreadRef} className="min-h-[120px] space-y-2">
            {obsLoading ? (
              <Cargando />
            ) : obsList.length === 0 ? (
              <Vacio icono={MessageSquare} titulo="Todavía no hay observaciones" descripcion="Escribí la primera abajo." className="py-8" />
            ) : (
              obsList.map(o => (
                <div key={o.id} className="rounded-lg border bg-card p-3 shadow-xs">
                  <p className="text-sm leading-snug whitespace-pre-wrap wrap-break-word">{o.texto}</p>
                  <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">{o.usuario || 'Usuario'}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{fechaHora(o.fecha)}</span>
                    {o.status && (<><span aria-hidden="true">·</span><span className="italic">{o.status}</span></>)}
                  </p>
                </div>
              ))
            )}
          </DialogBody>

          {/* REDACTOR — disponible mientras el ticket esté activo. La Azafata deja de cargar
              al llegar a "Por Consolidar" (su parte operativa terminó); igual lee el hilo. */}
          {activeRole === Role.HOSTESS && obsTicket?.status === TicketStatus.WAITING_CONSOLIDATION ? (
            <div className="shrink-0 border-t bg-muted/20 p-4 text-center text-xs text-muted-foreground">
              El traslado ya está <span className="font-medium text-foreground">Por Consolidar</span>. La carga de observaciones se cierra para la azafata.
            </div>
          ) : (
            <div className="shrink-0 space-y-2 border-t bg-muted/20 p-4">
              <label htmlFor="obs-texto" className="mb-1 block text-xs font-medium text-muted-foreground">
                Nueva observación{obsTicket && <> · se guarda en <span className="text-foreground">{ESTADOS_TICKET[obsTicket.status].label}</span></>}
              </label>
              <Textarea
                id="obs-texto"
                value={obsText}
                onChange={e => setObsText(e.target.value)}
                maxLength={500}
                rows={3}
                aria-invalid={!!obsError || undefined}
                placeholder="Ej.: familiar ausente, faltan prendas"
                className="min-h-[72px] resize-y bg-background"
              />
              {obsError && <p role="alert" className="text-xs text-destructive">{obsError}</p>}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[11px] text-muted-foreground tabular-nums">{obsText.length}/500</span>
                <Button type="button" onClick={submitObs} disabled={obsSaving || !obsText.trim()} className="w-full sm:w-auto sm:min-w-[140px]">
                  {obsSaving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                  {obsSaving ? 'Guardando…' : 'Agregar'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
