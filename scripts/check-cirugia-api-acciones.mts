// Self-check del handler REAL de api/cirugia.ts para las acciones del 20/10/2026: "Volver un paso"
// (RETROCEDER), "Ya se operó (fuera de MediFlow)" (POST previa) y ANULAR_PREVIA. Empaqueta el handler con
// esbuild y reemplaza SOLO los bordes (jwt, Supabase, caches de rol/usuario).
// Correr:  npx tsx scripts/check-cirugia-api-acciones.mts
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tmp = mkdtempSync(join(tmpdir(), 'cirugia-api-check-'));
const g = globalThis as any;

writeFileSync(join(tmp, 'jwt-stub.mjs'), 'export const requireAuth = (h) => h;');
writeFileSync(join(tmp, 'role-cache-stub.mjs'), `
export async function getRoleByName() { return { permissions: globalThis.__perms ?? [], filterByFloors: !!globalThis.__floors }; }
`);
writeFileSync(join(tmp, 'user-cache-stub.mjs'), `
export async function getUserAreasById() { return { perfil: 'Rol', assignedAreas: globalThis.__floors ?? [] }; }
`);
writeFileSync(join(tmp, 'supabase-admin-stub.mjs'), `
export function getSupabaseAdmin() {
  return {
    from(table) {
      const st = { table, op: null, payload: null, filters: [] };
      const f = (k) => (...a) => { st.filters.push([k, ...a]); return api; };
      const api = {
        select() { st.op ??= 'select'; return api; },
        eq: f('eq'), neq: f('neq'), not: f('not'), in: f('in'), or: f('or'), is: f('is'), gte: f('gte'), lte: f('lte'),
        limit() { return api; }, order() { return api; },
        update(p) { st.op = 'update'; st.payload = p; return api; },
        insert(p) { st.op = 'insert'; st.payload = p; return api; },
        maybeSingle() { return Promise.resolve({ data: globalThis.__cur ?? null, error: null }); },
        single() {
          globalThis.__ops.push({ table, op: st.op, payload: st.payload, filters: st.filters });
          return Promise.resolve({ data: { id: 'cx-nueva' }, error: null });
        },
        then(res, rej) {
          if (st.op === 'update' || st.op === 'insert') globalThis.__ops.push({ table, op: st.op, payload: st.payload, filters: st.filters });
          if (st.op === 'update' && table === 'cirugia_traslados') {
            if (globalThis.__updErr) return Promise.resolve({ data: null, error: globalThis.__updErr }).then(res, rej);
            return Promise.resolve({ data: Array.from({ length: globalThis.__updRows ?? 1 }, () => ({ id: 'x' })), error: null }).then(res, rej);
          }
          if (st.op === 'select') return Promise.resolve({ data: globalThis.__existente ?? [], error: null }).then(res, rej);
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        },
      };
      return api;
    },
  };
}
`);
const out = join(tmp, 'cirugia.bundle.mjs');
await build({
  entryPoints: [resolve('api/cirugia.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
  plugins: [{
    name: 'stub-cirugia-edges',
    setup(b) {
      const to = (re: RegExp, file: string) => b.onResolve({ filter: re }, () => ({ path: join(tmp, file) }));
      to(/(^|\/)jwt(\.js)?$/, 'jwt-stub.mjs');
      to(/(^|\/)role-cache(\.js)?$/, 'role-cache-stub.mjs');
      to(/(^|\/)user-cache(\.js)?$/, 'user-cache-stub.mjs');
      to(/(^|\/)supabase-admin(\.js)?$/, 'supabase-admin-stub.mjs');
    },
  }],
});
const handler = (await import(pathToFileURL(out).href)).default as (req: any, res: any) => Promise<void>;

async function call(method: string, body: any, o: { perms?: string[]; floors?: string[]; cur?: any; updRows?: number; updErr?: any; existente?: any[] } = {}) {
  g.__ops = []; g.__perms = o.perms ?? []; g.__floors = o.floors; g.__cur = o.cur ?? null;
  g.__updRows = o.updRows ?? 1; g.__updErr = o.updErr ?? null; g.__existente = o.existente ?? [];
  const res: any = { code: 200, body: null, setHeader() {}, status(c: number) { this.code = c; return this; }, json(b: any) { this.body = b; return this; }, end() { return this; } };
  await handler({ method, body, headers: {}, query: {}, user: { id: '7' } }, res);
  return { code: res.code as number, body: res.body, ops: g.__ops as any[] };
}
const upd = (ops: any[]) => ops.find(o => o.op === 'update' && o.table === 'cirugia_traslados');
const evento = (ops: any[]) => ops.find(o => o.op === 'insert' && o.table === 'cirugia_eventos');

const P8 = 'Internacion 8° Piso HPR', ITR = 'Internación Transitoria HPR';

// ── RETROCEDER ───────────────────────────────────────────────────────────────
const enTraslado = { estado: 'EN_TRASLADO', cama_origen: 'Habitacion 817 HPR - Cama 01', area: ITR, paciente_codigo: '1001', tipo: null };
// Pide el permiso del paso que se deshace (EN_TRASLADO lo marca cirugia_entregar), no otro.
let r = await call('PATCH', { id: 'cx-1', action: 'RETROCEDER' }, { perms: ['cirugia_buscar'], cur: enTraslado });
assert.equal(r.code, 403, 'sin el permiso del paso deshecho → 403');
r = await call('PATCH', { id: 'cx-1', action: 'RETROCEDER', userId: '7', userName: 'Enf' }, { perms: ['cirugia_entregar'], cur: enTraslado });
assert.equal(r.code, 200, r.body?.error);
assert.equal(upd(r.ops).payload.estado, 'VAN_A_BUSCAR', 'vuelve al paso anterior');
assert(!('fecha_cierre' in upd(r.ops).payload), 'no cierra');
assert(upd(r.ops).filters.some((x: any[]) => x[0] === 'eq' && x[1] === 'estado' && x[2] === 'EN_TRASLADO'), 'CAS por el estado leído');
assert.equal(evento(r.ops).payload.tipo, 'RETROCESO', 'evento propio (no dispara el push de un paso)');
assert.deepEqual([evento(r.ops).payload.meta.de, evento(r.ops).payload.meta.a], ['EN_TRASLADO', 'VAN_A_BUSCAR'], 'meta de → a');
// Sector: el del paciente HOY también vale (la operatoria sigue al paciente).
r = await call('PATCH', { id: 'cx-1', action: 'RETROCEDER', areaActual: P8 }, { perms: ['cirugia_entregar'], floors: [P8], cur: enTraslado });
assert.equal(r.code, 200, 'sector actual del paciente autoriza');
r = await call('PATCH', { id: 'cx-1', action: 'RETROCEDER' }, { perms: ['cirugia_entregar'], floors: [P8], cur: enTraslado });
assert.equal(r.code, 403, 'otro sector → 403');
// LISTO no tiene anterior; terminal tampoco. 409 aunque no tenga cirugia_cancelar (antes daba 403).
r = await call('PATCH', { id: 'cx-1', action: 'RETROCEDER' }, { perms: ['cirugia_listo'], cur: { ...enTraslado, estado: 'LISTO_PARA_CIRUGIA' } });
assert(r.code === 409 && !upd(r.ops), 'LISTO → 409 sin escribir');
// `desde`: el cliente manda el estado que estaba viendo. Si cambió (reintento, otra persona, avance de otro) → 409.
r = await call('PATCH', { id: 'cx-1', action: 'RETROCEDER', desde: 'EN_TRASLADO' }, { perms: ['cirugia_entregar'], cur: enTraslado });
assert(r.code === 200 && upd(r.ops).payload.estado === 'VAN_A_BUSCAR', 'desde coincide → retrocede');
r = await call('PATCH', { id: 'cx-1', action: 'RETROCEDER', desde: 'EN_TRASLADO' }, { perms: ['cirugia_buscar', 'cirugia_entregar'], cur: { ...enTraslado, estado: 'VAN_A_BUSCAR' } });
assert(r.code === 409 && !upd(r.ops), 'reintento (ya retrocedió) → 409, no retrocede dos pasos');
r = await call('PATCH', { id: 'cx-1', action: 'RETROCEDER', desde: 'EN_TRASLADO' }, { perms: ['cirugia_entregar', 'cirugia_operar'], cur: { ...enTraslado, estado: 'EN_CIRUGIA' } });
assert(r.code === 409 && !upd(r.ops), 'otro avanzó mientras tanto → 409, no le deshace el paso');
r = await call('PATCH', { id: 'cx-1', action: 'RETROCEDER' }, { perms: ['cirugia_tolerancia', 'cirugia_cancelar'], cur: { ...enTraslado, estado: 'TOLERANCIA_EVALUADA' } });
assert(r.code === 409 && !upd(r.ops), 'terminal → 409');
// CAS perdido → 409 sin evento. Volver a "En cirugía" con otra operatoria en curso del paciente → 409 claro.
r = await call('PATCH', { id: 'cx-1', action: 'RETROCEDER' }, { perms: ['cirugia_entregar'], cur: enTraslado, updRows: 0 });
assert(r.code === 409 && !evento(r.ops), 'CAS perdido');
r = await call('PATCH', { id: 'cx-1', action: 'RETROCEDER' }, { perms: ['cirugia_devolver'], cur: { ...enTraslado, estado: 'EN_DEVOLUCION' }, updErr: { code: '23505', message: 'dup' } });
assert(r.code === 409 && /otra cirugía en curso/.test(r.body.error), 'choque con el candado por paciente → 409');

// ── POST previa ("Ya se operó fuera de MediFlow") ────────────────────────────
const previa = { previa: true, pacienteCodigo: '1001', pacienteNombre: 'PACIENTE A', camaOrigen: 'Habitacion 817 HPR - Cama 01', area: P8, eventKey: 'HIN-55', userId: '7' };
// Permiso propio del ABM (26/10/2026: Coordinación, no Enfermería). Ni "Listo" ni "Va a cirugía" alcanzan.
r = await call('POST', previa, { perms: ['cirugia_listo', 'cirugia_marcar', 'cirugia_tolerancia'] });
assert(r.code === 403 && r.ops.length === 0, 'sin cirugia_previa → 403 (aunque tenga listo/marcar)');
r = await call('POST', previa, { perms: ['cirugia_previa'], floors: ['Internacion 4° Piso HPR'] });
assert(r.code === 403 && r.ops.length === 0, 'cirugia_previa de otro sector → 403');
r = await call('POST', previa, { perms: ['cirugia_previa'] });
assert.equal(r.code, 200, r.body?.error);
const ins = r.ops.find(o => o.op === 'insert' && o.table === 'cirugia_traslados');
assert.deepEqual(
  { estado: ins.payload.estado, tipo: ins.payload.tipo, event_key: ins.payload.event_key, paciente_codigo: ins.payload.paciente_codigo },
  { estado: 'TOLERANCIA_EVALUADA', tipo: 'PREVIA_EXTERNA', event_key: 'HIN-55', paciente_codigo: '1001' }, 'completada previa de esta internación');
assert(ins.payload.fecha_cierre, 'cerrada');
assert(!evento(r.ops), 'sin eventos: no dispara "Iniciar dieta"');
r = await call('POST', previa, { perms: ['cirugia_previa'], existente: [{ id: 'cx-vieja' }] });
assert(r.code === 200 && r.body.id === 'cx-vieja' && !r.ops.some(o => o.op === 'insert'), 'idempotente por paciente + internación');
// Sin internación (o inválida) → 400: una previa con event_key NULL contaría en todas las internaciones (QA v1.12.1).
r = await call('POST', { ...previa, eventKey: "x' or 1=1" }, { perms: ['cirugia_previa'] });
assert(r.code === 400 && !r.ops.some(o => o.op === 'insert'), 'eventKey inválido → 400');
r = await call('POST', { ...previa, eventKey: undefined }, { perms: ['cirugia_previa'] });
assert(r.code === 400 && !r.ops.some(o => o.op === 'insert'), 'sin eventKey → 400');
r = await call('POST', { ...previa, pacienteCodigo: '' }, { perms: ['cirugia_previa'] });
assert.equal(r.code, 400, 'sin código de paciente → 400');

// ── ANULAR_PREVIA ────────────────────────────────────────────────────────────
const prev = { estado: 'TOLERANCIA_EVALUADA', cama_origen: 'Habitacion 817 HPR - Cama 01', area: P8, paciente_codigo: '1001', tipo: 'PREVIA_EXTERNA' };
r = await call('PATCH', { id: 'cx-p', action: 'ANULAR_PREVIA' }, { perms: ['cirugia_listo', 'cirugia_marcar'], cur: prev });
assert.equal(r.code, 403, 'anular pide cirugia_previa');
r = await call('PATCH', { id: 'cx-p', action: 'ANULAR_PREVIA' }, { perms: ['cirugia_previa'], cur: prev });
assert.equal(r.code, 200, r.body?.error);
assert.equal(upd(r.ops).payload.estado, 'CANCELADO', 'queda cancelada (constancia)');
assert.equal(upd(r.ops).payload.motivo_cancelacion, 'Cirugía previa anulada (registrada por error)');
// Una cirugía REAL de MediFlow no se anula por acá.
r = await call('PATCH', { id: 'cx-p', action: 'ANULAR_PREVIA' }, { perms: ['cirugia_previa'], cur: { ...prev, tipo: null } });
assert(r.code === 409 && !upd(r.ops), 'cirugía real → 409');

console.log('OK — api/cirugia: volver un paso + cirugía previa');
