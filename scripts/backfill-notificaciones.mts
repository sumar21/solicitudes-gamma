/**
 * BACKFILL one-shot: notificaciones (campanita) de SharePoint (10.Notificaciones) → Supabase
 * (public.notificaciones). Trae solo las NO LEÍDAS recientes (Status_N='Enviada') para que el
 * badge de pendientes no arranque en cero tras el cutover. Es la pieza MENOS crítica (los
 * traslados/limpiezas son lo importante); si se saltea, la campanita solo arranca sin pendientes.
 *
 * Idempotente: borra las no-leídas del entorno en Supabase y reinserta. SEGURO solo ANTES del
 * cutover (cuando la Edge Function todavía no escribió notificaciones en ese entorno). NO correr
 * después de que la app esté escribiendo en Supabase o se pisan notis nuevas.
 *
 *   npx tsx scripts/backfill-notificaciones.mts                                   → DRY-RUN
 *   npx tsx scripts/backfill-notificaciones.mts --entorno=PRODUCTIVO --days=7 --apply
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
const L_NOTIF = '240f00dd-715b-4c78-9661-3147b7650a0f'; // 10.Notificaciones

const SUPA_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPA_SECRET = process.env.SUPABASE_SECRET_KEY ?? '';
// Entorno OBLIGATORIO por flag (allowlist) — sin default silencioso a TESTING (que está vivo en
// develop): el delete de no-leídas borra la campanita VIVA. Para el cutover:
//   npx tsx scripts/backfill-notificaciones.mts --entorno=PRODUCTIVO --days=7 --apply --yes-borra-vivas
const ALLOWED_ENTORNOS = ['TESTING', 'PRODUCTIVO'];
const entornoArg = process.argv.find(a => a.startsWith('--entorno='));
const ENTORNO = (entornoArg ? entornoArg.split('=')[1] : '').trim();
const daysArg = process.argv.find(a => a.startsWith('--days='));
const DAYS = daysArg ? Math.max(1, Number(daysArg.split('=')[1]) || 7) : 7;
const APPLY = process.argv.includes('--apply');
const CONFIRM_VIVAS = process.argv.includes('--yes-borra-vivas');

if (!ALLOWED_ENTORNOS.includes(ENTORNO)) {
  console.error(`❌ --entorno es OBLIGATORIO y debe ser uno de: ${ALLOWED_ENTORNOS.join(', ')} (recibí "${ENTORNO}").`);
  process.exit(1);
}
if (APPLY && ENTORNO === 'PRODUCTIVO' && !CONFIRM_VIVAS) {
  console.error('❌ --apply contra PRODUCTIVO borra las no-leídas de esa partición (campanita viva si ya hubo cutover).');
  console.error('   Corré el backfill de traslados ANTES (ese sí puede generar notis vía webhook) y reejecutá con --yes-borra-vivas.');
  process.exit(1);
}
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
  let guard = 0;
  while (url && guard++ < 40) {
    const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } });
    if (!r.ok) { console.error('SP error', r.status, await r.text()); process.exit(1); }
    const d: any = await r.json();
    out.push(...(d.value ?? []));
    url = d['@odata.nextLink'] ?? null;
  }
  return out;
}

(async () => {
  console.log(`Modo: ${APPLY ? 'APPLY (escribe en Supabase)' : 'DRY-RUN (no escribe)'} · ENTORNO=${ENTORNO} · últimos ${DAYS} días · solo NO leídas\n`);
  const token = await getGraphToken();

  const filter = encodeURIComponent(`fields/Entorno_N eq '${ENTORNO}' and fields/Status_N eq 'Enviada'`);
  const raw = await graphGetAll(token, L_NOTIF, `$expand=fields&$filter=${filter}&$top=500&$orderby=fields/Fecha_N desc`);
  const cutoff = Date.now() - DAYS * 24 * 60 * 60 * 1000;
  const rows = raw.map((item: any) => {
    const f = item.fields ?? {};
    return {
      traslado_id: f.TicketId_N != null ? String(f.TicketId_N) : null,
      user_id:     String(f.UserId_N ?? ''),
      title:       String(f.Title_N ?? ''),
      message:     f.Message_N != null ? String(f.Message_N) : null,
      type:        f.Type_N != null ? String(f.Type_N) : null,
      status:      'Enviada',
      leida_at:    null,
      entorno:     String(f.Entorno_N ?? ENTORNO),
      created_at:  isoOrNull(f.Fecha_N),
    };
  }).filter(r => r.user_id && r.title && r.created_at && Date.parse(r.created_at) >= cutoff);

  console.log(`10.Notificaciones (${ENTORNO}, no leídas): ${raw.length} filas → ${rows.length} dentro de los últimos ${DAYS} días`);

  if (!APPLY) { console.log('\n(DRY-RUN — no se escribió nada. Corré con --apply.)'); return; }

  const supa = createClient(SUPA_URL, SUPA_SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
  // Idempotente y SEGURO SOLO pre-cutover. A4: el delete se ACOTA a la MISMA ventana que se
  // reinserta (created_at >= cutoff) — si no, una no-leída legítima más vieja que --days se borraría
  // sin reinsertarse. A3: se chequea el error del delete y se aborta antes de insertar.
  const cutoffIso = new Date(cutoff).toISOString();
  const { error: delErr } = await supa.from('notificaciones').delete()
    .eq('entorno', ENTORNO).eq('status', 'Enviada').gte('created_at', cutoffIso);
  if (delErr) { console.error('❌ delete notificaciones:', delErr.message); process.exit(1); }
  let ins = 0;
  for (const c of chunk(rows, 500)) {
    const { error } = await supa.from('notificaciones').insert(c);
    if (error) { console.error('❌ insert notificaciones:', error.message); process.exit(1); }
    ins += c.length;
  }
  console.log(`\n✅ notificaciones (no leídas) insert: ${ins}`);
})();
