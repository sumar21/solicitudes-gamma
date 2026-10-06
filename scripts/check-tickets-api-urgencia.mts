// Self-check del handler REAL de api/tickets.ts para URGENCIAS (gate de consolidación, authz, validaciones,
// coerción de flags e inmutabilidad). Empaqueta el handler con esbuild y reemplaza SOLO los bordes
// (jwt, cliente de Supabase, caches de rol/usuario) por stubs que capturan lo que se escribiría.
// Correr:  npx tsx scripts/check-tickets-api-urgencia.mts
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tmp = mkdtempSync(join(tmpdir(), 'tickets-api-check-'));
const g = globalThis as any;

// ── stubs de los bordes ──────────────────────────────────────────────────────
writeFileSync(join(tmp, 'jwt-stub.mjs'), 'export const requireAuth = (h) => h;');
writeFileSync(join(tmp, 'role-cache-stub.mjs'), `
export async function getRoleByName() { return { permissions: globalThis.__perms ?? [], filterByFloors: false }; }
`);
writeFileSync(join(tmp, 'user-cache-stub.mjs'), `
export async function getUserAreasById() { return { perfil: 'Rol', assignedAreas: [] }; }
`);
// api/tickets.ts solo usa effectiveAreaNames de push-utils (que arrastra web-push y gamma-client, este último
// exige GAMMA_VM_URL al importarse): se stubea. Para estos casos no hay filtro de piso.
writeFileSync(join(tmp, 'push-utils-stub.mjs'), 'export const effectiveAreaNames = (o, d) => ({ origin: o, dest: d });');
writeFileSync(join(tmp, 'supabase-admin-stub.mjs'), `
export function getSupabaseAdmin() {
  return {
    from() {
      const st = { op: null, payload: null };
      const api = {
        select() { st.op ??= 'select'; return api; },
        eq() { return api; }, neq() { return api; }, not() { return api; }, in() { return api; },
        or() { return api; }, limit() { return api; }, order() { return api; }, range() { return api; },
        upsert(row) { globalThis.__ops.push({ op: 'upsert', row }); return Promise.resolve({ error: null }); },
        update(f) { st.op = 'update'; st.payload = f; return api; },
        maybeSingle() { return Promise.resolve({ data: globalThis.__cur ?? null, error: null }); },
        then(res, rej) {
          if (st.op === 'update') globalThis.__ops.push({ op: 'update', fields: st.payload });
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

async function call(method: string, body: any, { perms = [], cur = null }: { perms?: string[]; cur?: any } = {}) {
  g.__ops = []; g.__perms = perms; g.__cur = cur;
  const res: any = { code: 200, body: null, setHeader() {}, status(c: number) { this.code = c; return this; }, json(b: any) { this.body = b; return this; }, end() { return this; } };
  await handler({ method, body, headers: {}, query: {}, user: { id: '7' } }, res);
  return { code: res.code as number, body: res.body, ops: g.__ops as any[] };
}

// NO internado: sin código de paciente. Lo que mande como origen se pisa con el sentinela.
const urgBody = (o: any = {}) => ({
  id: 'TSL-U1', patientName: 'Pérez Juan', origin: 'LO QUE MANDE EL CLIENTE', destination: 'Hab 405 - Cama 1',
  status: 'Por Consolidar', workflow: 'INTERNAL', urgencia: true, ...o,
});

// ── POST urgencia ────────────────────────────────────────────────────────────
// sin el permiso crear_pre_ticket → 403 y NO se escribe nada
let r = await call('POST', urgBody(), { perms: ['crear_ticket'] });
assert.equal(r.code, 403, 'urgencia sin crear_pre_ticket → 403');
assert.equal(r.ops.length, 0, 'y no escribe');

// con permiso: pasa, y el servidor FUERZA los campos que el cliente no puede elegir
r = await call('POST', urgBody(), { perms: ['crear_pre_ticket'] });
assert.equal(r.code, 201, 'urgencia con permiso → 201');
const row = r.ops[0].row;
assert.equal(row.urgencia, true);
assert.equal(row.cama_origen, 'Urgencia / Ingreso directo', 'origen = sentinela, no lo que mandó el cliente');
assert.equal(row.codigo_paciente, null, 'sin código de paciente al nacer');
assert.equal(row.workflow, 'PRE_TICKET', 'workflow forzado');
assert.equal(row.paciente_declarado, 'Pérez Juan', 'queda constancia de lo declarado');
assert.equal(row.evento_internacion, null);
assert.equal(row.motivo_cambio, 'Ingreso por urgencia', 'motivo por defecto');

// código sin cama de origen real (origen vacío o sentinela) → sigue siendo NO internado: el código se descarta
for (const origin of ['', 'Urgencia / Ingreso directo', null]) {
  r = await call('POST', urgBody({ origin, patientCode: 'HACK-1', eventoInternacion: 'X-1' }), { perms: ['crear_pre_ticket'] });
  assert.equal(r.code, 201);
  assert.equal(r.ops[0].row.codigo_paciente, null, `origen ${JSON.stringify(origin)} + código → código descartado`);
  assert.equal(r.ops[0].row.evento_internacion, null);
  assert.equal(r.ops[0].row.cama_origen, 'Urgencia / Ingreso directo');
}

// INTERNADO (06/10/2026): cama de origen real + código → se conservan; sin nombre declarado
r = await call('POST', urgBody({ patientName: 'GOMEZ ANA', origin: 'Habitación 512 HPR - Cama 01', patientCode: '4471', eventoInternacion: 'HIN-77' }), { perms: ['crear_pre_ticket'] });
assert.equal(r.code, 201, 'urgencia de internado → 201');
const ri = r.ops[0].row;
assert.equal(ri.cama_origen, 'Habitación 512 HPR - Cama 01', 'conserva la cama real');
assert.equal(ri.codigo_paciente, '4471', 'conserva el código');
assert.equal(ri.evento_internacion, 'HIN-77', 'conserva el evento');
assert.equal(ri.paciente_declarado, null, 'no hay nombre "declarado": viene del mapa');
assert.equal(ri.status, 'Por Consolidar'); assert.equal(ri.workflow, 'PRE_TICKET'); assert.equal(ri.urgencia, true);
// internado sin permiso → 403 igual
r = await call('POST', urgBody({ origin: 'Habitación 512 HPR - Cama 01', patientCode: '4471' }), { perms: ['crear_ticket'] });
assert.equal(r.code, 403, 'internado sin crear_pre_ticket → 403');
// destino = su propia cama → 400
r = await call('POST', urgBody({ origin: 'Hab 405 - Cama 1', patientCode: '4471' }), { perms: ['crear_pre_ticket'] });
assert.equal(r.code, 400, 'destino igual al origen → 400'); assert.equal(r.ops.length, 0);

// validaciones → 400
for (const [label, b] of [
  ['nombre corto', urgBody({ patientName: 'Al' })],
  ['sin destino', urgBody({ destination: null })],
  ['status que no es Por Consolidar', urgBody({ status: 'Habitacion Lista' })],
] as const) {
  r = await call('POST', b, { perms: ['crear_pre_ticket'] });
  assert.equal(r.code, 400, `${label} → 400`);
  assert.equal(r.ops.length, 0, `${label}: no escribe`);
}

// coerción: `urgencia` NO booleano no puede "colarse" como urgente salteando las validaciones
for (const bad of ['t', 'yes', '1', 1, 'true']) {
  r = await call('POST', urgBody({ urgencia: bad }), { perms: [] });
  assert.equal(r.code, 201, `urgencia=${JSON.stringify(bad)}: se trata como traslado común (sin gate de urgencia)`);
  assert.strictEqual(r.ops[0].row.urgencia, false, `urgencia=${JSON.stringify(bad)} queda en false, no se castea a true en la base`);
  assert.notEqual(r.ops[0].row.cama_origen, 'Urgencia / Ingreso directo', 'y no se le aplican los forzados de urgencia');
}

// un traslado común no se ve afectado
r = await call('POST', { id: 'T1', patientName: 'X', origin: 'A', destination: 'B', status: 'Esperando Habitacion', workflow: 'INTERNAL' });
assert.equal(r.code, 201, 'traslado común sin urgencia → 201 como siempre');
assert.equal(r.ops[0].row.cama_origen, 'A', 'su origen no se pisa');

// ── PATCH: gate de consolidación ─────────────────────────────────────────────
const urgCur = { urgencia: true, codigo_paciente: null };
r = await call('PATCH', { id: 'TSL-U1', status: 'Consolidado' }, { cur: urgCur });
assert.equal(r.code, 422, 'consolidar una urgencia sin paciente → 422');
assert(/paciente vinculado/i.test(r.body.error), 'mensaje claro');
assert.equal(r.ops.length, 0, 'NO se escribe la consolidación');

// código en blanco / espacios tampoco vale
r = await call('PATCH', { id: 'TSL-U1', status: 'Consolidado', patientCode: '   ' }, { cur: urgCur });
assert.equal(r.code, 422, 'código en blanco → 422');

// con código en el mismo PATCH → 200 y se graba la identidad real
r = await call('PATCH', { id: 'TSL-U1', status: 'Consolidado', patientCode: '888', patientName: 'LOPEZ CARLOS', eventoInternacion: 'HIN-4502' }, { cur: urgCur });
assert.equal(r.code, 200, 'con paciente vinculado → 200');
const f = r.ops.find(o => o.op === 'update').fields;
assert.equal(f.codigo_paciente, '888'); assert.equal(f.paciente, 'LOPEZ CARLOS'); assert.equal(f.evento_internacion, 'HIN-4502');
assert.equal(f.status, 'Consolidado');

// si la fila YA tiene código guardado, consolidar sin reenviarlo es válido
r = await call('PATCH', { id: 'TSL-U1', status: 'Consolidado' }, { cur: { urgencia: true, codigo_paciente: '888' } });
assert.equal(r.code, 200, 'ya vinculada → se puede consolidar');

// ── PATCH: inmutabilidad del flag ────────────────────────────────────────────
r = await call('PATCH', { id: 'TSL-U1', status: 'Consolidado', patientCode: '888', urgencia: false, pacienteDeclarado: 'OTRO' }, { cur: urgCur });
assert.equal(r.code, 200);
const f2 = r.ops.find(o => o.op === 'update').fields;
assert(!('urgencia' in f2) && !('paciente_declarado' in f2), 'urgencia y paciente_declarado NO se pueden pisar por PATCH');

// el flag apagado en el MISMO request no salta el gate (el gate lee la base, no el body)
r = await call('PATCH', { id: 'TSL-U1', status: 'Consolidado', urgencia: false }, { cur: urgCur });
assert.equal(r.code, 422, 'mandar urgencia:false no evita el 422');

// ── regresión: consolidar un traslado COMÚN no cambia ────────────────────────
r = await call('PATCH', { id: 'T1', status: 'Consolidado' }, { cur: { urgencia: false, codigo_paciente: null } });
assert.equal(r.code, 200, 'traslado común sin código → se consolida igual (el gate es solo para urgencias)');
r = await call('PATCH', { id: 'T1', status: 'Consolidado' }, { cur: null });
assert.equal(r.code, 200, 'fila inexistente en la lectura previa → no bloquea (fail-open del gate, el update decide)');
r = await call('PATCH', { id: 'T1', observations: 'x' }, { cur: urgCur });
assert.equal(r.code, 200, 'un PATCH que no consolida no dispara el gate');

console.log('OK — api/tickets urgencia');
