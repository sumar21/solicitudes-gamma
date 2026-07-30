/**
 * BACKFILL one-shot: planificación de menú de SharePoint (16.CargaMenu) → Supabase
 * (public.carga_menu). Trae activas + inactivas del entorno. DEBE correr ANTES del cutover de
 * escritura de comandas o la planificación arranca vacía (y el autocompletado por cama no sugiere
 * nada). Idempotente pre-cutover: delete del entorno + insert.
 *
 * ⚠️ --entorno es OBLIGATORIO (allowlist {TESTING,PRODUCTIVO}). NO hay default: el delete-por-entorno
 * borra datos VIVOS si el entorno ya tuvo cutover. Para PRODUCTIVO con --apply se exige además
 * --yes-borra-vivas como confirmación explícita.
 *
 *   npx tsx scripts/backfill-carga-menu.mts --entorno=TESTING              → DRY-RUN
 *   npx tsx scripts/backfill-carga-menu.mts --entorno=TESTING --apply
 *   npx tsx scripts/backfill-carga-menu.mts --entorno=PRODUCTIVO --apply --yes-borra-vivas
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
const L_CARGA_MENU = (process.env.CARGA_MENU_LIST_ID ?? 'f6720c30-aecb-4e7e-ad50-2ba108498bd3').trim(); // 16.CargaMenu

const SUPA_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPA_SECRET = process.env.SUPABASE_SECRET_KEY ?? '';

// ── Entorno OBLIGATORIO + allowlist (sin default silencioso a un entorno vivo) ──
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

const isoOrNull = (v: unknown): string | null => {
  if (!v) return null; const t = Date.parse(String(v)); return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const dayOrNull = (v: unknown): string | null => {
  const s = String(v ?? '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
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

const TURNOS = ['DESAYUNO', 'ALMUERZO', 'MERIENDA', 'CENA'];
const TIPOS  = ['MENU', 'OPCION'];

function mapPlan(item: any) {
  const f = item.fields ?? {};
  return {
    entorno:           ENTORNO, // forzado (ya se filtró por entorno; evita casing huérfano)
    turno:             String(f.Turno_CM ?? '').trim().toUpperCase(),
    tipo:              String(f.Tipo_CM ?? '').trim().toUpperCase(),
    fecha_inicio:      dayOrNull(f.FechaInicio_CM),
    fecha_fin:         dayOrNull(f.FechaFin_CM),
    comanda:           String(f.Comanda_CM ?? '').slice(0, 255),
    status:            String(f.Status_CM ?? 'Activo').trim() === 'Inactivo' ? 'Inactivo' : 'Activo',
    nombre_user_carga: f.NombreUserCarga_CM != null ? String(f.NombreUserCarga_CM) : null,
    user_id:           intOrNull(f.UserID_CM),
    fecha_carga:       isoOrNull(f.FechaCarga_CM) ?? new Date().toISOString(),
  };
}

(async () => {
  console.log(`Modo: ${APPLY ? 'APPLY (escribe en Supabase)' : 'DRY-RUN (no escribe)'} · ENTORNO=${ENTORNO}\n`);
  const token = await getGraphToken();

  const raw = await graphGetAll(token, L_CARGA_MENU, `$expand=fields&$filter=${encodeURIComponent(`fields/Entorno_CM eq '${ENTORNO}'`)}&$top=1000`);
  const mapped = raw.map(mapPlan);
  // Descartar (con traza) filas que violarían un CHECK o un NOT NULL.
  const rows = mapped.filter(p => TURNOS.includes(p.turno) && TIPOS.includes(p.tipo) && p.fecha_inicio && p.fecha_fin && p.comanda);
  const dropped = mapped.length - rows.length;

  console.log(`16.CargaMenu (${ENTORNO}): ${raw.length} filas → ${rows.length} válidas${dropped ? ` (${dropped} descartadas por turno/tipo/fecha/comanda inválidos)` : ''}`);

  if (!APPLY) { console.log('\n(DRY-RUN — no se escribió nada. Corré con --apply.)'); return; }

  const supa = createClient(SUPA_URL, SUPA_SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: delErr } = await supa.from('carga_menu').delete().eq('entorno', ENTORNO);
  if (delErr) { console.error('❌ delete carga_menu:', delErr.message); process.exit(1); }
  let ins = 0;
  for (const c of chunk(rows, 500)) {
    const { error } = await supa.from('carga_menu').insert(c);
    if (error) { console.error('❌ insert carga_menu:', error.message); process.exit(1); }
    ins += c.length;
  }
  const { count } = await supa.from('carga_menu').select('*', { count: 'exact', head: true }).eq('entorno', ENTORNO);
  console.log(`\n✅ carga_menu insert: ${ins}\n=== VALIDACIÓN ===\ncarga_menu en Supabase (${ENTORNO}): ${count} ${count === rows.length ? '✅' : '⚠️'}`);
})();
