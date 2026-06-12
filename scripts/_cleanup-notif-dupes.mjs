// One-off cleanup: remove SAME-EVENT duplicate rows from 10.Notificaciones left by the
// per-subscription fanout bug. A "duplicate" = rows sharing the EXACT same
// (Entorno_N | UserId_N | TicketId_N | Type_N | Fecha_N). Keeps the lowest SP id per
// group, deletes the rest. Distinct timestamps are NEVER merged (they may be real
// separate events), so this is conservative.
//
// DRY-RUN by default (prints what it WOULD delete). Pass --apply to actually DELETE.
//   node scripts/_cleanup-notif-dupes.mjs [YYYY-MM-DD] [--entorno PRODUCTIVO] [--apply]
// Date defaults to today AR (2026-06-12). Omit date with --all to consider every fetched row.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  } catch { /* optional */ }
}
loadEnv('.env.local');

const TENANT_ID = process.env.AZURE_TENANT_ID ?? '';
const CLIENT_ID = process.env.AZURE_CLIENTE_ID ?? '';
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET ?? '';
const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const NOTIF_LIST = '240f00dd-715b-4c78-9661-3147b7650a0f'; // 10.Notificaciones

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ALL = args.includes('--all');
const entIdx = args.indexOf('--entorno');
const ENTORNO = entIdx >= 0 ? args[entIdx + 1] : 'PRODUCTIVO';
const DATE = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || '2026-06-12';

if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SITE_ID) {
  console.error('Missing env (AZURE_*/SHAREPOINT_SITE_ID).'); process.exit(1);
}

async function token() {
  const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default',
    }).toString(),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('auth failed: ' + JSON.stringify(d).slice(0, 200));
  return d.access_token;
}

async function getAll(tok, maxRows = 8000) {
  const rows = [];
  let next = `https://graph.microsoft.com/v1.0/sites/${SITE_ID}/lists/${NOTIF_LIST}/items`
    + `?$expand=fields&$top=500&$orderby=${encodeURIComponent('fields/Fecha_N desc')}`;
  while (next && rows.length < maxRows) {
    const r = await fetch(next, { headers: { Authorization: `Bearer ${tok}`, Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } });
    if (!r.ok) { console.error(`GET HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`); break; }
    const d = await r.json();
    for (const it of d.value ?? []) rows.push(it);
    next = d['@odata.nextLink'] ?? null;
  }
  return rows;
}

const arDate = (iso) => {
  const t = new Date(iso); if (isNaN(t)) return '??';
  return new Date(t.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
};

(async () => {
  const tok = await token();
  const all = await getAll(tok);
  const scoped = all.filter(n => {
    const f = n.fields ?? {};
    if (String(f.Entorno_N ?? '') !== ENTORNO) return false;
    if (!ALL && arDate(f.Fecha_N) !== DATE) return false;
    return true;
  });

  // group by exact (user|ticket|type|fecha)
  const groups = new Map();
  for (const n of scoped) {
    const f = n.fields ?? {};
    const key = `${f.UserId_N}|${f.TicketId_N ?? ''}|${f.Type_N}|${f.Fecha_N}`;
    (groups.get(key) ?? groups.set(key, []).get(key)).push(n);
  }

  const toDelete = [];
  let dupGroups = 0;
  for (const [, rows] of groups) {
    if (rows.length < 2) continue;
    dupGroups++;
    rows.sort((a, b) => Number(a.id) - Number(b.id)); // keep lowest id
    for (const r of rows.slice(1)) toDelete.push(r.id);
  }

  console.log(`\nScope: Entorno_N=${ENTORNO} ${ALL ? '(ALL dates)' : `date=${DATE}`}`);
  console.log(`Rows in scope: ${scoped.length}`);
  console.log(`Exact-duplicate groups (size>=2, same user|ticket|type|Fecha_N): ${dupGroups}`);
  console.log(`Rows that WOULD be deleted (keep 1 per group): ${toDelete.length}`);
  console.log(`Rows remaining after cleanup: ${scoped.length - toDelete.length}`);

  if (!APPLY) {
    console.log(`\n[DRY-RUN] No deletions performed. Re-run with --apply to delete the ${toDelete.length} rows above.`);
    console.log(`Sample of ids to delete: ${toDelete.slice(0, 20).join(', ')}${toDelete.length > 20 ? ' ...' : ''}`);
    return;
  }

  console.log(`\n[APPLY] Deleting ${toDelete.length} rows...`);
  let ok = 0, fail = 0;
  for (let i = 0; i < toDelete.length; i++) {
    const id = toDelete[i];
    const r = await fetch(`https://graph.microsoft.com/v1.0/sites/${SITE_ID}/lists/${NOTIF_LIST}/items/${id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${tok}` } });
    if (r.ok || r.status === 204) ok++;
    else { fail++; console.error(`  DELETE ${id} -> ${r.status}`); }
    if ((i + 1) % 50 === 0) console.log(`  ...${i + 1}/${toDelete.length} (ok=${ok} fail=${fail})`);
  }
  console.log(`\nDone. Deleted ok=${ok} fail=${fail}.`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
