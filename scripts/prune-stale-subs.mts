/**
 * Purga de suscripciones push STALE en 09.PushSubscriptions.
 *
 * "Stale" = mismo criterio que el sender (api/push-utils.ts isFresh): tiene un
 * lastModifiedDateTime válido y fue tocada hace MÁS de 36h. El sender YA las ignora,
 * así que borrarlas no cambia ninguna entrega — solo achica la tabla y corta el fan-out.
 * Las filas sin timestamp / inválido son fail-open (el sender las trata como frescas) → NO se tocan.
 *
 * Uso:
 *   npx tsx scripts/prune-stale-subs.mts                 → DRY-RUN (solo cuenta, no borra)
 *   npx tsx scripts/prune-stale-subs.mts --apply         → borra stale del entorno PRODUCTIVO
 *   npx tsx scripts/prune-stale-subs.mts --apply --entorno=TESTING
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

try {
  const envPath = resolve(import.meta.dirname ?? '.', '..', '.env.local');
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq < 0) continue;
    const k = t.slice(0, eq).trim(); const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch (e: any) { console.error('No pude cargar .env.local:', e.message); process.exit(1); }

const TENANT_ID = process.env.AZURE_TENANT_ID ?? '';
const CLIENT_ID = process.env.AZURE_CLIENTE_ID ?? '';
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET ?? '';
const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const SUBS_LIST = '648fde7b-89d2-40ac-bc4a-63661508b50a'; // 09.PushSubscriptions
const STALE_MS = 36 * 60 * 60 * 1000;

const APPLY = process.argv.includes('--apply');
const entornoArg = process.argv.find(a => a.startsWith('--entorno='));
const TARGET_ENTORNO = entornoArg ? entornoArg.split('=')[1] : 'PRODUCTIVO';

if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SITE_ID) { console.error('Faltan envs Azure/SharePoint'); process.exit(1); }

async function getToken(): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default' }).toString(),
  });
  const d: any = await res.json();
  if (!d.access_token) throw new Error('Auth Graph falló: ' + JSON.stringify(d));
  return d.access_token;
}

async function fetchAll(token: string): Promise<any[]> {
  const out: any[] = [];
  let url: string | null = `https://graph.microsoft.com/v1.0/sites/${SITE_ID}/lists/${SUBS_LIST}/items?$expand=fields&$top=500`;
  while (url) {
    const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } });
    if (!r.ok) { console.error('SP error', r.status, await r.text()); process.exit(1); }
    const d: any = await r.json();
    out.push(...(d.value ?? []));
    url = d['@odata.nextLink'] ?? null;
  }
  return out;
}

// Igual que api/push-utils.ts isFresh: sin/ inválido timestamp = fresh (fail-open).
function isStale(lastModified: string | undefined, now: number): boolean {
  if (!lastModified) return false;
  const t = Date.parse(lastModified);
  if (!Number.isFinite(t)) return false;
  return now - t > STALE_MS;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Borrado resiliente al throttling de SharePoint (429/503): $batch de 20, respeta
// Retry-After, reintenta los ítems throttleados en rondas con backoff, y pausa entre
// batches para no gatillar el límite (el borrado en masa se throttlea agresivo).
async function batchDelete(token: string, ids: string[]): Promise<{ ok: number; fail: number }> {
  let ok = 0;
  let pending = ids.slice();
  const total = ids.length;
  for (let round = 1; pending.length && round <= 12; round++) {
    const stillFailed: string[] = [];
    for (let i = 0; i < pending.length; i += 20) {
      const chunk = pending.slice(i, i + 20);
      const body = { requests: chunk.map((id, idx) => ({ id: String(idx), method: 'DELETE', url: `/sites/${SITE_ID}/lists/${SUBS_LIST}/items/${id}` })) };
      let r: Response;
      try {
        r = await fetch('https://graph.microsoft.com/v1.0/$batch', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } catch { stillFailed.push(...chunk); await sleep(1000); continue; }
      if (r.status === 429 || r.status >= 500) {
        const ra = Number(r.headers.get('Retry-After')) || 15;
        stillFailed.push(...chunk); await sleep(ra * 1000); continue;
      }
      if (!r.ok) { stillFailed.push(...chunk); continue; }
      const d: any = await r.json();
      let batchThrottled = 0;
      for (const resp of d.responses ?? []) {
        const id = chunk[Number(resp.id)];
        if ((resp.status >= 200 && resp.status < 300) || resp.status === 404) ok++;
        else if (resp.status === 429 || resp.status >= 500) { stillFailed.push(id); batchThrottled++; }
        // otros 4xx = fallo permanente (no reintentar, no contar como pendiente)
      }
      process.stdout.write(`\r  ronda ${round}: ${ok}/${total} borradas, reintentar ${stillFailed.length}   `);
      // Retry-After a nivel de item si el batch trajo 429; si no, pacing suave.
      const ra = (d.responses ?? []).map((x: any) => Number(x.headers?.['Retry-After']) || 0).reduce((m: number, v: number) => Math.max(m, v), 0);
      await sleep(ra ? ra * 1000 : (batchThrottled ? 3000 : 250));
    }
    pending = stillFailed;
    if (pending.length) { process.stdout.write(`\n  ronda ${round} fin: ${pending.length} pendientes — backoff 10s\n`); await sleep(10000); }
  }
  process.stdout.write('\n');
  return { ok, fail: pending.length };
}

(async () => {
  const now = Date.now();
  console.log(`Modo: ${APPLY ? `APPLY (BORRA stale de entorno ${TARGET_ENTORNO})` : 'DRY-RUN (no borra nada)'}`);
  const token = await getToken();
  const all = await fetchAll(token);
  console.log(`\nTotal filas en 09.PushSubscriptions: ${all.length}`);

  // Clasificar
  const byEntorno: Record<string, { total: number; stale: number; fresh: number }> = {};
  const perUserStale: Record<string, { role: string; total: number; stale: number; fresh: number }> = {};
  const staleIdsTarget: string[] = [];

  for (const it of all) {
    const f = it.fields ?? {};
    const ent = String(f.Entorno_PS ?? '(empty)');
    const uid = String(f.UserId_PS ?? '(empty)');
    const stale = isStale(it.lastModifiedDateTime, now);
    byEntorno[ent] ??= { total: 0, stale: 0, fresh: 0 };
    byEntorno[ent].total++; byEntorno[ent][stale ? 'stale' : 'fresh']++;
    if (ent === TARGET_ENTORNO) {
      perUserStale[uid] ??= { role: String(f.UserRole_PS ?? ''), total: 0, stale: 0, fresh: 0 };
      perUserStale[uid].total++; perUserStale[uid][stale ? 'stale' : 'fresh']++;
      if (stale) staleIdsTarget.push(String(it.id));
    }
  }

  console.log('\n=== Por entorno (stale = >36h, el sender ya las ignora) ===');
  console.table(byEntorno);

  const topUsers = Object.entries(perUserStale)
    .map(([uid, v]) => ({ userId: uid, role: v.role, total: v.total, stale: v.stale, quedan_frescas: v.fresh }))
    .sort((a, b) => b.stale - a.stale).slice(0, 15);
  console.log(`\n=== Top usuarios por stale en ${TARGET_ENTORNO} (quedan_frescas = lo que sobrevive) ===`);
  console.table(topUsers);

  console.log(`\n>>> En ${TARGET_ENTORNO}: ${staleIdsTarget.length} filas STALE se borrarían; ${(byEntorno[TARGET_ENTORNO]?.fresh ?? 0)} frescas quedan intactas.`);

  if (!APPLY) {
    console.log('\n(DRY-RUN — no se borró nada. Corré con --apply para ejecutar.)');
    return;
  }
  console.log(`\nBorrando ${staleIdsTarget.length} filas stale de ${TARGET_ENTORNO} (batch de 20)...`);
  const { ok, fail } = await batchDelete(token, staleIdsTarget);
  console.log(`Listo. Borradas: ${ok} · fallidas: ${fail}`);
})();
