/**
 * BACKFILL one-shot: traslados + eventos + observaciones de SharePoint → Supabase.
 *
 * Trae el histórico del entorno actual (ENTORNO, default TESTING) preservando id_univoco (la
 * relación lógica sin FK). DEBE correr ANTES del cutover de escritura o los tickets en vuelo
 * desaparecen del mapa. Idempotente: traslados por upsert(id_univoco,entorno); eventos/obs por
 * delete-de-ese-entorno + insert (seguro pre-cutover, cuando nada nuevo se escribió en Supabase).
 *
 * PHI: mapea Paciente_T a la columna pero NUNCA lo imprime. Solo loguea conteos e id_univocos.
 *
 *   npx tsx scripts/backfill-traslados.mts            → DRY-RUN (cuenta, no escribe)
 *   npx tsx scripts/backfill-traslados.mts --apply    → escribe en Supabase
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

for (const file of ['.env.local', '.env']) {
  try {
    const p = resolve(import.meta.dirname ?? '.', '..', file);
    for (const line of readFileSync(p, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('='); if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  } catch { /* siguiente */ }
}

const TENANT_ID = process.env.AZURE_TENANT_ID ?? '';
const CLIENT_ID = process.env.AZURE_CLIENTE_ID ?? '';
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET ?? '';
const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const L_TRASLADOS = 'c7417674-9084-416d-a955-7024161a3194'; // 07.Traslados
const L_EVENTOS   = 'bd50c2be-0ec7-45d7-b1f5-abf10546675d'; // 08.DetalleTraslados (sin columna Entorno)
const L_OBS       = '1c524476-f88f-47c8-ad22-4b3f7f429e46'; // 13.ObservacionesTraslados

const SUPA_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPA_SECRET = process.env.SUPABASE_SECRET_KEY ?? '';
// Entorno OBLIGATORIO por flag (allowlist) — sin default silencioso a TESTING (que está vivo en
// develop): un delete/insert por error sobre un entorno vivo es pérdida de datos. Para el cutover:
//   npx tsx scripts/backfill-traslados.mts --entorno=PRODUCTIVO --apply --yes-borra-vivas
const ALLOWED_ENTORNOS = ['TESTING', 'PRODUCTIVO'];
const entornoArg = process.argv.find(a => a.startsWith('--entorno='));
const ENTORNO = (entornoArg ? entornoArg.split('=')[1] : '').trim();
const APPLY = process.argv.includes('--apply');
const CONFIRM_VIVAS = process.argv.includes('--yes-borra-vivas');

if (!ALLOWED_ENTORNOS.includes(ENTORNO)) {
  console.error(`❌ --entorno es OBLIGATORIO y debe ser uno de: ${ALLOWED_ENTORNOS.join(', ')} (recibí "${ENTORNO}").`);
  process.exit(1);
}
if (APPLY && ENTORNO === 'PRODUCTIVO' && !CONFIRM_VIVAS) {
  console.error('❌ --apply contra PRODUCTIVO pisa traslados y borra+reinserta eventos/obs de esa partición.');
  console.error('   Reejecutá con --yes-borra-vivas para confirmar que corre ANTES del cutover.');
  process.exit(1);
}
if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SITE_ID) { console.error('❌ Faltan envs Azure/SharePoint'); process.exit(1); }
if (!SUPA_URL || !SUPA_SECRET) { console.error('❌ Faltan VITE_SUPABASE_URL / SUPABASE_SECRET_KEY'); process.exit(1); }

const numOrNull = (v: unknown): number | null => {
  const n = Number(v); return Number.isFinite(n) && v !== '' && v != null ? n : null;
};
const isoOrNull = (v: unknown): string | null => {
  if (!v) return null; const t = Date.parse(String(v)); return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

async function getGraphToken(): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default' }).toString(),
  });
  const d: any = await res.json();
  if (!d.access_token) throw new Error('Auth Graph falló: ' + JSON.stringify(d));
  return d.access_token;
}

async function graphGetAll(token: string, listId: string, query: string): Promise<any[]> {
  const out: any[] = [];
  let url: string | null = `https://graph.microsoft.com/v1.0/sites/${SITE_ID}/lists/${listId}/items?${query}`;
  while (url) {
    const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } });
    if (!r.ok) { console.error('SP error', r.status, await r.text()); process.exit(1); }
    const d: any = await r.json();
    out.push(...(d.value ?? []));
    url = d['@odata.nextLink'] ?? null;
  }
  return out;
}

// SP 07.Traslados → columna public.traslados (mismo mapeo que ticketToFields, en sentido inverso).
function mapTraslado(item: any) {
  const f = item.fields ?? {};
  return {
    id_univoco:          String(f.IDUnivocoTraslado_T ?? '').trim(),
    entorno:             String(f.Entorno_T ?? ENTORNO),
    paciente:            String(f.Paciente_T ?? ''),
    codigo_paciente:     f.CodigoPaciente_T != null ? String(f.CodigoPaciente_T) : null,
    cama_origen:         String(f.CamaOrigen_T ?? ''),
    cama_origen_codigo:  f.CodigoCamaO_T != null ? String(f.CodigoCamaO_T) : null,
    cama_origen_status:  f.StatusCamaO_T != null ? String(f.StatusCamaO_T) : null,
    cama_destino:        f.CamaDestino_T != null ? String(f.CamaDestino_T) : null,
    cama_destino_codigo: f.CodigoCamaD_T != null ? String(f.CodigoCamaD_T) : null,
    cama_destino_status: f.StatusCamaD_T != null ? String(f.StatusCamaD_T) : null,
    workflow:            String(f.TipoTraslado_T ?? ''),
    status:              String(f.Status_T ?? ''),
    financiador:         f.Financiador_T != null ? String(f.Financiador_T) : null,
    motivo_cambio:       f.MotivoCambio_T != null ? String(f.MotivoCambio_T) : null,
    motivo_cancelacion:  f.MotivoCancelacion_T != null ? String(f.MotivoCancelacion_T) : null,
    observaciones:       f.ObservacionesTraslado_T != null ? String(f.ObservacionesTraslado_T) : null,
    intervino_azafata:   String(f.IntervinoAzafata_T ?? 'NO'),
    created_by:          f.Usuario_T != null ? String(f.Usuario_T) : null,
    created_by_id:       numOrNull(f.IDUsuario_T),
    created_at:          isoOrNull(f.FechaInicio_T) ?? new Date(item.createdDateTime ?? Date.now()).toISOString(),
    completed_at:        isoOrNull(f.FechaFin_T),
    // cama_*_area / last_actor_id quedan NULL: los completa el write-path en el próximo POST/PATCH
    // (el cliente manda originAreaName/destinationAreaName). Los cerrados no disparan push.
  };
}

function mapEvento(item: any) {
  const f = item.fields ?? {};
  return {
    traslado_id: String(f.IDUnivocoTraslado_DT ?? '').trim(),
    entorno:     ENTORNO, // 08 no tiene Entorno; se hereda del traslado padre (ya filtrado por idSet)
    tipo:        String(f.TipoMovimiento_DT ?? ''),
    usuario:     f.UsuarioMovimiento_DT != null ? String(f.UsuarioMovimiento_DT) : null,
    usuario_id:  numOrNull(f.IDUsuarioMovimiento_DT),
    created_at:  isoOrNull(f.FechaMovimiento_DT) ?? new Date(item.createdDateTime ?? Date.now()).toISOString(),
  };
}

function mapObs(item: any) {
  const f = item.fields ?? {};
  return {
    traslado_id:   String(f.IDUnivocoTraslado_OBS ?? '').trim(),
    entorno:       String(f.Entorno_OBS ?? ENTORNO),
    status_ticket: f.StatusDelTicket_OBS != null ? String(f.StatusDelTicket_OBS) : null,
    texto:         String(f.TextoObservacion_OBS ?? '').slice(0, 500),
    usuario:       f.UsuarioObservacion_OBS != null ? String(f.UsuarioObservacion_OBS) : null,
    usuario_id:    numOrNull(f.IDUsuarioObservacion_OBS),
    created_at:    isoOrNull(f.FechaObservacion_OBS) ?? new Date(item.createdDateTime ?? Date.now()).toISOString(),
  };
}

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out;
};

(async () => {
  console.log(`Modo: ${APPLY ? 'APPLY (escribe en Supabase)' : 'DRY-RUN (no escribe)'} · ENTORNO=${ENTORNO}\n`);
  const token = await getGraphToken();

  // 1) TRASLADOS del entorno
  const rawT = await graphGetAll(token, L_TRASLADOS, `$expand=fields&$filter=${encodeURIComponent(`fields/Entorno_T eq '${ENTORNO}'`)}&$top=500`);
  const trasladosAll = rawT.map(mapTraslado);
  const invalidT = trasladosAll.filter(t => !t.id_univoco || !t.paciente || !t.cama_origen || !t.status || !t.workflow);
  const traslados = trasladosAll.filter(t => t.id_univoco && t.paciente && t.cama_origen && t.status && t.workflow);
  const idSet = new Set(traslados.map(t => t.id_univoco));
  console.log(`07.Traslados: ${trasladosAll.length} filas → ${traslados.length} válidas, ${invalidT.length} descartadas (falta id/paciente/cama/status/workflow)`);

  // ── Pre-scan del índice único parcial traslados_cama_destino_activa_idx ────
  // (entorno, cama_destino) WHERE status NOT IN (Consolidado,Cancelado) AND cama_destino IS NOT NULL.
  // El upsert usa onConflict:'id_univoco,entorno' → NO tapa este segundo índice. Si dos activos
  // comparten cama_destino, el insert dispara 23505. Lo detectamos ACÁ (id_univoco no es PHI) para
  // resolverlos en SP antes, en vez de morir a mitad del backfill. En APPLY igual se aísla fila a
  // fila (abajo), así una colisión no tira abajo el chunk entero.
  const activosConDestino = traslados.filter(t => t.status !== 'Consolidado' && t.status !== 'Cancelado' && t.cama_destino);
  const porDestino = new Map<string, string[]>();
  for (const t of activosConDestino) {
    const arr = porDestino.get(t.cama_destino!) ?? [];
    arr.push(t.id_univoco);
    porDestino.set(t.cama_destino!, arr);
  }
  const colisiones = [...porDestino.entries()].filter(([, ids]) => ids.length > 1);
  if (colisiones.length > 0) {
    console.warn(`\n⚠️  ${colisiones.length} cama(s) destino con MÁS DE UN traslado activo (chocan contra traslados_cama_destino_activa_idx):`);
    for (const [cama, ids] of colisiones) console.warn(`   · cama_destino "${cama}": id_univocos ${ids.join(', ')} → resolvé (consolidá/cancelá) en SP; sólo el primero entrará, el resto se saltea.`);
    console.warn('');
  }

  // 2) EVENTOS (08 no tiene entorno): traer todo y quedarnos con los de nuestros traslados
  const rawE = await graphGetAll(token, L_EVENTOS, `$expand=fields&$top=500`);
  const eventos = rawE.map(mapEvento).filter(e => e.traslado_id && idSet.has(e.traslado_id) && e.tipo);
  console.log(`08.DetalleTraslados: ${rawE.length} filas totales → ${eventos.length} de traslados de ${ENTORNO}`);

  // 3) OBSERVACIONES del entorno
  const rawO = await graphGetAll(token, L_OBS, `$expand=fields&$filter=${encodeURIComponent(`fields/Entorno_OBS eq '${ENTORNO}'`)}&$top=500`);
  const obs = rawO.map(mapObs).filter(o => o.traslado_id && o.texto);
  const obsHuerfanas = obs.filter(o => !idSet.has(o.traslado_id)).length;
  console.log(`13.Observaciones: ${rawO.length} filas → ${obs.length} con texto${obsHuerfanas ? ` (${obsHuerfanas} sin traslado en el set — se migran igual, se relacionan por id)` : ''}`);

  const activos = traslados.filter(t => t.status !== 'Consolidado' && t.status !== 'Cancelado').length;
  console.log(`\nResumen: ${traslados.length} traslados (${activos} activos), ${eventos.length} eventos, ${obs.length} obs`);

  if (!APPLY) { console.log('\n(DRY-RUN — no se escribió nada. Corré con --apply.)'); return; }

  const supa = createClient(SUPA_URL, SUPA_SECRET, { auth: { persistSession: false, autoRefreshToken: false } });

  // B1: silenciar el trigger de push de traslados durante el backfill. Sin esto, cada fila
  // histórica dispara net.http_post → Edge Function → "Nueva Solicitud" a TODO el hospital.
  const { error: offErr } = await supa.rpc('set_traslados_notify_enabled', { p_enabled: false });
  if (offErr) { console.error('❌ no se pudo desactivar el trigger de push (set_traslados_notify_enabled):', offErr.message); process.exit(1); }
  console.log('🔕 trigger notify_push_traslados DESACTIVADO durante el backfill');
  const reenable = async () => {
    const { error } = await supa.rpc('set_traslados_notify_enabled', { p_enabled: true });
    if (error) console.error(`⚠️ NO se pudo reactivar el trigger notify_push_traslados: ${error.message} — REACTIVALO A MANO.`);
    else console.log('🔔 trigger notify_push_traslados REACTIVADO');
  };
  // Nunca process.exit sin reactivar el trigger primero (un exit se saltearía cualquier finally).
  const die = async (msg: string): Promise<never> => { console.error(msg); await reenable(); process.exit(1); };

  // TRASLADOS: upsert idempotente por (id_univoco, entorno). B2: ante 23505 (índice de cama_destino
  // activa, que onConflict NO tapa) se aísla el chunk fila a fila y se SALTEA la ofensora sin abortar.
  let upT = 0; const saltados: string[] = [];
  for (const c of chunk(traslados, 500)) {
    const { error } = await supa.from('traslados').upsert(c, { onConflict: 'id_univoco,entorno' });
    if (!error) { upT += c.length; continue; }
    if ((error as any).code !== '23505') await die(`❌ upsert traslados: ${error.message}`);
    // Colisión de cama_destino en algún lado del chunk → reintentar fila por fila.
    for (const row of c) {
      const { error: e1 } = await supa.from('traslados').upsert([row], { onConflict: 'id_univoco,entorno' });
      if (!e1) { upT++; continue; }
      if ((e1 as any).code === '23505') { saltados.push(row.id_univoco); console.warn(`   ⚠️ 23505 en id_univoco ${row.id_univoco} (cama_destino "${row.cama_destino}") → salteado`); }
      else await die(`❌ upsert traslados (id_univoco ${row.id_univoco}): ${e1.message}`);
    }
  }
  console.log(`\n✅ traslados upsert: ${upT}${saltados.length ? ` · ⚠️ ${saltados.length} salteados por cama_destino duplicada: ${saltados.join(', ')}` : ''}`);

  // EVENTOS/OBS: delete de este entorno para los ids backfilleados + insert (idempotente pre-cutover).
  // A3: se chequea el error del delete y se aborta ANTES de insertar (no dejar el hueco).
  const ids = [...idSet];
  for (const c of chunk(ids, 200)) {
    const { error: de }   = await supa.from('traslado_eventos').delete().eq('entorno', ENTORNO).in('traslado_id', c);
    if (de) await die(`❌ delete eventos: ${de.message}`);
    const { error: dobs } = await supa.from('traslado_obs').delete().eq('entorno', ENTORNO).in('traslado_id', c);
    if (dobs) await die(`❌ delete obs: ${dobs.message}`);
  }
  let upE = 0;
  for (const c of chunk(eventos, 500)) {
    const { error } = await supa.from('traslado_eventos').insert(c);
    if (error) await die(`❌ insert eventos: ${error.message}`);
    upE += c.length;
  }
  let upO = 0;
  for (const c of chunk(obs, 500)) {
    const { error } = await supa.from('traslado_obs').insert(c);
    if (error) await die(`❌ insert obs: ${error.message}`);
    upO += c.length;
  }
  console.log(`✅ eventos insert: ${upE}\n✅ obs insert: ${upO}`);

  await reenable();

  // VALIDACIÓN: conteos en Supabase
  const { count: cT } = await supa.from('traslados').select('*', { count: 'exact', head: true }).eq('entorno', ENTORNO);
  console.log(`\n=== VALIDACIÓN ===\ntraslados en Supabase (entorno ${ENTORNO}): ${cT} ${cT === traslados.length ? '✅' : `⚠️ (puede diferir por ${saltados.length} salteados o filas de otra corrida)`}`);
})();
