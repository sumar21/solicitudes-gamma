
import React, { useMemo } from 'react';
import { Ticket, Role, TicketStatus, SortConfig, SortKey, WorkflowType, User, Bed } from '../types';
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
import { cn } from '../lib/utils';

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
  onRejectTicket: (id: string) => void;
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

const ROLE_LABELS: Record<Role, string> = {
  [Role.ADMIN]: 'Admin',
  [Role.COORDINATOR]: 'Coord.',
  [Role.ADMISSION]: 'Adm.',
  [Role.HOUSEKEEPING]: 'Hig.',
  [Role.NURSING]: 'Enf.',
  [Role.HOSTESS]: 'Azafata',
  [Role.READ_ONLY]: 'Lectura',
};

const WORKFLOW_SHORT: Record<WorkflowType, string> = {
  [WorkflowType.INTERNAL]: 'Int.',
  [WorkflowType.ITR_TO_FLOOR]: 'ITR',
  [WorkflowType.ROOM_CHANGE]: 'Hab.',
};

export const RequestsView: React.FC<RequestsViewProps> = ({
  tickets, activeRole, setActiveRole, averageWaitTime,
  searchTerm, setSearchTerm, sortConfig, onSort,
  onNewRequest, onValidateReason, onRejectTicket, onAssignBed,
  onHousekeepingAction, onStartTransport, onCompleteTransport,
  onRoomReady, onConfirmReception, onConsolidate, currentUser, beds
}) => {

  const sortedTickets = useMemo(() => {
    let filtered = tickets.filter(t => t.status !== TicketStatus.COMPLETED);
    
    if (activeRole !== Role.ADMIN && activeRole !== Role.COORDINATOR) {
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
          return t.status === TicketStatus.WAITING_CONSOLIDATION;
        }
        if (activeRole === Role.HOSTESS) {
          return t.status === TicketStatus.WAITING_ROOM || 
                 t.status === TicketStatus.IN_TRANSIT;
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

    if (activeRole === Role.HOSTESS) {
       if (!currentUser?.assignedAreas) return null;
       
       const originBed = beds.find(b => b.label === ticket.origin);
       const destBed = ticket.destination ? beds.find(b => b.label === ticket.destination) : null;
       
       const isOriginHostess = originBed && currentUser.assignedAreas.includes(originBed.area);
       const isDestHostess = destBed && currentUser.assignedAreas.includes(destBed.area);

       // Case: Target Prep -> WAITING_ROOM (Waiting for Room)
       if (ticket.status === TicketStatus.WAITING_ROOM) {
         if (isDestHostess) {
           return (
             <Button size={size} className={cn(btnClass, "bg-blue-600 hover:bg-blue-700 text-white")} onClick={() => onRoomReady(ticket.id)}>
               <ClipboardCheck className="w-3.5 h-3.5 mr-2" /> Habitación Lista
             </Button>
           );
         }
         if (isOriginHostess) {
            return <Badge variant="outline" className="text-yellow-600 border-yellow-200 bg-yellow-50">Esperando Destino</Badge>;
         }
       }

       // Case: Room Ready / Available -> IN_TRANSIT
       if (ticket.status === TicketStatus.IN_TRANSIT) {
          if (isOriginHostess) {
             return <Badge variant="outline" className="text-emerald-600 border-emerald-200 bg-emerald-50">Destino Listo</Badge>;
          }
          if (isDestHostess) {
             return (
                <Button size={size} className={cn(btnClass, "bg-emerald-600 hover:bg-emerald-700 text-white")} onClick={() => onConfirmReception(ticket.id)}>
                  <CheckCircle2 className="w-3.5 h-3.5 mr-2" /> Recepción OK
                </Button>
             );
          }
       }
       return null;
    }

    if (activeRole === Role.ADMISSION || activeRole === Role.ADMIN) {
      if (ticket.status === TicketStatus.WAITING_CONSOLIDATION) {
        return (
          <Button size={size} className={cn(btnClass, "bg-purple-600 hover:bg-purple-700")} onClick={() => onConsolidate(ticket.id)}>
            <BedDouble className="w-3.5 h-3.5 mr-2" /> Consolidar PROGAL
          </Button>
        );
      }
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
          <div className="flex items-center gap-2 w-full sm:w-auto bg-white p-1 rounded-xl border border-slate-200 shadow-sm overflow-x-auto no-scrollbar">
            {Object.entries(ROLE_LABELS).map(([k, v]) => (
              <button
                key={k}
                onClick={() => setActiveRole(k as Role)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-tight whitespace-nowrap transition-all",
                  activeRole === k ? "bg-zinc-950 text-white shadow-md scale-105" : "text-slate-400 hover:bg-slate-100"
                )}
              >
                {v}
              </button>
            ))}
          </div>
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
          {(activeRole === Role.COORDINATOR || activeRole === Role.ADMISSION || activeRole === Role.ADMIN) && (
            <Button onClick={onNewRequest} className="h-10 bg-zinc-950 hover:bg-black rounded-xl shadow-lg px-4 flex items-center gap-2 shrink-0">
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

              <div className="flex flex-col gap-2 p-3 bg-slate-50/50 rounded-xl border border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                    <MapPin className="w-3 h-3 text-slate-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[8px] font-black uppercase text-slate-400 leading-none mb-0.5">Origen</p>
                    <p className="text-xs font-bold text-slate-700 truncate">{ticket.origin}</p>
                  </div>
                </div>
                {ticket.destination && (
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                      <ArrowRightLeft className="w-3 h-3 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[8px] font-black uppercase text-blue-400 leading-none mb-0.5">Destino Final</p>
                      <p className="text-xs font-black text-blue-900 truncate">{ticket.destination}</p>
                    </div>
                  </div>
                )}
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
                <SortHeader label="Paciente" sortKey="patientName" />
                <SortHeader label="Origen" sortKey="origin" />
                <SortHeader label="Hora" sortKey="createdAt" />
                <TableHead className="min-w-[180px]">Detalles / Motivos</TableHead>
                <TableHead className="text-right whitespace-nowrap">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-48 text-center text-slate-500 bg-white">
                    <div className="flex flex-col items-center justify-center gap-3 opacity-20">
                      <Search className="w-10 h-10" />
                      <p className="text-sm font-black uppercase tracking-widest">Sin resultados</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                sortedTickets.map((ticket) => (
                  <TableRow key={ticket.id} className={cn("group hover:bg-slate-50/60 transition-colors", ticket.status === TicketStatus.REJECTED && "bg-red-50/40")}>
                    <TableCell><StatusBadge status={ticket.status} /></TableCell>
                    <TableCell>
                      <div className="font-bold text-slate-900 text-sm uppercase tracking-tight">{ticket.patientName}</div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5 uppercase">{ticket.id}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-slate-600 text-xs font-bold uppercase">{ticket.origin}</div>
                      {ticket.destination && <div className="flex items-center gap-1.5 mt-1"><ArrowRightLeft className="w-2.5 h-2.5 text-slate-300" /><span className="text-[10px] font-black text-blue-600 bg-blue-50 px-1 rounded">{ticket.destination}</span></div>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold tabular-nums"><Clock className="w-3 h-3 opacity-50" /> {ticket.createdAt}</div>
                        {ticket.bedAssignedAt && <Badge variant="outline" className="text-[8px] py-0 px-1 border-emerald-100 bg-emerald-50 text-emerald-600 font-black uppercase">Cama: {ticket.bedAssignedAt}</Badge>}
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
                            <Badge variant="outline" className="text-[9px] bg-white text-slate-400 border-slate-200 font-black uppercase tracking-tight">
                              {ticket.workflow === WorkflowType.INTERNAL ? 'Interno' : ticket.workflow === WorkflowType.ITR_TO_FLOOR ? 'Ingreso ITR' : 'Cambio Hab.'}
                            </Badge>
                            {ticket.changeReason && (
                              <div className="flex items-center gap-1.5 text-[9px] font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/50 uppercase">
                                <Info className="w-3 h-3" /> {ticket.changeReason}
                              </div>
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
