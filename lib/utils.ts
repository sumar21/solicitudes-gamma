
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { Ticket } from "../types"

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
