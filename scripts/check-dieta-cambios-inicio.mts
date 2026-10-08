// Self-check del handler REAL de api/dieta-cambios.ts: suma los "Iniciar dieta" de cirugía al historial de
// cambios de dieta (orden por fecha, filtro por paciente, fail-soft si la parte de cirugía falla).
// Correr:  npx tsx scripts/check-dieta-cambios-inicio.mts
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tmp = mkdtempSync(join(tmpdir(), 'dieta-cambios-check-'));
const g = globalThis as any;
writeFileSync(join(tmp, 'jwt-stub.mjs'), 'export const requireAuth = (h) => h;');
writeFileSync(join(tmp, 'supabase-admin-stub.mjs'), `
export function getSupabaseAdmin() {
  return { from(table) {
    const api = {
      select() { return api; }, eq() { return api; }, gte() { return api; }, lte() { return api; },
      in() { return api; }, order() { return api; }, limit() { return api; },
      then(res, rej) {
        if (globalThis.__fail?.includes(table)) return Promise.resolve({ data: null, error: { message: 'boom ' + table } }).then(res, rej);
        return Promise.resolve({ data: globalThis.__db[table] ?? [], error: null }).then(res, rej);
      },
    };
    return api;
  } };
}`);
const out = join(tmp, 'bundle.mjs');
await build({
  entryPoints: [resolve('api/dieta-cambios.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /(^|\/)jwt(\.js)?$/ }, () => ({ path: join(tmp, 'jwt-stub.mjs') }));
    b.onResolve({ filter: /(^|\/)supabase-admin(\.js)?$/ }, () => ({ path: join(tmp, 'supabase-admin-stub.mjs') }));
  } }],
});
const handler = (await import(pathToFileURL(out).href)).default;
async function call(query: any = {}) {
  const res: any = { code: 200, body: null, setHeader() {}, status(c: number) { this.code = c; return this; }, json(b: any) { this.body = b; return this; }, end() { return this; } };
  await handler({ method: 'GET', query, headers: {} }, res);
  return res.body.cambios as any[];
}

g.__fail = [];
g.__db = {
  dieta_cambios: [
    { id: 'd1', entorno: 'TESTING', paciente_codigo: '100', paciente_nombre: 'PEREZ JUAN', area: 'Piso 4', habitacion: '401', tags_prev: 'General', tags_new: 'Liviana', fecha_cambio: '2026-10-05T12:00:00Z' },
    { id: 'd2', entorno: 'TESTING', paciente_codigo: '200', paciente_nombre: 'GOMEZ ANA', area: 'Piso 5', habitacion: '501', tags_prev: '', tags_new: 'Diabetes', fecha_cambio: '2026-10-05T08:00:00Z' },
  ],
  cirugia_eventos: [
    { id: 'e1', cirugia_id: 'c1', usuario: 'enfermeriap8', created_at: '2026-10-05T10:00:00Z' },
  ],
  cirugia_traslados: [
    { id: 'c1', paciente_nombre: 'LANZI CLAUDIO', paciente_codigo: '300', cama_origen: 'Habitación 519 HPR - Cama 02', cama_destino: 'Habitación 601 HPR - Cama 01', area: 'Internacion 5° Piso HPR' },
  ],
};

// 1) mezcla ordenada por fecha desc: d1 (12h) → e1 (10h) → d2 (8h)
let c = await call({ from: '2026-10-01', to: '2026-10-05' });
assert.deepEqual(c.map(x => x.spItemId), ['d1', 'cx-e1', 'd2'], 'orden por fecha, mezclados');
assert.equal(c[0].kind, 'CAMBIO');
const ini = c[1];
assert.equal(ini.kind, 'INICIO_DIETA');
assert.equal(ini.patientName, 'LANZI CLAUDIO');
assert.equal(ini.roomCode, 'Habitación 601 HPR - Cama 01', 'si cambió de cama al volver, se muestra la cama de regreso');
assert.equal(ini.by, 'enfermeriap8');

// 2) sin cama de regreso → la de origen
g.__db.cirugia_traslados[0].cama_destino = null;
c = await call();
assert.equal(c.find(x => x.kind === 'INICIO_DIETA').roomCode, 'Habitación 519 HPR - Cama 02', 'sin cambio de cama → origen');

// 3) filtro por paciente (journey): solo lo de ese paciente, de ambos tipos
// (el filtro de dieta_cambios lo hace la query real; el stub no filtra, así que se mira sólo la parte nueva)
c = await call({ paciente: '300' });
assert.equal(c.filter(x => x.kind === 'INICIO_DIETA').length, 1, 'paciente 300: su inicio de dieta');
c = await call({ paciente: '999' });
assert.equal(c.filter(x => x.kind === 'INICIO_DIETA').length, 0, 'otro paciente: ningún inicio de dieta ajeno');

// 4) fail-soft: si falla la parte de cirugía, los cambios de dieta se devuelven igual
g.__fail = ['cirugia_eventos'];
c = await call();
assert.deepEqual(c.map(x => x.kind), ['CAMBIO', 'CAMBIO'], 'falla la parte de cirugía → igual devuelve los cambios');
g.__fail = ['cirugia_traslados'];
c = await call();
assert.equal(c.filter(x => x.kind === 'INICIO_DIETA').length, 0, 'falla el join → sin inicios, sin romper');
g.__fail = [];

// 5) evento sin operatoria encontrada (fila borrada): se lista igual, sin datos de paciente
g.__db.cirugia_traslados = [];
c = await call();
assert.equal(c.filter(x => x.kind === 'INICIO_DIETA').length, 1, 'el evento se lista igual');

console.log('OK — dieta-cambios + inicio de dieta');
