import React, { useEffect, useMemo, useState } from 'react';
import { Bed, CirugiaEstado, CirugiaTraslado, User, Area } from '../types';
import { can } from '../lib/permissions';
import { cn, formatBedName } from '../lib/utils';
import { CIRUGIA_ESTADO_LABEL, cirugiaRetrocesoDe } from '../lib/constants';
import { estadoCirugia, PASOS_CIRUGIA } from '../lib/estados-cirugia';
import { fecha, fechaHora, hora, diaMes } from '../lib/formato';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { DataTable, type Columna } from '../components/ui/data-table';
import { Cargando, Vacio } from '../components/ui/estados';
import { StatusBadge, PUNTO_TONO } from '../components/ui/status-badge';
import { DateRangePicker, type DateRange } from '../components/ui/date-picker';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Textarea } from '../components/ui/textarea';
import { aIso, deIso } from '../lib/fechaIso';
import {
  Activity, AlertCircle, ArrowRight, BedDouble, CheckCircle2, Clock, Eye, Loader2, RefreshCw, Search,
  User as UserIcon, Undo2, X, XCircle,
} from 'lucide-react';
import { cirugiaEventoLabel, esRetroceso } from '../lib/cirugiaEventos';

// Display de área (copiado de BedsView/CleaningManagementView — no está exportado).
const AREA_LABELS: Record<string, string> = {
  [Area.PISO_4]: 'Piso 4', [Area.PISO_5]: 'Piso 5', [Area.PISO_6]: 'Piso 6',
  [Area.PISO_7]: 'Piso 7', [Area.PISO_8]: 'Piso 8',
  [Area.HIT]: 'ITR', [Area.HRA]: 'Sala Espera', [Area.HSS]: 'Sueño',
  [Area.HUC]: 'UCO', [Area.HUQ]: 'URP', [Area.HUT]: 'UTI',
};
const areaLabel = (a?: string) => (a ? AREA_LABELS[a] ?? a : '—');

type TxResult = { ok: boolean; error?: string };

interface Props {
  cirugias: CirugiaTraslado[];
  beds: Bed[];
  currentUser: User | null;
  onVanABuscar: (id: string) => Promise<TxResult>;
  onEnTraslado: (id: string) => Promise<TxResult>;
  onEnCirugia: (id: string) => Promise<TxResult>;
  onEnDevolucion: (id: string) => Promise<TxResult>;
  onTolerancia?: (id: string) => Promise<TxResult>;
  onCancelar: (id: string, motivo: string) => Promise<TxResult>;
  /** "Volver un paso": corrige un paso marcado por error (queda en el timeline como retroceso). */
  onRetroceder?: (id: string) => Promise<TxResult>;
  onRefresh?: () => void | Promise<void>;
}

// Orden del flujo para ordenar la lista ÚNICA (la columna Estado reemplaza a las secciones
// separadas, para dar concordancia con Traslados/Limpiezas/Comandas). También es el índice del
// paso en el indicador del circuito.
const ORDEN_ESTADO: Record<string, number> = {
  LISTO_PARA_CIRUGIA: 0, VAN_A_BUSCAR: 1, EN_TRASLADO: 2, EN_CIRUGIA: 3, EN_DEVOLUCION: 4,
};

// Botones de acción dentro de una fila de la tabla: más bajos que sm (como en Traslados), así la fila no se estira.
const BOTON_FILA = 'h-8 gap-1.5 px-3 text-xs';

// Fecha válida o null (las fechas llegan como ISO del backend; una rota no tiene que romper la grilla:
// date-fns tira RangeError con un Invalid Date).
const aFecha = (iso?: string): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
};
// Fecha+hora absoluta (histórico, detalle): "2 nov 2026, 14:35". Si viene rota, se muestra tal cual.
const fh = (iso?: string) => {
  if (!iso) return '—';
  const d = aFecha(iso);
  return d ? fechaHora(d) : String(iso);
};
// Hora de un paso, compacta para la grilla: "12:40" si fue hoy, "18/8 12:40" si no.
const cuando = (iso?: string): string | null => {
  const d = aFecha(iso);
  if (!d) return null;
  return d.toDateString() === new Date().toDateString() ? hora(d) : `${diaMes(d)} ${hora(d)}`;
};

// "803 - 01" sin cortarse en dos líneas (espacios duros alrededor del guion).
const camaCorta = (label: string) => formatBedName(label).replace(/ - /g, ' - ');

// Hora por paso del circuito: cada una muestra cuándo se alcanzó ese estado (de c.pasos, poblado por
// el backend). El label es el MISMO nombre del estado que se ve en la pill y en los botones
// (CIRUGIA_ESTADO_LABEL): antes decía "Retirado" / "Recibido" y no se entendía a qué paso
// correspondía (pedido 04/11/2026).
// TOLERANCIA_EVALUADA NO va acá: al evaluarse cierra la operatoria y la saca de Activas → nunca se
// llenaría. La hora de tolerancia se ve en el detalle del Histórico.
const STEP_COLS: { key: CirugiaEstado; label: string }[] = (['EN_TRASLADO', 'EN_CIRUGIA', 'EN_DEVOLUCION'] as const)
  .map(key => ({ key, label: CIRUGIA_ESTADO_LABEL[key] }));

// Duración entre dos ISO (inicio → cierre). "—" si falta o es incoherente.
const fmtDuracion = (a?: string, b?: string): string => {
  const t0 = Date.parse(String(a ?? '')), t1 = Date.parse(String(b ?? ''));
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return '—';
  const min = Math.floor((t1 - t0) / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24), hh = h % 24;
  return hh ? `${d}d ${hh}h` : `${d}d`;
};
// Lo mismo en minutos, para ordenar la columna Duración (las incoherentes van al final).
const duracionMin = (a?: string, b?: string): number => {
  const t0 = Date.parse(String(a ?? '')), t1 = Date.parse(String(b ?? ''));
  return Number.isFinite(t0) && Number.isFinite(t1) && t1 >= t0 ? (t1 - t0) / 60000 : Number.MAX_SAFE_INTEGER;
};

// Pill de estado (§3.11) con el label largo en el tooltip nativo.
const EstadoBadge: React.FC<{ estado: CirugiaEstado; hist?: boolean }> = ({ estado, hist }) => {
  const e = estadoCirugia(estado, hist);
  return <span title={e.titulo}><StatusBadge tono={e.tono}>{e.label}</StatusBadge></span>;
};

export const CirugiasView: React.FC<Props> = ({
  cirugias, beds, currentUser, onVanABuscar, onEnTraslado, onEnCirugia, onEnDevolucion, onTolerancia, onCancelar, onRetroceder, onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Modal "Cancelar": id + motivo tipeado.
  const [cancelando, setCancelando] = useState<{ id: string; motivo: string } | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  // "Volver un paso" pide confirmación (queda en la trayectoria y en la métrica de retrocesos).
  const [confirmRetro, setConfirmRetro] = useState<string | null>(null);

  // ── Sub-solapa Histórico (cerradas: Tolerancia evaluada / Cancelada, por fecha_cierre) ────────
  // Mismo patrón que el histórico de Limpiezas: rango Desde/Hasta + buscador. El backend ya expone
  // GET /api/cirugia?history=1&from=&to=.
  const [tab, setTab] = useState<'activas' | 'historico'>('activas');
  const todayStr   = new Date().toISOString().slice(0, 10);
  const weekAgoStr = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const [from, setFrom] = useState(weekAgoStr);
  const [to, setTo]     = useState(todayStr);
  const [history, setHistory] = useState<CirugiaTraslado[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);
  // La última carga del histórico falló (solo para avisarlo: lo que ya estaba cargado se conserva).
  const [errorHist, setErrorHist] = useState(false);

  const fetchHistory = React.useCallback(async () => {
    setLoadingHist(true);
    setErrorHist(false);
    try {
      const token = localStorage.getItem('mediflow_token');
      const r = await fetch(`/api/cirugia?history=1&from=${from}&to=${to}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (r.ok) {
        const data = await r.json();
        const rows: CirugiaTraslado[] = (data.cirugias ?? [])
          .sort((a: CirugiaTraslado, b: CirugiaTraslado) => String(b.fechaCierre ?? '').localeCompare(String(a.fechaCierre ?? '')));
        setHistory(rows);
      } else {
        setErrorHist(true);
      }
    } catch { setErrorHist(true); /* mantiene lo previo ante fallo transitorio */ }
    finally { setLoadingHist(false); }
  }, [from, to]);

  // Auto-carga al entrar al histórico y al cambiar las fechas.
  useEffect(() => { if (tab === 'historico') fetchHistory(); }, [tab, fetchHistory]);

  // Puente entre el DateRangePicker (Date) y las fechas "YYYY-MM-DD" del histórico. Con un solo día
  // elegido, el rango es ese día. "Limpiar" vuelve a la última semana (el histórico siempre tiene rango).
  const rango: DateRange = { from: deIso(from), to: deIso(to) };
  const cambiarRango = (r?: DateRange) => {
    if (!r?.from) { setFrom(weekAgoStr); setTo(todayStr); return; }
    setFrom(aIso(r.from));
    setTo(aIso(r.to ?? r.from));
  };

  // ── Detalle de una operatoria (timeline de pasos de cirugia_eventos) ─────────
  type EventoRow = { tipo: string; usuario?: string; operador?: string; meta?: unknown; at: string };
  const [detalleCx, setDetalleCx] = useState<CirugiaTraslado | null>(null);
  const [eventos, setEventos] = useState<EventoRow[]>([]);
  const [loadingEventos, setLoadingEventos] = useState(false);

  const openDetalle = React.useCallback(async (c: CirugiaTraslado) => {
    setDetalleCx(c); setEventos([]); setLoadingEventos(true);
    try {
      const token = localStorage.getItem('mediflow_token');
      const r = await fetch(`/api/cirugia?eventos=${encodeURIComponent(c.id)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (r.ok) { const data = await r.json(); setEventos(data.eventos ?? []); }
    } catch { /* deja la lista vacía */ }
    finally { setLoadingEventos(false); }
  }, []);

  const withPending = async (id: string, fn: () => Promise<TxResult>) => {
    setPending(p => new Set(p).add(id));
    setRowError(e => { const n = { ...e }; delete n[id]; return n; });
    try {
      const r = await fn();
      if (!r.ok) setRowError(e => ({ ...e, [id]: r.error ?? 'No se pudo actualizar.' }));
      return r;
    } finally {
      setPending(p => { const n = new Set(p); n.delete(id); return n; });
    }
  };

  // Recorte por sector para roles filterByFloors (mismo criterio que Traslados/Limpiezas, así una
  // azafata/enfermería de piso ve solo lo suyo). La cirugía "pertenece" al piso de la cama ACTUAL
  // relevante: el DESTINO de la devolución si ya se definió y difiere del origen, sino el ORIGEN.
  // Hand-off exclusivo → una cirugía de 405-1 la ve piso 4; cuando la devolución se fija a piso 5,
  // deja de verla piso 4 y pasa a verla piso 5. (Distinto de scopeTickets, que muestra a origen Y
  // destino a la vez; acá el destino MANDA cuando difiere, por pedido de negocio.)
  // Admin (todas las áreas) o beds sin cargar → no filtra, igual que scopeTickets.
  const scoped = useMemo(() => {
    if (!currentUser?.filterByFloors || !currentUser.assignedAreas?.length) return cirugias;
    const areas = currentUser.assignedAreas;
    const allAreas = new Set(Object.values(Area) as string[]);
    const hasAll = areas.length >= allAreas.size - 1; // 9 de 10 = efectivamente todas
    if (hasAll || beds.length === 0) return cirugias;
    const areaByLabel = new Map<string, string>();
    for (const b of beds) if (b.area) areaByLabel.set(b.label, b.area);
    const ownerArea = (c: CirugiaTraslado): string | undefined => {
      const destChanged = !!c.camaDestino && c.camaDestino !== c.camaOrigen;
      const bedLabel = destChanged ? c.camaDestino! : c.camaOrigen;
      return areaByLabel.get(bedLabel) ?? c.area; // fallback al área guardada en la fila (origen)
    };
    return cirugias.filter(c => {
      const a = ownerArea(c);
      return a ? areas.includes(a as Area) : true; // área irresoluble → no la ocultamos
    });
  }, [cirugias, currentUser, beds]);

  const filtered = useMemo(() => {
    if (!search.trim()) return scoped;
    const q = search.toLowerCase();
    return scoped.filter(c =>
      (c.pacienteNombre ?? '').toLowerCase().includes(q) ||
      (c.camaOrigen ?? '').toLowerCase().includes(q) ||
      (c.camaDestino ?? '').toLowerCase().includes(q) ||
      (c.pacienteCodigo ?? '').toLowerCase().includes(q),
    );
  }, [scoped, search]);

  // Lista ÚNICA ordenada por el flujo (más recientes primero dentro de cada estado). La columna
  // Estado distingue en qué paso está cada una — ya no hacen falta secciones separadas.
  const ordenadas = useMemo(
    () => [...filtered].sort((a, b) =>
      (ORDEN_ESTADO[a.estado] ?? 9) - (ORDEN_ESTADO[b.estado] ?? 9) ||
      String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)),
    ),
    [filtered],
  );

  // Histórico visible: mismo recorte por área que la vista activa (destino manda si difiere del
  // origen) + el buscador compartido.
  const visibleHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filterByFloors = !!currentUser?.filterByFloors && !!currentUser.assignedAreas?.length;
    const areas = currentUser?.assignedAreas ?? [];
    const allAreas = new Set(Object.values(Area) as string[]);
    const scopeOff = !filterByFloors || areas.length >= allAreas.size - 1 || beds.length === 0;
    const areaByLabel = new Map<string, string>();
    if (!scopeOff) for (const b of beds) if (b.area) areaByLabel.set(b.label, b.area);
    const inScope = (c: CirugiaTraslado) => {
      if (scopeOff) return true;
      const destChanged = !!c.camaDestino && c.camaDestino !== c.camaOrigen;
      const a = areaByLabel.get(destChanged ? c.camaDestino! : c.camaOrigen) ?? c.area;
      return a ? areas.includes(a as Area) : true;
    };
    return history.filter(c => inScope(c) && (!q ||
      (c.pacienteNombre ?? '').toLowerCase().includes(q) ||
      (c.camaOrigen ?? '').toLowerCase().includes(q) ||
      (c.camaDestino ?? '').toLowerCase().includes(q) ||
      (c.pacienteCodigo ?? '').toLowerCase().includes(q)));
  }, [history, search, currentUser, beds]);

  const isPending = (id: string) => pending.has(id);

  // Acción secundaria de una fila (DESIGN §7.6, igual que Traslados): en desktop, botón-ícono `ghost`
  // con tooltip; en mobile, botón a lo ancho con texto (es la card entera).
  const accionSecundaria = (
    icono: React.ReactNode, label: string, onClick: () => void, isMobile: boolean,
    { peligro = false, disabled = false, ayuda }: { peligro?: boolean; disabled?: boolean; ayuda?: string } = {},
  ) => isMobile ? (
    <Button type="button" variant="outline" disabled={disabled} onClick={onClick}
      className={cn('w-full', peligro && 'text-destructive hover:bg-destructive/10 hover:text-destructive')}>
      {icono} {label}
    </Button>
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick}
          className={cn('text-muted-foreground', peligro ? 'hover:bg-destructive/10 hover:text-destructive' : 'hover:text-foreground')}>
          {icono}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{ayuda ?? label}</TooltipContent>
    </Tooltip>
  );

  // Botón del PASO del circuito (orden feliz de la máquina de estados). Cada uno se muestra SOLO si el
  // rol tiene el permiso de esa acción — así un rol con todos los cirugia_* (Admin) gestiona todo desde
  // acá, y uno de quirófano ve solo sus pasos.
  const renderCirugiaActions = (c: CirugiaTraslado, isMobile = false) => {
    const p = isPending(c.id);
    const paso = (icono: React.ReactNode, label: string, fn: () => Promise<TxResult>) => (
      <Button type="button" size={isMobile ? 'default' : 'sm'} disabled={p}
        onClick={() => withPending(c.id, fn)} className={isMobile ? 'w-full' : BOTON_FILA}>
        {p ? <Loader2 className="animate-spin" aria-hidden="true" /> : icono} {label}
      </Button>
    );
    switch (c.estado) {
      case 'LISTO_PARA_CIRUGIA':
        return can(currentUser, 'cirugia_buscar')
          ? paso(<ArrowRight aria-hidden="true" />, 'Búsqueda para cirugía', () => onVanABuscar(c.id)) : null;
      case 'VAN_A_BUSCAR':
        // El camillero llegó y la enfermera ENTREGA al paciente ("se lo llevó"). Acción de
        // Enfermería (también en el mapa), expuesta acá para un rol que gestione todo.
        return can(currentUser, 'cirugia_entregar')
          ? paso(<ArrowRight aria-hidden="true" />, 'En traslado a cirugía', () => onEnTraslado(c.id)) : null;
      case 'EN_TRASLADO':
        return can(currentUser, 'cirugia_operar')
          ? paso(<Activity aria-hidden="true" />, 'En cirugía', () => onEnCirugia(c.id)) : null;
      case 'EN_CIRUGIA':
        // "En devolución": el paciente vuelve. YA NO se elige destino — Admisión lo mueve en PROGAL
        // y el cron detecta la cama. Acción directa (sin modal).
        return can(currentUser, 'cirugia_devolver')
          ? paso(<BedDouble aria-hidden="true" />, 'Regreso de cirugía', () => onEnDevolucion(c.id)) : null;
      case 'EN_DEVOLUCION':
        // Iniciar dieta (paso FINAL, ya sin "Recibida" intermedio): la enfermería del piso recibe e
        // inicia la dieta; CIERRA la operatoria y avisa a Catering.
        return can(currentUser, 'cirugia_tolerancia') && onTolerancia
          ? paso(<CheckCircle2 aria-hidden="true" />, 'Iniciar dieta', () => onTolerancia(c.id)) : null;
      default:
        return null;
    }
  };

  // "Volver un paso" (20/10/2026): para un paso marcado por error ("En traslado" que al final no empezó).
  // Requiere el permiso del paso que se deshace. Queda en el timeline como "Volvió un paso". La
  // confirmación es un AlertDialog (abajo) en vez del recuadro que se abría dentro de la fila.
  const renderRetroceder = (c: CirugiaTraslado, isMobile = false) => {
    // Desde "Listo para cirugía" también (anula la marca, permiso cirugia_volver_listo; 29/10/2026).
    const retro = cirugiaRetrocesoDe(c.estado);
    if (!onRetroceder || !retro || !can(currentUser, retro.permiso)) return null;
    return accionSecundaria(<Undo2 className="size-4" />, 'Volver un paso', () => setConfirmRetro(c.id), isMobile,
      { disabled: isPending(c.id), ayuda: `${retro.pregunta} (corrige un paso marcado por error)` });
  };

  const renderCancelar = (c: CirugiaTraslado, isMobile = false) =>
    can(currentUser, 'cirugia_cancelar')
      ? accionSecundaria(<XCircle className="size-4" />, 'Cancelar', () => setCancelando({ id: c.id, motivo: '' }), isMobile,
        { peligro: true, disabled: isPending(c.id) })
      : null;

  const errorFila = (c: CirugiaTraslado) => rowError[c.id] ? (
    <p role="alert" className="flex items-start gap-1 text-[11px] leading-snug text-destructive">
      <AlertCircle className="mt-px size-3 shrink-0" aria-hidden="true" /> {rowError[c.id]}
    </p>
  ) : null;

  // Cama de origen → destino (si cambió en la devolución), con la marca de cambio.
  const renderCama = (c: CirugiaTraslado) => {
    const camaChange = !!c.camaDestino && c.camaDestino !== c.camaOrigen;
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="flex flex-wrap items-center gap-1 font-medium leading-tight">
          <span>{camaCorta(c.camaOrigen)}</span>
          {camaChange && (<>
            <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{camaCorta(c.camaDestino!)}</span>
          </>)}
        </span>
        {camaChange && (
          <span title={`Era ${formatBedName(c.camaOrigen)}`}>
            <StatusBadge tono="aviso">Cambió de cama</StatusBadge>
          </span>
        )}
      </div>
    );
  };

  // Indicador del circuito (5 pasos) + la hora de los pasos que pidió negocio (En traslado a cirugía /
  // En cirugía / Regreso de cirugía). Vacío ("—") si el paso no se hizo aún. `items-end`: un título
  // que ocupa dos líneas no desalinea las horas.
  const renderCircuito = (c: CirugiaTraslado) => {
    const actual = ORDEN_ESTADO[c.estado] ?? -1;
    return (
      <div className="flex min-w-[200px] flex-col gap-2">
        <div className="flex items-center gap-1" role="img"
          aria-label={`Paso ${actual + 1} de ${PASOS_CIRUGIA.length}: ${CIRUGIA_ESTADO_LABEL[c.estado] ?? c.estado}`}>
          {PASOS_CIRUGIA.map((paso, i) => (
            <span key={paso} title={CIRUGIA_ESTADO_LABEL[paso]}
              className={cn('h-1.5 flex-1 rounded-full', i <= actual ? 'bg-primary' : 'bg-border')} />
          ))}
        </div>
        <dl className="grid grid-cols-3 items-end gap-x-3">
          {STEP_COLS.map(col => {
            const iso = c.pasos?.[col.key];
            const t = cuando(iso);
            return (
              <div key={col.key} className="min-w-0">
                <dt className="text-[10px] leading-tight text-muted-foreground">{col.label}</dt>
                <dd className="text-xs font-medium whitespace-nowrap tabular-nums" title={t ? fh(iso) : undefined}>
                  {t ?? <span className="text-muted-foreground">—</span>}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    );
  };

  // Metadatos del paciente bajo el nombre: área · tipo de internación (PROGAL) · código.
  const metaPaciente = (c: CirugiaTraslado, conArea = true) =>
    [conArea ? areaLabel(c.area) : null, c.tipo, c.pacienteCodigo].filter(Boolean).join(' · ');

  // ── ACTIVAS: columnas AGRUPADAS (DESIGN §7.2 "2 líneas" + §5.4 disclosure progresivo) ──────────
  const columnasActivas: Columna<CirugiaTraslado>[] = [
    {
      id: 'estado',
      titulo: 'Estado',
      ordenar: (c) => ORDEN_ESTADO[c.estado] ?? 9,
      clase: 'whitespace-nowrap',
      celda: (c) => (
        <div className="flex flex-col items-start gap-1">
          <EstadoBadge estado={c.estado} />
          <span className="text-[10px] text-muted-foreground tabular-nums" title="Ingreso al flujo de cirugía">{fh(c.createdAt)}</span>
        </div>
      ),
    },
    {
      id: 'paciente',
      titulo: 'Paciente',
      ordenar: (c) => c.pacienteNombre ?? '',
      celda: (c) => (
        <div className="flex max-w-[260px] flex-col gap-0.5">
          <span className="font-medium leading-tight wrap-break-word">{c.pacienteNombre || 'Paciente s/nombre'}</span>
          <span className="text-[10px] text-muted-foreground">{metaPaciente(c)}</span>
        </div>
      ),
    },
    { id: 'cama', titulo: 'Cama', ordenar: (c) => c.camaOrigen, celda: renderCama },
    { id: 'circuito', titulo: 'Circuito', ocultarEn: 'md', celda: renderCircuito },
    {
      id: 'acciones',
      titulo: 'Acciones',
      alinear: 'der',
      celda: (c) => (
        <div className="flex flex-col items-end gap-1">
          {errorFila(c)}
          <div className="flex items-center justify-end gap-1">
            {renderCirugiaActions(c)}
            {renderRetroceder(c)}
            {renderCancelar(c)}
          </div>
        </div>
      ),
    },
  ];

  // Card mobile de fila (DESIGN §5.4b): identidad + estado arriba, cama, circuito y acciones al pie.
  const tarjetaActiva = (c: CirugiaTraslado) => {
    const acciones = [renderCirugiaActions(c, true), renderRetroceder(c, true), renderCancelar(c, true)].filter(Boolean);
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <p className="font-medium leading-tight wrap-break-word">{c.pacienteNombre || 'Paciente s/nombre'}</p>
            <p className="text-[10px] text-muted-foreground">{metaPaciente(c)}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <EstadoBadge estado={c.estado} />
            <span className="text-[10px] text-muted-foreground tabular-nums">{fh(c.createdAt)}</span>
          </div>
        </div>
        <div className="rounded-md bg-muted/40 p-2.5">
          <p className="mb-1 text-[10px] tracking-wider text-muted-foreground uppercase">Cama</p>
          {renderCama(c)}
        </div>
        {renderCircuito(c)}
        {errorFila(c)}
        {acciones.length > 0 && (
          <div className="flex flex-col gap-2 border-t pt-3">
            {acciones.map((a, i) => <React.Fragment key={i}>{a}</React.Fragment>)}
          </div>
        )}
      </div>
    );
  };

  // ── HISTÓRICO: cerradas, con la duración total de la operatoria ─────────────────────────────────
  const columnasHistorico: Columna<CirugiaTraslado>[] = [
    {
      id: 'estado',
      titulo: 'Estado',
      ordenar: (c) => String(c.fechaCierre ?? ''),
      clase: 'whitespace-nowrap',
      celda: (c) => (
        <div className="flex flex-col items-start gap-1">
          <EstadoBadge estado={c.estado} hist />
          <span className="text-[10px] text-muted-foreground tabular-nums" title="Cierre de la operatoria">{fh(c.fechaCierre)}</span>
        </div>
      ),
    },
    {
      id: 'paciente',
      titulo: 'Paciente',
      ordenar: (c) => c.pacienteNombre ?? '',
      celda: (c) => (
        <div className="flex max-w-[260px] flex-col gap-0.5">
          <span className="font-medium leading-tight wrap-break-word">{c.pacienteNombre || '—'}</span>
          {metaPaciente(c, false) && <span className="text-[10px] text-muted-foreground">{metaPaciente(c, false)}</span>}
        </div>
      ),
    },
    { id: 'cama', titulo: 'Cama', ordenar: (c) => c.camaOrigen, celda: renderCama },
    {
      id: 'inicio',
      titulo: 'Inicio',
      ocultarEn: 'md',
      ordenar: (c) => String(c.createdAt ?? ''),
      clase: 'whitespace-nowrap',
      celda: (c) => <span className="tabular-nums text-muted-foreground">{fh(c.createdAt)}</span>,
    },
    {
      id: 'duracion',
      titulo: 'Duración',
      alinear: 'der',
      ordenar: (c) => duracionMin(c.createdAt, c.fechaCierre),
      clase: 'whitespace-nowrap',
      celda: (c) => <span className="font-medium">{fmtDuracion(c.createdAt, c.fechaCierre)}</span>,
    },
    {
      id: 'detalle',
      titulo: 'Detalle',
      alinear: 'der',
      celda: (c) => (
        <Button type="button" size="sm" variant="outline" onClick={() => openDetalle(c)} className={BOTON_FILA}>
          <Eye aria-hidden="true" /> Detalle
        </Button>
      ),
    },
  ];

  const tarjetaHistorico = (c: CirugiaTraslado) => (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="font-medium leading-tight wrap-break-word">{c.pacienteNombre || 'Paciente'}</p>
          {metaPaciente(c, false) && <p className="text-[10px] text-muted-foreground">{metaPaciente(c, false)}</p>}
        </div>
        <EstadoBadge estado={c.estado} hist />
      </div>
      <div className="rounded-md bg-muted/40 p-2.5">
        <p className="mb-1 text-[10px] tracking-wider text-muted-foreground uppercase">Cama</p>
        {renderCama(c)}
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {[['Inicio', fh(c.createdAt)], ['Cierre', fh(c.fechaCierre)], ['Duración', fmtDuracion(c.createdAt, c.fechaCierre)]].map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[10px] tracking-wider text-muted-foreground uppercase">{k}</dt>
            <dd className="text-xs font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t pt-3">
        <Button type="button" variant="outline" onClick={() => openDetalle(c)} className="w-full">
          <Eye aria-hidden="true" /> Ver detalle
        </Button>
      </div>
    </div>
  );

  // Cirugía seleccionada por el modal de cancelación (lookup por id): una instancia a nivel vista.
  const cancelCx = cancelando ? cirugias.find(c => c.id === cancelando.id) ?? null : null;
  // Ídem para la confirmación de "Volver un paso".
  const retroCx = confirmRetro ? cirugias.find(c => c.id === confirmRetro) ?? null : null;
  const retroInfo = retroCx ? cirugiaRetrocesoDe(retroCx.estado) : null;

  const enQuirofano = scoped.filter(c => c.estado === 'EN_CIRUGIA').length;
  const actualizando = tab === 'historico' && loadingHist;

  return (
    <div className="flex w-full flex-col gap-4 px-3 pb-3 md:px-8 md:pb-8">
      {/* HEADER + TOOLBAR (DESIGN §4.4 y §5.2) */}
      <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="hidden shrink-0 md:block">
          <h2 className="text-2xl font-bold tracking-tight">Cirugías</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tab === 'activas' ? (<>
              <span className="font-medium text-foreground tabular-nums">{scoped.length}</span> activas ·{' '}
              <span className="font-medium text-foreground tabular-nums">{enQuirofano}</span> en quirófano
            </>) : (<>
              <span className="font-medium text-foreground tabular-nums">{visibleHistory.length}</span> cerradas · del {fecha(deIso(from) ?? new Date())} al {fecha(deIso(to) ?? new Date())}
            </>)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {/* Sub-solapas Activas | Histórico: control segmentado (§6.6). */}
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'activas' | 'historico')}>
            <TabsList className="h-9" aria-label="Cirugías activas o histórico">
              <TabsTrigger value="activas">Activas</TabsTrigger>
              <TabsTrigger value="historico">Histórico</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative min-w-[7rem] flex-1 sm:w-56 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder="Paciente, cama o código…"
              aria-label="Buscar por paciente, cama o código"
              className="h-9 pr-8 pl-8 text-sm"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Limpiar búsqueda" className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {/* Histórico: período por fecha de cierre (filtro de una dimensión, inline en la toolbar §5.2). En mobile
              baja a su propia línea (order-last) para que Actualizar quede al lado del buscador. */}
          {tab === 'historico' && (
            <>
              <span id="cx-hist-periodo" className="sr-only">Período, por fecha de cierre</span>
              <DateRangePicker value={rango} onChange={cambiarRango} aria-describedby="cx-hist-periodo" className="order-last h-9 w-full sm:order-none sm:w-64" />
            </>
          )}
          {(tab === 'historico' || onRefresh) && (
            <Button type="button" variant="outline" disabled={actualizando} aria-label="Actualizar"
              onClick={() => { if (tab === 'historico') fetchHistory(); else onRefresh?.(); }}
              className="h-9 shrink-0 gap-1.5 px-3">
              <RefreshCw className={cn('size-3.5', actualizando && 'animate-spin')} aria-hidden="true" />
              <span className="hidden sm:inline">Actualizar</span>
            </Button>
          )}
        </div>
      </div>

      {tab === 'activas' ? (
        // TABLA (desktop) + CARDS (mobile) sobre el mismo array (§4.4, §7.1). Las activas llegan por
        // props (Realtime del hook): esta vista no sabe si están cargando o si falló la carga.
        <DataTable
          filas={ordenadas}
          columnas={columnasActivas}
          clave={(c) => c.id}
          tarjeta={tarjetaActiva}
          // Todas las activas en una página: es una grilla operativa, no un archivo.
          porPagina={Number.POSITIVE_INFINITY}
          vacio={
            <Vacio
              icono={search.trim() ? Search : Activity}
              titulo={search.trim() ? 'Sin resultados para la búsqueda' : 'Sin cirugías activas'}
              descripcion={search.trim() ? 'Probá con otro texto o limpiá el buscador.' : 'Cuando un paciente se marque listo para cirugía, aparece acá.'}
            />
          }
        />
      ) : (
        <>
          {/* Falló una recarga y hay datos de antes: se avisa sin esconderlos (banner suave §9.4). */}
          {errorHist && history.length > 0 && !loadingHist && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span><span className="font-semibold">No pudimos actualizar el histórico.</span> Lo que ves puede estar desactualizado; probá con Actualizar.</span>
            </div>
          )}
          <DataTable
            filas={visibleHistory}
            columnas={columnasHistorico}
            clave={(c) => c.id}
            tarjeta={tarjetaHistorico}
            cargando={loadingHist}
            error={errorHist && history.length === 0 ? { mensaje: 'No se pudo traer el histórico de cirugías. Revisá tu conexión y probá de nuevo.', onReintentar: () => { fetchHistory(); } } : undefined}
            vacio={
              <Vacio
                icono={search.trim() ? Search : Clock}
                titulo={search.trim() ? 'Sin resultados para la búsqueda' : 'Sin cirugías cerradas en el rango'}
                descripcion={search.trim() ? 'Probá con otro texto o limpiá el buscador.' : 'Ajustá las fechas para ver el histórico.'}
              />
            }
          />
        </>
      )}

      {/* Confirmación de "Volver un paso" (DESIGN §4.2): corrige un paso marcado por error. */}
      <AlertDialog open={!!confirmRetro} onOpenChange={o => { if (!o) setConfirmRetro(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-amber-100 text-amber-700">
              <Undo2 aria-hidden="true" />
            </AlertDialogMedia>
            <AlertDialogTitle>¿{retroInfo?.pregunta ?? 'Volver un paso'}?</AlertDialogTitle>
            <AlertDialogDescription>
              Corrige un paso marcado por error en la operatoria de{' '}
              <span className="font-medium text-foreground">{retroCx?.pacienteNombre || 'el paciente'}</span>.
              Queda registrado en los pasos como una corrección.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No</AlertDialogCancel>
            <AlertDialogAction
              disabled={!retroCx || isPending(retroCx.id)}
              onClick={() => {
                if (!retroCx || !onRetroceder) return;
                setConfirmRetro(null);
                withPending(retroCx.id, () => onRetroceder(retroCx.id));
              }}>
              <Undo2 aria-hidden="true" /> Sí, volver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal: cancelar con motivo obligatorio. */}
      <Dialog open={!!cancelando} onOpenChange={o => { if (!o) setCancelando(null); }}>
        {/* Confirmación destructiva con motivo (DESIGN §4.2) dentro del modal canónico §4.1. */}
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar cirugía</DialogTitle>
            <DialogDescription>
              Operatoria de <span className="font-medium text-foreground">{cancelCx?.pacienteNombre || 'el paciente'}</span>
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="size-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
              <XCircle className="size-5" />
            </div>
            {cancelCx && (
              <div>
                <label htmlFor="cx-cancelar-motivo" className="mb-1 block text-xs font-medium text-muted-foreground">Motivo de la cancelación <span className="text-destructive">*</span></label>
                <Textarea
                  id="cx-cancelar-motivo"
                  autoFocus rows={3} maxLength={500}
                  value={cancelando?.motivo ?? ''}
                  onChange={e => setCancelando(s => (s ? { ...s, motivo: e.target.value } : s))}
                  placeholder="Ej: se suspendió la cirugía, alta del paciente…"
                  aria-invalid={!!rowError[cancelCx.id]}
                  className="resize-none" />
                {rowError[cancelCx.id] && <p role="alert" className="text-xs text-destructive mt-1">{rowError[cancelCx.id]}</p>}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancelando(null)}>Volver</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!cancelCx || isPending(cancelCx.id) || !cancelando?.motivo.trim()}
              onClick={async () => {
                if (!cancelCx || !cancelando?.motivo.trim()) return;
                const r = await withPending(cancelCx.id, () => onCancelar(cancelCx.id, cancelando.motivo.trim()));
                if (r.ok) setCancelando(null);
              }}
              className="min-w-[140px]">
              {cancelCx && isPending(cancelCx.id) && <Loader2 className="size-4 animate-spin" />}
              Confirmar cancelación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: detalle de una operatoria — timeline de pasos con la duración de cada uno. */}
      <Dialog open={!!detalleCx} onOpenChange={o => { if (!o) { setDetalleCx(null); setEventos([]); } }}>
        {/* Modal canónico (DESIGN §4.1) de solo lectura: header → cuerpo con scroll → footer. */}
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle><Activity className="size-5 text-brand" aria-hidden="true" /> Detalle de cirugía</DialogTitle>
            <DialogDescription>Pasos de la operatoria y la duración de cada uno.</DialogDescription>
          </DialogHeader>
          <DialogBody>
          {detalleCx && (
            <>
              {/* Resumen: caja de agrupación (§6.1). */}
              <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-semibold leading-tight text-foreground">{detalleCx.pacienteNombre || 'Paciente'}</span>
                  <EstadoBadge estado={detalleCx.estado} hist />
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                  <BedDouble className="size-3.5" aria-hidden="true" />
                  {formatBedName(detalleCx.camaOrigen)}
                  {detalleCx.camaDestino && detalleCx.camaDestino !== detalleCx.camaOrigen && (<><ArrowRight className="size-3" aria-hidden="true" />{formatBedName(detalleCx.camaDestino)}</>)}
                  {detalleCx.tipo && (<><span aria-hidden="true">·</span><span>{detalleCx.tipo}</span></>)}
                </div>
                <dl className="grid grid-cols-3 gap-2">
                  <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Inicio</dt><dd className="text-xs font-medium text-foreground tabular-nums">{fh(detalleCx.createdAt)}</dd></div>
                  <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cierre</dt><dd className="text-xs font-medium text-foreground tabular-nums">{fh(detalleCx.fechaCierre)}</dd></div>
                  <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Duración</dt><dd className="text-xs font-semibold text-foreground tabular-nums">{fmtDuracion(detalleCx.createdAt, detalleCx.fechaCierre)}</dd></div>
                </dl>
              </div>

              {/* Timeline de pasos: cada paso con la duración desde el anterior y quién lo hizo. */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Pasos</p>
                {loadingEventos ? (
                  <Cargando texto="Cargando pasos…" className="py-6" />
                ) : eventos.length === 0 ? (
                  <Vacio icono={Clock} titulo="Sin pasos registrados" descripcion="Esta operatoria no tiene pasos cargados." className="py-6" />
                ) : (
                  <ol className="pl-1">
                    {eventos.map((e, i) => {
                      const dur = i > 0 ? fmtDuracion(eventos[i - 1].at, e.at) : null;
                      const last = i === eventos.length - 1;
                      const quien = e.operador || e.usuario;
                      return (
                        <li key={i} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            {/* Punto de la línea: el de una corrección ("Volvió un paso") va en tono aviso. */}
                            <div className={cn("size-2.5 rounded-full mt-1.5 shrink-0", esRetroceso(e) ? PUNTO_TONO.aviso : "bg-primary")} />
                            {!last && <div className="w-px flex-1 bg-border my-0.5" />}
                          </div>
                          <div className={cn("min-w-0", last ? "pb-1" : "pb-4")}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-foreground">{cirugiaEventoLabel(e as { tipo: string; meta?: { de?: unknown; a?: unknown } })}</span>
                              {esRetroceso(e) && <StatusBadge tono="aviso">Corrección</StatusBadge>}
                              {dur && <span className="text-[11px] text-muted-foreground tabular-nums" title="Tiempo desde el paso anterior">+{dur}</span>}
                            </div>
                            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5 flex-wrap">
                              <Clock className="size-3" aria-hidden="true" /><span className="tabular-nums">{fh(e.at)}</span>
                              {quien && (<><span aria-hidden="true">·</span><UserIcon className="size-3" aria-hidden="true" />{quien}</>)}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </>
          )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setDetalleCx(null); setEventos([]); }}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
