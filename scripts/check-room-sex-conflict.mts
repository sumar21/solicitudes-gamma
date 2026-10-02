// Self-check de roomSexConflict (warning de sexos en habitación destino).
// Correr:  npx tsx scripts/check-room-sex-conflict.mts
import assert from 'node:assert';
import { roomSexConflict } from '../lib/utils';
import { Area, BedStatus, type Bed } from '../types';

const bed = (p: Partial<Bed>): Bed => ({
  id: p.label!, label: p.label!, area: Area.PISO_4, status: BedStatus.OCCUPIED, ...p,
});

// Habitación 401: cama 1 mujer (ocupada), cama 2 destino libre. Traslado de un hombre → conflicto.
const male = bed({ label: 'H401-2', roomCode: '401', status: BedStatus.OCCUPIED, patientName: 'Juan', sex: 'M' });
const female = bed({ label: 'H401-1', roomCode: '401', status: BedStatus.OCCUPIED, patientName: 'Ana', sex: 'F' });
const dest = bed({ label: 'H401-3', roomCode: '401', status: BedStatus.AVAILABLE });

// Conflicto: hombre (origen H401-2) va a H401-3, comparte cuarto con Ana (F).
const c = roomSexConflict([male, female, dest], 'H401-2', 'H401-3');
assert(c && c.patientSex === 'M' && c.roommates.length === 1 && c.roommates[0].label === 'H401-1', 'debe detectar conflicto M vs F');

// Mismo sexo → sin warning.
const male2 = bed({ label: 'H401-1', roomCode: '401', patientName: 'Pedro', sex: 'M' });
assert(roomSexConflict([male, male2, dest], 'H401-2', 'H401-3') === null, 'mismo sexo no avisa');

// Sexo desconocido en el origen → sin warning (best-effort).
const unknown = bed({ label: 'H401-2', roomCode: '401', patientName: 'X', sex: undefined });
assert(roomSexConflict([unknown, female, dest], 'H401-2', 'H401-3') === null, 'origen sin sexo no avisa');

// Otra habitación → sin warning.
const otherRoom = bed({ label: 'H402-1', roomCode: '402', patientName: 'Ana', sex: 'F' });
assert(roomSexConflict([male, otherRoom, dest], 'H401-2', 'H401-3') === null, 'otra habitación no avisa');

// Cama destino vacía sola en el cuarto → sin warning.
assert(roomSexConflict([male, dest], 'H401-2', 'H401-3') === null, 'cuarto sin otros ocupantes no avisa');

// UTI / UCO (y ITR / Sala de Espera): boxes individuales → NUNCA avisa, aunque el "vecino" sea del otro sexo.
for (const area of [Area.HUT, Area.HUC, Area.HIT, Area.HRA]) {
  const m = bed({ label: 'X-1', area, roomCode: 'B1', patientName: 'Juan', sex: 'M' });
  const f = bed({ label: 'X-2', area, roomCode: 'B1', patientName: 'Ana', sex: 'F' });
  const d = bed({ label: 'X-3', area, roomCode: 'B1', status: BedStatus.AVAILABLE });
  assert(roomSexConflict([m, f, d], 'X-1', 'X-3') === null, `sin warning en ${area}`);
}
// Un piso común sigue avisando (la exención NO es global).
const mP = bed({ label: 'P-1', area: Area.PISO_5, roomCode: '501', patientName: 'Juan', sex: 'M' });
const fP = bed({ label: 'P-2', area: Area.PISO_5, roomCode: '501', patientName: 'Ana', sex: 'F' });
const dP = bed({ label: 'P-3', area: Area.PISO_5, roomCode: '501', status: BedStatus.AVAILABLE });
assert(roomSexConflict([mP, fP, dP], 'P-1', 'P-3') !== null, 'piso 5 sigue avisando');

console.log('OK — roomSexConflict');
