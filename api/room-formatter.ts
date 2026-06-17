/**
 * Helpers para construir un texto de ubicación legible para las notificaciones de
 * Catering ("Habitación 413 (Piso 4)"). Centraliza la lógica que antes vivía inline
 * en api/tickets.ts (traslados) para reutilizarla también en los crons de dieta/ayuno.
 */

/**
 * Extrae el identificador de habitación desde un label de cama
 * (ej. "Habitación 413 - Cama 01" → "413", "Unidad 5 - Cama A" → "5").
 * Fallback: primera parte antes de " - ".
 */
export function extractRoom(label?: string): string {
  if (!label) return '?';
  const m = label.match(/Habitaci[oó]n\s+(\S+)/i);
  if (m) return m[1];
  const unidad = label.match(/Unidad\s+([^-]+)/i);
  if (unidad) return unidad[1].trim();
  return label.split(' - ')[0].trim();
}

/**
 * Extrae el piso legible desde el nombre de área de Gamma
 * (ej. "Internacion 4° Piso HPR" → "Piso 4"). Fallback: el nombre sin sufijo "HPR".
 */
export function extractFloor(areaName?: string): string {
  if (!areaName) return '';
  const m = areaName.match(/(\d+)°?\s*Piso/i);
  if (m) return `Piso ${m[1]}`;
  return areaName.replace(/\s*HPR\s*$/i, '').trim();
}

/**
 * Arma el texto de ubicación para Catering a partir del nombre de habitación de Gamma
 * (room.nombre, ya humano: "Habitación 413" / "Hab. 413") y el nombre de área (piso).
 *   - "Habitación 413 (Piso 4)" cuando hay habitación y piso.
 *   - solo la habitación si no se pudo derivar el piso.
 *   - solo el piso si no hay nombre de habitación.
 */
export function formatRoomForCatering(roomName?: string, areaName?: string): string {
  const room  = (roomName ?? '').trim();
  const floor = extractFloor(areaName);
  if (!room) return floor;
  return floor ? `${room} (${floor})` : room;
}
