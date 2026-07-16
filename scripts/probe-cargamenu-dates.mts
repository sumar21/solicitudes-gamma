/**
 * Fase 0 — Probe de esquema de 16.CargaMenu.
 *
 * Todo el diseño de vigencia ("¿qué menú aplica HOY?") descansa en que un round-trip a una
 * columna date-only de SharePoint recupere el MISMO día que se escribió. Un off-by-one acá
 * corre toda la vigencia un día y **solo se nota el primer y último día de cada rango**.
 * Como la lista está vacía, no hay un dato real contra el cual verificarlo → este probe.
 *
 * Qué hace:
 *   1. Lee las definiciones de columna (type / indexed / maxLength).
 *   2. Escribe filas de prueba con 4 formatos de fecha distintos y muestra el crudo que
 *      devuelve Graph + el resultado de .slice(0,10).
 *   3. Borra las filas de prueba (hard-delete: son basura, no datos de negocio).
 *
 * Las filas de prueba van con Entorno_CM='MUESTRA' y Status_CM='Inactivo' para que, si algo
 * falla y quedan, no las levante ningún GET de la app (que filtra PRODUCTIVO/TESTING + Activo).
 *
 * Uso:
 *   npx tsx scripts/probe-cargamenu-dates.mts          # probe completo (escribe y borra)
 *   npx tsx scripts/probe-cargamenu-dates.mts --read   # solo lee el esquema, no escribe
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Cargar .env / .env.local ────────────────────────────────────────────────
for (const f of ['.env.local', '.env']) {
  try {
    const p = resolve(import.meta.dirname ?? '.', '..', f);
    for (const line of readFileSync(p, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  } catch { /* el archivo puede no existir */ }
}

const TENANT = process.env.AZURE_TENANT_ID ?? '';
const CID    = process.env.AZURE_CLIENTE_ID ?? '';
const CSEC   = process.env.AZURE_CLIENT_SECRET ?? '';
const SITE   = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST   = 'f6720c30-aecb-4e7e-ad50-2ba108498bd3'; // 16.CargaMenu
const READ_ONLY = process.argv.includes('--read');

if (!TENANT || !CID || !CSEC || !SITE) {
  console.error('Faltan AZURE_TENANT_ID / AZURE_CLIENTE_ID / AZURE_CLIENT_SECRET / SHAREPOINT_SITE_ID');
  process.exit(1);
}

async function token(): Promise<string> {
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: CID, client_secret: CSEC,
      scope: 'https://graph.microsoft.com/.default',
    }).toString(),
  });
  const d: any = await r.json();
  if (!d.access_token) throw new Error('Graph auth failed: ' + JSON.stringify(d));
  return d.access_token;
}

async function g(path: string, tok: string, init?: RequestInit) {
  const r = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const txt = await r.text();
  let body: any = null;
  try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
  return { status: r.status, ok: r.ok, body };
}

const BASE = () => `/sites/${SITE}/lists/${LIST}`;

(async () => {
  const tok = await token();

  // ── 1. Definiciones de columna ────────────────────────────────────────────
  console.log('\n╔═══ 1. ESQUEMA DE 16.CargaMenu ═══╗\n');
  const cols = await g(`${BASE()}/columns`, tok);
  if (!cols.ok) { console.error('No pude leer columnas:', cols.status, cols.body); process.exit(1); }

  const OURS = ['FechaInicio_CM', 'FechaFin_CM', 'Turno_CM', 'Tipo_CM', 'Comanda_CM', 'Status_CM', 'Entorno_CM', 'NombreUserCarga_CM', 'UserID_CM', 'FechaCarga_CM'];
  for (const c of (cols.body.value ?? []) as any[]) {
    if (!OURS.includes(c.name)) continue;
    const bits: string[] = [];
    if (c.text)     bits.push(`text(maxLength=${c.text.maxLength ?? '?'}, multiline=${!!c.text.allowMultipleLines})`);
    if (c.dateTime) bits.push(`dateTime(format=${c.dateTime.format ?? '?'}, display=${c.dateTime.displayAs ?? '?'})`);
    if (c.number)   bits.push('number');
    if (c.choice)   bits.push(`choice[${(c.choice.choices ?? []).join('|')}]`);
    console.log(`  ${c.name.padEnd(20)} ${bits.join(' ') || '?'}`);
    console.log(`  ${''.padEnd(20)} indexed=${!!c.indexed}  required=${!!c.required}`);
  }

  // Zona regional del site — puede explicar un off-by-one.
  const site = await g(`/sites/${SITE}?$select=id,displayName`, tok);
  console.log(`\n  Site: ${site.body?.displayName ?? '?'}`);

  if (READ_ONLY) { console.log('\n--read → no escribo nada. Fin.\n'); return; }

  // ── 2. Round-trip de fechas ───────────────────────────────────────────────
  console.log('\n╔═══ 2. ROUND-TRIP DE FECHAS (el punto crítico) ═══╗');
  console.log('  Se escribe el MISMO día (2026-07-15) en 4 formatos y se compara qué vuelve.\n');

  const TARGET_DAY = '2026-07-15';
  const VARIANTS = [
    { name: 'date-only puro   ', value: '2026-07-15' },
    { name: 'medianoche UTC   ', value: '2026-07-15T00:00:00Z' },
    { name: 'mediodía UTC     ', value: '2026-07-15T12:00:00Z' },
    { name: 'noche ART (-03:00)', value: '2026-07-15T22:00:00-03:00' },
  ];

  const created: string[] = [];
  const results: { name: string; sent: string; got: string; sliced: string; ok: boolean }[] = [];

  for (const v of VARIANTS) {
    const fields = {
      Title: '[sumar]',
      Turno_CM: 'ALMUERZO', Tipo_CM: 'MENU',
      Comanda_CM: `PROBE ${v.name.trim()}`,
      FechaInicio_CM: v.value, FechaFin_CM: v.value,
      Status_CM: 'Inactivo',      // no lo levanta ningún GET
      Entorno_CM: 'MUESTRA',      // ni PRODUCTIVO ni TESTING
    };
    const post = await g(`${BASE()}/items`, tok, { method: 'POST', body: JSON.stringify({ fields }) });
    if (!post.ok) {
      console.log(`  ✗ ${v.name}  RECHAZADO por SP: ${post.status} ${JSON.stringify(post.body?.error?.message ?? post.body).slice(0, 160)}`);
      results.push({ name: v.name, sent: v.value, got: 'RECHAZADO', sliced: '—', ok: false });
      continue;
    }
    const id = String(post.body.id);
    created.push(id);

    const read = await g(`${BASE()}/items/${id}?$expand=fields`, tok);
    const got = String(read.body?.fields?.FechaInicio_CM ?? '');
    const sliced = got.slice(0, 10);
    const ok = sliced === TARGET_DAY;
    results.push({ name: v.name, sent: v.value, got, sliced, ok });
  }

  console.log('  Formato enviado          →  crudo que devuelve Graph          →  .slice(0,10)   ¿día OK?');
  console.log('  ' + '─'.repeat(94));
  for (const r of results) {
    console.log(`  ${r.name}  ${String(r.sent).padEnd(26)} ${String(r.got).padEnd(30)} ${String(r.sliced).padEnd(12)} ${r.ok ? '✅ SÍ' : '❌ NO'}`);
  }

  // ── 3. maxLength real de Comanda_CM ───────────────────────────────────────
  console.log('\n╔═══ 3. LÍMITE REAL DE Comanda_CM ═══╗\n');
  const long = 'X'.repeat(300);
  const postLong = await g(`${BASE()}/items`, tok, {
    method: 'POST',
    body: JSON.stringify({ fields: {
      Title: '[sumar]', Turno_CM: 'CENA', Tipo_CM: 'OPCION', Comanda_CM: long,
      FechaInicio_CM: TARGET_DAY, FechaFin_CM: TARGET_DAY, Status_CM: 'Inactivo', Entorno_CM: 'MUESTRA',
    } }),
  });
  if (postLong.ok) {
    const id = String(postLong.body.id); created.push(id);
    const read = await g(`${BASE()}/items/${id}?$expand=fields`, tok);
    const stored = String(read.body?.fields?.Comanda_CM ?? '');
    console.log(`  Enviados 300 chars → SP guardó ${stored.length}.`);
    console.log(`  ${stored.length === 300 ? '✅ No truncó (el tope es ≥300)' : `⚠️  TRUNCÓ a ${stored.length} — el form debe usar maxLength=${stored.length}`}`);
  } else {
    console.log(`  SP RECHAZÓ 300 chars: ${postLong.status} ${JSON.stringify(postLong.body?.error?.message ?? '').slice(0, 200)}`);
    console.log('  → hay un tope duro; el form debe validar ANTES de mandar.');
  }

  // ── 4. Limpieza ───────────────────────────────────────────────────────────
  console.log('\n╔═══ 4. LIMPIEZA ═══╗\n');
  let del = 0;
  for (const id of created) {
    const r = await g(`${BASE()}/items/${id}`, tok, { method: 'DELETE' });
    if (r.ok || r.status === 204 || r.status === 404) del++;
    else console.log(`  ⚠️  No pude borrar el item ${id}: ${r.status}`);
  }
  console.log(`  ${del}/${created.length} filas de prueba borradas.`);

  const left = await g(`${BASE()}/items?$expand=fields&$top=10`, tok);
  console.log(`  Filas que quedan en la lista: ${(left.body?.value ?? []).length} (debe ser 0)`);

  // ── Veredicto ─────────────────────────────────────────────────────────────
  console.log('\n╔═══ VEREDICTO ═══╗\n');
  const good = results.filter(r => r.ok);
  if (good.length === 0) {
    console.log('  ❌ NINGÚN formato round-tripea bien → PARAR y rediseñar el mapeo de fechas.');
  } else {
    console.log('  Formatos seguros para escribir en FechaInicio_CM / FechaFin_CM:');
    for (const r of good) console.log(`    ✅ ${r.sent}`);
    const bad = results.filter(r => !r.ok);
    if (bad.length) {
      console.log('\n  NO usar (devuelven otro día o los rechaza SP):');
      for (const r of bad) console.log(`    ❌ ${r.sent}  → .slice(0,10) = ${r.sliced}`);
    }
  }
  console.log('\n  ⚠️  Pendiente MANUAL: abrir la lista en la UI de SharePoint y confirmar que la fila');
  console.log('     muestra 15/07 y no 14/07. La API puede round-tripear bien y el web UI mostrar el día');
  console.log('     anterior (usa la zona regional del site, no UTC).\n');
})().catch(e => { console.error('Error:', e); process.exit(1); });
