/**
 * Verifica end-to-end que el guardado de api/dietas.ts funciona contra la lista real:
 * crea una fila con la MISMA forma que escribe el endpoint (incluido NutricionistaID_D
 * como número), la lee, y la borra. Marca la fila Entorno='MUESTRA'/Status='Inactivo'
 * para que la app nunca la levante. No deja rastro. Uso: npx tsx scripts/verify-dietas-write.mts
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

try {
  const envPath = resolve(import.meta.dirname ?? '.', '..', '.env.local');
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq < 0) continue;
    const k = t.slice(0, eq).trim(); const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch (e: any) { console.error('No .env.local:', e.message); process.exit(1); }

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = (process.env.DIETAS_LIST_ID ?? '').trim();
const { graphFetch } = await import('../api/graph.js');
if (!LIST_ID) { console.error('Falta DIETAS_LIST_ID'); process.exit(1); }
const base = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;

// Misma forma exacta que escribe api/dietas.ts (NutricionistaID_D = número).
const fields = {
  Title: '[sumar]',
  CamaLabel_D: 'PRUEBA - BORRAR', CamaCodigo_D: '00', Habitacion_D: '000', Area_D: 'PRUEBA',
  PacienteNombre_D: 'Prueba', PacienteCodigo_D: 'PAC-TEST',
  Comida_D: 'ALMUERZO', Tipo_D: 'MENU', Observaciones_D: 'verificación de guardado',
  Status_D: 'Inactivo',
  NutricionistaNombre_D: 'Verificador', NutricionistaID_D: 42,
  FechaCarga_D: '2026-07-13T12:00:00Z', Entorno_D: 'MUESTRA',
};

console.log('① POST (crear fila con NutricionistaID_D=42 como número)…');
const post = await graphFetch(base, { method: 'POST', body: JSON.stringify({ fields }) });
if (!post.ok) { console.error(`   ❌ FALLÓ (${post.status}): ${(await post.text()).slice(0, 300)}`); process.exit(1); }
const created = (await post.json()) as { id: string };
console.log(`   ✅ Creada item id=${created.id}`);

console.log('② GET (leer de vuelta)…');
const get = await graphFetch(`${base}/${created.id}?$expand=fields`);
const back = ((await get.json()) as any).fields;
console.log(`   NutricionistaID_D = ${JSON.stringify(back.NutricionistaID_D)} (${typeof back.NutricionistaID_D})`);
console.log(`   Comida_D=${back.Comida_D}  Tipo_D=${back.Tipo_D}  Observaciones_D="${back.Observaciones_D}"`);

console.log('③ DELETE (limpieza)…');
const del = await graphFetch(`${base}/${created.id}`, { method: 'DELETE' });
console.log(`   ${del.ok ? '✅ Borrada, no queda rastro.' : `⚠️ No pude borrar (${del.status}) — borrá a mano el item id=${created.id}`}`);

console.log('\n✅ El guardado funciona end-to-end contra 15.CargaComandas.');
