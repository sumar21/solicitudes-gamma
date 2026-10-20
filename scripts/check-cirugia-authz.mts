// Self-check de la regla de sector de cirugía (api/cirugia-authz.ts → sectorAutorizado).
// Correr:  npx tsx scripts/check-cirugia-authz.mts
import assert from 'node:assert';
import { sectorAutorizado } from '../api/cirugia-authz';

const PISO8 = 'Internacion 8° Piso HPR', UTI = 'Unidad de Terapia Intensiva HPR', PISO4 = 'Internacion 4° Piso HPR';
// Caso real 20/10/2026: el paciente salió del 8° piso a cirugía y volvió a UTI. La enfermería de UTI
// (filtra por pisos, solo UTI) confirma "Iniciar dieta".
assert(!sectorAutorizado(true, [UTI], PISO8), 'antes: solo el sector de origen → UTI no podía');
assert(sectorAutorizado(true, [UTI], [PISO8, UTI]), 'ahora: origen O sector actual → UTI puede');
assert(sectorAutorizado(true, [PISO8], [PISO8, UTI]), 'el piso de origen sigue pudiendo');
assert(!sectorAutorizado(true, [PISO4], [PISO8, UTI]), 'otro piso, no');
assert(sectorAutorizado(true, [UTI], [PISO8, null, undefined, '']) === false, 'sin sector actual: vuelve a la regla de origen');
// Sin restricción: no filtra por pisos, sin sectores, full-access (>= 9), o sin sector conocido.
assert(sectorAutorizado(false, [PISO4], PISO8), 'no filtra por pisos');
assert(sectorAutorizado(true, [], PISO8), 'sin sectores asignados');
assert(sectorAutorizado(true, Array.from({ length: 9 }, (_, i) => `S${i}`), PISO8), 'full-access');
assert(sectorAutorizado(true, [PISO4], null), 'sin sector conocido → fail-open');

console.log('OK — cirugia-authz (sector de origen o actual)');
