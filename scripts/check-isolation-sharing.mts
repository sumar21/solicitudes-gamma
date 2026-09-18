/**
 * Self-check de los aislamientos QUEMADO (Q) y DIÁLISIS PERITONEAL (DP) — alta 16/09/2026.
 *
 * Cubre las dos mitades del circuito, importando las funciones REALES (sin réplicas que puedan
 * divergir):
 *   1. `summarizeIsolations` (api/isolations-summary.ts) — que PROGAL los reconozca cuando salgan
 *      el 21/09, y que mientras tanto se deriven de la observación "Q"/"DP" de un contacto.
 *   2. `roomIsolationConflict` / `splitDestinationsByIsolation` (lib/isolations.ts) — las reglas
 *      de convivencia que recortan los destinos posibles de un traslado.
 *
 * Uso: npx tsx scripts/check-isolation-sharing.mts
 */
import assert from 'node:assert';
import { summarizeIsolations } from '../api/isolations-summary.js';
import { roomIsolationConflict, splitDestinationsByIsolation, isolationSigla, isolationRule } from '../lib/isolations';
import { Area, Bed, BedStatus } from '../types';

// ── Helpers de armado de camas ───────────────────────────────────────────────
let seq = 0;
const bed = (label: string, room: string, opts: Partial<Bed> = {}): Bed => ({
  id: `B${++seq}`,
  label,
  area: Area.PISO_4,
  roomCode: room,
  status: BedStatus.OCCUPIED,
  patientName: `PAC ${label}`,
  ...opts,
} as Bed);

const iso = (...names: string[]) => ({ isolations: names.map(n => ({ name: n, color: 'englishGreen' })) });
const libre = (label: string, room: string) =>
  bed(label, room, { status: BedStatus.AVAILABLE, patientName: undefined });

// ── 1) Normalización desde PROGAL ────────────────────────────────────────────
const fila = (desc: string, valor: string) => ({ HCG_DESCRIPCION: desc, EIP_RESPUESTA_VALOR: valor });

// Nombre tal cual lo anunció el hospital.
let r = summarizeIsolations([fila('Quemados', 'Prescribe')] as any)!;
assert.deepStrictEqual(r, [{ name: 'Quemado', color: 'englishGreen' }], 'Quemados → Quemado');

// Variantes de nombre que PROGAL podría publicar el 21/09: no deben caer al violeta genérico.
for (const variante of ['Quemado', 'QUEMADOS', 'Dialisis peritoneal', 'Diálisis Peritoneal']) {
  const out = summarizeIsolations([fila(variante, 'Prescribe')] as any)!;
  assert.strictEqual(out[0].color, 'englishGreen', `variante sin mapear: ${variante}`);
}

// Interinato: hoy lo escriben como observación de un aislamiento de contacto.
r = summarizeIsolations([
  fila('De contacto', 'Prescribe'),
  fila('De contacto - Observaciones', 'Paciente DP, cuidar catéter'),
] as any)!;
assert.deepStrictEqual(r.map(e => e.name).sort(), ['Contacto', 'Diálisis peritoneal']);

// Idempotencia: si ya vino como tipo propio, la observación no lo duplica.
r = summarizeIsolations([
  fila('Quemados', 'Prescribe'),
  fila('De contacto', 'Prescribe'),
  fila('De contacto - Observaciones', 'Q'),
] as any)!;
assert.strictEqual(r.filter(e => e.name === 'Quemado').length, 1, 'no duplica Quemado');

// Falso positivo que SÍ importa evitar: "q" minúscula es abreviatura de "que" en texto libre.
r = summarizeIsolations([
  fila('De contacto', 'Prescribe'),
  fila('De contacto - Observaciones', 'avisar q se va de alta'),
] as any)!;
assert.deepStrictEqual(r.map(e => e.name), ['Contacto'], '"q" minúscula no debe derivar Quemado');

// Y uno que no debe romperse: DPOC no es DP.
r = summarizeIsolations([
  fila('De contacto', 'Prescribe'),
  fila('De contacto - Observaciones', 'EPOC/DPOC descompensado'),
] as any)!;
assert.deepStrictEqual(r.map(e => e.name), ['Contacto'], 'DPOC no debe derivar Diálisis peritoneal');

// ── 2) Siglas y reglas ───────────────────────────────────────────────────────
assert.strictEqual(isolationSigla('Quemado'), 'Q');
assert.strictEqual(isolationSigla('Diálisis peritoneal'), 'DP');
assert.strictEqual(isolationSigla('Contacto'), undefined);
assert.strictEqual(isolationRule('Quemado'), 'igual');
assert.strictEqual(isolationRule('Diálisis peritoneal'), 'solo');
assert.strictEqual(isolationRule('Respiratorio'), 'libre', 'los aislamientos viejos no cambian de regla');

// ── 3) Convivencia: el paciente que se mueve ─────────────────────────────────
const conflicto = (beds: Bed[], origen: string, destino: string) =>
  roomIsolationConflict(beds, origen, destino) !== null;

// DP no comparte: habitación ocupada → bloquea; habitación vacía → permite.
{
  const beds = [
    bed('ORIG', 'R1', iso('Diálisis peritoneal')),
    libre('DEST-CON-VECINO', 'R2'), bed('VECINO', 'R2'),
    libre('DEST-SOLO', 'R3'),
  ];
  assert.ok(conflicto(beds, 'ORIG', 'DEST-CON-VECINO'), 'DP no puede entrar a habitación ocupada');
  assert.ok(!conflicto(beds, 'ORIG', 'DEST-SOLO'), 'DP sí puede ir a una habitación vacía');
}

// Q comparte SOLO con otro Q.
{
  const beds = [
    bed('ORIG', 'R1', iso('Quemado')),
    libre('DEST-CON-Q', 'R2'), bed('VECINO-Q', 'R2', iso('Quemado')),
    libre('DEST-CON-OTRO', 'R3'), bed('VECINO-X', 'R3'),
    libre('DEST-VACIO', 'R4'),
  ];
  assert.ok(!conflicto(beds, 'ORIG', 'DEST-CON-Q'), 'Q + Q pueden compartir');
  assert.ok(conflicto(beds, 'ORIG', 'DEST-CON-OTRO'), 'Q no comparte con un no-Q');
  assert.ok(!conflicto(beds, 'ORIG', 'DEST-VACIO'), 'Q solo en habitación vacía está bien');
}

// ── 4) Convivencia: los que YA están en la habitación (regla simétrica) ──────
{
  const beds = [
    bed('ORIG', 'R1'), // paciente sin aislamiento
    libre('DEST-JUNTO-A-DP', 'R2'), bed('VECINO-DP', 'R2', iso('Diálisis peritoneal')),
    libre('DEST-JUNTO-A-Q', 'R3'),  bed('VECINO-Q', 'R3', iso('Quemado')),
  ];
  assert.ok(conflicto(beds, 'ORIG', 'DEST-JUNTO-A-DP'), 'nadie entra donde hay un DP');
  assert.ok(conflicto(beds, 'ORIG', 'DEST-JUNTO-A-Q'), 'un no-Q no entra donde hay un Q');
}

// Una cama LIBRE con paciente residual no debe contar como ocupante (ver roommatesOf).
{
  const beds = [
    bed('ORIG', 'R1', iso('Diálisis peritoneal')),
    libre('DEST', 'R2'),
    bed('FANTASMA', 'R2', { status: BedStatus.AVAILABLE, patientName: 'RESIDUO SIN LIBERAR' }),
  ];
  assert.ok(!conflicto(beds, 'ORIG', 'DEST'), 'un paciente fantasma no bloquea la habitación');
}

// Habitación = roomCode + area: mismo número de cuarto en otro piso no es la misma habitación.
{
  const beds = [
    bed('ORIG', 'R1', iso('Diálisis peritoneal')),
    libre('DEST', 'R2'),
    bed('OTRO-PISO', 'R2', { area: Area.PISO_7 }),
  ];
  assert.ok(!conflicto(beds, 'ORIG', 'DEST'), 'mismo roomCode en otra área no es la misma habitación');
}

// ── 5) Recorte de la lista de destinos ───────────────────────────────────────
{
  const destA = libre('DEST-A', 'R2');
  const destB = libre('DEST-B', 'R3');
  const beds = [bed('ORIG', 'R1', iso('Diálisis peritoneal')), destA, bed('VECINO', 'R2'), destB];

  const { allowed, blocked } = splitDestinationsByIsolation(beds, 'ORIG', [destA, destB]);
  assert.deepStrictEqual(allowed.map(b => b.label), ['DEST-B']);
  assert.strictEqual(blocked.length, 1);
  assert.match(blocked[0].conflict.reason, /Diálisis peritoneal \(DP\)/, 'el motivo nombra el aislamiento y la sigla');

  // Sin origen elegido todavía → no se recorta nada.
  assert.strictEqual(splitDestinationsByIsolation(beds, undefined, [destA, destB]).allowed.length, 2);

  // El destino ya cargado del ticket nunca se saca de la lista.
  const conKeep = splitDestinationsByIsolation(beds, 'ORIG', [destA, destB], 'DEST-A');
  assert.deepStrictEqual(conKeep.allowed.map(b => b.label), ['DEST-A', 'DEST-B']);
  assert.strictEqual(conKeep.blocked.length, 0);
}

// ── 6) No romper lo viejo ────────────────────────────────────────────────────
{
  // Los aislamientos preexistentes NO recortan destinos (su bloqueo sigue siendo el del mapa).
  const dest = libre('DEST', 'R2');
  const beds = [bed('ORIG', 'R1', iso('Contacto')), dest, bed('VECINO', 'R2', iso('Respiratorio'))];
  assert.strictEqual(splitDestinationsByIsolation(beds, 'ORIG', [dest]).blocked.length, 0,
    'Contacto/Respiratorio no deben recortar destinos — sería un cambio de alcance no pedido');

  // Y el mapeo viejo de PROGAL quedó intacto.
  const viejos = summarizeIsolations([
    fila('De contacto preventivo', 'Prescribe'),
    fila('COVID 19', 'Prescribe'),
  ] as any)!;
  assert.deepStrictEqual(viejos.map(e => `${e.name}/${e.color}`).sort(),
    ['Contacto preventivo/teal', 'Covid/yellow']);
}

console.log('✓ aislamientos Q/DP: normalización, siglas, reglas de convivencia y recorte de destinos');
