
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { Bed, Ticket, BedStatus } from "../types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Devuelve true si el `area` corresponde a Internación Transitoria HPR (ITR).
 *
 * Comparación tolerante: el string que envía Gamma puede variar en tildes,
 * mayúsculas o espaciado respecto al enum `Area.HIT` ("Internación Transitoria HPR").
 * Matchear por substring "transitoria" (normalizado) cubre cualquier variante razonable.
 */
export function isHitArea(area?: string | null): boolean {
  if (!area) return false;
  const normalized = area.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return normalized.includes('transitoria');
}

/**
 * Devuelve true si el `area` corresponde a la sala de espera de Recepción Admisión (HRA).
 * Tolerante a variaciones de string (tildes, casing) que pueda enviar Gamma. Matchea por
 * substring "recepcion" + "admision" (sustantivos clave del nombre del sector).
 */
export function isHraArea(area?: string | null): boolean {
  if (!area) return false;
  const normalized = area.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return normalized.includes('recepcion') && normalized.includes('admision');
}

/**
 * Áreas "efectivas" de un traslado a los fines del matching de azafatas.
 *
 * Regla: la Sala de Espera (HRA) NO discrimina — todas las azafatas la tienen en
 * sus pisos, así que matchear por HRA notificaría/habilitaría a todas. Cuando un
 * extremo es HRA y el otro es un piso real, el extremo HRA se remapea al piso real:
 * la azafata de ese piso pasa a ser dueña de origen Y destino del traslado.
 *
 *   HRA → Piso 7   ⇒ { origin: Piso 7, dest: Piso 7 }  (solo azafata Piso 7)
 *   Piso 5 → Piso 7 ⇒ { origin: Piso 5, dest: Piso 7 }  (cada una su etapa)
 *   Piso 5 → HRA   ⇒ { origin: Piso 5, dest: Piso 5 }
 *
 * Si ambos extremos son HRA (caso raro) se dejan tal cual.
 */
export function effectiveHostessAreas<T extends string | null | undefined>(
  originArea: T,
  destinationArea: T,
): { origin: T; dest: T } {
  const remap = (self: T, other: T): T =>
    isHraArea(self) && other && !isHraArea(other) ? other : self;
  return {
    origin: remap(originArea, destinationArea),
    dest: remap(destinationArea, originArea),
  };
}

/**
 * Formatea una fecha ISO (YYYY-MM-DD o full ISO datetime) a formato legible
 */
export function formatDateReadable(isoDate: string | undefined): string {
  if (!isoDate) return "---";
  try {
    // Parse as local date to avoid UTC offset issues (e.g. "2026-03-01" → Mar 1, not Feb 28)
    const parts = isoDate.slice(0, 10).split('-').map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    if (isNaN(date.getTime())) return isoDate;
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit'
    }).format(date);
  } catch {
    return isoDate;
  }
}

/**
 * Formatea una fecha ISO completa a "DD/MM/YY HH:mm"
 */
export function formatDateTime(isoDate: string | undefined): string {
  if (!isoDate) return "---";
  try {
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) return isoDate;
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return isoDate;
  }
}

/**
 * Formatea solo la hora de un ISO datetime a "HH:mm"
 */
export function formatTime(isoDate: string | undefined): string {
  if (!isoDate) return "---";
  try {
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) return isoDate;
    return new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return isoDate;
  }
}

/**
 * Convierte un string de hora (HH:mm o HH:mm AM/PM) a minutos totales desde las 00:00
 */
export function parseTimeToMinutes(timeStr: string | undefined): number {
  if (!timeStr) return 0;
  
  const normalized = timeStr.toLowerCase().replace(/\./g, '').trim();
  const isPM = normalized.includes('pm') || normalized.includes('p m');
  const isAM = normalized.includes('am') || normalized.includes('a m');
  
  const digits = normalized.match(/\d+/g);
  if (!digits || digits.length < 2) return 0;
  
  let hours = parseInt(digits[0], 10);
  const minutes = parseInt(digits[1], 10);
  
  if (isPM && hours < 12) hours += 12;
  if (isAM && hours === 12) hours = 0;
  
  return hours * 60 + minutes;
}

/**
 * Calcula la diferencia en minutos entre dos strings de fecha/hora.
 * Soporta ISO strings (2026-03-20T15:53:00Z) y strings de hora (03:53 p. m.)
 */
export function getMinutesBetween(start: string | undefined, end: string | undefined): number {
  if (!start || !end) return 0;

  // Try ISO / parseable date strings first
  const d1 = new Date(start).getTime();
  const d2 = new Date(end).getTime();
  if (!isNaN(d1) && !isNaN(d2)) {
    return Math.max(0, Math.round((d2 - d1) / 60000));
  }

  // Fallback: parse as time-only strings (HH:mm AM/PM)
  const t1 = parseTimeToMinutes(start);
  const t2 = parseTimeToMinutes(end);

  if (t1 === 0 && t2 === 0) return 0;

  let diff = t2 - t1;
  if (diff < 0) diff += 1440;

  return diff;
}

/**
 * Calcula métricas de tiempos operativos para un ticket
 * Centraliza la lógica de negocio para auditoría y reportes
 */
export function calculateTicketMetrics(ticket: Ticket) {
  const totalCycleTime = getMinutesBetween(ticket.createdAt, ticket.completedAt);
  
  // En este flujo, la asignación es inmediata al crear el ticket, por lo que suele ser 0.
  const waitAdmission = getMinutesBetween(ticket.createdAt, ticket.bedAssignedAt || ticket.createdAt);
  
  // Tiempo de Higiene: Desde asignación hasta que está limpia. Si ya estaba limpia, es 0.
  const cleaningTime = ticket.cleaningDoneAt 
    ? getMinutesBetween(ticket.bedAssignedAt, ticket.cleaningDoneAt) 
    : 0;

  // Tiempo de Traslado:
  // Escenario Sucia: Desde inicio de transporte hasta confirmación de recepción.
  // Escenario Limpia: Desde asignación (o creación) hasta recepción (ya que no hay paso intermedio explícito de "inicio transporte").
  let transportTime = 0;
  if (ticket.transportStartedAt && ticket.receptionConfirmedAt) {
     transportTime = getMinutesBetween(ticket.transportStartedAt, ticket.receptionConfirmedAt);
  } else if (ticket.receptionConfirmedAt) {
     // Fallback para cama limpia donde no hubo "inicio transporte" explícito
     const start = ticket.cleaningDoneAt || ticket.bedAssignedAt || ticket.createdAt;
     transportTime = getMinutesBetween(start, ticket.receptionConfirmedAt);
  }

  // Tiempo Administrativo: Desde recepción hasta consolidación
  const adminTime = ticket.receptionConfirmedAt 
    ? getMinutesBetween(ticket.receptionConfirmedAt, ticket.completedAt)
    : 0;

  return {
    totalCycleTime,
    waitAdmission,
    cleaningTime,
    transportTime,
    adminTime
  };
}

/**
 * Lock de re-entrancia por clave para acciones asíncronas — anti doble-click.
 *
 * Mientras una acción con la misma `key` está en vuelo, las siguientes con esa key se
 * ignoran (el `run` devuelve sin ejecutar `fn`). Es SINCRÓNICO (Set en memoria): un 2º
 * disparo en el mismo tick ve el lock en el acto, cosa que un guard por estado de React
 * NO logra (setState es async → el 2º click lee el estado viejo y también dispara). Se
 * libera cuando la promesa de `fn` settlea (éxito o error). Ver useHospitalState: los
 * handlers de transición de ticket (Habitación Lista, Iniciar Traslado, etc.) lo usan
 * para que una azafata apurada no genere eventos duplicados en la trayectoria.
 */
export function createActionLock() {
  const inFlight = new Set<string>();
  return async function run(key: string, fn: () => Promise<void>): Promise<void> {
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try { await fn(); }
    finally { inFlight.delete(key); }
  };
}

/**
 * Warning NO bloqueante para creación de tickets: ¿la habitación destino ya aloja
 * pacientes del sexo OPUESTO al que se traslada? Habitación = mismo roomCode + area
 * (mismo criterio con que BedsView agrupa cuartos). `sex` viene del enrich de PROGAL;
 * si falta en el origen o en un ocupante, ese lado no cuenta (best-effort, nunca bloquea).
 * Se excluye la propia cama destino. Devuelve el sexo del paciente + las camas en conflicto,
 * o null si no hay incompatibilidad detectable.
 */
export function roomSexConflict(
  beds: Bed[],
  originLabel: string,
  destLabel: string,
): { patientSex: 'M' | 'F'; roommates: Bed[] } | null {
  const patientSex = beds.find(b => b.label === originLabel)?.sex;
  const destBed = beds.find(b => b.label === destLabel);
  if (!patientSex || !destBed?.roomCode) return null;
  const roommates = beds.filter(b =>
    b.label !== destBed.label &&
    b.roomCode === destBed.roomCode &&
    b.area === destBed.area &&
    !!b.patientName && !!b.sex && b.sex !== patientSex,
  );
  return roommates.length ? { patientSex, roommates } : null;
}

/**
 * Sexo al que está COMPROMETIDA cada habitación por sus ocupantes actuales.
 *
 * Inverso de `roomSexConflict`: en vez de avisar del conflicto al mover un paciente concreto,
 * adelanta a qué sexo conviene destinar las camas LIBRES del cuarto.
 * Habitación = mismo `roomCode` + misma `area` (mismo criterio que `roomSexConflict`).
 *
 * ⚠️ Ocupante = `status === OCCUPIED` con `sex` conocido. **NO se usa `patientName`**: en este
 * repo queda residual en camas ya liberadas — `mergeBeds` pasa una cama de PREPARATION a
 * AVAILABLE sin limpiar el paciente, `api/beds.ts` documenta residuos del array general, y
 * `reapplyEnrichFromMap` reaplica el enrich (que incluye `sex`) mirando solo `patientCode`, sin
 * chequear el status. Con `patientName`, un paciente fantasma comprometería una habitación vacía
 * y sugeriría el sexo equivocado. `status === OCCUPIED` es el criterio que usa el resto de BedsView.
 *
 * Efecto buscado: una cama ASSIGNED (traslado en curso) NUNCA compromete la habitación, en
 * ninguna fase del ticket — si no, la misma situación clínica daría sugerencias distintas según
 * el estado del traslado.
 *
 * Devuelve por HABITACIÓN, no por cama: a quién se le muestra la sugerencia lo decide la vista.
 * Best-effort: `sex` viene del enrich (cron cada 15 min) y puede faltar → sin sugerencia, sin ruido.
 *
 * Pasar la lista COMPLETA de camas, nunca la filtrada: si un filtro de la vista esconde al
 * ocupante, la sugerencia desaparecería sin explicación.
 */
export function suggestedRoomSex(beds: Bed[]): Map<string, 'M' | 'F'> {
  const rooms = new Map<string, Set<'M' | 'F'>>();
  for (const b of beds) {
    if (!b.roomCode || b.status !== BedStatus.OCCUPIED || !b.sex) continue;
    const key = `${b.area}|${b.roomCode}`;
    if (!rooms.has(key)) rooms.set(key, new Set());
    rooms.get(key)!.add(b.sex);
  }
  const out = new Map<string, 'M' | 'F'>();
  for (const [key, sexes] of rooms) {
    // Sexos mixtos en la misma habitación (dato sucio o cuarto mixto real) → silencio.
    // Una sugerencia ambigua es peor que ninguna.
    if (sexes.size === 1) out.set(key, [...sexes][0]);
  }
  return out;
}

// Dietas terapéuticas donde NO hay un "Menú"/"Opción" estándar de cocina: Nutrición debe
// ESCRIBIR la comida específica en el detalle de comanda (el tipo se fija en "Otros"). Match por
// substring normalizado (tolera tildes/casing de PROGAL). Ajustar la lista si cambia el criterio.
const CUSTOM_COMANDA_DIETS = [
  'liviana', 'liquida', 'liquido', 'espesad', 'astringente', 'blanda', 'blanca',
  'hepatica', 'hiperproteica', 'fibras', 'inmunodeprimid', 'nada x boca', 'nada por boca',
];
export function dietRequiresCustomComanda(dietType?: string | null): boolean {
  if (!dietType) return false;
  const n = dietType.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return CUSTOM_COMANDA_DIETS.some(d => n.includes(d));
}

/**
 * Formatea el nombre de la cama para que sea más corto en la vista desktop
 * Ejemplo: "Habitación 409 HPR - Cama 02" -> "409 - 02"
 */
export function formatBedName(bedName: string | undefined): string {
  if (!bedName) return '';
  const match = bedName.match(/Habitaci[oó]n\s+([A-Za-z0-9]+)(?:\s+HPR)?\s*-\s*Cama\s+([A-Za-z0-9]+)/i);
  if (match) {
    return `${match[1]} - ${match[2]}`;
  }
  return bedName;
}

/**
 * Normaliza texto para búsquedas: minúsculas, sin diacríticos, espacios colapsados.
 *
 * PROGAL manda nombres con tildes y mayúsculas inconsistentes ("MARÍA JOSÉ" / "Maria jose"),
 * así que comparar crudo no sirve.
 *
 * El rango de diacríticos va ESCAPADO (`̀-ͯ`) y no con caracteres combinantes
 * literales como en el resto del repo: este helper es al que van a apuntar los ~7 call-sites
 * que hoy duplican el idiom, y un copy-paste roto acá sería invisible.
 */
export function normalizeText(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
