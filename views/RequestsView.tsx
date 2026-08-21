
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Ticket, Role, TicketStatus, SortConfig, SortKey, WorkflowType, User, Bed, BedStatus, Area, IsolationEntry } from '../types';
import { can } from '../lib/permissions';
import {
  Search, Plus, Timer, Clock, ArrowRightLeft,
  ChevronUp, ChevronDown, CheckCircle2, BedDouble, Users, ClipboardCheck, AlertCircle, X, XCircle, Info, MapPin, Pencil
} from '../components/Icons';
import { ShieldAlert, MessageSquare } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Badge } from '../components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table';
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogFooter } from '../components/ui/dialog';
import { StatusBadge } from '../components/StatusBadge';
import { Popover, PopoverTrigger, PopoverContent } from '../components/ui/popover';
import { cn, formatBedName, formatDateTime, effectiveHostessAreas } from '../lib/utils';

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
  onReject?: (id: string) => void;
  onEdit?: (id: string) => void;
  onAddObservation?: (id: string, texto: string) => Promise<boolean>;
  currentUser: User | null;
  beds: Bed[];
}

// Observación cargada por la azafata, ligada al status del ticket (lista 13.ObservacionesTraslados).
interface ObsItem {
  id: string;
  status: string;
  texto: string;
  usuario: string;
  fecha: string;
}

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
  onRoomReady, onConfirmReception, onConsolidate, onReject, onEdit, onAddObservation, currentUser, beds
}) => {

  // Observaciones por traslado: UN solo modal (hilo + redactor). Todos los roles ven el
  // historial y pueden cargar una nota nueva en el mismo lugar. La nota queda ligada al
  // status actual del ticket → se audita luego en el Historial (ahí es solo-lectura).
  const [obsTicket, setObsTicket]   = useState<Ticket | null>(null);
  const [obsList, setObsList]       = useState<ObsItem[]>([]);
  const [obsLoading, setObsLoading] = useState(false);
  const [obsText, setObsText]       = useState('');
  const [obsSaving, setObsSaving]   = useState(false);
  const [obsError, setObsError]     = useState('');
  const obsThreadRef = useRef<HTMLDivElement>(null);

  const openObs  = (ticket: Ticket) => { setObsTicket(ticket); setObsText(''); setObsError(''); };
  const closeObs = () => { if (!obsSaving) { setObsTicket(null); setObsList([]); setObsText(''); setObsError(''); } };

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
      setObsText('');
    } else {
      setObsError('No se pudo guardar. Reintentá.');
    }
  };

  // Botón "Observaciones" — único para todos los roles. Abre el modal con el hilo + redactor.
  // Disponible en tickets activos (no consolidados ni cancelados); en cerrados se consulta
  // desde Historial → Auditar (solo-lectura).
  const renderObsButton = (ticket: Ticket, isMobile = false) => {
    const active = ticket.status !== TicketStatus.COMPLETED && ticket.status !== TicketStatus.REJECTED;
    if (!active || !onAddObservation) return null;
    const size = isMobile ? 'default' : 'sm';
    const btnClass = isMobile
      ? 'w-full h-11 text-xs font-black uppercase tracking-widest rounded-xl'
      : 'h-8 text-[10px] uppercase font-bold tracking-tight';

    return (
      <Button
        size={size}
        variant="outline"
        className={cn(btnClass, 'border-slate-200 text-slate-600 hover:bg-slate-50')}
        onClick={() => openObs(ticket)}
      >
        <MessageSquare className="w-3.5 h-3.5 mr-2" /> Observaciones
      </Button>
    );
  };

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

  const sortedTickets = useMemo(() => {
    let filtered = tickets.filter(t => t.status !== TicketStatus.COMPLETED && t.status !== TicketStatus.REJECTED);

    // Pre-tickets (Presolicitud): solo los ven Admisión (completar_pre_ticket) y la Coordinadora
    // (crear_pre_ticket). El resto no los ve hasta que se convierten en traslado vivo.
    const canSeePreTickets = can(currentUser, 'completar_pre_ticket') || can(currentUser, 'crear_pre_ticket');
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
      // Si filtra por pisos (Azafata, Catering, futuros roles), aplica filtro de área
      // limitado a estados operativos.
      filtered = filtered.filter(t => {
        if (!currentUser?.filterByFloors) return true;
        const validStatus = t.status === TicketStatus.WAITING_ROOM ||
          t.status === TicketStatus.IN_TRANSIT ||
          t.status === TicketStatus.IN_TRANSPORT;
        if (!validStatus) return false;
        if (currentUser.assignedAreas?.length && beds.length > 0) {
          const allAreas = Object.values(Area);
          if (currentUser.assignedAreas.length < allAreas.length - 1) {
            const originArea = beds.find(b => b.label === t.origin)?.area ?? beds.find(b => t.origin?.includes(b.area))?.area;
            const destArea = t.destination ? (beds.find(b => b.label === t.destination)?.area ?? beds.find(b => t.destination?.includes(b.area))?.area) : undefined;
            // Guard explícito en vez de `as string`: `assignedAreas` es `Area[]`, así que el
            // cast solo silenciaba al compilador. Semánticamente es idéntico —`includes(undefined)`
            // sobre un array de Area siempre da false— pero ahora el tipo lo dice en vez de taparlo.
            return (!!originArea && currentUser.assignedAreas.includes(originArea)) ||
                   (!!destArea && currentUser.assignedAreas.includes(destArea));
          }
        }
        return validStatus;
      });
    }

    const sortableItems = [...filtered];
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
  }, [tickets, activeRole, sortConfig, searchTerm, beds, currentUser]);

  const renderActionButtons = (ticket: Ticket, isMobile = false) => {
    const size = isMobile ? "default" : "sm";
    const btnClass = isMobile ? "w-full h-11 text-xs font-black uppercase tracking-widest rounded-xl" : "h-8 text-[10px] uppercase font-bold tracking-tight";

    // ── Pre-ticket (Presolicitud): única acción = Admisión configura el destino ──
    // No aplican las acciones de azafata/admisión de un traslado normal (todavía no tiene destino).
    if (ticket.status === TicketStatus.PRESOLICITUD) {
      if (!can(currentUser, 'completar_pre_ticket') || !onConfigureDestino) return null;
      return (
        <Button size={size} onClick={() => onConfigureDestino(ticket.id)}
          className={cn(btnClass, "bg-emerald-950 hover:bg-emerald-900 text-white rounded-xl px-4")}>
          <MapPin className="w-3.5 h-3.5 mr-1.5" /> Configurar destino
        </Button>
      );
    }

    // ── Acciones de Azafata (tab activeRole=HOSTESS) ──────────────────────────
    // Cada botón está gateado por su permiso fino. El filtro de área se aplica solo
    // si el usuario filtra por pisos; sin él (admin/admision "actuando como"), no hay
    // restricción de área.
    if (activeRole === Role.HOSTESS) {
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
      const { origin: effOriginArea, dest: effDestArea } = effectiveHostessAreas(originBed?.area, destBed?.area);

      const isOriginHostess = hasAllAreas || !!(effOriginArea && currentUser?.assignedAreas?.includes(effOriginArea));
      const isDestHostess   = hasAllAreas || !!(effDestArea   && currentUser?.assignedAreas?.includes(effDestArea));

      if (!isOriginHostess && !isDestHostess) return null;

      // Los 3 workflows (INTERNAL, ITR_TO_FLOOR/Sala de Espera, INGRESO_A_ITR) usan
      // operativa idéntica: azafata de origen inicia el traslado, azafata de destino
      // confirma limpieza y recepción. (Antes ITR_TO_FLOOR era caso especial "todo
      // destino" porque se asumía HRA sin azafata; la operación confirmó que sí hay.)

      // Estado 1: WAITING_ROOM — confirmar limpieza (azafata destino)
      if (ticket.status === TicketStatus.WAITING_ROOM) {
        if (isDestHostess && can(currentUser, 'confirmar_limpieza'))
          return (
            <Button size={size} className={cn(btnClass, "bg-blue-600 hover:bg-blue-700 text-white")} onClick={() => onRoomReady(ticket.id)}>
              <ClipboardCheck className="w-3.5 h-3.5 mr-2" /> Habitación Lista
            </Button>
          );
        if (isOriginHostess)
          return <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50">Esperando preparación destino</Badge>;
      }

      // Estado 2: IN_TRANSIT — azafata de origen inicia el traslado
      if (ticket.status === TicketStatus.IN_TRANSIT) {
        if (isOriginHostess && can(currentUser, 'iniciar_traslado'))
          return (
            <Button size={size} className={cn(btnClass, "bg-emerald-600 hover:bg-emerald-700 text-white")} onClick={() => onStartTransport(ticket.id)}>
              <ArrowRightLeft className="w-3.5 h-3.5 mr-2" /> Iniciar Traslado
            </Button>
          );
        if (isDestHostess)
          return <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50">Esperando inicio de traslado</Badge>;
      }

      // Estado 3: IN_TRANSPORT — azafata destino confirma recepción
      if (ticket.status === TicketStatus.IN_TRANSPORT) {
        if (isDestHostess && can(currentUser, 'confirmar_recepcion'))
          return (
            <Button size={size} className={cn(btnClass, "bg-emerald-600 hover:bg-emerald-700 text-white")} onClick={() => onConfirmReception(ticket.id)}>
              <CheckCircle2 className="w-3.5 h-3.5 mr-2" /> Recepción OK
            </Button>
          );
        if (isOriginHostess)
          return <Badge variant="outline" className="text-slate-500 border-slate-200 bg-slate-50">Traslado en curso...</Badge>;
      }

      return null;
    }

    // ── Acciones de Admisión/Admin (tab activeRole=ADMIN/ADMISSION) ──────────
    // Cada botón gateado por su permiso fino.
    if (activeRole === Role.ADMISSION || activeRole === Role.ADMIN) {
      // notTerminal: el traslado sigue activo (no Consolidado ni Cancelado).
      const notTerminal = ticket.status !== TicketStatus.COMPLETED && ticket.status !== TicketStatus.REJECTED;
      // Editar sigue bloqueado tras intervención de azafata (canCancel === false).
      const canMutate = notTerminal && ticket.canCancel !== false;
      const showConsolidate = ticket.status === TicketStatus.WAITING_CONSOLIDATION && can(currentUser, 'consolidar');
      const showEdit        = canMutate && can(currentUser, 'editar_ticket')   && !!onEdit;
      // Cancelar disponible en cualquier etapa activa (independiente de la intervención).
      const showCancel      = notTerminal && can(currentUser, 'cancelar_ticket') && !!onReject;
      if (!showConsolidate && !showEdit && !showCancel) return null;
      return (
        <div className={cn("flex gap-1.5", isMobile ? "flex-col" : "flex-row")}>
          {showConsolidate && (
            <Button size={size} className={cn(btnClass, "bg-purple-600 hover:bg-purple-700 text-white")} onClick={() => onConsolidate(ticket.id)}>
              <BedDouble className="w-3.5 h-3.5 mr-2" /> Consolidar PROGAL
            </Button>
          )}
          {showEdit && (
            <Button size={size} variant="outline" className={cn(btnClass, "border-amber-200 text-amber-700 hover:bg-amber-50")} onClick={() => onEdit!(ticket.id)}>
              <Pencil className="w-3.5 h-3.5 mr-2" /> Editar
            </Button>
          )}
          {showCancel && (
            <Button size={size} variant="outline" className={cn(btnClass, "border-red-200 text-red-600 hover:bg-red-50")} onClick={() => onReject!(ticket.id)}>
              <XCircle className="w-3.5 h-3.5 mr-2" /> Cancelar
            </Button>
          )}
        </div>
      );
    }

    return null;
  };

  const SortHeader = ({ label, sortKey }: { label: string; sortKey: SortKey }) => {
    const isActive = sortConfig.key === sortKey;
    return (
      <TableHead className="cursor-pointer hover:bg-slate-100 transition-colors group" onClick={() => onSort(sortKey)}>
        <div className="flex items-center gap-1">
          {label}
          <div className="flex flex-col opacity-50 group-hover:opacity-100 transition-opacity">
            <ChevronUp className={cn("w-2.5 h-2.5 -mb-1", isActive && sortConfig.direction === 'asc' ? "text-slate-900" : "text-slate-400")} />
            <ChevronDown className={cn("w-2.5 h-2.5", isActive && sortConfig.direction === 'desc' ? "text-slate-900" : "text-slate-400")} />
          </div>
        </div>
      </TableHead>
    );
  };

  return (
    <div className="p-4 md:p-8 animate-in slide-in-from-right-4 duration-300 max-w-full space-y-4 md:space-y-6">
      <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
          {/* Tab switcher para "actuar como" otro rol. Visible solo si el user puede
              crear tickets (Admin/Admision) — los demás roles no tienen sentido. */}
          {can(currentUser, 'crear_ticket') && (
            <div className="flex items-center gap-2 w-full sm:w-auto bg-white p-1 rounded-xl border border-slate-200 shadow-sm overflow-x-auto no-scrollbar">
              {Object.entries(ROLE_LABELS)
                .filter(([k]) => {
                  // Solo Admin (con todos los permisos) ve el tab Admin. Los demás (Admision)
                  // ven Admision + Azafata pero no Admin.
                  if (can(currentUser, 'abm_usuarios')) return true;
                  return k === Role.ADMISSION || k === Role.HOSTESS;
                })
                .map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => setActiveRole(k as Role)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-tight whitespace-nowrap transition-all",
                    activeRole === k ? "bg-emerald-950 text-white shadow-md scale-105" : "text-slate-400 hover:bg-slate-100"
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-xl shadow-sm whitespace-nowrap w-full sm:w-auto">
            <div className="p-1.5 bg-emerald-100 rounded-full text-emerald-600">
              <Timer className="w-3.5 h-3.5" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] uppercase font-bold text-emerald-600">Espera:</span>
              <span className="text-sm font-black text-emerald-900">{averageWaitTime || '--'}m</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full lg:w-auto">
          <div className="relative flex-1 lg:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="Paciente o ID..." className="pl-10 h-10 rounded-xl text-xs" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>}
          </div>
          {can(currentUser, 'crear_pre_ticket') && onNewPreTicket && (
            <Button onClick={onNewPreTicket} variant="outline" className="h-10 border-emerald-200 text-emerald-800 hover:bg-emerald-50 rounded-xl px-4 flex items-center gap-2 shrink-0">
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline text-xs font-bold">Pre-ticket</span>
            </Button>
          )}
          {can(currentUser, 'crear_ticket') && (
            <Button onClick={onNewRequest} className="h-10 bg-emerald-950 hover:bg-emerald-900 rounded-xl shadow-lg px-4 flex items-center gap-2 shrink-0">
              <Plus className="w-4 h-4 text-white" />
              <span className="hidden sm:inline text-xs font-bold">Solicitud</span>
            </Button>
          )}
        </div>
      </div>

      {/* Vista Mobile (Cards) */}
      <div className="grid grid-cols-1 gap-3 md:hidden">
        {sortedTickets.length === 0 ? (
          <div className="py-20 text-center opacity-30">
            <Search className="w-12 h-12 mx-auto mb-3" />
            <p className="text-xs font-black uppercase tracking-widest">Sin solicitudes activas</p>
          </div>
        ) : (
          sortedTickets.map((ticket) => (
            <Card key={ticket.id} className={cn("p-4 border-slate-200 bg-white shadow-sm flex flex-col gap-4 relative overflow-hidden", ticket.status === TicketStatus.REJECTED && "bg-red-50/30")}>
              <div className="flex justify-between items-start">
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={ticket.status} />
                    <span className="text-[9px] font-black font-mono text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">{ticket.id}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h3 className="font-black text-slate-950 text-base leading-tight tracking-tight uppercase">{ticket.patientName}</h3>
                    {getTicketIsolationTypes(ticket).map((iso: IsolationEntry, i: number) => (
                      <span
                        key={`${iso.name}-${i}`}
                        className="inline-flex items-center gap-1 rounded-full bg-violet-500 px-1.5 py-0.5 text-white shrink-0"
                        title={`Aislamiento: ${iso.name}${iso.observation ? ` — ${iso.observation}` : ''}`}
                      >
                        <ShieldAlert className="w-3 h-3" strokeWidth={3} />
                        <span className="text-[9px] font-black uppercase tracking-wide leading-none">{iso.name}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant="outline" className="text-[9px] bg-slate-50 text-slate-500 border-slate-200 font-black py-0">
                    {WORKFLOW_SHORT[ticket.workflow]}
                  </Badge>
                  <div className="text-[10px] font-bold text-slate-400 tabular-nums flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {formatDateTime(ticket.createdAt)}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50/50 rounded-xl border border-slate-100">
                <div className="flex flex-col min-w-0 flex-1">
                  <p className="text-[8px] font-black uppercase text-slate-400 leading-none mb-1">Origen</p>
                  <div className="flex items-center gap-1.5 w-full">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <p className="text-xs font-bold text-slate-700 break-words leading-tight">{formatBedName(ticket.origin)}</p>
                  </div>
                </div>
                
                <div className="flex flex-col items-center justify-center px-2 shrink-0">
                  <ArrowRightLeft className="w-3.5 h-3.5 text-slate-300" />
                </div>

                <div className="flex flex-col min-w-0 flex-1 items-end text-right">
                  <p className="text-[8px] font-black uppercase text-blue-400 leading-none mb-1">Destino</p>
                  <div className="flex items-center gap-1.5 justify-end w-full">
                    <p className="text-xs font-black text-blue-900 break-words leading-tight text-right">{ticket.destination ? formatBedName(ticket.destination) : 'Pendiente'}</p>
                    <BedDouble className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  </div>
                  {ticket.targetBedOriginalStatus && (
                    <p className="text-[9px] font-bold text-slate-500 mt-1 uppercase">
                      Est: {ticket.targetBedOriginalStatus}
                    </p>
                  )}
                </div>
              </div>

              {ticket.observations && (
                <div className="p-2.5 bg-amber-50 border border-amber-100 rounded-xl flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[9px] font-black uppercase text-amber-800 mb-0.5">Observaciones</p>
                    <p className="text-xs font-medium text-amber-900 leading-tight">{ticket.observations}</p>
                  </div>
                </div>
              )}

              {/* Status Context Helper */}
              <div className="text-[10px] font-medium text-slate-500 bg-slate-50 px-3 py-2 rounded-lg border border-slate-100 flex items-center gap-2">
                <Info className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span>
                  {ticket.status === TicketStatus.WAITING_ROOM && "Esperando que la habitación de destino esté lista."}
                  {ticket.status === TicketStatus.IN_TRANSIT && "Habitación lista. Esperando inicio de traslado."}
                  {ticket.status === TicketStatus.IN_TRANSPORT && "Traslado en curso. Esperando confirmación de recepción."}
                  {ticket.status === TicketStatus.WAITING_CONSOLIDATION && "Paciente recibido. Pendiente consolidar en sistema."}
                </span>
              </div>

              {ticket.rejectionReason && (
                <div className="p-2.5 bg-red-100/50 border border-red-200 rounded-xl flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-red-600 mt-0.5" />
                  <p className="text-[10px] font-bold text-red-900 italic leading-tight">"{ticket.rejectionReason}"</p>
                </div>
              )}

              {renderActionButtons(ticket, true)}
              {renderObsButton(ticket, true)}
            </Card>
          ))
        )}
      </div>

      {/* Vista Desktop (Table) */}
      <Card className="hidden md:block shadow-sm border-slate-200 overflow-hidden bg-white rounded-2xl">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50/50 border-b border-slate-200">
              <TableRow>
                <SortHeader label="Estado" sortKey="status" />
                <TableHead className="min-w-[170px]">Tarea</TableHead>
                <SortHeader label="Paciente" sortKey="patientName" />
                <SortHeader label="Origen" sortKey="origin" />
                <TableHead className="min-w-[110px] whitespace-nowrap">Destino</TableHead>
                <TableHead className="min-w-[120px] whitespace-nowrap">Estado Destino</TableHead>
                <TableHead className="min-w-[200px]">Observaciones</TableHead>
                <TableHead className="text-right whitespace-nowrap">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-48 text-center text-slate-500 bg-white">
                    <div className="flex flex-col items-center justify-center gap-3 opacity-20">
                      <Search className={cn("w-10 h-10", tickets.length === 0 && "animate-pulse")} />
                      <p className="text-sm font-black uppercase tracking-widest">{tickets.length === 0 ? 'Cargando...' : 'Sin resultados'}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                sortedTickets.map((ticket) => (
                  <TableRow key={ticket.id} className={cn("group hover:bg-slate-50/60 transition-colors", ticket.status === TicketStatus.REJECTED && "bg-red-50/40")}>
                    <TableCell>
                      <StatusBadge status={ticket.status} />
                      <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold tabular-nums mt-2">
                        <Clock className="w-3 h-3 opacity-50" /> {formatDateTime(ticket.createdAt)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1.5 items-start">
                        <Badge variant="outline" className="text-[9px] bg-white text-slate-400 border-slate-200 font-black uppercase tracking-tight">
                          {WORKFLOW_LABEL_BADGE[ticket.workflow] ?? 'Interno'}
                        </Badge>
                        <div className="text-[10px] text-slate-500 mt-1">
                          {ticket.status === TicketStatus.WAITING_ROOM && "Esperando habitación lista."}
                          {ticket.status === TicketStatus.IN_TRANSIT && "Esperando inicio de traslado."}
                          {ticket.status === TicketStatus.IN_TRANSPORT && "Esperando confirmación de recepción."}
                          {ticket.status === TicketStatus.WAITING_CONSOLIDATION && "Pendiente consolidar en PROGAL."}
                        </div>
                        {ticket.changeReason && (
                          <div className="flex items-center gap-1.5 text-[9px] font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/50 uppercase mt-1">
                            <Info className="w-3 h-3" /> {ticket.changeReason}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-black text-slate-950 text-base uppercase tracking-tight">{ticket.patientName}</span>
                        {getTicketIsolationTypes(ticket).map((iso: IsolationEntry, i: number) => (
                          <span
                            key={`${iso.name}-${i}`}
                            className="inline-flex items-center gap-1 rounded-full bg-violet-500 px-1.5 py-0.5 text-white shrink-0"
                            title={`Aislamiento: ${iso.name}${iso.observation ? ` — ${iso.observation}` : ''}`}
                          >
                            <ShieldAlert className="w-3 h-3" strokeWidth={3} />
                            <span className="text-[9px] font-black uppercase tracking-wide leading-none">{iso.name}</span>
                          </span>
                        ))}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5 uppercase">{ticket.id}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-slate-800 text-sm font-black uppercase tracking-tight leading-tight">{formatBedName(ticket.origin)}</div>
                    </TableCell>
                    <TableCell>
                      {ticket.destination ? (
                        <div className="text-slate-800 text-sm font-black uppercase tracking-tight whitespace-nowrap">{formatBedName(ticket.destination)}</div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {ticket.targetBedOriginalStatus ? (
                          <span className="text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">
                            {ticket.targetBedOriginalStatus}
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-400 uppercase">
                            -
                          </span>
                        )}
                        {ticket.bedAssignedAt && <Badge variant="outline" className="text-[8px] py-0 px-1 border-emerald-100 bg-emerald-50 text-emerald-600 font-black uppercase w-fit whitespace-nowrap">Cama: {ticket.bedAssignedAt}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1.5 items-start">
                        {ticket.status === TicketStatus.REJECTED && ticket.rejectionReason ? (
                          <div className="flex items-start gap-2 p-2 bg-red-100/30 border border-red-200 rounded-lg max-w-[220px]">
                            <AlertCircle className="w-3 h-3 text-red-600 shrink-0 mt-0.5" />
                            <p className="text-[10px] font-bold text-red-900 leading-tight line-clamp-2 italic">
                              {ticket.rejectionReason}
                            </p>
                          </div>
                        ) : (
                          <>
                            {ticket.observations ? (
                              <div className="flex items-start gap-1.5 text-[10px] font-medium text-amber-800 bg-amber-50 p-2 rounded border border-amber-200/50 max-w-[250px]">
                                <Info className="w-3 h-3 shrink-0 mt-0.5 text-amber-600" /> 
                                <span className="leading-tight break-words">{ticket.observations}</span>
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-400 italic">-</span>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      {/* Admin/Admisión suman un 3er botón (Observaciones) que ensancha la
                          columna y achata la grilla → los apilamos en 2 filas. La Azafata
                          tiene menos botones, así que se queda en una sola fila. */}
                      <div className={cn(
                        "flex",
                        (activeRole === Role.ADMIN || activeRole === Role.ADMISSION)
                          ? "flex-col items-end gap-1.5"
                          : "justify-end gap-2"
                      )}>
                        {renderActionButtons(ticket)}
                        {renderObsButton(ticket)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Modal único de Observaciones: hilo (historial) arriba + redactor abajo.
          Mismo lugar para leer y cargar; la nota queda ligada al status actual. */}
      <Dialog open={!!obsTicket} onOpenChange={(open) => { if (!open) closeObs(); }}>
        <DialogContent className="sm:max-w-[480px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2 pr-6">
              <MessageSquare className="w-4 h-4 text-emerald-600" /> Observaciones
              {!obsLoading && obsList.length > 0 && (
                <span className="text-[11px] font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5 tabular-nums">{obsList.length}</span>
              )}
            </DialogTitle>
            {obsTicket && (
              <p className="text-[11px] text-slate-400 font-medium">
                {obsTicket.patientName} · <span className="font-semibold text-slate-600">{obsTicket.status}</span>
              </p>
            )}
          </DialogHeader>

          {/* HILO — historial cronológico (lo más nuevo abajo, pegado al redactor) */}
          <div ref={obsThreadRef} className="grid gap-2 content-start max-h-[42vh] min-h-[88px] overflow-y-auto pr-0.5">
            {obsLoading ? (
              <p className="text-sm text-slate-400 text-center py-6">Cargando…</p>
            ) : obsList.length === 0 ? (
              <div className="text-center py-6">
                <MessageSquare className="w-7 h-7 text-slate-200 mx-auto mb-2" />
                <p className="text-sm text-slate-400">Todavía no hay observaciones.</p>
                <p className="text-xs text-slate-300">Escribí la primera abajo.</p>
              </div>
            ) : (
              obsList.map(o => (
                <div key={o.id} className="p-3 bg-amber-50/60 border border-amber-100 rounded-xl">
                  <p className="text-sm text-slate-800 leading-snug whitespace-pre-wrap break-words">{o.texto}</p>
                  <p className="text-[10px] text-slate-400 font-medium mt-2 flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-slate-600">{o.usuario || 'Usuario'}</span>
                    <span>·</span>
                    <span>{formatDateTime(o.fecha)}</span>
                    {o.status && (<><span>·</span><span className="italic">{o.status}</span></>)}
                  </p>
                </div>
              ))
            )}
          </div>

          {/* REDACTOR — disponible mientras el ticket esté activo. La Azafata deja de cargar
              al llegar a "Por Consolidar" (su parte operativa terminó); igual lee el hilo. */}
          {activeRole === Role.HOSTESS && obsTicket?.status === TicketStatus.WAITING_CONSOLIDATION ? (
            <p className="text-[11px] text-slate-400 border-t border-slate-100 pt-3 text-center">
              El traslado ya está <span className="font-semibold text-slate-600">Por Consolidar</span>. La carga de observaciones se cierra para la azafata.
            </p>
          ) : (
            <div className="grid gap-2 border-t border-slate-100 pt-3">
              {obsTicket && (
                <p className="text-[10px] text-slate-400">
                  Se guardará en: <span className="font-semibold text-slate-600">{obsTicket.status}</span>
                </p>
              )}
              <textarea
                value={obsText}
                onChange={e => setObsText(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Escribí una observación… (ej.: familiar ausente, faltan prendas)"
                className="w-full min-h-[72px] rounded-xl border border-slate-200 p-3 text-sm leading-relaxed focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none resize-y"
              />
              {obsError && <p className="text-red-500 text-xs font-bold">{obsError}</p>}
              <div className="flex items-center justify-end gap-3">
                <span className="text-[11px] text-slate-300 tabular-nums">{obsText.length}/500</span>
                <Button
                  onClick={submitObs}
                  disabled={obsSaving || !obsText.trim()}
                  className="rounded-xl h-10 px-6"
                >
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
