
import React, { useMemo } from 'react';
import { Ticket, Role, TicketStatus, SortConfig, SortKey, WorkflowType, User, Bed, BedStatus } from '../types';
import {
  Search, Plus, Timer, Clock, ArrowRightLeft,
  ChevronUp, ChevronDown, CheckCircle2, BedDouble, Users, ClipboardCheck, AlertCircle, X, XCircle, Info, MapPin
} from '../components/Icons';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Badge } from '../components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table';
import { StatusBadge } from '../components/StatusBadge';
import { Popover, PopoverTrigger, PopoverContent } from '../components/ui/popover';
import { cn, formatBedName } from '../lib/utils';

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
  onValidateReason: (id: string) => void;
  onAssignBed: (id: string) => void;
  onHousekeepingAction: (id: string, action: 'mark_dirty' | 'mark_clean') => void;
  onStartTransport: (id: string) => void;
  onCompleteTransport: (id: string) => void;
  onRoomReady: (id: string) => void;
  onConfirmReception: (id: string) => void;
  onConsolidate: (id: string) => void;
  currentUser: User | null;
  beds: Bed[];
}

const ROLE_LABELS: Partial<Record<Role, string>> = {
  [Role.ADMIN]: 'Admin',
  [Role.ADMISSION]: 'Admisión',
  [Role.HOSTESS]: 'Azafata',
};

const WORKFLOW_SHORT: Record<WorkflowType, string> = {
  [WorkflowType.INTERNAL]: 'Int.',
  [WorkflowType.ITR_TO_FLOOR]: 'ITR',
  [WorkflowType.ROOM_CHANGE]: 'Hab.',
};

export const RequestsView: React.FC<RequestsViewProps> = ({
  tickets, activeRole, setActiveRole, averageWaitTime,
  searchTerm, setSearchTerm, sortConfig, onSort,
  onNewRequest, onValidateReason, onAssignBed,
  onHousekeepingAction, onStartTransport, onCompleteTransport,
  onRoomReady, onConfirmReception, onConsolidate, currentUser, beds
}) => {

  const sortedTickets = useMemo(() => {
    let filtered = tickets.filter(t => t.status !== TicketStatus.COMPLETED);

    if (activeRole !== Role.ADMIN && activeRole !== Role.COORDINATOR && activeRole !== Role.ADMISSION) {
      filtered = filtered.filter(t => t.status !== TicketStatus.REJECTED);
    }

    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(t =>
        t.id.toLowerCase().includes(searchLower) ||
        t.patientName.toLowerCase().includes(searchLower)
      );
    } else {
      filtered = filtered.filter(t => {
        if (activeRole === Role.COORDINATOR || activeRole === Role.ADMIN) return true;
        if (activeRole === Role.ADMISSION) {
          // Admisión ve todos los tickets activos durante todo el ciclo de vida
          return true;
        }
        if (activeRole === Role.HOSTESS) {
          return t.status === TicketStatus.WAITING_ROOM ||
            t.status === TicketStatus.IN_TRANSIT ||
            t.status === TicketStatus.IN_TRANSPORT;
        }
        return false;
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
    return sortableItems;
  }, [tickets, activeRole, sortConfig, searchTerm]);

  const renderActionButtons = (ticket: Ticket, isMobile = false) => {
    const size = isMobile ? "default" : "sm";
    const btnClass = isMobile ? "w-full h-11 text-xs font-black uppercase tracking-widest rounded-xl" : "h-8 text-[10px] uppercase font-bold tracking-tight";

    // ── AZAFATA ──────────────────────────────────────────────────────────────
    if (activeRole === Role.HOSTESS) {
      if (!currentUser?.assignedAreas) return null;

      const originBed = beds.find(b => b.label === ticket.origin);
      const destBed = ticket.destination ? beds.find(b => b.label === ticket.destination) : null;

      const isOriginHostess = !!(originBed && currentUser.assignedAreas.includes(originBed.area));
      const isDestHostess = !!(destBed && currentUser.assignedAreas.includes(destBed.area));

      // Si no es de ninguna de las dos áreas, no muestra nada
      if (!isOriginHostess && !isDestHostess) return null;

      // Estado 1: WAITING_ROOM — La azafata DESTINO debe confirmar habitación lista
      if (ticket.status === TicketStatus.WAITING_ROOM) {
        if (isDestHostess)
          return (
            <Button size={size} className={cn(btnClass, "bg-blue-600 hover:bg-blue-700 text-white")} onClick={() => onRoomReady(ticket.id)}>
              <ClipboardCheck className="w-3.5 h-3.5 mr-2" /> Habitación Lista
            </Button>
          );
        if (isOriginHostess)
          return <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50">Esperando preparación destino</Badge>;
      }

      // Estado 2: IN_TRANSIT (Habitación Lista) — azafata ORIGEN debe iniciar traslado
      if (ticket.status === TicketStatus.IN_TRANSIT) {
        if (isOriginHostess)
          return (
            <Button size={size} className={cn(btnClass, "bg-emerald-600 hover:bg-emerald-700 text-white")} onClick={() => onStartTransport(ticket.id)}>
              <ArrowRightLeft className="w-3.5 h-3.5 mr-2" /> Iniciar Traslado
            </Button>
          );
        if (isDestHostess)
          return <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50">Esperando inicio de traslado</Badge>;
      }

      // Estado 3: IN_TRANSPORT — La azafata DESTINO debe confirmar recepción
      if (ticket.status === TicketStatus.IN_TRANSPORT) {
        if (isDestHostess)
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

    // ── ADMISIÓN / ADMIN ─────────────────────────────────────────────────────
    if (activeRole === Role.ADMISSION || activeRole === Role.ADMIN) {
      if (ticket.status === TicketStatus.WAITING_CONSOLIDATION)
        return (
          <Button size={size} className={cn(btnClass, "bg-purple-600 hover:bg-purple-700 text-white")} onClick={() => onConsolidate(ticket.id)}>
            <BedDouble className="w-3.5 h-3.5 mr-2" /> Consolidar PROGAL
          </Button>
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
          {(currentUser?.role === Role.ADMIN || currentUser?.role === Role.ADMISSION) && (
            <div className="flex items-center gap-2 w-full sm:w-auto bg-white p-1 rounded-xl border border-slate-200 shadow-sm overflow-x-auto no-scrollbar">
              {Object.entries(ROLE_LABELS).map(([k, v]) => (
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
          {(currentUser?.role === Role.ADMIN || currentUser?.role === Role.ADMISSION) && (
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
                  <h3 className="font-black text-slate-950 text-base leading-tight tracking-tight uppercase">{ticket.patientName}</h3>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant="outline" className="text-[9px] bg-slate-50 text-slate-500 border-slate-200 font-black py-0">
                    {WORKFLOW_SHORT[ticket.workflow]}
                  </Badge>
                  <div className="text-[10px] font-bold text-slate-400 tabular-nums flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {ticket.createdAt}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50/50 rounded-xl border border-slate-100">
                <div className="flex flex-col min-w-0 flex-1">
                  <p className="text-[8px] font-black uppercase text-slate-400 leading-none mb-1">Origen</p>
                  <div className="flex items-center gap-1.5 w-full">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <p className="text-xs font-bold text-slate-700 truncate">{formatBedName(ticket.origin)}</p>
                  </div>
                </div>
                
                <div className="flex flex-col items-center justify-center px-2 shrink-0">
                  <ArrowRightLeft className="w-3.5 h-3.5 text-slate-300" />
                </div>

                <div className="flex flex-col min-w-0 flex-1 items-end text-right">
                  <p className="text-[8px] font-black uppercase text-blue-400 leading-none mb-1">Destino</p>
                  <div className="flex items-center gap-1.5 justify-end w-full">
                    <p className="text-xs font-black text-blue-900 truncate">{ticket.destination ? formatBedName(ticket.destination) : 'Pendiente'}</p>
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
                <TableHead>Tarea</TableHead>
                <SortHeader label="Paciente" sortKey="patientName" />
                <SortHeader label="Origen" sortKey="origin" />
                <TableHead>Destino</TableHead>
                <TableHead>Estado Destino</TableHead>
                <TableHead className="min-w-[180px]">Observaciones</TableHead>
                <TableHead className="text-right whitespace-nowrap">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-48 text-center text-slate-500 bg-white">
                    <div className="flex flex-col items-center justify-center gap-3 opacity-20">
                      <Search className="w-10 h-10" />
                      <p className="text-sm font-black uppercase tracking-widest">Sin resultados</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                sortedTickets.map((ticket) => (
                  <TableRow key={ticket.id} className={cn("group hover:bg-slate-50/60 transition-colors", ticket.status === TicketStatus.REJECTED && "bg-red-50/40")}>
                    <TableCell>
                      <StatusBadge status={ticket.status} />
                      <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold tabular-nums mt-2">
                        <Clock className="w-3 h-3 opacity-50" /> {ticket.createdAt}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1.5 items-start">
                        <Badge variant="outline" className="text-[9px] bg-white text-slate-400 border-slate-200 font-black uppercase tracking-tight">
                          {ticket.workflow === WorkflowType.INTERNAL ? 'Interno' : ticket.workflow === WorkflowType.ITR_TO_FLOOR ? 'Ingreso ITR' : 'Cambio Hab.'}
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
                      <div className="font-black text-slate-950 text-base uppercase tracking-tight">{ticket.patientName}</div>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5 uppercase">{ticket.id}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-slate-800 text-sm font-black uppercase tracking-tight">{formatBedName(ticket.origin)}</div>
                    </TableCell>
                    <TableCell>
                      {ticket.destination ? (
                        <div className="text-slate-800 text-sm font-black uppercase tracking-tight">{formatBedName(ticket.destination)}</div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {ticket.targetBedOriginalStatus ? (
                          <span className="text-[10px] font-bold text-slate-500 uppercase">
                            {ticket.targetBedOriginalStatus}
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-400 uppercase">
                            -
                          </span>
                        )}
                        {ticket.bedAssignedAt && <Badge variant="outline" className="text-[8px] py-0 px-1 border-emerald-100 bg-emerald-50 text-emerald-600 font-black uppercase w-fit">Cama: {ticket.bedAssignedAt}</Badge>}
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
                    <TableCell className="text-right pr-6"><div className="flex justify-end gap-2">{renderActionButtons(ticket)}</div></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
};
