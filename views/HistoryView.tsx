
import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Ticket, TicketStatus, WorkflowType } from '../types';
import {
  Search, Calendar as CalendarIcon, Clock, CheckCircle2,
  ArrowRightLeft, Settings, X, Filter, AlertCircle, Download, MapPin
} from '../components/Icons';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '../components/ui/popover';
import { Calendar } from '../components/ui/calendar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { AuditModal } from '../components/AuditModal';
import { cn, formatDateReadable, formatDateTime, calculateTicketMetrics, formatBedName } from '../lib/utils';

interface HistoryViewProps {
  tickets: Ticket[];
}

const WORKFLOW_LABELS: Record<WorkflowType, string> = {
  [WorkflowType.INTERNAL]: 'Traslado Interno',
  [WorkflowType.ITR_TO_FLOOR]: 'Ingreso ITR',
  [WorkflowType.ROOM_CHANGE]: 'Cambio Habitación',
};

const DateRangeTrigger = React.forwardRef<
  HTMLButtonElement, 
  { label: string; value: string; placeholder: string } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ label, value, placeholder, className, ...props }, ref) => (
  <button 
    ref={ref}
    type="button"
    className={cn(
      "w-full h-full px-4 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors outline-none",
      className
    )}
    {...props}
  >
    <CalendarIcon className="w-3.5 h-3.5 text-slate-400" />
    <div className="flex flex-col justify-center pointer-events-none">
      <span className="text-[7px] uppercase font-bold text-slate-400 leading-none mb-0.5">{label}</span>
      <span className={cn("text-xs font-bold leading-none", value ? "text-slate-900" : "text-slate-300")}>
        {value ? formatDateReadable(value) : placeholder}
      </span>
    </div>
  </button>
));
DateRangeTrigger.displayName = "DateRangeTrigger";

export const HistoryView: React.FC<HistoryViewProps> = ({ tickets }) => {
  const todayISO = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(todayISO);
  const [endDate, setEndDate] = useState(todayISO);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTicketForAudit, setSelectedTicketForAudit] = useState<Ticket | null>(null);

  const [openStart, setOpenStart] = useState(false);
  const [openEnd, setOpenEnd] = useState(false);

  const filteredHistory = useMemo(() => {
    return tickets
      .filter(t => t.status === TicketStatus.COMPLETED || t.status === TicketStatus.REJECTED)
      .filter(t => {
        const matchesSearch = t.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                             t.id.toLowerCase().includes(searchTerm.toLowerCase());
        const ticketDate = (t.date || '').slice(0, 10);
        const matchesStart = startDate ? ticketDate >= startDate : true;
        const matchesEnd = endDate ? ticketDate <= endDate : true;
        return matchesSearch && matchesStart && matchesEnd;
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [tickets, startDate, endDate, searchTerm]);

  const hasFilters = startDate !== todayISO || endDate !== todayISO || !!searchTerm;

  const clearFilters = () => {
    setStartDate(todayISO);
    setEndDate(todayISO);
    setSearchTerm('');
  };

  const handleExportExcel = () => {
    const dataToExport = filteredHistory.map(t => ({
      "Fecha": t.date,
      "ID Ticket": t.id,
      "Paciente": t.patientName,
      "Tipo Workflow": WORKFLOW_LABELS[t.workflow],
      "Origen": t.origin,
      "Destino": t.destination || 'N/A',
      "Resultado": t.status === TicketStatus.REJECTED ? 'CANCELADO' : 'CONSOLIDADO',
      "Tiempo Total (min)": calculateTicketMetrics(t).totalCycleTime
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Historial Operativo");
    
    const fileName = `mediflow_reporte_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  return (
    <div className="p-2 md:p-4 animate-in slide-in-from-right-4 duration-300 max-w-full space-y-3 pb-20 md:pb-8">
      {/* Compact filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            placeholder="Paciente o ID de ticket..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9 h-9 text-xs rounded-xl border-slate-200"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Date range */}
        <div className="flex items-center bg-white border border-slate-200 rounded-xl overflow-hidden h-9">
          <Popover open={openStart} onOpenChange={setOpenStart}>
            <PopoverTrigger asChild>
              <DateRangeTrigger label="Desde" value={startDate} placeholder="---" className="h-full text-xs" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-4 bg-white shadow-2xl z-50">
              <Calendar selected={startDate} onSelect={(date) => { setStartDate(date); setOpenStart(false); }} />
            </PopoverContent>
          </Popover>
          <div className="w-px h-5 bg-slate-100 shrink-0" />
          <Popover open={openEnd} onOpenChange={setOpenEnd}>
            <PopoverTrigger asChild>
              <DateRangeTrigger label="Hasta" value={endDate} placeholder="---" className="h-full text-xs" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-4 bg-white shadow-2xl z-50">
              <Calendar selected={endDate} onSelect={(date) => { setEndDate(date); setOpenEnd(false); }} />
            </PopoverContent>
          </Popover>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 ml-auto">
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 px-2 text-[10px] text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg">
              <X className="w-3 h-3 mr-1" />Limpiar
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportExcel}
            className="h-8 gap-1.5 bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 font-bold text-[10px] rounded-lg"
          >
            <Download className="w-3 h-3" />
            Excel
          </Button>
        </div>
      </div>

      {/* Vista Mobile History */}
      <div className="grid grid-cols-1 gap-3 md:hidden">
        {filteredHistory.length === 0 ? (
          <div className="py-20 text-center opacity-30">
            <Search className="w-12 h-12 mx-auto mb-3" />
            <p className="text-xs font-black uppercase tracking-widest">Historial vacío</p>
          </div>
        ) : (
          filteredHistory.map((t) => (
            <Card 
              key={t.id} 
              onClick={() => setSelectedTicketForAudit(t)}
              className={cn("p-4 border-slate-200 bg-white shadow-sm flex flex-col gap-4 active:scale-[0.98] transition-all", t.status === TicketStatus.REJECTED && "border-l-4 border-l-red-500")}
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {t.status === TicketStatus.REJECTED ? (
                      <Badge variant="destructive" className="text-[8px] uppercase font-black px-1.5 py-0">Rechazado</Badge>
                    ) : (
                      <Badge variant="success" className="text-[8px] uppercase font-black px-1.5 py-0">Finalizado</Badge>
                    )}
                    <span className="text-[10px] font-black font-mono text-slate-400 tabular-nums">{formatDateTime(t.createdAt)}</span>
                  </div>
                  <h3 className="font-black text-slate-900 text-sm leading-tight uppercase tracking-tight">{t.patientName}</h3>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400">
                  <Settings className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-100 uppercase tabular-nums">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-slate-300" /> Total: {calculateTicketMetrics(t).totalCycleTime}m
                </div>
                <div className="text-slate-400">ID: {t.id}</div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="flex-1 min-w-0 text-[10px] font-black text-slate-800 uppercase bg-slate-100 px-2 py-1 rounded-lg truncate text-center">{formatBedName(t.origin)}</span>
                <ArrowRightLeft className="w-3 h-3 text-slate-300 shrink-0" />
                <span className="flex-1 min-w-0 text-[10px] font-black text-blue-700 uppercase bg-blue-50 px-2 py-1 rounded-lg truncate text-center">{t.destination ? formatBedName(t.destination) : 'ANULADO'}</span>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Vista Desktop History */}
      <Card className="hidden md:block shadow-sm border-slate-200 overflow-hidden bg-white rounded-2xl">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50/50 border-b border-slate-200">
              <TableRow>
                <TableHead className="font-bold text-[9px] uppercase tracking-widest text-slate-400 px-6 h-10">Fecha</TableHead>
                <TableHead className="font-bold text-[9px] uppercase tracking-widest text-slate-400 h-10">Paciente</TableHead>
                <TableHead className="font-bold text-[9px] uppercase tracking-widest text-slate-400 h-10">Workflow</TableHead>
                <TableHead className="font-bold text-[9px] uppercase tracking-widest text-slate-400 h-10">Trayectoria</TableHead>
                <TableHead className="font-bold text-[9px] uppercase tracking-widest text-slate-400 h-10">Resultado</TableHead>
                <TableHead className="text-right font-bold text-[9px] uppercase tracking-widest text-slate-400 pr-8 h-10">Audit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredHistory.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-64 text-center">
                    <div className="flex flex-col items-center justify-center opacity-20">
                      <Search className="w-12 h-12 mb-4" />
                      <p className="text-sm font-black uppercase tracking-widest">Sin resultados</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredHistory.map((t) => (
                  <TableRow key={t.id} className={cn("hover:bg-slate-50/50 transition-colors border-b border-slate-100 last:border-0 group", t.status === TicketStatus.REJECTED && "bg-red-50/5")}>
                    <TableCell className="text-xs font-bold text-slate-500 px-6 py-5 tabular-nums whitespace-nowrap">
                      {formatDateTime(t.createdAt)}
                    </TableCell>
                    <TableCell className="py-5">
                      <div className="font-black text-slate-950 text-base uppercase tracking-tight">{t.patientName}</div>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5 font-bold uppercase">{t.id}</div>
                    </TableCell>
                    <TableCell className="py-5">
                      <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-wide bg-slate-50 text-slate-600 border-slate-200 rounded-lg px-3 py-1">
                        {WORKFLOW_LABELS[t.workflow]}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-5">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-slate-500 font-bold uppercase truncate max-w-[150px]">{formatBedName(t.origin)}</span>
                        <span className="flex items-center gap-1.5 text-sm font-black text-slate-900 tracking-tight">
                          <ArrowRightLeft className="w-3.5 h-3.5 text-slate-300"/> {t.destination ? formatBedName(t.destination) : 'N/A'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="py-5">
                      <div className="flex flex-col gap-1">
                        {t.status === TicketStatus.REJECTED ? (
                          <div className="flex items-center gap-2 text-[11px] text-red-600 font-bold bg-red-50 w-fit px-3 py-1.5 rounded-lg border border-red-100">
                            <AlertCircle className="w-3.5 h-3.5" /> Cancelado
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-[11px] text-emerald-600 font-bold bg-emerald-50 w-fit px-3 py-1.5 rounded-lg border border-emerald-100">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Consolidado
                          </div>
                        )}
                        {t.completedAt && (
                          <span className="text-[10px] text-slate-400 font-medium tabular-nums ml-1">{formatDateTime(t.completedAt)}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right py-5 pr-8">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setSelectedTicketForAudit(t)} 
                        className="h-8 gap-2 bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300 font-bold text-[10px] uppercase tracking-wider shadow-sm rounded-lg transition-all"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        Auditar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <AuditModal 
        ticket={selectedTicketForAudit} 
        isOpen={!!selectedTicketForAudit} 
        onClose={() => setSelectedTicketForAudit(null)} 
        workflowLabels={WORKFLOW_LABELS}
      />
    </div>
  );
};
