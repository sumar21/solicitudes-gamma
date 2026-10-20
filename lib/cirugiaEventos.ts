/**
 * Etiqueta legible de un evento de cirugía (cirugia_eventos) para las líneas de tiempo (Operativa →
 * Cirugías y trayectoria del paciente). Los pasos usan la etiqueta del estado; RETROCESO ("Volver un
 * paso", 20/10/2026) dice de qué paso a qué paso se volvió: sirve para medir cuántas veces se marca un
 * paso por error.
 */
import { CIRUGIA_ESTADO_LABEL } from './constants';

const L = CIRUGIA_ESTADO_LABEL as Record<string, string>;

export function cirugiaEventoLabel(e: { tipo: string; meta?: { de?: unknown; a?: unknown } | null }): string {
  if (e.tipo === 'RETROCESO') {
    const de = String(e.meta?.de ?? ''), a = String(e.meta?.a ?? '');
    return `Volvió un paso: ${L[de] ?? (de || '?')} → ${L[a] ?? (a || '?')}`;
  }
  if (e.tipo === 'ANULAR_PREVIA') return 'Cirugía previa anulada';
  return L[e.tipo] ?? e.tipo;
}

export const esRetroceso = (e: { tipo: string }) => e.tipo === 'RETROCESO';
