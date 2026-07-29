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
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();
const APPLY = process.argv.includes('--apply');

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

  // TRASLADOS: upsert idempotente por (id_univoco, entorno)
  let upT = 0;
  for (const c of chunk(traslados, 500)) {
    const { error } = await supa.from('traslados').upsert(c, { onConflict: 'id_univoco,entorno' });
    if (error) { console.error('❌ upsert traslados:', error.message); process.exit(1); }
    upT += c.length;
  }
  console.log(`\n✅ traslados upsert: ${upT}`);

  // EVENTOS/OBS: delete de este entorno para los ids backfilleados + insert (idempotente pre-cutover)
  const ids = [...idSet];
  for (const c of chunk(ids, 200)) {
    await supa.from('traslado_eventos').delete().eq('entorno', ENTORNO).in('traslado_id', c);
    await supa.from('traslado_obs').delete().eq('entorno', ENTORNO).in('traslado_id', c);
  }
  let upE = 0;
  for (const c of chunk(eventos, 500)) {
    const { error } = await supa.from('traslado_eventos').insert(c);
    if (error) { console.error('❌ insert eventos:', error.message); process.exit(1); }
    upE += c.length;
  }
  let upO = 0;
  for (const c of chunk(obs, 500)) {
    const { error } = await supa.from('traslado_obs').insert(c);
    if (error) { console.error('❌ insert obs:', error.message); process.exit(1); }
    upO += c.length;
  }
  console.log(`✅ eventos insert: ${upE}\n✅ obs insert: ${upO}`);

  // VALIDACIÓN: conteos en Supabase
  const { count: cT } = await supa.from('traslados').select('*', { count: 'exact', head: true }).eq('entorno', ENTORNO);
  console.log(`\n=== VALIDACIÓN ===\ntraslados en Supabase (entorno ${ENTORNO}): ${cT} ${cT === traslados.length ? '✅' : '⚠️ (puede diferir si ya había filas de otra corrida)'}`);
})();
