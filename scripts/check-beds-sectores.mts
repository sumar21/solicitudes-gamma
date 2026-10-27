// Self-check de api/beds-sectores (mapa parcial de Gamma por sector faltante, 27/10/2026).
// Correr:  npx tsx scripts/check-beds-sectores.mts
import assert from 'node:assert';
import { SECTORES_BASE, sectoresFaltantes } from '../api/beds-sectores';
import { Area } from '../types';

const completo = SECTORES_BASE.map((area, i) => ({ label: `Cama ${i}`, area }));
assert.deepEqual(sectoresFaltantes(completo), [], 'mapa completo');
assert.deepEqual(sectoresFaltantes([...completo, { label: 'HSS', area: Area.HSS }]), [], 'sectores extra no molestan');
// Caso real 27/10/2026: llegó sin UCO ni 6° piso.
const sinUcoNi6 = completo.filter(b => b.area !== Area.HUC && b.area !== Area.PISO_6);
assert.deepEqual(sectoresFaltantes(sinUcoNi6), [Area.PISO_6, Area.HUC], 'detecta los que faltan');
assert.equal(sectoresFaltantes([]).length, SECTORES_BASE.length, 'mapa vacío: faltan todos');
// Los nombres coinciden con el enum Area del cliente (si cambian de un lado y no del otro, el control no sirve).
for (const s of SECTORES_BASE) assert((Object.values(Area) as string[]).includes(s), `sector desconocido: ${s}`);
console.log('OK — beds-sectores');
