/**
 * Self-check de formatTicketDestination (lib/utils.ts).
 *
 * La función está exportada, así que se importa de verdad (no hay réplica que pueda divergir).
 * Cubre el caso que motivó el helper: un pre-ticket en Presolicitud NO dice 'Anulado'.
 *
 * Uso: npx tsx scripts/check-ticket-destination.mts
 */
import assert from 'node:assert';
import { formatTicketDestination } from '../lib/utils';
import { TicketStatus } from '../types';

const f = (destination: string | null, status: TicketStatus) =>
  formatTicketDestination({ destination, status });

// Con destino: gana siempre el nombre de cama formateado, en cualquier estado.
assert.strictEqual(f('Habitación 412 HPR - Cama 1', TicketStatus.IN_TRANSIT), '412 - 1');
assert.strictEqual(f('Habitación 412 HPR - Cama 1', TicketStatus.REJECTED), '412 - 1');

// Sin destino: el motivo depende del estado. Esta es la distinción que faltaba.
assert.strictEqual(f(null, TicketStatus.REJECTED), 'Anulado');
assert.strictEqual(f(null, TicketStatus.PRESOLICITUD), 'Sin destino');
assert.strictEqual(f(null, TicketStatus.WAITING_ROOM), 'Pendiente');

console.log('✓ formatTicketDestination: 5/5');
