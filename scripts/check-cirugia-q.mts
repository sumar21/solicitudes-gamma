// Self-check de lib/cirugiaQ (la "Q" de quirúrgico pendiente en el Mapa de Camas).
// Correr:  npx tsx scripts/check-cirugia-q.mts
import assert from 'node:assert';
import { cirugiaCompletadaEnInternacion, mostrarQ } from '../lib/cirugiaQ';

const q = (o: any = {}) => ({ status: 'Ocupada', admissionTypeCode: 'Q', patientCode: '1001', ...o });
const EK = 'HIN-1';

// 1) Quirúrgico sin cirugías → Q.
assert(mostrarQ(q(), EK, []), 'Q pendiente de su primera cirugía');
// 2) Ya se operó en ESTA internación y no hay consentimiento nuevo → sin Q.
assert(!mostrarQ(q(), EK, [{ pacienteCodigo: '1001', eventKey: EK }]), 'ya operado en esta internación → sin Q');
// 3) Se operó en OTRA internación (reingreso) → vuelve a ser su 1ra de esta internación → Q.
assert(mostrarQ(q(), EK, [{ pacienteCodigo: '1001', eventKey: 'HIN-0' }]), 'operado en otra internación → Q');
// 4) Completada sin internación registrada (fila vieja) → cuenta siempre → sin Q.
assert(!mostrarQ(q(), EK, [{ pacienteCodigo: '1001' }]), 'event_key null cuenta siempre');
// 5) Consentimiento nuevo (marca de Admisión) → la celda muestra "Re-Cx", no la Q.
assert(!mostrarQ(q({ goingToSurgery: true }), EK, []), 'con marca → Re-Cx, no Q');
// 6) Cirugía viva → manda la pill Cx.
assert(!mostrarQ(q({ cirugia: { estado: 'LISTO_PARA_CIRUGIA' } }), EK, []), 'con cirugía viva → pill Cx');
// 7) No quirúrgico / cama no ocupada → sin Q.
assert(!mostrarQ(q({ admissionTypeCode: 'C' }), EK, []) && !mostrarQ(q({ status: 'Disponible' }), EK, []), 'clínico o cama libre');
// 8) Sin internación de la cama: cualquier completada del paciente cuenta (no se habilita de más).
assert(!mostrarQ(q(), undefined, [{ pacienteCodigo: '1001', eventKey: 'HIN-0' }]), 'sin event key de la cama → cuenta');
assert(!cirugiaCompletadaEnInternacion([{ pacienteCodigo: '1001', eventKey: EK }], undefined, EK), 'sin código → false');

console.log('OK — cirugiaQ');
