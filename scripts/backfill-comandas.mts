/**
 * BACKFILL one-shot: comandas de SharePoint (15.CargaComandas) → Supabase (public.comandas).
 * Trae activas + entregadas + anuladas del entorno. DEBE correr ANTES del cutover de escritura o
 * el overlay de comandas del mapa y el histórico arrancan vacíos. Idempotente pre-cutover: delete
 * del entorno + insert.
 *
 * ⚠️ --entorno es OBLIGATORIO (allowlist {TESTING,PRODUCTIVO}). NO hay default: el delete-por-entorno
 * borra datos VIVOS si el entorno ya tuvo cutover. Para PRODUCTIVO con --apply se exige además
 * --yes-borra-vivas.
 *
 * DEDUP: el índice único parcial comandas_titular_viva_uidx exige UN solo TITULAR vivo por
 * (entorno, identidad, comida, día-ART). Si SP tuviera duplicados, nos quedamos con el más reciente
 * por FechaCarga_D. Los acompañantes NO se dedupan (quedan fuera del índice a propósito).
 * `dia` e `identidad` son columnas generated en Postgres → NO se setean acá.
 *
 *   npx tsx scripts/backfill-comandas.mts --entorno=TESTING              → DRY-RUN
 *   npx tsx scripts/backfill-comandas.mts --entorno=TESTING --apply
 *   npx tsx scripts/backfill-comandas.mts --entorno=PRODUCTIVO --apply --yes-borra-vivas
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
const L_COMANDAS = (process.env.DIETAS_LIST_ID ?? '891ddeb5-3610-4a25-b6c0-512eb8e1648b').trim(); // 15.CargaComandas

const SUPA_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPA_SECRET = process.env.SUPABASE_SECRET_KEY ?? '';

const ALLOWED_ENTORNOS = ['TESTING', 'PRODUCTIVO'];
const entornoArg = process.argv.find(a => a.startsWith('--entorno='));
const ENTORNO = (entornoArg ? entornoArg.split('=')[1] : '').trim();
const APPLY = process.argv.includes('--apply');
const CONFIRM_VIVAS = process.argv.includes('--yes-borra-vivas');

if (!ALLOWED_ENTORNOS.includes(ENTORNO)) {
  console.error(`❌ --entorno es OBLIGATORIO y debe ser uno de: ${ALLOWED_ENTORNOS.join(', ')} (recibí "${ENTORNO}").`);
  console.error('   Sin default: el delete-por-entorno borra datos VIVOS si el entorno ya tuvo cutover.');
  process.exit(1);
}
if (APPLY && ENTORNO === 'PRODUCTIVO' && !CONFIRM_VIVAS) {
  console.error('❌ --apply contra PRODUCTIVO borra+reinserta esa partición (datos vivos si ya hubo cutover).');
  console.error('   Reejecutá con --yes-borra-vivas para confirmar que corre ANTES del cutover.');
  process.exit(1);
}
if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SITE_ID) { console.error('❌ Faltan envs Azure/SharePoint'); process.exit(1); }
if (!SUPA_URL || !SUPA_SECRET) { console.error('❌ Faltan VITE_SUPABASE_URL / SUPABASE_SECRET_KEY'); process.exit(1); }

const ART_TZ = 'America/Argentina/Buenos_Aires';
const isoOrNull = (v: unknown): string | null => {
  if (!v) return null; const t = Date.parse(String(v)); return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
/** Día calendario ART ('YYYY-MM-DD') de un instante — replica la columna generated `dia` (UTC-3). */
const artDay = (iso: unknown): string => {
  const d = new Date(String(iso)); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { timeZone: ART_TZ });
};
const intOrNull = (v: unknown): number | null => {
  const n = Number(String(v ?? '').trim()); return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};
const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out;
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

const COMIDAS = ['DESAYUNO', 'ALMUERZO', 'MERIENDA', 'CENA'];
const TIPOS   = ['MENU', 'OPCION', 'OTROS'];
const STATUS  = ['Activo', 'Entregado', 'Inactivo'];

function mapComanda(item: any) {
  const f = item.fields ?? {};
  const comensal = String(f.Comensal_D ?? '').trim().toUpperCase() === 'ACOMPANANTE' ? 'ACOMPANANTE' : 'TITULAR';
  const ordenN = Number(String(f.OrdenComensal_D ?? '').trim());
  const status = String(f.Status_D ?? 'Activo').trim();
  return {
    entorno:              ENTORNO, // forzado (ya se filtró por entorno)
    cama_label:           String(f.CamaLabel_D ?? '').trim(),
    cama_codigo:          f.CamaCodigo_D != null ? String(f.CamaCodigo_D) : null,
    habitacion:           f.Habitacion_D != null ? String(f.Habitacion_D) : null,
    area:                 f.Area_D != null ? String(f.Area_D) : null,
    paciente_nombre:      f.PacienteNombre_D != null ? String(f.PacienteNombre_D) : null,
    paciente_codigo:      f.PacienteCodigo_D != null ? String(f.PacienteCodigo_D) : null,
    comida:               String(f.Comida_D ?? '').trim().toUpperCase(),
    tipo:                 String(f.Tipo_D ?? '').trim().toUpperCase(),
    detalle:              f.Detalle_D != null ? String(f.Detalle_D) : null,
    observaciones:        f.Observaciones_D != null ? String(f.Observaciones_D) : null,
    status:               STATUS.includes(status) ? status : 'Activo',
    motivo_anulacion:     f.MotivoAnulacion_D != null && f.MotivoAnulacion_D !== '' ? String(f.MotivoAnulacion_D) : null,
    nutricionista_nombre: f.NutricionistaNombre_D != null ? String(f.NutricionistaNombre_D) : null,
    nutricionista_id:     intOrNull(f.NutricionistaID_D),
    comensal,
    orden_comensal:       Number.isFinite(ordenN) && ordenN > 0 ? Math.trunc(ordenN) : 0,
    fecha_carga:          isoOrNull(f.FechaCarga_D) ?? new Date().toISOString(),
    fecha_cierre:         isoOrNull(f.FechaCierre_D),
  };
}

(async () => {
  console.log(`Modo: ${APPLY ? 'APPLY (escribe en Supabase)' : 'DRY-RUN (no escribe)'} · ENTORNO=${ENTORNO}\n`);
  const token = await getGraphToken();

  const raw = await graphGetAll(token, L_COMANDAS, `$expand=fields&$filter=${encodeURIComponent(`fields/Entorno_D eq '${ENTORNO}'`)}&$top=2000`);
  const mapped = raw.map(mapComanda);
  // Descartar (con traza) lo que violaría un CHECK/NOT NULL.
  const valid = mapped.filter(r => r.cama_label && COMIDAS.includes(r.comida) && TIPOS.includes(r.tipo));
  const dropped = mapped.length - valid.length;

  // Dedup del candado: un solo TITULAR vivo (Activo|Entregado) por (identidad, comida, día-ART).
  // identidad = coalesce(nullif(paciente_codigo,''), cama_label) — igual que la columna generated.
  const isViva = (r: any) => r.status === 'Activo' || r.status === 'Entregado';
  const titularVivos = valid.filter(r => r.comensal === 'TITULAR' && isViva(r));
  const resto = valid.filter(r => !(r.comensal === 'TITULAR' && isViva(r)));
  const seen = new Map<string, any>();
  for (const r of titularVivos.sort((a, b) => String(b.fecha_carga).localeCompare(String(a.fecha_carga)))) {
    const identidad = (r.paciente_codigo != null && r.paciente_codigo !== '') ? r.paciente_codigo : r.cama_label;
    const key = `${r.entorno} ${identidad} ${r.comida} ${artDay(r.fecha_carga)}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  const dupTitulares = titularVivos.length - seen.size;
  const rows = [...seen.values(), ...resto];

  console.log(`15.CargaComandas (${ENTORNO}): ${raw.length} filas → ${rows.length} válidas` +
    `${dropped ? ` (${dropped} descartadas por cama/comida/tipo inválidos)` : ''}` +
    `${dupTitulares ? ` (${dupTitulares} titulares vivos duplicados descartados)` : ''}`);

  if (!APPLY) { console.log('\n(DRY-RUN — no se escribió nada. Corré con --apply.)'); return; }

  const supa = createClient(SUPA_URL, SUPA_SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: delErr } = await supa.from('comandas').delete().eq('entorno', ENTORNO);
  if (delErr) { console.error('❌ delete comandas:', delErr.message); process.exit(1); }
  let ins = 0;
  for (const c of chunk(rows, 500)) {
    const { error } = await supa.from('comandas').insert(c);
    if (error) { console.error('❌ insert comandas:', error.message); process.exit(1); }
    ins += c.length;
  }
  const { count } = await supa.from('comandas').select('*', { count: 'exact', head: true }).eq('entorno', ENTORNO);
  console.log(`\n✅ comandas insert: ${ins}\n=== VALIDACIÓN ===\ncomandas en Supabase (${ENTORNO}): ${count} ${count === rows.length ? '✅' : '⚠️'}`);
})();
