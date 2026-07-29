/**
 * BACKFILL one-shot: limpiezas de SharePoint (14.Limpiezas) → Supabase (public.limpiezas).
 *
 * Trae activas + cerradas del entorno actual. DEBE correr ANTES del cutover de escritura o el
 * overlay de camas limpias y el histórico arrancan vacíos. Idempotente pre-cutover: delete del
 * entorno + insert (seguro porque nada nuevo se escribió en Supabase todavía).
 *
 *   npx tsx scripts/backfill-limpiezas.mts            → DRY-RUN
 *   npx tsx scripts/backfill-limpiezas.mts --apply    → escribe en Supabase
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
const L_LIMPIEZAS = (process.env.LIMPIEZAS_LIST_ID ?? '3665d496-0e52-465e-b40f-54ca39cd5856').trim(); // 14.Limpiezas

const SUPA_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPA_SECRET = process.env.SUPABASE_SECRET_KEY ?? '';
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();
const APPLY = process.argv.includes('--apply');

if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SITE_ID) { console.error('❌ Faltan envs Azure/SharePoint'); process.exit(1); }
if (!SUPA_URL || !SUPA_SECRET) { console.error('❌ Faltan VITE_SUPABASE_URL / SUPABASE_SECRET_KEY'); process.exit(1); }

const isoOrNull = (v: unknown): string | null => {
  if (!v) return null; const t = Date.parse(String(v)); return Number.isFinite(t) ? new Date(t).toISOString() : null;
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

function mapLimpieza(item: any) {
  const f = item.fields ?? {};
  const status = String(f.Status_L ?? 'Activo');
  return {
    entorno:        String(f.Entorno_L ?? ENTORNO),
    cama_label:     String(f.CamaLabel_L ?? '').trim(),
    cama_codigo:    f.CamaCodigo_L != null ? String(f.CamaCodigo_L) : null,
    habitacion:     f.Habitacion_L != null ? String(f.Habitacion_L) : null,
    area:           f.Area_L != null ? String(f.Area_L) : null,
    status:         status === 'Inactivo' ? 'Inactivo' : 'Activo',
    motivo_cierre:  f.MotivoCierre_L != null && f.MotivoCierre_L !== '' ? String(f.MotivoCierre_L) : null,
    azafata_id:     f.AzafataId_L != null ? String(f.AzafataId_L) : null,
    azafata_nombre: f.AzafataNombre_L != null ? String(f.AzafataNombre_L) : null,
    fecha_limpieza: isoOrNull(f.FechaLimpieza_L),
    fecha_cierre:   isoOrNull(f.FechaCierre_L),
  };
}

(async () => {
  console.log(`Modo: ${APPLY ? 'APPLY (escribe en Supabase)' : 'DRY-RUN (no escribe)'} · ENTORNO=${ENTORNO}\n`);
  const token = await getGraphToken();

  const raw = await graphGetAll(token, L_LIMPIEZAS, `$expand=fields&$filter=${encodeURIComponent(`fields/Entorno_L eq '${ENTORNO}'`)}&$top=2000`);
  const all = raw.map(mapLimpieza).filter(l => l.cama_label);

  // Candado de la tabla: una sola ACTIVA por (entorno, cama_label). Si SP tuviera duplicados
  // activos (no debería, el endpoint lo evita), nos quedamos con la más reciente por fecha_limpieza.
  const activas = all.filter(l => l.status === 'Activo');
  const seen = new Map<string, any>();
  for (const l of activas.sort((a, b) => String(b.fecha_limpieza ?? '').localeCompare(String(a.fecha_limpieza ?? '')))) {
    if (!seen.has(l.cama_label)) seen.set(l.cama_label, l);
  }
  const dupActivas = activas.length - seen.size;
  const cerradas = all.filter(l => l.status === 'Inactivo');
  const rows = [...seen.values(), ...cerradas];

  console.log(`14.Limpiezas (${ENTORNO}): ${all.length} filas → ${seen.size} activas${dupActivas ? ` (${dupActivas} duplicadas activas descartadas)` : ''}, ${cerradas.length} cerradas`);

  if (!APPLY) { console.log('\n(DRY-RUN — no se escribió nada. Corré con --apply.)'); return; }

  const supa = createClient(SUPA_URL, SUPA_SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
  // Idempotente pre-cutover: limpiar el entorno y reinsertar.
  await supa.from('limpiezas').delete().eq('entorno', ENTORNO);
  let ins = 0;
  for (const c of chunk(rows, 500)) {
    const { error } = await supa.from('limpiezas').insert(c);
    if (error) { console.error('❌ insert limpiezas:', error.message); process.exit(1); }
    ins += c.length;
  }
  console.log(`\n✅ limpiezas insert: ${ins}`);

  const { count } = await supa.from('limpiezas').select('*', { count: 'exact', head: true }).eq('entorno', ENTORNO);
  console.log(`=== VALIDACIÓN ===\nlimpiezas en Supabase (${ENTORNO}): ${count} ${count === rows.length ? '✅' : '⚠️'}`);
})();
