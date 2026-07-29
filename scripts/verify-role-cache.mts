/**
 * Smoke test del cutover de roles (paso 4): confirma que api/role-cache.ts lee de Supabase y
 * devuelve el RoleConfig con el contrato intacto. Es el mismo seam que usa el login (auth.ts).
 *
 *   npx tsx scripts/verify-role-cache.mts
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Cargar env ANTES de importar el módulo (getSupabaseAdmin lee las envs lazy, pero cargamos
// primero por las dudas). Mismo criterio que dev-server.ts: .env.local override, .env base.
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
  } catch { /* siguiente archivo */ }
}

const { getRolesCached, getRoleByName } = await import('../api/role-cache.js');

(async () => {
  const all = await getRolesCached();
  console.log(`getRolesCached() → ${all.length} roles activos desde Supabase\n`);

  // Chequeo de contrato en un rol conocido (Azafata: 3 mods, 6 perms, pisos true).
  for (const name of ['Azafata', 'Catering', 'Admin', 'no-existe-xyz']) {
    const r = await getRoleByName(name);
    if (!r) { console.log(`getRoleByName("${name}") → null (modo solo-lectura)`); continue; }
    const okShape =
      typeof r.id === 'string' &&
      Array.isArray(r.modules) &&
      Array.isArray(r.permissions) &&
      typeof r.filterByFloors === 'boolean' &&
      typeof r.bypassLocationCheck === 'boolean';
    console.log(`getRoleByName("${name}") → { modules:${r.modules.length}, permissions:${r.permissions.length}, filterByFloors:${r.filterByFloors}, bypass:${r.bypassLocationCheck} }  contrato:${okShape ? '✅' : '❌'}`);
    if (name === 'Azafata') console.log(`   perms: ${r.permissions.join(', ')}`);
  }

  // Match case-insensitive (getRoleByName usa lower/trim).
  const lower = await getRoleByName('  azAFAta ');
  console.log(`\ngetRoleByName("  azAFAta ") (case/trim) → ${lower ? 'match ✅' : 'null ❌'}`);
})();
