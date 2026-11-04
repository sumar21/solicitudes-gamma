import React, { useState, useMemo, useCallback } from 'react';
import { Bed, BedStatus, Ticket, TicketStatus, User, Area, IsolationEntry, MealSlot, MealLoad, MEAL_SLOTS, mealSlotFromSp, hasAnyMealLoad, hasPendingMealLoad, MAX_ACOMPANANTES, COMANDA_STATUS, titularSinDieta, dietTypeFromDiets } from '../types';
import { can, canLoadMealSlot, canLoadAnyMealSlot } from '../lib/permissions';
import { hasLiveFasting, fastingOccurrences, formatFastingDateTime, fastingTimesForToday } from '../lib/fasting';
import { isolationSigla, isolationRule } from '../lib/isolations';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Switch } from '../components/ui/switch';
import { cn, dietRequiresCustomComanda, suggestedRoomSex, formatBedName, bedEventKey, isIndividualBoxArea } from '../lib/utils';
import { BedDouble, User as UserIcon, Info, Search, X, Plus, ChevronRight, Check, AlertTriangle, AlertCircle, CheckCircle2, ShieldAlert, RefreshCw, Utensils, UtensilsCrossed, FileText, ArrowDownAZ, SprayCan, History, Lock, Activity, ArrowRight, Undo2, Loader2, CircleDot, LayoutGrid, Filter, Building2, Stethoscope, CalendarDays, ClipboardList } from 'lucide-react';
import { aIso, deIso } from '../lib/fechaIso';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { StatusBadge, type Tono } from '../components/ui/status-badge';
import { BarraFiltros, BotonFiltros, CampoFiltro } from '../components/ui/filtros';
import { MultiCombobox } from '../components/ui/combobox';
import { DateRangePicker } from '../components/ui/date-picker';
import { Cargando, ErrorEstado, Vacio } from '../components/ui/estados';
import { diaMes, fecha, fechaHora, hora } from '../lib/formato';
import { ESTADOS_CAMA, ORDEN_ESTADOS_CAMA, MARCAS_CAMA, ICONO_AISLAMIENTO, estadoCama, puntoEstadoCama, cardEstadoCama, puntoAislamiento, anilloAislamiento } from '../lib/estados-camas';
import { estadoCirugia } from '../lib/estados-cirugia';
import { PatientJourney } from '../components/PatientJourney';
import { WORKFLOW_LABELS, CIRUGIA_ESTADO_LABEL, CIRUGIA_TIPO_PREVIA, cirugiaRetrocesoDe } from '../lib/constants';
import jsPDF from 'jspdf';

const AREA_LABELS: Record<string, string> = {
  [Area.PISO_4]: 'Piso 4',
  [Area.PISO_5]: 'Piso 5',
  [Area.PISO_6]: 'Piso 6',
  [Area.PISO_7]: 'Piso 7',
  [Area.PISO_8]: 'Piso 8',
  [Area.HIT]:    'ITR',
  [Area.HRA]:    'Sala Espera',
  [Area.HSS]:    'Sueño',
  [Area.HUC]:    'UCO',
  [Area.HUQ]:    'URP',
  [Area.HUT]:    'UTI',
};

const AREA_ORDER: Area[] = [
  Area.HRA, // Pre-internación: pacientes en sillones esperando cama
  Area.HIT,
  Area.PISO_4, Area.PISO_5, Area.PISO_6, Area.PISO_7, Area.PISO_8,
  Area.HUC, Area.HUT, Area.HUQ, Area.HSS,
];

const HIDDEN_BY_DEFAULT_ADMISSION = new Set<string>([Area.HSS, Area.HUQ]);

// Tipo de dieta (PROGAL) de una cama: la respuesta del ítem "Tipo" del formulario de dieta
// (ej. "General", "Líquida", "Blanda de masticación 1"). Vive en bed.diets — dietTags mezcla
// el tipo con las condiciones ("Sí"), por eso para filtrar por TIPO leemos diets directo.
// Delega en types.ts (dietTypeFromDiets): fuente ÚNICA que comparte con el guard
// server-side de api/dietas.ts, así UI y server nunca divergen en qué es "tener dieta".
const dietTypeOf = (b: Bed): string | undefined => dietTypeFromDiets(b.diets);

interface BedsViewProps {
  beds: Bed[];
  tickets: Ticket[];
  currentUser: User | null;
  bedsLoading?: boolean;
  bedsError?: string | null;
  isolatedBeds?: Set<string>;
  onEnrichBed?: (bed: Bed) => Promise<Bed>;
  // Historial de traslados de un paciente, on-demand (para el botón "Historial del paciente").
  onFetchPatientTickets?: (patientCode?: string) => Promise<Ticket[]>;
  onRefresh?: () => void | Promise<void>;
  // Limpieza por azafata: marca/deshace una cama "En preparación" como limpia (overlay
  // de 14.Limpiezas — ver hooks/useHospitalState markBedClean/undoBedClean).
  onMarkClean?: (bed: Bed) => void | Promise<void>;
  onUndoClean?: (bedLabel: string) => void | Promise<void>;
  /** "Volver a En preparación" (permiso limpieza_revertir): la habitación se pasó a limpia y está sucia. */
  onRevertirLimpieza?: (bed: Bed) => Promise<{ ok: boolean; error?: string }>;
  // Carga de menú por Nutrición (15.CargasDieta): carga/actualiza o quita una comida.
  onSaveMeal?: (bed: Bed, comida: MealSlot, tipo: 'MENU' | 'OPCION' | 'OTROS', detalle: string, observaciones: string) => Promise<{ ok: boolean; error?: string }>;
  onClearMeal?: (bed: Bed, comida: MealSlot, motivo?: string) => void | Promise<void>;
  onSaveCompanion?: (bed: Bed, comida: MealSlot, data: { spItemId?: string; tipo: 'MENU' | 'OPCION' | 'OTROS'; detalle: string; observaciones: string }) => Promise<{ ok: boolean; error?: string }>;
  onClearCompanion?: (bed: Bed, comida: MealSlot, spItemId: string, motivo?: string) => void | Promise<void>;
  // Cirugía (feature Cx): Enfermería marca "Listo para cirugía" (alta) sobre una cama ocupada y
  // "Recibida" (recepción confirmada) cuando el paciente vuelve. La pill Cx por color la pinta
  // mergeBeds (bed.cirugia). El gating fino por permiso cirugia_* llega en F5/go-live.
  onMarcarListo?: (bed: Bed) => Promise<{ ok: boolean; id?: string; error?: string }>;
  onCirugiaEnTraslado?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onCirugiaTolerancia?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** "Volver un paso" de una operatoria (corrige un paso marcado por error). */
  onCirugiaRetroceder?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** "Ya se operó (fuera de MediFlow)": registra una cirugía previa de esta internación (saca la "Q"). */
  onCirugiaPrevia?: (bed: Bed) => Promise<{ ok: boolean; error?: string }>;
  onAnularCirugiaPrevia?: (id: string, bed?: Bed) => Promise<{ ok: boolean; error?: string }>;
  // Limpieza de rutina (camas ocupadas): iniciar / finalizar. Se pasan solo si el rol tiene el
  // permiso `limpieza_rutina` (App.tsx los gatea) → undefined = sin permiso = botón escondido.
  onStartRoutineCleaning?: (bed: Bed) => Promise<void>;
  onFinishRoutineCleaning?: (bed: Bed) => Promise<void>;
  // Marca "va a cirugía" (Admisión, permiso cirugia_marcar): prende/apaga el flag sobre un paciente
  // NO quirúrgico desde la solapa Internación. Habilita el botón "Listo para cirugía" en camas no-Q.
  // undefined = sin permiso = toggle escondido.
  onMarcarVaCirugia?: (bed: Bed) => Promise<{ ok: boolean; error?: string }>;
  onDesmarcarVaCirugia?: (patientCode: string) => Promise<{ ok: boolean; error?: string }>;
}

// Colores de los aislamientos (punto de la cartelería) y de los estados de cama: lib/estados-camas.ts
// (los comparte con la leyenda del mapa en App.tsx).

// Fechas que vienen del back como ISO: se formatean con lib/formato.ts, pero un ISO roto no puede
// romper el render (date-fns tira RangeError con una fecha inválida) → string vacío.
const fechaHoraSegura = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : fechaHora(d);
};
const fechaSegura = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : fecha(d);
};

// Aviso inline suave (DESIGN §9.4): bg-{c}-50 + border-{c}-200 + text-{c}-700, con ícono. Un solo
// componente para los carteles del detalle de la cama (limpieza, dieta, cirugía, bloqueos).
type TonoAviso = 'exito' | 'aviso' | 'peligro' | 'info' | 'neutro' | 'violeta' | 'cian';
const CLASE_AVISO: Record<TonoAviso, string> = {
  exito: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  aviso: 'border-amber-200 bg-amber-50 text-amber-700',
  peligro: 'border-red-200 bg-red-50 text-red-700',
  info: 'border-blue-200 bg-blue-50 text-blue-700',
  neutro: 'bg-muted/40 text-muted-foreground',
  // Marcas de aislamiento del mapa (lib/estados-camas.ts): bloqueada = violeta, preventivo = cian.
  violeta: 'border-violet-200 bg-violet-50 text-violet-700',
  cian: 'border-cyan-200 bg-cyan-50 text-cyan-700',
};
const AvisoInline: React.FC<{
  tono: TonoAviso;
  icono: React.ElementType;
  compacto?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ tono, icono: Icono, compacto, className, children }) => (
  <div className={cn('flex items-start gap-2 rounded-lg border', compacto ? 'p-2 text-xs' : 'p-3 text-sm', CLASE_AVISO[tono], className)}>
    <Icono className={cn('mt-0.5 shrink-0', compacto ? 'size-3.5' : 'size-4')} aria-hidden="true" />
    <div className="min-w-0 flex-1">{children}</div>
  </div>
);

// Micro-label de sección / dato (DESIGN §1.4): text-[11px] uppercase tracking-wider muted.
const MICRO = 'text-[11px] font-semibold tracking-wider text-muted-foreground uppercase';

// Normalización para comparar nombres de aislamiento sin tildes/casing.
const normIsoName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// "Contacto preventivo" (Gamma: "De contacto preventivo", color teal) es un aislamiento
// de baja restricción → la cama contigua NO se inhabilita, solo se señaliza.
const isPreventiveContact = (iso: IsolationEntry) => normIsoName(iso.name).includes('preventivo');
// Una cama aislada es "solo preventiva" si TODOS sus tipos activos son Contacto preventivo.
// (Si tiene además un aislamiento duro, la habitación se bloquea como siempre.)
const isPreventiveOnlyBed = (bed: Bed) =>
  (bed.isolations?.length ?? 0) > 0 && bed.isolations!.every(isPreventiveContact);

/**
 * Camas afectadas por el aislamiento de un COMPAÑERO de habitación:
 *  · blocked    → bloqueo duro (violeta/"inhabilitada"): hay un aislamiento no-preventivo.
 *  · preventive → solo Contacto preventivo: se señaliza (cyan), no se inhabilita.
 *
 * SOLO se marcan camas LIBRES (Disponible / En preparación). El bloqueo existe para no ASIGNAR
 * un paciente nuevo en una habitación con aislamiento; una cama ya OCUPADA (o Asignada, con un
 * traslado en curso) tiene su paciente adentro — grisarla la hacía ver "inhabilitada", que es el
 * bug reportado (dos camas ocupadas en un cuarto, una se aísla y la otra quedaba gris).
 * Exportada para testearla contra la función real.
 */
export function computeIsolationBlocks(
  beds: Bed[], isolatedBeds: Set<string>,
): { blocked: Set<string>; preventive: Set<string> } {
  const blocked = new Set<string>();
  const preventive = new Set<string>();
  const roomMap = new Map<string, Bed[]>();
  for (const bed of beds) {
    if (!bed.roomCode) continue;
    if (!roomMap.has(bed.roomCode)) roomMap.set(bed.roomCode, []);
    roomMap.get(bed.roomCode)!.push(bed);
  }
  for (const [, roomBeds] of roomMap) {
    // Áreas con cubículos independientes (UCO, UTI, ITR, HRA): no se bloquean entre sí al aislar.
    if (roomBeds.some(b => isIndividualBoxArea(b.area))) continue;
    const isolatedInRoom = roomBeds.filter(b => isolatedBeds.has(b.label));
    if (isolatedInRoom.length === 0) continue;
    const roomHasHard = isolatedInRoom.some(b => !isPreventiveOnlyBed(b));
    const roomHasPreventive = isolatedInRoom.some(b => (b.isolations ?? []).some(isPreventiveContact));
    for (const b of roomBeds) {
      if (isolatedBeds.has(b.label)) continue;
      // Solo camas asignables: una ocupada/asignada ya tiene paciente, no se bloquea.
      if (b.status !== BedStatus.AVAILABLE && b.status !== BedStatus.PREPARATION) continue;
      if (roomHasHard) blocked.add(b.label);
      else if (roomHasPreventive) preventive.add(b.label);
    }
  }
  return { blocked, preventive };
}

// Zócalo de totales al pie de los PDF de camas. Ocupadas = Ocupada + Asignada; los
// porcentajes dejan afuera "En preparación" (camas en tránsito, no computan ocupación):
//   · s/Habilitadas = Ocupadas / (Ocupadas + Libres)          → excluye Prep e Inhabilitadas
//   · s/Total       = Ocupadas / (Ocupadas + Libres + Inhab.) → excluye solo Prep
function drawBedTotalsFooter(
  doc: jsPDF,
  beds: Bed[],
  opts: { pageW: number; pageH: number; margin: number; curY: number; now: string },
): void {
  const { pageW, pageH, margin, now } = opts;
  const count = (s: BedStatus) => beds.filter(b => b.status === s).length;
  const ocupadas = count(BedStatus.OCCUPIED) + count(BedStatus.ASSIGNED);
  const libres   = count(BedStatus.AVAILABLE);
  const inhab    = count(BedStatus.DISABLED);
  const prep     = count(BedStatus.PREPARATION);
  const pct = (n: number, d: number) =>
    (d > 0 ? (n / d) * 100 : 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let y = opts.curY + 4;
  if (y > pageH - margin - 14) { doc.addPage(); y = 26; } // no entra → nueva página

  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 5;

  const items: [string, string][] = [
    ['Total Camas Ocupadas:', String(ocupadas)],
    ['Total Camas Libres:', String(libres)],
    ['Total Camas Inhabilitadas:', String(inhab)],
    ['Total Camas En Prep.:', String(prep)],
    ['Porcentaje Ocupación s/Habilitadas:', pct(ocupadas, ocupadas + libres)],
    ['Porcentaje Ocupación s/Total:', pct(ocupadas, ocupadas + libres + inhab)],
  ];
  doc.setFontSize(8);
  const GAP = 2.5;      // separación label → valor
  const ITEM_GAP = 11;  // separación entre contadores
  let x = margin;
  for (const [label, val] of items) {
    // Medir el label con la MISMA fuente con la que se dibuja (negrita, más ancha) — sino el
    // valor se posiciona encima del final del label (el "Ocupadas0" pegado que se veía).
    doc.setFont('helvetica', 'bold');   const labelW = doc.getTextWidth(label);
    doc.setFont('helvetica', 'normal'); const valW = doc.getTextWidth(val);
    const w = labelW + GAP + valW;
    if (x + w > pageW - margin) { x = margin; y += 5.5; } // wrap si no entra en la línea
    doc.setFont('helvetica', 'bold');   doc.setTextColor(71, 85, 105);
    doc.text(label, x, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 41, 59);
    doc.text(val, x + labelW + GAP, y);
    x += w + ITEM_GAP;
  }

  y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
  doc.text(`Fecha-Hora: ${now}`, margin, y);
}


// ── Carga de menú por Nutrición (pestaña Dieta) ─────────────────────────────
// Menú y Opción son EXCLUYENTES → un solo botón activo. Nutrición carga/actualiza/quita;
// catering (sin permiso) lo ve en modo lectura. Ver api/dietas.ts.
// El orden y los labels salen del catálogo único (types.ts) — NO redeclarar la lista acá.

const fmtMealWhen = (m?: { by: string; at: string }) =>
  m ? `${m.by}${m.at ? ` · ${fechaHoraSegura(m.at)}` : ''}` : '';

// Pill de tipo (compartido con el monitor de comandas): Menú/Opción/Otros con su color.
export const comandaTipoPill = (t?: string): { label: string; cls: string } =>
  t === 'MENU'   ? { label: 'Menú',   cls: 'bg-emerald-100 text-emerald-700' }
  : t === 'OPCION' ? { label: 'Opción', cls: 'bg-amber-100 text-amber-700' }
  : { label: 'Otros', cls: 'bg-indigo-100 text-indigo-700' };

// Tono del tipo de comanda en el StatusBadge de esta vista: mismos matices que comandaTipoPill
// (Menú esmeralda · Opción ámbar · Otros índigo), que sigue exportada tal cual para el monitor de comandas.
const TONO_TIPO_COMANDA: Record<'MENU' | 'OPCION' | 'OTROS', Tono> = { MENU: 'exito', OPCION: 'aviso', OTROS: 'indigo' };
const tonoTipoComanda = (t?: string): Tono => TONO_TIPO_COMANDA[t as 'MENU' | 'OPCION' | 'OTROS'] ?? 'indigo';

// Selector Menú / Opción / Otros: control segmentado (DESIGN §6.6). El tipo elegido ya no se pinta con
// un relleno de color: es una selección, va como la solapa activa (bg-background + sombra).
const TipoComandaSegmentado: React.FC<{
  value: 'MENU' | 'OPCION' | 'OTROS' | '';
  onPick: (op: 'MENU' | 'OPCION' | 'OTROS') => void;
  disabled?: boolean;
  compacto?: boolean;
}> = ({ value, onPick, disabled, compacto }) => (
  <div role="group" aria-label="Tipo de comanda" className={cn('flex w-full items-center rounded-md bg-muted p-1', compacto ? 'h-8' : 'h-9')}>
    {(['MENU', 'OPCION', 'OTROS'] as const).map(op => (
      <button key={op} type="button" onClick={() => onPick(op)} disabled={disabled} aria-pressed={value === op}
        className={cn('h-full flex-1 rounded-sm text-xs font-medium transition-all outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          value === op ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}>
        {op === 'MENU' ? 'Menú' : op === 'OPCION' ? 'Opción' : 'Otros'}
      </button>
    ))}
  </div>
);

/** Planificación vigente resuelta: turno → { MENU?: texto, OPCION?: texto }. */
type PlannedMenu = Partial<Record<MealSlot, Partial<Record<'MENU' | 'OPCION', string>>>>;

/**
 * Trae la planificación de menú (16.CargaMenu) y deja lista la vigente para HOY (ART).
 *
 * La vigencia se resuelve acá y no en el server: el endpoint devuelve las activas (son pocas —
 * un puñado de rangos) y filtrar en memoria evita un request por cada cama que se abre.
 *
 * "Hoy" en hora Argentina, y las fechas se comparan como STRING: son 'YYYY-MM-DD', o sea que el
 * orden lexicográfico ES el cronológico. Nunca `new Date()` sobre ellas (ver decisión D2: son
 * fechas calendarias, no instantes — parsearlas correría el día).
 */
function usePlannedMenu(enabled: boolean): PlannedMenu {
  const [planned, setPlanned] = useState<PlannedMenu>({});

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('mediflow_token');
        const r = await fetch('/api/carga-menu', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!r.ok) return;                       // sin permiso o SP caído → sin autocompletado
        const d = await r.json();
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
        const out: PlannedMenu = {};
        for (const p of (d.plans ?? []) as any[]) {
          const slot = mealSlotFromSp(p.turno);
          if (!slot) continue;
          const desde = String(p.desde ?? ''), hasta = String(p.hasta ?? '');
          if (!(desde <= today && today <= hasta)) continue;    // no vigente hoy
          const tipo = String(p.tipo ?? '').toUpperCase();
          if (tipo !== 'MENU' && tipo !== 'OPCION') continue;
          (out[slot] ??= {})[tipo] = String(p.comanda ?? '');
        }
        if (!cancelled) setPlanned(out);
      } catch { /* sin autocompletado; el campo sigue editable a mano */ }
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  return planned;
}

const MealSlotEditor: React.FC<{
  bed: Bed; slot: MealSlot; label: string; canEdit: boolean;
  /** Solo-lectura POR PERMISO de turno (no por rol visor): muestra el candado y la leyenda.
      Distinto de `!canEdit` a secas — catering puro ve la misma rama read-only SIN señalizar,
      porque para él no hay "otros turnos que sí puede cargar" que expliquen la diferencia. */
  lockedByPermission?: boolean;
  /** Bloqueo "sin dieta": el titular no se puede cargar/editar (los acompañantes sí). */
  sinDieta?: boolean;
  /** Planificación vigente para este turno: tipo → texto. Autocompleta al elegir Menú/Opción. */
  planned?: Partial<Record<'MENU' | 'OPCION', string>>;
  open: boolean;
  onToggle: () => void;
  onSave?: (bed: Bed, comida: MealSlot, tipo: 'MENU' | 'OPCION' | 'OTROS', detalle: string, obs: string) => Promise<{ ok: boolean; error?: string }>;
  onClear?: (bed: Bed, comida: MealSlot, motivo?: string) => void | Promise<void>;
  onSaveCompanion?: (bed: Bed, comida: MealSlot, data: { spItemId?: string; tipo: 'MENU' | 'OPCION' | 'OTROS'; detalle: string; observaciones: string }) => Promise<{ ok: boolean; error?: string }>;
  onClearCompanion?: (bed: Bed, comida: MealSlot, spItemId: string, motivo?: string) => void | Promise<void>;
}> = ({ bed, slot, label, canEdit, lockedByPermission, sinDieta, planned, open, onToggle, onSave, onClear, onSaveCompanion, onClearCompanion }) => {
  const meal = bed.meals?.[slot]?.titular;
  const acomps = bed.meals?.[slot]?.acompanantes ?? [];
  // Dieta terapéutica (liviana/líquida/astringente…): el menú global de cocina no le aplica, así
  // que arranca PRESELECCIONADA en "Otros" — pero es un default, NO un bloqueo: las 3 opciones
  // quedan disponibles para todas las dietas (decisión D12/P2). Antes esto IMPONÍA "Otros".
  const preferOtros = dietRequiresCustomComanda(dietTypeOf(bed));
  const initialTipo = (): 'MENU' | 'OPCION' | 'OTROS' | '' =>
    meal?.tipo ?? (preferOtros ? 'OTROS' : '');

  const [tipo, setTipo] = useState<'MENU' | 'OPCION' | 'OTROS' | ''>(initialTipo);
  const [detalle, setDetalle] = useState(meal?.detalle ?? '');
  const [obs, setObs]   = useState(meal?.observaciones ?? '');
  const [saving, setSaving] = useState(false);
  // Quitar = anular → pide motivo inline (misma regla que el panel). `removing` abre el prompt,
  // `removeMotivo` lo que se escribe. Inline y no modal-sobre-modal: el editor ya vive dentro
  // del Dialog de la cama, y un Dialog anidado es frágil.
  const [removing, setRemoving] = useState(false);
  const [removeMotivo, setRemoveMotivo] = useState('');
  // Acompañantes todavía no persistidos. Contador local para la key (no crypto.randomUUID:
  // 0 usos en el repo y exige secure context — no vale traer una API nueva para ≤6 items).
  const [drafts, setDrafts] = useState<number[]>([]);
  const nextDraftId = React.useRef(0);
  // Mensaje del server cuando el guardado falla (ej. 409 de comanda ya entregada). Sin esto,
  // un fallo revertía el formulario en silencio y no había forma de saber por qué.
  const [saveError, setSaveError] = useState<string | null>(null);
  // Marca si el usuario tocó el form: evita que un poll externo (otro dispositivo actualiza la
  // MISMA cama+comida) pise lo que está tipeando sin guardar. Se re-arma tras un guardado propio.
  const editedRef = React.useRef(false);
  // Re-sincroniza el form cuando el server confirma un cambio (nuevo id/timestamp) — salvo que
  // el usuario tenga ediciones sin guardar (no las pisamos).
  const sig = `${meal?.spItemId ?? ''}|${meal?.at ?? ''}`;
  React.useEffect(() => {
    if (editedRef.current) return;
    setTipo(initialTipo());
    setDetalle(meal?.detalle ?? '');
    setObs(meal?.observaciones ?? '');
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const pill = meal ? comandaTipoPill(meal.tipo) : null;

  // Header: siempre visible, es el que colapsa. Muestra el estado sin abrir el box.
  const header = (
    <button type="button" onClick={onToggle} aria-expanded={open}
      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors outline-hidden hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex min-w-0 items-center gap-2">
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden="true" />
        <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {/* Candado en span y no `title` directo en el ícono: el atributo title sobre un <svg>
            inline no muestra tooltip nativo — sobre el <span> HTML sí. */}
        {lockedByPermission && (
          <span title="Tu rol no puede cargar este turno" className="flex items-center">
            <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="Solo lectura" />
          </span>
        )}
        {pill
          ? <StatusBadge tono={tonoTipoComanda(meal?.tipo)}>{pill.label}</StatusBadge>
          : <span className="text-[10px] text-muted-foreground">Sin carga</span>}
      </div>
    </button>
  );

  // Colapso por CSS (`hidden`) y NO por render condicional: desmontar destruiría lo tipeado sin
  // guardar. Con 4 turnos el riesgo se multiplica por 4.
  const body = (children: React.ReactNode) => (
    <div className={cn('space-y-2 border-t px-3 pt-2 pb-3', !open && 'hidden')}>{children}</div>
  );

  if (!canEdit) {
    return (
      <div className="overflow-hidden rounded-lg border bg-card">
        {header}
        {body(
          <>
            {lockedByPermission && (
              <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Lock className="size-3 shrink-0" aria-hidden="true" /> Solo lectura — tu rol no puede cargar este turno.
              </p>
            )}
            {meal ? (
              <>
                {meal.detalle && <p className="text-xs font-medium whitespace-pre-wrap wrap-break-word">{meal.detalle}</p>}
                {meal.observaciones && <p className="mt-0.5 text-xs whitespace-pre-wrap wrap-break-word text-muted-foreground">Obs: {meal.observaciones}</p>}
                <p className="mt-1 text-[10px] text-muted-foreground">{fmtMealWhen(meal)}</p>
              </>
            ) : <p className="text-xs text-muted-foreground">Sin carga</p>}
          </>
        )}
      </div>
    );
  }

  /**
   * Autocompletado (Fase 3). Al elegir Menú u Opción se copia el texto planificado al detalle.
   * Es una COPIA por valor: queda editable y lo que se guarda es el texto final.
   * NO destructivo: solo pisa el detalle si está vacío o si es exactamente el texto planificado
   * del otro tipo (o sea, algo que puso el autocompletado y no la persona).
   */
  const pickTipo = (op: 'MENU' | 'OPCION' | 'OTROS') => {
    editedRef.current = true;
    setTipo(op);
    if (op === 'OTROS') return;                    // "Otros" nunca autocompleta: se escribe a mano
    const texto = planned?.[op];
    if (!texto) return;                            // sin planificación vigente → no toca nada
    const autofilled = Object.values(planned ?? {}).filter(Boolean) as string[];
    const current = detalle.trim();
    if (current === '' || autofilled.includes(current)) setDetalle(texto);
  };

  const hasPlan = !!planned && (!!planned.MENU || !!planned.OPCION);
  const showNoPlanWarning = (tipo === 'MENU' || tipo === 'OPCION') && !planned?.[tipo];

  // Una bandeja ENTREGADA está congelada: ya salió de la cocina. Para cambiarla hay que
  // volverla a Pendiente desde el panel de comandas (paso explícito y auditable). El server
  // igual lo rechaza con 409 — esto es UX, no seguridad.
  const entregada = meal?.status === COMANDA_STATUS.ENTREGADO;
  const dirty =
    tipo !== (meal?.tipo ?? '') ||
    detalle.trim() !== (meal?.detalle ?? '').trim() ||
    obs.trim() !== (meal?.observaciones ?? '').trim();
  // En "Otros" el detalle (la comida) es OBLIGATORIO; en Menú/Opción es opcional.
  // `sinDieta` congela el guardado del titular (el server igual lo rechaza con 409 — esto es UX).
  const canSave = !entregada && !sinDieta && !!tipo && dirty && (tipo !== 'OTROS' || detalle.trim() !== '');

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {header}
      {body(
        <>
          {meal && <p className="text-[10px] text-muted-foreground">{fmtMealWhen(meal)}</p>}

          {/* Las 3 opciones para TODAS las dietas. En terapéuticas, "Otros" viene preseleccionado. */}
          <TipoComandaSegmentado value={tipo} onPick={pickTipo} disabled={entregada || sinDieta} />

          {entregada && (
            <AvisoInline tono="exito" icono={CheckCircle2} compacto>
              Ya entregada — para modificarla o quitarla, volvela a pendiente desde el panel de Comandas.
            </AvisoInline>
          )}
          {/* Bloqueo "sin dieta": el titular no se puede pedir hasta que PROGAL tenga la dieta.
              El botón "Quitar" queda operativo a propósito — es la válvula de escape para anular
              una comanda pre-existente de un paciente que perdió la dieta. */}
          {sinDieta && (
            <AvisoInline tono="aviso" icono={ShieldAlert} compacto>
              El paciente no tiene dieta cargada en PROGAL — no se puede pedir su comanda hasta que la dieta esté cargada.
              {meal ? ' La comanda ya cargada solo se puede quitar.' : ''} Los acompañantes sí se pueden cargar.
            </AvisoInline>
          )}
          {preferOtros && !entregada && !sinDieta && (
            <p className="text-[11px] text-muted-foreground">
              Dieta especial — sugerido "Otros" (podés cambiarlo)
            </p>
          )}

          {showNoPlanWarning && (
            <AvisoInline tono="aviso" icono={AlertCircle} compacto>
              No hay comanda planificada para este turno y tipo. Escribila abajo.
            </AvisoInline>
          )}

          <Input value={detalle} onChange={e => { editedRef.current = true; setDetalle(e.target.value); }} maxLength={500}
            disabled={entregada || sinDieta}
            aria-label="Detalle de la comanda"
            aria-invalid={tipo === 'OTROS' && detalle.trim() === '' ? true : undefined}
            placeholder={tipo === 'OTROS' ? 'Comida / menú (obligatorio)' : 'Detalle de la comanda'}
            className="h-9" />
          <Textarea value={obs} onChange={e => { editedRef.current = true; setObs(e.target.value); }} rows={2} maxLength={500}
            disabled={entregada || sinDieta}
            aria-label="Observaciones"
            placeholder="Observaciones (opcional)"
            className="min-h-16 resize-none" />
          {saveError && (
            <AvisoInline tono="peligro" icono={AlertCircle} compacto>{saveError}</AvisoInline>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={!canSave || saving}
              onClick={async () => {
                if (!tipo || !onSave) return;
                setSaving(true); setSaveError(null);
                try {
                  const r = await onSave(bed, slot, tipo, detalle.trim(), obs.trim());
                  if (r?.ok) editedRef.current = false;
                  else setSaveError(r?.error ?? 'No se pudo guardar. Reintentá.');
                } finally { setSaving(false); }
              }}
              className="flex-1">
              {saving ? 'Guardando…' : meal ? 'Actualizar' : 'Guardar'}
            </Button>
            {/* "Quitar" es una anulación: bloqueada si el plato ya se entregó (congelado, como
                en el panel). Un plato pendiente sí se puede quitar, pero PIDIENDO MOTIVO. */}
            {meal && onClear && (
              <Button variant="outline" size="sm" disabled={saving || entregada || removing}
                title={entregada ? 'Ya entregada — volvela a pendiente desde el panel para poder quitarla' : undefined}
                onClick={() => { setRemoveMotivo(''); setRemoving(true); }}>
                Quitar
              </Button>
            )}
          </div>

          {/* Prompt inline de motivo al quitar (anular). Obligatorio, queda en el histórico. */}
          {removing && onClear && (
            <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-2.5">
              <p className="text-[11px] font-semibold tracking-wider text-red-700 uppercase">Motivo de anulación</p>
              <Textarea
                autoFocus value={removeMotivo} onChange={e => setRemoveMotivo(e.target.value)} rows={2} maxLength={500}
                aria-label="Motivo de anulación"
                placeholder="Ej: el paciente pasó a ayuno, alta, cambio de dieta…"
                className="min-h-16 resize-none" />
              <div className="flex gap-2">
                <Button variant="destructive" size="sm" disabled={!removeMotivo.trim() || saving}
                  onClick={async () => {
                    setSaving(true);
                    try { await onClear(bed, slot, removeMotivo.trim()); setRemoving(false); }
                    finally { setSaving(false); }
                  }}
                  className="flex-1">
                  {saving ? 'Quitando…' : 'Confirmar anulación'}
                </Button>
                <Button variant="outline" size="sm" disabled={saving} onClick={() => setRemoving(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {/* ── Acompañantes ─────────────────────────────────────────────── */}
          <div className="space-y-2 border-t pt-2">
            {(acomps.length > 0 || drafts.length > 0) && (
              <p className={MICRO}>Acompañante/s</p>
            )}
            {acomps.map((a, i) => (
              <CompanionEditor key={a.spItemId} bed={bed} slot={slot} companion={a} index={i + 1}
                planned={planned} onSave={onSaveCompanion} onRemove={onClearCompanion} />
            ))}
            {drafts.map((id, i) => (
              <CompanionEditor key={`draft-${id}`} bed={bed} slot={slot} index={acomps.length + i + 1}
                planned={planned} onSave={onSaveCompanion}
                onDiscardDraft={() => setDrafts(d => d.filter(x => x !== id))} />
            ))}
            {acomps.length + drafts.length < MAX_ACOMPANANTES && (
              <button type="button" onClick={() => setDrafts(d => [...d, nextDraftId.current++])}
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-dashed text-xs font-medium text-muted-foreground transition-colors outline-hidden hover:border-foreground/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                <Plus className="size-3.5" aria-hidden="true" /> Agregar acompañante
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

/**
 * Bloque de un acompañante. `companion === undefined` = DRAFT local (todavía no existe en SP):
 * se persiste recién al Guardar y el `orden` lo asigna el server.
 *
 * Tiene su PROPIO `editedRef` y su propio efecto de re-sync: el guard es por instancia, y con
 * 4 turnos × 6 acompañantes puede haber hasta 28 instancias vivas.
 */
const CompanionEditor: React.FC<{
  bed: Bed; slot: MealSlot; companion?: MealLoad; index: number;
  planned?: Partial<Record<'MENU' | 'OPCION', string>>;
  onSave?: (bed: Bed, comida: MealSlot, data: { spItemId?: string; tipo: 'MENU' | 'OPCION' | 'OTROS'; detalle: string; observaciones: string }) => Promise<{ ok: boolean; error?: string }>;
  onRemove?: (bed: Bed, comida: MealSlot, spItemId: string, motivo?: string) => void | Promise<void>;
  onDiscardDraft?: () => void;
}> = ({ bed, slot, companion, index, planned, onSave, onRemove, onDiscardDraft }) => {
  const [tipo, setTipo] = useState<'MENU' | 'OPCION' | 'OTROS' | ''>(companion?.tipo ?? '');
  const [detalle, setDetalle] = useState(companion?.detalle ?? '');
  const [obs, setObs] = useState(companion?.observaciones ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Quitar un acompañante YA GUARDADO = anularlo → pide motivo (igual que el titular). Un draft
  // se descarta sin motivo (no existe en SP todavía).
  const [removing, setRemoving] = useState(false);
  const [removeMotivo, setRemoveMotivo] = useState('');
  const editedRef = React.useRef(false);

  const sig = `${companion?.spItemId ?? ''}|${companion?.at ?? ''}`;
  React.useEffect(() => {
    if (editedRef.current) return;
    setTipo(companion?.tipo ?? '');
    setDetalle(companion?.detalle ?? '');
    setObs(companion?.observaciones ?? '');
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickTipo = (op: 'MENU' | 'OPCION' | 'OTROS') => {
    editedRef.current = true;
    setTipo(op);
    if (op === 'OTROS') return;
    const texto = planned?.[op];
    if (!texto) return;
    const autofilled = Object.values(planned ?? {}).filter(Boolean) as string[];
    const current = detalle.trim();
    if (current === '' || autofilled.includes(current)) setDetalle(texto);
  };

  const entregada = companion?.status === COMANDA_STATUS.ENTREGADO;
  const dirty =
    tipo !== (companion?.tipo ?? '') ||
    detalle.trim() !== (companion?.detalle ?? '').trim() ||
    obs.trim() !== (companion?.observaciones ?? '').trim();
  const canSave = !entregada && !!tipo && dirty && (tipo !== 'OTROS' || detalle.trim() !== '');

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Acompañante {index}
          {entregada && <StatusBadge tono="exito">Entregada</StatusBadge>}
        </span>
        {/* Bloqueado si la bandeja del acompañante ya se entregó (congelada, como el titular).
            Un draft (sin companion) o un acompañante pendiente sí se pueden quitar. */}
        <Button variant="ghost" size="icon-sm" disabled={entregada || removing}
          title={entregada ? 'Ya entregada — volvela a pendiente desde el panel para poder quitarla' : 'Eliminar acompañante'}
          aria-label="Eliminar acompañante"
          onClick={() => {
            if (!companion) { onDiscardDraft?.(); return; }   // draft → se descarta sin red ni motivo
            setRemoveMotivo(''); setRemoving(true);            // guardado → pide motivo
          }}
          className="size-7 text-muted-foreground hover:text-destructive">
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Prompt inline de motivo al quitar un acompañante guardado (anular). */}
      {removing && companion && (
        <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-2.5">
          <p className="text-[11px] font-semibold tracking-wider text-red-700 uppercase">Motivo de anulación</p>
          <Textarea
            autoFocus value={removeMotivo} onChange={e => setRemoveMotivo(e.target.value)} rows={2} maxLength={500}
            aria-label="Motivo de anulación"
            placeholder="Ej: cambio de dieta, ya no come el acompañante…"
            className="min-h-16 resize-none" />
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" disabled={!removeMotivo.trim() || saving}
              onClick={async () => {
                setSaving(true);
                try { await onRemove?.(bed, slot, companion.spItemId, removeMotivo.trim()); setRemoving(false); }
                finally { setSaving(false); }
              }}
              className="flex-1">
              {saving ? 'Quitando…' : 'Confirmar'}
            </Button>
            <Button variant="outline" size="sm" disabled={saving} onClick={() => setRemoving(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      <TipoComandaSegmentado value={tipo} onPick={pickTipo} compacto />
      <Input value={detalle} onChange={e => { editedRef.current = true; setDetalle(e.target.value); }} maxLength={500}
        aria-label={`Detalle del acompañante ${index}`}
        aria-invalid={tipo === 'OTROS' && detalle.trim() === '' ? true : undefined}
        placeholder={tipo === 'OTROS' ? 'Comida (obligatorio)' : 'Detalle'}
        className="h-8" />
      <Input value={obs} onChange={e => { editedRef.current = true; setObs(e.target.value); }} maxLength={500}
        aria-label={`Observaciones del acompañante ${index}`}
        placeholder="Observaciones (opcional)"
        className="h-8" />
      {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
      <Button size="sm" disabled={!canSave || saving}
        onClick={async () => {
          if (!tipo || !onSave) return;
          setSaving(true); setError(null);
          try {
            const r = await onSave(bed, slot, { spItemId: companion?.spItemId, tipo, detalle: detalle.trim(), observaciones: obs.trim() });
            // Si falla NO se revierte en silencio: se conserva lo tipeado y se avisa.
            if (r.ok) { editedRef.current = false; onDiscardDraft?.(); }
            else setError(r?.error ?? 'No se pudo guardar. Reintentá.');
          } finally { setSaving(false); }
        }}
        className="w-full">
        {saving ? 'Guardando…' : companion ? 'Actualizar' : 'Guardar'}
      </Button>
    </div>
  );
};

// ── "Volver a En preparación" (rollback de limpieza, permiso limpieza_revertir; 29/10/2026) ──────────
// Caso 517: se pasó a limpia y estaba sucia, y Admisión ya la había consolidado (PROGAL Disponible). Confirmación
// inline (nunca confirm() nativo). La cama vuelve a verse En preparación hasta que la limpien de nuevo.
const VolverAPreparacion: React.FC<{ bed: Bed; onConfirm: (bed: Bed) => Promise<{ ok: boolean; error?: string }>; onDone: () => void }> = ({ bed, onConfirm, onDone }) => {
  const [confirmando, setConfirmando] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!confirmando) {
    return (
      <Button variant="outline" onClick={() => { setError(null); setConfirmando(true); }} className="w-full">
        <Undo2 /> Volver a "En preparación"
      </Button>
    );
  }
  return (
    <div className="space-y-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm text-amber-700">
        ¿La habitación está <strong>sucia</strong>? Se vuelve a mostrar <strong>En preparación</strong> hasta que una azafata la marque limpia de nuevo. Si ya estaba consolidada, actualicen también PROGAL.
      </p>
      {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} className="flex-1"
          onClick={async () => { setBusy(true); setError(null); const r = await onConfirm(bed); setBusy(false); if (r.ok) onDone(); else setError(r.error ?? 'No se pudo.'); }}>
          {busy ? 'Guardando…' : 'Sí, está sucia'}
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmando(false)} className="flex-1">
          No
        </Button>
      </div>
    </div>
  );
};

// ── Bloque de Cirugía en el detalle de la cama (Enfermería) ──────────────────
// · Cama OCUPADA sin cirugía viva → botón "Listo para cirugía" (alta), SOLO si el paciente es
//   quirúrgico (admissionTypeCode==='Q', aviso con fecha probable) o fue marcado por Admisión
//   (flag bed.goingToSurgery, para pacientes NO quirúrgicos — ver cirugia_marcas).
// · Cama con cirugía viva → pill Cx por color; si está EN_DEVOLUCION ("Regreso de cirugía"), botón
//   "Iniciar dieta" (paso final: la enfermería del piso destino recibe e inicia la dieta — CIERRA).
const CirugiaBedBlock: React.FC<{
  bed: Bed;
  // ¿El paciente ya tiene una cirugía COMPLETADA? Si sí, el auto-habilitado del quirúrgico (Q) ya NO
  // aplica: cada cirugía firma su consentimiento, así que de la 2da en adelante Admisión debe re-habilitar.
  tieneCirugiaCompletada?: boolean;
  onMarcarListo?: (bed: Bed) => Promise<{ ok: boolean; id?: string; error?: string }>;
  onCirugiaEnTraslado?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onCirugiaTolerancia?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** "Volver un paso" de una operatoria (corrige un paso marcado por error). */
  onCirugiaRetroceder?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** "Ya se operó (fuera de MediFlow)": registra una cirugía previa de esta internación (saca la "Q"). */
  onCirugiaPrevia?: (bed: Bed) => Promise<{ ok: boolean; error?: string }>;
  onAnularCirugiaPrevia?: (id: string, bed?: Bed) => Promise<{ ok: boolean; error?: string }>;
  /** Cirugía previa ("fuera de MediFlow") de ESTA internación, si se registró. */
  previa?: { id: string; createdAt?: string } | null;
  currentUser: User | null;
  onDone: () => void;
}> = ({ bed, tieneCirugiaCompletada, onMarcarListo, onCirugiaEnTraslado, onCirugiaTolerancia, onCirugiaRetroceder, onCirugiaPrevia, onAnularCirugiaPrevia, previa, currentUser, onDone }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Confirmación inline (nunca confirm() nativo): "Volver un paso" y "Ya se operó" dejan registro.
  const [confirmando, setConfirmando] = useState<'retroceder' | 'previa' | null>(null);
  const [accion, setAccion] = useState<'listo' | 'retroceder' | 'previa' | 'anular' | null>(null);
  const run = async (a: NonNullable<typeof accion>, fn: () => Promise<{ ok: boolean; error?: string }>, fallback: string) => {
    setBusy(true); setError(null); setAccion(a);
    const r = await fn();
    setBusy(false); setAccion(null); setConfirmando(null);
    if (r.ok) onDone(); else setError(r.error ?? fallback);
  };
  const cx = bed.cirugia;
  const esQuirurgico = (bed.admissionTypeCode ?? '').toUpperCase() === 'Q';
  // Auto-habilitado SOLO en la 1ra cirugía del quirúrgico (consentimiento del ingreso). Si ya tiene una
  // completada, deja de auto-habilitarse → necesita la marca de Admisión (nuevo consentimiento).
  const autoQ = esQuirurgico && !tieneCirugiaCompletada;
  const flagActivo = !!bed.goingToSurgery; // marca "va a cirugía" de Admisión
  // La fecha probable de cirugía (EVE_FECHA_PROBABLE_CIRUGIA) viene de PROGAL a medianoche (sin hora
  // real) → se muestra SOLO fecha; con timeStyle salía un "00:00" confuso. Igual que el modal (fmtDateOnly).
  const fmtFechaProbable = (iso?: string) => fechaSegura(iso);

  // Cama con operatoria viva → pill + (Iniciar dieta si está de regreso de cirugía).
  if (cx) {
    // ¿Hay cambio de cama al volver? Entonces hay DOS overlays: la cama vieja (role 'origin', el
    // paciente ya no vuelve acá) y la cama nueva (role 'destino', donde LLEGA el paciente).
    const esCambio = !!cx.camaDestino && cx.camaDestino !== cx.camaOrigen;
    const soyDestino = cx.role === 'destino';            // esta cama es la de LLEGADA
    const soyOrigenConCambio = cx.role === 'origin' && esCambio; // esta cama es la VIEJA
    // Iniciar dieta (paso FINAL, ya sin "Recibida" intermedio): la confirma la enfermera de la cama
    // donde LLEGA el paciente (cama destino si cambió, o la propia si volvió a la misma). En la cama
    // origen de un cambio NO va el botón. Cierra la operatoria y avisa a Catering.
    const puedoTolerancia = cx.estado === 'EN_DEVOLUCION' && (soyDestino || !esCambio);
    // "Volver un paso" (20/10/2026): corrige un paso marcado por error (p. ej. "En traslado a cirugía"
    // que al final no salió). Pide el permiso del paso que se deshace y queda en la trayectoria. En la
    // cama vieja de un cambio no va (el paciente ya no está ahí).
    // Desde "Listo para cirugía" también: anula la marca (permiso cirugia_volver_listo, pedido de Enfermería 29/10/2026).
    const retro = cirugiaRetrocesoDe(cx.estado);
    const puedoRetroceder = !!onCirugiaRetroceder && !!retro && can(currentUser, retro.permiso) && !soyOrigenConCambio;
    const infoCx = estadoCirugia(cx.estado);
    return (
      <div className="flex flex-col gap-2.5 rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tono={infoCx.tono}>
            <Activity className="size-3" aria-hidden="true" /> Cx · {CIRUGIA_ESTADO_LABEL[cx.estado]}
          </StatusBadge>
          {soyDestino && (
            <span className="text-xs font-medium text-muted-foreground">Cama destino</span>
          )}
        </div>
        {/* Cama DESTINO: llega un paciente de otra cama → mostrar quién y de dónde. */}
        {soyDestino && (
          <p className="text-sm text-muted-foreground">
            Llega de cirugía: <strong className="font-semibold text-foreground">{cx.pacienteNombre ?? 'paciente'}</strong> (viene de {formatBedName(cx.camaOrigen)})
          </p>
        )}
        {/* Cama ORIGEN de un cambio: el paciente NO vuelve acá, se fue a la destino. */}
        {soyOrigenConCambio && (
          <p className="text-sm text-muted-foreground">
            El paciente volvió de cirugía a <strong className="font-semibold text-foreground">{formatBedName(cx.camaDestino!)}</strong> — iniciá la dieta en esa cama.
          </p>
        )}
        {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
        {cx.estado === 'VAN_A_BUSCAR' && onCirugiaEnTraslado && (
          <Button disabled={busy} className="w-full"
            onClick={async () => {
              setBusy(true); setError(null);
              const r = await onCirugiaEnTraslado(cx.id);
              setBusy(false);
              if (r.ok) onDone(); else setError(r.error ?? 'No se pudo confirmar.');
            }}>
            <ArrowRight /> {busy ? 'Registrando…' : 'En traslado a cirugía'}
          </Button>
        )}
        {puedoTolerancia && onCirugiaTolerancia && (
          <Button disabled={busy} className="w-full"
            onClick={async () => {
              setBusy(true); setError(null);
              const r = await onCirugiaTolerancia(cx.id);
              setBusy(false);
              if (r.ok) onDone(); else setError(r.error ?? 'No se pudo confirmar.');
            }}>
            <CheckCircle2 /> {busy ? 'Confirmando…' : 'Iniciar dieta'}
          </Button>
        )}
        {puedoRetroceder && (confirmando === 'retroceder' ? (
          <div className="space-y-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm text-amber-700">
              ¿<strong>{retro!.pregunta}</strong>? Queda registrado en la trayectoria del paciente.
            </p>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} className="flex-1" onClick={() => run('retroceder', () => onCirugiaRetroceder!(cx.id), 'No se pudo volver el paso.')}>
                {busy ? 'Volviendo…' : 'Sí, volver'}
              </Button>
              <Button variant="outline" size="sm" disabled={busy} className="flex-1" onClick={() => setConfirmando(null)}>
                No
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" disabled={busy} onClick={() => { setError(null); setConfirmando('retroceder'); }}
            title={`${retro!.pregunta} (corrige un paso marcado por error)`}
            className="w-full">
            <Undo2 /> Volver un paso
          </Button>
        ))}
      </div>
    );
  }

  // Cama ocupada sin cirugía → alta (Enfermería marca "listo"). Solo aparece si el paciente está
  // HABILITADO: quirúrgico en su 1ra cirugía (autoQ) o marcado por Admisión (flag "va a cirugía").
  // Un Q que ya se operó NO se auto-habilita → necesita la marca (nuevo consentimiento). Antes
  // aparecía para cualquier Q sin importar cuántas cirugías previas tuviera.
  //
  // "Ya se operó (fuera de MediFlow)" (20/10/2026): Gamma empezó a usar el módulo con pacientes Q que ya
  // se habían operado en esta internación y la "Q" los mostraba como pendientes. Deja constancia (una
  // cirugía previa completada): la "Q" se va y una nueva cirugía necesita la marca de Admisión.
  const puedeListo = !!onMarcarListo && (autoQ || flagActivo);
  // Sin la internación (evento) de PROGAL no se ofrece: la previa tiene que quedar atada a esta internación.
  const puedePrevia = !!onCirugiaPrevia && autoQ && !!bed.patientCode && !!bedEventKey(bed);
  if (bed.status !== BedStatus.OCCUPIED || !(puedeListo || puedePrevia || previa)) return null;

  // Operatoria viva de OTRO paciente que salió de esta cama (p. ej. el anterior quedó en "Regreso de
  // cirugía" sin "Iniciar dieta"). Ya NO bloquea: el candado es por paciente (migración 20261020140000).
  // Solo se informa para que no pase desapercibida. Antes la API devolvía ok sin marcar (20/10/2026).
  const bloq = bed.cirugiaBloqueante;
  const bloqDesde = bloq?.updatedAt ? new Date(bloq.updatedAt) : null;
  const bloqDesdeTxt = bloqDesde && !isNaN(bloqDesde.getTime())
    ? ` desde el ${diaMes(bloqDesde)} ${hora(bloqDesde)}`
    : '';
  const previaFecha = previa?.createdAt ? new Date(previa.createdAt) : null;
  const previaFechaTxt = previaFecha && !isNaN(previaFecha.getTime()) ? ` el ${diaMes(previaFecha)}` : '';

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border bg-card p-3">
      {previa && (
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm wrap-break-word text-muted-foreground">
            Cirugía previa registrada (fuera de MediFlow){previaFechaTxt}.
            {!flagActivo && ' Para una nueva cirugía, Admisión tiene que habilitarlo con "Va a cirugía".'}
            {onAnularCirugiaPrevia && (
              <button type="button" disabled={busy} onClick={() => run('anular', () => onAnularCirugiaPrevia(previa.id, bed), 'No se pudo deshacer.')}
                className="ml-1.5 rounded-sm font-medium text-foreground underline underline-offset-2 outline-hidden hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                {accion === 'anular' ? 'Deshaciendo…' : 'Deshacer'}
              </button>
            )}
          </p>
        </div>
      )}
      {autoQ && (
        <AvisoInline tono="aviso" icono={Activity}>
          Paciente quirúrgico (PROGAL){bed.expectedSurgeryDate ? ` · cirugía probable: ${fmtFechaProbable(bed.expectedSurgeryDate)}` : ''}.
        </AvisoInline>
      )}
      {flagActivo && (
        <AvisoInline tono="aviso" icono={Activity}>
          {esQuirurgico ? 'Nueva cirugía autorizada por Admisión' : 'Marcado para cirugía por Admisión'}{bed.goingToSurgeryBy ? ` (${bed.goingToSurgeryBy})` : ''}.
        </AvisoInline>
      )}
      {bloq && (
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm wrap-break-word text-muted-foreground">
            {bloq.estado === 'EN_DEVOLUCION'
              ? <>Esta cama tiene pendiente "Iniciar dieta" de <strong className="font-semibold text-foreground">{bloq.pacienteNombre || 'otro paciente'}</strong> (Regreso de cirugía{bloqDesdeTxt}).</>
              : <>De esta cama salió una cirugía de <strong className="font-semibold text-foreground">{bloq.pacienteNombre || 'otro paciente'}</strong> que sigue abierta ({CIRUGIA_ESTADO_LABEL[bloq.estado]}{bloqDesdeTxt}).</>}
            {' '}No impide marcar a este paciente.
          </p>
        </div>
      )}
      {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
      {puedeListo && (
        <Button disabled={busy} className="w-full" onClick={() => run('listo', () => onMarcarListo!(bed), 'No se pudo marcar.')}>
          <Activity /> {accion === 'listo' ? 'Marcando…' : 'Listo para cirugía'}
        </Button>
      )}
      {puedePrevia && (confirmando === 'previa' ? (
        <div className="space-y-2.5 rounded-lg border bg-muted/40 p-3">
          <p className="text-sm">
            ¿Este paciente <strong>ya se operó en esta internación</strong>? Queda registrado, la "Q" deja de mostrarse y una nueva cirugía va a necesitar la autorización de Admisión.
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} className="flex-1" onClick={() => run('previa', () => onCirugiaPrevia!(bed), 'No se pudo registrar.')}>
              {busy ? 'Registrando…' : 'Sí, ya se operó'}
            </Button>
            <Button variant="outline" size="sm" disabled={busy} className="flex-1" onClick={() => setConfirmando(null)}>
              No
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" disabled={busy} onClick={() => { setError(null); setConfirmando('previa'); }} className="w-full">
          <CheckCircle2 /> Ya se operó (fuera de MediFlow)
        </Button>
      ))}
    </div>
  );
};

// Toggle "Va a cirugía" (Admisión) en la solapa Internación del detalle de cama. Prende/apaga el
// flag public.cirugia_marcas para habilitar el circuito Cx. El flag sigue al paciente (keyed por
// código) y se auto-borra al cerrar una cirugía → es "por cirugía". Habilita a los NO quirúrgicos y,
// además, a un quirúrgico que YA se operó (nueva cirugía = nuevo consentimiento). No aplica si ya hay
// operatoria Cx viva o el paciente no tiene código Gamma. Estado local busy/error (como CirugiaBedBlock).
const VaCirugiaToggle: React.FC<{
  bed: Bed;
  tieneCirugiaCompletada?: boolean;
  onMarcar: (bed: Bed) => Promise<{ ok: boolean; error?: string }>;
  onDesmarcar: (patientCode: string) => Promise<{ ok: boolean; error?: string }>;
}> = ({ bed, tieneCirugiaCompletada, onMarcar, onDesmarcar }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checked = !!bed.goingToSurgery;
  const cxViva = !!bed.cirugia;                                    // operatoria Cx ya iniciada → el flag ya no aplica
  const esQuirurgico = (bed.admissionTypeCode ?? '').toUpperCase() === 'Q';
  const autoQ = esQuirurgico && !tieneCirugiaCompletada;          // 1ra cirugía del Q → auto-habilitado, el toggle no aplica
  const sinCodigo = !bed.patientCode;
  const disabled = busy || cxViva || sinCodigo || autoQ;
  const toggle = async () => {
    if (disabled) return;
    setBusy(true); setError(null);
    const r = checked ? await onDesmarcar(bed.patientCode!) : await onMarcar(bed);
    setBusy(false);
    if (!r.ok) setError(r.error ?? 'No se pudo actualizar.');
  };
  const titulo = cxViva ? 'Cirugía en curso' : sinCodigo ? 'Paciente sin código Gamma' : checked ? 'Desmarcar' : 'Marcar va a cirugía';
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={cn(MICRO, 'mb-0.5')}>Va a cirugía</p>
          <p className="text-sm">
            {autoQ ? 'Paciente quirúrgico (PROGAL) — ya habilitado'
              : esQuirurgico ? (checked ? `Nueva cirugía autorizada${bed.goingToSurgeryBy ? ` por ${bed.goingToSurgeryBy}` : ''}` : 'Ya se operó — autorizar nueva cirugía (nuevo consentimiento)')
              : checked ? `Marcado${bed.goingToSurgeryBy ? ` por ${bed.goingToSurgeryBy}` : ''}`
              : 'Habilitar cirugía para este paciente'}
          </p>
        </div>
        <Switch checked={checked} disabled={disabled} onCheckedChange={() => toggle()} title={titulo} aria-label={titulo} />
      </div>
      {cxViva && <p className="mt-1 text-xs text-muted-foreground">Cirugía en curso: el flag ya no aplica.</p>}
      {sinCodigo && (
        <AvisoInline tono="aviso" icono={AlertCircle} compacto className="mt-2">El paciente no tiene código Gamma: no se puede marcar.</AvisoInline>
      )}
      {error && <p role="alert" className="mt-1 text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
};

// Limpieza de RUTINA sobre una cama OCUPADA (~2x/día): Iniciar → Finalizar. Solo aparece si el rol
// tiene el permiso (App.tsx pasa los handlers según can()). NO cambia el estado de la cama.
const RoutineCleaningBlock: React.FC<{
  bed: Bed;
  onStart?: (bed: Bed) => Promise<void>;
  onFinish?: (bed: Bed) => Promise<void>;
  onDone: () => void;
}> = ({ bed, onStart, onFinish, onDone }) => {
  const [busy, setBusy] = useState(false);
  if (bed.status !== BedStatus.OCCUPIED || (!onStart && !onFinish)) return null;
  const active = !!bed.routineCleaningActive;
  if (active) {
    return (
      <div className="flex flex-col gap-2.5 rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tono={MARCAS_CAMA.rutina.tono}><SprayCan className="size-3" aria-hidden="true" /> Limpieza de rutina en curso</StatusBadge>
        </div>
        {bed.routineCleaningBy && (
          <p className="text-xs text-muted-foreground">
            Iniciada por {bed.routineCleaningBy}{bed.routineCleaningAt ? ` · ${fechaHoraSegura(bed.routineCleaningAt)}` : ''}
          </p>
        )}
        {onFinish && (
          <Button disabled={busy} className="w-full"
            onClick={async () => { setBusy(true); await onFinish(bed); setBusy(false); onDone(); }}>
            <Check /> {busy ? 'Finalizando…' : 'Finalizar limpieza de rutina'}
          </Button>
        )}
      </div>
    );
  }
  return onStart ? (
    <Button variant="outline" disabled={busy} className="w-full"
      onClick={async () => { setBusy(true); await onStart(bed); setBusy(false); onDone(); }}>
      <SprayCan /> {busy ? 'Iniciando…' : 'Iniciar limpieza de rutina'}
    </Button>
  ) : null;
};

export const BedsView: React.FC<BedsViewProps> = ({ beds, tickets, currentUser, bedsLoading, bedsError, isolatedBeds = new Set(), onEnrichBed, onFetchPatientTickets, onRefresh, onMarkClean, onUndoClean, onRevertirLimpieza, onSaveMeal, onClearMeal, onSaveCompanion, onClearCompanion, onMarcarListo, onCirugiaEnTraslado, onCirugiaTolerancia, onCirugiaRetroceder, onCirugiaPrevia, onAnularCirugiaPrevia, onStartRoutineCleaning, onFinishRoutineCleaning, onMarcarVaCirugia, onDesmarcarVaCirugia }) => {
  const [selectedBed, setSelectedBed] = useState<Bed | null>(null);
  // Turnos abiertos en el modal de la cama. Vive en el PADRE y no en cada box: si viviera adentro,
  // se perdería al cerrar/reabrir. Se resetea al cambiar de cama (el default se recalcula abajo).
  const [openSlots, setOpenSlots] = useState<Set<MealSlot>>(new Set());
  // `canLoadAnyMealSlot` cubre tanto `cargar_dieta` (histórico = todos los turnos) como los
  // granulares `cargar_comanda_<turno>` — un rol solo-granular también necesita la planificación.
  const plannedMenu = usePlannedMenu(can(currentUser, 'ver_dieta') || canLoadAnyMealSlot(currentUser));
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [enrichedBed, setEnrichedBed] = useState<Bed | null>(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [pdfExporting, setPdfExporting] = useState<'normal' | 'alpha' | 'dietas' | false>(false);
  const [pdfProgress, setPdfProgress] = useState({ done: 0, total: 0 });
  // Tab activa dentro del detalle de una cama ocupada (Generales / Internación / Dieta / Ayunos)
  const [detailTab, setDetailTab] = useState<'general' | 'internacion' | 'dieta' | 'ayunos'>('general');

  // Reset detail tab when opening a different bed
  React.useEffect(() => {
    setDetailTab('general');
  }, [selectedBed?.id]);

  // Default de colapso: se abren los turnos que YA tienen comanda cargada; el resto arranca
  // cerrado. Se deriva de `beds` (no de `selectedBed`, que es el snapshot del click) porque las
  // comandas llegan por el poll: en cold start `meals` viene vacío y los 4 quedarían cerrados,
  // justo para catering, que es lectura. Depende solo del id de la cama para no pelear contra el
  // usuario que colapsó algo a mano.
  React.useEffect(() => {
    if (!selectedBed?.id) { setOpenSlots(new Set()); return; }
    const fresh = beds.find(b => b.id === selectedBed.id) ?? selectedBed;
    setOpenSlots(new Set(MEAL_SLOTS.filter(s => fresh.meals?.[s.slot]).map(s => s.slot)));
  }, [selectedBed?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // On-demand enrichment when user clicks an occupied bed.
  // Siempre re-consultamos al abrir el modal: la dieta y otros campos del evento
  // (diagnóstico, fechas, plan médico) cambian en PROGAL en vivo y el cliente
  // necesita ver la data fresca. El cache del servidor diferencia paciente (TTL
  // 10min) de evento (TTL 30s) para no machacar a Gamma sin perder freshness.
  React.useEffect(() => {
    if (!selectedBed || selectedBed.status !== BedStatus.OCCUPIED || !onEnrichBed) {
      setEnrichedBed(null);
      return;
    }
    // El bed ya trae el enrich completo de SP (cron) → el modal abre al instante,
    // sin pegar a Gamma. Solo caemos al fetch on-demand si la cama todavía no fue
    // procesada por el cron (cama recién ocupada, sin enrich en 12.EnrichCamas).
    if (selectedBed.enriched) {
      setEnrichedBed(null);
      setEnrichLoading(false);
      return;
    }
    setEnrichLoading(true);
    setEnrichedBed(null);
    onEnrichBed(selectedBed).then(enriched => {
      setEnrichedBed(enriched);
      setEnrichLoading(false);
    }).catch(() => setEnrichLoading(false));
  }, [selectedBed?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayBed = enrichedBed ?? selectedBed;
  // Cama VIVA: el registro fresco de `beds` (el poll y las mutaciones optimistas lo actualizan con
  // el modal ABIERTO), a diferencia de selectedBed/displayBed que son el snapshot del click. La usamos
  // para el estado que cambia sin cerrar el modal (marca "va a cirugía", cirugía viva, estado).
  const liveBed = selectedBed ? (beds.find(b => b.id === selectedBed.id) ?? selectedBed) : null;
  // Cama para los controles de cirugía: campos de enrich (admissionTypeCode, expectedSurgeryDate,
  // patientCode) con el estado operativo SIEMPRE fresco de `beds`. Sin este merge, togglear "va a
  // cirugía" movía el switch pero NO refrescaba el botón "Listo para cirugía": había que cerrar y
  // reabrir el modal (y lo mismo al destildar).
  const cirugiaBed: Bed | null = displayBed && liveBed
    ? { ...displayBed, status: liveBed.status, goingToSurgery: liveBed.goingToSurgery, goingToSurgeryBy: liveBed.goingToSurgeryBy, cirugia: liveBed.cirugia, cirugiaBloqueante: liveBed.cirugiaBloqueante }
    : displayBed;

  // Historial de traslados del paciente de la cama abierta, ON-DEMAND: al abrir el modal se
  // fetchean SOLO sus tickets (incl. Consolidados/Cancelados) por código — sin depender de
  // tener toda la historia en memoria. `loaded` distingue "todavía no cargó" de "cargó y no
  // tiene ninguno" → el botón muestra spinner / "Historial" / "Sin traslados" correctamente.
  const [patientTickets, setPatientTickets] = useState<Ticket[]>([]);
  const [patientTicketsLoading, setPatientTicketsLoading] = useState(false);
  const [patientTicketsLoaded, setPatientTicketsLoaded] = useState(false);

  React.useEffect(() => {
    const code = selectedBed?.patientCode?.trim();
    if (!code || !selectedBed?.patientName || !onFetchPatientTickets) {
      setPatientTickets([]); setPatientTicketsLoaded(false); setPatientTicketsLoading(false);
      return;
    }
    let cancelled = false;
    setPatientTicketsLoading(true);
    setPatientTicketsLoaded(false);
    onFetchPatientTickets(code)
      .then(ts => { if (!cancelled) { setPatientTickets(ts); setPatientTicketsLoaded(true); } })
      .catch(() => { if (!cancelled) { setPatientTickets([]); setPatientTicketsLoaded(true); } })
      .finally(() => { if (!cancelled) setPatientTicketsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedBed?.id, onFetchPatientTickets]);

  // ¿El paciente tiene CIRUGÍAS? Un paciente puede tener cirugía sin ningún traslado → el botón de
  // trayectoria (que muestra ambas solapas) debe aparecer igual. Se chequea on-demand por código.
  const [patientHasCirugias, setPatientHasCirugias] = useState(false);
  const [patientCirugiasLoaded, setPatientCirugiasLoaded] = useState(false);
  // ¿El paciente YA tiene una cirugía COMPLETADA (TOLERANCIA_EVALUADA)? Cada cirugía firma su propio
  // consentimiento → de la 2da en adelante, aunque el paciente sea quirúrgico (Q), Admisión tiene que
  // re-habilitar con "va a cirugía". Solo las completadas cuentan (una cancelada no consumió consentimiento).
  const [patientTieneCxCompletada, setPatientTieneCxCompletada] = useState(false);
  // Cirugía previa "fuera de MediFlow" de esta internación (para la nota + "Deshacer" de CirugiaBedBlock).
  const [patientCxPrevia, setPatientCxPrevia] = useState<{ id: string; createdAt?: string } | null>(null);
  React.useEffect(() => {
    const code = selectedBed?.patientCode?.trim();
    setPatientCxPrevia(null);
    if (!code || !selectedBed?.patientName) { setPatientHasCirugias(false); setPatientTieneCxCompletada(false); setPatientCirugiasLoaded(false); return; }
    let cancelled = false;
    setPatientCirugiasLoaded(false);
    // Internación ACTUAL: sólo cuentan las cirugías cerradas de este mismo evento. El consentimiento
    // se firma por internación, así que una cirugía de un ingreso anterior no debe seguir bloqueando.
    const ekey = bedEventKey(selectedBed);
    const token = localStorage.getItem('mediflow_token');
    fetch(`/api/cirugia?paciente=${encodeURIComponent(code)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.json() : { cirugias: [] })
      .then((d: { cirugias?: { id?: string; estado?: string; eventKey?: string; tipo?: string; createdAt?: string }[] }) => {
        if (cancelled) return;
        const list = Array.isArray(d.cirugias) ? d.cirugias : [];
        setPatientHasCirugias(list.length > 0);
        // Sin eventKey (de la cama o de la fila) no se puede discriminar → cuenta, como antes.
        // Espeja exactamente el gate del servidor en api/cirugia.ts; ante falta de dato, nunca
        // desbloquear de más.
        const deEstaInternacion = (c: { eventKey?: string }) => !ekey || !c.eventKey || c.eventKey === ekey;
        setPatientTieneCxCompletada(list.some(c => c?.estado === 'TOLERANCIA_EVALUADA' && deEstaInternacion(c)));
        const previa = list.find(c => c?.tipo === CIRUGIA_TIPO_PREVIA && c.estado === 'TOLERANCIA_EVALUADA' && deEstaInternacion(c));
        setPatientCxPrevia(previa?.id ? { id: String(previa.id), createdAt: previa.createdAt } : null);
      })
      .catch(() => { if (!cancelled) { setPatientHasCirugias(false); setPatientTieneCxCompletada(false); } })
      .finally(() => { if (!cancelled) setPatientCirugiasLoaded(true); });
    return () => { cancelled = true; };
  }, [selectedBed?.id]);

  // ¿Este usuario puede ver comandas cargadas? (Nutrición carga; Catering/Nutrición ven).
  // Gatea tanto el ícono de la tarjeta como la sección de la pestaña Dieta.
  // Poder cargar ALGÚN turno implica ver toda la sección (espeja la semántica histórica en la
  // que `cargar_dieta` implicaba ver): quien pide almuerzo necesita ver qué hay en los demás.
  const canViewComanda = can(currentUser, 'ver_dieta') || canLoadAnyMealSlot(currentUser);

  // Aislamientos activos de una cama (vacío si no hay). Vienen del enrich (PROGAL).
  const getIsolationTypes = (bed: Bed): IsolationEntry[] => bed.isolations ?? [];

  // Rooms that have an isolated patient — other beds in same room are blocked.
  // Camas según el aislamiento del compañero de habitación (ver computeIsolationBlocks):
  //  · blockedByIsolation       → bloqueo DURO (violeta/"inhabilitada"), SOLO camas libres.
  //  · preventiveContactAdjacent → Contacto preventivo: señalización cyan, no inhabilita.
  const { blockedByIsolation, preventiveContactAdjacent } = useMemo(() => {
    const { blocked, preventive } = computeIsolationBlocks(beds, isolatedBeds);
    return { blockedByIsolation: blocked, preventiveContactAdjacent: preventive };
  }, [beds, isolatedBeds]);

  // Sexo al que ya está comprometida cada habitación por sus ocupantes.
  // Sobre `beds` COMPLETO (igual que blockedByIsolation): si un filtro de la vista escondiera al
  // ocupante, la sugerencia desaparecería sin que se entienda por qué.
  const suggestedSexByRoom = useMemo(() => suggestedRoomSex(beds), [beds]);

  /**
   * ¿Qué sexo sugerir para esta cama? `null` = no mostrar nada.
   * Gate único para los dos puntos de render (celda del mapa y modal de detalle).
   * Función plana a propósito: se invoca dentro del map, no viaja como prop.
   */
  const suggestedSexFor = (bed: Bed | null | undefined): 'M' | 'F' | null => {
    if (!bed?.roomCode) return null;
    // Solo camas que se pueden llegar a asignar. OCCUPIED/ASSIGNED/DISABLED no aplican.
    if (bed.status !== BedStatus.AVAILABLE && bed.status !== BedStatus.PREPARATION) return null;
    // Cama no asignable por aislamiento (se pinta violeta) → sugerir un sexo sería contradictorio.
    if (blockedByIsolation.has(bed.label)) return null;
    // Misma exención que ya aplica el bloqueo por aislamiento (:642-644): en estas áreas los
    // cubículos son físicamente independientes (HUC/HUT/HIT) o son sillones de sala de
    // espera (HRA), así que "compartir habitación" no significa lo mismo.
    if (isIndividualBoxArea(bed.area)) return null;
    return suggestedSexByRoom.get(`${bed.area}|${bed.roomCode}`) ?? null;
  };

  // Map beds to their assigned ticket (for "Asignada" beds)
  const bedTicketMap = useMemo(() => {
    const map = new Map<string, Ticket>();
    for (const t of tickets) {
      if (t.destination && [TicketStatus.WAITING_ROOM, TicketStatus.IN_TRANSIT, TicketStatus.IN_TRANSPORT].includes(t.status)) {
        map.set(t.destination, t);
      }
    }
    return map;
  }, [tickets]);

  // Filters state
  const [searchFilter, setSearchFilter] = useState('');

  // Sectores que el rol tiene HABILITADOS — no es un default, es el techo.
  //
  // Antes esto solo sembraba el valor inicial de `areaFilters` y el desplegable listaba
  // AREA_ORDER completo, así que una azafata de Piso 8 podía tildar Piso 4/UTI/UCO y ver
  // esas camas con sus pacientes. El filtro por rol era una sugerencia, no un límite.
  //
  // Mismo criterio que ComandasManagementView, CleaningManagementView y el bloque de
  // limpieza del modal de más abajo: sin `filterByFloors` (admin/admisión/enfermería) o sin
  // áreas asignadas, se ven todos los sectores.
  //
  // Se filtra sobre AREA_ORDER y no sobre `assignedAreas` para conservar el orden canónico
  // del desplegable (Sala Espera → ITR → pisos → críticos).
  const allowedAreas = useMemo<string[]>(() => {
    if (!currentUser?.filterByFloors || !currentUser.assignedAreas?.length) return AREA_ORDER as string[];
    const asignadas = new Set<string>(currentUser.assignedAreas);
    return (AREA_ORDER as string[]).filter(a => asignadas.has(a));
  }, [currentUser]);

  // Si el rol filtra por pisos (FiltrarPisos_RT=Sí) y tiene áreas asignadas, los filtros
  // de área arrancan limitados a esos pisos. Los demás roles arrancan con todos los
  // sectores, ocultando los "low-impact" para admisión (URP/Sueño/...).
  const [areaFilters, setAreaFilters] = useState<Set<string>>(() => {
    if (currentUser?.filterByFloors && currentUser.assignedAreas?.length) {
      return new Set<string>(currentUser.assignedAreas);
    }
    const all = new Set<string>(Object.values(Area));
    // Admisión/Admin: ocultar por defecto sectores low-impact. Detectado por permiso
    // `editar_ticket` (Admisión + Admin lo tienen).
    if (can(currentUser, 'editar_ticket')) {
      HIDDEN_BY_DEFAULT_ADMISSION.forEach(a => all.delete(a));
    }
    return all;
  });
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set());
  const [showIsolatedOnly, setShowIsolatedOnly] = useState(false);
  const [showDietOnly, setShowDietOnly] = useState(false);
  const [showFastingOnly, setShowFastingOnly] = useState(false);
  const [showCirugiaOnly, setShowCirugiaOnly] = useState(false);
  // Barra de filtros (DESIGN §4.7): abierta de entrada en desktop, cerrada en mobile (como Operativa).
  const [verFiltros, setVerFiltros] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768);
  const [financierFilters, setFinancierFilters] = useState<Set<string>>(new Set());

  const [physicianFilters, setPhysicianFilters] = useState<Set<string>>(new Set());

  const [dietTypeFilters, setDietTypeFilters] = useState<Set<string>>(new Set());
  const [admissionTypeFilters, setAdmissionTypeFilters] = useState<Set<string>>(new Set());
  // Filtro por FECHA DE INTERNACIÓN (bed.admissionDate del enrich). Rango [desde, hasta] en
  // YYYY-MM-DD; cualquiera de los dos puede quedar vacío (bound abierto).
  const [admissionFrom, setAdmissionFrom] = useState('');
  const [admissionTo, setAdmissionTo] = useState('');

  // Camas con dieta cargada (al menos un tag: tipo de dieta o condición marcada "Sí").
  // Análogo a `isolatedBeds` pero derivado del enrich que ya traen las camas (cron).
  const dietBeds = useMemo(() => {
    const s = new Set<string>();
    for (const b of beds) if ((b.dietTags?.length ?? 0) > 0) s.add(b.label);
    return s;
  }, [beds]);

  // Camas con ayuno vigente (mismo criterio que el indicador de la celda: hasLiveFasting).
  const fastingBeds = useMemo(() => {
    const s = new Set<string>();
    for (const b of beds) if (hasLiveFasting(b.fasting)) s.add(b.label);
    return s;
  }, [beds]);

  // Camas con una operatoria de cirugía viva (overlay bed.cirugia, lo pinta mergeBeds).
  const cirugiaBeds = useMemo(() => {
    const s = new Set<string>();
    for (const b of beds) if (b.cirugia) s.add(b.label);
    return s;
  }, [beds]);

  // Label canónico del tipo Quirúrgica (ADMISSION_TYPE_LABELS['Q'] del enrich). Se usa para la
  // "vista amplia": el filtro Quirúrgica agrupa el tipo Q de PROGAL + las cirugías marcadas por
  // enfermería (clínico→quirúrgico), sin falsear el dato de la cama.
  const QUIRURGICA_LABEL = 'Quirúrgica';

  // El "todos" es sobre los sectores PERMITIDOS: una azafata de Piso 8 con su único sector
  // tildado tiene que leer "todos los sectores", no "1 sector".
  const areaFiltersVisibles = allowedAreas.filter(a => areaFilters.has(a)).length;
  const todosLosSectores = areaFiltersVisibles === allowedAreas.length;

  // Cantidad de filtros activos — badge del botón "Filtros" y habilita "Limpiar" (DESIGN §4.7).
  // El sector cuenta como uno cuando no están todos: a Admisión le arranca en 1 porque URP y
  // Sueño vienen ocultos (así se entiende por qué no aparecen).
  const activeFilterCount =
    (todosLosSectores ? 0 : 1) +
    statusFilters.size +
    (showIsolatedOnly ? 1 : 0) +
    (showDietOnly ? 1 : 0) +
    (showFastingOnly ? 1 : 0) +
    (showCirugiaOnly ? 1 : 0) +
    financierFilters.size +
    physicianFilters.size +
    dietTypeFilters.size +
    admissionTypeFilters.size +
    (admissionFrom || admissionTo ? 1 : 0);

  const uniqueFinanciers = useMemo(() => [...new Set(beds.filter((b: Bed) => b.institution).map((b: Bed) => b.institution!))].sort(), [beds]);
  const uniquePhysicians = useMemo(() => [...new Set(beds.filter((b: Bed) => b.prescribingPhysician).map((b: Bed) => b.prescribingPhysician!))].sort(), [beds]);
  // Tipos de dieta presentes en las camas cargadas, ordenados alfabéticamente (locale es).
  const uniqueDietTypes = useMemo(() => [...new Set(beds.map(dietTypeOf).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'es')), [beds]);
  // Tipos de internación presentes (admissionType: Quirúrgica/Trasplante/Hemodinamia/Quemados/Oncológica/Clínica), para el filtro.
  const uniqueAdmissionTypes = useMemo(() => {
    const s = new Set(beds.map((b: Bed) => b.admissionType).filter(Boolean) as string[]);
    // Vista amplia: ofrecé "Quirúrgica" aunque ningún paciente venga tipado Q del enrich, con tal
    // de que haya al menos una cirugía viva (todos clínicos marcados por enfermería, p.ej.).
    if (cirugiaBeds.size > 0) s.add(QUIRURGICA_LABEL);
    return [...s].sort((a, b) => a.localeCompare(b, 'es'));
  }, [beds, cirugiaBeds]);

  // "Limpiar" de la barra: vuelve todo a cero (DESIGN §4.7 regla 4), sectores incluidos (todos los
  // permitidos para el rol — el techo por rol no se toca, vive en el filtro).
  const limpiarFiltros = () => {
    setAreaFilters(new Set<string>(allowedAreas));
    setStatusFilters(new Set());
    setShowIsolatedOnly(false);
    setShowDietOnly(false);
    setShowFastingOnly(false);
    setShowCirugiaOnly(false);
    setFinancierFilters(new Set());
    setPhysicianFilters(new Set());
    setDietTypeFilters(new Set());
    setAdmissionTypeFilters(new Set());
    setAdmissionFrom('');
    setAdmissionTo('');
  };

  // Filter beds based on user role, assigned areas and search filters
  // El estado se aplica AL FINAL: `bedsSinEstado` (todo lo demás aplicado) da los conteos por estado
  // del resumen y del filtro, que no pueden caer a 0 cuando se elige un estado. Los filtros son todos
  // `filter` independientes, así que el orden no cambia el resultado.
  const { filteredBeds, bedsSinEstado } = useMemo(() => {
    // Techo por rol, ANTES que cualquier filtro de UI y sin importar `areaFilters`.
    //
    // Va acá y no solo en el desplegable a propósito: el desplegable es presentación, y
    // `areaFilters` es estado que se puede ensuciar por otros caminos (el check "Todos",
    // un `assignedAreas` que cambia en caliente al recargar el rol). Si el techo viviera
    // solo en el render de los checkboxes, cualquiera de esos caminos volvería a mostrar
    // camas de sectores ajenos. Esta línea es la que garantiza que no pase.
    let result = beds.filter(bed => allowedAreas.includes(bed.area));

    // Universal text search (patient, event, institution, physician, assigned ticket patient)
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      result = result.filter(bed => {
        if (
          bed.patientName?.toLowerCase().includes(q) ||
          bed.eventNumber?.toString().includes(q) ||
          bed.institution?.toLowerCase().includes(q) ||
          bed.attendingPhysician?.toLowerCase().includes(q) ||
          bed.roomCode?.includes(q) ||
          bed.bedCode?.includes(q)
        ) return true;
        // Also search in assigned ticket patient name (for beds in transfer)
        const assignedTicket = bedTicketMap.get(bed.label);
        if (assignedTicket?.patientName?.toLowerCase().includes(q)) return true;
        // Search tickets where this bed is origin or destination
        const relatedTicket = tickets.find(t =>
          (t.origin === bed.label || t.destination === bed.label) &&
          t.patientName?.toLowerCase().includes(q) &&
          t.status !== TicketStatus.COMPLETED && t.status !== TicketStatus.REJECTED
        );
        if (relatedTicket) return true;
        return false;
      });
    }
    if (areaFiltersVisibles < allowedAreas.length) {
      result = result.filter(bed => areaFilters.has(bed.area));
    }
    if (showIsolatedOnly) {
      result = result.filter(bed => isolatedBeds.has(bed.label));
    }
    if (showDietOnly) {
      result = result.filter(bed => dietBeds.has(bed.label));
    }
    if (showFastingOnly) {
      result = result.filter(bed => fastingBeds.has(bed.label));
    }
    if (showCirugiaOnly) {
      result = result.filter(bed => cirugiaBeds.has(bed.label));
    }
    if (financierFilters.size > 0) {
      result = result.filter(bed => bed.institution && financierFilters.has(bed.institution));
    }
    if (physicianFilters.size > 0) {
      result = result.filter(bed => bed.prescribingPhysician && physicianFilters.has(bed.prescribingPhysician));
    }
    if (dietTypeFilters.size > 0) {
      result = result.filter(bed => { const dt = dietTypeOf(bed); return !!dt && dietTypeFilters.has(dt); });
    }
    if (admissionTypeFilters.size > 0) {
      // Vista amplia: si "Quirúrgica" está seleccionado, además de las camas tipadas Q por PROGAL
      // entran las que tengan una cirugía activa (clínicos que enfermería marcó como quirúrgicos).
      const incluyeCx = admissionTypeFilters.has(QUIRURGICA_LABEL);
      result = result.filter(bed =>
        (!!bed.admissionType && admissionTypeFilters.has(bed.admissionType))
        || (incluyeCx && cirugiaBeds.has(bed.label))
      );
    }
    // Fecha de internación (rango sobre bed.admissionDate). Camas sin fecha quedan fuera cuando el
    // filtro está activo (no hay ingreso que ubicar en el rango).
    if (admissionFrom || admissionTo) {
      result = result.filter(bed => {
        const d = (bed.admissionDate || '').slice(0, 10);
        if (!d) return false;
        return (!admissionFrom || d >= admissionFrom) && (!admissionTo || d <= admissionTo);
      });
    }

    const sinEstado = result;
    const conEstado = statusFilters.size > 0 ? sinEstado.filter(bed => statusFilters.has(bed.status)) : sinEstado;
    return { filteredBeds: conEstado, bedsSinEstado: sinEstado };
  }, [beds, currentUser, searchFilter, areaFilters, statusFilters, allowedAreas, areaFiltersVisibles, bedTicketMap, showIsolatedOnly, isolatedBeds, showDietOnly, dietBeds, showFastingOnly, fastingBeds, showCirugiaOnly, cirugiaBeds, financierFilters, physicianFilters, dietTypeFilters, admissionTypeFilters, admissionFrom, admissionTo]);

  // Conteo de camas para el badge del header: excluimos HRA ("Sala de Espera"),
  // que son sillones de pre-internación y no camas reales. El grid y los PDFs
  // siguen mostrando HRA; solo el número del contador la deja afuera.
  const bedCount = useMemo(
    () => filteredBeds.filter(bed => bed.area !== Area.HRA).length,
    [filteredBeds],
  );

  // Conteo por estado de lo que se ve (todos los filtros menos el de estado): resumen siempre
  // visible arriba de la grilla y labels de las opciones del filtro "Estado".
  const conteoPorEstado = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of bedsSinEstado) m.set(b.status, (m.get(b.status) ?? 0) + 1);
    return m;
  }, [bedsSinEstado]);

  // Opciones de la barra de filtros (MultiCombobox, DESIGN §4.7): el conteo va en el label.
  const conteoPorSector = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of beds) m.set(b.area, (m.get(b.area) ?? 0) + 1);
    return m;
  }, [beds]);
  const opcionesSector = allowedAreas.map(a => ({ value: a, label: `${AREA_LABELS[a] ?? a} (${conteoPorSector.get(a) ?? 0})` }));
  // Todos los sectores = sin elegir (placeholder "Todos"); elegir uno muestra solo ese. Vaciar la
  // selección vuelve a todos los permitidos (antes se podía quedar en "Ningún sector" y el mapa en blanco).
  const valorSectores = todosLosSectores ? [] : allowedAreas.filter(a => areaFilters.has(a));
  const elegirSectores = (v: string[]) => setAreaFilters(new Set<string>(v.length ? v : allowedAreas));

  const opcionesEstado = ORDEN_ESTADOS_CAMA.map(st => ({ value: st, label: `${ESTADOS_CAMA[st].label} (${conteoPorEstado.get(st) ?? 0})` }));

  // "Solo camas con…": los cuatro toggles de antes (aislamiento / dieta / ayuno / cirugía), que se
  // suman entre sí (Y). Solo se ofrecen los que tienen alguna cama, como los chips de antes.
  const opcionesIndicador = [
    isolatedBeds.size > 0 && { value: 'aislamiento', label: `Aislamiento (${isolatedBeds.size})` },
    dietBeds.size > 0 && { value: 'dieta', label: `Dieta (${dietBeds.size})` },
    fastingBeds.size > 0 && { value: 'ayuno', label: `Ayuno (${fastingBeds.size})` },
    cirugiaBeds.size > 0 && { value: 'cirugia', label: `Cirugía (${cirugiaBeds.size})` },
  ].filter(Boolean) as { value: string; label: string }[];
  const valorIndicador = [
    showIsolatedOnly && 'aislamiento',
    showDietOnly && 'dieta',
    showFastingOnly && 'ayuno',
    showCirugiaOnly && 'cirugia',
  ].filter(Boolean) as string[];
  const elegirIndicador = (v: string[]) => {
    setShowIsolatedOnly(v.includes('aislamiento'));
    setShowDietOnly(v.includes('dieta'));
    setShowFastingOnly(v.includes('ayuno'));
    setShowCirugiaOnly(v.includes('cirugia'));
  };
  const aOpciones = (xs: string[]) => xs.map(x => ({ value: x, label: x }));

  // Fecha de internación: el DateRangePicker trabaja con Date; el filtro guarda 'YYYY-MM-DD'.
  const rangoInternacion = admissionFrom || admissionTo
    ? { from: deIso(admissionFrom), to: deIso(admissionTo) }
    : undefined;
  const elegirRangoInternacion = (r?: { from?: Date; to?: Date }) => {
    setAdmissionFrom(r?.from ? aIso(r.from) : '');
    setAdmissionTo(r?.to ? aIso(r.to) : '');
  };

  // Group beds by Area, ordered with HIT first.
  // Gamma a veces devuelve las camas de un piso en orden arbitrario (mezcla
  // 405-1 antes de 401-2, etc.). Forzamos el orden interno por label con
  // numeric collator para que "401 - Cama 02" < "402 - Cama 01" como uno espera.
  const bedsByArea: Record<string, Bed[]> = {};
  filteredBeds.forEach((bed: Bed) => {
    if (!bedsByArea[bed.area]) bedsByArea[bed.area] = [];
    bedsByArea[bed.area].push(bed);
  });
  for (const area of Object.keys(bedsByArea)) {
    bedsByArea[area].sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true }));
  }
  const sortedAreaEntries = Object.entries(bedsByArea).sort(([a], [b]) => {
    const ia = AREA_ORDER.indexOf(a as Area);
    const ib = AREA_ORDER.indexOf(b as Area);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  // ── Batch enrich for PDF export (concurrency limited) ──────────────────────
  const enrichBedsForPdf = useCallback(async (bedsToExport: Bed[], type: 'normal' | 'alpha' | 'dietas' = 'normal'): Promise<Bed[]> => {
    if (!onEnrichBed) return bedsToExport;
    // Solo enriquecemos on-demand (Gamma) las camas que el cron AÚN no procesó. Las que
    // ya traen el enrich de SP (`enriched=true`) tienen diagnóstico/dieta/ayuno/DNI listos
    // → no se vuelven a pedir. Gatear por `!b.dni` re-consultaba a Gamma por cada paciente
    // sin DNI aunque ya estuviera enriquecido, y por eso el PDF tardaba.
    const occupied = bedsToExport.filter(b => b.status === BedStatus.OCCUPIED && b.patientCode && !b.enriched);
    if (occupied.length === 0) return bedsToExport;

    setPdfExporting(type);
    setPdfProgress({ done: 0, total: occupied.length });

    const enrichedMap = new Map<string, Bed>();
    const queue = [...occupied];
    let done = 0;

    // 3 concurrent workers
    const workers = Array.from({ length: 3 }, async () => {
      while (queue.length > 0) {
        const bed = queue.shift()!;
        try {
          const enriched = await onEnrichBed(bed);
          enrichedMap.set(bed.id, enriched);
        } catch { /* skip this bed */ }
        done++;
        setPdfProgress({ done, total: occupied.length });
      }
    });
    await Promise.all(workers);

    setPdfExporting(false);
    return bedsToExport.map(b => enrichedMap.get(b.id) ?? b);
  }, [onEnrichBed]);

  // ── PDF Export ─────────────────────────────────────────────────────────────
  const exportPDF = useCallback(async () => {
    // Enrich all occupied beds before generating PDF
    const enrichedBeds = await enrichBedsForPdf(filteredBeds, 'normal');
    const enrichedByArea: Record<string, Bed[]> = {};
    enrichedBeds.forEach((bed: Bed) => {
      if (!enrichedByArea[bed.area]) enrichedByArea[bed.area] = [];
      enrichedByArea[bed.area].push(bed);
    });
    // Orden por área (AREA_ORDER) y, DENTRO de cada área, por label con collator numérico.
    // PROGAL devuelve las camas de algunos pisos (ej. Piso 8) en orden arbitrario; este sort
    // las normaliza igual que el grid en pantalla (401, 402, … 805, 806).
    const enrichedAreaEntries = AREA_ORDER
      .filter(a => enrichedByArea[a])
      .map(a => [
        a,
        [...enrichedByArea[a]].sort((x, y) => x.label.localeCompare(y.label, 'es', { numeric: true })),
      ] as [string, Bed[]]);

    // Inline helper: rasterise the SVG logo to a PNG data-URL
    const svgToLogoPng = (): Promise<string | null> => {
      return new Promise((resolve) => {
        try {
          const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 299 300" fill="none">
            <path d="M177.763 209.923C175.477 205.948 171.246 203.498 166.673 203.498H132.327C127.75 203.498 123.523 205.948 121.236 209.923L104.063 239.768C101.776 243.743 101.776 248.643 104.063 252.618L121.236 282.462C123.523 286.437 127.753 288.887 132.327 288.887H166.676C171.252 288.887 175.479 286.437 177.766 282.462L194.939 252.618C197.226 248.643 197.226 243.743 194.939 239.768L177.763 209.923Z" fill="#022C22"/>
            <path d="M121.236 90.078C123.523 94.053 127.753 96.503 132.327 96.503H166.676C171.252 96.503 175.479 94.053 177.766 90.078L194.939 60.2336C197.226 56.2586 197.226 51.3586 194.939 47.3836L177.763 17.5363C175.477 13.5613 171.249 11.1113 166.673 11.1113H132.327C127.75 11.1113 123.523 13.5613 121.236 17.5363L104.063 47.3808C101.776 51.3558 101.776 56.2558 104.063 60.2308L121.236 90.078Z" fill="#022C22"/>
            <path d="M277.967 191.673L260.794 161.825C258.507 157.85 254.276 155.4 249.703 155.4H215.354C210.778 155.4 206.55 157.85 204.263 161.825L187.09 191.67C184.803 195.645 184.803 200.545 187.09 204.52L204.263 234.364C206.55 238.339 210.78 240.789 215.354 240.789H249.703C254.279 240.789 258.507 238.339 260.794 234.364L277.967 204.52C280.254 200.548 280.254 195.648 277.967 191.673Z" fill="#022C22"/>
            <path d="M38.2046 138.175C40.4914 142.15 44.7217 144.6 49.2953 144.6H83.6443C88.2207 144.6 92.4482 142.15 94.735 138.175L111.908 108.33C114.195 104.355 114.195 99.4554 111.908 95.4804L94.735 65.6359C92.4482 61.6609 88.2179 59.2109 83.6443 59.2109H49.2981C44.7217 59.2109 40.4942 61.6609 38.2074 65.6359L21.0315 95.4776C18.7447 99.4526 18.7447 104.353 21.0315 108.328L38.2046 138.175Z" fill="#022C22"/>
            <path d="M111.911 191.672L94.7378 161.827C92.451 157.852 88.2207 155.402 83.6471 155.402H49.2981C44.7217 155.402 40.4942 157.852 38.2074 161.827L21.0315 191.672C18.7447 195.647 18.7447 200.547 21.0315 204.522L38.2046 234.366C40.4914 238.341 44.7217 240.791 49.2953 240.791H83.6443C88.2207 240.791 92.4482 238.341 94.735 234.366L111.908 204.522C114.198 200.547 114.198 195.647 111.911 191.672Z" fill="#022C22"/>
            <path d="M187.087 108.328L202.187 134.567H183.43C179.142 127.098 173.821 117.831 173.821 117.831C171.863 114.428 168.242 112.331 164.327 112.331H134.926C131.008 112.331 127.39 114.428 125.433 117.831L110.732 143.379C108.774 146.781 108.774 150.976 110.732 154.379L125.433 179.926C127.39 183.329 131.008 185.426 134.926 185.426H164.327C168.245 185.426 171.863 183.329 173.821 179.926L184.305 161.704H148.89V143.829H177.536H188.737H211.054C212.417 144.317 213.859 144.601 215.348 144.601H249.697C254.274 144.601 258.501 142.151 260.788 138.176L277.961 108.331C280.248 104.356 280.248 99.4563 277.961 95.4813L260.794 65.634C258.507 61.659 254.277 59.209 249.703 59.209H215.354C210.778 59.209 206.55 61.659 204.263 65.634L187.09 95.4785C184.801 99.4535 184.801 104.353 187.087 108.328Z" fill="#022C22"/>
          </svg>`;
          const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 200;
            canvas.height = 200;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0, 200, 200);
              resolve(canvas.toDataURL('image/png'));
            } else {
              resolve(null);
            }
            URL.revokeObjectURL(url);
          };
          img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
          img.src = url;
        } catch { resolve(null); }
      });
    };

    const logoPng = await svgToLogoPng();

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const now = new Date().toLocaleString('es-AR');
    const margin = 10;

    type RGB = [number, number, number];

    // Status display config: dot color + label text color
    const statusDotColor: Record<string, RGB> = {
      [BedStatus.AVAILABLE]:   [16, 185, 129],   // emerald
      [BedStatus.OCCUPIED]:    [220, 38, 38],     // red
      [BedStatus.PREPARATION]: [245, 158, 11],    // amber
      [BedStatus.ASSIGNED]:    [99, 102, 241],    // indigo
      [BedStatus.DISABLED]:    [148, 163, 184],   // slate
    };
    const statusTextColor: Record<string, RGB> = {
      [BedStatus.AVAILABLE]:   [4, 120, 87],
      [BedStatus.OCCUPIED]:    [153, 27, 27],
      [BedStatus.PREPARATION]: [146, 64, 14],
      [BedStatus.ASSIGNED]:    [55, 48, 163],
      [BedStatus.DISABLED]:    [100, 116, 139],
    };

    // ── Page header ──────────────────────────────────────────────────────────
    const drawHeader = (logo: string | null) => {
      const logoSize = 12;
      const textX = logo ? margin + logoSize + 4 : margin;

      if (logo) {
        try { doc.addImage(logo, 'PNG', margin, 4, logoSize, logoSize); } catch { /* skip */ }
      }

      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(2, 44, 34);
      doc.text('Grupo Gamma', textX, 10);

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text('MediFlow', textX, 15);

      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(`Sede ${currentUser?.sede || 'HPR'}  ·  ${now}`, pageW - margin, 10, { align: 'right' });

      // Green separator line
      doc.setDrawColor(7, 146, 113);
      doc.setLineWidth(0.5);
      doc.line(margin, 19, pageW - margin, 19);
    };

    // ── Column layout ────────────────────────────────────────────────────────
    // Total = 272mm; A4 landscape with 10mm margins leaves 277mm useful → cabe.
    // Hab.(13) | Cama(9) | Estado(20) | Paciente(34) | DNI(18) | Edad(8) | Sexo(8) | Tipo(11) | Ingreso(20) | Días(8) | Cirugía(16) | Evento(16) | Profesional(28) | Financiador(28) | Diagnóstico(35)
    const colWidths  = [13, 9, 20, 34, 18, 8, 8, 11, 20, 8, 16, 16, 28, 28, 35];
    const colHeaders = ['Hab.', 'Cama', 'Estado', 'Paciente', 'DNI', 'Edad', 'Sexo', 'Tipo', 'Ingreso', 'Días', 'Cirugía', 'Evento', 'Profesional', 'Financiador', 'Diagnóstico'];
    const rowH = 6;
    const tableWidth = colWidths.reduce((s, w) => s + w, 0);

    // X start positions. Orden VISUAL: "Evento" (índice lógico 11) se dibuja justo DESPUÉS de
    // "Cama" (índice 1), sin renumerar el resto del código de dibujo — colX[i] queda en la
    // posición visual de la columna i, así el header y las celdas caen solos donde corresponde.
    const visualOrder = [0, 1, 11, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14];
    const colX: number[] = new Array(colWidths.length);
    let cx = margin;
    for (const li of visualOrder) {
      colX[li] = cx;
      cx += colWidths[li];
    }

    let curY = 26;

    const ensurePage = (needed: number) => {
      if (curY + needed > pageH - margin) {
        doc.addPage();
        drawHeader(logoPng);
        curY = 26;
      }
    };

    // Draw the column header row
    const drawTableHeader = () => {
      ensurePage(rowH + 2);
      doc.setFillColor(226, 232, 240); // slate-200
      doc.rect(margin, curY, tableWidth, rowH, 'F');
      doc.setFontSize(6);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105); // slate-600
      colHeaders.forEach((h, i) => {
        doc.text(h, colX[i] + 1.5, curY + rowH - 1.8);
      });
      curY += rowH;
    };

    drawHeader(logoPng);

    // ── Rows ─────────────────────────────────────────────────────────────────
    let globalRowIndex = 0; // for alternating background across all areas

    for (const [areaKey, areaBeds] of enrichedAreaEntries) {
      const areaLabel = AREA_LABELS[areaKey] ?? areaKey;

      // Area shaded header row
      ensurePage(rowH + rowH + 2);
      doc.setFillColor(30, 41, 59); // slate-800
      doc.rect(margin, curY, tableWidth, rowH, 'F');
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(226, 232, 240); // slate-200
      doc.text(areaLabel, margin + 2, curY + rowH - 1.8);
      curY += rowH;

      // Column headers after each area title
      drawTableHeader();

      for (const bed of areaBeds) {
        ensurePage(rowH);

        const isOccupied = bed.status === BedStatus.OCCUPIED;
        const ticket = bedTicketMap.get(bed.label);
        const isAssigned = bed.status === BedStatus.ASSIGNED && !!ticket;
        const showPatientData = isOccupied || isAssigned;

        // Alternating row background
        const even = globalRowIndex % 2 === 0;
        const rowBg: RGB = even ? [255, 255, 255] : [248, 248, 248];
        doc.setFillColor(...rowBg);
        doc.rect(margin, curY, tableWidth, rowH, 'F');

        // Light row border
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.1);
        doc.line(margin, curY + rowH, margin + tableWidth, curY + rowH);

        const textY = curY + rowH - 1.8;

        // Col 0: Habitación
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 41, 59);
        doc.text(bed.roomCode ?? '', colX[0] + 1.5, textY);

        // Col 1: Cama
        doc.text(bed.bedCode ?? '', colX[1] + 1.5, textY);

        // Col 2: Estado — colored dot + text
        const dotColor: RGB = statusDotColor[bed.status] ?? [148, 163, 184];
        const txtColor: RGB = statusTextColor[bed.status] ?? [100, 116, 139];
        doc.setFillColor(...dotColor);
        doc.circle(colX[2] + 2.2, curY + rowH / 2, 1.2, 'F');
        doc.setFontSize(6);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...txtColor);
        doc.text(bed.status, colX[2] + 5, textY);

        // Reset font for data cells
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 41, 59);

        if (showPatientData) {
          const patientName = isOccupied
            ? (bed.patientName ?? '')
            : (ticket?.patientName ?? '');
          const dni = isOccupied
            ? (bed.dni ?? '')
            : '';
          const age = isOccupied
            ? (bed.age != null ? String(bed.age) : '')
            : '';
          const sex = isOccupied
            ? (bed.sex === 'M' ? 'M' : bed.sex === 'F' ? 'F' : '')
            : '';
          const financier = isOccupied
            ? (bed.institution ?? '')
            : (ticket?.financier ?? '');
          // Tipo, ingreso (DD/MM/YY HH:MM), días de estadía — de los datos enriquecidos
          const admissionCode = isOccupied ? (bed.admissionTypeCode ?? '') : '';
          const admissionDateShort = (() => {
            if (!isOccupied || !bed.admissionDate) return '';
            const d = new Date(bed.admissionDate);
            if (isNaN(d.getTime())) return '';
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yy = String(d.getFullYear()).slice(-2);
            const hh = String(d.getHours()).padStart(2, '0');
            const mi = String(d.getMinutes()).padStart(2, '0');
            return `${dd}/${mm}/${yy} ${hh}:${mi}`;
          })();
          const stayDays = (() => {
            if (!isOccupied || !bed.admissionDate) return '';
            const d = new Date(bed.admissionDate);
            if (isNaN(d.getTime())) return '';
            const diff = Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)));
            return String(diff);
          })();

          // Col 3: Paciente
          const maxPatientChars = Math.floor(colWidths[3] / 1.6);
          doc.text(patientName.substring(0, maxPatientChars), colX[3] + 1.5, textY);

          // Col 4: DNI
          doc.text(dni.substring(0, 12), colX[4] + 1.5, textY);

          // Col 5: Edad
          doc.text(age, colX[5] + 1.5, textY);

          // Col 6: Sexo
          doc.text(sex, colX[6] + 1.5, textY);

          // Col 7: Tipo (código corto: C, Q, T, K, H, O, R, CO)
          doc.text(admissionCode, colX[7] + 1.5, textY);

          // Col 8: Ingreso (fecha corta)
          doc.text(admissionDateShort, colX[8] + 1.5, textY);

          // Col 9: Días de estadía
          doc.text(stayDays, colX[9] + 1.5, textY);

          // Col 10: Fecha probable de cirugía (corta DD/MM/YY) — viene del enrich
          const cirugiaShort = (() => {
            if (!isOccupied || !bed.expectedSurgeryDate) return '';
            const d = new Date(bed.expectedSurgeryDate);
            if (isNaN(d.getTime())) return '';
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yy = String(d.getFullYear()).slice(-2);
            return `${dd}/${mm}/${yy}`;
          })();
          doc.text(cirugiaShort, colX[10] + 1.5, textY);

          // Col 11: Número de evento de internación (HIN-58213)
          const eventoStr = isOccupied && bed.eventOrigin && bed.eventNumber
            ? `${bed.eventOrigin}-${bed.eventNumber}`
            : '';
          doc.text(eventoStr, colX[11] + 1.5, textY);

          // Col 12: Profesional (prescriptor from event, fallback to attending)
          const prof = isOccupied ? (bed.prescribingPhysician ?? bed.attendingPhysician ?? '') : '';
          const maxPhysChars = Math.floor(colWidths[12] / 1.6);
          doc.text(prof.substring(0, maxPhysChars), colX[12] + 1.5, textY);

          // Col 13: Financiador
          const maxFinChars = Math.floor(colWidths[13] / 1.6);
          doc.text(financier.substring(0, maxFinChars), colX[13] + 1.5, textY);

          // Col 14: Diagnóstico (del enrich; puede ser largo → se trunca al ancho de columna)
          const diag = isOccupied ? (bed.diagnosis ?? '—') : '';
          const maxDiagChars = Math.floor(colWidths[14] / 1.6);
          doc.text(diag.substring(0, maxDiagChars), colX[14] + 1.5, textY);
        } else {
          // Cama libre/prep/inhab: sin paciente → guion tenue (antes repetía el nº de cama).
          doc.setTextColor(148, 163, 184);
          doc.text('-', colX[3] + 1.5, textY);
        }

        curY += rowH;
        globalRowIndex++;
      }

      // Small gap between areas
      curY += 3;
    }

    drawBedTotalsFooter(doc, enrichedBeds, { pageW, pageH, margin, curY, now });
    doc.save(`mapa-camas-${new Date().toISOString().slice(0, 10)}.pdf`);
  }, [filteredBeds, sortedAreaEntries, bedTicketMap, currentUser, enrichBedsForPdf]);

  // ── PDF Export (alphabetical by patient) ──────────────────────────────────
  const exportPDFAlpha = useCallback(async () => {
    // Enrich all occupied beds before generating PDF
    const enrichedBeds = await enrichBedsForPdf(filteredBeds, 'alpha');

    const svgToLogoPng = (): Promise<string | null> => {
      return new Promise((resolve) => {
        try {
          const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 299 300" fill="none">
            <path d="M177.763 209.923C175.477 205.948 171.246 203.498 166.673 203.498H132.327C127.75 203.498 123.523 205.948 121.236 209.923L104.063 239.768C101.776 243.743 101.776 248.643 104.063 252.618L121.236 282.462C123.523 286.437 127.753 288.887 132.327 288.887H166.676C171.252 288.887 175.479 286.437 177.766 282.462L194.939 252.618C197.226 248.643 197.226 243.743 194.939 239.768L177.763 209.923Z" fill="#022C22"/>
            <path d="M121.236 90.078C123.523 94.053 127.753 96.503 132.327 96.503H166.676C171.252 96.503 175.479 94.053 177.766 90.078L194.939 60.2336C197.226 56.2586 197.226 51.3586 194.939 47.3836L177.763 17.5363C175.477 13.5613 171.249 11.1113 166.673 11.1113H132.327C127.75 11.1113 123.523 13.5613 121.236 17.5363L104.063 47.3808C101.776 51.3558 101.776 56.2558 104.063 60.2308L121.236 90.078Z" fill="#022C22"/>
            <path d="M277.967 191.673L260.794 161.825C258.507 157.85 254.276 155.4 249.703 155.4H215.354C210.778 155.4 206.55 157.85 204.263 161.825L187.09 191.67C184.803 195.645 184.803 200.545 187.09 204.52L204.263 234.364C206.55 238.339 210.78 240.789 215.354 240.789H249.703C254.279 240.789 258.507 238.339 260.794 234.364L277.967 204.52C280.254 200.548 280.254 195.648 277.967 191.673Z" fill="#022C22"/>
            <path d="M38.2046 138.175C40.4914 142.15 44.7217 144.6 49.2953 144.6H83.6443C88.2207 144.6 92.4482 142.15 94.735 138.175L111.908 108.33C114.195 104.355 114.195 99.4554 111.908 95.4804L94.735 65.6359C92.4482 61.6609 88.2179 59.2109 83.6443 59.2109H49.2981C44.7217 59.2109 40.4942 61.6609 38.2074 65.6359L21.0315 95.4776C18.7447 99.4526 18.7447 104.353 21.0315 108.328L38.2046 138.175Z" fill="#022C22"/>
            <path d="M111.911 191.672L94.7378 161.827C92.451 157.852 88.2207 155.402 83.6471 155.402H49.2981C44.7217 155.402 40.4942 157.852 38.2074 161.827L21.0315 191.672C18.7447 195.647 18.7447 200.547 21.0315 204.522L38.2046 234.366C40.4914 238.341 44.7217 240.791 49.2953 240.791H83.6443C88.2207 240.791 92.4482 238.341 94.735 234.366L111.908 204.522C114.198 200.547 114.198 195.647 111.911 191.672Z" fill="#022C22"/>
            <path d="M187.087 108.328L202.187 134.567H183.43C179.142 127.098 173.821 117.831 173.821 117.831C171.863 114.428 168.242 112.331 164.327 112.331H134.926C131.008 112.331 127.39 114.428 125.433 117.831L110.732 143.379C108.774 146.781 108.774 150.976 110.732 154.379L125.433 179.926C127.39 183.329 131.008 185.426 134.926 185.426H164.327C168.245 185.426 171.863 183.329 173.821 179.926L184.305 161.704H148.89V143.829H177.536H188.737H211.054C212.417 144.317 213.859 144.601 215.348 144.601H249.697C254.274 144.601 258.501 142.151 260.788 138.176L277.961 108.331C280.248 104.356 280.248 99.4563 277.961 95.4813L260.794 65.634C258.507 61.659 254.277 59.209 249.703 59.209H215.354C210.778 59.209 206.55 61.659 204.263 65.634L187.09 95.4785C184.801 99.4535 184.801 104.353 187.087 108.328Z" fill="#022C22"/>
          </svg>`;
          const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 200; canvas.height = 200;
            const ctx = canvas.getContext('2d');
            if (ctx) { ctx.drawImage(img, 0, 0, 200, 200); resolve(canvas.toDataURL('image/png')); }
            else { resolve(null); }
            URL.revokeObjectURL(url);
          };
          img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
          img.src = url;
        } catch { resolve(null); }
      });
    };

    const logoPng = await svgToLogoPng();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const now = new Date().toLocaleString('es-AR');
    const margin = 10;

    type RGB = [number, number, number];

    const statusDotColor: Record<string, RGB> = {
      [BedStatus.AVAILABLE]: [16, 185, 129], [BedStatus.OCCUPIED]: [220, 38, 38],
      [BedStatus.PREPARATION]: [245, 158, 11], [BedStatus.ASSIGNED]: [99, 102, 241],
      [BedStatus.DISABLED]: [148, 163, 184],
    };
    const statusTextColor: Record<string, RGB> = {
      [BedStatus.AVAILABLE]: [4, 120, 87], [BedStatus.OCCUPIED]: [153, 27, 27],
      [BedStatus.PREPARATION]: [146, 64, 14], [BedStatus.ASSIGNED]: [55, 48, 163],
      [BedStatus.DISABLED]: [100, 116, 139],
    };

    const drawHeader = (logo: string | null) => {
      const logoSize = 12;
      const textX = logo ? margin + logoSize + 4 : margin;
      if (logo) { try { doc.addImage(logo, 'PNG', margin, 4, logoSize, logoSize); } catch { /* skip */ } }
      doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(2, 44, 34);
      doc.text('Grupo Gamma — Listado por Paciente', textX, 10);
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139);
      doc.text('MediFlow', textX, 15);
      doc.setFontSize(7); doc.setTextColor(148, 163, 184);
      doc.text(`Sede ${currentUser?.sede || 'HPR'}  ·  ${now}`, pageW - margin, 10, { align: 'right' });
      doc.setDrawColor(7, 146, 113); doc.setLineWidth(0.5);
      doc.line(margin, 19, pageW - margin, 19);
    };

    // Total = 274mm; A4 landscape with 10mm margins leaves 277mm useful → cabe con margen.
    // Paciente(32) | Hab.(12) | Cama(9) | Sector(17) | Estado(18) | DNI(17) | Edad(9) | Sexo(8) | Tipo(10) | Ingreso(20) | Días(9) | Cirugía(15) | Evento(15) | Profesional(26) | Financiador(22) | Diagnóstico(35)
    const colWidths  = [32, 12, 9, 17, 18, 17, 9, 8, 10, 20, 9, 15, 15, 26, 22, 35];
    const colHeaders = ['Paciente', 'Hab.', 'Cama', 'Sector', 'Estado', 'DNI', 'Edad', 'Sexo', 'Tipo', 'Ingreso', 'Días', 'Cirugía', 'Evento', 'Profesional', 'Financiador', 'Diagnóstico'];
    const rowH = 6;
    const tableWidth = colWidths.reduce((s, w) => s + w, 0);
    // Orden VISUAL: "Evento" (índice lógico 12) se dibuja justo DESPUÉS de "Cama" (índice 2), sin
    // renumerar el código de dibujo — colX[i] queda en la posición visual de la columna i.
    const visualOrder = [0, 1, 2, 12, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15];
    const colX: number[] = new Array(colWidths.length);
    let cx = margin;
    for (const li of visualOrder) { colX[li] = cx; cx += colWidths[li]; }

    let curY = 26;

    const ensurePage = (needed: number) => {
      if (curY + needed > pageH - margin) { doc.addPage(); drawHeader(logoPng); curY = 26; }
    };

    const drawTableHeader = () => {
      ensurePage(rowH + 2);
      doc.setFillColor(226, 232, 240);
      doc.rect(margin, curY, tableWidth, rowH, 'F');
      doc.setFontSize(6); doc.setFont('helvetica', 'bold'); doc.setTextColor(71, 85, 105);
      colHeaders.forEach((h, i) => { doc.text(h, colX[i] + 1.5, curY + rowH - 1.8); });
      curY += rowH;
    };

    drawHeader(logoPng);
    drawTableHeader();

    // Build flat list of beds with patient data, sorted alphabetically
    const patientBeds = enrichedBeds
      .map(bed => {
        const ticket = bedTicketMap.get(bed.label);
        const isOccupied = bed.status === BedStatus.OCCUPIED;
        const isAssigned = bed.status === BedStatus.ASSIGNED && !!ticket;
        if (!isOccupied && !isAssigned) return null;
        const patientName = isOccupied ? (bed.patientName ?? '') : (ticket?.patientName ?? '');
        if (!patientName) return null;
        // Tipo (single-letter/2-letter code), admission date DD/MM/YY HH:MM, stay in days
        const admissionCode = isOccupied ? (bed.admissionTypeCode ?? '') : '';
        const admissionDateShort = (() => {
          if (!isOccupied || !bed.admissionDate) return '';
          const d = new Date(bed.admissionDate);
          if (isNaN(d.getTime())) return '';
          const dd = String(d.getDate()).padStart(2, '0');
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const yy = String(d.getFullYear()).slice(-2);
          const hh = String(d.getHours()).padStart(2, '0');
          const mi = String(d.getMinutes()).padStart(2, '0');
          return `${dd}/${mm}/${yy} ${hh}:${mi}`;
        })();
        const stayDays = (() => {
          if (!isOccupied || !bed.admissionDate) return '';
          const d = new Date(bed.admissionDate);
          if (isNaN(d.getTime())) return '';
          const diff = Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)));
          return String(diff);
        })();
        // Fecha probable de cirugía corta (DD/MM/YY) — solo si vino del enrich
        const cirugiaShort = (() => {
          if (!isOccupied || !bed.expectedSurgeryDate) return '';
          const d = new Date(bed.expectedSurgeryDate);
          if (isNaN(d.getTime())) return '';
          const dd = String(d.getDate()).padStart(2, '0');
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const yy = String(d.getFullYear()).slice(-2);
          return `${dd}/${mm}/${yy}`;
        })();
        // Número de evento de internación (HIN-58213)
        const eventoStr = isOccupied && bed.eventOrigin && bed.eventNumber
          ? `${bed.eventOrigin}-${bed.eventNumber}`
          : '';
        return {
          patientName,
          roomCode: bed.roomCode ?? '',
          bedCode: bed.bedCode ?? '',
          area: AREA_LABELS[bed.area] ?? bed.area,
          status: bed.status,
          dni: isOccupied ? (bed.dni ?? '') : '',
          age: isOccupied ? (bed.age != null ? String(bed.age) : '') : '',
          sex: isOccupied ? (bed.sex === 'M' ? 'M' : bed.sex === 'F' ? 'F' : '') : '',
          admissionCode,
          admissionDateShort,
          stayDays,
          cirugiaShort,
          eventoStr,
          physician: isOccupied ? (bed.attendingPhysician ?? '') : '',
          prescriptor: isOccupied ? (bed.prescribingPhysician ?? '') : '',
          financier: isOccupied ? (bed.institution ?? '') : (ticket?.financier ?? ''),
          diagnosis: isOccupied ? (bed.diagnosis ?? '—') : '',
        };
      })
      .filter(Boolean)
      .sort((a, b) => a!.patientName.localeCompare(b!.patientName, 'es'));

    patientBeds.forEach((row, i) => {
      if (!row) return;
      ensurePage(rowH);

      const even = i % 2 === 0;
      const rowBg: RGB = even ? [255, 255, 255] : [248, 248, 248];
      doc.setFillColor(...rowBg);
      doc.rect(margin, curY, tableWidth, rowH, 'F');
      doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.1);
      doc.line(margin, curY + rowH, margin + tableWidth, curY + rowH);

      const textY = curY + rowH - 1.8;
      doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 41, 59);

      // Paciente
      doc.text(row.patientName.substring(0, Math.floor(colWidths[0] / 1.6)), colX[0] + 1.5, textY);
      // Hab.
      doc.text(row.roomCode, colX[1] + 1.5, textY);
      // Cama
      doc.text(row.bedCode, colX[2] + 1.5, textY);
      // Sector
      doc.text(row.area, colX[3] + 1.5, textY);
      // Estado
      const dotColor: RGB = statusDotColor[row.status] ?? [148, 163, 184];
      const txtColor: RGB = statusTextColor[row.status] ?? [100, 116, 139];
      doc.setFillColor(...dotColor);
      doc.circle(colX[4] + 2.2, curY + rowH / 2, 1.2, 'F');
      doc.setFontSize(6); doc.setFont('helvetica', 'bold'); doc.setTextColor(...txtColor);
      doc.text(row.status, colX[4] + 5, textY);
      // Reset
      doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 41, 59);
      // DNI
      doc.text(row.dni.substring(0, 12), colX[5] + 1.5, textY);
      // Edad
      doc.text(row.age, colX[6] + 1.5, textY);
      // Sexo
      doc.text(row.sex, colX[7] + 1.5, textY);
      // Tipo (código corto)
      doc.text(row.admissionCode, colX[8] + 1.5, textY);
      // Ingreso (DD/MM/YY)
      doc.text(row.admissionDateShort, colX[9] + 1.5, textY);
      // Días de estadía
      doc.text(row.stayDays, colX[10] + 1.5, textY);
      // Cirugía (DD/MM/YY)
      doc.text(row.cirugiaShort, colX[11] + 1.5, textY);
      // Evento (HIN-58213)
      doc.text(row.eventoStr, colX[12] + 1.5, textY);
      // Profesional (prescriptor from event, fallback to attending)
      const prof = row.prescriptor || row.physician;
      doc.text(prof.substring(0, Math.floor(colWidths[13] / 1.6)), colX[13] + 1.5, textY);
      // Financiador
      doc.text(row.financier.substring(0, Math.floor(colWidths[14] / 1.6)), colX[14] + 1.5, textY);
      // Diagnóstico (del enrich; puede ser largo → truncado al ancho de columna)
      doc.text(row.diagnosis.substring(0, Math.floor(colWidths[15] / 1.6)), colX[15] + 1.5, textY);

      curY += rowH;
    });

    drawBedTotalsFooter(doc, enrichedBeds, { pageW, pageH, margin, curY, now });
    doc.save(`pacientes-alfa-${new Date().toISOString().slice(0, 10)}.pdf`);
  }, [filteredBeds, bedTicketMap, currentUser, enrichBedsForPdf]);

  // ── PDF Export (dietas / ayunos / observaciones) ──────────────────────────
  // Planilla para Catering: TODAS las camas del Mapa de Camas (respeta filtros y orden).
  // Columnas: Habitación · Cama · Sector · Estado · Paciente · Dieta · Ayuno · Observaciones.
  // Observaciones admite varias líneas; el alto de fila se ajusta dinámicamente.
  const exportPDFDietas = useCallback(async () => {
    const enrichedBeds = await enrichBedsForPdf(filteredBeds, 'dietas');

    const svgToLogoPng = (): Promise<string | null> => {
      return new Promise((resolve) => {
        try {
          const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 299 300" fill="none">
            <path d="M177.763 209.923C175.477 205.948 171.246 203.498 166.673 203.498H132.327C127.75 203.498 123.523 205.948 121.236 209.923L104.063 239.768C101.776 243.743 101.776 248.643 104.063 252.618L121.236 282.462C123.523 286.437 127.753 288.887 132.327 288.887H166.676C171.252 288.887 175.479 286.437 177.766 282.462L194.939 252.618C197.226 248.643 197.226 243.743 194.939 239.768L177.763 209.923Z" fill="#022C22"/>
            <path d="M121.236 90.078C123.523 94.053 127.753 96.503 132.327 96.503H166.676C171.252 96.503 175.479 94.053 177.766 90.078L194.939 60.2336C197.226 56.2586 197.226 51.3586 194.939 47.3836L177.763 17.5363C175.477 13.5613 171.249 11.1113 166.673 11.1113H132.327C127.75 11.1113 123.523 13.5613 121.236 17.5363L104.063 47.3808C101.776 51.3558 101.776 56.2558 104.063 60.2308L121.236 90.078Z" fill="#022C22"/>
            <path d="M277.967 191.673L260.794 161.825C258.507 157.85 254.276 155.4 249.703 155.4H215.354C210.778 155.4 206.55 157.85 204.263 161.825L187.09 191.67C184.803 195.645 184.803 200.545 187.09 204.52L204.263 234.364C206.55 238.339 210.78 240.789 215.354 240.789H249.703C254.279 240.789 258.507 238.339 260.794 234.364L277.967 204.52C280.254 200.548 280.254 195.648 277.967 191.673Z" fill="#022C22"/>
            <path d="M38.2046 138.175C40.4914 142.15 44.7217 144.6 49.2953 144.6H83.6443C88.2207 144.6 92.4482 142.15 94.735 138.175L111.908 108.33C114.195 104.355 114.195 99.4554 111.908 95.4804L94.735 65.6359C92.4482 61.6609 88.2179 59.2109 83.6443 59.2109H49.2981C44.7217 59.2109 40.4942 61.6609 38.2074 65.6359L21.0315 95.4776C18.7447 99.4526 18.7447 104.353 21.0315 108.328L38.2046 138.175Z" fill="#022C22"/>
            <path d="M111.911 191.672L94.7378 161.827C92.451 157.852 88.2207 155.402 83.6471 155.402H49.2981C44.7217 155.402 40.4942 157.852 38.2074 161.827L21.0315 191.672C18.7447 195.647 18.7447 200.547 21.0315 204.522L38.2046 234.366C40.4914 238.341 44.7217 240.791 49.2953 240.791H83.6443C88.2207 240.791 92.4482 238.341 94.735 234.366L111.908 204.522C114.198 200.547 114.198 195.647 111.911 191.672Z" fill="#022C22"/>
            <path d="M187.087 108.328L202.187 134.567H183.43C179.142 127.098 173.821 117.831 173.821 117.831C171.863 114.428 168.242 112.331 164.327 112.331H134.926C131.008 112.331 127.39 114.428 125.433 117.831L110.732 143.379C108.774 146.781 108.774 150.976 110.732 154.379L125.433 179.926C127.39 183.329 131.008 185.426 134.926 185.426H164.327C168.245 185.426 171.863 183.329 173.821 179.926L184.305 161.704H148.89V143.829H177.536H188.737H211.054C212.417 144.317 213.859 144.601 215.348 144.601H249.697C254.274 144.601 258.501 142.151 260.788 138.176L277.961 108.331C280.248 104.356 280.248 99.4563 277.961 95.4813L260.794 65.634C258.507 61.659 254.277 59.209 249.703 59.209H215.354C210.778 59.209 206.55 61.659 204.263 65.634L187.09 95.4785C184.801 99.4535 184.801 104.353 187.087 108.328Z" fill="#022C22"/>
          </svg>`;
          const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 200; canvas.height = 200;
            const ctx = canvas.getContext('2d');
            if (ctx) { ctx.drawImage(img, 0, 0, 200, 200); resolve(canvas.toDataURL('image/png')); }
            else { resolve(null); }
            URL.revokeObjectURL(url);
          };
          img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
          img.src = url;
        } catch { resolve(null); }
      });
    };

    const logoPng = await svgToLogoPng();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const now = new Date().toLocaleString('es-AR');
    const margin = 10;

    const drawHeader = (logo: string | null) => {
      const logoSize = 12;
      const textX = logo ? margin + logoSize + 4 : margin;
      if (logo) { try { doc.addImage(logo, 'PNG', margin, 4, logoSize, logoSize); } catch { /* skip */ } }
      doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(2, 44, 34);
      doc.text('Grupo Gamma — Dietas y Ayunos', textX, 10);
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139);
      doc.text('MediFlow · Catering', textX, 15);
      doc.setFontSize(7); doc.setTextColor(148, 163, 184);
      doc.text(`Sede ${currentUser?.sede || 'HPR'}  ·  ${now}`, pageW - margin, 10, { align: 'right' });
      doc.setDrawColor(7, 146, 113); doc.setLineWidth(0.5);
      doc.line(margin, 19, pageW - margin, 19);
    };

    // Total = 268mm; A4 landscape 277mm útil → cabe.
    // Hab(12) | Cama(10) | Sector(20) | Estado(26) | Paciente(40) | Dieta(122) | Ayuno(38)
    // La columna Dieta es UNIFICADA: dieta base + requisitos + detalles (consistencias, notas)
    // en un solo bloque ordenado (ya no hay columna Observaciones separada). Es ancha y con
    // fuente más grande (BODY_FONT) para que el texto se lea, admitiendo varias líneas.
    const colWidths  = [12, 10, 20, 26, 40, 122, 38];
    const colHeaders = ['Hab.', 'Cama', 'Sector', 'Estado', 'Paciente', 'Dieta', 'Ayuno'];
    const rowHBase = 6.5;
    // Tamaño de fuente del cuerpo (antes 6.5pt, recortaba la dieta). Multi-línea en Dieta/Ayuno.
    const BODY_FONT = 7.5;
    const LINE_STEP = 3.4; // mm entre líneas wrapeadas a BODY_FONT
    const tableWidth = colWidths.reduce((s, w) => s + w, 0);
    const colX: number[] = [];
    { let cx = margin; for (const w of colWidths) { colX.push(cx); cx += w; } }

    let curY = 26;
    const ensurePage = (needed: number) => {
      if (curY + needed > pageH - margin) { doc.addPage(); drawHeader(logoPng); curY = 26; drawTableHeader(); }
    };
    const drawTableHeader = () => {
      doc.setFillColor(226, 232, 240);
      doc.rect(margin, curY, tableWidth, rowHBase, 'F');
      doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(71, 85, 105);
      colHeaders.forEach((h, i) => { doc.text(h, colX[i] + 1.5, curY + rowHBase - 1.8); });
      curY += rowHBase;
    };

    drawHeader(logoPng);
    drawTableHeader();

    // Resumen legible de ayuno DEL DÍA DE HOY (en ART): "15:00, 16:00, 17:00".
    // Filtra ocurrencias por jornada [00:00, 24:00) ART — la API puede devolver ayunos
    // de varios días, y el PDF es del día actual.
    const fastingSummary = (bed: Bed): string => fastingTimesForToday(bed.fasting).join(', ');

    // Texto UNIFICADO y ordenado de la dieta para el PDF (pedido del cliente: primero la
    // dieta, luego los requisitos). Reúne en un solo bloque lo que antes estaba partido
    // entre la columna Dieta (chips) y Observaciones:
    //   1) Dieta base (entrada "Tipo", ej. "General" / "Liviana con pollo").
    //   2) Requisitos / condiciones (respuesta "Sí", ej. "Hipertenso", "Renal").
    //   3) Detalles de texto libre (ej. "Consistencia: Blanda", notas).
    // Las respuestas "No"/vacías no aportan y se omiten. La "post-procedimiento" se excluye
    // SOLO de este PDF (pedido del cliente); en la tarjeta y las notificaciones se mantiene.
    const isPostProc = (desc: string): boolean => {
      const f = desc.normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      return f === 'post procedimiento' || f === 'progresion post procedimiento';
    };
    const formatDietForPDF = (bed: Bed): string => {
      const ds = bed.diets;
      if (!ds || ds.length === 0) return '';
      let base = '';
      const requisitos: string[] = [];
      const detalles: string[] = [];
      for (const d of ds) {
        const desc = (d.descripcion ?? '').trim();
        const resp = (d.respuesta ?? '').trim();
        if (!desc || isPostProc(desc)) continue;
        const dl = desc.toLowerCase();
        const rl = resp.toLowerCase();
        if (dl === 'tipo') {
          if (resp && rl !== 'no') base = resp;
        } else if (rl === 'sí' || rl === 'si') {
          requisitos.push(desc);
        } else if (rl === 'no' || !resp) {
          /* respuesta negativa o vacía: no se muestra */
        } else {
          detalles.push(`${desc}: ${resp}`);
        }
      }
      const head = [base, ...requisitos].filter(Boolean).join(', ');
      const tail = detalles.join(' · ');
      return [head, tail].filter(Boolean).join('  ·  ');
    };

    // Planilla de catering: incluimos TODAS las camas del mapa (las mismas que se ven en
    // pantalla, respetando los filtros activos) y en el mismo orden (sector según AREA_ORDER,
    // luego cama). Las ocupadas y las "en traslado" traen dieta/ayuno; el resto va en blanco.
    interface DietaRow {
      status: BedStatus; estado: string;
      roomCode: string; bedCode: string; area: string; patientName: string;
      dieta: string; ayuno: string;
    }
    const estadoLabel: Record<string, string> = {
      [BedStatus.AVAILABLE]:   'Disponible',
      [BedStatus.OCCUPIED]:    'Ocupada',
      [BedStatus.PREPARATION]: 'En prep.',
      [BedStatus.ASSIGNED]:    'Asignada',
      [BedStatus.DISABLED]:    'Inhabilit.',
    };
    const orderedBeds = [...enrichedBeds].sort((a, b) => {
      const ia = AREA_ORDER.indexOf(a.area); const ib = AREA_ORDER.indexOf(b.area);
      const oa = ia === -1 ? 999 : ia;       const ob = ib === -1 ? 999 : ib;
      if (oa !== ob) return oa - ob;
      return a.label.localeCompare(b.label, 'es', { numeric: true });
    });
    const rows: DietaRow[] = orderedBeds.map((bed: Bed): DietaRow => {
      const ticket = bedTicketMap.get(bed.label);
      const isOccupied = bed.status === BedStatus.OCCUPIED;
      // "En traslado": destino de un traslado en curso (IN_TRANSPORT) — mergeBeds copió la
      // ficha del paciente al destino, detectable por tener patientCode aún sin estar ocupada.
      const inTransit = bed.status === BedStatus.ASSIGNED && !!bed.patientCode;
      const hasPatientData = isOccupied || inTransit;
      // Nombre: ocupada → de la cama; asignada/en prep. (destino de traslado) → del ticket.
      const patientName = isOccupied ? (bed.patientName ?? '') : (ticket?.patientName ?? '');
      const ayuno = hasPatientData ? fastingSummary(bed) : '';
      return {
        status:      bed.status,
        estado:      inTransit ? 'En traslado' : (estadoLabel[bed.status] ?? bed.status),
        roomCode:    bed.roomCode ?? '',
        bedCode:     bed.bedCode ?? '',
        area:        AREA_LABELS[bed.area] ?? bed.area,
        patientName,
        dieta:       hasPatientData ? (formatDietForPDF(bed) || '—') : '',
        ayuno:       hasPatientData ? (ayuno || '—') : '',
      };
    });

    if (rows.length === 0) {
      doc.setFontSize(9); doc.setFont('helvetica', 'italic'); doc.setTextColor(100, 116, 139);
      doc.text('No hay camas para exportar con los filtros actuales.', margin, curY + 6);
      doc.save(`dietas-${new Date().toISOString().slice(0, 10)}.pdf`);
      return;
    }

    // Helper: trunca un texto al ancho de columna (chars aprox a BODY_FONT=7.5pt).
    const truncate = (text: string, colWidth: number): string => {
      const maxChars = Math.floor(colWidth / 1.7);
      return text.length > maxChars ? text.substring(0, maxChars - 1) + '…' : text;
    };

    // Colores de estado (mismo criterio que el Mapa de Camas) para el punto de la col. Estado.
    const statusDot: Record<string, [number, number, number]> = {
      [BedStatus.AVAILABLE]:   [16, 185, 129],
      [BedStatus.OCCUPIED]:    [220, 38, 38],
      [BedStatus.PREPARATION]: [245, 158, 11],
      [BedStatus.ASSIGNED]:    [99, 102, 241],
      [BedStatus.DISABLED]:    [148, 163, 184],
    };

    rows.forEach((row, i) => {
      // Wrap multi-línea para Dieta y Ayuno (las columnas que pueden exceder el ancho). El
      // resto queda en una sola línea. La altura de la fila se calcula como el máximo entre
      // las columnas wrapeadas. La Dieta usa BODY_FONT (más grande) y una columna ancha.
      doc.setFontSize(BODY_FONT);
      const dietaLines: string[] = row.dieta ? doc.splitTextToSize(row.dieta, colWidths[5] - 3) : [''];
      const ayunoLines: string[] = row.ayuno ? doc.splitTextToSize(row.ayuno, colWidths[6] - 3) : [''];
      const maxLines = Math.max(dietaLines.length, ayunoLines.length);
      const rowH = Math.max(rowHBase, maxLines * LINE_STEP + 3);

      ensurePage(rowH);

      const even = i % 2 === 0;
      doc.setFillColor(even ? 255 : 248, even ? 255 : 248, even ? 255 : 248);
      doc.rect(margin, curY, tableWidth, rowH, 'F');
      doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.1);
      doc.line(margin, curY + rowH, margin + tableWidth, curY + rowH);

      doc.setFontSize(BODY_FONT); doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 41, 59);
      const textY = curY + rowHBase - 1.9;
      // Inicio vertical de las celdas multi-línea (Dieta/Ayuno).
      const lineY0 = curY + 3.2;

      doc.text(row.roomCode,                     colX[0] + 1.5, textY);
      doc.text(row.bedCode,                      colX[1] + 1.5, textY);
      doc.text(truncate(row.area, colWidths[2]), colX[2] + 1.5, textY);

      // Estado — punto de color (como el Mapa de Camas) + texto
      const dot = statusDot[row.status] ?? [148, 163, 184];
      doc.setFillColor(dot[0], dot[1], dot[2]);
      doc.circle(colX[3] + 2, curY + rowHBase / 2, 1, 'F');
      doc.setTextColor(71, 85, 105);
      doc.text(truncate(row.estado, colWidths[3] - 4), colX[3] + 4.5, textY);

      // Paciente
      doc.setTextColor(30, 41, 59);
      doc.text(truncate(row.patientName, colWidths[4]), colX[4] + 1.5, textY);

      // Dieta — verde, unificada y multi-línea
      doc.setTextColor(4, 120, 87);
      dietaLines.forEach((line, li) => {
        doc.text(line, colX[5] + 1.5, lineY0 + li * LINE_STEP);
      });

      // Ayuno — ámbar si hay horas, gris si "—" o vacío, multi-línea
      if (row.ayuno && row.ayuno !== '—') doc.setTextColor(146, 64, 14);
      else                                 doc.setTextColor(148, 163, 184);
      ayunoLines.forEach((line, li) => {
        doc.text(line, colX[6] + 1.5, lineY0 + li * LINE_STEP);
      });

      curY += rowH;
    });

    drawBedTotalsFooter(doc, enrichedBeds, { pageW, pageH, margin, curY, now });
    doc.save(`dietas-${new Date().toISOString().slice(0, 10)}.pdf`);
  }, [filteredBeds, currentUser, enrichBedsForPdf, bedTicketMap]);

  // ── Render ────────────────────────────────────────────────────────────────
  const buscando = !!searchFilter.trim();
  const disponibles = conteoPorEstado.get(BedStatus.AVAILABLE) ?? 0;
  const sinDatos = beds.length === 0;
  // Botón de PDF de la toolbar (§5.2): outline h-9, label oculto en mobile; mientras genera muestra el
  // avance "n/total" también en mobile (es la única señal de que está trabajando).
  const botonPdf = (tipo: 'normal' | 'alpha' | 'dietas', Icono: React.ElementType, label: string, ayuda: string, onClick: () => void) => (
    <Button variant="outline" onClick={onClick} disabled={!!pdfExporting} title={ayuda} aria-label={ayuda} className="h-9 shrink-0 gap-1.5 px-3">
      {pdfExporting === tipo ? <Loader2 className="size-3.5 animate-spin" /> : <Icono className="size-3.5" />}
      <span className={cn(pdfExporting === tipo ? 'inline tabular-nums' : 'hidden sm:inline')}>
        {pdfExporting === tipo ? `${pdfProgress.done}/${pdfProgress.total}` : label}
      </span>
    </Button>
  );

  return (
    <div className="flex w-full flex-col gap-4 p-3 md:p-8">
      {/* HEADER + TOOLBAR (DESIGN §4.4 y §5.2) */}
      <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="hidden shrink-0 md:block">
          <h2 className="text-2xl font-bold tracking-tight">Mapa de Camas</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {/* El conteo deja afuera la Sala de Espera (HRA): son sillones de pre-internación, no camas. */}
            <span className="font-medium text-foreground tabular-nums">{bedCount}</span> {bedCount === 1 ? 'cama' : 'camas'} ·{' '}
            <span className="font-medium text-foreground tabular-nums">{disponibles}</span> {disponibles === 1 ? 'disponible' : 'disponibles'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {/* Buscador: en mobile ocupa la fila entera (los botones van debajo, solo ícono). */}
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder="Paciente, evento, financiador, médico, hab…"
              aria-label="Buscar por paciente, evento, financiador, médico o habitación"
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
          <BotonFiltros abierto={verFiltros} activos={activeFilterCount} onClick={() => setVerFiltros(v => !v)} />
          {onRefresh && (
            <Button variant="outline" onClick={() => onRefresh()} disabled={bedsLoading} title="Forzar actualización del mapa de camas" aria-label="Actualizar" className="h-9 shrink-0 gap-1.5 px-3">
              <RefreshCw className={cn('size-3.5', bedsLoading && 'animate-spin')} /><span className="hidden sm:inline">Actualizar</span>
            </Button>
          )}
          {botonPdf('normal', FileText, 'PDF', 'Exportar PDF por sector', exportPDF)}
          {botonPdf('alpha', ArrowDownAZ, 'PDF A-Z', 'Exportar PDF alfabético por paciente', exportPDFAlpha)}
          {botonPdf('dietas', UtensilsCrossed, 'Dietas', 'Exportar PDF de dietas y ayunos', exportPDFDietas)}
        </div>
      </div>

      {/* FILTROS (DESIGN §4.7): barra inline, no un modal. Antes eran chips sueltos + popovers propios. */}
      {verFiltros && (
        <BarraFiltros activos={activeFilterCount} onLimpiar={limpiarFiltros}>
          <CampoFiltro icono={LayoutGrid} label="Sector">
            <MultiCombobox opciones={opcionesSector} value={valorSectores} onChange={elegirSectores}
              placeholder="Todos los sectores" buscar="Buscar sector…" aria-label="Sector" maxChips={1} />
          </CampoFiltro>
          <CampoFiltro icono={CircleDot} label="Estado">
            <MultiCombobox opciones={opcionesEstado} value={[...statusFilters]} onChange={(v) => setStatusFilters(new Set(v))}
              placeholder={`Todos (${bedsSinEstado.length})`} buscar="Buscar estado…" aria-label="Estado" />
          </CampoFiltro>
          {opcionesIndicador.length > 0 && (
            <CampoFiltro icono={Filter} label="Solo camas con">
              <MultiCombobox opciones={opcionesIndicador} value={valorIndicador} onChange={elegirIndicador}
                placeholder="Cualquiera" aria-label="Solo camas con" />
            </CampoFiltro>
          )}
          {uniqueAdmissionTypes.length > 0 && (
            <CampoFiltro icono={Activity} label="Tipo de internación">
              <MultiCombobox opciones={aOpciones(uniqueAdmissionTypes)} value={[...admissionTypeFilters]} onChange={(v) => setAdmissionTypeFilters(new Set(v))}
                placeholder="Todos" aria-label="Tipo de internación" />
            </CampoFiltro>
          )}
          <CampoFiltro icono={CalendarDays} label="Fecha de internación" className="sm:w-56">
            <DateRangePicker value={rangoInternacion} onChange={elegirRangoInternacion} placeholder="Cualquier fecha" />
          </CampoFiltro>
          {uniqueFinanciers.length > 0 && (
            <CampoFiltro icono={Building2} label="Financiador">
              <MultiCombobox opciones={aOpciones(uniqueFinanciers)} value={[...financierFilters]} onChange={(v) => setFinancierFilters(new Set(v))}
                placeholder="Todos" buscar="Buscar financiador…" aria-label="Financiador" />
            </CampoFiltro>
          )}
          {uniquePhysicians.length > 0 && (
            <CampoFiltro icono={Stethoscope} label="Profesional">
              <MultiCombobox opciones={aOpciones(uniquePhysicians)} value={[...physicianFilters]} onChange={(v) => setPhysicianFilters(new Set(v))}
                placeholder="Todos" buscar="Buscar profesional…" aria-label="Profesional" />
            </CampoFiltro>
          )}
          {uniqueDietTypes.length > 0 && (
            <CampoFiltro icono={Utensils} label="Tipo de dieta">
              <MultiCombobox opciones={aOpciones(uniqueDietTypes)} value={[...dietTypeFilters]} onChange={(v) => setDietTypeFilters(new Set(v))}
                placeholder="Todos" buscar="Buscar tipo…" aria-label="Tipo de dieta" />
            </CampoFiltro>
          )}
        </BarraFiltros>
      )}

      {/* Resumen por estado, siempre visible (hace de leyenda): punto + estado + cuántas. */}
      {!sinDatos && (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="Camas por estado">
          {ORDEN_ESTADOS_CAMA.map(st => (
            <li key={st} className="flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', puntoEstadoCama(st))} aria-hidden="true" />
              {ESTADOS_CAMA[st].label}
              <span className="font-medium text-foreground tabular-nums">{conteoPorEstado.get(st) ?? 0}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Error con datos previos: aviso suave (§9.4) sin tapar el mapa (sigue mostrando lo último). */}
      {bedsError && !sinDatos && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          <span className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              <span className="font-semibold">No se pudo actualizar el mapa.</span> Mostrando los últimos datos.{' '}
              <span className="font-mono text-xs opacity-80">debug: {bedsError}</span>
            </span>
          </span>
          {onRefresh && (
            <Button variant="outline" size="sm" onClick={() => onRefresh()} disabled={bedsLoading} className="h-8 shrink-0 gap-1.5 px-3 text-xs">
              <RefreshCw className={cn('size-3.5', bedsLoading && 'animate-spin')} /> Reintentar
            </Button>
          )}
        </div>
      )}

      {/* TRES ESTADOS (§9.1, §9.3, regla 22): cargando · error sin datos · vacío. */}
      {sinDatos && bedsLoading ? (
        <Cargando texto="Cargando camas…" />
      ) : sinDatos && bedsError ? (
        onRefresh ? (
          <ErrorEstado
            titulo="No se pudo cargar el mapa de camas"
            descripcion={<>
              Hubo un problema al consultar la información a PROGAL. Reintentá; si el error persiste, pasá este código a soporte:
              <code className="mt-2 block font-mono text-xs">debug: {bedsError}</code>
            </>}
            onReintentar={() => onRefresh()}
          />
        ) : (
          <Vacio icono={AlertTriangle} titulo="No se pudo cargar el mapa de camas" descripcion={<code className="font-mono text-xs">debug: {bedsError}</code>} />
        )
      ) : sinDatos ? (
        <Vacio icono={BedDouble} titulo="No hay camas para mostrar" descripcion="PROGAL no devolvió camas para tus sectores." />
      ) : filteredBeds.length === 0 ? (
        <Vacio
          icono={Search}
          titulo="Ninguna cama coincide"
          descripcion={buscando ? 'Probá con otro texto o limpiá el buscador.' : 'Ajustá o limpiá los filtros para ver más camas.'}
          accion={(buscando || activeFilterCount > 0) && (
            <Button variant="outline" onClick={() => { setSearchFilter(''); limpiarFiltros(); }}>Limpiar búsqueda y filtros</Button>
          )}
        />
      ) : (
        // GRILLA por sector (§7.9). Refresco silencioso (§9.1): se atenúa sin desmontar.
        <div className={cn('flex flex-col gap-6 transition-opacity duration-300', bedsLoading && 'opacity-60')}>
          {sortedAreaEntries.map(([areaName, areaBeds]) => {
            const libres = areaBeds.filter(b => b.status === BedStatus.AVAILABLE).length;
            return (
              <section key={areaName} aria-labelledby={`sector-${areaName}`} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <h3 id={`sector-${areaName}`} className={MICRO}>{AREA_LABELS[areaName] ?? areaName}</h3>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {areaBeds.length} · {libres} {libres === 1 ? 'disponible' : 'disponibles'}
                  </span>
                  <div className="h-px flex-1 bg-border" aria-hidden="true" />
                </div>
                {/* Columnas automáticas: entran tantas celdas como permita el ancho (~20 en un monitor grande,
                    4 en un celular). */}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1.5">
                  {areaBeds.map(bed => {
                    const shortCode = `${bed.roomCode}-${bed.bedCode}`;
                    const info = estadoCama(bed.status);
                    const isIsolated = isolatedBeds.has(bed.label);
                    const isBlocked = blockedByIsolation.has(bed.label);
                    const isPreventiveAdj = preventiveContactAdjacent.has(bed.label);
                    const isoTipos = isIsolated ? getIsolationTypes(bed) : [];
                    const suggestedSex = suggestedSexFor(bed);
                    const ticketAsignado = bed.status !== BedStatus.OCCUPIED ? bedTicketMap.get(bed.label) : undefined;
                    const llegaDeCx = bed.status !== BedStatus.OCCUPIED && !ticketAsignado && bed.cirugia?.role === 'destino' && bed.cirugia.pacienteNombre;
                    const esQ = (bed.admissionTypeCode ?? '').toUpperCase() === 'Q';
                    const comandaVisible = canViewComanda && hasAnyMealLoad(bed.meals);
                    const comanda = comandaVisible && hasPendingMealLoad(bed.meals) ? MARCAS_CAMA.comandaPendiente : MARCAS_CAMA.comandaEntregada;
                    const ayuno = hasLiveFasting(bed.fasting);

                    // Tarjeta RESUMEN compacta (acordado antes del rediseño: que entren la mayor cantidad
                    // de camas por pantalla). Solo: número de cama + quién ocupa / llega + marcas con
                    // ícono. El estado es el COLOR de la tarjeta; el resto (financiador, nombres de
                    // aislamiento, etapa de la Cx, motivo de inhabilitación…) va en el tooltip y en el
                    // detalle (click).
                    let ocupante: string | undefined;
                    let llega = false;
                    let meta: string | undefined;
                    if (bed.status === BedStatus.OCCUPIED) {
                      ocupante = bed.patientName;
                      meta = bed.institution;
                    } else if (ticketAsignado) {
                      ocupante = ticketAsignado.patientName; llega = true;
                      meta = 'Traslado en curso';
                    } else if (llegaDeCx) {
                      ocupante = bed.cirugia!.pacienteNombre; llega = true;
                      meta = `Llega de cirugía · de ${formatBedName(bed.cirugia!.camaOrigen)}`;
                    } else if (bed.status === BedStatus.DISABLED) {
                      meta = bed.disabledReason || info.descripcion;
                    }

                    // Marcas: ícono (+ texto mínimo cuando el ícono solo no alcanza: "Cx", "Q", "C→Q").
                    // `txt` arma el tooltip y el nombre accesible de la tarjeta.
                    const CHIP = 'h-4 gap-0.5 px-1 py-0';
                    // Sigla / ícono DENTRO del círculo del color de la cartelería (dato del hospital, no un token).
                    // sumar-validar-ignorar: colores-crudos rótulo DENTRO del relleno de color de la cartelería de aislamiento (blanco sobre el color)
                    const SOBRE_CARTEL = 'text-white';
                    const marcas: { key: string; txt: string; nodo: React.ReactNode }[] = [];
                    isoTipos.forEach((iso, i) => {
                      const sigla = isolationSigla(iso.name);
                      marcas.push({
                        key: `iso-${i}`, txt: `Aislamiento: ${iso.name}${sigla ? ` (${sigla})` : ''}`,
                        nodo: sigla
                          ? <span className={cn('inline-flex h-4 items-center rounded-full px-1 text-[10px] leading-none font-bold', SOBRE_CARTEL, puntoAislamiento(iso.color))}>{sigla}</span>
                          : <span className={cn('inline-flex size-4 items-center justify-center rounded-full', SOBRE_CARTEL, puntoAislamiento(iso.color))}><ICONO_AISLAMIENTO className="size-2.5" /></span>,
                      });
                    });
                    if (isBlocked) marcas.push({ key: 'bloq', txt: MARCAS_CAMA.bloqueada.descripcion,
                      nodo: <StatusBadge tono={MARCAS_CAMA.bloqueada.tono} className={CHIP}><MARCAS_CAMA.bloqueada.icono className="size-3" /></StatusBadge> });
                    if (isPreventiveAdj) marcas.push({ key: 'prev', txt: MARCAS_CAMA.preventivo.descripcion,
                      nodo: <StatusBadge tono={MARCAS_CAMA.preventivo.tono} className={CHIP}><MARCAS_CAMA.preventivo.icono className="size-3" /></StatusBadge> });
                    // Cirugía viva: color por etapa (lib/estados-cirugia.ts). `role: 'destino'` = cama destino en limbo.
                    if (bed.cirugia) marcas.push({
                      key: 'cx', txt: `Cirugía: ${CIRUGIA_ESTADO_LABEL[bed.cirugia.estado]}${bed.cirugia.role === 'destino' ? ' (cama destino)' : ''}`,
                      nodo: <StatusBadge tono={estadoCirugia(bed.cirugia.estado).tono} className={CHIP}><Activity className="size-3" />Cx</StatusBadge>,
                    });
                    // "Va a cirugía" de Admisión sin operatoria viva: "C→Q" (clínico → quirúrgico) o "Re-Cx".
                    if (bed.goingToSurgery && !bed.cirugia) marcas.push({
                      key: 'vacx', txt: `${esQ ? 'Nueva cirugía autorizada' : 'De clínico a quirúrgico'} — marcado por Admisión${bed.goingToSurgeryBy ? ` · ${bed.goingToSurgeryBy}` : ''}`,
                      nodo: <StatusBadge tono={MARCAS_CAMA.vaCirugia.tono} className={cn(CHIP, 'border border-dashed border-violet-400')}>{esQ ? 'Re-Cx' : MARCAS_CAMA.vaCirugia.label}</StatusBadge>,
                    });
                    // "Q": quirúrgico (PROGAL) pendiente de su cirugía en esta internación (lib/cirugiaQ.ts).
                    if (bed.quirurgicoPendiente) marcas.push({
                      key: 'q', txt: `Paciente quirúrgico (PROGAL) — pendiente de su cirugía${bed.expectedSurgeryDate ? ` · probable: ${fechaSegura(bed.expectedSurgeryDate)}` : ''}`,
                      nodo: <StatusBadge tono={MARCAS_CAMA.quirurgico.tono} className={CHIP}>{MARCAS_CAMA.quirurgico.label}</StatusBadge>,
                    });
                    if (ayuno) marcas.push({ key: 'ayuno', txt: MARCAS_CAMA.ayuno.descripcion,
                      nodo: <StatusBadge tono={MARCAS_CAMA.ayuno.tono} className={CHIP}><MARCAS_CAMA.ayuno.icono className="size-3" /></StatusBadge> });
                    if (comandaVisible) marcas.push({ key: 'comanda', txt: comanda.descripcion,
                      nodo: <StatusBadge tono={comanda.tono} className={CHIP}><comanda.icono className="size-3" /></StatusBadge> });
                    if (bed.routineCleaningActive) marcas.push({ key: 'rutina', txt: `${MARCAS_CAMA.rutina.descripcion}${bed.routineCleaningBy ? ` · ${bed.routineCleaningBy}` : ''}`,
                      nodo: <StatusBadge tono={MARCAS_CAMA.rutina.tono} className={CHIP}><MARCAS_CAMA.rutina.icono className="size-3" /></StatusBadge> });
                    // Sexo SUGERIDO (sugerencia, no dato del paciente) → outline dashed; celeste = M, rosa = F.
                    if (suggestedSex) marcas.push({
                      key: 'sexo', txt: `Sugerido: ${suggestedSex === 'M' ? 'masculino' : 'femenino'} — la habitación ya aloja ${suggestedSex === 'M' ? 'pacientes masculinos' : 'pacientes femeninos'}`,
                      nodo: <span className={cn('inline-flex size-4 items-center justify-center rounded-full border border-dashed bg-background text-[10px] leading-none font-semibold',
                        suggestedSex === 'M' ? 'border-sky-400 text-sky-700' : 'border-pink-400 text-pink-700')}>{suggestedSex}</span>,
                    });

                    const tooltip = [
                      `${shortCode} · ${info.label}`,
                      ocupante && `${llega ? '→ ' : ''}${ocupante}`,
                      meta,
                      ...marcas.map(m => m.txt),
                    ].filter(Boolean).join('\n');

                    return (
                      <button
                        key={bed.id}
                        type="button"
                        onClick={() => setSelectedBed(bed)}
                        title={tooltip}
                        aria-label={tooltip.replace(/\n/g, '. ')}
                        className={cn(
                          'flex min-h-16 min-w-0 flex-col gap-0.5 rounded-md border p-1.5 text-left transition-all outline-hidden hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]',
                          // Color del estado (acordado: verde / rojo / ámbar / índigo / gris). Bloqueada
                          // (violeta) y contigua a preventivo (cian) pintan la celda con su marca, como antes.
                          cardEstadoCama(bed.status, isBlocked ? 'bloqueada' : isPreventiveAdj ? 'preventivo' : undefined),
                          // Aislada: anillo del color de la cartelería (se ve de lejos).
                          isoTipos.length > 0 && anilloAislamiento(isoTipos[0].color),
                        )}
                      >
                        <span className="text-xs font-semibold whitespace-nowrap tabular-nums">{shortCode}</span>
                        {ocupante && (
                          <span className={cn('line-clamp-2 text-[10px] leading-tight wrap-break-word', llega ? 'text-muted-foreground italic' : 'font-medium')}>
                            {llega && '→ '}{ocupante}
                          </span>
                        )}
                        {marcas.length > 0 && (
                          <span className="mt-auto flex flex-wrap items-center gap-0.5 pt-0.5" aria-hidden="true">
                            {marcas.map(m => <React.Fragment key={m.key}>{m.nodo}</React.Fragment>)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Bed Details Modal */}
      <Dialog open={!!selectedBed} onOpenChange={(open) => !open && setSelectedBed(null)}>
        {/* Modal canónico (DESIGN §4.1): el color del estado ya no pinta un header propio; vive en el
            tile del ícono y en el pill del estado, dentro del DialogHeader del kit. */}
        <DialogContent className="sm:max-w-lg">
          {selectedBed && (() => {
            const infoEstado = estadoCama(selectedBed.status);

            const isOccupied  = selectedBed.status === BedStatus.OCCUPIED;
            const isAssigned  = selectedBed.status === BedStatus.ASSIGNED;
            const isPrep      = selectedBed.status === BedStatus.PREPARATION;
            const isAvailable = selectedBed.status === BedStatus.AVAILABLE;
            const isDisabled  = selectedBed.status === BedStatus.DISABLED;

            return (
              <>
                {/* Header: tile neutro + título; el estado va en el StatusBadge, junto al sector. */}
                <DialogHeader>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <BedDouble className="size-5 text-muted-foreground" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <DialogTitle className="block truncate">Hab. {selectedBed.roomCode} — Cama {selectedBed.bedCode}</DialogTitle>
                      <DialogDescription className="mt-1 flex flex-wrap items-center gap-2">
                        <StatusBadge tono={infoEstado.tono}>{infoEstado.label}</StatusBadge>
                        {/* Etapa de la Cx a la vista de TODOS los roles: la celda del mapa solo dice "Cx"
                            (color) y el bloque de cirugía de abajo aparece solo con permisos cirugia_*. */}
                        {selectedBed.cirugia && (
                          <StatusBadge tono={estadoCirugia(selectedBed.cirugia.estado).tono}>
                            <Activity className="size-3" aria-hidden="true" />Cx · {estadoCirugia(selectedBed.cirugia.estado).label}
                          </StatusBadge>
                        )}
                        <span>{AREA_LABELS[selectedBed.area] ?? selectedBed.area}</span>
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>

                {/* Content */}
                <DialogBody className="space-y-3">

                  {/* Limpieza por azafata (Opción B): overlay sobre cama "En preparación".
                      Si ya está limpia → chip + Deshacer; si está en prep y la azafata tiene
                      el área → botón Marcar limpia. PROGAL es read-only: esto solo pisa la vista. */}
                  {(() => {
                    const areaOk = !currentUser?.filterByFloors
                      || !currentUser?.assignedAreas?.length
                      || currentUser.assignedAreas.includes(selectedBed.area);
                    const canClean = can(currentUser, 'confirmar_limpieza') && areaOk;
                    const canRevert = can(currentUser, 'limpieza_revertir') && areaOk && !!onRevertirLimpieza;
                    if (selectedBed.cleaned) {
                      const when = fechaHoraSegura(selectedBed.cleanedAt);
                      return (
                        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">
                          <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">Habitación limpia</p>
                            <p className="truncate text-xs">
                              {selectedBed.cleanedBy ? `Por ${selectedBed.cleanedBy}` : 'Marcada limpia'}{when ? ` · ${when}` : ''}
                            </p>
                          </div>
                          {(canClean || canRevert) && onUndoClean && (
                            // Todavía sin consolidar: anula la limpieza y PROGAL ya la tiene En preparación.
                            <Button type="button" variant="outline" size="sm" onClick={() => { onUndoClean(selectedBed.label); setSelectedBed(null); }}
                              title='Volver a "En preparación" (anula la limpieza)'
                              className="shrink-0">
                              {canClean ? 'Deshacer' : 'Volver a En preparación'}
                            </Button>
                          )}
                        </div>
                      );
                    }
                    // Volvió a "En preparación" por un rollback: quién y cuándo (+ deshacer para quien tiene el permiso).
                    const vuelta = selectedBed.vueltaPreparacion;
                    const vueltaNota = vuelta && (
                      <div className="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-700">
                        <Undo2 className="size-4 shrink-0" aria-hidden="true" />
                        <p className="min-w-0 flex-1 text-sm">
                          Volvió a <strong>En preparación</strong> (estaba sucia) · {vuelta.by}{vuelta.at ? ` · ${fechaHoraSegura(vuelta.at)}` : ''}
                        </p>
                        {canRevert && onUndoClean && (
                          <Button type="button" variant="outline" size="sm" onClick={() => { onUndoClean(selectedBed.label); setSelectedBed(null); }}
                            className="shrink-0">
                            Deshacer
                          </Button>
                        )}
                      </div>
                    );
                    // Disponible (ya consolidada en PROGAL) pero sucia → rollback con el permiso.
                    if (selectedBed.status === BedStatus.AVAILABLE && canRevert && !bedTicketMap.get(selectedBed.label)) {
                      return <VolverAPreparacion bed={selectedBed} onConfirm={onRevertirLimpieza!} onDone={() => setSelectedBed(null)} />;
                    }
                    if (vuelta && !(isPrep && canClean && onMarkClean && !bedTicketMap.get(selectedBed.label))) return vueltaNota;
                    if (isPrep && canClean && onMarkClean) {
                      // Cama reservada como DESTINO de un traslado en curso: la marca de
                      // limpieza no aplica acá (el auto-cierre la anularía con motivo TICKET,
                      // y con razón — la limpieza previa al ingreso se informa con
                      // "Habitación Lista" desde Operativa). Antes el botón aparecía igual,
                      // se tocaba, y no pasaba nada: mejor decir por qué.
                      const reservadaPor = bedTicketMap.get(selectedBed.label);
                      if (reservadaPor) {
                        return (
                          <AvisoInline tono="info" icono={Info}>
                            Reservada por un traslado en curso ({reservadaPor.patientName}). La limpieza
                            previa al ingreso se confirma con <strong>“Habitación Lista”</strong> desde
                            Operativa, no con la marca de limpieza.
                          </AvisoInline>
                        );
                      }
                      return (
                        <div className="flex flex-col gap-2">
                          {vueltaNota}
                          <Button type="button" onClick={() => { onMarkClean(selectedBed); setSelectedBed(null); }} className="w-full">
                            <SprayCan className="size-4" /> Marcar habitación limpia
                          </Button>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  {/* Cirugía (feature Cx): alta "Listo para cirugía" (Enfermería, cama ocupada) o
                      pill + "Iniciar dieta" cuando el paciente vuelve. Ver CirugiaBedBlock. */}
                  {(onMarcarListo || onCirugiaEnTraslado || onCirugiaTolerancia || onCirugiaRetroceder || onCirugiaPrevia) && (
                    <CirugiaBedBlock
                      bed={cirugiaBed ?? selectedBed}
                      tieneCirugiaCompletada={patientTieneCxCompletada}
                      onMarcarListo={onMarcarListo}
                      onCirugiaEnTraslado={onCirugiaEnTraslado}
                      onCirugiaTolerancia={onCirugiaTolerancia}
                      onCirugiaRetroceder={onCirugiaRetroceder}
                      onCirugiaPrevia={onCirugiaPrevia}
                      onAnularCirugiaPrevia={onAnularCirugiaPrevia}
                      previa={patientCxPrevia}
                      currentUser={currentUser}
                      onDone={() => setSelectedBed(null)}
                    />
                  )}

                  {/* Limpieza de rutina (camas ocupadas): Iniciar / Finalizar. Solo si el rol tiene el permiso. */}
                  {(onStartRoutineCleaning || onFinishRoutineCleaning) && (
                    <RoutineCleaningBlock
                      bed={liveBed ?? selectedBed}
                      onStart={onStartRoutineCleaning}
                      onFinish={onFinishRoutineCleaning}
                      onDone={() => setSelectedBed(null)}
                    />
                  )}

                  {/* Sexo sugerido — solo en camas libres. Usa el MISMO gate que el chip de la
                      grilla, así no pueden divergir. Es una sugerencia derivada de quién ocupa el
                      resto de la habitación, no un dato del paciente de esta cama. */}
                  {(() => {
                    const sug = suggestedSexFor(selectedBed);
                    if (!sug) return null;
                    return (
                      <div className="flex items-start gap-2.5 rounded-lg border bg-muted/30 p-3">
                        <div className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed text-[11px] font-semibold text-muted-foreground">{sug}</div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">Sugerido: {sug === 'M' ? 'masculino' : 'femenino'}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            La habitación ya aloja {sug === 'M' ? 'pacientes masculinos' : 'pacientes femeninos'}. Es una sugerencia, no una restricción.
                          </p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* OCCUPIED — patient info organized in tabs */}
                  {isOccupied && (() => {
                    const spinner = <Loader2 className="inline-block size-4 animate-spin text-muted-foreground" />;
                    // '—' sin dato; un ISO que no parsea se muestra tal cual (como antes).
                    const fmtDate = (iso?: string) => (!iso ? '—' : fechaHoraSegura(iso) || iso);
                    const fmtDateOnly = (iso?: string) => (!iso ? '—' : fechaSegura(iso) || iso);
                    const daysSinceAdmission = (iso?: string): number | null => {
                      if (!iso) return null;
                      const d = new Date(iso);
                      if (isNaN(d.getTime())) return null;
                      const diffMs = Date.now() - d.getTime();
                      return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
                    };
                    const stayDays = daysSinceAdmission(displayBed?.admissionDate);
                    const hasInternacionData =
                      !!displayBed?.admissionType ||
                      !!displayBed?.admissionDate ||
                      displayBed?.authorizedDays != null ||
                      !!displayBed?.expectedSurgeryDate;
                    const hasDietData = !!(displayBed?.diets && displayBed.diets.length > 0);
                    // La API ya devuelve solo ayunos vigentes (no ejecutados); mostramos
                    // las ocurrencias tal cual, agrupadas por indicación.
                    const liveFastingInds = (displayBed?.fasting?.indications ?? [])
                      .map(ind => ({ ind, occ: fastingOccurrences(ind) }))
                      .filter(x => x.occ.length > 0);
                    const hasFastingData = liveFastingInds.length > 0;

                    // All tabs always navigable. If the enrich didn't return data
                    // for a tab, the tab content renders an explicit "sin datos" line
                    // — better UX than visually disabling it without context.
                    const tabs: { key: 'general' | 'internacion' | 'dieta' | 'ayunos'; label: string }[] = [
                      { key: 'general',     label: 'Generales' },
                      { key: 'internacion', label: 'Internación' },
                      { key: 'dieta',       label: 'Dieta' },
                      { key: 'ayunos',      label: 'Ayunos' },
                    ];
                    const activeTab = detailTab;

                    return (
                      <>
                        {/* Header paciente — siempre visible */}
                        <div className="rounded-lg border bg-card p-3">
                          <div className="mb-1 flex items-center gap-1.5">
                            <UserIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                            <span className={MICRO}>Paciente</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <p className="min-w-0 truncate text-lg font-semibold">{selectedBed.patientName}</p>
                            {selectedBed.patientName && (
                              (patientTickets.length > 0 || patientHasCirugias) ? (
                                <Button variant="outline" size="sm" onClick={() => setJourneyOpen(true)} className="h-8 shrink-0 gap-1.5 px-3 text-xs">
                                  <History className="size-3.5" /> Historial del paciente
                                </Button>
                              ) : (patientTicketsLoading || !patientCirugiasLoaded) ? (
                                <span className="flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
                                  <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Cargando…
                                </span>
                              ) : patientTicketsLoaded ? (
                                <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">Sin historial</span>
                              ) : null
                            )}
                          </div>
                        </div>

                        {/* Solapas del detalle: control segmentado del kit (Tabs, §6.6); a lo ancho para
                            que las 4 entren en mobile. */}
                        <Tabs value={activeTab} onValueChange={(v) => setDetailTab(v as typeof activeTab)}>
                          <TabsList className="w-full">
                            {tabs.map(tab => (
                              <TabsTrigger key={tab.key} value={tab.key} className="flex-1 px-2 text-xs sm:text-sm">{tab.label}</TabsTrigger>
                            ))}
                          </TabsList>
                        </Tabs>

                        {/* Tab: Generales */}
                        {activeTab === 'general' && (
                          <>
                            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-6">
                              <div className="bg-muted/50 rounded-lg p-3 border border-border sm:col-span-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">DNI</p>
                                <p className="text-sm font-mono font-bold text-foreground">{enrichLoading ? spinner : (displayBed?.dni || '—')}</p>
                              </div>
                              <div className="bg-muted/50 rounded-lg p-3 border border-border sm:col-span-1">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Edad</p>
                                <p className="text-sm font-bold text-foreground">{enrichLoading ? spinner : (displayBed?.age != null ? `${displayBed.age}` : '—')}</p>
                              </div>
                              <div className="bg-muted/50 rounded-lg p-3 border border-border sm:col-span-1">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Sexo</p>
                                <p className="text-sm font-bold text-foreground">{enrichLoading ? spinner : (displayBed?.sex === 'M' ? 'M' : displayBed?.sex === 'F' ? 'F' : '—')}</p>
                              </div>
                              <div className="bg-muted/50 rounded-lg p-3 border border-border sm:col-span-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Evento</p>
                                <p className="text-sm font-mono font-bold text-foreground whitespace-nowrap">
                                  {selectedBed.eventOrigin && selectedBed.eventNumber
                                    ? `${selectedBed.eventOrigin}-${selectedBed.eventNumber}`
                                    : '—'}
                                </p>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2.5">
                              <div className="bg-muted/50 rounded-lg p-3 border border-border">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Financiador</p>
                                <p className="text-sm font-semibold text-foreground">{enrichLoading ? spinner : (displayBed?.institution || '—')}</p>
                                {(displayBed?.medicalPlan || displayBed?.medicalPlanCode || displayBed?.medicalPlanDescription) && (
                                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                                    Plan: {displayBed?.medicalPlan ?? displayBed?.medicalPlanCode}
                                    {displayBed?.medicalPlanDescription && ` · ${displayBed.medicalPlanDescription}`}
                                  </p>
                                )}
                              </div>
                              <div className="bg-muted/50 rounded-lg p-3 border border-border">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">ID Paciente</p>
                                <p className="text-sm font-mono font-bold text-foreground">{selectedBed.patientCode || '—'}</p>
                              </div>
                            </div>

                            <div className="bg-muted/50 rounded-lg p-3 border border-border">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Profesional</p>
                              <p className="text-sm font-semibold text-foreground">{enrichLoading ? spinner : (displayBed?.prescribingPhysician || displayBed?.attendingPhysician || '—')}</p>
                            </div>

                            {(displayBed?.diagnosis || enrichLoading) && (
                              <div className="bg-muted/50 rounded-lg p-3 border border-border">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Diagnóstico</p>
                                <p className="text-sm font-semibold text-foreground">{enrichLoading ? spinner : displayBed?.diagnosis}</p>
                              </div>
                            )}
                          </>
                        )}

                        {/* Tab: Internación */}
                        {activeTab === 'internacion' && (
                          <>
                            <div className="grid grid-cols-3 gap-2.5">
                              <div className="bg-muted/50 rounded-lg p-3 border border-border">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Tipo</p>
                                <p className="text-sm font-bold text-foreground">
                                  {enrichLoading
                                    ? spinner
                                    : (displayBed?.admissionType
                                        ? <><span>{displayBed.admissionType}</span>{displayBed.admissionTypeCode && <span className="text-[10px] font-mono text-muted-foreground ml-1">({displayBed.admissionTypeCode})</span>}</>
                                        : '—')}
                                </p>
                              </div>
                              <div className="bg-muted/50 rounded-lg p-3 border border-border">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Ingreso</p>
                                <p className="text-sm font-semibold text-foreground">{enrichLoading ? spinner : fmtDate(displayBed?.admissionDate)}</p>
                                {stayDays != null && stayDays > 0 && !enrichLoading && (
                                  <p className="text-[10px] text-muted-foreground mt-0.5">hace {stayDays} día{stayDays === 1 ? '' : 's'}</p>
                                )}
                              </div>
                              <div className="bg-muted/50 rounded-lg p-3 border border-border">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Días Autorizados</p>
                                <p className="text-sm font-bold text-foreground">
                                  {enrichLoading
                                    ? spinner
                                    : (displayBed?.authorizedDays != null ? displayBed.authorizedDays : '—')}
                                </p>
                                {displayBed?.authorizedDays != null && stayDays != null && !enrichLoading && (
                                  // Excedido → pill roja; en el límite → ámbar; con margen → texto muted.
                                  stayDays >= displayBed.authorizedDays ? (
                                    <StatusBadge tono={stayDays > displayBed.authorizedDays ? 'peligro' : 'aviso'} className="mt-1">
                                      {stayDays > displayBed.authorizedDays
                                        ? `Excede ${stayDays - displayBed.authorizedDays}`
                                        : `${displayBed.authorizedDays - stayDays} restantes`}
                                    </StatusBadge>
                                  ) : (
                                    <p className="mt-0.5 text-[10px] text-muted-foreground">{displayBed.authorizedDays - stayDays} restantes</p>
                                  )
                                )}
                              </div>
                            </div>
                            {displayBed?.expectedSurgeryDate && (
                              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-700">
                                <p className="mb-1 text-[10px] font-semibold tracking-wider uppercase">Fecha probable de cirugía</p>
                                <p className="text-sm font-bold">{fmtDateOnly(displayBed.expectedSurgeryDate)}</p>
                              </div>
                            )}
                            {/* Marca "va a cirugía" (Admisión): habilita el circuito Cx para un paciente
                                NO quirúrgico. Solo si el rol tiene el permiso (App gatea onMarcarVaCirugia).
                                Usa cirugiaBed (enrich + estado operativo VIVO): el switch refleja al toque
                                el update optimista de la marca Y el botón "Listo para cirugía" del bloque de
                                abajo se recalcula sin cerrar/reabrir el modal. */}
                            {onMarcarVaCirugia && onDesmarcarVaCirugia && (
                              <VaCirugiaToggle
                                bed={cirugiaBed ?? selectedBed}
                                tieneCirugiaCompletada={patientTieneCxCompletada}
                                onMarcar={onMarcarVaCirugia} onDesmarcar={onDesmarcarVaCirugia} />
                            )}
                            {!enrichLoading && !hasInternacionData && (
                              <p className="py-2 text-center text-xs text-muted-foreground">Sin datos de internación disponibles</p>
                            )}
                          </>
                        )}

                        {/* Tab: Dieta */}
                        {activeTab === 'dieta' && (
                          <>
                            {/* Dieta del paciente PRIMERO (tipo + condiciones + formulario) para que
                                Nutrición sepa qué dieta tiene ANTES de cargar el menú (abajo). */}
                            {displayBed?.dietTags && displayBed.dietTags.length > 0 && (
                              <div className="rounded-lg border bg-muted/30 p-3">
                                <p className="mb-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Condiciones y tipo</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {displayBed.dietTags.map(tag => (
                                    <StatusBadge key={tag} tono="exito">{tag}</StatusBadge>
                                  ))}
                                </div>
                              </div>
                            )}
                            {displayBed?.diets && displayBed.diets.length > 0 && (() => {
                              const LONG_ANSWER_LEN = 25;
                              const shortDiets = displayBed.diets.filter(d => (d.respuesta ?? '').trim().length <= LONG_ANSWER_LEN);
                              const longDiets  = displayBed.diets.filter(d => (d.respuesta ?? '').trim().length >  LONG_ANSWER_LEN);
                              return (
                                <>
                                  {shortDiets.length > 0 && (
                                    <div className="bg-muted/50 rounded-lg p-3 border border-border">
                                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Formulario completo</p>
                                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                                        {shortDiets.map((d, idx) => {
                                          const resp = (d.respuesta ?? '').trim();
                                          const isNo = resp.toLowerCase() === 'no';
                                          return (
                                            <div key={idx} className="flex items-center justify-between gap-2 text-[11px] min-w-0">
                                              <span className="text-muted-foreground truncate">{d.descripcion}</span>
                                              <span className={cn(
                                                "shrink-0 font-semibold",
                                                isNo ? "text-muted-foreground" : "text-foreground"
                                              )}>
                                                {resp || '—'}
                                              </span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                  {longDiets.length > 0 && (
                                    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                                      <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Notas</p>
                                      {longDiets.map((d, idx) => (
                                        <div key={idx} className="space-y-0.5">
                                          <p className="text-[10px] font-semibold uppercase text-muted-foreground">{d.descripcion}</p>
                                          <p className="text-[11px] text-foreground wrap-break-word whitespace-pre-wrap leading-snug">
                                            {(d.respuesta ?? '').trim() || '—'}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                            {!enrichLoading && !hasDietData && (
                              <p className="py-2 text-center text-xs text-muted-foreground">Sin datos de dieta disponibles</p>
                            )}
                            {enrichLoading && (
                              <p className="flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" aria-hidden="true" /> Cargando…</p>
                            )}
                            {/* Carga de menú por Nutrición (15.CargasDieta) — DEBAJO del detalle de
                                dieta: se carga el menú sabiendo qué dieta/condiciones tiene el paciente.
                                Nutrición edita los turnos que su rol habilita; catering/otros lo ven en lectura. */}
                            {(() => {
                              const liveBed = beds.find(b => b.label === selectedBed.label) ?? selectedBed;
                              // Turnos que ESTE rol puede cargar: `cargar_dieta` (histórico) = todos; sino,
                              // los granulares `cargar_comanda_<turno>`. Los turnos NO habilitados se ven
                              // igual (permiso de ver) pero en solo-lectura, con candado — misma vista que
                              // catering, señalizada.
                              const editableSlots = new Set(MEAL_SLOTS.filter(({ slot }) => canLoadMealSlot(currentUser, slot)).map(({ slot }) => slot));
                              const canEditAny = editableSlots.size > 0;
                              // Bloqueo sin dieta: solo con dato CONFIRMADO del cron
                              // (enriched===true). El enrich on-demand del modal NO participa:
                              // su "sin diets" es indistinguible de "Gamma falló / evento no
                              // consultado" y bloquear ahí violaría el fail-open.
                              const sinDieta = titularSinDieta(liveBed);
                              const hasAnyMeal = hasAnyMealLoad(liveBed.meals);
                              if (!canViewComanda) return null;              // sin permiso → no ve la sección
                              if (!canEditAny && !hasAnyMeal) return null;   // solo-lectura y nada cargado → nada
                              return (
                                <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                                  <div className="flex items-center gap-1.5">
                                    <ClipboardList className="size-3.5 text-muted-foreground" aria-hidden="true" />
                                    <p className={MICRO}>Menú{canEditAny ? ' — Nutrición' : ''}</p>
                                  </div>
                                  {MEAL_SLOTS.map(({ slot, label }) => (
                                    <MealSlotEditor key={slot} bed={liveBed} slot={slot} label={label}
                                      canEdit={editableSlots.has(slot)}
                                      // El hint solo aparece para quien puede cargar OTROS turnos;
                                      // catering puro sigue viendo exactamente lo mismo que hoy.
                                      lockedByPermission={canEditAny && !editableSlots.has(slot)}
                                      sinDieta={sinDieta} planned={plannedMenu[slot]}
                                      open={openSlots.has(slot)}
                                      onToggle={() => setOpenSlots(prev => {
                                        const n = new Set(prev);
                                        n.has(slot) ? n.delete(slot) : n.add(slot);
                                        return n;
                                      })}
                                      onSave={onSaveMeal} onClear={onClearMeal}
                                      onSaveCompanion={onSaveCompanion} onClearCompanion={onClearCompanion} />
                                  ))}
                                </div>
                              );
                            })()}
                          </>
                        )}

                        {/* Tab: Ayunos */}
                        {activeTab === 'ayunos' && (
                          <>
                            {hasFastingData && (
                              <div className="space-y-2">
                                {liveFastingInds.map(({ ind, occ }) => (
                                  <div key={ind.indicationId} className="rounded-lg border bg-muted/30 p-3">
                                    <div className="mb-1.5 flex items-center justify-between gap-2">
                                      <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Indicación #{ind.indicationId}</p>
                                      <StatusBadge tono={MARCAS_CAMA.ayuno.tono}>
                                        {occ.length} ayuno{occ.length === 1 ? '' : 's'}
                                      </StatusBadge>
                                    </div>
                                    <ul className="space-y-0.5">
                                      {occ.map((iso, idx) => (
                                        <li key={idx} className="text-[11px] text-foreground">
                                          {formatFastingDateTime(iso)}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ))}
                              </div>
                            )}
                            {!enrichLoading && !hasFastingData && (
                              <p className="py-2 text-center text-xs text-muted-foreground">Sin ayunos vigentes</p>
                            )}
                            {enrichLoading && (
                              <p className="flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" aria-hidden="true" /> Cargando…</p>
                            )}
                          </>
                        )}
                      </>
                    );
                  })()}

                  {isAssigned && (() => {
                    const assignedTicket = bedTicketMap.get(selectedBed.label);
                    return (
                      <>
                        <AvisoInline tono="info" icono={Info}>
                          <span className="font-medium">Reservada — traslado en curso</span>
                        </AvisoInline>
                        {assignedTicket && (
                          <>
                            <div className="rounded-lg border bg-card p-3">
                              <span className={MICRO}>Paciente en traslado</span>
                              <p className="text-sm font-semibold">{assignedTicket.patientName}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="rounded-lg border bg-muted/30 p-2.5">
                                <p className="mb-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Origen</p>
                                <p className="truncate text-xs font-semibold">{assignedTicket.origin}</p>
                              </div>
                              <div className="rounded-lg border bg-muted/30 p-2.5">
                                <p className="mb-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Estado</p>
                                <p className="text-xs font-semibold">{assignedTicket.status}</p>
                              </div>
                            </div>
                          </>
                        )}
                      </>
                    );
                  })()}

                  {/* Bloqueada por aislamiento: no se dice "lista para recibir" al lado del cartel rojo de abajo. */}
                  {isAvailable && !blockedByIsolation.has(selectedBed.label) && (
                    <AvisoInline tono="exito" icono={CheckCircle2}>Lista para recibir paciente</AvisoInline>
                  )}

                  {isPrep && (
                    <AvisoInline tono="aviso" icono={Info}>En preparación para nuevo ingreso</AvisoInline>
                  )}

                  {isDisabled && (
                    <AvisoInline tono="neutro" icono={Info}>
                      <p className="font-medium text-foreground">Fuera de servicio</p>
                      {selectedBed.disabledReason && (
                        <p className="mt-0.5 wrap-break-word">Motivo: {selectedBed.disabledReason}</p>
                      )}
                    </AvisoInline>
                  )}

                  {/* Aislamiento (PROGAL — solo lectura). Tipos + observaciones del evento.
                      Usa displayBed (= enrichedBed ?? selectedBed) para mostrarlos también
                      cuando la cama todavía no fue procesada por el cron y se enriquece on-demand.
                      Cada tipo: punto de la cartelería + nombre (el color solo no alcanza, son 9+). */}
                  {displayBed?.isolations && displayBed.isolations.length > 0 && (() => {
                    const bed = displayBed!;
                    const tipos = bed.isolations!;
                    const plural = tipos.length > 1;
                    // Si TODOS los aislamientos son Contacto preventivo, las camas contiguas
                    // no se bloquean (solo se señalizan). Sino, la habitación queda bloqueada.
                    const onlyPreventive = isPreventiveOnlyBed(bed);
                    return (
                      <div className="space-y-2.5 rounded-lg border bg-card p-3">
                        <div className="flex items-start gap-2.5">
                          <ICONO_AISLAMIENTO className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">Aislamiento{plural ? 's' : ''} activo{plural ? 's' : ''}</p>
                            <p className="text-xs text-muted-foreground">{
                              onlyPreventive ? 'Camas contiguas señalizadas (no bloqueadas)'
                              // Quemado: el mapa igual bloquea (no sabe a quién van a traer), pero el
                              // selector de destino SÍ deja convivir Q con Q. Se aclara para que no
                              // parezca contradictorio con lo que ofrece el alta de traslado.
                              : tipos.some(i => isolationRule(i.name) === 'igual') ? 'Solo comparte habitación con otro paciente igual'
                              : tipos.some(i => isolationRule(i.name) === 'solo') ? 'No comparte habitación'
                              : 'Camas de la habitación bloqueadas'
                            }</p>
                          </div>
                        </div>
                        <ul className="space-y-1.5">
                          {tipos.map((iso, i) => (
                            <li key={`${iso.name}-${i}`} className="flex flex-wrap items-center gap-1.5">
                              <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-xs font-medium">
                                <span className={cn('size-2 rounded-full', puntoAislamiento(iso.color))} aria-hidden="true" />
                                {iso.name}
                                {isolationSigla(iso.name) && <span className="text-muted-foreground">({isolationSigla(iso.name)})</span>}
                              </span>
                              {iso.observation && (
                                <span className="text-xs wrap-break-word text-muted-foreground">— {iso.observation}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()}
                  {blockedByIsolation.has(selectedBed.label) && (
                    <AvisoInline tono="violeta" icono={MARCAS_CAMA.bloqueada.icono}>
                      <span className="font-medium">Bloqueada — paciente aislado en esta habitación</span>
                    </AvisoInline>
                  )}
                  {preventiveContactAdjacent.has(selectedBed.label) && (
                    <AvisoInline tono="cian" icono={MARCAS_CAMA.preventivo.icono}>
                      <span className="font-medium">Contacto preventivo en esta habitación — cama habilitada, usar con precaución</span>
                    </AvisoInline>
                  )}

                </DialogBody>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setSelectedBed(null)}>Cerrar</Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Trayectoria del paciente — hermano del detalle de cama: se apila encima y al
          cerrar vuelve al detalle (no cerramos selectedBed al abrirlo). */}
      <PatientJourney
        patientTickets={patientTickets}
        ubicacionProgal={selectedBed?.patientCode ? selectedBed.label : undefined}
        isOpen={journeyOpen}
        onClose={() => setJourneyOpen(false)}
        workflowLabels={WORKFLOW_LABELS}
      />
    </div>
  );
};
