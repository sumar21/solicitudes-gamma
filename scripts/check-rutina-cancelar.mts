// Self-check de "Cancelar" una limpieza de rutina (permiso limpieza_rutina_cancelar + observación; 30/10/2026).
// Empaqueta el handler REAL de api/limpiezas-rutina.ts con stubs de los bordes (jwt, Supabase, caches de rol/usuario).
// Correr:  npx tsx scripts/check-rutina-cancelar.mts
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tmp = mkdtempSync(join(tmpdir(), 'rutina-cancelar-'));
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
      maybeSingle() { return api.then(r => ({ data: r.data?.[0] ?? null, error: r.error })); },
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
await build({ entryPoints: [resolve('api/limpiezas-rutina.ts')], bundle: true, format: 'esm', platform: 'node', outfile: join(tmp, 'api.mjs'), logLevel: 'error',
  plugins: [{ name: 'edges', setup(b) {
    stub(b, /(^|\/)jwt(\.js)?$/, 'jwt-stub.mjs'); stub(b, /(^|\/)push-utils(\.js)?$/, 'push-stub.mjs');
    stub(b, /(^|\/)role-cache(\.js)?$/, 'role-cache-stub.mjs'); stub(b, /(^|\/)user-cache(\.js)?$/, 'user-cache-stub.mjs');
    stub(b, /(^|\/)supabase-admin(\.js)?$/, 'supabase-admin-stub.mjs');
  } }] });
const handler = (await import(pathToFileURL(join(tmp, 'api.mjs')).href)).default as (req: any, res: any) => Promise<void>;
async function patch(body: any, perms: string[] = []) {
  g.__perms = perms; g.__push = [];
  const res: any = { code: 200, body: null, setHeader() {}, status(c: number) { this.code = c; return this; }, json(b: any) { this.body = b; return this; }, end() { return this; } };
  await handler({ method: 'PATCH', body, query: {}, headers: {}, user: { id: '7' } }, res);
  return res;
}
const FIN = '2026-10-30T12:00:00.000Z';
g.__rows = [
  { id: 'r1', entorno: 'TESTING', cama_label: 'Hab 501', estado: 'INICIADA', fecha_fin: null },
  { id: 'r2', entorno: 'TESTING', cama_label: 'Hab 502', estado: 'FINALIZADA', fecha_fin: FIN, finalizada_por: 'Azafata, Piso 5' },
];
const quien = { userName: 'Admisión', operador: 'Lucas' };
let r = await patch({ id: 'r1', action: 'ANULAR', motivo: 'cama equivocada', ...quien }, ['limpieza_rutina']);
assert(r.code === 403 && g.__rows[0].estado === 'INICIADA', 'sin limpieza_rutina_cancelar → 403');
r = await patch({ id: 'r1', action: 'ANULAR', motivo: '  ', ...quien }, ['limpieza_rutina_cancelar']);
assert(r.code === 400 && g.__rows[0].estado === 'INICIADA', 'sin observación → 400');
r = await patch({ id: 'r1', action: 'ANULAR', motivo: 'cama equivocada', ...quien }, ['limpieza_rutina_cancelar']);
assert.equal(r.code, 200, r.body?.error);
assert.equal(g.__rows[0].estado, 'ANULADA');
assert.equal(g.__rows[0].motivo_anulacion, 'cama equivocada — Admisión (Lucas)', 'observación + quién canceló');
assert(g.__rows[0].fecha_fin, 'abierta → se cierra con fecha_fin');
// Una ya finalizada (marcada por error) también se cancela y conserva su hora de fin y quién la finalizó.
r = await patch({ id: 'r2', action: 'ANULAR', motivo: 'no se hizo', ...quien }, ['limpieza_rutina_cancelar']);
assert(r.code === 200 && g.__rows[1].estado === 'ANULADA' && g.__rows[1].fecha_fin === FIN && g.__rows[1].finalizada_por === 'Azafata, Piso 5', 'finalizada → cancelada, conserva fin');
r = await patch({ id: 'r2', action: 'ANULAR', motivo: 'otra vez', ...quien }, ['limpieza_rutina_cancelar']);
assert.equal(r.code, 409, 'ya cancelada → 409');
// Finalizar sigue igual (sin permiso nuevo) y solo sobre una abierta.
g.__rows.push({ id: 'r3', entorno: 'TESTING', cama_label: 'Hab 503', estado: 'INICIADA', fecha_fin: null });
r = await patch({ id: 'r3', action: 'FINALIZAR', userName: 'Azafata' }, ['limpieza_rutina']);
assert(r.code === 200 && g.__rows[2].estado === 'FINALIZADA', 'finalizar no cambió');
r = await patch({ id: 'r3', action: 'FINALIZAR', userName: 'Azafata' }, ['limpieza_rutina']);
assert.equal(r.code, 409, 'finalizar una finalizada → 409');
console.log('OK — limpieza de rutina: cancelar');
