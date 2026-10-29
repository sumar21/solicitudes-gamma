// Self-check de "Volver un paso" en cirugía (20/10/2026): api/cirugia-pasos + espejos del cliente
// (lib/constants) + etiquetas de la línea de tiempo (lib/cirugiaEventos).
// Correr:  npx tsx scripts/check-cirugia-retroceso.mts
import assert from 'node:assert';
import { ANTERIOR, pasosDesdeEventos } from '../api/cirugia-pasos';
import { CIRUGIA_ANTERIOR, CIRUGIA_PERMISO_DEL_PASO } from '../lib/constants';
import { cirugiaEventoLabel, esRetroceso } from '../lib/cirugiaEventos';

// 1) El mapa del cliente (botón) es el mismo que el del servidor (regla real).
assert.deepEqual({ ...CIRUGIA_ANTERIOR }, ANTERIOR, 'CIRUGIA_ANTERIOR == ANTERIOR de la API');
// LISTO no vuelve (se cancela) y las terminales tampoco.
for (const e of ['LISTO_PARA_CIRUGIA', 'TOLERANCIA_EVALUADA', 'CANCELADO']) assert(!(e in ANTERIOR), `${e} sin paso anterior`);
// Cada estado que se puede retroceder tiene el permiso del paso que se deshace.
assert.deepEqual(Object.keys(CIRUGIA_PERMISO_DEL_PASO).sort(), Object.keys(ANTERIOR).sort(), 'permiso por cada paso retrocedible');
assert.equal(CIRUGIA_PERMISO_DEL_PASO.EN_TRASLADO, 'cirugia_entregar', 'deshacer "En traslado" pide el permiso de quien lo marca');

// 2) Horas de cada paso: un retroceso borra la del paso deshecho y, si se rehace, vale la última.
const ev = (tipo: string, hhmm: string, meta?: any) => ({ tipo, meta, created_at: `2026-10-20T${hhmm}:00Z` });
let p = pasosDesdeEventos([
  ev('LISTO_PARA_CIRUGIA', '09:00'), ev('VAN_A_BUSCAR', '09:10'), ev('EN_TRASLADO', '09:20'),
  ev('RETROCESO', '09:25', { de: 'EN_TRASLADO', a: 'VAN_A_BUSCAR' }),
]);
assert.equal(p.EN_TRASLADO, undefined, 'el traslado que no fue no tiene hora');
assert.equal(p.VAN_A_BUSCAR, '2026-10-20T09:10:00Z', 'el paso anterior conserva su hora');
p = pasosDesdeEventos([
  ev('VAN_A_BUSCAR', '09:10'), ev('EN_TRASLADO', '09:20'),
  ev('RETROCESO', '09:25', { de: 'EN_TRASLADO', a: 'VAN_A_BUSCAR' }), ev('EN_TRASLADO', '10:05'),
]);
assert.equal(p.EN_TRASLADO, '2026-10-20T10:05:00Z', 'rehecho: vale la última vez');
assert(!('RETROCESO' in p), 'RETROCESO no es una columna');
// Retroceso sin meta (dato roto): no borra nada.
p = pasosDesdeEventos([ev('VAN_A_BUSCAR', '09:10'), ev('RETROCESO', '09:12', null)]);
assert.equal(p.VAN_A_BUSCAR, '2026-10-20T09:10:00Z', 'retroceso sin meta: no toca');

// 3) Línea de tiempo: dice de qué paso a qué paso se volvió.
assert.equal(cirugiaEventoLabel({ tipo: 'RETROCESO', meta: { de: 'EN_TRASLADO', a: 'VAN_A_BUSCAR' } }),
  'Volvió un paso: En traslado a cirugía → Búsqueda para cirugía');
assert.equal(cirugiaEventoLabel({ tipo: 'EN_CIRUGIA' }), 'En cirugía');
assert.equal(cirugiaEventoLabel({ tipo: 'ANULAR_PREVIA' }), 'Cirugía previa anulada');
assert(esRetroceso({ tipo: 'RETROCESO' }) && !esRetroceso({ tipo: 'EN_TRASLADO' }));

// 4) Desde "Listo para cirugía" (29/10/2026): se anula con permiso propio; los demás, el del paso.
import('../lib/constants').then(({ cirugiaRetrocesoDe }) => {
  assert.equal(cirugiaRetrocesoDe('LISTO_PARA_CIRUGIA' as any)?.permiso, 'cirugia_volver_listo');
  assert.equal(cirugiaRetrocesoDe('LISTO_PARA_CIRUGIA' as any)?.anula, true);
  assert.equal(cirugiaRetrocesoDe('EN_TRASLADO' as any)?.permiso, 'cirugia_entregar');
  assert.equal(cirugiaRetrocesoDe('TOLERANCIA_EVALUADA' as any), null, 'terminal: no');
  assert.equal(cirugiaEventoLabel({ tipo: 'RETROCESO', meta: { de: 'LISTO_PARA_CIRUGIA', a: 'CANCELADO' } }), 'Volvió atrás: se deshizo "Listo para cirugía"');
  console.log('OK — cirugía: volver un paso');
});
