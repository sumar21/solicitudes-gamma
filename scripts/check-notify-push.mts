// Self-check del handler REAL de la Edge Function notify-push (sin Deno, sin red, sin tocar Supabase).
// Empaqueta supabase/functions/notify-push/index.ts con esbuild, reemplaza `web-push` y el cliente de
// Supabase por stubs que CAPTURAN lo que se enviaría, y le tira payloads de webhook sintéticos.
// Correr:  npx tsx scripts/check-notify-push.mts
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const tmp = mkdtempSync(join(tmpdir(), 'notify-push-check-'));
const g = globalThis as any;

// ── stubs ────────────────────────────────────────────────────────────────────
writeFileSync(join(tmp, 'webpush-stub.mjs'), `
const wp = {
  setVapidDetails() {},
  async sendNotification(sub, payload) { globalThis.__sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) }); },
};
export default wp;
`);
writeFileSync(join(tmp, 'supabase-stub.mjs'), `
export function createClient() {
  const qb = (table) => {
    const api = {
      select() { return api; }, eq() { return api; }, in() { return api; }, delete() { return api; },
      insert(row) { globalThis.__inserts.push({ table, row }); return Promise.resolve({ error: null }); },
      then(res, rej) { return Promise.resolve({ data: globalThis.__db[table] ?? [], error: null }).then(res, rej); },
    };
    return api;
  };
  return { from: (t) => qb(t) };
}
`);

const out = join(tmp, 'notify-push.bundle.mjs');
await build({
  entryPoints: [resolve('supabase/functions/notify-push/index.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'warning',
  alias: { 'npm:web-push@3.6.7': join(tmp, 'webpush-stub.mjs'), 'npm:@supabase/supabase-js@2': join(tmp, 'supabase-stub.mjs') },
});

// ── "Deno" mínimo + base fake ────────────────────────────────────────────────
const env: Record<string, string> = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' };
g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: any) => { g.__handler = h; } };
g.__sent = []; g.__inserts = [];
g.__db = {
  roles: [
    { name: 'Admision', permissions: ['notif_new_ticket', 'notif_pre_ticket', 'notif_por_consolidar'], filter_by_floors: false },
    { name: 'Azafata', permissions: ['notif_new_ticket'], filter_by_floors: true },
    { name: 'Enfermeria', permissions: ['notif_status_update'], filter_by_floors: false },
  ],
  push_subscriptions: [
    { endpoint: 'e-adm', keys: {}, user_id: '1', user_role: 'Admision', assigned_areas: [], sede: 'HPR', last_seen_at: new Date().toISOString() },
    { endpoint: 'e-aza', keys: {}, user_id: '2', user_role: 'Azafata', assigned_areas: ['Internacion 4° Piso HPR'], sede: 'HPR', last_seen_at: new Date().toISOString() },
    { endpoint: 'e-enf', keys: {}, user_id: '3', user_role: 'Enfermeria', assigned_areas: [], sede: 'HPR', last_seen_at: new Date().toISOString() },
  ],
};
await import(pathToFileURL(out).href);
const handler = g.__handler as (req: Request) => Promise<Response>;
assert(typeof handler === 'function', 'el módulo debe registrar el handler con Deno.serve');

let seq = 0;
async function fire(payload: any) {
  g.__sent = []; g.__inserts = [];
  const res = await handler(new Request('http://x', { method: 'POST', body: JSON.stringify(payload) }));
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* texto plano */ }
  const to = (g.__sent as any[]).map(s => s.endpoint).sort();
  return { status: res.status, text, json, to, payloads: (g.__sent as any[]).map(s => s.payload) };
}
const base = (o: any = {}) => ({
  id_univoco: `T-${++seq}`, entorno: 'TESTING', paciente: 'PEREZ JUAN', cama_origen: 'Hab 301 - Cama 1', cama_destino: 'Hab 405 - Cama 1',
  cama_origen_area: 'Internacion 3° Piso HPR', cama_destino_area: 'Internacion 4° Piso HPR', workflow: 'INTERNAL',
  status: 'Esperando Habitacion', created_by_id: 99, last_actor_id: 99, updated_at: new Date().toISOString(),
  requisitos_cama: null, hab_compartida: false, urgencia: false, por_consolidar_at: null, aviso_consolidar_at: null, ...o,
});

// A) URGENCIA (INSERT, nace "Por Consolidar"): sólo Admisión (notif_pre_ticket). NO a la azafata de piso.
let r = await fire({ type: 'INSERT', record: base({ urgencia: true, status: 'Por Consolidar', workflow: 'PRE_TICKET', cama_origen: 'Urgencia / Ingreso directo', paciente: 'NN FEMENINO' }) });
assert.deepEqual(r.to, ['e-adm'], 'urgencia avisa SOLO a Admisión');
assert(r.payloads[0].title === 'Ingreso por urgencia' && r.payloads[0].type === 'PRE_TICKET', 'título/tipo de urgencia');
assert(/Hab 405 - Cama 1/.test(r.payloads[0].body) && /ingresarlo en PROGAL/.test(r.payloads[0].body), 'cuerpo: destino + qué hacer');
assert(r.json.main.type === 'PRE_TICKET', 'despacho PRE_TICKET');

// B) AVISO 15 min: UPDATE sin cambio de estado, aviso_consolidar_at null → fecha. Sólo Admisión (notif_por_consolidar).
const porConsolidarAt = new Date(Date.now() - 16 * 60_000).toISOString();
const rec = base({ status: 'Por Consolidar', por_consolidar_at: porConsolidarAt, aviso_consolidar_at: new Date().toISOString() });
r = await fire({ type: 'UPDATE', record: rec, old_record: { ...rec, aviso_consolidar_at: null } });
assert.deepEqual(r.to, ['e-adm'], 'el aviso de 15 min va SOLO a quien tiene notif_por_consolidar');
assert(r.payloads[0].type === 'POR_CONSOLIDAR' && r.payloads[0].title === 'Pendiente de consolidar', 'tipo/título del aviso');
assert(/hace 16 min sin consolidar en PROGAL/.test(r.payloads[0].body), `minutos en el cuerpo: ${r.payloads[0].body}`);
assert(r.json.main.type === 'POR_CONSOLIDAR' && !r.json.main.skipped, 'despacho POR_CONSOLIDAR');
// campanita: UNA fila para Admisión, con el tipo correcto
const bell = (g.__inserts as any[]).filter(i => i.table === 'notificaciones');
assert(bell.length === 1 && bell[0].row.user_id === '1' && bell[0].row.type === 'POR_CONSOLIDAR', 'campanita para Admisión');

// B2) misma urgencia vencida → título propio
const recU = base({ urgencia: true, status: 'Por Consolidar', por_consolidar_at: porConsolidarAt, aviso_consolidar_at: new Date().toISOString() });
r = await fire({ type: 'UPDATE', record: recU, old_record: { ...recU, aviso_consolidar_at: null } });
assert(r.payloads[0].title === 'Urgencia pendiente de consolidar', 'título del aviso de urgencia');

// C) el MISMO record con aviso ya estampado (otro UPDATE cualquiera) NO re-avisa.
r = await fire({ type: 'UPDATE', record: rec, old_record: { ...rec } });
assert(r.text === 'no status change' && r.to.length === 0, 'no re-avisa si aviso_consolidar_at ya estaba');

// C2) un aviso sobre un traslado que YA salió de Por Consolidar (carrera con la consolidación) no avisa.
const recDone = base({ status: 'Consolidado', aviso_consolidar_at: new Date().toISOString() });
r = await fire({ type: 'UPDATE', record: recDone, old_record: { ...recDone, aviso_consolidar_at: null, status: 'Consolidado' } });
assert(r.to.length === 0, 'si ya no está Por Consolidar, no hay aviso');

// D) NEW_TICKET con requisitos + habitación compartida → el push lo dice (azafata del piso 4 + Admisión).
r = await fire({ type: 'INSERT', record: base({ requisitos_cama: ['Con colchón', 'Sin requerimiento'], hab_compartida: true }) });
assert.deepEqual(r.to, ['e-adm', 'e-aza'], 'NEW_TICKET llega a Admisión y a la azafata del piso destino');
assert(/Requiere: Con colchón/.test(r.payloads[0].body) && !/Sin requerimiento/.test(r.payloads[0].body), `requisitos reales: ${r.payloads[0].body}`);
assert(/Hab\. compartida: revisar que esté todo OK/.test(r.payloads[0].body), 'flag de habitación compartida');

// E) NEW_TICKET común: el cuerpo NO cambia.
r = await fire({ type: 'INSERT', record: base() });
assert(r.payloads[0].body === 'PEREZ JUAN: Hab 301 - Cama 1 → Hab 405 - Cama 1', `cuerpo común intacto: ${r.payloads[0].body}`);
r = await fire({ type: 'INSERT', record: base({ requisitos_cama: ['Sin requerimiento'] }) });
assert(r.payloads[0].body === 'PEREZ JUAN: Hab 301 - Cama 1 → Hab 405 - Cama 1', '"Sin requerimiento" no agrega nada');

// F) conversión de pre-ticket (Presolicitud → vivo) sigue siendo NEW_TICKET, con el sufijo si corresponde.
const conv = base({ workflow: 'PRE_TICKET', requisitos_cama: ['Intento autólisis'], hab_compartida: false });
r = await fire({ type: 'UPDATE', record: conv, old_record: { ...conv, status: 'Presolicitud', cama_destino: null } });
assert(r.payloads[0].type === 'NEW_TICKET' && /Requiere: Intento autólisis/.test(r.payloads[0].body), 'conversión = NEW_TICKET con requisitos');

// G) un cambio normal a "Por Consolidar" sigue siendo RECEPTION_CONFIRMED (no se confunde con el aviso).
const toPC = base({ status: 'Por Consolidar', por_consolidar_at: new Date().toISOString() });
r = await fire({ type: 'UPDATE', record: toPC, old_record: { ...toPC, status: 'En Traslado', por_consolidar_at: null } });
assert(r.json?.main?.type === 'RECEPTION_CONFIRMED', 'transición normal intacta');

// H) pre-ticket común (Presolicitud) intacto.
r = await fire({ type: 'INSERT', record: base({ status: 'Presolicitud', workflow: 'PRE_TICKET', cama_destino: null, motivo_cambio: 'Destino Internación General' }) });
assert(r.payloads[0].title === 'Nueva Solicitud de Cama' && /Destino Internación General/.test(r.payloads[0].body), 'pre-ticket común intacto');

console.log('OK — notify-push');
