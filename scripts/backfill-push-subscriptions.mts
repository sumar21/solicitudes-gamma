/**
 * BACKFILL one-shot: suscripciones Web Push de SharePoint (09.PushSubscriptions) → Supabase
 * (public.push_subscriptions). Preserva endpoint + keys (las credenciales del dispositivo), así
 * al cutover TODOS reciben push desde el minuto 0 sin tener que reabrir/re-loguear la app.
 *
 * CONDICIÓN: el par VAPID con el que se enviará (secrets Supabase / Vercel) debe ser el MISMO con
 * el que se crearon estas subs (el VAPID del app). Si difiere, el push service devuelve 403.
 *
 * Idempotente: upsert por endpoint (UNIQUE). Dedupe por endpoint (SP podía tener duplicados) →
 * conserva el más fresco por lastModifiedDateTime. Las stale (>36h) se migran igual; el sender
 * las saltea y las borra al primer 410.
 *
 *   npx tsx scripts/backfill-push-subscriptions.mts                         → DRY-RUN (entorno del .env)
 *   npx tsx scripts/backfill-push-subscriptions.mts --entorno=PRODUCTIVO --apply
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
const L_SUBS = '648fde7b-89d2-40ac-bc4a-63661508b50a'; // 09.PushSubscriptions

const SUPA_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPA_SECRET = process.env.SUPABASE_SECRET_KEY ?? '';
const entornoArg = process.argv.find(a => a.startsWith('--entorno='));
const ENTORNO = (entornoArg ? entornoArg.split('=')[1] : (process.env.ENTORNO ?? 'TESTING')).trim();
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

interface SubRow {
  endpoint: string; keys: { p256dh: string; auth: string }; user_id: string; user_role: string;
  assigned_areas: string[]; sede: string; entorno: string; last_seen_at: string | null; _lm: string;
}

(async () => {
  console.log(`Modo: ${APPLY ? 'APPLY (escribe en Supabase)' : 'DRY-RUN (no escribe)'} · ENTORNO=${ENTORNO}\n`);
  const token = await getGraphToken();

  const raw = await graphGetAll(token, L_SUBS, `$expand=fields&$filter=${encodeURIComponent(`fields/Entorno_PS eq '${ENTORNO}'`)}&$top=500`);
  const mapped: SubRow[] = raw.map((item: any) => {
    const f = item.fields ?? {};
    let keys = { p256dh: '', auth: '' };
    try { keys = JSON.parse(String(f.Keys_PS ?? '{}')); } catch { /* inválido */ }
    return {
      endpoint:       String(f.Endpoint_PS ?? ''),
      keys,
      user_id:        String(f.UserId_PS ?? ''),
      user_role:      String(f.UserRole_PS ?? ''),
      assigned_areas: String(f.AssignedAreas_PS ?? '').split(';').map(s => s.trim()).filter(Boolean),
      sede:           String(f.Sede_PS ?? 'HPR'),
      entorno:        String(f.Entorno_PS ?? ENTORNO),
      last_seen_at:   isoOrNull(item.lastModifiedDateTime),
      _lm:            String(item.lastModifiedDateTime ?? ''),
    };
  }).filter(s => s.endpoint && s.keys.p256dh && s.keys.auth);

  // Dedupe por endpoint: conserva la fila más fresca (lastModified DESC).
  const byEndpoint = new Map<string, SubRow>();
  for (const s of mapped.sort((a, b) => b._lm.localeCompare(a._lm))) {
    if (!byEndpoint.has(s.endpoint)) byEndpoint.set(s.endpoint, s);
  }
  const rows = [...byEndpoint.values()].map(({ _lm, ...r }) => r);
  const dups = mapped.length - rows.length;

  const now = Date.now();
  const frescas = rows.filter(r => !r.last_seen_at || (now - Date.parse(r.last_seen_at)) <= 36 * 60 * 60 * 1000).length;
  console.log(`09.PushSubscriptions (${ENTORNO}): ${raw.length} filas → ${rows.length} subs únicas${dups ? ` (${dups} duplicadas por endpoint descartadas)` : ''}`);
  console.log(`  de esas, ${frescas} frescas (≤36h, el sender las usa) y ${rows.length - frescas} stale (las saltea/limpia).`);

  if (!APPLY) { console.log('\n(DRY-RUN — no se escribió nada. Corré con --apply.)'); return; }

  const supa = createClient(SUPA_URL, SUPA_SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
  let up = 0;
  for (const c of chunk(rows, 500)) {
    const { error } = await supa.from('push_subscriptions').upsert(c, { onConflict: 'endpoint' });
    if (error) { console.error('❌ upsert push_subscriptions:', error.message); process.exit(1); }
    up += c.length;
  }
  console.log(`\n✅ push_subscriptions upsert: ${up}`);

  const { count } = await supa.from('push_subscriptions').select('*', { count: 'exact', head: true }).eq('entorno', ENTORNO);
  console.log(`=== VALIDACIÓN ===\npush_subscriptions en Supabase (${ENTORNO}): ${count}`);
})();
