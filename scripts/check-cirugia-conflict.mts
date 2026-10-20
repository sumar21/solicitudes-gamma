// Self-check de api/cirugia-conflict (alta "Listo para cirugía" contra una operatoria viva de la cama).
// Correr:  npx tsx scripts/check-cirugia-conflict.mts
import assert from 'node:assert';
import { cirugiaBedBusyMessage, isSameCirugiaPatient, resolveAltaChoque, type LiveCirugiaRow } from '../api/cirugia-conflict';

// Caso real 20/10/2026 (datos anonimizados): en la 825-01 quedó abierta la operatoria del paciente A
// en "Regreso de cirugía"; Enfermería quiere marcar a la paciente B, que ahora ocupa la cama.
const vivaA: LiveCirugiaRow = {
  id: 'cx-a', paciente_codigo: '1001', paciente_nombre: 'PACIENTE A', estado: 'EN_DEVOLUCION',
  cama_origen: 'Habitacion 825 HPR - Cama 01', cama_destino: null, updated_at: '2026-10-20T00:33:50Z',
};

// 1) Mismo paciente → reintento idempotente; otro paciente → choque.
assert(isSameCirugiaPatient(vivaA, { pacienteCodigo: '1001' }), 'mismo código');
assert(!isSameCirugiaPatient(vivaA, { pacienteCodigo: '1002', pacienteNombre: 'PACIENTE B' }), 'otro código → otro paciente');
assert(isSameCirugiaPatient({ paciente_codigo: null, paciente_nombre: 'Pérez,  Juan' }, { pacienteNombre: 'PEREZ, JUAN' }), 'sin código: por nombre (tildes/espacios)');
assert(!isSameCirugiaPatient({ paciente_codigo: null, paciente_nombre: 'PACIENTE A' }, { pacienteNombre: 'PACIENTE B' }), 'sin código: nombre distinto');
assert(isSameCirugiaPatient({ paciente_codigo: null, paciente_nombre: null }, { pacienteCodigo: '1002' }), 'sin datos → comportamiento previo (idempotente)');

// 2) Mensaje: dice cama, paciente, estado, desde cuándo (hora AR) y qué hacer.
let m = cirugiaBedBusyMessage(vivaA, 'Habitacion 825 HPR - Cama 01');
assert(m.startsWith('La 825 - 01 tiene una cirugía abierta de PACIENTE A (Regreso de cirugía desde el 19/10 21:33)'), m);
assert(m.includes('21:33') && m.includes('"Iniciar dieta"'), m);
m = cirugiaBedBusyMessage({ ...vivaA, cama_destino: 'Habitación 815 HPR - Cama 01' }, 'Habitacion 825 HPR - Cama 01');
assert(m.includes('volvió a la 815 - 01'), 'cambio de cama al volver');
m = cirugiaBedBusyMessage({ ...vivaA, estado: 'LISTO_PARA_CIRUGIA' }, 'Habitacion 825 HPR - Cama 01');
assert(m.includes('(Listo para cirugía') && m.includes('cancelala'), 'antes de ir a cirugía: terminar o cancelar');
m = cirugiaBedBusyMessage({ ...vivaA, updated_at: null, paciente_nombre: null }, 'Unidad Terapia Intensiva HPR - Cama 11');
assert(m.startsWith('La Unidad Terapia Intensiva HPR - Cama 11 tiene una cirugía abierta de otro paciente (Regreso de cirugía).'), m);

// 3) Qué hacer ante el choque con el índice (rows = vivas de la cama).
const enCursoA: LiveCirugiaRow = { ...vivaA, id: 'cx-a2', estado: 'EN_CIRUGIA' };
const B = { pacienteCodigo: '1002', pacienteNombre: 'PACIENTE B' };
assert.deepEqual(resolveAltaChoque([], B), { kind: 'ninguno' }, 'sin vivas');
assert.deepEqual(resolveAltaChoque([enCursoA], { pacienteCodigo: '1001' }), { kind: 'idempotente', id: 'cx-a2' }, 'mismo paciente en curso → reintento');
let ch = resolveAltaChoque([enCursoA], B);
assert(ch.kind === 'conflicto' && ch.live.id === 'cx-a2', 'otro paciente en curso → 409');
// Índice nuevo: si hay una "Regreso" y otra EN CURSO, la que choca es la EN CURSO.
ch = resolveAltaChoque([vivaA, enCursoA], B);
assert(ch.kind === 'conflicto' && ch.live.id === 'cx-a2', 'se informa la EN CURSO, no la de Regreso');
// Índice viejo todavía (solo hay "Regreso"): 409 aunque sea el MISMO paciente — nunca un ok sin crear nada.
ch = resolveAltaChoque([vivaA], { pacienteCodigo: '1001' });
assert(ch.kind === 'conflicto' && ch.live.id === 'cx-a', 'solo Regreso → 409 (no idempotente)');
// 4) Candado POR PACIENTE (migración 20261020140000): entre las candidatas (las del paciente + las de la
//    cama) manda la EN CURSO del propio paciente aunque la cama tenga otra de otro paciente.
const enCursoC: LiveCirugiaRow = { ...vivaA, id: 'cx-c', paciente_codigo: '3000', paciente_nombre: 'PACIENTE C', estado: 'EN_CIRUGIA' };
const propiaB: LiveCirugiaRow = { ...vivaA, id: 'cx-b', paciente_codigo: '1002', paciente_nombre: 'PACIENTE B', estado: 'LISTO_PARA_CIRUGIA', cama_origen: 'Habitación 815 HPR - Cama 01' };
assert.deepEqual(resolveAltaChoque([enCursoC, propiaB], B), { kind: 'idempotente', id: 'cx-b' }, 'el paciente ya tiene una en curso (en otra cama) → esa');
assert.deepEqual(resolveAltaChoque([vivaA, propiaB], B), { kind: 'idempotente', id: 'cx-b' }, 'una Regreso ajena en la cama no interfiere');

console.log('OK — cirugia-conflict');
