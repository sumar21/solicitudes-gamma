/**
 * SEED one-shot: roles de SharePoint (99.ABMRoles_Traslados) → Supabase (public.roles).
 *
 * Migración de la DEFINICIÓN de roles a Postgres (ver plan). Los usuarios NO se migran: siguen
 * en 00.Usuarios y el join usuario→rol sigue por NOMBRE (Perfil_U ↔ roles.name, case-insensitive).
 *
 * Idempotente: por cada rol activo de SP, si ya existe en Supabase (match lower(name)) lo ACTUALIZA,
 * si no lo INSERTA. Re-correr no duplica. NO borra nada (los roles que sobran en Supabase se listan
 * como aviso pero no se tocan). El mapeo replica EXACTO api/role-cache.ts (mismo parseBool, mismos
 * splits '/' y ';') para no cambiar el veredicto de ningún permiso/flag.
 *
 * Uso:
 *   npx tsx scripts/seed-roles.mts            → DRY-RUN (muestra qué haría + validación, no escribe)
 *   npx tsx scripts/seed-roles.mts --apply    → escribe en Supabase (insert/update)
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

// ── Carga de env: .env.local (override) y .env (base), igual criterio que dev-server.ts ──
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
  } catch { /* el archivo puede no existir — se prueba el siguiente */ }
}

const TENANT_ID = process.env.AZURE_TENANT_ID ?? '';
const CLIENT_ID = process.env.AZURE_CLIENTE_ID ?? ''; // (sic) el nombre real en este repo tiene la 'E'
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET ?? '';
const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const ROLES_LIST = '68836bbe-18c5-4cb2-8cc6-e21ecae96710'; // 99.ABMRoles_Traslados
const USERS_LIST = 'e623ad06-ff62-441f-b67d-666224af5805'; // 00.Usuarios (solo para validar huérfanos)

const SUPA_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPA_SECRET = process.env.SUPABASE_SECRET_KEY ?? '';

const APPLY = process.argv.includes('--apply');

if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SITE_ID) { console.error('❌ Faltan envs Azure/SharePoint'); process.exit(1); }
if (!SUPA_URL || !SUPA_SECRET) { console.error('❌ Faltan VITE_SUPABASE_URL / SUPABASE_SECRET_KEY'); process.exit(1); }

// parseBool IDÉNTICO a api/role-cache.ts (no cambiar: define el veredicto de cada flag).
function parseBool(raw: unknown): boolean {
  if (!raw) return false;
  const v = String(raw).trim().toLowerCase();
  return v === 'sí' || v === 'si' || v === 'yes' || v === 'true' || v === '1';
}

interface RoleRow {
  name: string;
  modules: string[];
  permissions: string[];
  filter_by_floors: boolean;
  bypass_location_check: boolean;
  status: string;
}

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

(async () => {
  console.log(`Modo: ${APPLY ? 'APPLY (escribe en Supabase)' : 'DRY-RUN (no escribe nada)'}\n`);
  const token = await getGraphToken();

  // ── 1) Leer roles ACTIVOS de SP (mismo GET que role-cache.fetchRolesFromSP) ──
  const rawRoles = await graphGetAll(token, ROLES_LIST, `$expand=fields&$filter=${encodeURIComponent("fields/Status_RT eq 'Activo'")}&$top=200`);
  const spRoles: RoleRow[] = rawRoles.map((item: any) => {
    const f = item.fields ?? {};
    return {
      name: String(f.NombreRol_RT ?? '').trim(),
      modules: String(f.Acceso_RT ?? '').split('/').map((s: string) => s.trim()).filter(Boolean),
      permissions: String(f.Permisos_RT ?? '').split(';').map((s: string) => s.trim()).filter(Boolean),
      filter_by_floors: parseBool(f.FiltrarPisos_RT),
      bypass_location_check: parseBool(f.BypassUbicacion_RT),
      status: 'Activo',
    };
  }).filter((r: RoleRow) => r.name);

  console.log(`SP: ${spRoles.length} roles activos en 99.ABMRoles_Traslados`);
  for (const r of spRoles) {
    console.log(`  · ${r.name}  [mods:${r.modules.length} perms:${r.permissions.length} pisos:${r.filter_by_floors} bypass:${r.bypass_location_check}]`);
  }

  // Chequeo de colisión por lower(name) DENTRO de SP (el índice único de Supabase lo rechazaría).
  const byLower = new Map<string, string[]>();
  for (const r of spRoles) { const k = r.name.toLowerCase(); byLower.set(k, [...(byLower.get(k) ?? []), r.name]); }
  const collisions = [...byLower.values()].filter(v => v.length > 1);
  if (collisions.length) {
    console.error('\n❌ COLISIÓN por lower(name) en SP (dos roles que chocarían en el índice único):');
    for (const c of collisions) console.error('   ', c.join('  |  '));
    console.error('   Resolvé esto en SP antes de sembrar (renombrar/desactivar uno).');
    process.exit(1);
  }

  // ── 2) Estado actual en Supabase ──
  const supa = createClient(SUPA_URL, SUPA_SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: existing, error: exErr } = await supa.from('roles').select('id, name, status');
  if (exErr) { console.error('❌ Error leyendo public.roles:', exErr.message); process.exit(1); }
  const existingByLower = new Map<string, { id: string; name: string; status: string }>();
  for (const e of existing ?? []) existingByLower.set(String(e.name).toLowerCase(), e as any);

  const toInsert = spRoles.filter(r => !existingByLower.has(r.name.toLowerCase()));
  const toUpdate = spRoles.filter(r => existingByLower.has(r.name.toLowerCase()));
  const orphanInSupa = (existing ?? []).filter(e => !byLower.has(String(e.name).toLowerCase()));

  console.log(`\nSupabase: ${existing?.length ?? 0} filas existentes → ${toInsert.length} a insertar, ${toUpdate.length} a actualizar`);
  if (orphanInSupa.length) console.log(`  ⚠️  ${orphanInSupa.length} rol(es) en Supabase sin match en SP (NO se tocan): ${orphanInSupa.map(o => o.name).join(', ')}`);

  // ── 3) Escritura (solo con --apply) ──
  if (APPLY) {
    for (const r of toInsert) {
      const { error } = await supa.from('roles').insert(r);
      if (error) { console.error(`❌ insert "${r.name}":`, error.message); process.exit(1); }
    }
    for (const r of toUpdate) {
      const id = existingByLower.get(r.name.toLowerCase())!.id;
      const { error } = await supa.from('roles').update({
        name: r.name, modules: r.modules, permissions: r.permissions,
        filter_by_floors: r.filter_by_floors, bypass_location_check: r.bypass_location_check, status: 'Activo',
      }).eq('id', id);
      if (error) { console.error(`❌ update "${r.name}":`, error.message); process.exit(1); }
    }
    console.log(`\n✅ Escrito: ${toInsert.length} insertados, ${toUpdate.length} actualizados`);
  }

  // ── 4) VALIDACIÓN (bloqueante conceptual — se corre siempre) ──
  console.log('\n=== VALIDACIÓN ===');

  // (a) conteo activos: Supabase == SP (tras apply). En dry-run muestra el estado previo.
  const { data: afterActive } = await supa.from('roles').select('id', { count: 'exact' }).eq('status', 'Activo');
  const supaActive = afterActive?.length ?? 0;
  console.log(`(a) roles activos → SP: ${spRoles.length} · Supabase: ${supaActive} ${APPLY ? (supaActive === spRoles.length ? '✅' : '❌ NO COINCIDEN') : '(dry-run: aún no escrito)'}`);

  // (b) huérfanos: cada Perfil_U DISTINCT de usuarios debe matchear un role.name (case-insensitive).
  const rawUsers = await graphGetAll(token, USERS_LIST, `$expand=fields&$select=id&$top=999`);
  const perfiles = new Set<string>();
  for (const u of rawUsers) { const p = String(u.fields?.Perfil_U ?? '').trim(); if (p) perfiles.add(p); }
  const roleNamesLower = new Set(spRoles.map(r => r.name.toLowerCase()));
  const orphanPerfiles = [...perfiles].filter(p => !roleNamesLower.has(p.toLowerCase()));
  console.log(`(b) Perfil_U distintos en 00.Usuarios: ${perfiles.size} · sin rol que matchee: ${orphanPerfiles.length} ${orphanPerfiles.length ? '⚠️' : '✅'}`);
  if (orphanPerfiles.length) {
    console.log('    (esos usuarios caerían a modo solo-lectura tras el cutover — ya pasa hoy con SP igual):');
    for (const p of orphanPerfiles) console.log(`      · "${p}"`);
  }

  if (!APPLY) console.log('\n(DRY-RUN — no se escribió nada. Corré con --apply para ejecutar.)');
})();
