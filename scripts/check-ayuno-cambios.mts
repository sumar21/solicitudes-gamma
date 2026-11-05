// Self-check del historial de cambios de ayuno: el handler REAL de api/ayuno-cambios.ts (filtros, shape,
// sin la frase del push, error visible) y la lectura del antes/después (lib/ayuno-resumen.ts).
// Correr:  npx tsx scripts/check-ayuno-cambios.mts
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { leerResumenAyuno, ubicacionAyuno } from '../lib/ayuno-resumen.ts';

// ── lib/ayuno-resumen ──────────────────────────────────────────────────────
assert.deepStrictEqual(leerResumenAyuno('sin ayuno'), { dias: [], resto: 0 });
assert.deepStrictEqual(leerResumenAyuno(''), { dias: [], resto: 0 });
assert.deepStrictEqual(leerResumenAyuno(null), { dias: [], resto: 0 });
assert.deepStrictEqual(leerResumenAyuno('05/11 10:00, 05/11 11:00, 06/11 09:00'), {
  dias: [{ dia: '05/11', horas: ['10:00', '11:00'] }, { dia: '06/11', horas: ['09:00'] }], resto: 0,
});
// Fila vieja recortada (formato del push).
assert.deepStrictEqual(leerResumenAyuno('05/11 12:00, 05/11 16:00, 05/11 20:00 y 12 más'), {
  dias: [{ dia: '05/11', horas: ['12:00', '16:00', '20:00'] }], resto: 12,
});
// Texto que no son horarios → se muestra tal cual, nunca se pierde.
assert.deepStrictEqual(leerResumenAyuno('algo raro'), { dias: [], resto: 0, crudo: 'algo raro' });

assert.strictEqual(ubicacionAyuno('Internacion 6° Piso HPR', 'Habitación 607 HPR'), 'Internacion 6° Piso · Hab. 607');
assert.strictEqual(ubicacionAyuno('Unidad de Terapia Intensiva HPR', 'Unidad Terapia Intensiva HPR'), 'Unidad de Terapia Intensiva');
assert.strictEqual(ubicacionAyuno('', null), '—');

// ── api/ayuno-cambios ──────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'ayuno-cambios-check-'));
const g = globalThis as any;
writeFileSync(join(tmp, 'jwt-stub.mjs'), 'export const requireAuth = (h) => h;');
writeFileSync(join(tmp, 'supabase-admin-stub.mjs'), `
export function getSupabaseAdmin() {
  return { from(table) {
    globalThis.__calls.push(['from', table]);
    const api = {
      select(c) { globalThis.__calls.push(['select', c]); return api; },
      eq(k, v) { globalThis.__calls.push(['eq', k, v]); return api; },
      gte(k, v) { globalThis.__calls.push(['gte', k, v]); return api; },
      lte(k, v) { globalThis.__calls.push(['lte', k, v]); return api; },
      order() { return api; }, limit() { return api; },
      then(res, rej) {
        if (globalThis.__fail) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(res, rej);
        return Promise.resolve({ data: globalThis.__db, error: null }).then(res, rej);
      },
    };
    return api;
  } };
}`);
const out = join(tmp, 'bundle.mjs');
await build({
  entryPoints: [resolve('api/ayuno-cambios.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /(^|\/)jwt(\.js)?$/ }, () => ({ path: join(tmp, 'jwt-stub.mjs') }));
    b.onResolve({ filter: /(^|\/)supabase-admin(\.js)?$/ }, () => ({ path: join(tmp, 'supabase-admin-stub.mjs') }));
  } }],
});
const handler = (await import(pathToFileURL(out).href)).default;
async function call(query: any = {}, method = 'GET') {
  g.__calls = [];
  const res: any = { code: 200, body: null, setHeader() {}, status(c: number) { this.code = c; return this; }, json(b: any) { this.body = b; return this; }, end() { return this; } };
  const origErr = console.error; console.error = () => {};
  try { await handler({ method, query, headers: {} }, res); } finally { console.error = origErr; }
  return res;
}

g.__fail = false;
g.__db = [
  { id: 'a1', paciente_codigo: '100', paciente_nombre: 'PEREZ JUAN', area: 'Piso 4', habitacion: '401',
    event_key: 'HIN-1', resumen_prev: 'sin ayuno', resumen_new: '05/11 10:00', fecha_cambio: '2026-11-05T13:00:00Z' },
];

// Shape: antes/después, sin `detalle` (la frase del push no se manda).
let r = await call();
assert.strictEqual(r.code, 200);
assert.deepStrictEqual(r.body.cambios, [{
  id: 'a1', patientCode: '100', patientName: 'PEREZ JUAN', area: 'Piso 4', roomCode: '401',
  eventKey: 'HIN-1', prev: 'sin ayuno', next: '05/11 10:00', changedAt: '2026-11-05T13:00:00Z',
}]);
assert.ok(!String(g.__calls.find((c: any) => c[0] === 'select')?.[1]).includes('detalle'), 'no pide detalle');
assert.ok(g.__calls.some((c: any) => c[0] === 'from' && c[1] === 'ayuno_cambios'));
assert.ok(g.__calls.some((c: any) => c[0] === 'eq' && c[1] === 'entorno'), 'filtra por entorno');

// Filtros: rango en día AR + paciente; fechas inválidas se ignoran.
r = await call({ from: '2026-11-01', to: '2026-11-05', paciente: '100' });
assert.ok(g.__calls.some((c: any) => c[0] === 'gte' && c[1] === 'fecha_cambio' && c[2] === '2026-11-01T00:00:00-03:00'));
assert.ok(g.__calls.some((c: any) => c[0] === 'lte' && c[1] === 'fecha_cambio' && c[2] === '2026-11-05T23:59:59-03:00'));
assert.ok(g.__calls.some((c: any) => c[0] === 'eq' && c[1] === 'paciente_codigo' && c[2] === '100'));
r = await call({ from: "2026-11-01' or 1=1", to: 'x' });
assert.ok(!g.__calls.some((c: any) => c[0] === 'gte' || c[0] === 'lte'), 'fecha inválida no filtra');

// Error de la base → 500 (la vista muestra el error con reintento, no "sin registros").
g.__fail = true;
r = await call();
assert.strictEqual(r.code, 500);
assert.ok(!r.body.cambios);
g.__fail = false;

// Solo GET.
r = await call({}, 'POST');
assert.strictEqual(r.code, 405);

console.log('✓ check-ayuno-cambios: handler + lectura del antes/después OK');
