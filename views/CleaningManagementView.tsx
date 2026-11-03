import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Bed, User, Area } from '../types';
import { can } from '../lib/permissions';
import { cn, formatBedName, normalizeText } from '../lib/utils';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { DataTable, type Columna } from '../components/ui/data-table';
import { Vacio } from '../components/ui/estados';
import { StatusBadge } from '../components/ui/status-badge';
import { BarraFiltros, BotonFiltros, CampoFiltro } from '../components/ui/filtros';
import { DatePicker } from '../components/ui/date-picker';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { aIso, deIso } from '../lib/fechaIso';
import { fecha, fechaHora } from '../lib/formato';
import { esCancelada, estadoRutina, motivoCierre } from '../lib/estados-limpieza';
import { RejectionModal } from '../components/modals/RejectionModal';
import { AlertCircle, CalendarDays, CheckCircle2, Clock, DoorClosed, Info, RefreshCw, Search, SprayCan, User as UserIcon, X, XCircle } from 'lucide-react';

// ponytail: display map copiado de BedsView (no está exportado); exportar si un 3er lugar lo necesita.
const AREA_LABELS: Record<string, string> = {
  [Area.PISO_4]: 'Piso 4', [Area.PISO_5]: 'Piso 5', [Area.PISO_6]: 'Piso 6',
  [Area.PISO_7]: 'Piso 7', [Area.PISO_8]: 'Piso 8',
  [Area.HIT]: 'ITR', [Area.HRA]: 'Sala Espera', [Area.HSS]: 'Sueño',
  [Area.HUC]: 'UCO', [Area.HUQ]: 'URP', [Area.HUT]: 'UTI',
};
const areaLabel = (a?: string) => (a ? AREA_LABELS[a] ?? a : '—');

// Fecha y hora con el formato de la app (lib/formato). Una fecha que no se puede leer sale tal cual
// (fechaHora tira con una fecha inválida y la lista vendría de SharePoint).
const cuando = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : fechaHora(d);
};
// "YYYY-MM-DD" de los filtros → "3 nov 2026" para el subtítulo.
const diaLegible = (s: string) => { const d = deIso(s); return d ? fecha(d) : s; };

// Botones de acción dentro de una fila de la tabla (igual que Traslados).
const BOTON_FILA = 'h-8 gap-1.5 px-3 text-xs';

interface Props {
  beds: Bed[];
  currentUser: User | null;
  onConsolidate: (bedLabel: string) => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  /** Cancelar una limpieza de rutina con observación (permiso limpieza_rutina_cancelar). */
  onCancelRutina?: (id: string, motivo: string) => Promise<{ ok: boolean; error?: string }>;
  /** Cancelar una limpieza ACTIVA (sin consolidar) con observación (mismo permiso). */
  onCancelLimpieza?: (bedLabel: string, observacion: string) => Promise<{ ok: boolean; error?: string }>;
}

export const CleaningManagementView: React.FC<Props> = ({ beds, currentUser, onConsolidate, onRefresh, onCancelRutina, onCancelLimpieza }) => {
  // Limpiezas activas = camas con overlay `cleaned` vigente (mergeBeds). Respeta el filtro
  // por áreas del usuario (misma regla que el botón "Marcar limpia" de BedsView).
  const rows = useMemo(() => {
    const areaOk = (area: string) =>
      !currentUser?.filterByFloors
      || !currentUser?.assignedAreas?.length
      || currentUser.assignedAreas.includes(area as Area);
    return beds
      .filter(b => b.cleaned && areaOk(b.area))
      .sort((a, b) => String(b.cleanedAt ?? '').localeCompare(String(a.cleanedAt ?? '')));
  }, [beds, currentUser]);

  // Consolidar pide confirmación (Dialog). Optimista: al confirmar, la fila desaparece sola
  // (useHospitalState quita la limpieza del estado y mergeBeds recomputa). `pending` deshabilita
  // el botón mientras el PATCH viaja; `confirmBed` guarda la cama en revisión.
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [confirmBed, setConfirmBed] = useState<Bed | null>(null);
  // Solo los roles con el permiso pueden consolidar; el resto ve la lista en solo-lectura.
  const canConsolidate = can(currentUser, 'consolidar_limpieza');
  // "Cancelar" una limpieza activa (marcada limpia por error), con observación (30/10/2026).
  const canCancelActiva = !!onCancelLimpieza && can(currentUser, 'limpieza_rutina_cancelar');
  const [cancelandoActiva, setCancelandoActiva] = useState<Bed | null>(null);
  const [cancelActivaError, setCancelActivaError] = useState<string | null>(null);
  const consolidate = (label: string) => {
    setPending(p => new Set(p).add(label));
    setConfirmBed(null);
    Promise.resolve(onConsolidate(label)).finally(() =>
      setPending(p => { const n = new Set(p); n.delete(label); return n; }));
  };

  // ── Histórico (limpiezas cerradas) ─────────────────────────────────────────
  type HistRow = { spItemId: string; bedLabel: string; area: string; by: string; operador?: string; at: string; closedAt: string; reason: string };
  const [tab, setTab] = useState<'activas' | 'historico' | 'rutina'>('activas');
  const todayStr   = new Date().toISOString().slice(0, 10);
  const weekAgoStr = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const [from, setFrom] = useState(weekAgoStr);
  const [to, setTo]     = useState(todayStr);
  const [history, setHistory] = useState<HistRow[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);
  // La última carga falló (DESIGN §9 / regla del repo "fallas visibles"): solo para mostrarlo; la
  // lista sigue con lo que tenía.
  const [errorHist, setErrorHist] = useState(false);

  const authFetch = useCallback((url: string) => {
    const token = localStorage.getItem('mediflow_token');
    return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  }, []);

  const fetchHistory = useCallback(async () => {
    setLoadingHist(true);
    try {
      const r = await authFetch(`/api/limpiezas?history=1&from=${from}&to=${to}`);
      if (r.ok) {
        const data = await r.json();
        const areaOk = (area: string) =>
          !currentUser?.filterByFloors || !currentUser?.assignedAreas?.length || currentUser.assignedAreas.includes(area as Area);
        const rows: HistRow[] = (data.cleanings ?? [])
          .filter((c: HistRow) => areaOk(c.area))
          .sort((a: HistRow, b: HistRow) => String(b.closedAt).localeCompare(String(a.closedAt)));
        setHistory(rows);
        setErrorHist(false);
      } else setErrorHist(true);
    } catch { setErrorHist(true); /* mantiene lo previo */ }
    finally { setLoadingHist(false); }
  }, [authFetch, from, to, currentUser]);

  // Auto-carga al entrar al histórico y al cambiar las fechas.
  useEffect(() => { if (tab === 'historico') fetchHistory(); }, [tab, fetchHistory]);

  // ── Rutina del día (limpiezas de rutina de camas ocupadas) ─────────────────
  type RoutineRow = { spItemId: string; bedLabel: string; area: string; patientName: string; startedBy: string; operador?: string; startedAt: string; finishedBy: string; finishedAt: string; estado: string; motivoAnulacion?: string };
  // "Cancelar" (30/10/2026): misma estética que cancelar un traslado (RejectionModal), observación obligatoria.
  const canCancelRutina = !!onCancelRutina && can(currentUser, 'limpieza_rutina_cancelar');
  const [cancelandoRutina, setCancelandoRutina] = useState<RoutineRow | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // Solo las EN CURSO: una finalizada no se cancela (pedido del usuario, 30/10/2026).
  const cancelable = (x: RoutineRow) => canCancelRutina && x.estado === 'INICIADA';
  const [routineDate, setRoutineDate] = useState(todayStr);
  const [routineRows, setRoutineRows] = useState<RoutineRow[]>([]);
  const [loadingRoutine, setLoadingRoutine] = useState(false);
  const [errorRoutine, setErrorRoutine] = useState(false); // igual que errorHist: solo para mostrarlo

  const fetchRoutine = useCallback(async () => {
    setLoadingRoutine(true);
    try {
      const r = await authFetch(`/api/limpiezas-rutina?report=1&date=${routineDate}`);
      if (r.ok) {
        const data = await r.json();
        const areaOk = (area: string) =>
          !currentUser?.filterByFloors || !currentUser?.assignedAreas?.length || currentUser.assignedAreas.includes(area as Area);
        // Orden por piso → habitación → hora de inicio (como se pidió para los reportes).
        const rows: RoutineRow[] = (data.rutinas ?? [])
          .filter((x: RoutineRow) => areaOk(x.area))
          .sort((a: RoutineRow, b: RoutineRow) =>
            areaLabel(a.area).localeCompare(areaLabel(b.area), 'es', { numeric: true }) ||
            formatBedName(a.bedLabel).localeCompare(formatBedName(b.bedLabel), 'es', { numeric: true }) ||
            String(a.startedAt).localeCompare(String(b.startedAt)));
        setRoutineRows(rows);
        setErrorRoutine(false);
      } else setErrorRoutine(true);
    } catch { setErrorRoutine(true); /* mantiene lo previo */ }
    finally { setLoadingRoutine(false); }
  }, [authFetch, routineDate, currentUser]);

  const confirmarCancelRutina = async (motivo: string) => {
    const x = cancelandoRutina;
    if (!x || !onCancelRutina) return;
    setCancelError(null);
    const r = await onCancelRutina(x.spItemId, motivo);
    if (r.ok) fetchRoutine(); else setCancelError(r.error ?? 'No se pudo cancelar.');
  };

  // Auto-carga al entrar a Rutina y al cambiar el día.
  useEffect(() => { if (tab === 'rutina') fetchRoutine(); }, [tab, fetchRoutine]);

  // Motivo de cierre → rótulo y tono (lib/estados-limpieza.ts). IMPORTANTE: TICKET y GAMMA son cosas
  // DISTINTAS y antes se colapsaban ambas en "Traslado" — eso hacía que un cierre GAMMA (PROGAL avanzó la
  // cama por fuera de la app, SIN traslado) figurara como "cerrada por Traslado" y se reportara como bug.
  //   TICKET = un traslado de la app tomó la cama (sí hubo traslado).
  //   GAMMA  = PROGAL avanzó el estado de la cama (se liberó/reasignó en el sistema, sin traslado en la app).
  //   SUCIA  = "Volver a En preparación": se había pasado a limpia y estaba sucia (rollback, 29/10/2026).
  //   CANCELADA: <observación> — <quién> (30/10/2026): el texto viaja en el mismo motivo_cierre.
  const reasonLabel = (r: string) => motivoCierre(r).label;
  // Explicación del motivo (tooltip en desktop, texto en la card mobile). "Traslado" (TICKET) son DOS
  // cosas que comparten rótulo:
  //   · nació cerrada (limpia == cerrada): es la constancia de "Habitación lista" de un traslado;
  //   · se marcó limpia a mano y quedó sin consolidar en PROGAL; después un traslado tomó la cama y la app la cerró
  //     sola. No es que "se limpió en un traslado" (consulta del 29/10/2026, cama 523).
  const reasonTitle = (h: { reason: string; at: string; closedAt: string }): string | undefined => {
    if (h.reason === 'TICKET') {
      return h.at && h.at === h.closedAt
        ? 'Constancia de "Habitación lista": la azafata preparó esta cama como destino de un traslado.'
        : 'No se limpió en un traslado: se marcó limpia, no se consolidó en PROGAL y después un traslado tomó la cama, así que la limpieza se cerró sola por ese traslado (buscalo en Historial por la cama y la hora de cierre).';
    }
    if (esCancelada(h.reason)) return `Se canceló (estaba marcada limpia por error): ${h.reason.replace(/^CANCELADA:\s*/, '')}`;
    if (h.reason === 'SUCIA') return 'Se había pasado a limpia y estaba sucia: volvió a "En preparación" (rollback).';
    if (h.reason === 'GAMMA') return 'PROGAL cambió el estado de la cama por fuera de la app.';
    if (h.reason === 'ANULADA') return 'La marca de limpia se deshizo.';
    if (h.reason === 'CONSOLIDADO') return 'Admisión la consolidó en PROGAL.';
    return undefined;
  };

  // ── Buscador (aplica a Activas e Histórico) ────────────────────────────────
  // Mismo criterio que el buscador de comandas: se indexa cada fila una vez y la búsqueda
  // es frase-exacta primero, AND de términos como fallback. Sin el paso de frase, "piso 5"
  // se parte en ["piso","5"] y trae camas del Piso 4 (el "5" matchea el 405 del label).
  //
  // Se indexan también las formas SIN espacios del sector y de la cama para poder tipear
  // "piso5" o "401-02" de corrido.
  const [searchFilter, setSearchFilter] = useState('');
  const query = normalizeText(searchFilter);
  const terms = query.split(' ').filter(Boolean);
  const buscando = terms.length > 0;

  const bedHaystack = (label: string, area: string, ...extra: (string | undefined)[]) => normalizeText([
    label, formatBedName(label), formatBedName(label).replace(/[\s-]/g, ''),
    area, areaLabel(area), areaLabel(area).replace(/\s+/g, ''),
    ...extra,
  ].join(' '));

  const indexedRows = useMemo(
    () => rows.map(b => ({ r: b, h: bedHaystack(b.label, b.area, b.cleanedBy) })),
    [rows]);
  const indexedHistory = useMemo(
    () => history.map(h => ({ r: h, h: bedHaystack(h.bedLabel, h.area, `${h.by} ${h.operador ?? ''}`, reasonLabel(h.reason)) })),
    [history]); // eslint-disable-line react-hooks/exhaustive-deps

  function applySearch<T>(indexed: { r: T; h: string }[]): T[] {
    if (!buscando) return indexed.map(({ r }) => r);
    const porFrase = indexed.filter(({ h }) => h.includes(query));
    if (porFrase.length > 0) return porFrase.map(({ r }) => r);
    return indexed.filter(({ h }) => terms.every(t => h.includes(t))).map(({ r }) => r);
  }

  const visibleRows    = applySearch(indexedRows);
  const visibleHistory = applySearch(indexedHistory);

  // Barra de filtros (§4.7): las fechas del Histórico y el día de Rutina. Abierta de entrada desde tablet
  // (se ve qué rango se está mirando); en el celular arranca cerrada para no empujar la lista.
  const [verFiltros, setVerFiltros] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768);
  // Un filtro "activo" es una fecha distinta de la de entrada; "Limpiar" vuelve a esas fechas.
  const filtrosActivos = tab === 'historico'
    ? (from !== weekAgoStr ? 1 : 0) + (to !== todayStr ? 1 : 0)
    : tab === 'rutina' ? (routineDate !== todayStr ? 1 : 0) : 0;
  const limpiarFiltros = () => {
    if (tab === 'historico') { setFrom(weekAgoStr); setTo(todayStr); }
    else if (tab === 'rutina') setRoutineDate(todayStr);
  };

  // "Actualizar" de la toolbar: cada solapa refresca lo suyo.
  const actualizando = tab === 'historico' ? loadingHist : tab === 'rutina' ? loadingRoutine : false;
  const actualizar = tab === 'historico' ? () => fetchHistory()
    : tab === 'rutina' ? () => fetchRoutine()
    : onRefresh ? () => onRefresh() : undefined;

  // ── Piezas compartidas por las tres listas ─────────────────────────────────

  // Celda de cama (DESIGN §7.2 "2 líneas"): la cama arriba, el sector abajo.
  const celdaCama = (cama: string, area: string, extra?: string) => (
    <div className="flex flex-col">
      <span className="font-medium">{cama}</span>
      <span className="text-[10px] text-muted-foreground">{areaLabel(area)}{extra ? ` · ${extra}` : ''}</span>
    </div>
  );

  // Acción de una fila (§7.6), como en Traslados: en desktop, botón-ícono `ghost` con tooltip; en mobile,
  // botón a lo ancho con texto (es la card entera).
  const accionSecundaria = (icono: React.ReactNode, label: string, onClick: () => void, isMobile: boolean, peligro = false) => isMobile ? (
    <Button type="button" variant="outline" className={cn('w-full', peligro && 'text-destructive hover:bg-destructive/10 hover:text-destructive')} onClick={onClick}>
      {icono} {label}
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
          className={cn('text-muted-foreground', peligro ? 'hover:bg-destructive/10 hover:text-destructive' : 'hover:text-foreground')}
        >
          {icono}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  // Pill del motivo de cierre. La explicación sale en un tooltip del kit (abre con el mouse y con el foco del
  // teclado; va en un portal, así que el overflow de la tabla no lo recorta). En el celular no hay hover: la
  // card mobile muestra la explicación como texto debajo.
  const pillMotivo = (h: HistRow) => {
    const m = motivoCierre(h.reason);
    const explicacion = reasonTitle(h);
    if (!explicacion) return <StatusBadge tono={m.tono}>{m.label}</StatusBadge>;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} aria-label={`${m.label}: ${explicacion}`} className="inline-flex cursor-help rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
            <StatusBadge tono={m.tono}>{m.label}<Info className="size-3 opacity-60" aria-hidden="true" /></StatusBadge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="left">{explicacion}</TooltipContent>
      </Tooltip>
    );
  };

  // Banner suave de error (DESIGN §9.4), el mismo para las cancelaciones y las cargas fallidas.
  const bannerError = (texto: React.ReactNode) => (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{texto}</span>
    </div>
  );

  // ── Activas ────────────────────────────────────────────────────────────────
  const accionesActiva = (bed: Bed, isMobile = false) => {
    const consolidar = canConsolidate && (
      <Button type="button" size={isMobile ? 'default' : 'sm'} className={isMobile ? 'w-full' : BOTON_FILA}
        onClick={() => setConfirmBed(bed)} disabled={pending.has(bed.label)}>
        <DoorClosed /> Consolidado PROGAL
      </Button>
    );
    const cancelar = canCancelActiva && accionSecundaria(<XCircle className="size-4" />, 'Cancelar', () => { setCancelActivaError(null); setCancelandoActiva(bed); }, isMobile, true);
    if (isMobile) return (consolidar || cancelar) ? <div className="flex flex-col gap-2 border-t pt-3">{consolidar}{cancelar}</div> : null;
    if (!consolidar && !cancelar) return <span className="text-xs text-muted-foreground">Sin permiso</span>;
    return <div className="flex items-center justify-end gap-1">{consolidar}{cancelar}</div>;
  };

  const columnasActivas: Columna<Bed>[] = [
    { id: 'cama', titulo: 'Cama', ordenar: (b) => b.label, celda: (b) => celdaCama(b.label, b.area) },
    {
      id: 'limpia',
      titulo: 'Marcada limpia',
      ordenar: (b) => String(b.cleanedAt ?? ''),
      celda: (b) => (
        <div className="flex flex-col">
          <span className="tabular-nums">{cuando(b.cleanedAt)}</span>
          <span className="text-[10px] text-muted-foreground">por {b.cleanedBy || '—'}</span>
        </div>
      ),
    },
    { id: 'acciones', titulo: 'Acciones', alinear: 'der', celda: (b) => accionesActiva(b) },
  ];

  // Card mobile (§5.4b): cama + sector arriba, quién y cuándo, acciones al pie.
  const tarjetaActiva = (bed: Bed) => (
    <div className="flex flex-col gap-3">
      {celdaCama(bed.label, bed.area)}
      <div className="space-y-1 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5"><UserIcon className="size-3.5 shrink-0" aria-hidden="true" />{bed.cleanedBy || '—'}</p>
        <p className="flex items-center gap-1.5 tabular-nums"><Clock className="size-3.5 shrink-0" aria-hidden="true" />{cuando(bed.cleanedAt)}</p>
      </div>
      {accionesActiva(bed, true)}
    </div>
  );

  // ── Histórico ──────────────────────────────────────────────────────────────
  const columnasHistorico: Columna<HistRow>[] = [
    { id: 'cama', titulo: 'Cama', ordenar: (h) => h.bedLabel, celda: (h) => celdaCama(h.bedLabel, h.area) },
    {
      id: 'por',
      titulo: 'Marcada por',
      celda: (h) => (
        <div className="flex flex-col">
          <span>{h.operador || h.by || '—'}</span>
          {h.operador && h.by && <span className="text-[10px] text-muted-foreground">{h.by}</span>}
        </div>
      ),
    },
    {
      id: 'cierre',
      titulo: 'Cerrada',
      ordenar: (h) => String(h.closedAt),
      celda: (h) => (
        <div className="flex flex-col">
          <span className="tabular-nums">{cuando(h.closedAt)}</span>
          <span className="text-[10px] text-muted-foreground tabular-nums">Limpia: {cuando(h.at)}</span>
        </div>
      ),
    },
    { id: 'motivo', titulo: 'Motivo', celda: (h) => pillMotivo(h) },
  ];

  const tarjetaHistorico = (h: HistRow) => {
    const m = motivoCierre(h.reason);
    const explicacion = reasonTitle(h);
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          {celdaCama(h.bedLabel, h.area)}
          <StatusBadge tono={m.tono}>{m.label}</StatusBadge>
        </div>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5"><UserIcon className="size-3.5 shrink-0" aria-hidden="true" />{h.operador ? `${h.operador}${h.by ? ` · ${h.by}` : ''}` : (h.by || '—')}</p>
          <p className="tabular-nums">Limpia: {cuando(h.at)}</p>
          <p className="tabular-nums">Cerrada: {cuando(h.closedAt)}</p>
        </div>
        {explicacion && (
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
            <Info className="mt-px size-3 shrink-0" aria-hidden="true" /><span className="wrap-break-word">{explicacion}</span>
          </p>
        )}
      </div>
    );
  };

  // ── Rutina ─────────────────────────────────────────────────────────────────
  const motivoAnulacion = (x: RoutineRow) => x.estado === 'ANULADA' && x.motivoAnulacion ? (
    <span className="max-w-[220px] text-[10px] leading-snug whitespace-normal text-muted-foreground italic wrap-break-word">{x.motivoAnulacion}</span>
  ) : null;

  const columnasRutina: Columna<RoutineRow>[] = [
    { id: 'cama', titulo: 'Cama', celda: (x) => celdaCama(formatBedName(x.bedLabel), x.area) },
    { id: 'paciente', titulo: 'Paciente', celda: (x) => <span className="font-medium">{x.patientName || '—'}</span> },
    {
      id: 'limpieza',
      titulo: 'Limpieza',
      celda: (x) => (
        <div className="flex flex-col">
          <span>{x.operador || x.startedBy || '—'}</span>
          <span className="text-[10px] text-muted-foreground tabular-nums">Inicio: {cuando(x.startedAt)}</span>
          <span className="text-[10px] text-muted-foreground tabular-nums">Fin: {cuando(x.finishedAt)}</span>
        </div>
      ),
    },
    {
      id: 'estado',
      titulo: 'Estado',
      celda: (x) => {
        const e = estadoRutina(x.estado);
        return (
          <div className="flex flex-col items-start gap-1">
            <StatusBadge tono={e.tono}>{e.label}</StatusBadge>
            {motivoAnulacion(x)}
          </div>
        );
      },
    },
    ...(canCancelRutina ? [{
      id: 'acciones',
      titulo: 'Acciones',
      alinear: 'der' as const,
      celda: (x: RoutineRow) => cancelable(x)
        ? <div className="flex justify-end">{accionSecundaria(<XCircle className="size-4" />, 'Cancelar', () => { setCancelError(null); setCancelandoRutina(x); }, false, true)}</div>
        : null,
    }] : []),
  ];

  const tarjetaRutina = (x: RoutineRow) => {
    const e = estadoRutina(x.estado);
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          {celdaCama(formatBedName(x.bedLabel), x.area, x.patientName || undefined)}
          <StatusBadge tono={e.tono}>{e.label}</StatusBadge>
        </div>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5"><SprayCan className="size-3.5 shrink-0" aria-hidden="true" />{x.operador || x.startedBy || '—'}</p>
          <p className="tabular-nums">Inicio: {cuando(x.startedAt)}</p>
          <p className="tabular-nums">Fin: {cuando(x.finishedAt)}</p>
          {x.estado === 'ANULADA' && x.motivoAnulacion && <p className="italic wrap-break-word">Cancelada: {x.motivoAnulacion}</p>}
        </div>
        {cancelable(x) && (
          <div className="border-t pt-3">
            {accionSecundaria(<XCircle className="size-4" />, 'Cancelar', () => { setCancelError(null); setCancelandoRutina(x); }, true, true)}
          </div>
        )}
      </div>
    );
  };

  // ── Subtítulo del header (conteos de la solapa) ─────────────────────────────
  const n = (v: number) => <span className="font-medium text-foreground tabular-nums">{v}</span>;
  const subtitulo = tab === 'historico' ? (
    <>{n(visibleHistory.length)}{buscando && history.length !== visibleHistory.length && <> de {n(history.length)}</>} {visibleHistory.length === 1 ? 'limpieza cerrada' : 'limpiezas cerradas'} · {diaLegible(from)} – {diaLegible(to)}</>
  ) : tab === 'rutina' ? (
    <>{n(routineRows.length)} {routineRows.length === 1 ? 'limpieza de rutina' : 'limpiezas de rutina'} · {diaLegible(routineDate)}</>
  ) : (
    <>{n(rows.length)} {rows.length === 1 ? 'cama marcada limpia' : 'camas marcadas limpias'} · pendientes de consolidar</>
  );

  // La fecha que elige el DatePicker se guarda como "YYYY-MM-DD" (lo que espera la API). Igual que el
  // Calendar `required` de antes: tocar la fecha ya elegida no la borra.
  const alElegir = (set: (s: string) => void) => (d?: Date) => { if (d) set(aIso(d)); };

  return (
    <div className="flex w-full flex-col gap-4 px-3 pb-3 md:px-8 md:pb-8">
      {/* HEADER + TOOLBAR (DESIGN §4.4 y §5.2) */}
      <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="hidden shrink-0 md:block">
          <h2 className="text-2xl font-bold tracking-tight">Limpiezas</h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitulo}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {/* Buscador: filtra Activas e Histórico (Rutina no se busca). */}
          {tab !== 'rutina' && (
            <div className="relative min-w-[7rem] flex-1 sm:w-64 sm:flex-none">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                placeholder={tab === 'historico' ? 'Cama, sector, quién limpió, motivo…' : 'Cama, sector, quién limpió…'}
                aria-label="Buscar limpiezas"
                className="h-9 pr-8 pl-8 text-sm"
                value={searchFilter}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchFilter(e.target.value)}
              />
              {searchFilter && (
                <button type="button" onClick={() => setSearchFilter('')} aria-label="Limpiar búsqueda" className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          )}
          {tab !== 'activas' && <BotonFiltros abierto={verFiltros} activos={filtrosActivos} onClick={() => setVerFiltros(v => !v)} />}
          {actualizar && (
            <Button type="button" variant="outline" onClick={actualizar} disabled={actualizando} className="h-9 shrink-0 gap-1.5 px-3" aria-label="Actualizar">
              <RefreshCw className={cn('size-3.5', actualizando && 'animate-spin')} /><span className="hidden sm:inline">Actualizar</span>
            </Button>
          )}
        </div>
      </div>

      {/* Solapas de la vista: control segmentado (§6.6), debajo de la tab bar de Operativa. */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="activas">Activas</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
          <TabsTrigger value="rutina">Rutina (hoy)</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* FILTROS (DESIGN §4.7): barra inline con las fechas, no un modal. */}
      {verFiltros && tab !== 'activas' && (
        <BarraFiltros activos={filtrosActivos} onLimpiar={limpiarFiltros}>
          {tab === 'historico' ? (
            <>
              <CampoFiltro icono={CalendarDays} label="Cerrada desde">
                <DatePicker value={deIso(from)} onChange={alElegir(setFrom)} />
              </CampoFiltro>
              <CampoFiltro icono={CalendarDays} label="Hasta">
                <DatePicker value={deIso(to)} onChange={alElegir(setTo)} />
              </CampoFiltro>
            </>
          ) : (
            <CampoFiltro icono={CalendarDays} label="Día">
              <DatePicker value={deIso(routineDate)} onChange={alElegir(setRoutineDate)} />
            </CampoFiltro>
          )}
        </BarraFiltros>
      )}

      {/* LISTAS: tabla (desktop) + cards (mobile) sobre el mismo array (§4.4, §7.1). */}
      {tab === 'historico' ? (
        <>
          {/* Falló la recarga pero hay datos de antes: se avisa sin tapar la lista. */}
          {errorHist && history.length > 0 && !loadingHist && bannerError(
            <><span className="font-semibold">No pudimos actualizar el histórico.</span> Lo que ves puede estar desactualizado.</>
          )}
          <DataTable
            filas={visibleHistory}
            columnas={columnasHistorico}
            clave={(h) => h.spItemId}
            tarjeta={tarjetaHistorico}
            porPagina={Number.POSITIVE_INFINITY}
            cargando={loadingHist}
            error={errorHist && history.length === 0 ? { mensaje: 'No pudimos cargar el histórico de limpiezas.', onReintentar: () => fetchHistory() } : undefined}
            // Distinguir "no hay nada en el rango" de "la búsqueda no matcheó": si no,
            // el usuario mueve las fechas sin darse cuenta de que el filtro es el texto.
            vacio={buscando
              ? <Vacio icono={Search} titulo="Sin resultados para la búsqueda" descripcion="Probá con otro texto o limpiá el buscador." />
              : <Vacio icono={Clock} titulo="Sin limpiezas en el rango" descripcion="Ajustá las fechas para ver el histórico." />}
          />
        </>
      ) : tab === 'rutina' ? (
        <>
          {cancelError && bannerError(cancelError)}
          {errorRoutine && routineRows.length > 0 && !loadingRoutine && bannerError(
            <><span className="font-semibold">No pudimos actualizar las limpiezas de rutina.</span> Lo que ves puede estar desactualizado.</>
          )}
          {/* Rutina del día: limpiezas de rutina de camas ocupadas (iniciar → finalizar). */}
          <DataTable
            filas={routineRows}
            columnas={columnasRutina}
            clave={(x) => x.spItemId}
            tarjeta={tarjetaRutina}
            porPagina={Number.POSITIVE_INFINITY}
            cargando={loadingRoutine}
            error={errorRoutine && routineRows.length === 0 ? { mensaje: 'No pudimos cargar las limpiezas de rutina.', onReintentar: () => fetchRoutine() } : undefined}
            vacio={<Vacio icono={SprayCan} titulo="Sin limpiezas de rutina ese día" descripcion="Se registran cuando alguien inicia una limpieza de rutina en una cama ocupada." />}
          />
        </>
      ) : (
        <>
          {cancelActivaError && bannerError(cancelActivaError)}
          {/* Las activas salen del estado de la app (camas): no hay carga propia ni error de esta vista. */}
          <DataTable
            filas={visibleRows}
            columnas={columnasActivas}
            clave={(b) => b.label}
            tarjeta={tarjetaActiva}
            porPagina={Number.POSITIVE_INFINITY}
            vacio={buscando && rows.length > 0
              ? <Vacio icono={Search} titulo="Sin resultados para la búsqueda" descripcion="Probá con otro texto o limpiá el buscador." />
              : <Vacio icono={CheckCircle2} titulo="No hay limpiezas activas" descripcion="Las camas marcadas limpias por las azafatas aparecen acá hasta consolidarse." />}
          />
        </>
      )}

      {/* Confirmación de consolidado */}
      <Dialog open={!!confirmBed} onOpenChange={() => setConfirmBed(null)}>
        {/* Confirmación (DESIGN §4.2) dentro del modal canónico §4.1; no es destructiva → tile de marca. */}
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Consolidar contra PROGAL</DialogTitle>
            <DialogDescription>Cama <span className="font-medium text-foreground">{confirmBed?.label}</span></DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="size-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <DoorClosed className="size-5" />
            </div>
            <p className="text-sm text-muted-foreground">
              Se cerrará el ticket de limpieza de <strong className="text-foreground">{confirmBed?.label}</strong> y la cama
              volverá a reflejar el estado real de <strong className="text-foreground">PROGAL</strong>. Esta acción quita el overlay
              "Limpia" del mapa.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmBed(null)}>Cancelar</Button>
            <Button type="button" onClick={() => confirmBed && consolidate(confirmBed.label)} className="min-w-[140px]">
              <DoorClosed className="size-4" /> Consolidar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RejectionModal
        open={!!cancelandoActiva}
        onOpenChange={(open) => { if (!open) setCancelandoActiva(null); }}
        onConfirm={async (obs) => {
          const b = cancelandoActiva;
          if (!b || !onCancelLimpieza) return;
          setCancelActivaError(null);
          const r = await onCancelLimpieza(b.label, obs);
          if (!r.ok) setCancelActivaError(r.error ?? 'No se pudo cancelar.');
        }}
        title="Cancelar limpieza"
        description={cancelandoActiva ? `${formatBedName(cancelandoActiva.label)} · marcada por ${cancelandoActiva.cleanedBy || '—'}. La cama vuelve a mostrarse como dice PROGAL. La observación es obligatoria y queda en el historial con quién canceló.` : ''}
        placeholder="Ej: se marcó limpia por error, todavía está sucia..."
        confirmLabel="Cancelar limpieza"
      />
      <RejectionModal
        open={!!cancelandoRutina}
        onOpenChange={(open) => { if (!open) setCancelandoRutina(null); }}
        onConfirm={confirmarCancelRutina}
        title="Cancelar limpieza de rutina"
        description={cancelandoRutina ? `${formatBedName(cancelandoRutina.bedLabel)}${cancelandoRutina.patientName ? ` · ${cancelandoRutina.patientName}` : ''}. La observación es obligatoria y queda registrada con quién canceló.` : ''}
        placeholder="Ej: se marcó en la cama equivocada, no se llegó a hacer..."
        confirmLabel="Cancelar limpieza"
      />
    </div>
  );
};
