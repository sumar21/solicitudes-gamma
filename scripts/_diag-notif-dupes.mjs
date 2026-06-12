// READ-ONLY diagnostic: find duplicate notification rows in 10.Notificaciones
// and correlate with subscription counts in 09.PushSubscriptions.
// NO writes. GET requests only. Safe to run against production.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── load .env.local (manual parse; tsx/node don't auto-load it) ──────────────
function loadEnv(file) {
  try {
    const txt = readFileSync(resolve(process.cwd(), file), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch { /* file optional */ }
}
loadEnv('.env.local');

const TENANT_ID = process.env.AZURE_TENANT_ID ?? '';
const CLIENT_ID = process.env.AZURE_CLIENTE_ID ?? '';
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET ?? '';
const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const NOTIF_LIST = '240f00dd-715b-4c78-9661-3147b7650a0f'; // 10.Notificaciones
const SUBS_LIST = '648fde7b-89d2-40ac-bc4a-63661508b50a'; // 09.PushSubscriptions

if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SITE_ID) {
  console.error('Missing env. Have:', {
    TENANT_ID: !!TENANT_ID, CLIENT_ID: !!CLIENT_ID, CLIENT_SECRET: !!CLIENT_SECRET, SITE_ID: !!SITE_ID,
  });
  process.exit(1);
}

async function token() {
  const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default',
    }).toString(),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('auth failed: ' + JSON.stringify(d).slice(0, 300));
  return d.access_token;
}

async function getAll(tok, listId, { orderby, maxRows = 6000 } = {}) {
  const rows = [];
  let next = `https://graph.microsoft.com/v1.0/sites/${SITE_ID}/lists/${listId}/items?$expand=fields&$top=500`
    + (orderby ? `&$orderby=${encodeURIComponent(orderby)}` : '');
  while (next && rows.length < maxRows) {
    const r = await fetch(next, {
      headers: { Authorization: `Bearer ${tok}`, Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' },
    });
    if (!r.ok) { console.error(`GET ${listId} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`); break; }
    const d = await r.json();
    for (const it of d.value ?? []) rows.push(it);
    next = d['@odata.nextLink'] ?? null;
  }
  return rows;
}

const arDate = (iso) => {
  const t = new Date(iso);
  if (isNaN(t)) return '??';
  // AR is UTC-3
  return new Date(t.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
};
const arTime = (iso) => {
  const t = new Date(iso);
  if (isNaN(t)) return '??';
  return new Date(t.getTime() - 3 * 3600 * 1000).toISOString().slice(11, 19);
};

const TODAY_AR = process.argv[2] || '2026-06-12';

(async () => {
  const tok = await token();

  // ── 10.Notificaciones ──────────────────────────────────────────────────────
  const notifs = await getAll(tok, NOTIF_LIST, { orderby: 'fields/Fecha_N desc' });
  const today = notifs.filter(n => arDate(n.fields?.Fecha_N) === TODAY_AR);

  console.log(`\n===== 10.Notificaciones — total fetched=${notifs.length}, today(${TODAY_AR})=${today.length} =====`);

  // group by entorno
  const byEnt = {};
  for (const n of today) {
    const e = String(n.fields?.Entorno_N ?? '(none)');
    (byEnt[e] ??= []).push(n);
  }
  for (const [ent, list] of Object.entries(byEnt)) {
    console.log(`\n--- Entorno_N=${ent}: ${list.length} notif rows today ---`);
    // duplicate cluster key: user + ticket + type
    const clusters = {};
    for (const n of list) {
      const f = n.fields ?? {};
      const key = `${f.UserId_N}|${f.TicketId_N}|${f.Type_N}`;
      (clusters[key] ??= []).push(n);
    }
    const dupes = Object.entries(clusters).filter(([, v]) => v.length >= 2);
    dupes.sort((a, b) => b[1].length - a[1].length);
    console.log(`  distinct (user|ticket|type) clusters: ${Object.keys(clusters).length}; with >=2 rows: ${dupes.length}`);
    const dupRows = dupes.reduce((s, [, v]) => s + v.length, 0);
    console.log(`  total rows inside dup clusters: ${dupRows} (excess = ${dupRows - dupes.length})`);
    // histogram of cluster sizes
    const hist = {};
    for (const [, v] of Object.entries(clusters)) hist[v.length] = (hist[v.length] ?? 0) + 1;
    console.log(`  cluster-size histogram (size:count):`, hist);
    // show top dup clusters with timestamp spread
    console.log(`  top duplicate clusters:`);
    for (const [key, v] of dupes.slice(0, 12)) {
      const times = v.map(x => arTime(x.fields?.Fecha_N)).sort();
      const ids = v.map(x => x.id).join(',');
      const spanSec = (new Date(v[0].fields?.Fecha_N) - new Date(v[v.length - 1].fields?.Fecha_N)) / 1000;
      console.log(`    [x${v.length}] ${key}  times=[${times.join(' ')}]  spreadSec=${Math.abs(spanSec)}  ids=${ids}`);
    }
  }

  // ── 09.PushSubscriptions ────────────────────────────────────────────────────
  const subs = await getAll(tok, SUBS_LIST);
  console.log(`\n\n===== 09.PushSubscriptions — total=${subs.length} =====`);
  const subByEnt = {};
  for (const s of subs) {
    const e = String(s.fields?.Entorno_PS ?? '(none)');
    (subByEnt[e] ??= []).push(s);
  }
  for (const [ent, list] of Object.entries(subByEnt)) {
    console.log(`\n--- Entorno_PS=${ent}: ${list.length} subscriptions ---`);
    const byUser = {};
    for (const s of list) {
      const u = String(s.fields?.UserId_PS ?? '(none)');
      (byUser[u] ??= new Set()).add(String(s.fields?.Endpoint_PS ?? '').slice(-24));
    }
    const multi = Object.entries(byUser)
      .map(([u, eps]) => [u, eps.size])
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1]);
    console.log(`  distinct users: ${Object.keys(byUser).length}; users with >=2 distinct subs: ${multi.length}`);
    console.log(`  per-user subscription count (userId:subs) for multi-sub users:`, Object.fromEntries(multi));
    const histS = {};
    for (const [, eps] of Object.entries(byUser)) histS[eps.size] = (histS[eps.size] ?? 0) + 1;
    console.log(`  subs-per-user histogram (subs:userCount):`, histS);
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
