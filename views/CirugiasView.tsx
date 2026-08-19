import React, { useEffect, useMemo, useState } from 'react';
import { Bed, CirugiaEstado, CirugiaTraslado, User, Area } from '../types';
import { can } from '../lib/permissions';
import { cn, formatBedName, formatDateTime, formatDateReadable } from '../lib/utils';
import { CIRUGIA_ESTADO_LABEL, CIRUGIA_ESTADO_SHORT, CIRUGIA_PILL_CLASS } from '../lib/constants';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Popover, PopoverTrigger, PopoverContent } from '../components/ui/popover';
import { Calendar } from '../components/ui/calendar';
import {
  Activity, ArrowRight, BedDouble, CheckCircle2, Clock, RefreshCw, Search, X, XCircle, AlertTriangle,
  Calendar as CalendarIcon, Eye, User as UserIcon,
} from 'lucide-react';

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
  onRecibida: (id: string) => Promise<TxResult>;
  onTolerancia?: (id: string) => Promise<TxResult>;
  onCancelar: (id: string, motivo: string) => Promise<TxResult>;
  onRefresh?: () => void | Promise<void>;
}

const Pill: React.FC<{ estado: CirugiaEstado; short?: boolean }> = ({ estado, short }) => (
  <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-tight whitespace-nowrap', CIRUGIA_PILL_CLASS[estado])}>
    <Activity className="w-3 h-3 shrink-0" strokeWidth={3} /> Cx · {(short ? CIRUGIA_ESTADO_SHORT : CIRUGIA_ESTADO_LABEL)[estado]}
  </span>
);

// Orden del flujo para ordenar la lista ÚNICA (la columna Estado reemplaza a las secciones
// separadas, para dar concordancia con Traslados/Limpiezas/Comandas).
const ORDEN_ESTADO: Record<string, number> = {
  LISTO_PARA_CIRUGIA: 0, VAN_A_BUSCAR: 1, EN_TRASLADO: 2, EN_CIRUGIA: 3, EN_DEVOLUCION: 4, RECIBIDA: 5,
};

// Fecha+hora absoluta (para el histórico: inicio/cierre de la operatoria).
const fmtWhen = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
};

// Label legible de un paso (cirugia_eventos.tipo): reusa las etiquetas de estado, fallback al raw.
const pasoLabel = (tipo: string): string => (CIRUGIA_ESTADO_LABEL as Record<string, string>)[tipo] ?? tipo;

// Columnas de HORA por paso en la grilla Activas: cada una muestra cuándo se alcanzó ese estado
// (de c.pasos, poblado por el backend). El label es el pedido por negocio, no el técnico.
// TOLERANCIA_EVALUADA NO va acá: al evaluarse cierra la operatoria y la saca de Activas → esa
// columna nunca se llenaría. La hora de tolerancia se ve en el detalle del Histórico.
const STEP_COLS: { key: string; label: string }[] = [
  { key: 'EN_TRASLADO', label: 'Retirado' },
  { key: 'EN_CIRUGIA',  label: 'En cirugía' },
  { key: 'RECIBIDA',    label: 'Recibido' },
];

// Fecha+hora compactas de un paso ("18/08" + "12:40") o null si no se hizo aún.
const pasoTime = (iso?: string): { dia: string; hora: string } | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return { dia: `${p(d.getDate())}/${p(d.getMonth() + 1)}`, hora: `${p(d.getHours())}:${p(d.getMinutes())}` };
};

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

// Trigger de fecha del histórico (Popover + Calendar), calcado del de Limpiezas para mantener el
// mismo look de las pills Desde/Hasta.
const DateRangeTrigger = React.forwardRef<
  HTMLButtonElement,
  { label: string; value: string } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ label, value, className, ...props }, ref) => (
  <button ref={ref} type="button"
    className={cn("w-full h-full px-4 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors outline-none", className)}
    {...props}>
    <CalendarIcon className="w-3.5 h-3.5 text-slate-400" />
    <div className="flex flex-col justify-center pointer-events-none">
      <span className="text-[7px] uppercase font-bold text-slate-400 leading-none mb-0.5">{label}</span>
      <span className="text-xs font-bold leading-none text-slate-900">{value ? formatDateReadable(value) : '---'}</span>
    </div>
  </button>
));
DateRangeTrigger.displayName = 'DateRangeTrigger';

export const CirugiasView: React.FC<Props> = ({
  cirugias, beds, currentUser, onVanABuscar, onEnTraslado, onEnCirugia, onEnDevolucion, onRecibida, onTolerancia, onCancelar, onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Panel inline "Cancelar": id + motivo tipeado.
  const [cancelando, setCancelando] = useState<{ id: string; motivo: string } | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

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
  const [openFrom, setOpenFrom] = useState(false);
  const [openTo, setOpenTo]     = useState(false);

  const fetchHistory = React.useCallback(async () => {
    setLoadingHist(true);
    try {
      const token = localStorage.getItem('mediflow_token');
      const r = await fetch(`/api/cirugia?history=1&from=${from}&to=${to}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (r.ok) {
        const data = await r.json();
        const rows: CirugiaTraslado[] = (data.cirugias ?? [])
          .sort((a: CirugiaTraslado, b: CirugiaTraslado) => String(b.fechaCierre ?? '').localeCompare(String(a.fechaCierre ?? '')));
        setHistory(rows);
      }
    } catch { /* mantiene lo previo ante fallo transitorio */ }
    finally { setLoadingHist(false); }
  }, [from, to]);

  // Auto-carga al entrar al histórico y al cambiar las fechas.
  useEffect(() => { if (tab === 'historico') fetchHistory(); }, [tab, fetchHistory]);

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

  // Botones de acción de CIRUGÍA por estado (orden feliz de la máquina de estados). Cada uno se
  // muestra SOLO si el rol tiene el permiso de esa acción — así un rol con todos los cirugia_*
  // (Admin) gestiona todo desde acá, y uno de quirófano ve solo sus pasos.
  const renderCirugiaActions = (c: CirugiaTraslado) => {
    const p = isPending(c.id);
    switch (c.estado) {
      case 'LISTO_PARA_CIRUGIA':
        return can(currentUser, 'cirugia_buscar') ? (
          <Button size="sm" disabled={p} onClick={() => withPending(c.id, () => onVanABuscar(c.id))}
            className="h-8 text-[10px] uppercase font-bold tracking-tight bg-orange-500 hover:bg-orange-600 text-white">
            <ArrowRight className="w-3.5 h-3.5 mr-1.5" /> Voy a buscar
          </Button>
        ) : null;
      case 'VAN_A_BUSCAR':
        // El camillero llegó y la enfermera ENTREGA al paciente ("se lo llevó"). Acción de
        // Enfermería (también en el mapa), expuesta acá para un rol que gestione todo.
        return can(currentUser, 'cirugia_entregar') ? (
          <Button size="sm" disabled={p} onClick={() => withPending(c.id, () => onEnTraslado(c.id))}
            className="h-8 text-[10px] uppercase font-bold tracking-tight bg-yellow-500 hover:bg-yellow-600 text-white">
            <ArrowRight className="w-3.5 h-3.5 mr-1.5" /> Se lo llevó el camillero
          </Button>
        ) : null;
      case 'EN_TRASLADO':
        return can(currentUser, 'cirugia_operar') ? (
          <Button size="sm" disabled={p} onClick={() => withPending(c.id, () => onEnCirugia(c.id))}
            className="h-8 text-[10px] uppercase font-bold tracking-tight bg-cyan-600 hover:bg-cyan-700 text-white">
            <Activity className="w-3.5 h-3.5 mr-1.5" /> En cirugía
          </Button>
        ) : null;
      case 'EN_CIRUGIA':
        // "En devolución": el paciente vuelve. YA NO se elige destino — Admisión lo mueve en PROGAL
        // y el cron detecta la cama. Acción directa (sin modal).
        return can(currentUser, 'cirugia_devolver') ? (
          <Button size="sm" disabled={p} onClick={() => withPending(c.id, () => onEnDevolucion(c.id))}
            className="h-8 text-[10px] uppercase font-bold tracking-tight bg-violet-600 hover:bg-violet-700 text-white">
            <BedDouble className="w-3.5 h-3.5 mr-1.5" /> En devolución
          </Button>
        ) : null;
      case 'EN_DEVOLUCION':
        // La recepción la confirma ENFERMERÍA del piso destino (desde el Mapa de Camas). También
        // acá para un rol que gestione todo.
        return can(currentUser, 'cirugia_recibir') ? (
          <Button size="sm" disabled={p} onClick={() => withPending(c.id, () => onRecibida(c.id))}
            className="h-8 text-[10px] uppercase font-bold tracking-tight bg-emerald-600 hover:bg-emerald-700 text-white">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Recibida
          </Button>
        ) : null;
      case 'RECIBIDA':
        // Evaluación de tolerancia: la hace quien recibió; CIERRA el ticket. Nuevo permiso.
        return can(currentUser, 'cirugia_tolerancia') && onTolerancia ? (
          <Button size="sm" disabled={p} onClick={() => withPending(c.id, () => onTolerancia(c.id))}
            className="h-8 text-[10px] uppercase font-bold tracking-tight bg-green-600 hover:bg-green-700 text-white">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Evaluación de tolerancia
          </Button>
        ) : null;
      default:
        return null;
    }
  };

  const renderRow = (c: CirugiaTraslado) => {
    const p = isPending(c.id);
    const camaChange = !!c.camaDestino && c.camaDestino !== c.camaOrigen;
    return (
      <Card key={c.id} className="p-3.5 border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          {/* Info del paciente (ocupa el ancho disponible) */}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-black text-slate-900 text-sm uppercase tracking-tight truncate">
                {c.pacienteNombre || 'Paciente s/nombre'}
              </span>
              <Pill estado={c.estado} />
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 flex-wrap">
              <BedDouble className="w-3.5 h-3.5 text-slate-400" />
              <span>{formatBedName(c.camaOrigen)}</span>
              {camaChange && (
                <>
                  <ArrowRight className="w-3 h-3 text-violet-500" />
                  <span className="text-violet-700">{formatBedName(c.camaDestino!)}</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[9px] font-black uppercase">
                    <AlertTriangle className="w-2.5 h-2.5" /> cambió (era {formatBedName(c.camaOrigen)})
                  </span>
                </>
              )}
              <span className="text-slate-300">·</span>
              <span className="text-slate-400 font-medium">{areaLabel(c.area)}</span>
              {c.tipo && (<>
                <span className="text-slate-300">·</span>
                <span className="text-cyan-800 font-bold" title="Tipo de internación (PROGAL)">{c.tipo}</span>
              </>)}
              <span className="text-slate-300">·</span>
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 font-medium" title="Ingreso al flujo de cirugía">
                <Clock className="w-3 h-3" /> {formatDateTime(c.createdAt)}
              </span>
              {STEP_COLS.map(col => {
                const t = pasoTime(c.pasos?.[col.key]);
                return (
                  <span key={col.key} className="inline-flex items-center gap-1 text-[10px]">
                    <span className="text-slate-300">·</span>
                    <span className="text-[9px] font-semibold uppercase text-slate-400">{col.label}</span>
                    {t ? <span className="font-bold text-violet-700 whitespace-nowrap">{t.dia} {t.hora}</span> : <span className="text-slate-300">—</span>}
                  </span>
                );
              })}
            </div>
            {rowError[c.id] && (
              <p className="text-[10px] font-bold text-red-600">{rowError[c.id]}</p>
            )}
          </div>

          {/* Acciones (pinneadas a la derecha en desktop) */}
          <div className="flex items-center gap-1.5 flex-wrap md:justify-end md:shrink-0">
            {renderCirugiaActions(c)}
            {c.estado !== 'RECIBIDA' && can(currentUser, 'cirugia_cancelar') && (
              <Button size="sm" variant="outline" disabled={p}
                onClick={() => setCancelando({ id: c.id, motivo: '' })}
                className="h-8 text-[10px] uppercase font-bold tracking-tight border-red-200 text-red-600 hover:bg-red-50">
                <XCircle className="w-3.5 h-3.5 mr-1.5" /> Cancelar
              </Button>
            )}
          </div>
        </div>
      </Card>
    );
  };

  // Fila de la tabla DESKTOP — una sola grilla con columna Estado (concordancia con los otros módulos).
  const renderTableRow = (c: CirugiaTraslado) => {
    const p = isPending(c.id);
    const camaChange = !!c.camaDestino && c.camaDestino !== c.camaOrigen;
    return (
      <tr key={c.id} className="align-middle hover:bg-slate-50/60">
        {/* Estado (columna a la izquierda de todo) */}
        <td className="px-4 py-3"><Pill estado={c.estado} short /></td>
        {/* Paciente + área/ingreso + tipo */}
        <td className="px-4 py-3">
          <p className="font-black text-slate-800 leading-tight break-words uppercase">{c.pacienteNombre || 'Paciente s/nombre'}</p>
          <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1 flex-wrap">
            <span>{areaLabel(c.area)}</span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1" title="Ingreso al flujo de cirugía"><Clock className="w-3 h-3 text-slate-400" /> {formatDateTime(c.createdAt)}</span>
            {c.tipo && (<>
              <span className="text-slate-300">·</span>
              <span className="text-cyan-800 font-bold" title="Tipo de internación (PROGAL)">{c.tipo}</span>
            </>)}
          </p>
        </td>
        {/* Cama (origen → destino si cambió) */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5 text-[12px] font-bold text-slate-700 flex-wrap">
            <span>{formatBedName(c.camaOrigen)}</span>
            {camaChange && (<>
              <ArrowRight className="w-3 h-3 text-violet-500 shrink-0" />
              <span className="text-violet-700">{formatBedName(c.camaDestino!)}</span>
            </>)}
          </div>
          {camaChange && (
            <span className="inline-flex items-center gap-1 mt-1 rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[9px] font-black uppercase">
              <AlertTriangle className="w-2.5 h-2.5" /> cambió (era {formatBedName(c.camaOrigen)})
            </span>
          )}
        </td>
        {/* Hora de cada paso (Retirado / En cirugía / Recibido / Tolerancia) — vacío si no se hizo aún */}
        {STEP_COLS.map(col => {
          const t = pasoTime(c.pasos?.[col.key]);
          return (
            <td key={col.key} className="px-4 py-3">
              {t
                ? <div className="leading-tight"><span className="block text-[9px] text-slate-400 font-medium">{t.dia}</span><span className="text-[11px] font-bold text-slate-700 whitespace-nowrap">{t.hora}</span></div>
                : <span className="text-slate-300">—</span>}
            </td>
          );
        })}
        {/* Acciones */}
        <td className="px-4 py-3">
          {rowError[c.id] && <p className="text-[10px] font-bold text-red-600 mb-1">{rowError[c.id]}</p>}
          <div className="flex items-center gap-1.5 flex-wrap">
            {renderCirugiaActions(c)}
            {c.estado !== 'RECIBIDA' && can(currentUser, 'cirugia_cancelar') && (
              <Button size="sm" variant="outline" disabled={p}
                onClick={() => setCancelando({ id: c.id, motivo: '' })}
                className="h-8 text-[10px] uppercase font-bold tracking-tight border-red-200 text-red-600 hover:bg-red-50">
                <XCircle className="w-3.5 h-3.5 mr-1.5" /> Cancelar
              </Button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  // Cirugía seleccionada por el modal de cancelación (lookup por id): una instancia a nivel vista.
  const cancelCx = cancelando ? cirugias.find(c => c.id === cancelando.id) ?? null : null;

  return (
    <div className="p-4 md:p-8 animate-in slide-in-from-right-4 duration-300 max-w-full space-y-5">
      {/* Sub-solapas: Activas | Histórico (mismo patrón que el histórico de Limpiezas) */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        {(['activas', 'historico'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-xs font-bold uppercase tracking-wide border-b-2 -mb-px transition-colors",
              tab === t ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-400 hover:text-slate-600"
            )}>
            {t === 'activas' ? 'Activas' : 'Histórico'}
          </button>
        ))}
      </div>

      {tab === 'activas' ? (
        <>
          {/* Header: buscador + refrescar */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 lg:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                placeholder="Paciente o cama…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-8 h-10 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-emerald-400" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {onRefresh && (
              <Button variant="outline" onClick={() => onRefresh()} className="h-10 gap-2 rounded-xl">
                <RefreshCw className="w-3.5 h-3.5" /> <span className="hidden sm:inline text-xs font-bold">Refrescar</span>
              </Button>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="py-20 text-center opacity-30">
              <Activity className="w-12 h-12 mx-auto mb-3" />
              <p className="text-xs font-black uppercase tracking-widest">Sin cirugías activas</p>
            </div>
          ) : (
            <>
              {/* Mobile — tarjetas (una sola lista, ordenada por el flujo) */}
              <div className="space-y-3 md:hidden">
                {ordenadas.map(renderRow)}
              </div>

              {/* Desktop — una sola tabla con columna Estado (concordancia con Traslados/Limpiezas/Comandas) */}
              <Card className="hidden md:block shadow-sm border-slate-200 overflow-hidden bg-white rounded-2xl">
                <div className="overflow-x-auto">
                <table className="w-full text-sm table-fixed min-w-[720px]">
                  <colgroup>
                    <col className="w-[11%]" /><col className="w-[20%]" /><col className="w-[9%]" />
                    <col className="w-[12%]" /><col className="w-[13%]" /><col className="w-[12%]" /><col className="w-[23%]" />
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 font-bold">
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3">Paciente</th>
                      <th className="px-4 py-3">Cama</th>
                      <th className="px-4 py-3">Retirado</th>
                      <th className="px-4 py-3">En cirugía</th>
                      <th className="px-4 py-3">Recibido</th>
                      <th className="px-4 py-3">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ordenadas.map(renderTableRow)}
                  </tbody>
                </table>
                </div>
              </Card>
            </>
          )}
        </>
      ) : (
        <>
          {/* Histórico: rango de fecha (cierre) + buscador + lista de cerradas */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px] lg:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                placeholder="Paciente, cama, código…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-8 h-10 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-emerald-400" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center bg-white border border-slate-200 rounded-xl overflow-hidden h-10">
              <Popover open={openFrom} onOpenChange={setOpenFrom}>
                <PopoverTrigger asChild>
                  <DateRangeTrigger label="Desde" value={from} className="h-full text-xs" />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-4 bg-white shadow-2xl z-50">
                  <Calendar selected={from} onSelect={(date) => { setFrom(date); setOpenFrom(false); }} />
                </PopoverContent>
              </Popover>
              <div className="w-px h-5 bg-slate-100 shrink-0" />
              <Popover open={openTo} onOpenChange={setOpenTo}>
                <PopoverTrigger asChild>
                  <DateRangeTrigger label="Hasta" value={to} className="h-full text-xs" />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-4 bg-white shadow-2xl z-50">
                  <Calendar selected={to} onSelect={(date) => { setTo(date); setOpenTo(false); }} />
                </PopoverContent>
              </Popover>
            </div>
            <Button variant="outline" size="sm" onClick={() => fetchHistory()} disabled={loadingHist}
              className="h-10 px-3 rounded-xl gap-2 text-xs font-bold text-slate-600">
              <RefreshCw className={cn("w-4 h-4", loadingHist && "animate-spin")} /> <span className="hidden sm:inline">Actualizar</span>
            </Button>
            <p className="text-xs text-slate-500 font-medium ml-auto self-center">
              {visibleHistory.length} {visibleHistory.length === 1 ? 'cirugía' : 'cirugías'}
            </p>
          </div>

          {loadingHist ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400 text-sm">Cargando…</div>
          ) : visibleHistory.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400">
              <Clock className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              <p className="font-bold text-sm text-slate-500">{search.trim() ? 'Sin resultados para la búsqueda' : 'Sin cirugías cerradas en el rango'}</p>
              <p className="text-xs">{search.trim() ? 'Probá con otro texto o limpiá el buscador.' : 'Ajustá las fechas para ver el histórico.'}</p>
            </div>
          ) : (
            <>
              {/* Mobile — tarjetas */}
              <div className="grid grid-cols-1 gap-3 md:hidden">
                {visibleHistory.map(c => (
                  <div key={c.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-black text-sm text-slate-800 leading-tight uppercase">{c.pacienteNombre || 'Paciente'}</p>
                      <Pill estado={c.estado as CirugiaEstado} short />
                    </div>
                    <p className="text-[11px] text-slate-500 font-medium flex items-center gap-1.5">
                      <BedDouble className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      {formatBedName(c.camaOrigen)}
                      {c.camaDestino && c.camaDestino !== c.camaOrigen && (<><ArrowRight className="w-3 h-3 shrink-0" />{formatBedName(c.camaDestino)}</>)}
                    </p>
                    <div className="text-[11px] text-slate-600 space-y-1">
                      <p className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-slate-400" />Inicio: {fmtWhen(c.createdAt)}</p>
                      <p className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-slate-400" />Cierre: {fmtWhen(c.fechaCierre)}</p>
                      <p className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-slate-400" />Duración: {fmtDuracion(c.createdAt, c.fechaCierre)}{c.tipo ? ` · ${c.tipo}` : ''}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => openDetalle(c)}
                      className="w-full h-9 rounded-lg gap-1.5 text-[11px] font-bold uppercase tracking-tight text-slate-600">
                      <Eye className="w-3.5 h-3.5" /> Ver detalle
                    </Button>
                  </div>
                ))}
              </div>

              {/* Desktop — tabla */}
              <Card className="hidden md:block shadow-sm border-slate-200 overflow-hidden bg-white rounded-2xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 font-bold">
                        <th className="px-4 py-3">Estado</th>
                        <th className="px-4 py-3">Paciente</th>
                        <th className="px-4 py-3">Cama</th>
                        <th className="px-4 py-3">Inicio</th>
                        <th className="px-4 py-3">Cierre</th>
                        <th className="px-4 py-3">Duración</th>
                        <th className="px-4 py-3">Tipo</th>
                        <th className="px-4 py-3 text-right">Detalle</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleHistory.map(c => (
                        <tr key={c.id} className="hover:bg-slate-50/60">
                          <td className="px-4 py-3"><Pill estado={c.estado as CirugiaEstado} short /></td>
                          <td className="px-4 py-3 font-bold text-slate-800 uppercase">{c.pacienteNombre || '—'}</td>
                          <td className="px-4 py-3 text-slate-600">
                            <span className="inline-flex items-center gap-1">
                              {formatBedName(c.camaOrigen)}
                              {c.camaDestino && c.camaDestino !== c.camaOrigen && (<><ArrowRight className="w-3 h-3 text-slate-400" />{formatBedName(c.camaDestino)}</>)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtWhen(c.createdAt)}</td>
                          <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtWhen(c.fechaCierre)}</td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap font-medium">{fmtDuracion(c.createdAt, c.fechaCierre)}</td>
                          <td className="px-4 py-3">
                            {c.tipo ? <span className="inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-800 border border-cyan-200">{c.tipo}</span> : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button size="sm" variant="outline" onClick={() => openDetalle(c)}
                              className="h-8 px-3 rounded-lg gap-1.5 text-[10px] font-bold uppercase tracking-tight text-slate-600">
                              <Eye className="w-3.5 h-3.5" /> Detalle
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </>
      )}


      {/* Modal: cancelar con motivo obligatorio. */}
      <Dialog open={!!cancelando} onOpenChange={o => { if (!o) setCancelando(null); }}>
        <DialogContent className="sm:max-w-[440px] rounded-3xl">
          <DialogHeader><DialogTitle className="text-xl">Cancelar cirugía</DialogTitle></DialogHeader>
          {cancelCx && (
            <div className="grid gap-3 py-2">
              <p className="text-sm text-slate-500">
                Vas a cancelar la operatoria de <span className="font-bold text-slate-700 uppercase">{cancelCx.pacienteNombre || 'el paciente'}</span>. Contanos por qué.
              </p>
              <textarea
                autoFocus rows={3} maxLength={500}
                value={cancelando?.motivo ?? ''}
                onChange={e => setCancelando(s => (s ? { ...s, motivo: e.target.value } : s))}
                placeholder="Ej: se suspendió la cirugía, alta del paciente…"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-200" />
              {rowError[cancelCx.id] && <p className="text-[11px] font-bold text-red-600">{rowError[cancelCx.id]}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelando(null)} className="rounded-xl h-11">Volver</Button>
            <Button
              disabled={!cancelCx || isPending(cancelCx.id) || !cancelando?.motivo.trim()}
              onClick={async () => {
                if (!cancelCx || !cancelando?.motivo.trim()) return;
                const r = await withPending(cancelCx.id, () => onCancelar(cancelCx.id, cancelando.motivo.trim()));
                if (r.ok) setCancelando(null);
              }}
              className="bg-red-600 hover:bg-red-700 text-white rounded-xl h-11 px-6 disabled:opacity-40">
              Confirmar cancelación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: detalle de una operatoria — timeline de pasos con la duración de cada uno. */}
      <Dialog open={!!detalleCx} onOpenChange={o => { if (!o) { setDetalleCx(null); setEventos([]); } }}>
        <DialogContent className="sm:max-w-[560px] rounded-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2"><Activity className="w-5 h-5 text-violet-600" /> Detalle de cirugía</DialogTitle>
          </DialogHeader>
          {detalleCx && (
            <div className="space-y-4 py-1">
              {/* Resumen */}
              <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-black text-slate-800 uppercase text-sm leading-tight">{detalleCx.pacienteNombre || 'Paciente'}</span>
                  <Pill estado={detalleCx.estado as CirugiaEstado} short />
                </div>
                <div className="flex items-center gap-1.5 text-[12px] font-bold text-slate-600 flex-wrap">
                  <BedDouble className="w-3.5 h-3.5 text-slate-400" />
                  {formatBedName(detalleCx.camaOrigen)}
                  {detalleCx.camaDestino && detalleCx.camaDestino !== detalleCx.camaOrigen && (<><ArrowRight className="w-3 h-3 text-violet-500" />{formatBedName(detalleCx.camaDestino)}</>)}
                  {detalleCx.tipo && (<><span className="text-slate-300">·</span><span className="text-cyan-800">{detalleCx.tipo}</span></>)}
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div><span className="block text-[9px] uppercase font-semibold text-slate-400">Inicio</span><span className="font-bold text-slate-700">{fmtWhen(detalleCx.createdAt)}</span></div>
                  <div><span className="block text-[9px] uppercase font-semibold text-slate-400">Cierre</span><span className="font-bold text-slate-700">{fmtWhen(detalleCx.fechaCierre)}</span></div>
                  <div><span className="block text-[9px] uppercase font-semibold text-slate-400">Duración</span><span className="font-bold text-violet-700">{fmtDuracion(detalleCx.createdAt, detalleCx.fechaCierre)}</span></div>
                </div>
              </div>

              {/* Timeline de pasos: cada paso con la duración desde el anterior y quién lo hizo. */}
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Pasos</p>
                {loadingEventos ? (
                  <p className="text-xs text-slate-400 py-4 text-center">Cargando pasos…</p>
                ) : eventos.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">Sin pasos registrados para esta operatoria.</p>
                ) : (
                  <div className="pl-1">
                    {eventos.map((e, i) => {
                      const dur = i > 0 ? fmtDuracion(eventos[i - 1].at, e.at) : null;
                      const last = i === eventos.length - 1;
                      const quien = e.operador || e.usuario;
                      return (
                        <div key={i} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <div className="w-2.5 h-2.5 rounded-full bg-violet-500 mt-1.5 shrink-0" />
                            {!last && <div className="w-px flex-1 bg-slate-200 my-0.5" />}
                          </div>
                          <div className={cn("min-w-0", last ? "pb-1" : "pb-4")}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-black uppercase tracking-tight text-slate-700">{pasoLabel(e.tipo)}</span>
                              {dur && <span className="text-[10px] font-bold text-violet-600" title="Tiempo desde el paso anterior">+{dur}</span>}
                            </div>
                            <p className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5 flex-wrap">
                              <Clock className="w-3 h-3 text-slate-400" />{fmtWhen(e.at)}
                              {quien && (<><span className="text-slate-300">·</span><UserIcon className="w-3 h-3 text-slate-400" />{quien}</>)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDetalleCx(null); setEventos([]); }} className="rounded-xl h-11">Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
