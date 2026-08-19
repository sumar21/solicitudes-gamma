import React, { useState, useMemo, useCallback } from 'react';
import { Bed, BedStatus, Ticket, TicketStatus, User, Area, IsolationEntry, MealSlot, MealLoad, MEAL_SLOTS, mealSlotFromSp, hasAnyMealLoad, hasPendingMealLoad, MAX_ACOMPANANTES, COMANDA_STATUS, titularSinDieta, dietTypeFromDiets } from '../types';
import { can, canLoadMealSlot, canLoadAnyMealSlot } from '../lib/permissions';
import { hasLiveFasting, fastingOccurrences, formatFastingDateTime, fastingTimesForToday } from '../lib/fasting';
import { Input } from '../components/ui/input';
import { cn, dietRequiresCustomComanda, suggestedRoomSex, formatBedName, formatDateReadable } from '../lib/utils';
import { BedDouble, User as UserIcon, Info, Search, X, Plus, ChevronDown, ChevronRight, Check, AlertTriangle, AlertCircle, CheckCircle2, ShieldAlert, RefreshCw, Utensils, UtensilsCrossed, Clock, FileText, ArrowDownAZ, SlidersHorizontal, MoreVertical, SprayCan, History, Lock, Activity, ArrowRight, Calendar as CalendarIcon } from 'lucide-react';
import { Calendar } from '../components/ui/calendar';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { PatientJourney } from '../components/PatientJourney';
import { WORKFLOW_LABELS, CIRUGIA_ESTADO_LABEL, CIRUGIA_PILL_CLASS } from '../lib/constants';
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
  onCirugiaRecibida?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onCirugiaTolerancia?: (id: string) => Promise<{ ok: boolean; error?: string }>;
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

// Mapa de clave de color (la define api/isolations-summary.ts) → clases Tailwind.
// Las clases van como literales para que el JIT de Tailwind las incluya en el build.
const ISOLATION_COLORS: Record<string, { ring: string; bg: string; text: string; dot: string; pill: string }> = {
  pink:    { ring: 'ring-pink-400',    bg: 'bg-pink-500',    text: 'text-pink-700',    dot: 'bg-pink-500',    pill: 'bg-pink-100 text-pink-700' },
  slate:   { ring: 'ring-slate-400',   bg: 'bg-slate-500',   text: 'text-slate-700',   dot: 'bg-slate-500',   pill: 'bg-slate-100 text-slate-700' },
  green:   { ring: 'ring-green-400',   bg: 'bg-green-500',   text: 'text-green-700',   dot: 'bg-green-500',   pill: 'bg-green-100 text-green-700' },
  blue:    { ring: 'ring-blue-400',    bg: 'bg-blue-500',    text: 'text-blue-700',    dot: 'bg-blue-500',    pill: 'bg-blue-100 text-blue-700' },
  yellow:  { ring: 'ring-yellow-400',  bg: 'bg-yellow-500',  text: 'text-yellow-700',  dot: 'bg-yellow-500',  pill: 'bg-yellow-100 text-yellow-700' },
  orange:  { ring: 'ring-orange-400',  bg: 'bg-orange-500',  text: 'text-orange-700',  dot: 'bg-orange-500',  pill: 'bg-orange-100 text-orange-700' },
  teal:    { ring: 'ring-teal-400',    bg: 'bg-teal-500',    text: 'text-teal-700',    dot: 'bg-teal-500',    pill: 'bg-teal-100 text-teal-700' },
  amber:   { ring: 'ring-amber-700',   bg: 'bg-amber-800',   text: 'text-amber-800',   dot: 'bg-amber-800',   pill: 'bg-amber-100 text-amber-800' },
  fuchsia: { ring: 'ring-fuchsia-400', bg: 'bg-fuchsia-500', text: 'text-fuchsia-700', dot: 'bg-fuchsia-500', pill: 'bg-fuchsia-100 text-fuchsia-700' },
  violet:  { ring: 'ring-violet-400',  bg: 'bg-violet-500',  text: 'text-violet-700',  dot: 'bg-violet-500',  pill: 'bg-violet-100 text-violet-700' },
};
const DEFAULT_ISO_COLOR = ISOLATION_COLORS.violet;

// Color de la cama CONTIGUA a un aislamiento "Contacto preventivo": no se inhabilita
// (a diferencia de los demás aislamientos, que la bloquean en gris/violeta) sino que se
// marca con un color propio que NO se usa para ningún estado de cama (Disponible/Ocupada/
// En preparación/Asignada/Inhabilitada) ni para el bloqueo duro (violeta). Usamos cyan.
const PREVENTIVE_ADJ_CELL = 'bg-cyan-50 border-cyan-300';
const PREVENTIVE_ADJ_DOT  = 'bg-cyan-400';

// Normalización para comparar nombres de aislamiento sin tildes/casing.
const normIsoName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// "Contacto preventivo" (Gamma: "De contacto preventivo", color teal) es un aislamiento
// de baja restricción → la cama contigua NO se inhabilita, solo se señaliza.
const isPreventiveContact = (iso: IsolationEntry) => normIsoName(iso.name).includes('preventivo');
// Una cama aislada es "solo preventiva" si TODOS sus tipos activos son Contacto preventivo.
// (Si tiene además un aislamiento duro, la habitación se bloquea como siempre.)
const isPreventiveOnlyBed = (bed: Bed) =>
  (bed.isolations?.length ?? 0) > 0 && bed.isolations!.every(isPreventiveContact);

// Áreas con cubículos/lugares físicamente independientes (UCO, UTI, ITR, HRA): no se bloquean
// entre sí cuando un paciente está aislado. A nivel módulo para poder testear computeIsolationBlocks.
const CRITICAL_AREAS_NO_BLOCK: Area[] = [Area.HUC, Area.HUT, Area.HIT, Area.HRA];

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
    if (roomBeds.some(b => CRITICAL_AREAS_NO_BLOCK.includes(b.area))) continue;
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
  m ? `${m.by}${m.at ? ` · ${new Date(m.at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}` : '';

// Pill de tipo (compartido con el monitor de comandas): Menú/Opción/Otros con su color.
export const comandaTipoPill = (t?: string): { label: string; cls: string } =>
  t === 'MENU'   ? { label: 'Menú',   cls: 'bg-emerald-100 text-emerald-700' }
  : t === 'OPCION' ? { label: 'Opción', cls: 'bg-amber-100 text-amber-700' }
  : { label: 'Otros', cls: 'bg-indigo-100 text-indigo-700' };

const TIPO_BTN_CLS: Record<'MENU' | 'OPCION' | 'OTROS', string> = {
  MENU:   'bg-emerald-600 text-white border-emerald-600',
  OPCION: 'bg-amber-500 text-white border-amber-500',
  OTROS:  'bg-indigo-600 text-white border-indigo-600',
};

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
    <button type="button" onClick={onToggle}
      className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50/80 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <ChevronRight className={cn('w-3 h-3 text-slate-400 shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-600">{label}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Candado en span y no `title` directo en el ícono: el atributo title sobre un <svg>
            inline no muestra tooltip nativo — sobre el <span> HTML sí (mismo patrón que el
            botón de eliminar acompañante). */}
        {lockedByPermission && (
          <span title="Tu rol no puede cargar este turno" className="flex items-center">
            <Lock className="w-3 h-3 text-slate-300 shrink-0" />
          </span>
        )}
        {pill
          ? <span className={cn('px-2 py-0.5 rounded-full text-[9px] font-bold', pill.cls)}>{pill.label}</span>
          : <span className="text-[9px] text-slate-300 italic">Sin carga</span>}
      </div>
    </button>
  );

  // Colapso por CSS (`hidden`) y NO por render condicional: desmontar destruiría lo tipeado sin
  // guardar. Con 4 turnos el riesgo se multiplica por 4.
  const body = (children: React.ReactNode) => (
    <div className={cn('px-3 pb-3 space-y-2', !open && 'hidden')}>{children}</div>
  );

  if (!canEdit) {
    return (
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        {header}
        {body(
          <>
            {lockedByPermission && (
              <p className="text-[9px] text-slate-400 italic flex items-center gap-1">
                <Lock className="w-3 h-3 shrink-0" /> Solo lectura — tu rol no puede cargar este turno.
              </p>
            )}
            {meal ? (
              <>
                {meal.detalle && <p className="text-[11px] font-semibold text-slate-800 whitespace-pre-wrap break-words">{meal.detalle}</p>}
                {meal.observaciones && <p className="text-[11px] text-slate-500 whitespace-pre-wrap break-words mt-0.5">Obs: {meal.observaciones}</p>}
                <p className="text-[9px] text-slate-400 mt-1">{fmtMealWhen(meal)}</p>
              </>
            ) : <p className="text-[10px] text-slate-300 italic">Sin carga</p>}
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
    <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
      {header}
      {body(
        <>
          {meal && <p className="text-[9px] text-slate-400 -mt-1">{fmtMealWhen(meal)}</p>}

          {/* Las 3 opciones para TODAS las dietas. En terapéuticas, "Otros" viene preseleccionado. */}
          <div className="flex gap-1.5">
            {(['MENU', 'OPCION', 'OTROS'] as const).map(op => (
              <button key={op} type="button" onClick={() => pickTipo(op)} disabled={entregada || sinDieta}
                aria-pressed={tipo === op}
                className={cn('flex-1 h-9 rounded-lg text-[11px] font-bold uppercase tracking-wide border transition-all disabled:opacity-50 disabled:cursor-not-allowed',
                  tipo === op ? TIPO_BTN_CLS[op] : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100')}>
                {op === 'MENU' ? 'Menú' : op === 'OPCION' ? 'Opción' : 'Otros'}
              </button>
            ))}
          </div>

          {entregada && (
            <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-emerald-50 border border-emerald-100">
              <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
              <p className="text-[9px] font-medium text-emerald-700">
                Ya entregada — para modificarla o quitarla, volvela a pendiente desde el panel de Comandas.
              </p>
            </div>
          )}
          {/* Bloqueo "sin dieta": el titular no se puede pedir hasta que PROGAL tenga la dieta.
              El botón "Quitar" queda operativo a propósito — es la válvula de escape para anular
              una comanda pre-existente de un paciente que perdió la dieta. */}
          {sinDieta && (
            <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-amber-50 border border-amber-200">
              <ShieldAlert className="w-3 h-3 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[9px] font-medium text-amber-800">
                El paciente no tiene dieta cargada en PROGAL — no se puede pedir su comanda hasta que la dieta esté cargada.
                {meal ? ' La comanda ya cargada solo se puede quitar.' : ''} Los acompañantes sí se pueden cargar.
              </p>
            </div>
          )}
          {preferOtros && !entregada && !sinDieta && (
            <p className="text-[9px] text-indigo-600 font-medium">
              Dieta especial — sugerido "Otros" (podés cambiarlo)
            </p>
          )}

          {showNoPlanWarning && (
            <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-amber-50 border border-amber-100">
              <AlertCircle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[9px] font-medium text-amber-700">
                No hay comanda planificada para este turno y tipo. Escribila abajo.
              </p>
            </div>
          )}

          <input value={detalle} onChange={e => { editedRef.current = true; setDetalle(e.target.value); }} maxLength={500}
            disabled={entregada || sinDieta}
            placeholder={tipo === 'OTROS' ? 'Comida / menú (obligatorio)' : 'Detalle de la comanda'}
            className={cn('w-full rounded-lg border px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:bg-slate-50 disabled:text-slate-400',
              tipo === 'OTROS' && detalle.trim() === '' ? 'border-indigo-300 bg-indigo-50/30' : 'border-slate-200')} />
          <textarea value={obs} onChange={e => { editedRef.current = true; setObs(e.target.value); }} rows={2} maxLength={500}
            disabled={entregada || sinDieta}
            placeholder="Observaciones (opcional)"
            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] resize-none focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:bg-slate-50 disabled:text-slate-400" />
          {saveError && (
            <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-red-50 border border-red-200">
              <AlertCircle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
              <p className="text-[9px] font-medium text-red-700">{saveError}</p>
            </div>
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
              className="flex-1 h-8 text-[11px] font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40">
              {saving ? 'Guardando…' : meal ? 'Actualizar' : 'Guardar'}
            </Button>
            {/* "Quitar" es una anulación: bloqueada si el plato ya se entregó (congelado, como
                en el panel). Un plato pendiente sí se puede quitar, pero PIDIENDO MOTIVO. */}
            {meal && onClear && (
              <Button variant="outline" size="sm" disabled={saving || entregada || removing}
                title={entregada ? 'Ya entregada — volvela a pendiente desde el panel para poder quitarla' : undefined}
                onClick={() => { setRemoveMotivo(''); setRemoving(true); }}
                className="h-8 px-3 text-[11px] font-bold rounded-lg border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-40">
                Quitar
              </Button>
            )}
          </div>

          {/* Prompt inline de motivo al quitar (anular). Obligatorio, queda en el histórico. */}
          {removing && onClear && (
            <div className="rounded-lg border border-red-200 bg-red-50/60 p-2 space-y-1.5">
              <p className="text-[9px] font-bold uppercase tracking-wide text-red-600">Motivo de anulación</p>
              <textarea
                autoFocus value={removeMotivo} onChange={e => setRemoveMotivo(e.target.value)} rows={2} maxLength={500}
                placeholder="Ej: el paciente pasó a ayuno, alta, cambio de dieta…"
                className="w-full rounded-lg border border-red-200 px-2 py-1.5 text-[11px] resize-none focus:outline-none focus:ring-2 focus:ring-red-200" />
              <div className="flex gap-2">
                <Button size="sm" disabled={!removeMotivo.trim() || saving}
                  onClick={async () => {
                    setSaving(true);
                    try { await onClear(bed, slot, removeMotivo.trim()); setRemoving(false); }
                    finally { setSaving(false); }
                  }}
                  className="flex-1 h-7 text-[11px] font-bold rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-40">
                  {saving ? 'Quitando…' : 'Confirmar anulación'}
                </Button>
                <Button variant="outline" size="sm" disabled={saving} onClick={() => setRemoving(false)}
                  className="h-7 px-3 text-[11px] font-bold rounded-lg border-slate-200 text-slate-500 hover:bg-slate-100">
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {/* ── Acompañantes ─────────────────────────────────────────────── */}
          <div className="pt-1 border-t border-slate-100 space-y-2">
            {(acomps.length > 0 || drafts.length > 0) && (
              <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400 pt-1">Acompañante/s</p>
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
                className="w-full h-8 rounded-lg border border-dashed border-slate-200 text-[10px] font-bold text-slate-400 hover:text-slate-600 hover:border-slate-300 flex items-center justify-center gap-1">
                <Plus className="w-3 h-3" /> Agregar acompañante
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
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">
          Acompañante {index}
          {entregada && <span className="ml-1.5 text-emerald-600">· Entregada</span>}
        </span>
        {/* Bloqueado si la bandeja del acompañante ya se entregó (congelada, como el titular).
            Un draft (sin companion) o un acompañante pendiente sí se pueden quitar. */}
        <button type="button" disabled={entregada || removing}
          title={entregada ? 'Ya entregada — volvela a pendiente desde el panel para poder quitarla' : 'Eliminar acompañante'}
          onClick={() => {
            if (!companion) { onDiscardDraft?.(); return; }   // draft → se descarta sin red ni motivo
            setRemoveMotivo(''); setRemoving(true);            // guardado → pide motivo
          }}
          className="w-5 h-5 rounded flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-300">
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Prompt inline de motivo al quitar un acompañante guardado (anular). */}
      {removing && companion && (
        <div className="rounded-lg border border-red-200 bg-red-50/60 p-2 space-y-1.5">
          <p className="text-[9px] font-bold uppercase tracking-wide text-red-600">Motivo de anulación</p>
          <textarea
            autoFocus value={removeMotivo} onChange={e => setRemoveMotivo(e.target.value)} rows={2} maxLength={500}
            placeholder="Ej: cambio de dieta, ya no come el acompañante…"
            className="w-full rounded-lg border border-red-200 px-2 py-1 text-[10px] resize-none focus:outline-none focus:ring-2 focus:ring-red-200" />
          <div className="flex gap-2">
            <Button size="sm" disabled={!removeMotivo.trim() || saving}
              onClick={async () => {
                setSaving(true);
                try { await onRemove?.(bed, slot, companion.spItemId, removeMotivo.trim()); setRemoving(false); }
                finally { setSaving(false); }
              }}
              className="flex-1 h-7 text-[10px] font-bold rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-40">
              {saving ? 'Quitando…' : 'Confirmar'}
            </Button>
            <Button variant="outline" size="sm" disabled={saving} onClick={() => setRemoving(false)}
              className="h-7 px-3 text-[10px] font-bold rounded-lg border-slate-200 text-slate-500 hover:bg-slate-100">
              Cancelar
            </Button>
          </div>
        </div>
      )}
      <div className="flex gap-1">
        {(['MENU', 'OPCION', 'OTROS'] as const).map(op => (
          <button key={op} type="button" onClick={() => pickTipo(op)} aria-pressed={tipo === op}
            className={cn('flex-1 h-7 rounded text-[9px] font-bold uppercase border transition-all',
              tipo === op ? TIPO_BTN_CLS[op] : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-100')}>
            {op === 'MENU' ? 'Menú' : op === 'OPCION' ? 'Opción' : 'Otros'}
          </button>
        ))}
      </div>
      <input value={detalle} onChange={e => { editedRef.current = true; setDetalle(e.target.value); }} maxLength={500}
        placeholder={tipo === 'OTROS' ? 'Comida (obligatorio)' : 'Detalle'}
        className="w-full rounded border border-slate-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-emerald-200" />
      <input value={obs} onChange={e => { editedRef.current = true; setObs(e.target.value); }} maxLength={500}
        placeholder="Observaciones (opcional)"
        className="w-full rounded border border-slate-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-emerald-200" />
      {error && <p className="text-[9px] font-medium text-red-600">{error}</p>}
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
        className="w-full h-7 text-[10px] font-bold rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40">
        {saving ? 'Guardando…' : companion ? 'Actualizar' : 'Guardar'}
      </Button>
    </div>
  );
};

// ── Bloque de Cirugía en el detalle de la cama (Enfermería) ──────────────────
// · Cama OCUPADA sin cirugía viva → botón "Listo para cirugía" (alta), SOLO si el paciente es
//   quirúrgico (admissionTypeCode==='Q', aviso con fecha probable) o fue marcado por Admisión
//   (flag bed.goingToSurgery, para pacientes NO quirúrgicos — ver cirugia_marcas).
// · Cama con cirugía viva → pill Cx por color; si está EN_DEVOLUCION, botón "Recibida"
//   (recepción confirmada, la marca enfermería del piso destino).
const CirugiaBedBlock: React.FC<{
  bed: Bed;
  onMarcarListo?: (bed: Bed) => Promise<{ ok: boolean; id?: string; error?: string }>;
  onCirugiaEnTraslado?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onCirugiaRecibida?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onCirugiaTolerancia?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onDone: () => void;
}> = ({ bed, onMarcarListo, onCirugiaEnTraslado, onCirugiaRecibida, onCirugiaTolerancia, onDone }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cx = bed.cirugia;
  const esQuirurgico = (bed.admissionTypeCode ?? '').toUpperCase() === 'Q';
  const flagActivo = !!bed.goingToSurgery; // marca "va a cirugía" de Admisión (paciente no-Q)
  const fmtFecha = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
  };

  // Cama con operatoria viva → pill + (Recibida si está volviendo).
  if (cx) {
    // ¿Hay cambio de cama al volver? Entonces hay DOS overlays: la cama vieja (role 'origin', el
    // paciente ya no vuelve acá) y la cama nueva (role 'destino', donde LLEGA el paciente).
    const esCambio = !!cx.camaDestino && cx.camaDestino !== cx.camaOrigen;
    const soyDestino = cx.role === 'destino';            // esta cama es la de LLEGADA
    const soyOrigenConCambio = cx.role === 'origin' && esCambio; // esta cama es la VIEJA
    // La recepción la confirma la enfermera de la cama donde LLEGA el paciente: cama destino si
    // cambió, o la propia si volvió a la misma. En la cama origen de un cambio NO va el botón.
    const puedoRecibir = cx.estado === 'EN_DEVOLUCION' && (soyDestino || !esCambio);
    // Evaluación de tolerancia: la hace quien recibió (misma cama de recepción), tras RECIBIDA. Cierra.
    const puedoTolerancia = cx.estado === 'RECIBIDA' && (soyDestino || !esCambio);
    return (
      <div className="rounded-2xl p-3.5 border border-slate-200 bg-slate-50/70 flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-tight', CIRUGIA_PILL_CLASS[cx.estado])}>
            <Activity className="w-3 h-3" strokeWidth={3} /> Cx · {CIRUGIA_ESTADO_LABEL[cx.estado]}
          </span>
          {soyDestino && (
            <span className="text-[10px] font-bold text-violet-700">Cama destino</span>
          )}
        </div>
        {/* Cama DESTINO: llega un paciente de otra cama → mostrar quién y de dónde. */}
        {soyDestino && (
          <p className="text-[11px] font-medium text-slate-600">
            Llega de cirugía: <strong>{cx.pacienteNombre ?? 'paciente'}</strong> (viene de {formatBedName(cx.camaOrigen)})
            {cx.estado === 'RECIBIDA' && ' — recibido; falta evaluar la tolerancia.'}
          </p>
        )}
        {/* Cama ORIGEN de un cambio: el paciente NO vuelve acá, se fue a la destino. */}
        {soyOrigenConCambio && (
          <p className="text-[11px] font-medium text-slate-600">
            El paciente volvió de cirugía a <strong>{formatBedName(cx.camaDestino!)}</strong>
            {cx.estado === 'RECIBIDA'
              ? ' — recibido; falta evaluar la tolerancia.'
              : ' — confirmá la recepción en esa cama.'}
          </p>
        )}
        {error && <p className="text-[10px] font-bold text-red-600">{error}</p>}
        {cx.estado === 'VAN_A_BUSCAR' && onCirugiaEnTraslado && (
          <button disabled={busy}
            onClick={async () => {
              setBusy(true); setError(null);
              const r = await onCirugiaEnTraslado(cx.id);
              setBusy(false);
              if (r.ok) onDone(); else setError(r.error ?? 'No se pudo confirmar.');
            }}
            className="w-full flex items-center justify-center gap-2 h-11 rounded-2xl bg-yellow-500 hover:bg-yellow-600 text-white font-black text-xs uppercase tracking-widest active:scale-[0.98] transition-all shadow-sm disabled:opacity-50">
            <ArrowRight className="w-4 h-4" /> {busy ? 'Registrando…' : 'Se lo llevó el camillero'}
          </button>
        )}
        {puedoRecibir && onCirugiaRecibida && (
          <button disabled={busy}
            onClick={async () => {
              setBusy(true); setError(null);
              const r = await onCirugiaRecibida(cx.id);
              setBusy(false);
              if (r.ok) onDone(); else setError(r.error ?? 'No se pudo confirmar.');
            }}
            className="w-full flex items-center justify-center gap-2 h-11 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-widest active:scale-[0.98] transition-all shadow-sm disabled:opacity-50">
            <CheckCircle2 className="w-4 h-4" /> {busy ? 'Confirmando…' : soyDestino ? 'Recibí al paciente' : 'Recibida (recepción confirmada)'}
          </button>
        )}
        {puedoTolerancia && onCirugiaTolerancia && (
          <button disabled={busy}
            onClick={async () => {
              setBusy(true); setError(null);
              const r = await onCirugiaTolerancia(cx.id);
              setBusy(false);
              if (r.ok) onDone(); else setError(r.error ?? 'No se pudo confirmar.');
            }}
            className="w-full flex items-center justify-center gap-2 h-11 rounded-2xl bg-green-600 hover:bg-green-700 text-white font-black text-xs uppercase tracking-widest active:scale-[0.98] transition-all shadow-sm disabled:opacity-50">
            <CheckCircle2 className="w-4 h-4" /> {busy ? 'Confirmando…' : 'Evaluación de tolerancia'}
          </button>
        )}
      </div>
    );
  }

  // Cama ocupada sin cirugía → alta (Enfermería marca "listo"). Endurecimiento: sólo aparece para
  // pacientes quirúrgicos (PROGAL, admissionTypeCode==='Q') o marcados por Admisión (flag "va a
  // cirugía"). Antes aparecía para CUALQUIER cama ocupada.
  if (bed.status !== BedStatus.OCCUPIED || !onMarcarListo || !(esQuirurgico || flagActivo)) return null;
  return (
    <div className="rounded-2xl p-3.5 border border-amber-200 bg-amber-50/50 flex flex-col gap-2.5">
      {esQuirurgico && (
        <div className="flex items-start gap-2">
          <Activity className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" strokeWidth={2.5} />
          <p className="text-[11px] font-medium text-amber-800">
            Paciente quirúrgico (PROGAL){bed.expectedSurgeryDate ? ` · cirugía probable: ${fmtFecha(bed.expectedSurgeryDate)}` : ''}.
          </p>
        </div>
      )}
      {!esQuirurgico && flagActivo && (
        <div className="flex items-start gap-2">
          <Activity className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" strokeWidth={2.5} />
          <p className="text-[11px] font-medium text-amber-800">
            Marcado para cirugía por Admisión{bed.goingToSurgeryBy ? ` (${bed.goingToSurgeryBy})` : ''}.
          </p>
        </div>
      )}
      {error && <p className="text-[10px] font-bold text-red-600">{error}</p>}
      <button disabled={busy}
        onClick={async () => {
          setBusy(true); setError(null);
          const r = await onMarcarListo(bed);
          setBusy(false);
          if (r.ok) onDone(); else setError(r.error ?? 'No se pudo marcar.');
        }}
        className="w-full flex items-center justify-center gap-2 h-11 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-black text-xs uppercase tracking-widest active:scale-[0.98] transition-all shadow-sm disabled:opacity-50">
        <Activity className="w-4 h-4" /> {busy ? 'Marcando…' : 'Listo para cirugía'}
      </button>
    </div>
  );
};

// Toggle "Va a cirugía" (Admisión) en la solapa Internación del detalle de cama. Prende/apaga el
// flag public.cirugia_marcas sobre un paciente NO quirúrgico para habilitar el circuito Cx. El flag
// sigue al paciente (keyed por código). No aplica si ya hay operatoria Cx viva o el paciente no
// tiene código Gamma. Estado local busy/error (como CirugiaBedBlock).
const VaCirugiaToggle: React.FC<{
  bed: Bed;
  onMarcar: (bed: Bed) => Promise<{ ok: boolean; error?: string }>;
  onDesmarcar: (patientCode: string) => Promise<{ ok: boolean; error?: string }>;
}> = ({ bed, onMarcar, onDesmarcar }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checked = !!bed.goingToSurgery;
  const cxViva = !!bed.cirugia;                                    // operatoria Cx ya iniciada → el flag ya no aplica
  const esQuirurgico = (bed.admissionTypeCode ?? '').toUpperCase() === 'Q';
  const sinCodigo = !bed.patientCode;
  const disabled = busy || cxViva || sinCodigo;
  const toggle = async () => {
    if (disabled) return;
    setBusy(true); setError(null);
    const r = checked ? await onDesmarcar(bed.patientCode!) : await onMarcar(bed);
    setBusy(false);
    if (!r.ok) setError(r.error ?? 'No se pudo actualizar.');
  };
  return (
    <div className="rounded-xl p-3 border border-violet-100 bg-violet-50/50">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[8px] font-bold uppercase text-violet-500 mb-0.5">Va a cirugía</p>
          <p className="text-[11px] font-medium text-violet-900">
            {esQuirurgico ? 'Paciente quirúrgico (PROGAL) — ya habilitado'
              : checked ? `Marcado${bed.goingToSurgeryBy ? ` por ${bed.goingToSurgeryBy}` : ''}`
              : 'Habilitar cirugía para este paciente'}
          </p>
        </div>
        <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={toggle}
          title={cxViva ? 'Cirugía en curso' : sinCodigo ? 'Paciente sin código Gamma' : checked ? 'Desmarcar' : 'Marcar va a cirugía'}
          className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40',
            checked ? 'bg-violet-600' : 'bg-slate-300')}>
          <span className={cn('inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
        </button>
      </div>
      {cxViva && <p className="text-[10px] text-violet-500 mt-1">Cirugía en curso: el flag ya no aplica.</p>}
      {sinCodigo && <p className="text-[10px] text-amber-600 mt-1">El paciente no tiene código Gamma: no se puede marcar.</p>}
      {error && <p className="text-[10px] font-bold text-red-600 mt-1">{error}</p>}
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
  const fmtFecha = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
  };
  if (active) {
    return (
      <div className="rounded-2xl p-3.5 border border-sky-200 bg-sky-50/60 flex flex-col gap-2.5">
        <div className="flex items-center gap-2 text-[11px] font-bold text-sky-800">
          <SprayCan className="w-4 h-4" strokeWidth={2.5} /> Limpieza de rutina en curso
        </div>
        {bed.routineCleaningBy && (
          <p className="text-[11px] font-medium text-slate-500">
            Iniciada por {bed.routineCleaningBy}{bed.routineCleaningAt ? ` · ${fmtFecha(bed.routineCleaningAt)}` : ''}
          </p>
        )}
        {onFinish && (
          <button disabled={busy}
            onClick={async () => { setBusy(true); await onFinish(bed); setBusy(false); onDone(); }}
            className="w-full flex items-center justify-center gap-2 h-11 rounded-2xl bg-sky-600 hover:bg-sky-700 text-white font-black text-xs uppercase tracking-widest active:scale-[0.98] transition-all shadow-sm disabled:opacity-50">
            <Check className="w-4 h-4" /> {busy ? 'Finalizando…' : 'Finalizar limpieza de rutina'}
          </button>
        )}
      </div>
    );
  }
  return onStart ? (
    <div className="rounded-2xl p-3.5 border border-sky-200 bg-sky-50/40">
      <button disabled={busy}
        onClick={async () => { setBusy(true); await onStart(bed); setBusy(false); onDone(); }}
        className="w-full flex items-center justify-center gap-2 h-11 rounded-2xl bg-sky-500 hover:bg-sky-600 text-white font-black text-xs uppercase tracking-widest active:scale-[0.98] transition-all shadow-sm disabled:opacity-50">
        <SprayCan className="w-4 h-4" /> {busy ? 'Iniciando…' : 'Iniciar limpieza de rutina'}
      </button>
    </div>
  ) : null;
};

// Filtro de rango de FECHA DE INTERNACIÓN con el date-picker propio (no el input nativo, que
// pinta el calendario del navegador y rompe el diseño). Desktop → Popover con los dos calendarios;
// Mobile → Dialog (más grande y usable con el dedo). Ambos comparten el mismo estado.
const AdmissionDateFilter: React.FC<{
  from: string; to: string;
  setFrom: (s: string) => void; setTo: (s: string) => void;
}> = ({ from, to, setFrom, setTo }) => {
  const [openDesk, setOpenDesk] = useState(false);
  const [openMob, setOpenMob]   = useState(false);
  const active = !!(from || to);
  const clear = () => { setFrom(''); setTo(''); };
  const chipClass = cn(
    'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-all border',
    active ? 'bg-slate-900 text-white border-slate-900 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50',
  );
  const label = active
    ? `${from ? formatDateReadable(from) : '…'} – ${to ? formatDateReadable(to) : '…'}`
    : 'Fecha internación';
  const chipInner = (<><CalendarIcon className="w-2.5 h-2.5" />{label}<ChevronDown className="w-2.5 h-2.5" /></>);
  const dosCalendarios = (
    <div className="flex flex-col sm:flex-row gap-4">
      <div>
        <p className="text-[9px] font-bold uppercase text-slate-400 mb-1.5 px-1">Desde</p>
        <Calendar selected={from} onSelect={setFrom} />
      </div>
      <div>
        <p className="text-[9px] font-bold uppercase text-slate-400 mb-1.5 px-1">Hasta</p>
        <Calendar selected={to} onSelect={setTo} />
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop → Popover */}
      <div className="hidden md:block">
        <Popover open={openDesk} onOpenChange={setOpenDesk}>
          <PopoverTrigger asChild><button type="button" className={chipClass}>{chipInner}</button></PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-3">
            <div className="flex items-center justify-between px-1 pb-2 mb-2 border-b border-slate-100">
              <span className="text-[9px] font-bold uppercase text-slate-400">Fecha de internación</span>
              {active && <button onClick={clear} className="text-[9px] font-bold text-red-500">Limpiar</button>}
            </div>
            {dosCalendarios}
          </PopoverContent>
        </Popover>
      </div>
      {/* Mobile → Dialog */}
      <div className="md:hidden">
        <button type="button" onClick={() => setOpenMob(true)} className={chipClass}>{chipInner}</button>
        <Dialog open={openMob} onOpenChange={setOpenMob}>
          <DialogContent className="max-w-[94vw] rounded-2xl p-4">
            <DialogTitle className="text-sm font-bold text-slate-800">Fecha de internación</DialogTitle>
            <div className="flex flex-col items-center gap-4 py-1">
              <div className="w-full">
                <p className="text-[10px] font-bold uppercase text-slate-400 mb-1.5">Desde</p>
                <Calendar selected={from} onSelect={setFrom} />
              </div>
              <div className="w-full">
                <p className="text-[10px] font-bold uppercase text-slate-400 mb-1.5">Hasta</p>
                <Calendar selected={to} onSelect={setTo} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              {active && <Button variant="outline" onClick={clear} className="rounded-xl h-10">Limpiar</Button>}
              <Button onClick={() => setOpenMob(false)} className="rounded-xl h-10">Listo</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
};

export const BedsView: React.FC<BedsViewProps> = ({ beds, tickets, currentUser, bedsLoading, bedsError, isolatedBeds = new Set(), onEnrichBed, onFetchPatientTickets, onRefresh, onMarkClean, onUndoClean, onSaveMeal, onClearMeal, onSaveCompanion, onClearCompanion, onMarcarListo, onCirugiaEnTraslado, onCirugiaRecibida, onCirugiaTolerancia, onStartRoutineCleaning, onFinishRoutineCleaning, onMarcarVaCirugia, onDesmarcarVaCirugia }) => {
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
    ? { ...displayBed, status: liveBed.status, goingToSurgery: liveBed.goingToSurgery, goingToSurgeryBy: liveBed.goingToSurgeryBy, cirugia: liveBed.cirugia }
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

  // ¿Este usuario puede ver comandas cargadas? (Nutrición carga; Catering/Nutrición ven).
  // Gatea tanto el ícono de la tarjeta como la sección de la pestaña Dieta.
  // Poder cargar ALGÚN turno implica ver toda la sección (espeja la semántica histórica en la
  // que `cargar_dieta` implicaba ver): quien pide almuerzo necesita ver qué hay en los demás.
  const canViewComanda = can(currentUser, 'ver_dieta') || canLoadAnyMealSlot(currentUser);

  // Color del aislamiento de una cama (el primer tipo activo define el color).
  const getIsolationColor = (bed: Bed) => {
    const primary = bed.isolations?.[0]?.color;
    return primary ? (ISOLATION_COLORS[primary] ?? DEFAULT_ISO_COLOR) : DEFAULT_ISO_COLOR;
  };

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
    if (CRITICAL_AREAS_NO_BLOCK.includes(bed.area)) return null;
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
  const [showFilters, setShowFilters] = useState(false); // colapsa los chips en mobile (desktop siempre visibles)
  const [financierFilters, setFinancierFilters] = useState<Set<string>>(new Set());
  const [financierSearch, setFinancierSearch] = useState('');

  const [physicianFilters, setPhysicianFilters] = useState<Set<string>>(new Set());
  const [physicianSearch, setPhysicianSearch] = useState('');

  const [dietTypeFilters, setDietTypeFilters] = useState<Set<string>>(new Set());
  const [dietTypeSearch, setDietTypeSearch]   = useState('');
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

  // Cantidad de filtros activos (chips) — feedback en el botón "Filtros" de mobile.
  const activeFilterCount =
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

  const toggleArea = (area: string) => {
    setAreaFilters((prev: Set<string>) => {
      const next = new Set(prev);
      next.has(area) ? next.delete(area) : next.add(area);
      return next;
    });
  };

  const toggleStatus = (status: string) => {
    setStatusFilters((prev: Set<string>) => {
      const next = new Set(prev);
      next.has(status) ? next.delete(status) : next.add(status);
      return next;
    });
  };

  // El "todos" del label es sobre los sectores PERMITIDOS: una azafata de Piso 8 con su
  // único sector tildado tiene que leer "Todos los sectores", no "1 sector".
  const areaFiltersVisibles = allowedAreas.filter(a => areaFilters.has(a)).length;
  const areaFilterLabel = areaFiltersVisibles === allowedAreas.length
    ? 'Todos los sectores'
    : areaFiltersVisibles === 0
      ? 'Ningún sector'
      : `${areaFiltersVisibles} sector${areaFiltersVisibles > 1 ? 'es' : ''}`;

  // Filter beds based on user role, assigned areas and search filters
  const filteredBeds = useMemo(() => {
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
    if (statusFilters.size > 0) {
      result = result.filter(bed => statusFilters.has(bed.status));
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

    return result;
  }, [beds, currentUser, searchFilter, areaFilters, statusFilters, allowedAreas, areaFiltersVisibles, bedTicketMap, showIsolatedOnly, isolatedBeds, showDietOnly, dietBeds, showFastingOnly, fastingBeds, showCirugiaOnly, cirugiaBeds, financierFilters, physicianFilters, dietTypeFilters, admissionTypeFilters, admissionFrom, admissionTo]);

  // Conteo de camas para el badge del header: excluimos HRA ("Sala de Espera"),
  // que son sillones de pre-internación y no camas reales. El grid y los PDFs
  // siguen mostrando HRA; solo el número del contador la deja afuera.
  const bedCount = useMemo(
    () => filteredBeds.filter(bed => bed.area !== Area.HRA).length,
    [filteredBeds],
  );

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

  // ── Status helpers ────────────────────────────────────────────────────────
  const getStatusColor = (status: BedStatus) => {
    switch (status) {
      case BedStatus.AVAILABLE:   return "bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200";
      case BedStatus.OCCUPIED:    return "bg-red-100 text-red-700 border-red-300 hover:bg-red-200";
      case BedStatus.PREPARATION: return "bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-200";
      case BedStatus.ASSIGNED:    return "bg-indigo-100 text-indigo-700 border-indigo-300 hover:bg-indigo-200";
      case BedStatus.DISABLED:    return "bg-slate-100 text-slate-500 border-slate-300 hover:bg-slate-200";
      default:                    return "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200";
    }
  };

  const getStatusDot = (status: BedStatus) => {
    switch (status) {
      case BedStatus.AVAILABLE:   return "bg-emerald-500";
      case BedStatus.OCCUPIED:    return "bg-red-500";
      case BedStatus.PREPARATION: return "bg-amber-500";
      case BedStatus.ASSIGNED:    return "bg-indigo-500";
      case BedStatus.DISABLED:    return "bg-slate-400";
      default:                    return "bg-slate-400";
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-2 md:p-3 space-y-2 md:space-y-4 max-w-[1600px] mx-auto w-full relative">
      {/* Filters bar */}
      <div className="flex flex-col gap-2 border-b border-slate-100 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search input */}
          <div className="relative flex-1 min-w-[180px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              placeholder="Paciente, evento, financiador, médico, habitación..."
              value={searchFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchFilter(e.target.value)}
              className="pl-9 h-9 text-xs rounded-xl border-slate-200"
            />
            {searchFilter && (
              <button onClick={() => setSearchFilter('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Area multi-select */}
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1.5 h-9 px-3 text-xs rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors min-w-[130px] md:min-w-[160px] justify-between">
                <span>{areaFilterLabel}</span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400 ml-1" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-52 p-2">
              <div className="flex flex-col gap-0.5">
                <label
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={areaFiltersVisibles === allowedAreas.length}
                    onChange={() => setAreaFilters(areaFiltersVisibles === allowedAreas.length ? new Set() : new Set(allowedAreas))}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 accent-emerald-700"
                  />
                  Todos los sectores
                </label>
                <div className="my-1 border-t border-slate-100" />
                {allowedAreas.map(area => (
                  <label
                    key={area}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={areaFilters.has(area)}
                      onChange={() => toggleArea(area)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 accent-emerald-700"
                    />
                    <span className="truncate">{AREA_LABELS[area] ?? area}</span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Bed count + actions */}
          <div className="flex items-center gap-1.5 ml-auto">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-50 border border-slate-100 text-[10px] md:text-xs font-black text-slate-500 uppercase tracking-wider">
              <BedDouble className="h-3 w-3 text-slate-400" />
              <span>{bedCount} camas</span>
            </div>

            {/* Mobile: toggle de filtros — colapsa los chips para no ocupar media pantalla.
                Muestra el conteo de filtros activos como feedback aunque esté cerrado. */}
            <button
              onClick={() => setShowFilters(v => !v)}
              aria-expanded={showFilters}
              className={cn(
                "md:hidden flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[10px] font-bold uppercase tracking-tight transition-all",
                activeFilterCount > 0 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              <ChevronDown className={cn("h-3 w-3 transition-transform", showFilters && "rotate-180")} />
            </button>

            {/* Desktop: acciones inline (sin cambios) */}
            <div className="hidden md:flex items-center gap-1.5">
              {onRefresh && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRefresh()}
                  disabled={bedsLoading}
                  title="Forzar actualización del mapa de camas"
                  className="h-8 rounded-lg border-slate-200 font-bold text-[10px] md:text-xs gap-1.5 px-3 hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw className={cn("h-3 w-3", bedsLoading && "animate-spin")} />
                  <span className="hidden sm:inline">Refrescar</span>
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={exportPDF} disabled={!!pdfExporting} title="PDF por sector" aria-label="Exportar PDF por sector" className="h-8 rounded-lg border-slate-200 font-bold text-[10px] md:text-xs gap-1.5 px-3 hover:bg-slate-50 disabled:opacity-50">
                {pdfExporting === 'normal' ? <span className="inline-block w-3 h-3 border-2 border-slate-200 border-t-emerald-500 rounded-full animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{pdfExporting === 'normal' ? `${pdfProgress.done}/${pdfProgress.total}` : 'PDF'}</span>
              </Button>
              <Button variant="outline" size="sm" onClick={exportPDFAlpha} disabled={!!pdfExporting} title="PDF alfabético por paciente" aria-label="Exportar PDF alfabético" className="h-8 rounded-lg border-slate-200 font-bold text-[10px] md:text-xs gap-1.5 px-3 hover:bg-slate-50 disabled:opacity-50">
                {pdfExporting === 'alpha' ? <span className="inline-block w-3 h-3 border-2 border-slate-200 border-t-emerald-500 rounded-full animate-spin" /> : <ArrowDownAZ className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{pdfExporting === 'alpha' ? `${pdfProgress.done}/${pdfProgress.total}` : 'PDF A-Z'}</span>
              </Button>
              <Button variant="outline" size="sm" onClick={exportPDFDietas} disabled={!!pdfExporting} title="PDF de dietas y ayunos" aria-label="Exportar PDF de dietas" className="h-8 rounded-lg border-slate-200 font-bold text-[10px] md:text-xs gap-1.5 px-3 hover:bg-slate-50 disabled:opacity-50">
                {pdfExporting === 'dietas' ? <span className="inline-block w-3 h-3 border-2 border-slate-200 border-t-emerald-500 rounded-full animate-spin" /> : <UtensilsCrossed className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{pdfExporting === 'dietas' ? `${pdfProgress.done}/${pdfProgress.total}` : 'Dietas'}</span>
              </Button>
            </div>

            {/* Mobile: acciones (refrescar + PDFs) en menú ⋯ para liberar la barra */}
            <Popover>
              <PopoverTrigger asChild>
                <button className="md:hidden flex items-center justify-center h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50" aria-label="Más acciones">
                  {pdfExporting ? <span className="inline-block w-3.5 h-3.5 border-2 border-slate-200 border-t-emerald-500 rounded-full animate-spin" /> : <MoreVertical className="h-4 w-4" />}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-1.5">
                <div className="flex flex-col gap-0.5">
                  {onRefresh && (
                    <button onClick={() => onRefresh()} disabled={bedsLoading} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                      <RefreshCw className={cn("h-4 w-4 text-slate-400", bedsLoading && "animate-spin")} /> Refrescar mapa
                    </button>
                  )}
                  <button onClick={exportPDF} disabled={!!pdfExporting} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                    <FileText className="h-4 w-4 text-slate-400" /> PDF por sector
                  </button>
                  <button onClick={exportPDFAlpha} disabled={!!pdfExporting} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                    <ArrowDownAZ className="h-4 w-4 text-slate-400" /> PDF alfabético (A-Z)
                  </button>
                  <button onClick={exportPDFDietas} disabled={!!pdfExporting} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                    <UtensilsCrossed className="h-4 w-4 text-slate-400" /> PDF dietas y ayunos
                  </button>
                  {!!pdfExporting && (
                    <div className="px-2.5 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Generando {pdfProgress.done}/{pdfProgress.total}…</div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Status multi-select buttons + filtros especiales.
            En mobile se colapsan detrás del botón "Filtros"; en desktop siempre visibles. */}
        <div className={cn("flex-wrap gap-1.5", showFilters ? "flex" : "hidden md:flex")}>
          {Object.values(BedStatus).map(s => {
            const dot = s === BedStatus.AVAILABLE ? 'bg-emerald-500' : s === BedStatus.OCCUPIED ? 'bg-red-500' : s === BedStatus.PREPARATION ? 'bg-amber-500' : s === BedStatus.ASSIGNED ? 'bg-indigo-500' : 'bg-slate-400';
            const active = statusFilters.has(s);
            return (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-all border",
                  active
                    ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                    : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                )}
              >
                <span className={cn("w-2 h-2 rounded-full", dot)} />
                {s}
              </button>
            );
          })}
          {isolatedBeds.size > 0 && (
            <button
              onClick={() => setShowIsolatedOnly(v => !v)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-all border",
                showIsolatedOnly
                  ? "bg-violet-600 text-white border-violet-600 shadow-sm"
                  : "bg-white text-violet-600 border-violet-200 hover:bg-violet-50"
              )}
            >
              <ShieldAlert className="w-3 h-3" />
              Aislamiento ({isolatedBeds.size})
            </button>
          )}
          {dietBeds.size > 0 && (
            <button
              onClick={() => setShowDietOnly(v => !v)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-all border",
                showDietOnly
                  ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                  : "bg-white text-emerald-600 border-emerald-200 hover:bg-emerald-50"
              )}
            >
              <UtensilsCrossed className="w-3 h-3" />
              Dietas ({dietBeds.size})
            </button>
          )}
          {fastingBeds.size > 0 && (
            <button
              onClick={() => setShowFastingOnly(v => !v)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-all border",
                showFastingOnly
                  ? "bg-amber-500 text-white border-amber-500 shadow-sm"
                  : "bg-white text-amber-600 border-amber-200 hover:bg-amber-50"
              )}
            >
              <Clock className="w-3 h-3" />
              Ayunos ({fastingBeds.size})
            </button>
          )}
          {cirugiaBeds.size > 0 && (
            <button
              onClick={() => setShowCirugiaOnly(v => !v)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-all border",
                showCirugiaOnly
                  ? "bg-cyan-600 text-white border-cyan-600 shadow-sm"
                  : "bg-white text-cyan-700 border-cyan-200 hover:bg-cyan-50"
              )}
            >
              <Activity className="w-3 h-3" />
              Cirugía ({cirugiaBeds.size})
            </button>
          )}

          {/* Financier filter */}
          {uniqueFinanciers.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-all border",
                  financierFilters.size > 0 ? "bg-slate-900 text-white border-slate-900 shadow-sm" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                )}>
                  <Search className="w-2.5 h-2.5" />
                  Financiador {financierFilters.size > 0 && `(${financierFilters.size})`}
                  <ChevronDown className="w-2.5 h-2.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2">
                <div className="flex items-center justify-between px-2 pb-2 border-b border-slate-100 mb-1">
                  <span className="text-[9px] font-bold uppercase text-slate-400">Financiadores</span>
                  {financierFilters.size > 0 && (
                    <button onClick={() => setFinancierFilters(new Set())} className="text-[9px] font-bold text-red-500">Limpiar</button>
                  )}
                </div>
                <div className="relative mb-1.5">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar financiador..."
                    value={financierSearch}
                    onChange={(e: any) => setFinancierSearch(e.target.value)}
                    className="w-full pl-7 pr-2 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-emerald-400"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {uniqueFinanciers.filter((f: string) => f.toLowerCase().includes(financierSearch.toLowerCase())).map((f: string) => (
                    <label key={f} className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition-colors",
                      financierFilters.has(f) ? "bg-emerald-50 text-emerald-800 font-bold" : "hover:bg-slate-50 text-slate-600"
                    )}>
                      <input type="checkbox" checked={financierFilters.has(f)} onChange={() => {
                        setFinancierFilters((prev: Set<string>) => { const next = new Set(prev); next.has(f) ? next.delete(f) : next.add(f); return next; });
                      }} className="accent-emerald-600 w-3.5 h-3.5" />
                      {f}
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* Physician filter */}
          {uniquePhysicians.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-all border",
                  physicianFilters.size > 0 ? "bg-slate-900 text-white border-slate-900 shadow-sm" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                )}>
                  <Search className="w-2.5 h-2.5" />
                  Profesional {physicianFilters.size > 0 && `(${physicianFilters.size})`}
                  <ChevronDown className="w-2.5 h-2.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2">
                <div className="flex items-center justify-between px-2 pb-2 border-b border-slate-100 mb-1">
                  <span className="text-[9px] font-bold uppercase text-slate-400">Profesionales</span>
                  {physicianFilters.size > 0 && (
                    <button onClick={() => setPhysicianFilters(new Set())} className="text-[9px] font-bold text-red-500">Limpiar</button>
                  )}
                </div>
                <div className="relative mb-1.5">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar profesional..."
                    value={physicianSearch}
                    onChange={(e: any) => setPhysicianSearch(e.target.value)}
                    className="w-full pl-7 pr-2 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-emerald-400"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {uniquePhysicians.filter((p: string) => p.toLowerCase().includes(physicianSearch.toLowerCase())).map((p: string) => (
                    <label key={p} className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition-colors",
                      physicianFilters.has(p) ? "bg-emerald-50 text-emerald-800 font-bold" : "hover:bg-slate-50 text-slate-600"
                    )}>
                      <input type="checkbox" checked={physicianFilters.has(p)} onChange={() => {
                        setPhysicianFilters((prev: Set<string>) => { const next = new Set(prev); next.has(p) ? next.delete(p) : next.add(p); return next; });
                      }} className="accent-emerald-600 w-3.5 h-3.5" />
                      {p}
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* Diet type filter */}
          {uniqueDietTypes.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-all border",
                  dietTypeFilters.size > 0 ? "bg-slate-900 text-white border-slate-900 shadow-sm" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                )}>
                  <Utensils className="w-2.5 h-2.5" />
                  Tipo de dieta {dietTypeFilters.size > 0 && `(${dietTypeFilters.size})`}
                  <ChevronDown className="w-2.5 h-2.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2">
                <div className="flex items-center justify-between px-2 pb-2 border-b border-slate-100 mb-1">
                  <span className="text-[9px] font-bold uppercase text-slate-400">Tipo de dieta</span>
                  {dietTypeFilters.size > 0 && (
                    <button onClick={() => setDietTypeFilters(new Set())} className="text-[9px] font-bold text-red-500">Limpiar</button>
                  )}
                </div>
                <div className="relative mb-1.5">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar tipo..."
                    value={dietTypeSearch}
                    onChange={(e: any) => setDietTypeSearch(e.target.value)}
                    className="w-full pl-7 pr-2 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-emerald-400"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {uniqueDietTypes.filter((d: string) => d.toLowerCase().includes(dietTypeSearch.toLowerCase())).map((d: string) => (
                    <label key={d} className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition-colors",
                      dietTypeFilters.has(d) ? "bg-emerald-50 text-emerald-800 font-bold" : "hover:bg-slate-50 text-slate-600"
                    )}>
                      <input type="checkbox" checked={dietTypeFilters.has(d)} onChange={() => {
                        setDietTypeFilters((prev: Set<string>) => { const next = new Set(prev); next.has(d) ? next.delete(d) : next.add(d); return next; });
                      }} className="accent-emerald-600 w-3.5 h-3.5" />
                      {d}
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* Filtro por tipo de internación (admissionType: Q/T/H/K/O/C — lo que pidió HPR) */}
          {uniqueAdmissionTypes.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-all border",
                  admissionTypeFilters.size > 0 ? "bg-slate-900 text-white border-slate-900 shadow-sm" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                )}>
                  <Activity className="w-2.5 h-2.5" />
                  Tipo internación {admissionTypeFilters.size > 0 && `(${admissionTypeFilters.size})`}
                  <ChevronDown className="w-2.5 h-2.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2">
                <div className="flex items-center justify-between px-2 pb-2 border-b border-slate-100 mb-1">
                  <span className="text-[9px] font-bold uppercase text-slate-400">Tipo de internación</span>
                  {admissionTypeFilters.size > 0 && (
                    <button onClick={() => setAdmissionTypeFilters(new Set())} className="text-[9px] font-bold text-red-500">Limpiar</button>
                  )}
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {uniqueAdmissionTypes.map((tp: string) => (
                    <label key={tp} className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition-colors",
                      admissionTypeFilters.has(tp) ? "bg-emerald-50 text-emerald-800 font-bold" : "hover:bg-slate-50 text-slate-600"
                    )}>
                      <input type="checkbox" checked={admissionTypeFilters.has(tp)} onChange={() => {
                        setAdmissionTypeFilters((prev: Set<string>) => { const next = new Set(prev); next.has(tp) ? next.delete(tp) : next.add(tp); return next; });
                      }} className="accent-emerald-600 w-3.5 h-3.5" />
                      {tp}
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* Filtro por FECHA DE INTERNACIÓN (bed.admissionDate) — date-picker propio; Dialog en mobile. */}
          <AdmissionDateFilter from={admissionFrom} to={admissionTo} setFrom={setAdmissionFrom} setTo={setAdmissionTo} />
        </div>
      </div>

      {/* Loading — first load: skeleton */}
      {bedsLoading && beds.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400">
          <div className="flex items-center gap-2">
            <svg className="animate-spin h-4 w-4 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span className="text-sm font-semibold tracking-wide">Cargando camas...</span>
          </div>
          <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-12 lg:grid-cols-16 xl:grid-cols-20 gap-1 md:gap-1.5 w-full opacity-40">
            {Array.from({ length: 40 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-lg bg-slate-100 animate-pulse" />
            ))}
          </div>
        </div>
      )}

      {/* Loading — refresh while data already exists */}
      {bedsLoading && beds.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 text-xs font-semibold w-fit">
          <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Actualizando camas...
        </div>
      )}

      {/* Error sin datos: antes el mapa quedaba en blanco. Cartel + código de debug + recargar. */}
      {bedsError && beds.length === 0 && !bedsLoading && (
        <div className="flex flex-col items-center justify-center gap-4 py-16 px-4 text-center">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-rose-50 border border-rose-100">
            <AlertTriangle className="w-7 h-7 text-rose-500" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-black text-slate-800">No se pudo cargar el mapa de camas</p>
            <p className="text-xs text-slate-500 max-w-sm">Hubo un problema al consultar la información a Progal. Reintentá; si el error persiste, pasá el código de abajo a soporte.</p>
          </div>
          <code className="text-[10px] font-mono text-slate-400 bg-slate-50 border border-slate-200 rounded-md px-2 py-1">debug: {bedsError}</code>
          {onRefresh && (
            <Button onClick={() => onRefresh()} disabled={bedsLoading} className="gap-2 rounded-xl">
              <RefreshCw className={cn("h-4 w-4", bedsLoading && "animate-spin")} />
              Recargar
            </Button>
          )}
        </div>
      )}

      {/* Error con datos previos: aviso discreto, sin tapar el mapa (sigue mostrando lo último). */}
      {bedsError && beds.length > 0 && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold">
          <span className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">No se pudo actualizar el mapa (mostrando últimos datos). <span className="font-mono opacity-70">debug: {bedsError}</span></span>
          </span>
          {onRefresh && (
            <button onClick={() => onRefresh()} disabled={bedsLoading} className="flex items-center gap-1.5 font-bold hover:underline disabled:opacity-50 shrink-0">
              <RefreshCw className={cn("h-3.5 w-3.5", bedsLoading && "animate-spin")} /> Reintentar
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 md:gap-4">
        {sortedAreaEntries.map(([areaName, areaBeds]) => (
          <div key={areaName} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-lg bg-slate-100/50 border border-slate-200 text-slate-600 font-bold px-2 py-0.5 text-xs">
                {AREA_LABELS[areaName] ?? areaName}
              </span>
              <div className="h-px flex-1 bg-slate-100" />
            </div>
            <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-12 lg:grid-cols-16 xl:grid-cols-20 gap-1 md:gap-1.5">
              {areaBeds.map(bed => {
                const shortCode = `${bed.roomCode}-${bed.bedCode}`;
                const isIsolated = isolatedBeds.has(bed.label);
                const isBlocked = blockedByIsolation.has(bed.label);
                const isPreventiveAdj = preventiveContactAdjacent.has(bed.label);
                const isoColor = isIsolated ? getIsolationColor(bed) : DEFAULT_ISO_COLOR;
                const isoTipos = isIsolated ? getIsolationTypes(bed) : [];
                const isMultiIso = isoTipos.length >= 2;
                const suggestedSex = suggestedSexFor(bed);

                return (
                  <button
                    key={bed.id}
                    onClick={() => setSelectedBed(bed)}
                    title={
                      bed.status === BedStatus.DISABLED && bed.disabledReason
                        ? `Inhabilitada — ${bed.disabledReason}`
                        : isMultiIso ? `Aislamientos: ${isoTipos.map(e => e.name).join(', ')}` : undefined
                    }
                    className={cn(
                      "relative flex flex-col items-center justify-center aspect-square rounded-lg border transition-all duration-200 overflow-hidden group",
                      isBlocked
                        ? "bg-violet-50 border-violet-300 opacity-60"
                        : isPreventiveAdj
                          ? PREVENTIVE_ADJ_CELL          // Contacto preventivo: color propio, NO inhabilitada
                          : getStatusColor(bed.status),
                      // Ring color = first isolation type (works for single AND multi cases).
                      isIsolated && `ring-2 ${isoColor.ring} ring-offset-1`
                    )}
                  >
                    <div className={cn("absolute top-1 right-1 w-1 h-1 md:w-1.5 md:h-1.5 rounded-full shadow-sm", isBlocked ? "bg-violet-400" : isPreventiveAdj ? PREVENTIVE_ADJ_DOT : getStatusDot(bed.status))} />
                    {isIsolated && (
                      <div className={cn("absolute top-0.5 left-0.5 w-3 h-3 md:w-3.5 md:h-3.5 rounded-full flex items-center justify-center", isoColor.bg)}>
                        <ShieldAlert className="w-2 h-2 md:w-2.5 md:h-2.5 text-white" strokeWidth={3} />
                      </div>
                    )}
                    {/* Multi-isolation tag: a tiny pill in the bottom-left corner with the count
                        and a thumbnail of the SECOND isolation color, so the user can tell at a glance
                        that the patient has more than one precaution active. */}
                    {isMultiIso && (
                      <div className="absolute bottom-0.5 left-0.5 flex items-center gap-0.5 px-1 h-3 md:h-3.5 rounded-full bg-slate-900 text-white text-[7px] md:text-[8px] font-black ring-1 ring-white shadow-sm">
                        <span className={cn("w-1.5 h-1.5 rounded-full", (ISOLATION_COLORS[isoTipos[1].color] ?? DEFAULT_ISO_COLOR).bg)} />
                        <span>{isoTipos.length}</span>
                      </div>
                    )}
                    {isBlocked && (
                      <div className="absolute top-0.5 left-0.5 w-3 h-3 md:w-3.5 md:h-3.5 bg-violet-400 rounded-full flex items-center justify-center">
                        <X className="w-2 h-2 md:w-2.5 md:h-2.5 text-white" strokeWidth={3} />
                      </div>
                    )}
                    {/* Contiguo a Contacto preventivo: marca de precaución (NO inhabilitada). */}
                    {isPreventiveAdj && (
                      <div className="absolute top-0.5 left-0.5 w-3 h-3 md:w-3.5 md:h-3.5 bg-cyan-400 rounded-full flex items-center justify-center" title="Contacto preventivo en la habitación">
                        <ShieldAlert className="w-2 h-2 md:w-2.5 md:h-2.5 text-white" strokeWidth={3} />
                      </div>
                    )}
                    {/* Esquina inf. derecha: platito = comanda cargada (sólo si puede verla) +
                        pill de ayuno. En flex para que no se pisen si el paciente tiene ambos. */}
                    {/* Pill Cx: operatoria de cirugía viva sobre esta cama. Color por estado
                        (listo=ámbar · en camino=naranja · en cirugía=cyan · volviendo=violeta).
                        `role: 'destino'` = cama destino en limbo (EN_DEVOLUCION con cambio de cama). */}
                    {bed.cirugia && (
                      <div
                        className={cn(
                          'absolute top-0.5 left-1/2 -translate-x-1/2 flex items-center gap-0.5 px-1 h-3 md:h-3.5 rounded-full ring-1 ring-white shadow-sm text-[7px] md:text-[8px] font-black uppercase z-10',
                          CIRUGIA_PILL_CLASS[bed.cirugia.estado],
                        )}
                        title={`Cirugía: ${CIRUGIA_ESTADO_LABEL[bed.cirugia.estado]}${bed.cirugia.role === 'destino' ? ' (cama destino)' : ''}`}
                      >
                        <Activity className="w-2 h-2 md:w-2.5 md:h-2.5" strokeWidth={3} />
                        <span>Cx</span>
                      </div>
                    )}
                    {/* Pre-Cx: marca "va a cirugía" de Admisión (flag) sobre un paciente SIN operatoria
                        viva. Estilo tenue/dashed para diferenciarlo de la pill Cx (cirugía en curso). */}
                    {bed.goingToSurgery && !bed.cirugia && (
                      <div
                        className="absolute top-0.5 left-1/2 -translate-x-1/2 flex items-center gap-0.5 px-1 h-3 md:h-3.5 rounded-full ring-1 ring-white shadow-sm text-[7px] md:text-[8px] font-black uppercase z-10 bg-violet-100 text-violet-700 border border-dashed border-violet-400"
                        title={`Marcado para cirugía por Admisión${bed.goingToSurgeryBy ? ` · ${bed.goingToSurgeryBy}` : ''}`}
                      >
                        <Activity className="w-2 h-2 md:w-2.5 md:h-2.5" strokeWidth={3} />
                        <span>Pre-Cx</span>
                      </div>
                    )}
                    {/* Limpieza de RUTINA en curso: badge celeste (spray). Esquina inf. izq.; si hay
                        multi-aislamiento (que también va ahí) se corre a la derecha para no pisarse. */}
                    {bed.routineCleaningActive && (
                      <div
                        className={cn(
                          'absolute bottom-0.5 w-3 h-3 md:w-3.5 md:h-3.5 rounded-full bg-sky-500 ring-1 ring-white shadow-sm flex items-center justify-center z-10',
                          isMultiIso ? 'left-5' : 'left-0.5',
                        )}
                        title={`Limpieza de rutina en curso${bed.routineCleaningBy ? ` · ${bed.routineCleaningBy}` : ''}`}
                      >
                        <SprayCan className="w-2 h-2 md:w-2.5 md:h-2.5 text-white" strokeWidth={2.5} />
                      </div>
                    )}
                    {((canViewComanda && hasAnyMealLoad(bed.meals)) || hasLiveFasting(bed.fasting) || suggestedSex) && (
                      <div className="absolute bottom-0.5 right-0.5 flex items-center gap-0.5">
                        {/* Sexo SUGERIDO para una cama libre, derivado de quién ocupa el resto de
                            la habitación. Es una sugerencia, NO un dato del paciente: por eso va
                            en outline (fondo blanco) y no en sólido como los indicadores duros. */}
                        {suggestedSex && (
                          <div
                            className={cn(
                              'flex items-center justify-center w-3.5 h-3.5 md:w-4 md:h-4 rounded-full bg-white ring-1 shadow-sm text-[8px] md:text-[9px] font-black leading-none',
                              suggestedSex === 'M' ? 'text-sky-600 ring-sky-400' : 'text-pink-600 ring-pink-400',
                            )}
                            title={`Sugerido: ${suggestedSex === 'M' ? 'masculino' : 'femenino'} — la habitación ya aloja ${suggestedSex === 'M' ? 'pacientes masculinos' : 'pacientes femeninos'}`}
                          >
                            {suggestedSex}
                          </div>
                        )}
                        {/* Tenedor de comanda, con el color según el estado:
                            · INDIGO (fuerte) = hay al menos una bandeja PENDIENTE de entregar → "hay algo para servir".
                            · VERDE apagado = había comanda pero YA se entregó todo → se sabe que se cargó, sin gritar acción.
                            Antes se mostraba indigo aunque estuviera todo entregado, y parecía que faltaba servir. */}
                        {canViewComanda && hasAnyMealLoad(bed.meals) && (() => {
                          const pendiente = hasPendingMealLoad(bed.meals);
                          return (
                            <div
                              className={cn(
                                'flex items-center justify-center w-3.5 h-3.5 md:w-4 md:h-4 rounded-full ring-1 ring-white shadow-sm',
                                pendiente ? 'bg-indigo-500 text-white' : 'bg-emerald-100 text-emerald-600',
                              )}
                              title={pendiente ? 'Comanda pendiente de entregar' : 'Comanda cargada — ya entregada'}
                            >
                              <Utensils className="w-2.5 h-2.5 md:w-3 md:h-3" strokeWidth={3} />
                            </div>
                          );
                        })()}
                        {hasLiveFasting(bed.fasting) && (
                          <div
                            className="flex items-center gap-0.5 px-1 h-3 md:h-3.5 rounded-full bg-amber-500 text-white text-[7px] md:text-[8px] font-black ring-1 ring-white shadow-sm"
                            title="Ayuno programado"
                          >
                            <UtensilsCrossed className="w-2 h-2 md:w-2.5 md:h-2.5" strokeWidth={3} />
                            <span>Ayuno</span>
                          </div>
                        )}
                      </div>
                    )}

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
                      {bed.status !== BedStatus.OCCUPIED && bedTicketMap.get(bed.label) && (
                        <span
                          className="text-[7px] md:text-[8px] font-bold italic truncate w-full text-center leading-none text-slate-600"
                          title={`Asignada a ${bedTicketMap.get(bed.label)!.patientName}`}
                        >
                          → {bedTicketMap.get(bed.label)!.patientName}
                        </span>
                      )}
                      {/* Cama reservada por una devolución de cirugía (no por un ticket): quién llega. */}
                      {bed.status !== BedStatus.OCCUPIED && !bedTicketMap.get(bed.label) && bed.cirugia?.role === 'destino' && bed.cirugia.pacienteNombre && (
                        <span
                          className="text-[7px] md:text-[8px] font-bold italic truncate w-full text-center leading-none text-violet-600"
                          title={`Llega de cirugía: ${bed.cirugia.pacienteNombre} (viene de ${formatBedName(bed.cirugia.camaOrigen)})`}
                        >
                          → {bed.cirugia.pacienteNombre}
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
        <DialogContent noPadding className="sm:max-w-[550px] rounded-3xl border-0 shadow-2xl max-h-[90vh] overflow-y-auto">
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
              <div className="min-w-0">
                {/* Header */}
                <div className={cn("px-6 py-5 flex items-center gap-4", t.headerBg)}>
                  <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm shrink-0", t.iconBg)}>
                    <BedDouble className={cn("w-6 h-6", t.icon)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-black tracking-tight text-slate-900 truncate">Hab. {selectedBed.roomCode} — Cama {selectedBed.bedCode}</h2>
                    <span className={cn("inline-flex items-center gap-1.5 mt-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest", t.pill)}>
                      <span className={cn("w-1.5 h-1.5 rounded-full", t.dot)} />
                      {selectedBed.status}
                    </span>
                  </div>
                </div>

                {/* Content */}
                <div className="p-5 space-y-3">

                  {/* Limpieza por azafata (Opción B): overlay sobre cama "En preparación".
                      Si ya está limpia → chip + Deshacer; si está en prep y la azafata tiene
                      el área → botón Marcar limpia. PROGAL es read-only: esto solo pisa la vista. */}
                  {(() => {
                    const areaOk = !currentUser?.filterByFloors
                      || !currentUser?.assignedAreas?.length
                      || currentUser.assignedAreas.includes(selectedBed.area);
                    const canClean = can(currentUser, 'confirmar_limpieza') && areaOk;
                    if (selectedBed.cleaned) {
                      const when = selectedBed.cleanedAt
                        ? new Date(selectedBed.cleanedAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
                        : '';
                      return (
                        <div className="bg-emerald-50 rounded-2xl p-3.5 border border-emerald-200 flex items-center gap-3">
                          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-black text-emerald-800 uppercase tracking-wide">Limpia ✓</p>
                            <p className="text-[11px] text-emerald-700 font-medium truncate">
                              {selectedBed.cleanedBy ? `Por ${selectedBed.cleanedBy}` : 'Marcada limpia'}{when ? ` · ${when}` : ''}
                            </p>
                          </div>
                          {canClean && onUndoClean && (
                            <Button variant="outline" size="sm" onClick={() => { onUndoClean(selectedBed.label); setSelectedBed(null); }}
                              className="h-8 px-3 text-[11px] font-bold rounded-lg border-emerald-200 text-emerald-700 hover:bg-emerald-100 shrink-0">
                              Deshacer
                            </Button>
                          )}
                        </div>
                      );
                    }
                    if (isPrep && canClean && onMarkClean) {
                      // Cama reservada como DESTINO de un traslado en curso: la marca de
                      // limpieza no aplica acá (el auto-cierre la anularía con motivo TICKET,
                      // y con razón — la limpieza previa al ingreso se informa con
                      // "Habitación Lista" desde Operativa). Antes el botón aparecía igual,
                      // se tocaba, y no pasaba nada: mejor decir por qué.
                      const reservadaPor = bedTicketMap.get(selectedBed.label);
                      if (reservadaPor) {
                        return (
                          <div className="bg-indigo-50 rounded-2xl p-3.5 border border-indigo-200 flex items-start gap-2.5">
                            <Info className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                            <p className="text-[11px] leading-snug font-medium text-indigo-800">
                              Reservada por un traslado en curso ({reservadaPor.patientName}). La limpieza
                              previa al ingreso se confirma con <strong>“Habitación Lista”</strong> desde
                              Operativa, no con la marca de limpieza.
                            </p>
                          </div>
                        );
                      }
                      return (
                        <button onClick={() => { onMarkClean(selectedBed); setSelectedBed(null); }}
                          className="w-full flex items-center justify-center gap-2 h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-widest active:scale-[0.98] transition-all shadow-sm">
                          <SprayCan className="w-4 h-4" /> Marcar habitación limpia
                        </button>
                      );
                    }
                    return null;
                  })()}

                  {/* Cirugía (feature Cx): alta "Listo para cirugía" (Enfermería, cama ocupada) o
                      pill + "Recibida" cuando el paciente vuelve. Ver CirugiaBedBlock. */}
                  {(onMarcarListo || onCirugiaEnTraslado || onCirugiaRecibida) && (
                    <CirugiaBedBlock
                      bed={cirugiaBed ?? selectedBed}
                      onMarcarListo={onMarcarListo}
                      onCirugiaEnTraslado={onCirugiaEnTraslado}
                      onCirugiaRecibida={onCirugiaRecibida}
                      onCirugiaTolerancia={onCirugiaTolerancia}
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
                      <div className="px-6 pb-4">
                        <div className={cn(
                          'flex items-start gap-2.5 px-3 py-2.5 rounded-xl border',
                          sug === 'M' ? 'bg-sky-50 border-sky-200' : 'bg-pink-50 border-pink-200',
                        )}>
                          <div className={cn(
                            'flex items-center justify-center w-6 h-6 rounded-full shrink-0 text-[11px] font-black bg-white ring-1',
                            sug === 'M' ? 'text-sky-600 ring-sky-400' : 'text-pink-600 ring-pink-400',
                          )}>{sug}</div>
                          <div className="min-w-0">
                            <p className={cn('text-[11px] font-bold', sug === 'M' ? 'text-sky-800' : 'text-pink-800')}>
                              Sugerido: {sug === 'M' ? 'masculino' : 'femenino'}
                            </p>
                            <p className={cn('text-[10px] leading-snug mt-0.5', sug === 'M' ? 'text-sky-700' : 'text-pink-700')}>
                              La habitación ya aloja {sug === 'M' ? 'pacientes masculinos' : 'pacientes femeninos'}. Es una sugerencia, no una restricción.
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* OCCUPIED — patient info organized in tabs */}
                  {isOccupied && (() => {
                    const spinner = <span className="inline-block w-4 h-4 border-2 border-slate-200 border-t-emerald-500 rounded-full animate-spin" />;
                    const fmtDate = (iso?: string) => {
                      if (!iso) return '—';
                      try {
                        const d = new Date(iso);
                        if (isNaN(d.getTime())) return iso;
                        return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
                      } catch { return iso; }
                    };
                    const fmtDateOnly = (iso?: string) => {
                      if (!iso) return '—';
                      try {
                        const d = new Date(iso);
                        if (isNaN(d.getTime())) return iso;
                        return d.toLocaleDateString('es-AR');
                      } catch { return iso; }
                    };
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
                        <div className={cn("rounded-2xl p-3.5 border", t.patientBg, t.patientBorder)}>
                          <div className="flex items-center gap-1.5 mb-1">
                            <UserIcon className={cn("w-3.5 h-3.5", t.label)} />
                            <span className={cn("text-[9px] font-bold uppercase tracking-widest", t.label)}>Paciente</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-base font-black text-slate-900 leading-snug min-w-0 truncate">{selectedBed.patientName}</p>
                            {selectedBed.patientName && (
                              patientTicketsLoading ? (
                                <span className="shrink-0 text-[10px] font-medium text-slate-400 whitespace-nowrap">Cargando…</span>
                              ) : patientTickets.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setJourneyOpen(true)}
                                  className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap hover:bg-slate-50 transition-colors"
                                >
                                  <History className="w-3 h-3" />
                                  Historial del paciente
                                </button>
                              ) : patientTicketsLoaded ? (
                                <span className="shrink-0 text-[10px] font-medium text-slate-400 italic whitespace-nowrap">Sin traslados</span>
                              ) : null
                            )}
                          </div>
                        </div>

                        {/* Tab bar — scrolleable en X para que en mobile los 4 tabs no
                            desborden el fondo gris (cada tab mantiene su ancho). */}
                        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 overflow-x-auto">
                          {tabs.map(tab => {
                            const isActive = tab.key === activeTab;
                            return (
                              <button
                                key={tab.key}
                                type="button"
                                onClick={() => setDetailTab(tab.key)}
                                className={cn(
                                  "shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest whitespace-nowrap transition-all",
                                  isActive
                                    ? "bg-white text-emerald-900 shadow-sm"
                                    : "text-slate-500 hover:text-slate-700"
                                )}
                              >
                                {tab.label}
                              </button>
                            );
                          })}
                        </div>

                        {/* Tab: Generales */}
                        {activeTab === 'general' && (
                          <>
                            <div className="grid grid-cols-6 gap-2.5">
                              <div className="col-span-2 bg-slate-50 rounded-xl p-3 border border-slate-100">
                                <p className="text-[8px] font-bold uppercase text-slate-400 mb-1">DNI</p>
                                <p className="text-sm font-mono font-bold text-slate-700">{enrichLoading ? spinner : (displayBed?.dni || '—')}</p>
                              </div>
                              <div className="col-span-1 bg-slate-50 rounded-xl p-3 border border-slate-100">
                                <p className="text-[8px] font-bold uppercase text-slate-400 mb-1">Edad</p>
                                <p className="text-sm font-bold text-slate-700">{enrichLoading ? spinner : (displayBed?.age != null ? `${displayBed.age}` : '—')}</p>
                              </div>
                              <div className="col-span-1 bg-slate-50 rounded-xl p-3 border border-slate-100">
                                <p className="text-[8px] font-bold uppercase text-slate-400 mb-1">Sexo</p>
                                <p className="text-sm font-bold text-slate-700">{enrichLoading ? spinner : (displayBed?.sex === 'M' ? 'M' : displayBed?.sex === 'F' ? 'F' : '—')}</p>
                              </div>
                              <div className="col-span-2 bg-slate-50 rounded-xl p-3 border border-slate-100">
                                <p className="text-[8px] font-bold uppercase text-slate-400 mb-1">Evento</p>
                                <p className="text-sm font-mono font-bold text-slate-700 whitespace-nowrap">
                                  {selectedBed.eventOrigin && selectedBed.eventNumber
                                    ? `${selectedBed.eventOrigin}-${selectedBed.eventNumber}`
                                    : '—'}
                                </p>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2.5">
                              <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                                <p className="text-[8px] font-bold uppercase text-slate-400 mb-1">Financiador</p>
                                <p className="text-sm font-semibold text-slate-700">{enrichLoading ? spinner : (displayBed?.institution || '—')}</p>
                                {(displayBed?.medicalPlan || displayBed?.medicalPlanCode || displayBed?.medicalPlanDescription) && (
                                  <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">
                                    Plan: {displayBed?.medicalPlan ?? displayBed?.medicalPlanCode}
                                    {displayBed?.medicalPlanDescription && ` · ${displayBed.medicalPlanDescription}`}
                                  </p>
                                )}
                              </div>
                              <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                                <p className="text-[8px] font-bold uppercase text-slate-400 mb-1">ID Paciente</p>
                                <p className="text-sm font-mono font-bold text-slate-700">{selectedBed.patientCode || '—'}</p>
                              </div>
                            </div>

                            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                              <p className="text-[8px] font-bold uppercase text-slate-400 mb-1">Profesional</p>
                              <p className="text-sm font-semibold text-slate-700">{enrichLoading ? spinner : (displayBed?.prescribingPhysician || displayBed?.attendingPhysician || '—')}</p>
                            </div>

                            {(displayBed?.diagnosis || enrichLoading) && (
                              <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                                <p className="text-[8px] font-bold uppercase text-slate-400 mb-1">Diagnóstico</p>
                                <p className="text-sm font-semibold text-slate-700">{enrichLoading ? spinner : displayBed?.diagnosis}</p>
                              </div>
                            )}
                          </>
                        )}

                        {/* Tab: Internación */}
                        {activeTab === 'internacion' && (
                          <>
                            <div className="grid grid-cols-3 gap-2.5">
                              <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                                <p className="text-[8px] font-bold uppercase text-slate-400 mb-1">Tipo</p>
                                <p className="text-sm font-bold text-slate-700">
                                  {enrichLoading
                                    ? spinner
                                    : (displayBed?.admissionType
                                        ? <><span>{displayBed.admissionType}</span>{displayBed.admissionTypeCode && <span className="text-[10px] font-mono text-slate-400 ml-1">({displayBed.admissionTypeCode})</span>}</>
                                        : '—')}
                                </p>
                              </div>
                              <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                                <p className="text-[8px] font-bold uppercase text-slate-400 mb-1">Ingreso</p>
                                <p className="text-sm font-semibold text-slate-700">{enrichLoading ? spinner : fmtDate(displayBed?.admissionDate)}</p>
                                {stayDays != null && stayDays > 0 && !enrichLoading && (
                                  <p className="text-[10px] text-slate-400 mt-0.5">hace {stayDays} día{stayDays === 1 ? '' : 's'}</p>
                                )}
                              </div>
                              <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                                <p className="text-[8px] font-bold uppercase text-slate-400 mb-1">Días Autorizados</p>
                                <p className="text-sm font-bold text-slate-700">
                                  {enrichLoading
                                    ? spinner
                                    : (displayBed?.authorizedDays != null ? displayBed.authorizedDays : '—')}
                                </p>
                                {displayBed?.authorizedDays != null && stayDays != null && !enrichLoading && (
                                  <p className={cn("text-[10px] mt-0.5 font-semibold",
                                    stayDays > displayBed.authorizedDays ? "text-red-600" :
                                    stayDays >= displayBed.authorizedDays ? "text-amber-600" : "text-slate-400")}>
                                    {stayDays > displayBed.authorizedDays
                                      ? `Excede ${stayDays - displayBed.authorizedDays}`
                                      : `${displayBed.authorizedDays - stayDays} restantes`}
                                  </p>
                                )}
                              </div>
                            </div>
                            {displayBed?.expectedSurgeryDate && (
                              <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                                <p className="text-[8px] font-bold uppercase text-blue-500 mb-1">Fecha Probable de Cirugía</p>
                                <p className="text-sm font-bold text-blue-900">{fmtDateOnly(displayBed.expectedSurgeryDate)}</p>
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
                                onMarcar={onMarcarVaCirugia} onDesmarcar={onDesmarcarVaCirugia} />
                            )}
                            {!enrichLoading && !hasInternacionData && (
                              <p className="text-xs text-slate-400 italic text-center py-2">Sin datos de internación disponibles</p>
                            )}
                          </>
                        )}

                        {/* Tab: Dieta */}
                        {activeTab === 'dieta' && (
                          <>
                            {/* Dieta del paciente PRIMERO (tipo + condiciones + formulario) para que
                                Nutrición sepa qué dieta tiene ANTES de cargar el menú (abajo). */}
                            {displayBed?.dietTags && displayBed.dietTags.length > 0 && (
                              <div className="bg-emerald-50/60 rounded-xl p-3 border border-emerald-100">
                                <p className="text-[8px] font-bold uppercase text-emerald-700 mb-2">Condiciones y Tipo</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {displayBed.dietTags.map(tag => (
                                    <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded-full bg-white border border-emerald-300 text-[10px] font-bold text-emerald-800">
                                      {tag}
                                    </span>
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
                                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                                      <p className="text-[8px] font-bold uppercase text-slate-400 mb-2">Formulario completo</p>
                                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                                        {shortDiets.map((d, idx) => {
                                          const resp = (d.respuesta ?? '').trim();
                                          const isNo = resp.toLowerCase() === 'no';
                                          return (
                                            <div key={idx} className="flex items-center justify-between gap-2 text-[11px] min-w-0">
                                              <span className="text-slate-500 truncate">{d.descripcion}</span>
                                              <span className={cn(
                                                "font-bold shrink-0",
                                                isNo ? "text-slate-400" : "text-emerald-700"
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
                                    <div className="bg-amber-50/40 rounded-xl p-3 border border-amber-100 space-y-2">
                                      <p className="text-[8px] font-bold uppercase text-amber-700">Notas</p>
                                      {longDiets.map((d, idx) => (
                                        <div key={idx} className="space-y-0.5">
                                          <p className="text-[10px] font-semibold uppercase text-slate-500">{d.descripcion}</p>
                                          <p className="text-[11px] text-slate-800 break-words whitespace-pre-wrap leading-snug">
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
                              <p className="text-xs text-slate-400 italic text-center py-2">Sin datos de dieta disponibles</p>
                            )}
                            {enrichLoading && (
                              <p className="text-xs text-slate-400 italic text-center py-2">Cargando...</p>
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
                                <div className="rounded-xl p-3 border border-indigo-100 bg-indigo-50/40 space-y-2">
                                  <div className="flex items-center gap-1.5">
                                    <UtensilsCrossed className="w-3.5 h-3.5 text-indigo-500" />
                                    <p className="text-[8px] font-bold uppercase text-indigo-700 tracking-widest">Menú{canEditAny ? ' — Nutrición' : ''}</p>
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
                                  <div key={ind.indicationId} className="bg-amber-50/60 rounded-xl p-3 border border-amber-100">
                                    <div className="flex items-center justify-between mb-1.5">
                                      <p className="text-[8px] font-bold uppercase text-amber-700">Indicación #{ind.indicationId}</p>
                                      <span className="text-[10px] font-bold text-amber-800">
                                        {occ.length} ayuno{occ.length === 1 ? '' : 's'}
                                      </span>
                                    </div>
                                    <ul className="space-y-0.5">
                                      {occ.map((iso, idx) => (
                                        <li key={idx} className="text-[11px] text-slate-700">
                                          {formatFastingDateTime(iso)}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ))}
                              </div>
                            )}
                            {!enrichLoading && !hasFastingData && (
                              <p className="text-xs text-slate-400 italic text-center py-2">Sin ayunos vigentes</p>
                            )}
                            {enrichLoading && (
                              <p className="text-xs text-slate-400 italic text-center py-2">Cargando...</p>
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
                        <div className="bg-indigo-50 rounded-xl p-3 border border-indigo-100 flex items-center gap-2">
                          <Info className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                          <p className="text-xs font-bold text-indigo-800">Reservada — traslado en curso</p>
                        </div>
                        {assignedTicket && (
                          <>
                            <div className={cn("rounded-xl p-3 border", t.patientBg, t.patientBorder)}>
                              <span className={cn("text-[8px] font-bold uppercase", t.label)}>Paciente en traslado</span>
                              <p className="text-sm font-black text-slate-900">{assignedTicket.patientName}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-100">
                                <p className="text-[8px] font-bold uppercase text-slate-400 mb-0.5">Origen</p>
                                <p className="text-xs font-bold text-slate-700 truncate">{assignedTicket.origin}</p>
                              </div>
                              <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-100">
                                <p className="text-[8px] font-bold uppercase text-slate-400 mb-0.5">Estado</p>
                                <p className="text-xs font-bold text-slate-700">{assignedTicket.status}</p>
                              </div>
                            </div>
                          </>
                        )}
                      </>
                    );
                  })()}

                  {isAvailable && (
                    <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100 flex items-center justify-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <p className="text-xs font-semibold text-emerald-700">Lista para recibir paciente</p>
                    </div>
                  )}

                  {isPrep && (
                    <div className="bg-amber-50 rounded-xl p-3 border border-amber-100 flex items-center gap-2">
                      <Info className="w-4 h-4 text-amber-400 flex-shrink-0" />
                      <p className="text-xs font-semibold text-amber-700">En preparación para nuevo ingreso</p>
                    </div>
                  )}

                  {isDisabled && (
                    <div className="bg-slate-100 rounded-xl p-3 border border-slate-200 flex items-center justify-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                      <p className="text-xs font-semibold text-slate-500">Fuera de servicio</p>
                    </div>
                  )}

                  {isDisabled && selectedBed.disabledReason && (
                    <div className="bg-amber-50 rounded-xl p-3 border border-amber-200 flex items-start gap-2">
                      <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-[8px] font-bold uppercase text-amber-700 mb-0.5 tracking-wide">Motivo de Inhabilitación</p>
                        <p className="text-sm font-medium text-amber-900 leading-snug break-words">{selectedBed.disabledReason}</p>
                      </div>
                    </div>
                  )}

                  {/* Aislamiento (PROGAL — solo lectura). Tipos + observaciones del evento.
                      Usa displayBed (= enrichedBed ?? selectedBed) para mostrarlos también
                      cuando la cama todavía no fue procesada por el cron y se enriquece on-demand. */}
                  {displayBed?.isolations && displayBed.isolations.length > 0 && (() => {
                    const bed = displayBed!;
                    const isoC = getIsolationColor(bed);
                    const tipos = bed.isolations!;
                    const plural = tipos.length > 1;
                    // Si TODOS los aislamientos son Contacto preventivo, las camas contiguas
                    // no se bloquean (solo se señalizan). Sino, la habitación queda bloqueada.
                    const onlyPreventive = isPreventiveOnlyBed(bed);
                    return (
                      <div className="rounded-2xl p-3.5 border border-slate-200 bg-slate-50 space-y-2.5">
                        <div className="flex items-start gap-3">
                          <span className={cn("w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5", isoC.bg)}>
                            <ShieldAlert className="w-3 h-3 text-white" strokeWidth={3} />
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-slate-700">Aislamiento{plural ? 's' : ''} activo{plural ? 's' : ''}</p>
                            <p className="text-[10px] text-slate-400">{onlyPreventive ? 'Camas contiguas señalizadas (no bloqueadas)' : 'Camas de la habitación bloqueadas'}</p>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          {tipos.map((iso, i) => {
                            const c = ISOLATION_COLORS[iso.color] ?? DEFAULT_ISO_COLOR;
                            return (
                              <div key={`${iso.name}-${i}`} className="flex flex-wrap items-center gap-1.5">
                                <span className={cn("inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold", c.pill)}>
                                  <span className={cn("w-2 h-2 rounded-full", c.dot)} />
                                  {iso.name}
                                </span>
                                {iso.observation && (
                                  <span className="text-[11px] text-slate-600 italic break-words">— {iso.observation}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                  {blockedByIsolation.has(selectedBed.label) && (
                    <div className="bg-violet-50 rounded-2xl p-3.5 border border-violet-200 flex items-center gap-3">
                      <ShieldAlert className="w-5 h-5 text-violet-400 flex-shrink-0" />
                      <p className="text-xs font-bold text-violet-700">Bloqueada — paciente aislado en esta habitación</p>
                    </div>
                  )}
                  {preventiveContactAdjacent.has(selectedBed.label) && (
                    <div className="bg-cyan-50 rounded-2xl p-3.5 border border-cyan-200 flex items-center gap-3">
                      <ShieldAlert className="w-5 h-5 text-cyan-500 flex-shrink-0" />
                      <p className="text-xs font-bold text-cyan-700">Contacto preventivo en esta habitación — cama habilitada, usar con precaución</p>
                    </div>
                  )}

                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Trayectoria del paciente — hermano del detalle de cama: se apila encima y al
          cerrar vuelve al detalle (no cerramos selectedBed al abrirlo). */}
      <PatientJourney
        patientTickets={patientTickets}
        isOpen={journeyOpen}
        onClose={() => setJourneyOpen(false)}
        workflowLabels={WORKFLOW_LABELS}
      />
    </div>
  );
};
