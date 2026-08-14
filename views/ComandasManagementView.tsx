import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Bed, User, Area, MealSlot, MEAL_SLOTS, mealSlotFromSp, mealSlotLabel, COMANDA_STATUS, ComandaStatus } from '../types';
import { cn, formatBedName, formatDateReadable, normalizeText } from '../lib/utils';
import { can } from '../lib/permissions';
import { comandaTipoPill } from './BedsView';
import { PlanificacionMenuModal } from '../components/modals/PlanificacionMenuModal';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Popover, PopoverTrigger, PopoverContent } from '../components/ui/popover';
import { Calendar } from '../components/ui/calendar';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Utensils, User as UserIcon, Clock, RefreshCw, Calendar as CalendarIcon, FileDown, FileSpreadsheet, CalendarDays, Check, X, Undo2, Loader2, Search } from 'lucide-react';
import { Input } from '../components/ui/input';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

// display map (copiado de BedsView, igual que CleaningManagementView).
const AREA_LABELS: Record<string, string> = {
  [Area.PISO_4]: 'Piso 4', [Area.PISO_5]: 'Piso 5', [Area.PISO_6]: 'Piso 6',
  [Area.PISO_7]: 'Piso 7', [Area.PISO_8]: 'Piso 8',
  [Area.HIT]: 'ITR', [Area.HRA]: 'Sala Espera', [Area.HSS]: 'Sueño',
  [Area.HUC]: 'UCO', [Area.HUQ]: 'URP', [Area.HUT]: 'UTI',
};
const areaLabel = (a?: string) => (a ? AREA_LABELS[a] ?? a : '—');

// Orden de DESPACHO de cocina: los platos salen por piso y, dentro del piso, por habitación.
// Pisos de internación primero (4→8), después ITR/Sala Espera, y los sectores críticos al
// final. Un área desconocida (999) va última en vez de romper el orden.
const AREA_DISPATCH_ORDER: string[] = [
  Area.PISO_4, Area.PISO_5, Area.PISO_6, Area.PISO_7, Area.PISO_8,
  Area.HIT, Area.HRA, Area.HUC, Area.HUT, Area.HUQ, Area.HSS,
];
const areaRank = (a: string): number => {
  const i = AREA_DISPATCH_ORDER.indexOf(a);
  return i === -1 ? 999 : i;
};

// Dentro de una misma cama+turno: titular primero, después los acompañantes por su número.
// (El desempate alfabético viejo ponía "Acompañante 1" antes que "Paciente".)
const comensalRank = (c: string): number =>
  c === 'Paciente' ? 0 : 1 + (Number(/\d+/.exec(c)?.[0]) || 0);

/**
 * ORDEN DE DESPACHO: piso → habitación → turno → comensal (antes era alfabético por
 * paciente). Es el orden en que cocina saca los platos, y como el PDF exporta las mismas
 * filas que la grilla, el papel sale igual que la pantalla. El collator numérico hace que
 * "401 - 02" < "405 - 01" < "702 - 01" como uno espera, no como strings. Y como la comanda
 * sigue al paciente, la habitación es la de ENTREGA real, no la de carga.
 * Buscar a un paciente puntual lo resuelve el buscador; la grilla optimiza el reparto.
 * Exportado para testearlo contra el comparador real.
 */
export const comandaDispatchCompare = (a: ComandaRow, b: ComandaRow): number =>
  areaRank(a.area) - areaRank(b.area) ||
  formatBedName(a.bedLabel).localeCompare(formatBedName(b.bedLabel), 'es', { numeric: true }) ||
  slotOrder(a.slot) - slotOrder(b.slot) ||
  comensalRank(a.comensal) - comensalRank(b.comensal);

/**
 * ¿Hace falta mostrar el sector, o ya lo dice el número de cama?
 *
 * En los pisos el número de habitación ARRANCA con el piso: "401 - 05" ya dice Piso 4, así que
 * poner "Piso 4" al lado es repetir el mismo dato dos veces.
 * En los sectores especiales (ITR, UTI, UCO, URP, Sala Espera, Sueño) la cama se numera sola
 * ("Cama 04") y sin el sector no se sabe dónde está → ahí SÍ se muestra.
 */
const PISOS = new Set<string>([Area.PISO_4, Area.PISO_5, Area.PISO_6, Area.PISO_7, Area.PISO_8]);
const sectorEsRedundante = (area?: string, bedLabel?: string): boolean => {
  if (!area || !PISOS.has(area)) return false;                 // sector especial → nunca redundante
  const piso = /Piso\s*(\d)/i.exec(AREA_LABELS[area] ?? '')?.[1];
  if (!piso) return false;
  // Redundante solo si el label realmente empieza con el dígito del piso (si el formato cambia,
  // falla del lado seguro: muestra el sector).
  return new RegExp(`(^|\\D)${piso}\\d{2}(\\D|$)`).test(String(bedLabel ?? ''));
};

/** Posición cronológica del turno según el catálogo. Turno desconocido → al final. */
const slotOrder = (slot: MealSlot | null): number => {
  const i = MEAL_SLOTS.findIndex(s => s.slot === slot);
  return i === -1 ? 99 : i;
};

const fmtWhen = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
};

// Color por turno. Es un `Record<MealSlot, …>` a propósito: si mañana se suma un turno al
// catálogo de types.ts, `tsc` obliga a darle color acá en vez de pintarlo como Cena.
// Progresión cromática a lo largo del día: amanecer → mediodía → tarde → noche.
const MEAL_PILL_CLS: Record<MealSlot, string> = {
  desayuno: 'bg-orange-50 text-orange-700 border-orange-200',
  almuerzo: 'bg-sky-50 text-sky-700 border-sky-200',
  merienda: 'bg-rose-50 text-rose-700 border-rose-200',
  cena:     'bg-violet-50 text-violet-700 border-violet-200',
};
const NEUTRAL_PILL_CLS = 'bg-slate-50 text-slate-600 border-slate-200';

// `slot` null = turno desconocido (fila vieja de SP): se muestra el crudo, sin inventar.
const comidaPill = (slot: MealSlot | null, raw: string): { label: string; cls: string } =>
  slot
    ? { label: mealSlotLabel(slot), cls: MEAL_PILL_CLS[slot] }
    : { label: raw || '—', cls: NEUTRAL_PILL_CLS };

const STATUS_PILL: Record<ComandaStatus, { label: string; cls: string }> = {
  [COMANDA_STATUS.PENDIENTE]: { label: 'Pendiente', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  [COMANDA_STATUS.ENTREGADO]: { label: 'Entregado', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  [COMANDA_STATUS.ANULADA]:   { label: 'Anulada',   cls: 'bg-slate-100 text-slate-400 border-slate-200' },
};

// ── Colores de los pills para el PDF ────────────────────────────────────────
// El PDF "como la grilla" repite los mismos tonos de pantalla; jspdf necesita RGB, no clases.
// Turno = bg-*-50 / text-*-700 (MEAL_PILL_CLS); Tipo = bg-*-100 / text-*-700 (comandaTipoPill de
// BedsView); Estado = los tonos de STATUS_PILL. Si cambia un color en pantalla, cambiarlo acá.
type Rgb = [number, number, number];
const PDF_TURNO_RGB: Record<MealSlot, { fill: Rgb; text: Rgb }> = {
  desayuno: { fill: [255, 247, 237], text: [194, 65, 12] },   // orange-50 / orange-700
  almuerzo: { fill: [240, 249, 255], text: [3, 105, 161] },   // sky-50 / sky-700
  merienda: { fill: [255, 241, 242], text: [190, 18, 60] },   // rose-50 / rose-700
  cena:     { fill: [245, 243, 255], text: [109, 40, 217] },  // violet-50 / violet-700
};
const PDF_NEUTRAL_RGB: { fill: Rgb; text: Rgb } = { fill: [248, 250, 252], text: [71, 85, 105] }; // slate-50 / slate-600
const pdfTipoRgb = (t?: string): { fill: Rgb; text: Rgb } =>
  t === 'MENU'   ? { fill: [209, 250, 229], text: [4, 120, 87] }    // emerald-100 / emerald-700
  : t === 'OPCION' ? { fill: [254, 243, 199], text: [180, 83, 9] }  // amber-100 / amber-700
  : { fill: [224, 231, 255], text: [67, 56, 202] };                 // indigo-100 / indigo-700
const pdfEstadoRgb = (s: ComandaStatus): { fill: Rgb; text: Rgb } =>
  s === COMANDA_STATUS.ENTREGADO ? { fill: [236, 253, 245], text: [4, 120, 87] }   // emerald-50 / emerald-700
  : s === COMANDA_STATUS.ANULADA ? { fill: [241, 245, 249], text: [148, 163, 184] } // slate-100 / slate-400
  : { fill: [255, 251, 235], text: [180, 83, 9] };                                  // amber-50 / amber-700

/**
 * Estado de la bandeja + sus acciones.
 *   Pendiente → [✓ entregar] [✕ anular]
 *   Entregado → [↩ volver a pendiente]  (para un check tocado por error)
 *   Anulada   → sin acciones (es histórico: se reponen cargándola de nuevo desde la tarjeta)
 */
/**
 * Hora de cierre (entrega/anulación) para mostrar junto al estado. Solo la hora si el
 * cierre fue el mismo día ART que la carga (el caso normal); con día ("22/7 13:45") si
 * cruzó de día — una bandeja "pendiente de ayer" entregada hoy no debe leerse como de ayer.
 */
const fmtCierre = (closedAt: string, at: string): string => {
  if (!closedAt) return '';
  const d = new Date(closedAt);
  if (isNaN(d.getTime())) return '';
  // hour12:false explícito: según la versión de ICU, es-AR puede salir "01:06 p. m.";
  // en una grilla de cocina tiene que ser 24h siempre ("13:06").
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' });
  const dia = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  if (at && dia(closedAt) !== dia(at)) {
    return `${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' })} ${hora}`;
  }
  return hora;
};

const StatusCell: React.FC<{
  r: ComandaRow; busy: boolean; canAct: boolean;
  onAction: (spItemId: string, action: 'entregar' | 'pendiente' | 'anular', label?: string) => void;
}> = ({ r, busy, canAct, onAction }) => {
  const p = STATUS_PILL[r.status] ?? STATUS_PILL[COMANDA_STATUS.PENDIENTE];
  const anulada = r.status === COMANDA_STATUS.ANULADA;
  const cierre = r.status !== COMANDA_STATUS.PENDIENTE ? fmtCierre(r.closedAt, r.at) : '';
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn('text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border', p.cls)}>{p.label}</span>
      {cierre && (
        <span className="text-[10px] font-bold text-slate-400 tabular-nums whitespace-nowrap"
          title={anulada ? 'Hora de anulación' : 'Hora de entrega'}>
          {cierre}
        </span>
      )}
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-300" />
        : canAct && !anulada && (
          r.status === COMANDA_STATUS.PENDIENTE ? (
            <>
              <button onClick={() => onAction(r.spItemId, 'entregar')} title="Marcar entregada" aria-label="Marcar entregada"
                className="h-9 w-9 md:h-6 md:w-6 rounded-xl md:rounded-md flex items-center justify-center border border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 active:scale-95 md:border-transparent md:bg-transparent md:text-slate-500 md:hover:bg-emerald-50 md:hover:text-emerald-600 transition-all">
                <Check className="w-4 h-4 md:w-3.5 md:h-3.5" strokeWidth={2.75} />
              </button>
              <button onClick={() => onAction(r.spItemId, 'anular', `${r.patientName} · ${r.comida}`)} title="Anular comanda" aria-label="Anular comanda"
                className="h-9 w-9 md:h-6 md:w-6 rounded-xl md:rounded-md flex items-center justify-center border border-red-200 bg-red-50 text-red-500 hover:bg-red-100 active:scale-95 md:border-transparent md:bg-transparent md:text-slate-500 md:hover:bg-red-50 md:hover:text-red-500 transition-all">
                <X className="w-4 h-4 md:w-3.5 md:h-3.5" strokeWidth={2.75} />
              </button>
            </>
          ) : (
            <button onClick={() => onAction(r.spItemId, 'pendiente')} title="Volver a pendiente" aria-label="Volver a pendiente"
              className="h-9 md:h-6 px-3 md:px-0 md:w-6 rounded-xl md:rounded-md flex items-center justify-center gap-1.5 border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 active:scale-95 md:border-transparent md:bg-transparent md:text-slate-500 md:hover:bg-amber-50 md:hover:text-amber-600 transition-all">
              <Undo2 className="w-4 h-4 md:w-3.5 md:h-3.5" strokeWidth={2.75} />
              <span className="text-[11px] font-bold md:hidden">Volver</span>
            </button>
          )
        )}
    </div>
  );
};

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

// Una comanda cargada (activa o histórica). Ambas tabs salen del endpoint /api/dietas
// ("De hoy" del GET de vivas; "Histórico" de /api/dietas?history=1) — no del overlay del mapa.
type ComandaRow = {
  key: string; patientName: string; bedLabel: string; area: string;
  // `slot` es la identidad del turno; `comida` es solo su texto para mostrar/exportar.
  // En el histórico `slot` puede ser null si SP tiene un `Comida_D` que no está en el catálogo.
  slot: MealSlot | null;
  comida: string; comensal: string; tipo: string; detalle: string; observaciones: string; by: string; at: string;
  spItemId: string;
  status: ComandaStatus;
  closedAt: string; // ISO de entrega/anulación (FechaCierre_D); '' si pendiente
  motivoAnulacion?: string; // por qué se anuló (solo en el histórico, filas anuladas)
};

/**
 * Texto buscable de una fila. Se indexa lo que el usuario VE, no el crudo de SharePoint:
 *  · `status` crudo es 'Activo'/'Inactivo' pero en pantalla dice "Pendiente"/"Anulada"
 *  · `tipo` vacío se pinta como "Otros"
 * Indexar el crudo sería un bug silencioso (buscás "pendiente" y no encuentra nada).
 *
 * Se agregan las formas SIN espacios de cama y sector ("40902", "piso5"): sin ellas, tipear
 * "piso 5" devuelve habitaciones del Piso 4 (el término "5" matchea el 405 del bedLabel), y
 * "409-02" no matchea nada. Con ellas, el filtro exacto se puede tipear junto.
 *
 * NO se indexa la fecha: ya están los datepickers, y meter "21/07/26, 14:30" en cada fila
 * ensucia justo las búsquedas numéricas por cama.
 */
const rowHaystack = (r: ComandaRow): string => normalizeText([
  r.patientName,
  r.bedLabel, formatBedName(r.bedLabel), formatBedName(r.bedLabel).replace(/[\s-]/g, ''),
  r.area, areaLabel(r.area), areaLabel(r.area).replace(/\s+/g, ''),
  r.comida,
  r.comensal,
  comandaTipoPill(r.tipo).label,
  r.detalle,
  r.observaciones,
  r.by,
  (STATUS_PILL[r.status] ?? STATUS_PILL[COMANDA_STATUS.PENDIENTE]).label,
].join(' '));

/**
 * Partición de "De hoy": la grilla arranca mostrando SOLO lo pendiente (lo que cocina
 * todavía tiene que sacar) y la botonera permite swapear a lo ya gestionado.
 * Entregada = status ENTREGADO estricto; TODO lo demás (pendiente o un status inesperado)
 * queda en Pendientes — del lado seguro: ninguna bandeja desaparece de las dos vistas por
 * un dato raro. Preserva el orden de entrada (las filas ya vienen en orden de despacho).
 * Exportada para testearla contra la función real.
 */
export const splitComandasPorEntrega = (rows: ComandaRow[]): { pendientes: ComandaRow[]; entregadas: ComandaRow[] } => {
  const pendientes: ComandaRow[] = [], entregadas: ComandaRow[] = [];
  for (const r of rows) (r.status === COMANDA_STATUS.ENTREGADO ? entregadas : pendientes).push(r);
  return { pendientes, entregadas };
};

// Mapea una fila cruda del endpoint de comandas (/api/dietas, "De hoy" o histórico) a ComandaRow.
// El crudo puede traer un `comida` fuera del catálogo (fila vieja) → slot null y se muestra tal cual.
export const mapComandaRow = (m: any): ComandaRow => {
  const slot = mealSlotFromSp(m.comida);
  return {
    key: String(m.spItemId),
    patientName: String(m.patientName || '—'),
    bedLabel: String(m.bedLabel ?? ''), area: String(m.area ?? ''),
    slot, comida: slot ? mealSlotLabel(slot) : String(m.comida ?? ''),
    comensal: String(m.comensal ?? '') === 'ACOMPANANTE' ? `Acompañante ${m.orden ?? ''}`.trim() : 'Paciente',
    spItemId: String(m.spItemId ?? ''),
    status: (String(m.status ?? '') || COMANDA_STATUS.PENDIENTE) as ComandaStatus,
    tipo: String(m.tipo ?? ''),
    detalle: String(m.detalle ?? ''), observaciones: String(m.observaciones ?? ''),
    by: String(m.by ?? ''), at: String(m.at ?? ''),
    closedAt: String(m.closedAt ?? ''),
    motivoAnulacion: String(m.motivoAnulacion ?? ''),
  };
};

interface Props {
  beds: Bed[];
  currentUser: User | null;
  onRefresh?: () => void | Promise<void>;
  onSetMealStatus?: (spItemId: string, action: 'entregar' | 'pendiente' | 'anular', motivo?: string) => Promise<{ ok: boolean }>;
}

export const ComandasManagementView: React.FC<Props> = ({ beds, currentUser, onRefresh, onSetMealStatus }) => {
  const areaOk = useCallback((area: string) =>
    !currentUser?.filterByFloors
    || !currentUser?.assignedAreas?.length
    || currentUser.assignedAreas.includes(area as Area), [currentUser]);

  // ── "De hoy" (activas) — filas del endpoint de comandas, NO del overlay del mapa ────────────
  // SERVER-BACKED: las filas salen de /api/dietas (status vivo + dia=hoy o pendiente), NO de
  // beds.meals. Así una comanda ENTREGADA sigue apareciendo aunque el paciente ya no esté en la cama
  // (alta/rotación): el overlay la dropeaba porque mergeBeds la ata al ocupante VIVO de Gamma
  // (reporte piso 8, ago 2026 — media planta rotó tras el desayuno). fetchToday se define abajo
  // (necesita authFetch); fetchTodayRef permite refrescar tras una acción; todaySeqRef = última gana.
  const [todayRows, setTodayRows] = useState<ComandaRow[]>([]);
  const [loadingToday, setLoadingToday] = useState(true);
  const fetchTodayRef = React.useRef<null | (() => void)>(null);
  const todaySeqRef = React.useRef(0);
  const rows = todayRows;

  // Contadores de la botonera: se calculan SOBRE rows (pre-búsqueda) — dicen cuántas
  // existen, no cuántas matchean el buscador.
  const { pendientes, entregadas } = useMemo(() => splitComandasPorEntrega(rows), [rows]);

  // ── Histórico (por fecha de carga) ──────────────────────────────────────────
  const [tab, setTab] = useState<'activas' | 'historico'>('activas');
  // Día ART (mismo criterio que el server filtra FechaCarga), evita off-by-one de UTC de noche.
  const artDayStr = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const todayStr   = artDayStr(Date.now());
  const weekAgoStr = artDayStr(Date.now() - 7 * 864e5);
  const [from, setFrom] = useState(weekAgoStr);
  const [to, setTo]     = useState(todayStr);
  const [history, setHistory] = useState<ComandaRow[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const [openFrom, setOpenFrom] = useState(false);
  const [openTo, setOpenTo]     = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  // Sub-vista de "De hoy": Pendientes es el default (lo accionable); Entregadas es la foto
  // de lo que ya se gestionó hoy. No participa del Histórico. Se conserva al ir y volver
  // de tab (es barato y predecible).
  const [vistaHoy, setVistaHoy] = useState<'pendientes' | 'entregadas'>('pendientes');
  // spItemId de la fila cuya acción está en vuelo → spinner solo en esa.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Refs: `doAction` se declara antes que `fetchHistory`/`tab` y no queremos recrearlo en cada
  // cambio de tab (recrearlo remontaría los botones de todas las filas).
  const fetchHistoryRef = React.useRef<null | (() => void)>(null);
  const tabRef = React.useRef<'activas' | 'historico'>('activas');

  // Ejecuta la acción contra el server (con motivo opcional para el anular).
  const runAction = useCallback(async (spItemId: string, action: 'entregar' | 'pendiente' | 'anular', motivo?: string) => {
    if (!onSetMealStatus || !spItemId) return;
    setBusyId(spItemId); setActionError(null);
    try {
      const r = await onSetMealStatus(spItemId, action, motivo);
      // Si falla NO se revierte mudo: el usuario ve por qué no pasó nada.
      if (!r.ok) setActionError('No se pudo actualizar la comanda. Reintentá.');
      // Ambas tabs son server-backed y tienen su propio fetch/estado → refrescar la que está activa.
      else if (tabRef.current === 'historico') fetchHistoryRef.current?.();
      else fetchTodayRef.current?.();
    } finally { setBusyId(null); }
  }, [onSetMealStatus]);

  // La anulación pide motivo (obligatorio, para el histórico) → abre un modal; el resto de las
  // acciones (entregar / volver a pendiente) van directo.
  const [anularTarget, setAnularTarget] = useState<{ spItemId: string; label: string } | null>(null);
  const [motivoInput, setMotivoInput] = useState('');
  const doAction = useCallback((spItemId: string, action: 'entregar' | 'pendiente' | 'anular', label?: string) => {
    if (action === 'anular') { setMotivoInput(''); setAnularTarget({ spItemId, label: label ?? '' }); return; }
    void runAction(spItemId, action);
  }, [runAction]);
  const confirmAnular = useCallback(() => {
    const t = anularTarget;
    if (!t || !motivoInput.trim()) return;
    setAnularTarget(null);
    void runAction(t.spItemId, 'anular', motivoInput.trim());
  }, [anularTarget, motivoInput, runAction]);
  // Ver la planificación alcanza para abrir el modal; adentro, el ABM se gatea por separado.
  const canSeePlan = can(currentUser, 'ver_planificacion') || can(currentUser, 'abm_planificacion');

  const authFetch = useCallback((url: string) => {
    const token = localStorage.getItem('mediflow_token');
    return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  }, []);

  const fetchHistory = useCallback(async () => {
    setLoadingHist(true);
    try {
      const r = await authFetch(`/api/dietas?history=1&from=${from}&to=${to}`);
      if (r.ok) {
        const data = await r.json();
        const rows: ComandaRow[] = (data.meals ?? [])
          .filter((m: any) => areaOk(String(m.area ?? '')))
          .map(mapComandaRow)
          // Por paciente, y adentro por fecha desc — así las bandejas de una misma cama quedan
          // juntas en vez de salteadas entre otras camas.
          .sort((a: ComandaRow, b: ComandaRow) =>
            a.patientName.localeCompare(b.patientName, 'es') ||
            String(b.at).localeCompare(String(a.at)) ||
            slotOrder(a.slot) - slotOrder(b.slot));
        setHistory(rows);
      }
    } catch { /* mantiene lo previo */ }
    finally { setLoadingHist(false); }
  }, [authFetch, from, to, areaOk]);

  useEffect(() => { if (tab === 'historico') fetchHistory(); }, [tab, fetchHistory]);
  useEffect(() => { fetchHistoryRef.current = fetchHistory; tabRef.current = tab; }, [fetchHistory, tab]);

  // "De hoy" server-backed: pega al GET de comandas vivas (dia=hoy + pendientes de días previos) y
  // arma las filas igual que el histórico, ordenadas por despacho (cama). NO depende del mapa vivo.
  const fetchToday = useCallback(async () => {
    // "Última request gana": con el refresco piggyback (cada cambio de beds) + el refetch de una
    // acción puede haber varios fetch en vuelo; si uno viejo resuelve tarde, pisaría con datos
    // stale (una entregada reapareciendo pendiente). El seq descarta cualquier respuesta que no
    // sea la del último disparo.
    const seq = ++todaySeqRef.current;
    try {
      const r = await authFetch('/api/dietas');
      if (r.ok) {
        const data = await r.json();
        const rows: ComandaRow[] = (data.meals ?? [])
          .filter((m: any) => areaOk(String(m.area ?? '')))
          .map(mapComandaRow)
          .sort(comandaDispatchCompare);
        if (seq === todaySeqRef.current) setTodayRows(rows);
      }
    } catch { /* mantiene lo previo */ }
    finally { if (seq === todaySeqRef.current) setLoadingToday(false); }
  }, [authFetch, areaOk]);

  // Carga inicial + refresco: al montar, al cambiar de usuario, y en cada actualización de `beds`
  // (piggyback del realtime/poll de comandas del hook) → se mantiene fresco sin canal propio.
  useEffect(() => { fetchToday(); }, [fetchToday, beds]);
  useEffect(() => { fetchTodayRef.current = fetchToday; }, [fetchToday]);

  const data = tab === 'activas' ? (vistaHoy === 'entregadas' ? entregadas : pendientes) : history;

  // El haystack se precalcula por FILA, no por tecla: `data` solo cambia con un poll o un
  // re-fetch del histórico. Así el trabajo por tecla es N includes() sobre strings ya
  // normalizados → no hace falta debounce.
  const indexed = useMemo(() => data.map(r => ({ r, h: rowHaystack(r) })), [data]);

  // Búsqueda en dos pasadas: FRASE EXACTA primero, y si no hay nada, AND de términos.
  //
  // El AND solo sería un falso-positivo generador: "piso 5" se parte en ["piso","5"], y en una
  // fila del Piso 4 cama 405 el "piso" matchea "piso 4" y el "5" matchea el "405" → la trae
  // igual. Probar la frase completa primero lo resuelve: "piso 5" solo aparece literal en las
  // filas del Piso 5.
  //
  // El fallback a AND se conserva porque es lo que hace útil buscar entre campos distintos:
  // "juan 405" (paciente + cama) no existe como frase en ningún lado, y ahí el AND sí es lo
  // que uno quiere.
  const query = normalizeText(searchFilter);
  const terms = query.split(' ').filter(Boolean);
  const filtered = useMemo(() => {
    if (terms.length === 0) return data;
    const porFrase = indexed.filter(({ h }) => h.includes(query));
    if (porFrase.length > 0) return porFrase.map(({ r }) => r);
    return indexed.filter(({ h }) => terms.every(t => h.includes(t))).map(({ r }) => r);
  }, [data, indexed, searchFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtrando = terms.length > 0;

  // Construye la tabla exportable (encabezados + filas) a partir de lo FILTRADO en pantalla.
  // La comparten PDF y Excel para que exporten exactamente las mismas columnas y datos.
  // "Fecha y hora" solo en el histórico. "Entrega": en el histórico o en la vista Entregadas de
  // hoy — la hora de entrega ya se ve en pantalla; en Pendientes la columna no aporta (todo '—').
  const buildExportTable = () => {
    const showDate = tab === 'historico';
    const showEntrega = showDate || vistaHoy === 'entregadas';
    const head: string[] = ['Paciente', 'Ubicación', 'Turno', 'Comensal', 'Tipo', 'Comanda', 'Registró', ...(showDate ? ['Fecha y hora'] : []), ...(showEntrega ? ['Entrega'] : [])];
    // Ubicación en una sola columna (la cama ya dice el piso); "Entrega" = hora en que se marcó
    // entregada ('—' si quedó pendiente; anuladas muestran la hora de anulación con el estado).
    const body: string[][] = filtered.map(r => [
      r.patientName,
      formatBedName(r.bedLabel) + (sectorEsRedundante(r.area, r.bedLabel) ? '' : ` · ${areaLabel(r.area)}`),
      r.comida, r.comensal, comandaTipoPill(r.tipo).label,
      r.detalle || '—', r.by || '—',
      ...(showDate ? [fmtWhen(r.at)] : []),
      ...(showEntrega ? [
        r.status === COMANDA_STATUS.ANULADA
          ? `Anulada${fmtCierre(r.closedAt, r.at) ? ` ${fmtCierre(r.closedAt, r.at)}` : ''}`
          : (r.status === COMANDA_STATUS.ENTREGADO ? (fmtCierre(r.closedAt, r.at) || '✓') : '—'),
      ] : []),
    ]);
    return { head, body };
  };

  // Nombre base del archivo (sin extensión), común a PDF y Excel.
  const exportFname = () => (tab === 'activas'
    ? `Comandas HPR - ${vistaHoy === 'entregadas' ? 'Entregadas ' : ''}${todayStr}`
    : `Comandas HPR - ${from} al ${to}`);

  // Descarga la vista actual a PDF REPRODUCIENDO LA GRILLA de pantalla (jspdf-autotable):
  // mismas 6 columnas (Paciente con la cama debajo · Turno · Tipo · Comanda con observaciones ·
  // Registró · Estado con la hora de cierre), los mismos pills de color, y SIN los botones de
  // acción (el papel es lectura). El Excel sigue siendo la tabla plana (buildExportTable).
  const handlePdf = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const title = tab === 'activas'
      ? (vistaHoy === 'entregadas' ? 'Comandas — Entregadas hoy' : 'Comandas — De hoy')
      : `Comandas — ${formatDateReadable(from)} a ${formatDateReadable(to)}`;
    doc.setFontSize(14); doc.setTextColor(2, 44, 34); doc.text(title, 14, 15); // verde Gamma #022C22
    doc.setFontSize(9); doc.setTextColor(120);
    // El PDF exporta lo FILTRADO: si el usuario buscó algo, el papel dice lo mismo que la pantalla.
    doc.text(`${filtered.length} comanda(s)${filtrando ? ` · filtro: "${searchFilter.trim()}"` : ''} · generado ${new Date().toLocaleString('es-AR')}`, 14, 21);
    doc.setTextColor(0);

    // Datos derivados por fila (los usan el cuerpo de la tabla y los hooks de dibujo). El orden es
    // el de `filtered`, que ya viene en orden de despacho (piso → cama → turno → comensal).
    const rows = filtered.map(r => {
      const esAcomp = r.comensal !== 'Paciente';
      const verSector = !sectorEsRedundante(r.area, r.bedLabel);
      const bedLine = formatBedName(r.bedLabel) + (verSector ? ` · ${areaLabel(r.area)}` : '');
      const anulada = r.status === COMANDA_STATUS.ANULADA;
      const cierre = r.status !== COMANDA_STATUS.PENDIENTE ? fmtCierre(r.closedAt, r.at) : '';
      const est = STATUS_PILL[r.status] ?? STATUS_PILL[COMANDA_STATUS.PENDIENTE];
      return { r, esAcomp, verSector, bedLine, anulada, cierre, est };
    });

    const body = rows.map(g => [
      // Col 0 (Paciente): se dibuja a mano en didDrawCell (nombre en negrita + cama en gris + pill
      // de acompañante). El contenido de texto acá es solo para que autotable calcule la altura.
      `${g.esAcomp ? g.r.comensal + '\n' : ''}${g.r.patientName}\n${g.bedLine}`,
      comidaPill(g.r.slot, g.r.comida).label,                    // Turno
      comandaTipoPill(g.r.tipo).label,                            // Tipo
      // Comanda + observaciones (la grilla siempre dice algo; un hueco vacío se lee como dato faltante).
      `${g.r.detalle || '—'}\n${g.r.observaciones || 'Sin observaciones'}${g.anulada && g.r.motivoAnulacion ? `\nMotivo anulación: ${g.r.motivoAnulacion}` : ''}`,
      `${g.r.by || '—'}\n${fmtWhen(g.r.at)}`,                      // Registró (quién + cuándo)
      `${g.est.label}${g.cierre ? `\n${g.cierre}` : ''}`,         // Estado + hora de cierre (sin acciones)
    ]);

    autoTable(doc, {
      head: [['Paciente', 'Turno', 'Tipo', 'Comanda', 'Registró', 'Estado']],
      body, startY: 26,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak', valign: 'top', textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: 0.1 }, // slate-800 / slate-200
      headStyles: { fillColor: [2, 44, 34], textColor: 255, fontStyle: 'bold', valign: 'middle', lineColor: [2, 44, 34] }, // verde Gamma #022C22
      // Anchos ~proporcionales a la grilla (24/10/9/26/14/17 % → 269 mm útiles en A4 apaisado).
      columnStyles: {
        0: { cellWidth: 62, fontSize: 9 },                                  // el 9 da altura de sobra para el dibujo a mano
        1: { cellWidth: 24, halign: 'center', valign: 'middle', fontStyle: 'bold', fontSize: 7.5 },
        2: { cellWidth: 22, halign: 'center', valign: 'middle', fontStyle: 'bold', fontSize: 7.5 },
        3: { cellWidth: 73 },
        4: { cellWidth: 40, fontSize: 7.5, textColor: [100, 116, 139] },    // slate-500
        5: { cellWidth: 47, halign: 'center', valign: 'middle', fontStyle: 'bold', fontSize: 7.5 },
      },
      // Pinta los pills de color (Turno/Tipo/Estado) y atenúa las anuladas, igual que en pantalla.
      didParseCell: (data) => {
        if (data.section !== 'body') return;
        const g = rows[data.row.index];
        if (!g) return;
        const ci = data.column.index;
        if (ci === 1) { const c = g.r.slot ? PDF_TURNO_RGB[g.r.slot] : PDF_NEUTRAL_RGB; data.cell.styles.fillColor = c.fill; data.cell.styles.textColor = c.text; }
        else if (ci === 2) { const c = pdfTipoRgb(g.r.tipo); data.cell.styles.fillColor = c.fill; data.cell.styles.textColor = c.text; }
        else if (ci === 5) { const c = pdfEstadoRgb(g.r.status); data.cell.styles.fillColor = c.fill; data.cell.styles.textColor = c.text; }
        else if (g.anulada) { data.cell.styles.textColor = [148, 163, 184]; } // slate-400: anulada = auditoría, atenuada
      },
      // Col 0 (Paciente) a mano: la celda de autotable no permite dos estilos por celda, así que se
      // borra su texto por defecto (rectángulo blanco interior, respetando el borde) y se redibuja.
      didDrawCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 0) return;
        const g = rows[data.row.index];
        if (!g) return;
        const { x, y, width, height } = data.cell;
        doc.setFillColor(255, 255, 255);
        doc.rect(x + 0.35, y + 0.35, width - 0.7, height - 0.7, 'F');
        const left = x + 2.2;
        const maxW = width - 4.4;
        let cy = y + 3.4;
        const dim = g.anulada;
        if (g.esAcomp) {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
          doc.setTextColor(...(dim ? [148, 163, 184] as Rgb : [13, 148, 136] as Rgb)); // teal-600
          doc.text(g.r.comensal.toUpperCase(), left, cy); cy += 3.1;
        }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
        doc.setTextColor(...(dim ? [148, 163, 184] as Rgb : [30, 41, 59] as Rgb));       // slate-800
        for (const nl of doc.splitTextToSize(g.r.patientName, maxW) as string[]) { doc.text(nl, left, cy); cy += 3.4; }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        doc.setTextColor(...(dim ? [203, 213, 225] as Rgb : [100, 116, 139] as Rgb));    // slate-500
        for (const bl of doc.splitTextToSize(g.bedLine, maxW) as string[]) { doc.text(bl, left, cy); cy += 3.1; }
        // Reset para que no se filtre a las celdas que autotable dibuja después.
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(30, 41, 59);
      },
    });
    doc.save(`${exportFname()}.pdf`);
  };

  // Descarga la tabla actual (De hoy / Histórico) a Excel (.xlsx) con SheetJS.
  // Mismas columnas y filtrado que el PDF; una sola hoja "Comandas".
  const handleExcel = () => {
    const { head, body } = buildExportTable();
    const ws = XLSX.utils.aoa_to_sheet([head, ...body]);
    // Anchos de columna aproximados para que se lea sin tener que estirar a mano.
    // Sigue el orden de `head`; "Comanda" (texto largo) más ancho.
    const widths = [22, 26, 10, 12, 16, 40, 18, 18, 16];
    ws['!cols'] = head.map((_, i) => ({ wch: widths[i] ?? 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Comandas');
    XLSX.writeFile(wb, `${exportFname()}.xlsx`);
  };

  // Mensaje del vacío: el buscador manda (decir "no hay comandas" cuando el filtro no
  // matcheó sería mentir), después la tab y, en "De hoy", la sub-vista.
  const vacio = filtrando
    ? { titulo: 'Sin resultados para la búsqueda', sub: 'Probá con otro término o limpiá el filtro.' }
    : tab === 'historico'
      ? { titulo: 'Sin comandas en el rango', sub: 'Ajustá las fechas para ver el histórico.' }
      : vistaHoy === 'entregadas'
        ? { titulo: 'Todavía no se entregó ninguna comanda hoy', sub: 'Marcá el check verde en una pendiente y aparece acá.' }
        : rows.length > 0
          ? { titulo: 'No quedan comandas pendientes', sub: 'Todo lo de hoy ya se entregó — está en «Entregadas».' }
          : { titulo: 'No hay comandas cargadas hoy', sub: 'Las comandas que carga Nutrición desde el mapa de camas aparecen acá.' };

  return (
    <div className="p-4 md:p-8 max-w-full w-full space-y-4 md:space-y-5 pb-24 md:pb-8">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 mb-4">
        {(['activas', 'historico'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-xs font-bold uppercase tracking-wide border-b-2 -mb-px transition-colors",
              tab === t ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-400 hover:text-slate-600"
            )}>
            {t === 'activas' ? 'De hoy' : 'Histórico'}
          </button>
        ))}
      </div>

      {/* Barra de acciones / filtros */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {tab === 'activas' && (
          /* Botonera Pendientes/Entregadas — mismo patrón segmentado que el selector de período
             del Monitor (DashboardView). Por defecto las entregadas NO están en la grilla; el
             contador avisa que existen. */
          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
            {([
              ['pendientes', `Pendientes (${pendientes.length})`],
              ['entregadas', `Entregadas (${entregadas.length})`],
            ] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setVistaHoy(k)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wide transition-colors tabular-nums',
                  vistaHoy === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                )}>
                {label}
              </button>
            ))}
          </div>
        )}
        {/* Buscador — aplica a las DOS tabs (comparten `data`, tabla, tarjetas, contador y PDF).
            max-w-sm es lo que preserva el ml-auto del contador de más abajo: no sacarlo. */}
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <Input
            placeholder="Paciente, cama, sector, turno, comanda, obs..."
            value={searchFilter}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchFilter(e.target.value)}
            className="pl-9 pr-8 h-9 text-xs rounded-xl border-slate-200"
          />
          {searchFilter && (
            <button onClick={() => setSearchFilter('')} title="Limpiar búsqueda"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {tab === 'historico' && (
          <>
            <div className="flex items-center bg-white border border-slate-200 rounded-xl overflow-hidden h-9">
              <Popover open={openFrom} onOpenChange={setOpenFrom}>
                <PopoverTrigger asChild><DateRangeTrigger label="Desde" value={from} className="h-full text-xs" /></PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-4 bg-white shadow-2xl z-50">
                  <Calendar selected={from} onSelect={(date) => { setFrom(date); setOpenFrom(false); }} />
                </PopoverContent>
              </Popover>
              <div className="w-px h-5 bg-slate-100 shrink-0" />
              <Popover open={openTo} onOpenChange={setOpenTo}>
                <PopoverTrigger asChild><DateRangeTrigger label="Hasta" value={to} className="h-full text-xs" /></PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-4 bg-white shadow-2xl z-50">
                  <Calendar selected={to} onSelect={(date) => { setTo(date); setOpenTo(false); }} />
                </PopoverContent>
              </Popover>
            </div>
            <Button variant="outline" size="sm" onClick={() => fetchHistory()} disabled={loadingHist}
              className="h-9 px-3 rounded-lg gap-2 text-xs font-bold text-slate-600">
              <RefreshCw className={cn("w-4 h-4", loadingHist && "animate-spin")} /> Actualizar
            </Button>
          </>
        )}
        {tab === 'activas' && (
          <Button variant="outline" size="sm" onClick={() => { fetchToday(); onRefresh?.(); }}
            className="h-9 px-3 rounded-lg gap-2 text-xs font-bold text-slate-600">
            <RefreshCw className="w-4 h-4" /> Actualizar
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={handlePdf} disabled={filtered.length === 0}
          className="h-9 px-3 rounded-lg gap-2 text-xs font-bold text-indigo-700 border-indigo-200 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50">
          <FileDown className="w-4 h-4" /> PDF
        </Button>
        <Button variant="outline" size="sm" onClick={handleExcel} disabled={filtered.length === 0}
          className="h-9 px-3 rounded-lg gap-2 text-xs font-bold text-green-700 border-green-200 bg-green-50 hover:bg-green-100 disabled:opacity-50">
          <FileSpreadsheet className="w-4 h-4" /> Excel
        </Button>
        {canSeePlan && (
          <Button variant="outline" size="sm" onClick={() => setPlanOpen(true)}
            className="h-9 px-3 rounded-lg gap-2 text-xs font-bold text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100">
            <CalendarDays className="w-4 h-4" /> Planificación
          </Button>
        )}
        <p className="text-xs text-slate-500 font-medium ml-auto self-center">
          {filtered.length} {filtered.length === 1 ? 'comanda' : 'comandas'}
          {filtrando && filtered.length !== data.length && <span className="text-slate-400"> de {data.length}</span>}
        </p>
      </div>

      <PlanificacionMenuModal open={planOpen} onOpenChange={setPlanOpen} currentUser={currentUser} />

      {actionError && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
          <p className="text-xs font-medium text-red-700">{actionError}</p>
          <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {((loadingHist && tab === 'historico') || (loadingToday && tab === 'activas' && todayRows.length === 0)) ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400 text-sm">Cargando…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400">
          <Utensils className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <p className="font-bold text-sm text-slate-500">{vacio.titulo}</p>
          <p className="text-xs">{vacio.sub}</p>
        </div>
      ) : (
        <>
          {/* Mobile — tarjetas */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {filtered.map(r => {
              const tp = comandaTipoPill(r.tipo);
              const cp = comidaPill(r.slot, r.comida);
              return (
                <div key={r.key} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-black text-sm text-slate-800 leading-tight">{r.patientName}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className={cn("text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border", cp.cls)}>{cp.label}</span>
                      <span className={cn("text-[9px] font-bold uppercase px-2 py-0.5 rounded-full", tp.cls)}>{tp.label}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium">
                    {formatBedName(r.bedLabel)}
                    {!sectorEsRedundante(r.area, r.bedLabel) && <span className="text-slate-400"> · {areaLabel(r.area)}</span>}
                    <span className={cn("ml-2 font-bold uppercase", r.comensal !== 'Paciente' ? "text-teal-600" : "text-slate-400")}>{r.comensal}</span>
                  </p>
                  {r.detalle && <p className="text-[12px] font-semibold text-slate-800">{r.detalle}</p>}
                  {r.observaciones && <p className="text-[11px] text-slate-500">Obs: {r.observaciones}</p>}
                  {r.status === COMANDA_STATUS.ANULADA && r.motivoAnulacion && (
                    <p className="text-[11px] text-red-500">Motivo anulación: {r.motivoAnulacion}</p>
                  )}
                  <div className="text-[10px] text-slate-400 flex items-center gap-3 pt-1 flex-wrap">
                    <span className="flex items-center gap-1"><UserIcon className="w-3 h-3" />{r.by || '—'}</span>
                    {tab === 'historico' && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{fmtWhen(r.at)}</span>}
                    {/* Estado + hora + acciones (entregar/anular/volver) — mismo StatusCell que el desktop */}
                    <StatusCell r={r} busy={busyId === r.spItemId}
                      canAct={!!onSetMealStatus && tab === 'activas'} onAction={doAction} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop — grilla */}
          <Card className="hidden md:block shadow-sm border-slate-200 overflow-hidden bg-white rounded-2xl">
            {/* table-fixed + colgroup: los anchos los manda el diseño, no el contenido → sin
                scroll horizontal y sin columnas que salten de ancho entre polls. */}
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-[24%]" /><col className="w-[10%]" /><col className="w-[9%]" />
                <col className="w-[26%]" /><col className="w-[14%]" /><col className="w-[17%]" />
              </colgroup>
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 font-bold">
                  <th className="px-4 py-3">Paciente</th>
                  <th className="px-4 py-3">Turno</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Comanda</th>
                  <th className="px-4 py-3">Registró</th>
                  <th className="px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(r => {
                  const tp = comandaTipoPill(r.tipo);
                  const cp = comidaPill(r.slot, r.comida);
                  const esAcomp = r.comensal !== 'Paciente';
                  const verSector = !sectorEsRedundante(r.area, r.bedLabel);
                  return (
                    <tr key={r.key} className={cn('align-middle hover:bg-slate-50/60',
                      // Anulada = histórico. Se muestra (es auditoría: se pidió y se canceló)
                      // pero atenuada, para que no compita con lo que sí se va a servir.
                      r.status === COMANDA_STATUS.ANULADA && 'opacity-45')}>
                      {/* Paciente + habitación. Si la bandeja es de un acompañante, se antepone
                          el pill: la fila sigue siendo "de" ese paciente, y el pill dice de quién
                          es la bandeja. Así no hace falta una columna Comensal aparte. */}
                      <td className="px-4 py-3">
                        {esAcomp && (
                          <span className="inline-block mb-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                            {r.comensal}
                          </span>
                        )}
                        <p className="font-bold text-slate-800 leading-tight break-words">{r.patientName}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {formatBedName(r.bedLabel)}
                          {verSector && <span className="text-slate-400"> · {areaLabel(r.area)}</span>}
                        </p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={cn('inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border', cp.cls)}>{cp.label}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={cn('inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded-full', tp.cls)}>{tp.label}</span>
                      </td>
                      {/* Comanda + observaciones */}
                      <td className="px-4 py-3">
                        <p className={cn('text-slate-800 font-medium break-words leading-snug',
                          r.status === COMANDA_STATUS.ANULADA && 'line-through')}>{r.detalle || <span className="text-slate-300">—</span>}</p>
                        {/* Siempre se dice algo: un hueco vacío no distingue "no tiene
                            observaciones" de "no se ve el dato". */}
                        <p className={cn('text-[11px] break-words mt-0.5 leading-snug',
                          r.observaciones ? 'text-slate-500' : 'text-slate-300 italic')}>
                          {r.observaciones || 'Sin observaciones'}
                        </p>
                        {/* Motivo de anulación: solo en las anuladas (auditoría). No usa
                            line-through — es la explicación, no parte del pedido tachado. */}
                        {r.status === COMANDA_STATUS.ANULADA && r.motivoAnulacion && (
                          <p className="text-[11px] break-words mt-1 leading-snug text-red-500 font-medium">
                            Motivo anulación: {r.motivoAnulacion}
                          </p>
                        )}
                      </td>
                      {/* Quién + cuándo */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="text-[12px] text-slate-600 leading-tight truncate">{r.by || '—'}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{fmtWhen(r.at)}</p>
                      </td>
                      {/* Estado + acciones */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {/* El histórico es lectura: entregar/anular se hace en "De hoy", donde
                            está lo que todavía se puede accionar. */}
                        <StatusCell r={r} busy={busyId === r.spItemId}
                          canAct={!!onSetMealStatus && tab === 'activas'} onAction={doAction} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {/* Modal de motivo de anulación — obligatorio, queda en el histórico para auditoría. */}
      <Dialog open={!!anularTarget} onOpenChange={(v) => { if (!v) setAnularTarget(null); }}>
        <DialogContent className="sm:max-w-[450px] rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2 text-red-700">
              <div className="p-2 bg-red-50 rounded-xl"><X className="w-5 h-5 text-red-400" /></div>
              Anular comanda
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            {anularTarget?.label && <p className="text-xs font-semibold text-slate-600">{anularTarget.label}</p>}
            <p className="text-xs text-slate-400 font-medium">Es obligatorio documentar el motivo — queda en el histórico.</p>
            <div className="grid gap-1.5">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Motivo de anulación</Label>
              {/* textarea (no input de 1 línea): un motivo puede ser una frase larga.
                  Ctrl/⌘+Enter confirma; Enter solo hace salto de línea. */}
              <textarea
                autoFocus
                value={motivoInput}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMotivoInput(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) confirmAnular(); }}
                rows={3}
                maxLength={500}
                placeholder="Ej: el paciente pasó a ayuno, alta, cambio de dieta…"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm resize-y min-h-[72px] focus:outline-none focus:ring-2 focus:ring-red-200"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAnularTarget(null)} className="rounded-xl h-10">Cancelar</Button>
            <Button onClick={confirmAnular} disabled={!motivoInput.trim()}
              className="rounded-xl h-10 bg-red-600 hover:bg-red-700 text-white font-bold disabled:opacity-50">
              Anular comanda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
