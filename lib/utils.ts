
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { Ticket } from "../types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formatea una fecha ISO (YYYY-MM-DD) a un formato legible local (DD/MM/YY)
 */
export function formatDateReadable(isoDate: string | undefined): string {
  if (!isoDate) return "---";
  try {
    const [year, month, day] = isoDate.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return new Intl.DateTimeFormat('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit'
    }).format(date);
  } catch (e) {
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
 * Calcula la diferencia en minutos entre dos strings de hora
 */
export function getMinutesBetween(start: string | undefined, end: string | undefined): number {
  if (!start || !end) return 0;
  
  const t1 = parseTimeToMinutes(start);
  const t2 = parseTimeToMinutes(end);
  
  if (t1 === 0 && t2 === 0) return 0;
  
  let diff = t2 - t1;
  // Manejo de cruce de medianoche (ej: 23:50 a 00:10)
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
