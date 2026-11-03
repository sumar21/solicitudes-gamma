
import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Bed, BedStatus, Ticket, TicketStatus } from '../types';
import { Search, X, Download, History, ClipboardList, Clock, Info } from '../components/Icons';
import { ArrowRight, ChevronRight, CircleDot, FileSearch, Loader2, RefreshCw, Siren } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { StatusBadge } from '../components/ui/status-badge';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { DataTable, type Columna } from '../components/ui/data-table';
import { Cargando, Vacio } from '../components/ui/estados';
import { BarraFiltros, BotonFiltros, CampoFiltro } from '../components/ui/filtros';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { DateRangePicker, type DateRange } from '../components/ui/date-picker';
import { Combobox } from '../components/ui/combobox';
import { AuditModal } from '../components/AuditModal';
import { PatientJourney } from '../components/PatientJourney';
import { aIso, deIso } from '../lib/fechaIso';
import { ESTADOS_TICKET } from '../lib/estados';
import { fecha, fechaHora, numero } from '../lib/formato';
import { movementLabel } from '../lib/ticketEvents';
import { cn, calculateTicketMetrics, formatBedName, formatTicketDestination } from '../lib/utils';
import { WORKFLOW_LABELS } from '../lib/constants';

interface HistoryViewProps {
  tickets: Ticket[];
  /** Recarga el histórico. Ya no se pollea: carga al entrar y con este botón. */
  onRefresh?: () => void | Promise<void>;
  refreshing?: boolean;
  /** Pide al hook cargar el histórico de un rango [from,to] (ART) SERVER-SIDE. */
  onRangeChange?: (from: string, to: string) => void;
  /** Trae la historia COMPLETA de un paciente por código (para la Trayectoria). */
  onFetchPatientTickets?: (patientCode?: string) => Promise<Ticket[]>;
  /** Busca en TODO el histórico por nombre/ID (cross-fecha) — para el buscador de la Lista. */
  onSearchHistory?: (term: string) => Promise<Ticket[]>;
  /** Mapa CRUDO de PROGAL (sin overlays: mergeBeds pasa a "Asignada" la cama de quien vuelve de cirugía y el
   *  paciente quedaba "No internado"). undefined si falló o vino parcial: la Trayectoria dice "Último destino". */
  beds?: Bed[];
}

// fechaHora() (date-fns) tira con una fecha inválida: un histórico con un dato roto no puede tumbar la
// vista entera. Antes formatDateTime devolvía "---"; ahora "—".
const fechaHoraSegura = (iso?: string) => (iso && !Number.isNaN(Date.parse(iso)) ? fechaHora(iso) : '—');

// Urgencia: pill lleno, lo único de la fila que tiene que saltar a la vista (igual que en Traslados).
const PillUrgencia: React.FC<{ ticket: Ticket }> = ({ ticket }) =>
  ticket.urgencia ? (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive px-2 py-0.5 text-[11px] leading-4 font-semibold tracking-wide text-destructive-foreground uppercase"
      title="Ingreso por urgencia"
    >
      <Siren className="size-3" aria-hidden="true" /> Urgencia
    </span>
  ) : null;

// Resultado del traslado cerrado (Consolidado / Cancelado) con el mapa canónico de estados (§3.11).
const Resultado: React.FC<{ ticket: Ticket }> = ({ ticket }) => (
  <StatusBadge tono={ESTADOS_TICKET[ticket.status].tono}>{ESTADOS_TICKET[ticket.status].label}</StatusBadge>
);

export const HistoryView: React.FC<HistoryViewProps> = ({ tickets, onRefresh, refreshing, onRangeChange, onFetchPatientTickets, onSearchHistory, beds }) => {
  const todayISO = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const [startDate, setStartDate] = useState(todayISO);
  const [endDate, setEndDate] = useState(todayISO);

  // Cambiar Desde/Hasta pide al hook cargar ESE rango SERVER-SIDE (antes se traía todo el histórico
  // y se filtraba en el front → con la tabla acumulada chocaba con el cap de filas y no traía nada).
  useEffect(() => {
    onRangeChange?.(startDate, endDate);
  }, [startDate, endDate, onRangeChange]);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'cancelled'>('all');
  const [selectedTicketForAudit, setSelectedTicketForAudit] = useState<Ticket | null>(null);
  const [exporting, setExporting] = useState(false);

  // Barra de filtros (§4.7): abierta o cerrada, solo UI.
  const [verFiltros, setVerFiltros] = useState(false);

  // Modo de vista: lista de traslados (clásico) o trayectoria por paciente (journey).
  const [viewMode, setViewMode] = useState<'list' | 'journey'>('list');
  const [journeyPatientKey, setJourneyPatientKey] = useState<string | null>(null);

  // Búsqueda CROSS-fecha (Lista): con término, se pide al server TODO el histórico que matchea (no solo
  // el rango cargado) → resuelve que un paciente cuyo traslado es de otro día "no aparecía". searchResults
  // = null → sin búsqueda server activa (se usa el filtro local del rango). Debounce 350ms.
  const [searchResults, setSearchResults] = useState<Ticket[] | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const term = searchTerm.trim();
    if (viewMode !== 'list' || !term || !onSearchHistory) { setSearchResults(null); setSearching(false); return; }
    setSearching(true);
    let alive = true;
    const h = setTimeout(async () => {
      const res = await onSearchHistory(term);
      if (!alive) return;
      setSearchResults(res);
      setSearching(false);
    }, 350);
    return () => { alive = false; clearTimeout(h); };
  }, [searchTerm, viewMode, onSearchHistory]);

  // Agrupa TODOS los tickets de la sede por paciente (código Gamma, fallback nombre).
  // Incluye activos + históricos para que la trayectoria sea una historia completa.
  const patientGroups = useMemo(() => {
    const norm = (s: string) => s.trim().toLowerCase();
    const map = new Map<string, { key: string; name: string; code?: string; tickets: Ticket[] }>();
    for (const t of tickets) {
      const code = t.patientCode?.trim();
      const key = code ? `c:${code}` : `n:${norm(t.patientName)}`;
      let g = map.get(key);
      if (!g) { g = { key, name: t.patientName, code: code || undefined, tickets: [] }; map.set(key, g); }
      g.tickets.push(t);
      if (!g.code && code) g.code = code;
    }
    return [...map.values()];
  }, [tickets]);

  // Trayectoria: opciones del combobox "Seleccionar paciente" (pacientes únicos ya en
  // memoria — sin fetch aparte). Label = nombre · #código · habitación actual; el buscador
  // interno del Combobox (cmdk) busca también en el label (así se puede tipear la habitación).
  // Habitación actual = destino (o, si falta, origen) del ticket más reciente por createdAt.
  // Orden alfabético para un default legible.
  const patientOptions = useMemo(
    () => patientGroups
      .map(g => {
        const latest = [...g.tickets].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        const room = formatBedName(latest && (latest.destination || latest.origin) || '');
        const parts = [g.name];
        if (g.code) parts.push(`#${g.code}`);
        if (room) parts.push(room);
        return { value: g.key, label: parts.join(' · ') };
      })
      .sort((a, b) => a.label.localeCompare(b.label)),
    [patientGroups],
  );

  // Trayectoria: al elegir un paciente traemos su historia COMPLETA por código (patientCode),
  // independiente del rango cargado en la lista. Sin código (tickets manuales/legacy) caemos a lo
  // que hay en memoria del grupo. Así la trayectoria no queda recortada por Desde/Hasta.
  const [journeyTickets, setJourneyTickets] = useState<Ticket[]>([]);
  useEffect(() => {
    if (!journeyPatientKey) { setJourneyTickets([]); return; }
    const group = patientGroups.find(g => g.key === journeyPatientKey);
    if (!group) { setJourneyTickets([]); return; }
    if (group.code && onFetchPatientTickets) {
      let cancelled = false;
      setJourneyTickets(group.tickets); // muestra lo que hay mientras llega la historia completa
      onFetchPatientTickets(group.code)
        .then(ts => { if (!cancelled && ts.length) setJourneyTickets(ts); })
        .catch(() => { /* deja el fallback en memoria */ });
      return () => { cancelled = true; };
    }
    setJourneyTickets(group.tickets);
  }, [journeyPatientKey, patientGroups, onFetchPatientTickets]);
  // Cama donde PROGAL tiene HOY al paciente de la Trayectoria (null = no figura internado; undefined = sin
  // mapa o sin código, no se sabe).
  const journeyUbicacion = useMemo((): string | null | undefined => {
    const code = journeyTickets.find(t => t.patientCode)?.patientCode?.trim();
    if (!code || !beds?.length) return undefined;
    return beds.find(b => b.status === BedStatus.OCCUPIED && String(b.patientCode ?? '').trim() === code)?.label ?? null;
  }, [journeyTickets, beds]);

  const filteredHistory = useMemo(() => {
    // Con búsqueda CROSS-fecha resuelta usamos esos resultados (el server ya filtró por nombre/ID en
    // TODO el histórico); si no, el set del rango cargado.
    const searchingMode = searchResults !== null;
    const base = searchingMode ? searchResults : tickets;
    return base
      .filter(t => t.status === TicketStatus.COMPLETED || t.status === TicketStatus.REJECTED)
      .filter(t => {
        if (statusFilter === 'completed') return t.status === TicketStatus.COMPLETED;
        if (statusFilter === 'cancelled') return t.status === TicketStatus.REJECTED;
        return true;
      })
      .filter(t => {
        if (searchingMode) return true; // el server ya filtró por nombre/ID; sin filtro de fecha
        // Sin búsqueda cross-fecha: filtro local por término DENTRO del rango cargado + rango de fechas.
        const matchesSearch = searchTerm
          ? t.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            t.id.toLowerCase().includes(searchTerm.toLowerCase())
          : true;
        if (!matchesSearch) return false;
        const ticketDate = (t.date || '').slice(0, 10);
        const matchesStart = startDate ? ticketDate >= startDate : true;
        const matchesEnd = endDate ? ticketDate <= endDate : true;
        return matchesStart && matchesEnd;
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [tickets, searchResults, startDate, endDate, searchTerm, statusFilter]);

  // Conteo del botón Filtros: resultado y período distinto de hoy (el buscador tiene su propia X).
  // "Limpiar" de la barra sigue siendo clearFilters: vuelve todo al default.
  const filtrosActivos = (statusFilter !== 'all' ? 1 : 0) + (startDate !== todayISO || endDate !== todayISO ? 1 : 0);

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
      const eventsPerTicket = new Map<string, { tipo: string; fecha: string; usuario: string; operador?: string }[]>();
      const BATCH_SIZE = 10;
      for (let i = 0; i < filteredHistory.length; i += BATCH_SIZE) {
        const batch = filteredHistory.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map(t =>
          fetch(`/api/ticket-events?ticketId=${encodeURIComponent(t.id)}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          })
            .then(r => r.ok ? r.json() : { events: [] })
            .then((d: { events?: { tipo: string; fecha: string; usuario: string; operador?: string }[] }) =>
              [t.id, d.events ?? []] as const
            )
            .catch(() => [t.id, [] as { tipo: string; fecha: string; usuario: string; operador?: string }[]] as const)
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
          "Creado por": t.operador || t.createdBy || '',
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
            "Usuario": evt.operador || evt.usuario || '',
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


  // ── Presentación (DESIGN §4.4, §5.2 y §7) ──────────────────────────────────

  // Período: puente entre el DateRangePicker (Date) y las fechas "YYYY-MM-DD" que pide el hook. Con un
  // solo día elegido, el rango es ese día. "Limpiar" del calendario vuelve a hoy (el default de la vista).
  const rango: DateRange = { from: deIso(startDate), to: deIso(endDate) };
  const cambiarRango = (r?: DateRange) => {
    if (!r?.from) { setStartDate(todayISO); setEndDate(todayISO); return; }
    setStartDate(aIso(r.from));
    setEndDate(aIso(r.to ?? r.from));
  };

  // Con texto en el buscador la Lista muestra lo que trajo el server de TODO el histórico (sin período).
  const buscandoTodo = searchResults !== null;
  const desde = fecha(deIso(startDate) ?? new Date());
  const hasta = fecha(deIso(endDate) ?? new Date());
  // El histórico no tiene un estado de error propio (el hook deja lo previo si falla): mientras recarga
  // y no hay nada para mostrar, va el loader en vez de "sin traslados".
  const cargandoLista = !!refreshing && filteredHistory.length === 0;

  const botonAuditar = (t: Ticket) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Auditar el traslado de ${t.patientName}`}
          // La fila también abre la auditoría: sin esto se abriría dos veces el mismo ticket.
          onClick={(e) => { e.stopPropagation(); setSelectedTicketForAudit(t); }}
        >
          <FileSearch className="size-4" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Auditar</TooltipContent>
    </Tooltip>
  );

  // Columnas AGRUPADAS (DESIGN §7.2 "2 líneas" + §5.4 disclosure progresivo): valor arriba y metadato
  // `text-[10px] text-muted-foreground` abajo. El tipo de traslado es secundario (aparece desde lg).
  const columnas: Columna<Ticket>[] = [
    {
      id: 'fecha',
      titulo: 'Fecha',
      ordenar: (t) => t.createdAt || '',
      clase: 'whitespace-nowrap',
      celda: (t) => (
        <div className="flex flex-col gap-0.5">
          <span className="tabular-nums">{fechaHoraSegura(t.createdAt)}</span>
          <span className="text-[10px] text-muted-foreground tabular-nums">Ciclo total {numero(calculateTicketMetrics(t).totalCycleTime)} min</span>
        </div>
      ),
    },
    {
      id: 'paciente',
      titulo: 'Paciente',
      ordenar: (t) => t.patientName,
      celda: (t) => (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{t.patientName}</span>
            <PillUrgencia ticket={t} />
          </div>
          <span className="font-mono text-[10px] text-muted-foreground">{t.id}</span>
        </div>
      ),
    },
    {
      id: 'traslado',
      titulo: 'Traslado',
      ordenar: (t) => t.origin,
      celda: (t) => (
        <div className="flex max-w-[260px] flex-col gap-0.5">
          <span className="leading-tight wrap-break-word text-muted-foreground">{formatBedName(t.origin)}</span>
          <span className="flex items-start gap-1 leading-tight">
            <ArrowRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t.destination
              ? <span className="font-medium wrap-break-word">{formatBedName(t.destination)}</span>
              : <span className="text-muted-foreground">Sin destino</span>}
          </span>
        </div>
      ),
    },
    {
      id: 'tipo',
      titulo: 'Tipo',
      ocultarEn: 'md',
      ordenar: (t) => WORKFLOW_LABELS[t.workflow] ?? '',
      celda: (t) => <Badge variant="outline" className="px-2 py-0 text-[10px] font-medium">{WORKFLOW_LABELS[t.workflow]}</Badge>,
    },
    {
      id: 'resultado',
      titulo: 'Resultado',
      ordenar: (t) => ESTADOS_TICKET[t.status].label,
      clase: 'whitespace-nowrap',
      celda: (t) => (
        <div className="flex flex-col items-start gap-1">
          <Resultado ticket={t} />
          {t.completedAt && <span className="text-[10px] text-muted-foreground tabular-nums">{fechaHoraSegura(t.completedAt)}</span>}
        </div>
      ),
    },
    {
      id: 'acciones',
      titulo: 'Acciones',
      alinear: 'der',
      celda: (t) => botonAuditar(t),
    },
  ];

  // Card mobile de fila (DESIGN §5.4b): identidad + resultado arriba, el traslado al medio y el pie con el
  // ciclo. Toda la tarjeta abre la auditoría (como antes).
  const tarjeta = (t: Ticket) => (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{t.patientName}</span>
            <PillUrgencia ticket={t} />
          </div>
          <div className="font-mono text-[10px] break-all text-muted-foreground">{t.id}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Resultado ticket={t} />
          <span className="text-[10px] text-muted-foreground tabular-nums">{fechaHoraSegura(t.createdAt)}</span>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 rounded-md bg-muted/40 p-2.5">
        <div className="min-w-0">
          <p className="mb-0.5 text-[10px] tracking-wider text-muted-foreground uppercase">Origen</p>
          <p className="text-[13px] leading-tight font-medium wrap-break-word">{formatBedName(t.origin)}</p>
        </div>
        <ArrowRight className="mt-4 size-4 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 text-right">
          <p className="mb-0.5 text-[10px] tracking-wider text-muted-foreground uppercase">Destino</p>
          <p className="text-[13px] leading-tight font-medium wrap-break-word">{formatTicketDestination(t)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1 tabular-nums">
          <Clock className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">Ciclo total {numero(calculateTicketMetrics(t).totalCycleTime)} min · {WORKFLOW_LABELS[t.workflow]}</span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-foreground">
          Auditar <ChevronRight className="size-3.5" aria-hidden="true" />
        </span>
      </div>
    </div>
  );

  return (
    <div className="flex w-full flex-col gap-4 p-3 md:p-8">
      {/* HEADER + TOOLBAR (DESIGN §4.4 y §5.2) */}
      <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="hidden shrink-0 md:block">
          <h2 className="text-2xl font-bold tracking-tight">Historial</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {viewMode === 'journey' ? (<>
              <span className="font-medium text-foreground tabular-nums">{patientOptions.length}</span> pacientes para elegir · trayectoria completa por paciente
            </>) : buscandoTodo ? (<>
              <span className="font-medium text-foreground tabular-nums">{filteredHistory.length}</span> resultados en todo el histórico
            </>) : (<>
              <span className="font-medium text-foreground tabular-nums">{filteredHistory.length}</span> cerrados · {desde === hasta ? desde : `${desde} – ${hasta}`}
            </>)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {viewMode === 'list' ? (<>
            {/* Buscador de la Lista: paciente o ID, en TODO el histórico (debounce + spinner mientras busca). */}
            <div className="relative min-w-[7rem] flex-1 sm:w-56 sm:flex-none">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                placeholder="Paciente o ID…"
                aria-label="Buscar por paciente o ID de ticket"
                className="h-9 pr-8 pl-8 text-sm"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
              {searching ? (
                <span role="status" aria-label="Buscando en todo el histórico" className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                </span>
              ) : searchTerm ? (
                <button type="button" onClick={() => setSearchTerm('')} aria-label="Limpiar búsqueda" className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
            {/* Período (filtro de una dimensión, inline en la toolbar §5.2). En mobile baja a su propia línea. */}
            <span id="hist-periodo" className="sr-only">Período, por fecha del traslado</span>
            <DateRangePicker value={rango} onChange={cambiarRango} aria-describedby="hist-periodo" className="order-last h-9 w-full sm:order-none sm:w-auto" />
            {/* aria-label: en mobile el botón queda solo con íconos (el texto es `hidden sm:inline`). */}
            <BotonFiltros abierto={verFiltros} activos={filtrosActivos} onClick={() => setVerFiltros(v => !v)} aria-label="Filtros" />
            <Button
              type="button"
              variant="outline"
              onClick={handleExportExcel}
              disabled={exporting || filteredHistory.length === 0}
              aria-label="Exportar a Excel"
              className="h-9 shrink-0 gap-1.5 px-3"
            >
              {exporting ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Download className="size-3.5" aria-hidden="true" />}
              <span className="hidden sm:inline">{exporting ? 'Generando…' : 'Excel'}</span>
            </Button>
          </>) : (
            // Trayectoria: el buscador es el selector de paciente (pacientes únicos ya en memoria; busca
            // también por código y habitación).
            <div className="min-w-[7rem] flex-1 sm:w-80 sm:flex-none">
              <Combobox obligatorio
                opciones={patientOptions}
                value={journeyPatientKey ?? ''}
                onChange={key => setJourneyPatientKey(key)}
                placeholder="Seleccionar paciente"
                buscar="Buscar paciente…"
                aria-label="Paciente"
                className="h-9"
              />
            </div>
          )}
          {/* El histórico ya no se pollea: se carga al entrar y se refresca desde acá. */}
          {onRefresh && (
            <Button type="button" variant="outline" onClick={() => onRefresh()} disabled={refreshing} aria-label="Actualizar" className="h-9 shrink-0 gap-1.5 px-3">
              <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} aria-hidden="true" />
              <span className="hidden sm:inline">Actualizar</span>
            </Button>
          )}
        </div>
      </div>

      {/* Modos de la vista: control segmentado (§6.6). */}
      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'list' | 'journey')}>
        <TabsList aria-label="Lista de traslados o trayectoria de un paciente">
          <TabsTrigger value="list"><ClipboardList aria-hidden="true" /> Lista</TabsTrigger>
          <TabsTrigger value="journey"><History aria-hidden="true" /> Trayectoria</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* FILTROS (DESIGN §4.7): barra inline, no un modal. "Limpiar" vuelve todo al default (hoy, todos). */}
      {viewMode === 'list' && verFiltros && (
        <BarraFiltros activos={filtrosActivos} onLimpiar={clearFilters}>
          <CampoFiltro icono={CircleDot} label="Resultado">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-full" aria-label="Resultado"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="completed">Consolidados</SelectItem>
                <SelectItem value="cancelled">Cancelados</SelectItem>
              </SelectContent>
            </Select>
          </CampoFiltro>
        </BarraFiltros>
      )}

      {/* ── Modo Trayectoria: el cuerpo solo invita a elegir; al elegir se abre PatientJourney, que recién
          ahí fetchea los movimientos de ESE paciente. */}
      {viewMode === 'journey' && (
        refreshing && patientOptions.length === 0 ? (
          <Cargando texto="Cargando pacientes…" />
        ) : (
          <Vacio
            icono={History}
            titulo={patientOptions.length ? 'Elegí un paciente' : 'Sin pacientes para elegir'}
            descripcion={patientOptions.length
              ? 'Buscalo por nombre, código o habitación en el selector de arriba para ver todos sus traslados y cirugías.'
              : 'Todavía no hay traslados cargados. Probá con Actualizar.'}
          />
        )
      )}

      {/* ── Modo Lista: tabla (desktop) + cards (mobile) sobre el mismo array (§4.4, §7.1) ── */}
      {viewMode === 'list' && (<>
        {buscandoTodo && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>Resultados de todo el histórico: mientras haya texto en el buscador, el período no aplica.</span>
          </p>
        )}
        <DataTable
          filas={filteredHistory}
          columnas={columnas}
          clave={(t) => t.id}
          tarjeta={tarjeta}
          onFila={setSelectedTicketForAudit}
          cargando={cargandoLista}
          claseFila={(t) => (t.status === TicketStatus.REJECTED ? 'bg-red-50/40' : undefined)}
          vacio={
            <Vacio
              icono={searchTerm ? Search : History}
              titulo={searchTerm ? 'Sin resultados para la búsqueda' : 'Sin traslados cerrados en el período'}
              descripcion={searchTerm
                ? 'Buscamos en todo el histórico. Probá con otro nombre o ID.'
                : statusFilter !== 'all'
                  ? 'Probá con otro período o con todos los resultados.'
                  : 'Probá con otro período.'}
            />
          }
        />
      </>)}

      <AuditModal
        ticket={selectedTicketForAudit}
        isOpen={!!selectedTicketForAudit}
        onClose={() => setSelectedTicketForAudit(null)}
        workflowLabels={WORKFLOW_LABELS}
      />

      <PatientJourney
        patientTickets={journeyTickets}
        ubicacionProgal={journeyUbicacion}
        isOpen={!!journeyPatientKey}
        onClose={() => setJourneyPatientKey(null)}
        workflowLabels={WORKFLOW_LABELS}
      />
    </div>
  );
};
