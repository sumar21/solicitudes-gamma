// Self-check de mergeBeds para URGENCIA / INGRESO DIRECTO (y regresión del "Por Consolidar" normal).
// Empaqueta hooks/useHospitalState.ts con esbuild (stub del cliente de Supabase: usa import.meta.env, que
// no existe bajo tsx) y ejecuta la función REAL.
// Correr:  npx tsx scripts/check-merge-beds-urgencia.mts
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tmp = mkdtempSync(join(tmpdir(), 'merge-beds-check-'));
writeFileSync(join(tmp, 'supabase-stub.mjs'), 'export const supabase = {}; export const resetSupabasePase = () => {};');
const out = join(tmp, 'hook.bundle.mjs');
await build({
  entryPoints: [resolve('hooks/useHospitalState.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
  define: { 'import.meta.env': '{}' },
  plugins: [{
    name: 'stub-supabase-client',
    setup(b) { b.onResolve({ filter: /(^|\/)lib\/supabase$/ }, () => ({ path: join(tmp, 'supabase-stub.mjs') })); },
  }],
});
const { mergeBeds } = await import(pathToFileURL(out).href) as { mergeBeds: (b: any[], t: any[]) => any[] };

const OCC = 'Ocupada', AV = 'Disponible', PREP = 'En preparación', POR_CONSOLIDAR = 'Por Consolidar';
const mk = (o: any) => ({ id: o.label, area: 'Internacion 4° Piso HPR', status: AV, ...o });
const urgencia = (o: any = {}) => ({
  id: 'T-U', sede: 'HPR', patientName: 'NN MASCULINO', origin: 'Urgencia / Ingreso directo', destination: 'H405-1',
  workflow: 'PRE_TICKET', status: POR_CONSOLIDAR, urgencia: true, isBedClean: false, isReasonValidated: true, createdAt: '', ...o,
});
const find = (beds: any[], label: string) => beds.find(b => b.label === label)!;

// 1) Urgencia, cama destino libre: se ve OCUPADA por el nombre libre, SIN código.
let r = mergeBeds([mk({ label: 'H405-1' })], [urgencia()]);
assert(find(r, 'H405-1').status === OCC && find(r, 'H405-1').patientName === 'NN MASCULINO', 'el destino se ve ocupado por la urgencia');
assert(!find(r, 'H405-1').patientCode, 'sin código hasta que se vincule');

// 2) Cama "En preparación" con RESIDUAL de un paciente anterior (código + enrich): no se hereda.
r = mergeBeds([mk({ label: 'H405-1', status: PREP, patientCode: 'OLD', patientName: 'Viejo', dni: '111', diagnosis: 'X' })], [urgencia()]);
const d2 = find(r, 'H405-1');
assert(d2.status === OCC && d2.patientName === 'NN MASCULINO' && !d2.patientCode && !d2.dni && !d2.diagnosis, 'el residual del paciente anterior no se hereda');

// 3) PROGAL YA internó al paciente en esa cama: manda PROGAL (nombre y código reales), no el nombre libre.
r = mergeBeds([mk({ label: 'H405-1', status: OCC, patientCode: '777', patientName: 'GOMEZ MARTA' })], [urgencia()]);
const d3 = find(r, 'H405-1');
assert(d3.patientName === 'GOMEZ MARTA' && d3.patientCode === '777' && d3.status === OCC, 'PROGAL manda cuando ya internó al paciente');

// 4) Una urgencia no toca ninguna otra cama (no hay origen que vaciar).
r = mergeBeds([mk({ label: 'H405-1' }), mk({ label: 'H406-1', status: OCC, patientCode: '9', patientName: 'OTRO' })], [urgencia()]);
assert(find(r, 'H406-1').status === OCC && find(r, 'H406-1').patientName === 'OTRO', 'otras camas intactas');

// 5) Urgencia cuyo destino no figura en el mapa: no rompe.
assert.doesNotThrow(() => mergeBeds([mk({ label: 'H999-1' })], [urgencia()]), 'destino ausente no rompe');

// 6) REGRESIÓN — "Por Consolidar" NORMAL: el paciente se muestra en destino y el origen queda En preparación.
const normal = { ...urgencia({ urgencia: false, origin: 'H301-1', patientName: 'PEREZ JUAN', patientCode: '55' }) };
r = mergeBeds([
  mk({ label: 'H301-1', status: OCC, patientCode: '55', patientName: 'PEREZ JUAN', dni: '222' }),
  mk({ label: 'H405-1' }),
], [normal]);
const d6 = find(r, 'H405-1'), o6 = find(r, 'H301-1');
assert(d6.status === OCC && d6.patientName === 'PEREZ JUAN' && d6.patientCode === '55' && d6.dni === '222', 'normal: el paciente (con enrich) pasa al destino');
assert(o6.status === PREP && !o6.patientName, 'normal: el origen queda En preparación y vacío');

// 7) REGRESIÓN — normal con el flag undefined (tickets viejos) se comporta igual.
const legacy = { ...normal }; delete (legacy as any).urgencia;
r = mergeBeds([mk({ label: 'H301-1', status: OCC, patientCode: '55', patientName: 'PEREZ JUAN' }), mk({ label: 'H405-1' })], [legacy]);
assert(find(r, 'H405-1').patientCode === '55' && find(r, 'H301-1').status === PREP, 'ticket viejo sin flag: igual que antes');

console.log('OK — mergeBeds urgencia');
