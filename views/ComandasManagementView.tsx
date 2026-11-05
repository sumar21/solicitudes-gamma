import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Bed, User, Area, MealSlot, MEAL_SLOTS, mealSlotFromSp, mealSlotLabel, COMANDA_STATUS, ComandaStatus } from '../types';
import { cn, formatBedName, formatDateReadable, normalizeText } from '../lib/utils';
import { leerResumenAyuno, ubicacionAyuno } from '../lib/ayuno-resumen';
import { can } from '../lib/permissions';
import { PlanificacionMenuModal } from '../components/modals/PlanificacionMenuModal';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { aIso, deIso } from '../lib/fechaIso';
import { fechaHora } from '../lib/formato';
import { estadoComanda, PUNTO_TURNO, tipoComanda } from '../lib/estados-comandas';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { Label } from '../components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { DataTable, type Columna } from '../components/ui/data-table';
import { Vacio } from '../components/ui/estados';
import { StatusBadge } from '../components/ui/status-badge';
import { DateRangePicker, type DateRange } from '../components/ui/date-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { AlertCircle, ArrowRight, CalendarDays, Check, CheckCircle2, Clock, FileDown, FileSpreadsheet, Loader2, RefreshCw, Search, Undo2, User as UserIcon, Utensils, X, XCircle } from 'lucide-react';
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

// Fecha y hora para mostrar (lib/formato). Una fecha que no se puede leer sale tal cual (fechaHora
// tira con una fecha inválida y las filas vienen de SharePoint). El Excel/PDF siguen con fmtWhen.
const cuando = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : fechaHora(d);
};

// Texto del turno. `slot` null = turno desconocido (fila vieja de SP): se muestra el crudo, sin inventar.
const comidaLabel = (slot: MealSlot | null, raw: string): string =>
  slot ? mealSlotLabel(slot) : (raw || '—');

// Turno en pantalla: punto de color + texto (lib/estados-comandas.ts). Es la hora del día, no un
// estado, así que no va como pill; el desconocido, punto gris.
const Turno: React.FC<{ slot: MealSlot | null; raw: string }> = ({ slot, raw }) => (
  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
    <span className={cn('size-2 shrink-0 rounded-full', slot ? PUNTO_TURNO[slot] : 'bg-muted-foreground')} aria-hidden="true" />
    <span className="font-medium">{comidaLabel(slot, raw)}</span>
  </span>
);

// ── Colores de los pills para el PDF ────────────────────────────────────────
// jspdf necesita RGB, no clases. Son los tonos de la grilla VIEJA (turno naranja/sky/rosa/violeta,
// tipo y estado como los de lib/estados-comandas.ts): el papel no se tocó en el rediseño. Si se
// quiere el PDF igual a la pantalla nueva, el mapa está en lib/estados-comandas.ts.
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

// Botones de acción dentro de una fila de la tabla (igual que Traslados y Limpiezas).
const BOTON_FILA = 'h-8 gap-1.5 px-3 text-xs';

/**
 * Acciones de la bandeja (DESIGN §7.6, como en Traslados): el paso del circuito con texto y lo
 * secundario en íconos con tooltip. En mobile, botones a lo ancho con texto (es la card entera).
 *   Pendiente → [✓ Entregar] [✕ anular]
 *   Entregado → [↩ volver a pendiente]  (para un "Entregar" tocado por error)
 *   Anulada   → sin acciones (es histórico: se reponen cargándola de nuevo desde la tarjeta)
 * Mientras la acción viaja, los botones de ESA fila quedan deshabilitados y el ícono gira.
 */
const AccionesComanda: React.FC<{
  r: ComandaRow; busy: boolean; mobile?: boolean;
  onAction: (spItemId: string, action: 'entregar' | 'pendiente' | 'anular', label?: string) => void;
}> = ({ r, busy, mobile = false, onAction }) => {
  if (r.status === COMANDA_STATUS.ANULADA) return null;
  const girando = <Loader2 className="animate-spin" aria-hidden="true" />;

  // Acción secundaria: ícono `ghost` con tooltip en desktop; botón outline con texto en mobile.
  const secundaria = (icono: React.ReactNode, label: string, onClick: () => void, peligro = false) => mobile ? (
    <Button type="button" variant="outline" disabled={busy} onClick={onClick}
      className={cn('flex-1', peligro && 'text-destructive hover:bg-destructive/10 hover:text-destructive')}>
      {icono} {label}
    </Button>
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={label} disabled={busy} onClick={onClick}
          className={cn('text-muted-foreground', peligro ? 'hover:bg-destructive/10 hover:text-destructive' : 'hover:text-foreground')}>
          {icono}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  if (r.status === COMANDA_STATUS.PENDIENTE) {
    return (
      <div className={mobile ? 'flex gap-2' : 'flex items-center justify-end gap-1'}>
        <Button type="button" size={mobile ? 'default' : 'sm'} className={mobile ? 'flex-1' : BOTON_FILA}
          disabled={busy} onClick={() => onAction(r.spItemId, 'entregar')}>
          {busy ? girando : <Check />} Entregar
        </Button>
        {secundaria(<XCircle className="size-4" />, 'Anular comanda',
          () => onAction(r.spItemId, 'anular', `${r.patientName} · ${r.comida}`), true)}
      </div>
    );
  }
  // Entregado (o un status raro que no es pendiente ni anulada): solo "volver a pendiente".
  return (
    <div className={mobile ? 'flex' : 'flex justify-end'}>
      {secundaria(busy ? girando : <Undo2 className="size-4" />, 'Volver a pendiente',
        () => onAction(r.spItemId, 'pendiente'))}
    </div>
  );
};

// Una comanda cargada (activa o histórica). Ambas tabs salen del endpoint /api/dietas
// ("De hoy" del GET de vivas; "Histórico" de /api/dietas?history=1) — no del overlay del mapa.
type ComandaRow = {
  key: string; patientName: string; bedLabel: string; area: string;
  // `slot` es la identidad del turno; `comida` es solo su texto para mostrar/exportar.
  // En el histórico `slot` puede ser null si SP tiene un `Comida_D` que no está en el catálogo.
  slot: MealSlot | null;
  comida: string; comensal: string; tipo: string; detalle: string; observaciones: string; by: string; operador: string; at: string;
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
  tipoComanda(r.tipo).label,
  r.detalle,
  r.observaciones,
  r.by,
  estadoComanda(r.status).label,
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
    by: String(m.by ?? ''), operador: String(m.operador ?? ''), at: String(m.at ?? ''),
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

// ── Apartado "Cambios de dieta" ─────────────────────────────────────────────
// Historial (append-only) de cada cambio de dieta que detecta el cron (de X → a Y). Fuente:
// /api/dieta-cambios (Supabase public.dieta_cambios). Independiente de la campanita/push.
// `kind`: CAMBIO = la dieta cambió en PROGAL (de X → a Y); INICIO_DIETA = Enfermería dio "Iniciar dieta"
// al cerrar una cirugía (el paciente ya puede comer). Filas viejas sin `kind` = CAMBIO.
interface DietaCambio {
  kind?: 'CAMBIO' | 'INICIO_DIETA';
  spItemId: string; patientCode: string; patientName: string; area: string;
  roomCode: string; eventKey: string; tagsPrev: string; tagsNew: string; changedAt: string;
  by?: string;
}
type FiltroTipo = 'todos' | 'CAMBIO' | 'INICIO_DIETA';

// Dietas de un cambio: las de antes tachadas y apagadas, las nuevas con borde (no son estados, así
// que van como Badge del kit y no como StatusBadge). La flecha entre las dos listas dice el sentido.
const TagList: React.FC<{ tags: string[]; tone: 'prev' | 'new' }> = ({ tags, tone }) => {
  if (!tags.length) return <span className="text-[11px] text-muted-foreground italic">sin dieta especial</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t, i) => (
        <Badge key={i} variant={tone === 'prev' ? 'secondary' : 'outline'}
          className={cn('text-[11px]', tone === 'prev' && 'text-muted-foreground line-through')}>
          {t}
        </Badge>
      ))}
    </span>
  );
};

/**
 * Header de página + toolbar (DESIGN §4.4 y §5.2), el mismo para todas las solapas. El título se
 * oculta en mobile: ahí el nombre de la sección lo dice la solapa activa.
 */
const EncabezadoComandas: React.FC<{ titulo: string; subtitulo: React.ReactNode; children: React.ReactNode }> = ({ titulo, subtitulo, children }) => (
  <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
    <div className="hidden shrink-0 md:block">
      <h2 className="text-2xl font-bold tracking-tight">{titulo}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{subtitulo}</p>
    </div>
    <div className="flex flex-wrap items-center gap-2 lg:justify-end">{children}</div>
  </div>
);

// Buscador de la toolbar (§5.2): ícono, `h-9`, botón para limpiar.
const Buscador: React.FC<{ value: string; onChange: (v: string) => void; placeholder: string; label: string }> = ({ value, onChange, placeholder, label }) => (
  <div className="relative min-w-[7rem] flex-1 sm:w-56 sm:flex-none">
    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    <Input
      placeholder={placeholder}
      aria-label={label}
      className="h-9 pr-8 pl-8 text-sm"
      value={value}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    />
    {value && (
      <button type="button" onClick={() => onChange('')} aria-label="Limpiar búsqueda" className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground">
        <X className="size-3.5" />
      </button>
    )}
  </div>
);

// Banner suave de error (DESIGN §9.4): una acción que falló o una recarga que no llegó.
const BannerError: React.FC<{ children: React.ReactNode; onCerrar?: () => void }> = ({ children, onCerrar }) => (
  <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
    <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
    <span className="flex-1">{children}</span>
    {onCerrar && (
      <button type="button" onClick={onCerrar} aria-label="Cerrar aviso" className="-m-0.5 rounded-sm p-0.5 text-red-700/70 hover:text-red-700">
        <X className="size-3.5" />
      </button>
    )}
  </div>
);

// Puente entre el DateRangePicker (Date) y las fechas "YYYY-MM-DD" de los filtros (lib/fechaIso), como
// en Cirugías. Con un solo día elegido, el rango es ese día; "Limpiar" vuelve a la última semana (el
// listado siempre tiene rango, igual que con los dos calendarios de antes).
const rangoDe = (from: string, to: string): DateRange => ({ from: deIso(from), to: deIso(to) });
const alCambiarRango = (setFrom: (s: string) => void, setTo: (s: string) => void, desdeDefault: string, hastaDefault: string) =>
  (r?: DateRange) => {
    if (!r?.from) { setFrom(desdeDefault); setTo(hastaDefault); return; }
    setFrom(aIso(r.from));
    setTo(aIso(r.to ?? r.from));
  };

const TIPOS_CAMBIO: [FiltroTipo, string][] = [['todos', 'Todos los registros'], ['CAMBIO', 'Cambios de dieta'], ['INICIO_DIETA', 'Iniciar dieta (cirugía)']];

const CambiosDietaPanel: React.FC = () => {
  const todayStr   = new Date().toISOString().slice(0, 10);
  const weekAgoStr = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const [from, setFrom] = useState(weekAgoStr);
  const [to, setTo]     = useState(todayStr);
  const [rows, setRows] = useState<DietaCambio[]>([]);
  const [loading, setLoading] = useState(false);
  // La última carga falló (DESIGN §9 / regla del repo "fallas visibles"): solo para mostrarlo; la
  // lista sigue con lo que tenía.
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [tipo, setTipo] = useState<FiltroTipo>('todos');

  const fetchCambios = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('mediflow_token');
      const r = await fetch(`/api/dieta-cambios?from=${from}&to=${to}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (r.ok) { const d = await r.json(); setRows((d.cambios ?? []) as DietaCambio[]); setError(false); }
      else setError(true);
    } catch { setError(true); /* mantiene lo previo */ }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { fetchCambios(); }, [fetchCambios]);

  const kindOf = (c: DietaCambio) => c.kind ?? 'CAMBIO';
  const filtered = useMemo(() => {
    const terms = normalizeText(search).split(' ').filter(Boolean);
    return rows.filter(c => {
      if (tipo !== 'todos' && kindOf(c) !== tipo) return false;
      if (!terms.length) return true;
      const extra = kindOf(c) === 'INICIO_DIETA' ? 'iniciar dieta cirugia post quirurgico' : '';
      const hay = normalizeText([c.patientName, c.area, c.roomCode, formatBedName(c.roomCode), c.tagsPrev, c.tagsNew, extra].join(' '));
      return terms.every(t => hay.includes(t));
    });
  }, [rows, search, tipo]);
  const nInicio = useMemo(() => rows.filter(c => kindOf(c) === 'INICIO_DIETA').length, [rows]);

  const tagChips = (s: string) => (s || '').split(';').map(t => t.trim()).filter(Boolean);
  const filtrando = !!search.trim() || tipo !== 'todos';

  // Celdas compartidas por la tabla y la tarjeta mobile.
  const ubicacion = (c: DietaCambio) => [c.area, c.roomCode && formatBedName(c.roomCode)].filter(Boolean).join(' · ') || '—';
  const evento = (c: DietaCambio) => kindOf(c) === 'INICIO_DIETA' ? (
    <div className="flex flex-col items-start gap-1">
      <StatusBadge tono="exito"><Utensils className="size-3" aria-hidden="true" /> Iniciar dieta</StatusBadge>
      <span className="text-[10px] text-muted-foreground">post cirugía — ya puede comer{c.by ? ` · ${c.by}` : ''}</span>
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      <TagList tags={tagChips(c.tagsPrev)} tone="prev" />
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-label="pasó a" />
      <TagList tags={tagChips(c.tagsNew)} tone="new" />
    </div>
  );

  // Columnas agrupadas (DESIGN §7.2 "2 líneas"): paciente arriba, ubicación abajo.
  const columnas: Columna<DietaCambio>[] = [
    { id: 'fecha', titulo: 'Fecha y hora', clase: 'whitespace-nowrap', celda: (c) => <span className="tabular-nums">{cuando(c.changedAt)}</span> },
    {
      id: 'paciente',
      titulo: 'Paciente',
      celda: (c) => (
        <div className="flex flex-col">
          <span className="font-medium">{c.patientName || '—'}</span>
          <span className="text-[10px] text-muted-foreground">{ubicacion(c)}</span>
        </div>
      ),
    },
    { id: 'evento', titulo: 'Cambio de dieta / evento', clase: 'min-w-[260px] whitespace-normal', celda: evento },
  ];

  const tarjeta = (c: DietaCambio) => (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col">
        <span className="font-medium">{c.patientName || '—'}</span>
        <span className="text-[11px] text-muted-foreground">{ubicacion(c)}</span>
      </div>
      {evento(c)}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
        <Clock className="size-3.5 shrink-0" aria-hidden="true" />{cuando(c.changedAt)}
      </p>
    </div>
  );

  const n = (v: number) => <span className="font-medium text-foreground tabular-nums">{v}</span>;

  return (
    <>
      <EncabezadoComandas
        titulo="Cambios de dieta"
        subtitulo={<>{n(filtered.length)}{filtrando && filtered.length !== rows.length && <> de {n(rows.length)}</>} {filtered.length === 1 ? 'registro' : 'registros'}{nInicio > 0 && <> · {n(nInicio)} {nInicio === 1 ? 'inicio' : 'inicios'} de dieta</>}</>}
      >
        <Buscador value={search} onChange={setSearch} placeholder="Paciente, sector, dieta…" label="Buscar cambios de dieta" />
        {/* Filtros de una dimensión cada uno, inline en la toolbar (§5.2), como el período de Cirugías. */}
        {/* En mobile, tipo y período bajan a su propia línea (order-last) para que Actualizar quede
            al lado del buscador. */}
        <Select value={tipo} onValueChange={(v) => setTipo(v as FiltroTipo)}>
          <SelectTrigger size="sm" className="order-last w-full sm:order-none sm:w-52" aria-label="Tipo de registro">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIPOS_CAMBIO.map(([k, label]) => (
              <SelectItem key={k} value={k}>{k === 'INICIO_DIETA' && nInicio ? `${label} · ${nInicio}` : label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span id="cambios-periodo" className="sr-only">Período</span>
        <DateRangePicker value={rangoDe(from, to)} onChange={alCambiarRango(setFrom, setTo, weekAgoStr, todayStr)}
          aria-describedby="cambios-periodo" className="order-last h-9 w-full sm:order-none sm:w-64" />
        <Button type="button" variant="outline" onClick={() => fetchCambios()} disabled={loading} aria-label="Actualizar" className="h-9 shrink-0 gap-1.5 px-3">
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} aria-hidden="true" />
          <span className="hidden sm:inline">Actualizar</span>
        </Button>
      </EncabezadoComandas>

      {/* Falló una recarga y hay datos de antes: se avisa sin esconderlos. */}
      {error && rows.length > 0 && !loading && (
        <BannerError><span className="font-semibold">No pudimos actualizar los cambios de dieta.</span> Lo que ves puede estar desactualizado.</BannerError>
      )}
      <DataTable
        filas={filtered}
        columnas={columnas}
        clave={(c) => c.spItemId}
        tarjeta={tarjeta}
        porPagina={Number.POSITIVE_INFINITY}
        cargando={loading}
        error={error && rows.length === 0 ? { mensaje: 'No pudimos traer los cambios de dieta. Revisá tu conexión y probá de nuevo.', onReintentar: () => { fetchCambios(); } } : undefined}
        vacio={filtrando && rows.length > 0
          ? <Vacio icono={Search} titulo="Sin resultados" descripcion="Probá con otro texto, otro tipo o limpiá el buscador." />
          : <Vacio icono={Utensils} titulo="Sin registros en el período"
              descripcion={'Cada vez que Progal cambia la dieta de un paciente internado, o Enfermería da "Iniciar dieta" al cerrar una cirugía, queda registrado acá.'} />}
      />
    </>
  );
};

// ── Apartado "Cambios de ayuno" ─────────────────────────────────────────────
// Historial (append-only) de cada cambio de ayuno que detecta el cron: los horarios de antes → los
// de después. Fuente: /api/ayuno-cambios (Supabase public.ayuno_cambios). Mismo armado que "Cambios
// de dieta"; no muestra la frase del push, solo el antes y el después.
interface AyunoCambio {
  id: string; patientCode: string; patientName: string; area: string;
  roomCode: string; eventKey: string; prev: string; next: string; changedAt: string;
}

// Horarios de un lado del cambio, agrupados por día ("05/11 · 10:00 · 11:00"). Como TagList: los de
// antes tachados y apagados, los nuevos con borde. Las filas viejas recortadas suman "y N más".
const HorariosAyuno: React.FC<{ texto: string; tone: 'prev' | 'new' }> = ({ texto, tone }) => {
  const r = leerResumenAyuno(texto);
  if (r.crudo) return <span className={cn('text-[11px]', tone === 'prev' && 'text-muted-foreground line-through')}>{r.crudo}</span>;
  if (!r.dias.length) return <span className="text-[11px] text-muted-foreground italic">sin ayuno</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {r.dias.map(d => (
        <Badge key={d.dia} variant={tone === 'prev' ? 'secondary' : 'outline'}
          className={cn('gap-1 text-[11px] tabular-nums', tone === 'prev' && 'text-muted-foreground line-through')}>
          <span className="font-semibold">{d.dia}</span>{d.horas.join(' · ')}
        </Badge>
      ))}
      {r.resto > 0 && (
        <Badge variant="outline" className="border-dashed text-[11px] text-muted-foreground"
          title="Registro anterior al 05/11/2026: se guardaron solo los primeros 3 horarios">
          y {r.resto} más
        </Badge>
      )}
    </span>
  );
};

const CambiosAyunoPanel: React.FC = () => {
  const todayStr   = new Date().toISOString().slice(0, 10);
  const weekAgoStr = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const [from, setFrom] = useState(weekAgoStr);
  const [to, setTo]     = useState(todayStr);
  const [rows, setRows] = useState<AyunoCambio[]>([]);
  const [loading, setLoading] = useState(false);
  // La última carga falló (DESIGN §9 / regla del repo "fallas visibles"): se avisa y la lista sigue
  // con lo que tenía.
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');

  const fetchCambios = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('mediflow_token');
      const r = await fetch(`/api/ayuno-cambios?from=${from}&to=${to}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (r.ok) { const d = await r.json(); setRows((d.cambios ?? []) as AyunoCambio[]); setError(false); }
      else setError(true);
    } catch { setError(true); /* mantiene lo previo */ }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { fetchCambios(); }, [fetchCambios]);

  const filtered = useMemo(() => {
    const terms = normalizeText(search).split(' ').filter(Boolean);
    if (!terms.length) return rows;
    return rows.filter(c => {
      const hay = normalizeText([c.patientName, c.patientCode, c.area, ubicacionAyuno(c.area, c.roomCode)].join(' '));
      return terms.every(t => hay.includes(t));
    });
  }, [rows, search]);
  const filtrando = !!search.trim();

  // Paciente arriba, código y ubicación abajo (DESIGN §7.2 "2 líneas").
  const paciente = (c: AyunoCambio) => (
    <div className="flex flex-col">
      <span className="font-medium">{c.patientName || '—'}</span>
      <span className="text-[10px] text-muted-foreground">
        {[c.patientCode, ubicacionAyuno(c.area, c.roomCode)].filter(Boolean).join(' · ')}
      </span>
    </div>
  );

  const columnas: Columna<AyunoCambio>[] = [
    { id: 'fecha', titulo: 'Fecha y hora', clase: 'whitespace-nowrap', celda: (c) => <span className="tabular-nums">{cuando(c.changedAt)}</span> },
    { id: 'paciente', titulo: 'Paciente', celda: paciente },
    { id: 'antes', titulo: 'Antes', clase: 'min-w-[200px] whitespace-normal', celda: (c) => <HorariosAyuno texto={c.prev} tone="prev" /> },
    { id: 'despues', titulo: 'Después', clase: 'min-w-[200px] whitespace-normal', celda: (c) => <HorariosAyuno texto={c.next} tone="new" /> },
  ];

  const tarjeta = (c: AyunoCambio) => (
    <div className="flex flex-col gap-2">
      {paciente(c)}
      <div className="grid grid-cols-[3.75rem_1fr] items-start gap-x-2 gap-y-1.5">
        <span className="pt-0.5 text-[11px] text-muted-foreground">Antes</span>
        <HorariosAyuno texto={c.prev} tone="prev" />
        <span className="pt-0.5 text-[11px] text-muted-foreground">Después</span>
        <HorariosAyuno texto={c.next} tone="new" />
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
        <Clock className="size-3.5 shrink-0" aria-hidden="true" />{cuando(c.changedAt)}
      </p>
    </div>
  );

  const n = (v: number) => <span className="font-medium text-foreground tabular-nums">{v}</span>;

  return (
    <>
      <EncabezadoComandas
        titulo="Cambios de ayuno"
        subtitulo={<>{n(filtered.length)}{filtrando && filtered.length !== rows.length && <> de {n(rows.length)}</>} {filtered.length === 1 ? 'cambio' : 'cambios'}</>}
      >
        <Buscador value={search} onChange={setSearch} placeholder="Paciente, código, sector…" label="Buscar cambios de ayuno" />
        <span id="ayunos-periodo" className="sr-only">Período</span>
        <DateRangePicker value={rangoDe(from, to)} onChange={alCambiarRango(setFrom, setTo, weekAgoStr, todayStr)}
          aria-describedby="ayunos-periodo" className="order-last h-9 w-full sm:order-none sm:w-64" />
        <Button type="button" variant="outline" onClick={() => fetchCambios()} disabled={loading} aria-label="Actualizar" className="h-9 shrink-0 gap-1.5 px-3">
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} aria-hidden="true" />
          <span className="hidden sm:inline">Actualizar</span>
        </Button>
      </EncabezadoComandas>

      {/* Falló una recarga y hay datos de antes: se avisa sin esconderlos. */}
      {error && rows.length > 0 && !loading && (
        <BannerError><span className="font-semibold">No pudimos actualizar los cambios de ayuno.</span> Lo que ves puede estar desactualizado.</BannerError>
      )}
      <DataTable
        filas={filtered}
        columnas={columnas}
        clave={(c) => c.id}
        tarjeta={tarjeta}
        porPagina={Number.POSITIVE_INFINITY}
        cargando={loading}
        error={error && rows.length === 0 ? { mensaje: 'No pudimos traer los cambios de ayuno. Revisá tu conexión y probá de nuevo.', onReintentar: () => { fetchCambios(); } } : undefined}
        vacio={filtrando && rows.length > 0
          ? <Vacio icono={Search} titulo="Sin resultados" descripcion="Probá con otro texto o limpiá el buscador." />
          : <Vacio icono={Clock} titulo="Sin cambios en el período"
              descripcion="Cada vez que Progal programa, cambia o cancela el ayuno de un paciente internado, queda registrado acá." />}
      />
    </>
  );
};

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
  // La última carga de "De hoy" falló (DESIGN §9 / regla del repo "fallas visibles"): solo para
  // mostrarlo; la grilla sigue con lo que tenía.
  const [errorToday, setErrorToday] = useState(false);
  const fetchTodayRef = React.useRef<null | (() => void)>(null);
  const todaySeqRef = React.useRef(0);
  const rows = todayRows;

  // Contadores de la botonera: se calculan SOBRE rows (pre-búsqueda) — dicen cuántas
  // existen, no cuántas matchean el buscador.
  const { pendientes, entregadas } = useMemo(() => splitComandasPorEntrega(rows), [rows]);

  // ── Histórico (por fecha de carga) ──────────────────────────────────────────
  const [tab, setTab] = useState<'activas' | 'historico' | 'cambios' | 'ayunos'>('activas');
  // Día ART (mismo criterio que el server filtra FechaCarga), evita off-by-one de UTC de noche.
  const artDayStr = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const todayStr   = artDayStr(Date.now());
  const weekAgoStr = artDayStr(Date.now() - 7 * 864e5);
  const [from, setFrom] = useState(weekAgoStr);
  const [to, setTo]     = useState(todayStr);
  const [history, setHistory] = useState<ComandaRow[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const [errorHist, setErrorHist] = useState(false); // igual que errorToday: solo para mostrarlo
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
  const tabRef = React.useRef<'activas' | 'historico' | 'cambios' | 'ayunos'>('activas');

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
        setErrorHist(false);
      } else setErrorHist(true);
    } catch { setErrorHist(true); /* mantiene lo previo */ }
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
        if (seq === todaySeqRef.current) { setTodayRows(rows); setErrorToday(false); }
      } else if (seq === todaySeqRef.current) setErrorToday(true);
    } catch { if (seq === todaySeqRef.current) setErrorToday(true); /* mantiene lo previo */ }
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
    const head: string[] = ['Paciente', 'Ubicación', 'Turno', 'Comensal', 'Tipo', 'Comanda', 'Observaciones', 'Registró', ...(showDate ? ['Fecha y hora'] : []), ...(showEntrega ? ['Entrega'] : [])];
    // El reporte SIEMPRE sale en orden de despacho (piso → habitación → turno), aunque el histórico
    // en pantalla vaya por paciente: se pidió que el papel/Excel vaya por piso y habitación.
    // Ubicación en una sola columna (la cama ya dice el piso); "Entrega" = hora en que se marcó
    // entregada ('—' si quedó pendiente; anuladas muestran la hora de anulación con el estado).
    const body: string[][] = [...filtered].sort(comandaDispatchCompare).map(r => [
      r.patientName,
      formatBedName(r.bedLabel) + (sectorEsRedundante(r.area, r.bedLabel) ? '' : ` · ${areaLabel(r.area)}`),
      r.comida, r.comensal, tipoComanda(r.tipo).label,
      r.detalle || '—', r.observaciones || '—', r.operador || r.by || '—',
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

    // Datos derivados por fila (los usan el cuerpo de la tabla y los hooks de dibujo). Se ordena
    // SIEMPRE por despacho (piso → habitación → turno), aunque el histórico en pantalla vaya por
    // paciente — el reporte se pide por piso y habitación.
    const rows = [...filtered].sort(comandaDispatchCompare).map(r => {
      const esAcomp = r.comensal !== 'Paciente';
      const verSector = !sectorEsRedundante(r.area, r.bedLabel);
      const bedLine = formatBedName(r.bedLabel) + (verSector ? ` · ${areaLabel(r.area)}` : '');
      const anulada = r.status === COMANDA_STATUS.ANULADA;
      const cierre = r.status !== COMANDA_STATUS.PENDIENTE ? fmtCierre(r.closedAt, r.at) : '';
      const est = estadoComanda(r.status);
      return { r, esAcomp, verSector, bedLine, anulada, cierre, est };
    });

    const body = rows.map(g => [
      // Col 0 (Paciente): se dibuja a mano en didDrawCell (nombre en negrita + cama en gris + pill
      // de acompañante). El contenido de texto acá es solo para que autotable calcule la altura.
      `${g.esAcomp ? g.r.comensal + '\n' : ''}${g.r.patientName}\n${g.bedLine}`,
      comidaLabel(g.r.slot, g.r.comida),               // Turno
      tipoComanda(g.r.tipo).label,                            // Tipo
      // Comanda + observaciones (la grilla siempre dice algo; un hueco vacío se lee como dato faltante).
      `${g.r.detalle || '—'}\n${g.r.observaciones || 'Sin observaciones'}${g.anulada && g.r.motivoAnulacion ? `\nMotivo anulación: ${g.r.motivoAnulacion}` : ''}`,
      `${g.r.operador || g.r.by || '—'}\n${fmtWhen(g.r.at)}`,                      // Registró (quién + cuándo)
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
    const widths = [22, 26, 10, 12, 16, 40, 30, 18, 18, 16];
    ws['!cols'] = head.map((_, i) => ({ wch: widths[i] ?? 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Comandas');
    XLSX.writeFile(wb, `${exportFname()}.xlsx`);
  };

  // Mensaje del vacío: el buscador manda (decir "no hay comandas" cuando el filtro no
  // matcheó sería mentir), después la tab y, en "De hoy", la sub-vista.
  const vacio = filtrando
    ? { icono: Search, titulo: 'Sin resultados para la búsqueda', sub: 'Probá con otro término o limpiá el filtro.' }
    : tab === 'historico'
      ? { icono: Clock, titulo: 'Sin comandas en el rango', sub: 'Ajustá las fechas para ver el histórico.' }
      : vistaHoy === 'entregadas'
        ? { icono: Utensils, titulo: 'Todavía no se entregó ninguna comanda hoy', sub: 'Tocá «Entregar» en una pendiente y aparece acá.' }
        : rows.length > 0
          ? { icono: CheckCircle2, titulo: 'No quedan comandas pendientes', sub: 'Todo lo de hoy ya se entregó — está en «Entregadas».' }
          : { icono: Utensils, titulo: 'No hay comandas cargadas hoy', sub: 'Las comandas que carga Nutrición desde el mapa de camas aparecen acá.' };

  // El histórico es lectura: entregar/anular se hace en "De hoy", donde está lo que todavía se
  // puede accionar.
  const canAct = !!onSetMealStatus && tab === 'activas';
  const esAnulada = (r: ComandaRow) => r.status === COMANDA_STATUS.ANULADA;
  const cierreDe = (r: ComandaRow) => (r.status !== COMANDA_STATUS.PENDIENTE ? fmtCierre(r.closedAt, r.at) : '');

  // ── Celdas compartidas por la tabla y la tarjeta mobile ─────────────────────
  // Paciente + habitación (DESIGN §7.2 "2 líneas"). Si la bandeja es de un acompañante, se
  // antepone la etiqueta: la fila sigue siendo "de" ese paciente, y la etiqueta dice de quién es
  // la bandeja. Así no hace falta una columna Comensal aparte.
  const celdaPaciente = (r: ComandaRow) => (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {r.comensal !== 'Paciente' && <Badge variant="outline" className="px-1.5 text-[10px]">{r.comensal}</Badge>}
        <span className="leading-tight font-medium wrap-break-word">{r.patientName}</span>
      </div>
      <span className="text-[10px] text-muted-foreground">
        {formatBedName(r.bedLabel)}{!sectorEsRedundante(r.area, r.bedLabel) && ` · ${areaLabel(r.area)}`}
      </span>
    </div>
  );

  // Comanda + observaciones. Siempre se dice algo: un hueco vacío no distingue "no tiene
  // observaciones" de "no se ve el dato". El motivo de anulación no va tachado: es la
  // explicación, no parte del pedido.
  const celdaComanda = (r: ComandaRow) => (
    <div className="flex flex-col gap-0.5">
      <span className={cn('leading-snug font-medium wrap-break-word', esAnulada(r) && 'line-through')}>
        {r.detalle || <span className="text-muted-foreground">—</span>}
      </span>
      <span className={cn('text-[10px] leading-snug wrap-break-word text-muted-foreground', !r.observaciones && 'italic')}>
        {r.observaciones || 'Sin observaciones'}
      </span>
      {esAnulada(r) && r.motivoAnulacion && (
        <span className="text-[10px] leading-snug font-medium wrap-break-word text-destructive">Motivo anulación: {r.motivoAnulacion}</span>
      )}
    </div>
  );

  // Estado + hora de cierre (entrega o anulación) abajo.
  const celdaEstado = (r: ComandaRow) => {
    const e = estadoComanda(r.status);
    const cierre = cierreDe(r);
    return (
      <div className="flex flex-col items-start gap-1">
        <StatusBadge tono={e.tono}>{e.label}</StatusBadge>
        {cierre && (
          <span className="text-[10px] text-muted-foreground tabular-nums" title={esAnulada(r) ? 'Hora de anulación' : 'Hora de entrega'}>
            <span className="sr-only">{esAnulada(r) ? 'Hora de anulación: ' : 'Hora de entrega: '}</span>{cierre}
          </span>
        )}
      </div>
    );
  };

  // Columnas agrupadas (DESIGN §7.2 + §5.4): valor arriba, metadato abajo. Mismas columnas que el
  // PDF (Paciente · Turno · Tipo · Comanda · Registró · Estado), así el papel se lee igual. Sin
  // `ordenar`: las filas ya llegan en orden de despacho (De hoy) o por paciente (Histórico).
  const columnas: Columna<ComandaRow>[] = [
    { id: 'paciente', titulo: 'Paciente', clase: 'min-w-[180px]', celda: celdaPaciente },
    { id: 'turno', titulo: 'Turno', celda: (r) => <Turno slot={r.slot} raw={r.comida} /> },
    { id: 'tipo', titulo: 'Tipo', celda: (r) => { const t = tipoComanda(r.tipo); return <StatusBadge tono={t.tono}>{t.label}</StatusBadge>; } },
    { id: 'comanda', titulo: 'Comanda', clase: 'min-w-[220px]', celda: celdaComanda },
    {
      id: 'registro',
      titulo: 'Registró',
      ocultarEn: 'md',
      clase: 'whitespace-nowrap',
      celda: (r) => (
        <div className="flex flex-col">
          <span className="max-w-[180px] truncate">{r.operador || r.by || '—'}</span>
          <span className="text-[10px] text-muted-foreground tabular-nums">{cuando(r.at)}</span>
        </div>
      ),
    },
    { id: 'estado', titulo: 'Estado', clase: 'whitespace-nowrap', celda: celdaEstado },
    ...(canAct ? [{
      id: 'acciones',
      titulo: 'Acciones',
      alinear: 'der' as const,
      clase: 'whitespace-nowrap',
      celda: (r: ComandaRow) => <AccionesComanda r={r} busy={busyId === r.spItemId} onAction={doAction} />,
    }] : []),
  ];

  // Card mobile (§5.4b): paciente y estado arriba, turno + tipo, la comanda, quién y cuándo, y las
  // acciones al pie.
  const tarjeta = (r: ComandaRow) => {
    const t = tipoComanda(r.tipo);
    const cierre = cierreDe(r);
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-2">
          {celdaPaciente(r)}
          <StatusBadge tono={estadoComanda(r.status).tono}>{estadoComanda(r.status).label}</StatusBadge>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <Turno slot={r.slot} raw={r.comida} />
          <StatusBadge tono={t.tono}>{t.label}</StatusBadge>
        </div>
        {celdaComanda(r)}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><UserIcon className="size-3.5 shrink-0" aria-hidden="true" />{r.operador || r.by || '—'}</span>
          {tab === 'historico' && <span className="flex items-center gap-1.5 tabular-nums"><Clock className="size-3.5 shrink-0" aria-hidden="true" />{cuando(r.at)}</span>}
          {cierre && <span className="tabular-nums">{esAnulada(r) ? 'Anulada' : 'Entregada'} {cierre}</span>}
        </div>
        {canAct && !esAnulada(r) && (
          <div className="border-t pt-3">
            <AccionesComanda r={r} busy={busyId === r.spItemId} mobile onAction={doAction} />
          </div>
        )}
      </div>
    );
  };

  // ── Header: subtítulo con los conteos de la solapa ──────────────────────────
  const n = (v: number) => <span className="font-medium text-foreground tabular-nums">{v}</span>;
  const deTotal = filtrando && filtered.length !== data.length ? <> · {n(filtered.length)} de {n(data.length)} con la búsqueda</> : null;
  const subtitulo = tab === 'historico' ? (
    <>{n(filtered.length)}{filtrando && filtered.length !== data.length && <> de {n(data.length)}</>} {filtered.length === 1 ? 'comanda' : 'comandas'} en el período</>
  ) : (
    <>{n(pendientes.length)} {pendientes.length === 1 ? 'pendiente' : 'pendientes'} · {n(entregadas.length)} {entregadas.length === 1 ? 'entregada' : 'entregadas'} hoy{deTotal}</>
  );

  const cargando = (loadingHist && tab === 'historico') || (loadingToday && tab === 'activas' && todayRows.length === 0);
  const actualizando = tab === 'historico' && loadingHist;
  const errorCarga = tab === 'historico' ? errorHist : errorToday;
  const hayDatos = tab === 'historico' ? history.length > 0 : todayRows.length > 0;
  const reintentar = () => { if (tab === 'historico') fetchHistory(); else fetchToday(); };

  return (
    <div className="flex w-full flex-col gap-4 p-3 md:p-8">
      {/* Secciones del módulo: tab bar con subrayado de marca (DESIGN §8.7), como Operativa. */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList variant="line" className="w-full justify-start" aria-label="Secciones de comandas">
          <TabsTrigger value="activas">De hoy</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
          <TabsTrigger value="cambios">Cambios de dieta</TabsTrigger>
          <TabsTrigger value="ayunos">Cambios de ayuno</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'cambios' ? <CambiosDietaPanel /> : tab === 'ayunos' ? <CambiosAyunoPanel /> : (<>
        {/* HEADER + TOOLBAR (DESIGN §4.4 y §5.2) */}
        <EncabezadoComandas titulo={tab === 'historico' ? 'Histórico' : 'Comandas de hoy'} subtitulo={subtitulo}>
          {/* Buscador — aplica a las DOS tabs (comparten `data`, tabla, tarjetas, contador y PDF). */}
          <Buscador value={searchFilter} onChange={setSearchFilter} placeholder="Paciente, cama, sector, turno, comanda…" label="Buscar comandas" />
          {/* Histórico: período por fecha de carga, inline en la toolbar (§5.2) como en Cirugías. En
              mobile baja a su propia línea (order-last) para que las acciones queden al lado del buscador. */}
          {tab === 'historico' && (
            <>
              <span id="comandas-periodo" className="sr-only">Período, por fecha de carga</span>
              <DateRangePicker value={rangoDe(from, to)} onChange={alCambiarRango(setFrom, setTo, weekAgoStr, todayStr)}
                aria-describedby="comandas-periodo" className="order-last h-9 w-full sm:order-none sm:w-64" />
            </>
          )}
          <Button type="button" variant="outline" aria-label="Actualizar" disabled={actualizando} className="h-9 shrink-0 gap-1.5 px-3"
            onClick={() => { if (tab === 'historico') fetchHistory(); else { fetchToday(); onRefresh?.(); } }}>
            <RefreshCw className={cn('size-3.5', actualizando && 'animate-spin')} aria-hidden="true" />
            <span className="hidden sm:inline">Actualizar</span>
          </Button>
          {/* Exportan lo FILTRADO en pantalla (§7.10): el PDF reproduce la grilla; el Excel, la tabla plana. */}
          <Button type="button" variant="outline" aria-label="Exportar a PDF" onClick={handlePdf} disabled={filtered.length === 0} className="h-9 shrink-0 gap-1.5 px-3">
            <FileDown className="size-3.5" aria-hidden="true" /><span className="hidden sm:inline">PDF</span>
          </Button>
          <Button type="button" variant="outline" aria-label="Exportar a Excel" onClick={handleExcel} disabled={filtered.length === 0} className="h-9 shrink-0 gap-1.5 px-3">
            <FileSpreadsheet className="size-3.5" aria-hidden="true" /><span className="hidden sm:inline">XLS</span>
          </Button>
          {canSeePlan && (
            <Button type="button" variant="outline" aria-label="Planificación de menú" onClick={() => setPlanOpen(true)} className="h-9 shrink-0 gap-1.5 px-3">
              <CalendarDays className="size-3.5" aria-hidden="true" /><span className="hidden sm:inline">Planificación</span>
            </Button>
          )}
        </EncabezadoComandas>

        {/* Pendientes / Entregadas: control segmentado (§6.6), como las sub-solapas de Cirugías, en su
            propia fila arriba de la grilla (en la toolbar no entraba con las exportaciones). Por defecto
            las entregadas NO están en la grilla; el contador avisa que existen. */}
        {tab === 'activas' && (
          <Tabs value={vistaHoy} onValueChange={(v) => setVistaHoy(v as typeof vistaHoy)}>
            <TabsList className="h-9 w-full sm:w-fit" aria-label="Pendientes o entregadas">
              <TabsTrigger value="pendientes" className="flex-1 sm:flex-none">
                Pendientes <span className="text-xs text-muted-foreground tabular-nums">{pendientes.length}</span>
              </TabsTrigger>
              <TabsTrigger value="entregadas" className="flex-1 sm:flex-none">
                Entregadas <span className="text-xs text-muted-foreground tabular-nums">{entregadas.length}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {actionError && <BannerError onCerrar={() => setActionError(null)}>{actionError}</BannerError>}
        {/* Falló una recarga y hay datos de antes: se avisa sin esconderlos (banner suave §9.4). */}
        {errorCarga && hayDatos && !cargando && (
          <BannerError>
            <span className="font-semibold">No pudimos actualizar {tab === 'historico' ? 'el histórico' : 'las comandas de hoy'}.</span> Lo que ves puede estar desactualizado; probá con Actualizar.
          </BannerError>
        )}

        {/* TABLA (desktop) + CARDS (mobile) sobre el mismo array (§4.4, §7.1). */}
        <DataTable
          filas={filtered}
          columnas={columnas}
          clave={(r) => r.key}
          tarjeta={tarjeta}
          // Todas en una página: es una grilla operativa (y el orden de despacho no se corta).
          porPagina={Number.POSITIVE_INFINITY}
          cargando={cargando}
          error={errorCarga && !hayDatos ? { mensaje: tab === 'historico' ? 'No pudimos traer el histórico de comandas. Revisá tu conexión y probá de nuevo.' : 'No pudimos traer las comandas de hoy. Revisá tu conexión y probá de nuevo.', onReintentar: reintentar } : undefined}
          // Anulada = auditoría (se pidió y se canceló): se muestra atenuada para que no compita
          // con lo que sí se va a servir.
          claseFila={(r) => (esAnulada(r) ? 'opacity-60' : undefined)}
          vacio={<Vacio icono={vacio.icono} titulo={vacio.titulo} descripcion={vacio.sub} />}
        />
      </>)}

      <PlanificacionMenuModal open={planOpen} onOpenChange={setPlanOpen} currentUser={currentUser} />

      {/* Modal de motivo de anulación — obligatorio, queda en el histórico para auditoría. */}
      <Dialog open={!!anularTarget} onOpenChange={(v) => { if (!v) setAnularTarget(null); }}>
        {/* Confirmación destructiva con motivo (DESIGN §4.2) dentro del modal canónico §4.1. */}
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Anular comanda</DialogTitle>
            <DialogDescription>
              {anularTarget?.label && <><span className="font-medium text-foreground">{anularTarget.label}</span> · </>}
              Es obligatorio documentar el motivo — queda en el histórico.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="size-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
              <X className="size-5" />
            </div>
            <div>
              <Label htmlFor="anular-motivo" className="mb-1 block text-xs font-medium text-muted-foreground">Motivo de anulación <span className="text-destructive">*</span></Label>
              {/* textarea (no input de 1 línea): un motivo puede ser una frase larga.
                  Ctrl/⌘+Enter confirma; Enter solo hace salto de línea. */}
              <Textarea
                id="anular-motivo"
                autoFocus
                value={motivoInput}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMotivoInput(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) confirmAnular(); }}
                rows={3}
                maxLength={500}
                placeholder="Ej: el paciente pasó a ayuno, alta, cambio de dieta…"
                className="resize-y min-h-[72px]"
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAnularTarget(null)}>Cancelar</Button>
            <Button type="button" variant="destructive" onClick={confirmAnular} disabled={!motivoInput.trim()} className="min-w-[140px]">
              Anular comanda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
