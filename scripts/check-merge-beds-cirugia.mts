// Self-check de mergeBeds para el overlay de cirugía: pill Cx que sigue al paciente + `cirugiaBloqueante`
// (operatoria viva de OTRO paciente que sigue tomando la cama de origen). Empaqueta el hook real con
// esbuild (stub del cliente de Supabase), igual que check-merge-beds-urgencia.
// Correr:  npx tsx scripts/check-merge-beds-cirugia.mts
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tmp = mkdtempSync(join(tmpdir(), 'merge-beds-cx-'));
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
const { mergeBeds, buildCirugiaByBed } = await import(pathToFileURL(out).href) as { mergeBeds: (...a: any[]) => any[]; buildCirugiaByBed: (c: any[]) => Map<string, any> };

const OCC = 'Ocupada', AV = 'Disponible';
const mk = (o: any) => ({ id: o.label, area: 'Internacion 8° Piso HPR', status: AV, ...o });
const find = (beds: any[], label: string) => beds.find(b => b.label === label)!;
const H825 = 'Habitacion 825 HPR - Cama 01', H815 = 'Habitación 815 HPR - Cama 01';
// Caso real 20/10/2026 (anonimizado): operatoria del paciente A en "Regreso de cirugía" con origen 825-01.
const opA = { id: 'cx-a', estado: 'EN_DEVOLUCION', camaOrigen: H825, pacienteCodigo: '1001', pacienteNombre: 'PACIENTE A', role: 'origin', updatedAt: new Date().toISOString() };
const cx = (...entries: [string, any][]) => new Map(entries);

// 1) En la 825-01 está la paciente B: sin pill (no es de ella) pero la cama queda BLOQUEADA por la de A.
let r = mergeBeds([mk({ label: H825, status: OCC, patientCode: '1002', patientName: 'PACIENTE B' })], [], undefined, undefined, cx([H825, opA]));
assert(!find(r, H825).cirugia, 'la pill de A no se pega a la paciente B');
assert(find(r, H825).cirugiaBloqueante?.id === 'cx-a', 'la cama queda marcada como bloqueada por la operatoria de A');

// 2) El paciente de la operatoria sigue en su cama: pill normal, sin bloqueo.
r = mergeBeds([mk({ label: H825, status: OCC, patientCode: '1001', patientName: 'PACIENTE A' })], [], undefined, undefined, cx([H825, opA]));
assert(find(r, H825).cirugia?.id === 'cx-a' && !find(r, H825).cirugiaBloqueante, 'mismo paciente: pill, sin bloqueo');

// 3) A se mudó a la 815 (PROGAL) y B ocupa la 825: la pill sigue a A y la 825 sigue bloqueada.
r = mergeBeds([
  mk({ label: H825, status: OCC, patientCode: '1002', patientName: 'PACIENTE B' }),
  mk({ label: H815, status: OCC, patientCode: '1001', patientName: 'PACIENTE A' }),
], [], undefined, undefined, cx([H825, opA]));
assert(find(r, H815).cirugia?.id === 'cx-a', 'la pill acompaña al paciente a su cama nueva');
assert(find(r, H825).cirugiaBloqueante?.id === 'cx-a' && !find(r, H825).cirugia, 'la cama de origen sigue bloqueada para B');

// 4) Una entrada 'destino' (cambio de cama al volver) NO bloquea la cama destino de otro paciente: el
//    índice único es por cama_origen.
const destino = { ...opA, camaDestino: H815, role: 'destino' };
r = mergeBeds([mk({ label: H815, status: OCC, patientCode: '2000', patientName: 'PACIENTE C' })], [], undefined, undefined, cx([H815, destino]));
assert(!find(r, H815).cirugiaBloqueante, 'una cama destino no queda bloqueada');

// 5) Cama vacía: sin bloqueo (no hay a quién marcar) y sin cambios en la regla de la pill.
r = mergeBeds([mk({ label: H825 })], [], undefined, undefined, cx([H825, opA]));
assert(!find(r, H825).cirugiaBloqueante, 'cama vacía: sin bloqueo');

// 6) Una cama con una operatoria EN CURSO (paciente B) y otra en "Regreso de cirugía" (paciente A, que
//    volvió a la 815): en la clave de la cama manda la EN CURSO y la de A no se pierde (la pill lo sigue).
const ops = [
  { id: 'cx-a', estado: 'EN_DEVOLUCION', camaOrigen: H825, pacienteCodigo: '1001', pacienteNombre: 'PACIENTE A', updatedAt: new Date().toISOString() },
  { id: 'cx-b', estado: 'LISTO_PARA_CIRUGIA', camaOrigen: H825, pacienteCodigo: '1002', pacienteNombre: 'PACIENTE B', updatedAt: new Date().toISOString() },
];
for (const orden of [ops, [...ops].reverse()]) {
  const map = buildCirugiaByBed(orden);
  assert(map.get(H825)?.id === 'cx-b', 'la EN CURSO se queda con la cama, sin importar el orden');
  r = mergeBeds([
    mk({ label: H825, status: OCC, patientCode: '1002', patientName: 'PACIENTE B' }),
    mk({ label: H815, status: OCC, patientCode: '1001', patientName: 'PACIENTE A' }),
  ], [], undefined, undefined, map);
  assert(find(r, H825).cirugia?.id === 'cx-b' && !find(r, H825).cirugiaBloqueante, 'B ve su pill (Listo) y la cama no figura bloqueada');
  assert(find(r, H815).cirugia?.id === 'cx-a', 'la de A (Regreso) sigue a A a su cama');
}
// 7) Solo la "Regreso" de A en la cama de B: se marca como bloqueante con estado EN_DEVOLUCION (BedsView
//    lo muestra como aviso informativo y deja el botón).
r = mergeBeds([mk({ label: H825, status: OCC, patientCode: '1002', patientName: 'PACIENTE B' })], [], undefined, undefined, buildCirugiaByBed([ops[0]]));
assert(find(r, H825).cirugiaBloqueante?.estado === 'EN_DEVOLUCION', 'Regreso de otro paciente: aviso informativo');
// 8) Terminales no entran al overlay.
assert(buildCirugiaByBed([{ ...ops[1], estado: 'TOLERANCIA_EVALUADA' }, { ...ops[0], estado: 'CANCELADO' }]).size === 0, 'terminales afuera');

console.log('OK — mergeBeds cirugía (pill + cirugiaBloqueante + prioridad en curso)');
