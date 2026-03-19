import React, { useState, useMemo } from 'react';
import { Bed, BedStatus, User, Role, Area } from '../types';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { cn } from '../lib/utils';
import { BedDouble, User as UserIcon, Info, Search, Filter, X, ChevronDown } from 'lucide-react';
import { Dialog, DialogContent } from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Badge } from '../components/ui/badge';

interface BedsViewProps {
  beds: Bed[];
  currentUser: User | null;
}

export const BedsView: React.FC<BedsViewProps> = ({ beds, currentUser }) => {
  const [selectedBed, setSelectedBed] = useState<Bed | null>(null);
  
  // Filters state
  const [patientFilter, setPatientFilter] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [institutionFilter, setInstitutionFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState<string>('ALL');
  const [physicianFilter, setPhysicianFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const isAdmission = currentUser?.role === Role.ADMISSION || currentUser?.role === Role.ADMIN;

  const activeFiltersCount = [
    patientFilter,
    eventFilter,
    institutionFilter,
    areaFilter !== 'ALL',
    physicianFilter,
    statusFilter !== 'ALL'
  ].filter(Boolean).length;

  // Filter beds based on user role, assigned areas and search filters
  const filteredBeds = useMemo(() => {
    let result = [...beds];

    // Role-based filtering
    if (currentUser?.role === Role.HOSTESS && currentUser.assignedAreas?.length > 0) {
      result = result.filter(bed => currentUser.assignedAreas?.includes(bed.area));
    }

    // Admission filters
    if (isAdmission) {
      if (patientFilter) {
        result = result.filter(bed => bed.patientName?.toLowerCase().includes(patientFilter.toLowerCase()));
      }
      if (eventFilter) {
        result = result.filter(bed => bed.eventNumber?.toString().includes(eventFilter));
      }
      if (institutionFilter) {
        result = result.filter(bed => bed.institution?.toLowerCase().includes(institutionFilter.toLowerCase()));
      }
      if (areaFilter !== 'ALL') {
        result = result.filter(bed => bed.area === areaFilter);
      }
      if (physicianFilter) {
        result = result.filter(bed => bed.attendingPhysician?.toLowerCase().includes(physicianFilter.toLowerCase()));
      }
      if (statusFilter !== 'ALL') {
        result = result.filter(bed => bed.status === statusFilter);
      }
    }

    return result;
  }, [beds, currentUser, isAdmission, patientFilter, eventFilter, institutionFilter, areaFilter, physicianFilter, statusFilter]);

  const resetFilters = () => {
    setPatientFilter('');
    setEventFilter('');
    setInstitutionFilter('');
    setAreaFilter('ALL');
    setPhysicianFilter('');
    setStatusFilter('ALL');
  };

  // Group beds by Area
  const bedsByArea: Record<string, Bed[]> = {};
  filteredBeds.forEach(bed => {
    if (!bedsByArea[bed.area]) bedsByArea[bed.area] = [];
    bedsByArea[bed.area].push(bed);
  });

  const getStatusColor = (status: BedStatus) => {
    switch (status) {
      case BedStatus.AVAILABLE: return "bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200";
      case BedStatus.OCCUPIED: return "bg-red-100 text-red-700 border-red-300 hover:bg-red-200";
      case BedStatus.PREPARATION: return "bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-200";
      case BedStatus.ASSIGNED: return "bg-indigo-100 text-indigo-700 border-indigo-300 hover:bg-indigo-200";
      case BedStatus.DISABLED: return "bg-slate-100 text-slate-500 border-slate-300 hover:bg-slate-200";
      default: return "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200";
    }
  };

  const getStatusDot = (status: BedStatus) => {
    switch (status) {
      case BedStatus.AVAILABLE: return "bg-emerald-500";
      case BedStatus.OCCUPIED: return "bg-red-500";
      case BedStatus.PREPARATION: return "bg-amber-500";
      case BedStatus.ASSIGNED: return "bg-indigo-500";
      case BedStatus.DISABLED: return "bg-slate-400";
      default: return "bg-slate-400";
    }
  };

  return (
    <div className="p-2 md:p-3 space-y-2 md:space-y-4 max-w-[1600px] mx-auto w-full relative">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 pb-2">
        <div className="flex items-center gap-3">
          <h2 className="text-lg md:text-xl font-black tracking-tight text-slate-900 whitespace-nowrap">Mapa de Camas</h2>
          
          <div className="h-4 w-px bg-slate-200 hidden sm:block" />

          {isAdmission && (
            <Popover>
              <PopoverTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className={cn(
                    "h-8 rounded-lg border-slate-200 font-bold text-[10px] md:text-xs gap-1.5 px-3 transition-all",
                    activeFiltersCount > 0 ? "bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100" : "hover:bg-slate-50"
                  )}
                >
                  <Filter className="h-3 w-3" />
                  <span>Filtros</span>
                  {activeFiltersCount > 0 && (
                    <Badge variant="secondary" className="ml-0.5 h-4 min-w-4 flex items-center justify-center p-0 text-[9px] bg-indigo-600 text-white border-none">
                      {activeFiltersCount}
                    </Badge>
                  )}
                  <ChevronDown className="h-2.5 w-2.5 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[320px] md:w-[450px] p-4 rounded-2xl shadow-2xl border-slate-200" align="start">
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-50 pb-2">
                    <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <Filter className="h-4 w-4 text-indigo-500" />
                      Filtros de Búsqueda
                    </h3>
                    {activeFiltersCount > 0 && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={resetFilters}
                        className="h-7 px-2 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <X className="h-3 w-3 mr-1" />
                        Limpiar
                      </Button>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest ml-1">Paciente</label>
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                        <Input 
                          placeholder="Nombre..." 
                          value={patientFilter}
                          onChange={(e) => setPatientFilter(e.target.value)}
                          className="pl-8 h-9 text-xs rounded-xl border-slate-200 focus:ring-indigo-500"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest ml-1">Evento</label>
                      <Input 
                        placeholder="N° Evento..." 
                        value={eventFilter}
                        onChange={(e) => setEventFilter(e.target.value)}
                        className="h-9 text-xs rounded-xl border-slate-200 focus:ring-indigo-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest ml-1">Institución</label>
                      <Input 
                        placeholder="Financiador..." 
                        value={institutionFilter}
                        onChange={(e) => setInstitutionFilter(e.target.value)}
                        className="h-9 text-xs rounded-xl border-slate-200 focus:ring-indigo-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest ml-1">Piso</label>
                      <Select value={areaFilter} onValueChange={setAreaFilter}>
                        <SelectTrigger className="h-9 text-xs rounded-xl border-slate-200 focus:ring-indigo-500">
                          <SelectValue placeholder="Todos" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-slate-200">
                          <SelectItem value="ALL">Todos los pisos</SelectItem>
                          {Object.values(Area).map((area) => (
                            <SelectItem key={area} value={area}>{area}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest ml-1">Médico</label>
                      <Input 
                        placeholder="Profesional..." 
                        value={physicianFilter}
                        onChange={(e) => setPhysicianFilter(e.target.value)}
                        className="h-9 text-xs rounded-xl border-slate-200 focus:ring-indigo-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest ml-1">Estado</label>
                      <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="h-9 text-xs rounded-xl border-slate-200 focus:ring-indigo-500">
                          <SelectValue placeholder="Todos" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-slate-200">
                          <SelectItem value="ALL">Todos los estados</SelectItem>
                          {Object.values(BedStatus).map((status) => (
                            <SelectItem key={status} value={status}>{status}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>

        <div className="flex items-center gap-1.5 ml-auto sm:ml-0">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-50 border border-slate-100 text-[10px] md:text-xs font-black text-slate-500 uppercase tracking-wider">
            <BedDouble className="h-3 w-3 text-slate-400" />
            <span>{filteredBeds.length} camas</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 md:gap-4">
        {Object.entries(bedsByArea).map(([areaName, areaBeds]) => (
          <div key={areaName} className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="rounded-lg bg-slate-100/50 border-slate-200 text-slate-600 font-bold px-2 py-0.5">
                {areaName}
              </Badge>
              <div className="h-px flex-1 bg-slate-100" />
            </div>
            <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-12 lg:grid-cols-16 xl:grid-cols-20 gap-1 md:gap-1.5">
              {areaBeds.map(bed => {
                const shortCode = `${bed.roomCode}-${bed.bedCode}`;

                return (
                  <button
                    key={bed.id}
                    onClick={() => setSelectedBed(bed)}
                    className={cn(
                      "relative flex flex-col items-center justify-center aspect-square rounded-lg border transition-all duration-200 overflow-hidden group",
                      getStatusColor(bed.status)
                    )}
                  >
                    <div className={cn("absolute top-1 right-1 w-1 h-1 md:w-1.5 md:h-1.5 rounded-full shadow-sm", getStatusDot(bed.status))} />
                    
                    <span className="text-[9px] sm:text-[10px] md:text-xs font-black tracking-tighter mt-0.5">
                      {shortCode}
                    </span>
                    
                    {/* Desktop extra info preview */}
                    <div className="hidden md:flex flex-col items-center mt-0 w-full px-0.5 opacity-80 group-hover:opacity-100 transition-opacity">
                      {bed.status === BedStatus.OCCUPIED && (
                        <span className="text-[7px] md:text-[8px] font-bold truncate w-full text-center leading-none">
                          {bed.patientName}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Bed Details Modal */}
      <Dialog open={!!selectedBed} onOpenChange={(open) => !open && setSelectedBed(null)}>
        <DialogContent className="sm:max-w-[400px] p-0 overflow-hidden rounded-3xl border-0 shadow-2xl">
          {selectedBed && (() => {
            type A = { headerBg: string; iconBg: string; icon: string; pill: string; dot: string; patientBg: string; patientBorder: string; label: string };
            const theme: Record<BedStatus, A> = {
              [BedStatus.AVAILABLE]:   { headerBg: 'bg-emerald-50',  iconBg: 'bg-emerald-100', icon: 'text-emerald-600', pill: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', patientBg: 'bg-emerald-50',  patientBorder: 'border-emerald-100', label: 'text-emerald-500' },
              [BedStatus.OCCUPIED]:    { headerBg: 'bg-red-50',      iconBg: 'bg-red-100',     icon: 'text-red-500',     pill: 'bg-red-100 text-red-600',         dot: 'bg-red-500',     patientBg: 'bg-red-50',      patientBorder: 'border-red-100',     label: 'text-red-400'     },
              [BedStatus.PREPARATION]: { headerBg: 'bg-amber-50',    iconBg: 'bg-amber-100',   icon: 'text-amber-600',   pill: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-500',   patientBg: 'bg-amber-50',    patientBorder: 'border-amber-100',   label: 'text-amber-500'   },
              [BedStatus.ASSIGNED]:    { headerBg: 'bg-indigo-50',   iconBg: 'bg-indigo-100',  icon: 'text-indigo-600',  pill: 'bg-indigo-100 text-indigo-700',   dot: 'bg-indigo-500',  patientBg: 'bg-indigo-50',   patientBorder: 'border-indigo-100',  label: 'text-indigo-400'  },
              [BedStatus.DISABLED]:    { headerBg: 'bg-slate-100',   iconBg: 'bg-slate-200',   icon: 'text-slate-500',   pill: 'bg-slate-200 text-slate-500',     dot: 'bg-slate-400',   patientBg: 'bg-slate-50',    patientBorder: 'border-slate-200',   label: 'text-slate-400'   },
            };
            const t = theme[selectedBed.status];

            const isOccupied  = selectedBed.status === BedStatus.OCCUPIED;
            const isAssigned  = selectedBed.status === BedStatus.ASSIGNED;
            const isPrep      = selectedBed.status === BedStatus.PREPARATION;
            const isAvailable = selectedBed.status === BedStatus.AVAILABLE;
            const isDisabled  = selectedBed.status === BedStatus.DISABLED;

            return (
              <div>
                {/* Soft pastel header */}
                <div className={cn("p-7 flex flex-col items-center text-center gap-3", t.headerBg)}>
                  <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm", t.iconBg)}>
                    <BedDouble className={cn("w-7 h-7", t.icon)} />
                  </div>
                  <div>
                    <h2 className="text-lg font-black tracking-tight text-slate-900">{selectedBed.label}</h2>
                    <span className={cn("inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest", t.pill)}>
                      <span className={cn("w-1.5 h-1.5 rounded-full", t.dot)} />
                      {selectedBed.status}
                    </span>
                  </div>
                </div>

                {/* White slide-up panel */}
                <div className="-mt-4 bg-white rounded-t-3xl relative z-10 p-5 space-y-3">

                  {/* Room + Bed stat cards */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">Habitación</p>
                      <p className="text-2xl font-black text-slate-800 leading-none">{selectedBed.roomCode}</p>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">Cama</p>
                      <p className="text-2xl font-black text-slate-800 leading-none">{selectedBed.bedCode}</p>
                    </div>
                  </div>

                  {/* OCCUPIED — patient info */}
                  {isOccupied && (
                    <>
                      <div className={cn("rounded-2xl p-4 border", t.patientBg, t.patientBorder)}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <UserIcon className={cn("w-3.5 h-3.5", t.label)} />
                          <span className={cn("text-[9px] font-bold uppercase tracking-widest", t.label)}>Paciente</span>
                        </div>
                        <p className="text-base font-black text-slate-900 leading-snug">{selectedBed.patientName}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">DNI</p>
                          <p className="text-sm font-mono font-bold text-slate-700">{selectedBed.dni || '—'}</p>
                        </div>
                        <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Edad</p>
                          <p className="text-sm font-bold text-slate-700">{selectedBed.age != null ? `${selectedBed.age} años` : '—'}</p>
                        </div>
                      </div>

                      <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Financiador</p>
                        <p className="text-sm font-semibold text-slate-700 leading-snug">{selectedBed.institution || '—'}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Evento</p>
                          <p className="text-sm font-mono font-bold text-slate-700">
                            {selectedBed.eventOrigin && selectedBed.eventNumber
                              ? `${selectedBed.eventOrigin}-${selectedBed.eventNumber}`
                              : '—'}
                          </p>
                        </div>
                        <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">ID Paciente</p>
                          <p className="text-sm font-mono font-bold text-slate-700">{selectedBed.patientCode || '—'}</p>
                        </div>
                      </div>
                    </>
                  )}

                  {isAssigned && (
                    <div className="bg-indigo-50 rounded-2xl p-4 border border-indigo-100 flex items-start gap-3">
                      <Info className="w-5 h-5 text-indigo-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-bold text-indigo-800">Cama Reservada</p>
                        <p className="text-xs text-indigo-500 mt-0.5 leading-relaxed">Es el destino de un traslado en curso. No disponible para nuevas asignaciones.</p>
                      </div>
                    </div>
                  )}

                  {isAvailable && (
                    <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100 flex items-center justify-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <p className="text-sm font-semibold text-emerald-700">Lista para recibir paciente</p>
                    </div>
                  )}

                  {isPrep && (
                    <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100 flex items-center gap-3">
                      <Info className="w-5 h-5 text-amber-400 flex-shrink-0" />
                      <p className="text-xs font-semibold text-amber-700 leading-relaxed">Esta cama se está preparando para un nuevo ingreso.</p>
                    </div>
                  )}

                  {isDisabled && (
                    <div className="bg-slate-100 rounded-2xl p-4 border border-slate-200 flex items-center justify-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-slate-400" />
                      <p className="text-sm font-semibold text-slate-500">Cama fuera de servicio</p>
                    </div>
                  )}

                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
};
