/**
 * Script TEMPORAL para listar suscripciones push del rol CATERING en SharePoint.
 * Uso: `npx tsx scripts/list-catering-subs.mts`
 *
 * No expone credenciales — usa las envs del proyecto vía .env.local.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Cargar .env.local (mismo loader que dev-server.ts) ──────────────────────
try {
  const envPath = resolve(import.meta.dirname ?? '.', '..', '.env.local');
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch (e: any) {
  console.error('No pude cargar .env.local:', e.message);
  process.exit(1);
}

// ── Cliente Graph minimal ────────────────────────────────────────────────────
const TENANT_ID     = process.env.AZURE_TENANT_ID     ?? '';
const CLIENT_ID     = process.env.AZURE_CLIENTE_ID    ?? '';
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET ?? '';
const SITE_ID       = process.env.SHAREPOINT_SITE_ID  ?? '';
const LIST_ID       = '648fde7b-89d2-40ac-bc4a-63661508b50a'; // 09.PushSubscriptions

if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SITE_ID) {
  console.error('Faltan envs Azure/SharePoint');
  process.exit(1);
}

async function getToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope:         'https://graph.microsoft.com/.default',
      }).toString(),
    },
  );
  const data: any = await res.json();
  if (!data.access_token) throw new Error('Auth Graph falló: ' + JSON.stringify(data));
  return data.access_token;
}

async function listAllSubs() {
  const token = await getToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${SITE_ID}/lists/${LIST_ID}/items?$expand=fields&$top=500`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly',
      },
    },
  );
  if (!res.ok) {
    console.error('SP error:', res.status, await res.text());
    process.exit(1);
  }
  const data: any = await res.json();
  return (data.value ?? []).map((item: any) => {
    const f = item.fields ?? {};
    const endpoint = String(f.Endpoint_PS ?? '');
    return {
      id: String(item.id),
      userId: String(f.UserId_PS ?? ''),
      role: String(f.UserRole_PS ?? ''),
      sede: String(f.Sede_PS ?? ''),
      entorno: String(f.Entorno_PS ?? '(empty)'),
      assignedAreas: String(f.AssignedAreas_PS ?? '').split(';').filter(Boolean),
      endpointHost: endpoint ? new URL(endpoint).host : '(empty)',
      endpointTail: endpoint ? endpoint.slice(-12) : '',
      hasKeys: !!f.Keys_PS,
      created: item.createdDateTime ?? '',
      modified: item.lastModifiedDateTime ?? '',
    };
  });
}

(async () => {
  const all = await listAllSubs();

  // Resumen por rol
  const byRole: Record<string, { total: number; withAreas: number; withoutAreas: number }> = {};
  for (const s of all) {
    const role = (s.role || '(empty)').toUpperCase();
    if (!byRole[role]) byRole[role] = { total: 0, withAreas: 0, withoutAreas: 0 };
    byRole[role].total++;
    if (s.assignedAreas.length > 0) byRole[role].withAreas++;
    else byRole[role].withoutAreas++;
  }

  console.log('\n=== RESUMEN POR ROL ===');
  console.table(byRole);

  // Detalle Catering
  const catering = all.filter(s => s.role.toUpperCase() === 'CATERING');
  console.log(`\n=== CATERING (${catering.length}) ===`);
  if (catering.length === 0) {
    console.log('No hay suscripciones de Catering registradas.');
  } else {
    console.table(catering.map(s => ({
      userId: s.userId,
      entorno: s.entorno,
      areas: s.assignedAreas.join(', ') || '(VACÍO ❌)',
      sede: s.sede,
      host: s.endpointHost,
      tail: s.endpointTail,
      modified: s.modified.slice(0, 16),
    })));
  }

  // Detalle Azafata (por comparación)
  const azafata = all.filter(s => ['HOSTESS', 'AZAFATA'].includes(s.role.toUpperCase()));
  console.log(`\n=== AZAFATA (${azafata.length}) ===`);
  if (azafata.length === 0) {
    console.log('No hay suscripciones de Azafata registradas.');
  } else {
    console.table(azafata.map(s => ({
      userId: s.userId,
      areas: s.assignedAreas.join(', ') || '(VACÍO ❌)',
      sede: s.sede,
      host: s.endpointHost,
      tail: s.endpointTail,
      modified: s.modified.slice(0, 16),
    })));
  }

  console.log(`\nTotal de suscripciones activas: ${all.length}`);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  if (process.argv.includes('--clean')) {
    // Acotar al entorno actual: no borrar huérfanas de PROD por accidente al
    // correr con .env.local apuntando a TESTING (o viceversa). Las subs sin
    // entorno seteado (legacy, anteriores al cambio) se consideran del entorno
    // actual ya que no podemos distinguirlas — si ya migraron todos los users
    // a la nueva versión, no quedan subs así.
    const targetEntorno = (process.env.ENTORNO ?? 'TESTING').trim();
    console.log(`\n[clean] Filtrando huérfanas del entorno '${targetEntorno}' (las subs en otro entorno no se tocan).`);
    const orphans = catering.filter(s =>
      s.assignedAreas.length === 0 &&
      (s.entorno === targetEntorno || s.entorno === '(empty)')
    );
    if (orphans.length === 0) {
      console.log('[clean] No hay subs huérfanas de Catering para borrar en este entorno.');
      return;
    }
    console.log(`[clean] Borrando ${orphans.length} sub(s) huérfana(s) de Catering...`);
    const token = await getToken();
    let deleted = 0;
    for (const s of orphans) {
      const r = await fetch(
        `https://graph.microsoft.com/v1.0/sites/${SITE_ID}/lists/${LIST_ID}/items/${s.id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      );
      if (r.ok || r.status === 204) {
        console.log(`  ✓ Borrada id=${s.id} userId=${s.userId} tail=${s.endpointTail}`);
        deleted++;
      } else {
        console.error(`  ✗ Falló id=${s.id}: HTTP ${r.status}`);
      }
    }
    console.log(`[clean] Listo. ${deleted}/${orphans.length} borradas.`);
  }
})();
