/**
 * Reglas del PATCH de traslados para dos correcciones sobre un pedido abierto (20/10/2026). Puro (sin
 * red) para testearlo: npx tsx scripts/check-ticket-origen.mts
 *
 * · Origen automático: PROGAL cambió al paciente de cama (p. ej. 407.1 → 407.2) con un pre-ticket o
 *   traslado que todavía no salió. Antes el pedido quedaba apuntando a la cama vieja y la trababa para
 *   el próximo paciente (caso 14/10, ITR 03 → 05). Ahora el cliente lo detecta en el mapa
 *   (findOriginMoves de lib/originBed.ts) y pide reubicar el origen; acá se valida contra la fila.
 * · Restablecer destino: un pre-ticket configurado vuelve a "Presolicitud" y libera la cama destino (le
 *   dieron la cama a un paciente más urgente) sin cancelarlo ni volver a cargarlo.
 */
import { TicketStatus, WorkflowType } from '../types.js';

export interface TrasladoRowLite {
  status?: string | null;
  cama_origen?: string | null;
  cama_destino?: string | null;
  codigo_paciente?: string | null;
  workflow?: string | null;
  intervino_azafata?: string | null;
  urgencia?: boolean | null;
  updated_at?: string | null;
}

// ok=false trae status + error (forma plana: el proyecto compila sin strictNullChecks y no estrecha uniones).
export interface Veredicto { ok: boolean; noop?: boolean; status?: number; error?: string }

// El paciente todavía no salió de la cama de origen (mismo criterio que STILL_ON_ORIGIN de lib/originBed.ts).
export const SIN_SALIR: string[] = [TicketStatus.PRESOLICITUD, TicketStatus.WAITING_ROOM, TicketStatus.IN_TRANSIT];

/**
 * ¿Se puede pasar el origen de `from` a `to`? `mapaEdadMs` = antigüedad del mapa de PROGAL del cliente:
 * si la fila cambió DESPUÉS de ese mapa (se creó, se reubicó o cambió de estado), el mapa puede estar
 * viejo y se rechaza — evita que un dispositivo con el mapa atrasado devuelva el origen a la cama vieja.
 * Se compara con el reloj del servidor (`nowMs`), no con el del dispositivo.
 */
export function validarReubicarOrigen(
  cur: TrasladoRowLite | null,
  req: { from?: unknown; to?: unknown; patientCode?: unknown; mapaEdadMs?: unknown },
  nowMs: number,
): Veredicto {
  const from = String(req.from ?? '').trim();
  const to = String(req.to ?? '').trim();
  if (!from || !to || from === to) return { ok: false, status: 400, error: 'Origen inválido.' };
  if (!cur) return { ok: false, status: 404, error: 'Traslado no encontrado.' };
  const origen = String(cur.cama_origen ?? '');
  if (origen === to) return { ok: true, noop: true }; // otro dispositivo ya lo reubicó
  if (origen !== from) return { ok: false, status: 409, error: 'El origen del traslado cambió; recargá.' };
  if (!SIN_SALIR.includes(String(cur.status ?? ''))) {
    return { ok: false, status: 409, error: 'El paciente ya salió de la cama de origen.' };
  }
  const pc = String(cur.codigo_paciente ?? '').trim();
  if (!pc || pc !== String(req.patientCode ?? '').trim()) {
    return { ok: false, status: 409, error: 'El paciente del traslado no coincide.' };
  }
  // PROGAL adelantado: ya lo consolidaron en la cama destino y el paciente sigue en la de origen.
  if (String(cur.cama_destino ?? '') === to) {
    return { ok: false, status: 409, error: 'La cama nueva es el destino del traslado.' };
  }
  const edad = Number(req.mapaEdadMs);
  const updatedMs = Date.parse(String(cur.updated_at ?? ''));
  if (!Number.isFinite(edad) || edad < 0) return { ok: false, status: 400, error: 'Falta la antigüedad del mapa.' };
  if (Number.isFinite(updatedMs) && updatedMs > nowMs - edad) {
    return { ok: false, status: 409, error: 'El mapa de camas es anterior al último cambio del traslado.' };
  }
  return { ok: true };
}

/** ¿El pre-ticket puede volver a "Presolicitud" (sin destino)? Solo configurado y sin intervención de la azafata. */
export function validarRestablecerDestino(cur: TrasladoRowLite | null): Veredicto {
  if (!cur) return { ok: false, status: 404, error: 'Traslado no encontrado.' };
  if (cur.status === TicketStatus.PRESOLICITUD) return { ok: true, noop: true }; // ya está sin destino
  if (cur.workflow !== WorkflowType.PRE_TICKET || cur.urgencia === true) {
    return { ok: false, status: 409, error: 'Solo se puede restablecer el destino de un pre-ticket.' };
  }
  if (cur.status !== TicketStatus.WAITING_ROOM && cur.status !== TicketStatus.IN_TRANSIT) {
    return { ok: false, status: 409, error: 'El traslado ya está en curso: no se puede restablecer el destino.' };
  }
  if (String(cur.intervino_azafata ?? '').trim().toUpperCase() === 'SI') {
    return { ok: false, status: 409, error: 'La azafata ya intervino: no se puede restablecer el destino.' };
  }
  return { ok: true };
}
