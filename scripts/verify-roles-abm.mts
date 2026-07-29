/**
 * Smoke test del CRUD de la ABM (paso 5) contra Supabase public.roles. Replica las operaciones
 * del handler api/roles.ts sobre un rol descartable y lo BORRA en duro al final (no ensucia).
 *
 *   npx tsx scripts/verify-roles-abm.mts
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

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const KEY = process.env.SUPABASE_SECRET_KEY ?? '';
const supa = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const NAME = 'ZZZ-VERIFY-BORRAR';
const splitModules = (access: string) => access.split('/').map(s => s.trim()).filter(Boolean);
const ok = (b: boolean) => (b ? '✅' : '❌');

(async () => {
  // limpieza previa por si quedó de una corrida anterior
  await supa.from('roles').delete().ilike('name', NAME);

  // 1) INSERT (POST): access 'Home/Operativa' → modules text[]
  const { data: ins, error: e1 } = await supa.from('roles').insert({
    name: NAME, modules: splitModules('Home/Operativa'), permissions: ['crear_ticket'],
    filter_by_floors: true, bypass_location_check: false, status: 'Activo',
  }).select('id, modules, permissions, filter_by_floors').single();
  console.log(`1) INSERT → ${ok(!e1 && !!ins)} ${e1 ? e1.message : `modules=[${ins!.modules}] perms=[${ins!.permissions}] pisos=${ins!.filter_by_floors}`}`);
  if (e1 || !ins) process.exit(1);
  const id = ins.id;

  // 2) toApiRole: access debe recomponerse como 'Home/Operativa'
  const access = (ins.modules as string[]).join('/');
  console.log(`2) toApiRole.access = "${access}" ${ok(access === 'Home/Operativa')}`);

  // 3) Nombre duplicado (distinto casing) → debe violar unique(lower(name)) = 23505
  const { error: e3 } = await supa.from('roles').insert({ name: NAME.toLowerCase(), status: 'Activo' });
  console.log(`3) INSERT duplicado (lower) → rechazado:${ok(e3?.code === '23505')} ${e3 ? `(code ${e3.code})` : '❌ NO rechazó'}`);

  // 4) PATCH permisos
  const { error: e4 } = await supa.from('roles').update({ permissions: ['crear_ticket', 'editar_ticket'] }).eq('id', id);
  const { data: after } = await supa.from('roles').select('permissions').eq('id', id).single();
  console.log(`4) PATCH permisos → ${ok(!e4 && (after?.permissions?.length === 2))} perms=[${after?.permissions}]`);

  // 5) DELETE soft (status='Inactivo') → desaparece del GET de activos
  await supa.from('roles').update({ status: 'Inactivo' }).eq('id', id);
  const { data: active } = await supa.from('roles').select('id').eq('id', id).eq('status', 'Activo');
  console.log(`5) DELETE soft → fuera del GET activos:${ok((active?.length ?? 0) === 0)}`);

  // cleanup: hard delete del rol de prueba
  const { error: eDel } = await supa.from('roles').delete().eq('id', id);
  console.log(`6) cleanup (hard delete) → ${ok(!eDel)}`);

  // sanidad: seguimos con los 12 roles reales intactos
  const { data: real } = await supa.from('roles').select('id', { count: 'exact' }).eq('status', 'Activo');
  console.log(`\nRoles activos reales tras el test: ${real?.length} ${ok(real?.length === 12)}`);
})();
