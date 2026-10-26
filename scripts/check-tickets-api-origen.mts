// Self-check del handler REAL de api/tickets.ts para el origen automático y "Restablecer destino"
// (20/10/2026): authz, CAS (filtros del UPDATE), campos que fija el servidor y evento de auditoría.
// Empaqueta el handler con esbuild y reemplaza SOLO los bordes (jwt, Supabase, caches de rol/usuario).
// Correr:  npx tsx scripts/check-tickets-api-origen.mts
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tmp = mkdtempSync(join(tmpdir(), 'tickets-origen-check-'));
const g = globalThis as any;

writeFileSync(join(tmp, 'jwt-stub.mjs'), 'export const requireAuth = (h) => h;');
writeFileSync(join(tmp, 'role-cache-stub.mjs'), `
export async function getRoleByName() { return { permissions: globalThis.__perms ?? [], filterByFloors: false }; }
`);
writeFileSync(join(tmp, 'user-cache-stub.mjs'), `
export async function getUserAreasById() { return { perfil: 'Rol', assignedAreas: [] }; }
`);
writeFileSync(join(tmp, 'push-utils-stub.mjs'), 'export const effectiveAreaNames = (o, d) => ({ origin: o, dest: d });');
// Cada query registra tabla, operación, payload y filtros. El UPDATE devuelve __updRows filas (CAS).
writeFileSync(join(tmp, 'supabase-admin-stub.mjs'), `
export function getSupabaseAdmin() {
  return {
    from(table) {
      const st = { table, op: null, payload: null, filters: [] };
      const f = (k) => (...a) => { st.filters.push([k, ...a]); return api; };
      const api = {
        select() { st.op ??= 'select'; return api; },
        eq: f('eq'), neq: f('neq'), not: f('not'), in: f('in'), or: f('or'), is: f('is'),
        limit() { return api; }, order() { return api; }, range() { return api; },
        update(p) { st.op = 'update'; st.payload = p; return api; },
        insert(p) { globalThis.__ops.push({ table, op: 'insert', payload: p }); return Promise.resolve({ error: null }); },
        maybeSingle() { return Promise.resolve({ data: globalThis.__cur ?? null, error: null }); },
        then(res, rej) {
          if (st.op === 'update') {
            globalThis.__ops.push({ table, op: 'update', payload: st.payload, filters: st.filters });
            return Promise.resolve({ data: Array.from({ length: globalThis.__updRows ?? 1 }, () => ({ id_univoco: 'x' })), error: null }).then(res, rej);
          }
          return Promise.resolve({ data: [], error: null }).then(res, rej);
        },
      };
      return api;
    },
  };
}
`);
const out = join(tmp, 'tickets.bundle.mjs');
await build({
  entryPoints: [resolve('api/tickets.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
  plugins: [{
    name: 'stub-tickets-edges',
    setup(b) {
      const to = (re: RegExp, file: string) => b.onResolve({ filter: re }, () => ({ path: join(tmp, file) }));
      to(/(^|\/)jwt(\.js)?$/, 'jwt-stub.mjs');
      to(/(^|\/)role-cache(\.js)?$/, 'role-cache-stub.mjs');
      to(/(^|\/)user-cache(\.js)?$/, 'user-cache-stub.mjs');
      to(/(^|\/)supabase-admin(\.js)?$/, 'supabase-admin-stub.mjs');
      to(/(^|\/)push-utils(\.js)?$/, 'push-utils-stub.mjs');
    },
  }],
});
const handler = (await import(pathToFileURL(out).href)).default as (req: any, res: any) => Promise<void>;

async function patch(body: any, { perms = [] as string[], cur = null as any, updRows = 1 } = {}) {
  g.__ops = []; g.__perms = perms; g.__cur = cur; g.__updRows = updRows;
  const res: any = { code: 200, body: null, setHeader() {}, status(c: number) { this.code = c; return this; }, json(b: any) { this.body = b; return this; }, end() { return this; } };
  await handler({ method: 'PATCH', body, headers: {}, query: {}, user: { id: '7' } }, res);
  return { code: res.code as number, body: res.body, ops: g.__ops as any[] };
}

const A = 'Habitacion 407 HPR - Cama 01', B = 'Habitacion 407 HPR - Cama 02';
const hace = (ms: number) => new Date(Date.now() - ms).toISOString();

// ── Origen automático ────────────────────────────────────────────────────────
const ro = (o: any = {}) => ({ id: 'TSL-1', reubicarOrigen: { from: A, to: B, toCode: 'C2', toArea: 'Internacion 4° Piso HPR', patientCode: '1001', mapaEdadMs: 10_000, ...o }, usuario: 'Admisión 1', usuarioId: '7', version: 'v1' });
const curRo = { status: 'Presolicitud', cama_origen: A, cama_destino: null, codigo_paciente: '1001', updated_at: hace(60_000) };

let r = await patch(ro(), { perms: [], cur: curRo });
assert.equal(r.code, 403, 'sin ningún permiso de traslados → 403');
assert.equal(r.ops.length, 0, '403 no escribe');

r = await patch(ro(), { perms: ['editar_ticket'], cur: curRo });
assert.equal(r.code, 200, r.body?.error);
const upd = r.ops.find(o => o.op === 'update');
assert.deepEqual(upd.payload.cama_origen, B, 'nuevo origen');
assert.equal(upd.payload.cama_origen_codigo, 'C2');
assert.equal(upd.payload.cama_origen_area, 'Internacion 4° Piso HPR');
assert(!('status' in upd.payload) && !('cama_destino' in upd.payload), 'no toca estado ni destino');
assert(upd.filters.some((x: any[]) => x[0] === 'eq' && x[1] === 'cama_origen' && x[2] === A), 'CAS por el origen leído');
assert(upd.filters.some((x: any[]) => x[0] === 'in' && x[1] === 'status' && x[2].includes('Presolicitud') && !x[2].includes('En Traslado')), 'CAS: solo si todavía no salió');
const evt = r.ops.find(o => o.op === 'insert' && o.table === 'traslado_eventos');
assert(evt && evt.payload.tipo === `Modificacion - Origen: ${A} → ${B} - Motivo: Cambio de cama en PROGAL (automático)`, 'evento de auditoría');
assert.equal(evt.payload.usuario_id, 7);

// Otro dispositivo ganó la carrera entre la lectura y el UPDATE → 409 y sin evento.
r = await patch(ro(), { perms: ['crear_pre_ticket'], cur: curRo, updRows: 0 });
assert.equal(r.code, 409, 'CAS perdido → 409');
assert(!r.ops.some(o => o.op === 'insert'), 'CAS perdido: sin evento');
// Ya reubicado → noop sin escribir.
r = await patch(ro(), { perms: ['crear_ticket'], cur: { ...curRo, cama_origen: B } });
assert(r.code === 200 && r.body.unchanged === true && r.ops.length === 0, 'ya reubicado → noop');
// Mapa anterior al último cambio de la fila → 409 sin escribir.
r = await patch(ro({ mapaEdadMs: 120_000 }), { perms: ['completar_pre_ticket'], cur: curRo });
assert(r.code === 409 && r.ops.length === 0, 'mapa viejo → 409');
r = await patch(ro({ mapaEdadMs: 200_000 }), { perms: ['completar_pre_ticket'], cur: { ...curRo, updated_at: hace(3_600_000) } });
assert(r.code === 409 && r.ops.length === 0, 'mapa de más de 3 min (cache stale) → 409');

// ── Restablecer destino ──────────────────────────────────────────────────────
const rd = { id: 'TSL-2', restablecerDestino: true, version: 'v1', destination: 'NO DEBE USARSE', status: 'Consolidado', motivo: 'Cama para urgencia', usuario: 'Admisión 1', usuarioId: '7' };
const curRd = { status: 'Habitacion Lista', workflow: 'PRE_TICKET', intervino_azafata: 'NO', urgencia: false, cama_destino: 'Habitacion 501 HPR - Cama 01' };

r = await patch(rd, { perms: ['editar_ticket'], cur: curRd });
assert.equal(r.code, 403, 'sin completar_pre_ticket → 403');
r = await patch(rd, { perms: ['completar_pre_ticket'], cur: curRd });
assert.equal(r.code, 200, r.body?.error);
const u2 = r.ops.find(o => o.op === 'update');
assert.deepEqual(
  { status: u2.payload.status, cama_destino: u2.payload.cama_destino, cama_destino_codigo: u2.payload.cama_destino_codigo,
    cama_destino_status: u2.payload.cama_destino_status, cama_destino_area: u2.payload.cama_destino_area, hab_compartida: u2.payload.hab_compartida,
    intervino_azafata: u2.payload.intervino_azafata },
  { status: 'Presolicitud', cama_destino: null, cama_destino_codigo: null, cama_destino_status: null, cama_destino_area: null, hab_compartida: false,
    intervino_azafata: 'NO' },
  'los campos los fija el servidor (ignora destination/status del body)');
assert(u2.filters.some((x: any[]) => x[0] === 'eq' && x[1] === 'status' && x[2] === 'Habitacion Lista'), 'CAS por estado');
// El evento de la trayectoria lo deja el servidor, una sola vez y solo si ganó el CAS (QA v1.12.1).
const ev2 = r.ops.filter(o => o.op === 'insert' && o.table === 'traslado_eventos');
assert(ev2.length === 1 && ev2[0].payload.tipo === 'Modificacion - Destino: Habitacion 501 HPR - Cama 01 → (sin destino) - Motivo: Destino restablecido — Cama para urgencia', 'evento del servidor con el motivo');
// Con "Habitación lista" marcada por la azafata también se puede (26/10/2026): se reinicia la intervención.
r = await patch(rd, { perms: ['completar_pre_ticket'], cur: { ...curRd, intervino_azafata: 'SI' } });
assert(r.code === 200 && r.ops.find(o => o.op === 'update').payload.intervino_azafata === 'NO', 'azafata marcó Habitación lista → se puede, y se reinicia');
// En Traslado ya no (el paciente salió); y si la azafata lo inicia entre la lectura y el UPDATE, el CAS por estado → 409.
r = await patch(rd, { perms: ['completar_pre_ticket'], cur: { ...curRd, status: 'En Traslado', intervino_azafata: 'SI' } });
assert(r.code === 409 && r.ops.length === 0, 'En Traslado → 409');
r = await patch(rd, { perms: ['completar_pre_ticket'], cur: curRd, updRows: 0 });
assert(r.code === 409 && !r.ops.some(o => o.op === 'insert'), 'la azafata inició el traslado justo antes (CAS) → 409 sin evento');
r = await patch(rd, { perms: ['completar_pre_ticket'], cur: { ...curRd, status: 'Presolicitud' } });
assert(r.code === 200 && r.body.unchanged && r.ops.length === 0, 'ya en Presolicitud → noop sin evento');

// ── Acción de azafata sobre un pedido fuera de circuito (QA v1.12.1) ─────────
// Con la lista atrasada, "Habitación lista" sobre un pre-ticket al que le restablecieron el destino lo revivía.
const habLista = { id: 'TSL-2', status: 'Habitacion Lista', intervenedByHostess: 'SI', destinationBedStatus: 'Asignada' };
r = await patch(habLista, { perms: [], updRows: 0 });
assert.equal(r.code, 409, 'el UPDATE no aplicó (Presolicitud/cerrado) → 409');
const u3 = r.ops.find(o => o.op === 'update');
assert(u3.filters.some((x: any[]) => x[0] === 'not' && x[1] === 'status' && x[2] === 'in' && /Presolicitud/.test(x[3]) && /Cancelado/.test(x[3]) && /Consolidado/.test(x[3])), 'filtro: fuera de Presolicitud/cerrados');
r = await patch(habLista, { perms: [], updRows: 1 });
assert.equal(r.code, 200, 'en circuito → 200');
// Una acción de Admisión (sin intervenedByHostess) no lleva ese filtro.
r = await patch({ id: 'TSL-2', observations: 'x' }, { perms: [], updRows: 0 });
assert(r.code === 200 && !r.ops.find(o => o.op === 'update').filters.some((x: any[]) => x[0] === 'not'), 'edición de Admisión: sin filtro de azafata');

console.log('OK — api/tickets: origen automático + restablecer destino');
