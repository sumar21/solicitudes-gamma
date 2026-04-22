
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
  const todayISO = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const [startDate, setStartDate] = useState(todayISO);
  const [endDate, setEndDate] = useState(todayISO);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'cancelled'>('all');
  const [selectedTicketForAudit, setSelectedTicketForAudit] = useState<Ticket | null>(null);
  const [exporting, setExporting] = useState(false);

  const [openStart, setOpenStart] = useState(false);
  const [openEnd, setOpenEnd] = useState(false);

  const filteredHistory = useMemo(() => {
    return tickets
      .filter(t => t.status === TicketStatus.COMPLETED || t.status === TicketStatus.REJECTED)
      .filter(t => {
        if (statusFilter === 'completed') return t.status === TicketStatus.COMPLETED;
        if (statusFilter === 'cancelled') return t.status === TicketStatus.REJECTED;
        return true;
      })
      .filter(t => {
        const matchesSearch = searchTerm
          ? t.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            t.id.toLowerCase().includes(searchTerm.toLowerCase())
          : true;
        // When searching by patient/ID, skip date filter to show full journey
        if (searchTerm && matchesSearch) return true;
        const ticketDate = (t.date || '').slice(0, 10);
        const matchesStart = startDate ? ticketDate >= startDate : true;
        const matchesEnd = endDate ? ticketDate <= endDate : true;
        return matchesStart && matchesEnd;
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [tickets, startDate, endDate, searchTerm, statusFilter]);

  const hasFilters = startDate !== todayISO || endDate !== todayISO || !!searchTerm || statusFilter !== 'all';

  const clearFilters = () => {
    setStartDate(todayISO);
    setEndDate(todayISO);
    setSearchTerm('');
    setStatusFilter('all');
  };

  const handleExportExcel = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // Fetch audit events from 08.DetalleTraslados for each filtered ticket, in batches
      // of 10 concurrent requests to avoid saturating SharePoint.
      const token = localStorage.getItem('mediflow_token');
      const eventsPerTicket = new Map<string, { tipo: string; fecha: string; usuario: string }[]>();
      const BATCH_SIZE = 10;
      for (let i = 0; i < filteredHistory.length; i += BATCH_SIZE) {
        const batch = filteredHistory.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map(t =>
          fetch(`/api/ticket-events?ticketId=${encodeURIComponent(t.id)}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          })
            .then(r => r.ok ? r.json() : { events: [] })
            .then((d: { events?: { tipo: string; fecha: string; usuario: string }[] }) =>
              [t.id, d.events ?? []] as const
            )
            .catch(() => [t.id, [] as { tipo: string; fecha: string; usuario: string }[]] as const)
        ));
        for (const [tid, evts] of results) eventsPerTicket.set(tid, evts);
      }

      const fmt = (iso: string) => {
        if (!iso) return '';
        try {
          const d = new Date(iso);
          return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'medium' });
        } catch { return iso; }
      };

      const movementLabel = (tipo: string): { label: string; detail: string } => {
        if (!tipo) return { label: '', detail: '' };
        if (tipo === 'Solicitud Creada')     return { label: 'Creación',               detail: '' };
        if (tipo === 'Habitacion Preparada') return { label: 'Habitación Preparada',   detail: '' };
        if (tipo === 'Inicio Traslado')      return { label: 'Inicio Traslado',        detail: '' };
        if (tipo === 'Paciente Recibido')    return { label: 'Paciente Recibido',      detail: '' };
        if (tipo === 'Consolidado Progal')   return { label: 'Consolidado en PROGAL',  detail: '' };
        if (tipo.startsWith('Cancelado:')) {
          return { label: 'Cancelación', detail: tipo.replace(/^Cancelado:\s*/, '').trim() };
        }
        if (tipo.startsWith('Modificacion')) {
          const detail = tipo
            .replace(/^Modificacion\s*-\s*/, '')
            .replace(/\s+-\s+Motivo:\s+/, ' — Motivo: ');
          return { label: 'Modificación', detail };
        }
        return { label: tipo, detail: '' };
      };

      // ── Hoja 1: Tickets (una fila por traslado, auto-contenida) ──────────
      type TicketRow = Record<string, string | number>;
      const ticketsSheet: TicketRow[] = filteredHistory.map(t => {
        const events = eventsPerTicket.get(t.id) ?? [];
        const modCount = events.filter(e => e.tipo.startsWith('Modificacion')).length;
        return {
          "Fecha": fmt(t.createdAt),
          "ID Ticket": t.id,
          "Paciente": t.patientName,
          "Workflow": WORKFLOW_LABELS[t.workflow],
          "Origen": t.origin,
          "Destino": t.destination || 'N/A',
          "Resultado": t.status === TicketStatus.REJECTED ? 'CANCELADO' : 'CONSOLIDADO',
          "Motivo Cancelación": t.status === TicketStatus.REJECTED ? (t.rejectionReason ?? '') : '',
          "Creado por": t.createdBy ?? '',
          "Observaciones": t.observations ?? '',
          "Modificaciones": modCount,
          "Movimientos registrados": events.length,
          "Tiempo Total (min)": calculateTicketMetrics(t).totalCycleTime,
        };
      });

      // ── Hoja 2: Movimientos (una fila por evento, con ID y paciente para cruzar) ─
      type EventRow = Record<string, string>;
      const eventsSheet: EventRow[] = [];
      for (const t of filteredHistory) {
        const events = eventsPerTicket.get(t.id) ?? [];
        for (const evt of events) {
          const { label, detail } = movementLabel(evt.tipo);
          eventsSheet.push({
            "Fecha/Hora": fmt(evt.fecha),
            "ID Ticket": t.id,
            "Paciente": t.patientName,
            "Movimiento": label,
            "Detalle": detail,
            "Usuario": evt.usuario ?? '',
          });
        }
      }

      const workbook = XLSX.utils.book_new();

      const ws1 = XLSX.utils.json_to_sheet(ticketsSheet);
      ws1['!cols'] = [
        { wch: 20 }, // Fecha
        { wch: 24 }, // ID Ticket
        { wch: 28 }, // Paciente
        { wch: 14 }, // Workflow
        { wch: 28 }, // Origen
        { wch: 28 }, // Destino
        { wch: 13 }, // Resultado
        { wch: 32 }, // Motivo Cancelación
        { wch: 20 }, // Creado por
        { wch: 30 }, // Observaciones
        { wch: 14 }, // Modificaciones
        { wch: 18 }, // Movimientos
        { wch: 16 }, // Tiempo Total
      ];
      ws1['!freeze'] = { xSplit: 0, ySplit: 1 }; // freeze header row
      ws1['!autofilter'] = { ref: `A1:M${ticketsSheet.length + 1}` };
      XLSX.utils.book_append_sheet(workbook, ws1, "Tickets");

      if (eventsSheet.length > 0) {
        const ws2 = XLSX.utils.json_to_sheet(eventsSheet);
        ws2['!cols'] = [
          { wch: 20 }, // Fecha/Hora
          { wch: 24 }, // ID Ticket
          { wch: 28 }, // Paciente
          { wch: 22 }, // Movimiento
          { wch: 60 }, // Detalle
          { wch: 22 }, // Usuario
        ];
        ws2['!freeze'] = { xSplit: 0, ySplit: 1 };
        ws2['!autofilter'] = { ref: `A1:F${eventsSheet.length + 1}` };
        XLSX.utils.book_append_sheet(workbook, ws2, "Movimientos");
      }

      const statusSuffix = statusFilter === 'completed' ? '_consolidados'
                          : statusFilter === 'cancelled' ? '_cancelados'
                          : '';
      const fileName = `mediflow_reporte${statusSuffix}_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);
    } finally {
      setExporting(false);
    }
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

        {/* Status filter */}
        <div className="flex items-center bg-white border border-slate-200 rounded-xl overflow-hidden h-9 p-0.5">
          {([
            { key: 'all',        label: 'Todos' },
            { key: 'completed',  label: 'Consolidados' },
            { key: 'cancelled',  label: 'Cancelados' },
          ] as const).map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setStatusFilter(opt.key)}
              aria-pressed={statusFilter === opt.key}
              className={cn(
                "px-3 h-full text-[10px] font-bold uppercase tracking-wide rounded-lg transition-colors",
                statusFilter === opt.key
                  ? opt.key === 'completed' ? "bg-emerald-50 text-emerald-700"
                  : opt.key === 'cancelled' ? "bg-red-50 text-red-600"
                  : "bg-slate-100 text-slate-700"
                  : "text-slate-400 hover:text-slate-600"
              )}
            >
              {opt.label}
            </button>
          ))}
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
            disabled={exporting || filteredHistory.length === 0}
            className="h-8 gap-1.5 bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 font-bold text-[10px] rounded-lg disabled:opacity-60"
          >
            {exporting ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-emerald-200 border-t-emerald-700 rounded-full animate-spin" />
                Generando...
              </>
            ) : (
              <>
                <Download className="w-3 h-3" />
                Excel
              </>
            )}
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
