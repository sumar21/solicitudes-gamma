// Self-check de lib/bedsGuard (mapa de camas parcial de Gamma).
// Correr:  npx tsx scripts/check-beds-guard.mts
import assert from 'node:assert';
import { bedsShrinkDecision, BEDS_SHRINK_ACCEPT_MS } from '../lib/bedsGuard';

const t0 = 1_000_000;
// Mapa normal o que crece / se achica poco → se acepta y se resetea la racha.
assert.deepEqual(bedsShrinkDecision(250, 250, null, t0), { accept: true, since: null }, 'igual');
assert.deepEqual(bedsShrinkDecision(250, 300, t0, t0), { accept: true, since: null }, 'crece → acepta y resetea');
assert.deepEqual(bedsShrinkDecision(250, 201, null, t0), { accept: true, since: null }, 'achica <20% → acepta');
// Sin mapa previo (primer load) → se acepta lo que venga.
assert.equal(bedsShrinkDecision(0, 12, null, t0).accept, true, 'primer load');
// Parcial: se rechaza y arranca la racha.
let d = bedsShrinkDecision(250, 40, null, t0);
assert.deepEqual(d, { accept: false, since: t0 }, 'parcial → rechaza');
d = bedsShrinkDecision(250, 40, d.since, t0 + 60_000);
assert.deepEqual(d, { accept: false, since: t0 }, 'sigue parcial al minuto → sigue rechazando, misma racha');
// Si el mapa chico se sostiene 3 min → baja real → se acepta.
d = bedsShrinkDecision(250, 40, d.since, t0 + BEDS_SHRINK_ACCEPT_MS);
assert.deepEqual(d, { accept: true, since: null }, 'sostenido 3 min → acepta');
// Una respuesta buena en el medio corta la racha.
assert.deepEqual(bedsShrinkDecision(250, 250, t0, t0 + 90_000), { accept: true, since: null }, 'respuesta buena resetea');

console.log('OK — bedsGuard');
