// Self-check de "Volver a En preparación" (rollback de limpieza, permiso limpieza_revertir; 29/10/2026) y del
// nombre del cambio de turno en el historial de limpiezas. Empaqueta el handler REAL de api/limpiezas.ts y el
// hook real (mergeBeds) con esbuild, con stubs de los bordes (jwt, Supabase, push, caches de rol/usuario).
// Correr:  npx tsx scripts/check-limpieza-revertir.mts
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tmp = mkdtempSync(join(tmpdir(), 'limpieza-revertir-'));
const g = globalThis as any;
writeFileSync(join(tmp, 'jwt-stub.mjs'), 'export const requireAuth = (h) => h;');
writeFileSync(join(tmp, 'push-stub.mjs'), 'export async function sendPushToSubscribers(p) { globalThis.__push.push(p); }');
writeFileSync(join(tmp, 'role-cache-stub.mjs'), 'export async function getRoleByName() { return { permissions: globalThis.__perms ?? [], filterByFloors: false }; }');
writeFileSync(join(tmp, 'user-cache-stub.mjs'), "export async function getUserAreasById() { return { perfil: 'Rol', assignedAreas: [] }; }");
// Tabla en memoria: select/eq/limit sobre __rows; update/insert la modifican.
writeFileSync(join(tmp, 'supabase-admin-stub.mjs'), `
export function getSupabaseAdmin() {
  return { from() {
    const st = { op: 'select', payload: null, f: [] };
    const api = {
      select() { return api; }, eq(k, v) { st.f.push([k, v]); return api; }, gte() { return api; }, lte() { return api; }, limit() { return api; },
      update(p) { st.op = 'update'; st.payload = p; return api; },
      insert(p) { st.op = 'insert'; st.payload = p; return api; },
      single() { return api.then(r => ({ data: r.data?.[0] ?? null, error: r.error })); },
      then(res, rej) {
        const match = r => st.f.every(([k, v]) => String(r[k]) === String(v));
        let out;
        if (st.op === 'insert') { const row = { id: 'id' + (globalThis.__rows.length + 1), ...st.payload }; globalThis.__rows.push(row); out = [row]; }
        else if (st.op === 'update') { out = globalThis.__rows.filter(match); out.forEach(r => Object.assign(r, st.payload)); }
        else out = globalThis.__rows.filter(match);
        return Promise.resolve({ data: out, error: null }).then(res, rej);
      },
    };
    return api;
  } };
}`);
writeFileSync(join(tmp, 'supabase-client-stub.mjs'), 'export const supabase = {}; export const resetSupabasePase = () => {};');
const stub = (b: any, re: RegExp, file: string) => b.onResolve({ filter: re }, () => ({ path: join(tmp, file) }));
await build({ entryPoints: [resolve('api/limpiezas.ts')], bundle: true, format: 'esm', platform: 'node', outfile: join(tmp, 'api.mjs'), logLevel: 'error',
  plugins: [{ name: 'edges', setup(b) {
    stub(b, /(^|\/)jwt(\.js)?$/, 'jwt-stub.mjs'); stub(b, /(^|\/)push-utils(\.js)?$/, 'push-stub.mjs');
    stub(b, /(^|\/)role-cache(\.js)?$/, 'role-cache-stub.mjs'); stub(b, /(^|\/)user-cache(\.js)?$/, 'user-cache-stub.mjs');
    stub(b, /(^|\/)supabase-admin(\.js)?$/, 'supabase-admin-stub.mjs');
  } }] });
await build({ entryPoints: [resolve('hooks/useHospitalState.ts')], bundle: true, format: 'esm', platform: 'node', outfile: join(tmp, 'hook.mjs'), logLevel: 'error',
  define: { 'import.meta.env': '{}' }, plugins: [{ name: 'sb', setup(b) { stub(b, /(^|\/)lib\/supabase$/, 'supabase-client-stub.mjs'); } }] });
const handler = (await import(pathToFileURL(join(tmp, 'api.mjs')).href)).default as (req: any, res: any) => Promise<void>;
const { mergeBeds } = await import(pathToFileURL(join(tmp, 'hook.mjs')).href) as { mergeBeds: (...a: any[]) => any[] };

async function call(method: string, body: any, perms: string[] = [], query: any = {}) {
  g.__perms = perms; g.__push = [];
  const res: any = { code: 200, body: null, setHeader() {}, status(c: number) { this.code = c; return this; }, json(b: any) { this.body = b; return this; }, end() { return this; } };
  await handler({ method, body, query, headers: {}, user: { id: '7' } }, res);
  return res;
}
const C517 = 'Habitación 517 HPR - Cama 02';
const base = { bedLabel: C517, bedCode: '2', roomCode: '517', area: 'Internacion 5° Piso HPR', userId: '36', userName: 'Azafata, Piso 5', operador: 'Susana Ledesma', version: 'v' };

// ── API ──────────────────────────────────────────────────────────────────────
g.__rows = [];
let r = await call('POST', { ...base, revertir: true }, ['confirmar_limpieza']);
assert(r.code === 403 && g.__rows.length === 0, 'sin limpieza_revertir → 403 sin escribir');
// Caso 517: ya consolidada (sin activa) → queda la marca SUCIA activa, sin push.
r = await call('POST', { ...base, revertir: true }, ['limpieza_revertir']);
assert.equal(r.code, 200, r.body?.error);
assert.deepEqual(g.__rows.map((x: any) => [x.status, x.motivo_cierre, x.operador]), [['Activo', 'SUCIA', 'Susana Ledesma']], 'marca SUCIA activa con el nombre del turno');
assert.equal(g.__push.length, 0, 'sin push "Habitación Limpia"');
r = await call('POST', { ...base, revertir: true }, ['limpieza_revertir']);
assert(r.body.unchanged && g.__rows.length === 1, 'idempotente');
// GET activas: la marca viaja como sucia.
r = await call('GET', null);
assert(r.body.cleanings[0].sucia === true && r.body.cleanings[0].operador === 'Susana Ledesma', 'GET activas: sucia + operador');
// La azafata la limpia de nuevo → la marca se cierra (queda en el historial) y nace una limpieza activa normal.
r = await call('POST', { ...base, operador: 'Marisa Ortiz' }, ['confirmar_limpieza']);
assert.equal(r.code, 200);
assert.deepEqual(g.__rows.map((x: any) => [x.status, x.motivo_cierre ?? null]), [['Inactivo', 'SUCIA'], ['Activo', null]], 'SUCIA cerrada + limpieza nueva');
assert.equal(g.__push.length, 1, 'la limpieza nueva sí avisa');
// Sin consolidar todavía: volver a preparación anula la limpieza activa y deja la marca.
r = await call('POST', { ...base, revertir: true }, ['limpieza_revertir']);
assert.deepEqual(g.__rows.map((x: any) => [x.status, x.motivo_cierre ?? null]), [['Inactivo', 'SUCIA'], ['Inactivo', 'ANULADA'], ['Activo', 'SUCIA']], 'anula la activa + marca');
// Historial: trae el nombre del cambio de turno además de la cuenta.
r = await call('GET', null, [], { history: '1' });
const h = r.body.cleanings.find((x: any) => x.reason === 'ANULADA');
assert(h.operador === 'Marisa Ortiz' && h.by === 'Azafata, Piso 5', 'historial: operador + cuenta');

// ── Overlay del mapa (mergeBeds real) ─────────────────────────────────────────
const cama = (status: string) => ({ id: C517, label: C517, area: 'Internacion 5° Piso HPR', status });
const sucia = new Map([[C517, { by: 'Azafata, Piso 5', byId: '36', at: '2026-10-28T16:00:00Z', spItemId: 'x', operador: 'Susana Ledesma', sucia: true }]]);
let b = mergeBeds([cama('Disponible')], [], sucia)[0];
assert.equal(b.status, 'En preparación', 'PROGAL Disponible + marca SUCIA → En preparación');
assert.equal(b.vueltaPreparacion?.by, 'Susana Ledesma (Azafata, Piso 5)', 'quién: turno + cuenta');
assert(!b.cleaned, 'no es una limpieza');
b = mergeBeds([cama('Ocupada')], [], sucia)[0];
assert.equal(b.status, 'Ocupada', 'ocupada: la marca no pisa');
const limpia = new Map([[C517, { by: 'Azafata, Piso 5', byId: '36', at: 'x', spItemId: 'y', operador: 'Marisa Ortiz' }]]);
b = mergeBeds([cama('En preparación')], [], limpia)[0];
assert(b.cleaned && b.status === 'Disponible' && b.cleanedBy === 'Marisa Ortiz (Azafata, Piso 5)', 'limpieza normal: quién con el nombre del turno');

console.log('OK — limpieza: volver a En preparación + nombre del turno');
