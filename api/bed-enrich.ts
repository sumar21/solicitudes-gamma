/**
 * GET /api/bed-enrich?patientCode=X&eventOrigin=Y&eventNumber=Z
 *
 * On-demand enrichment for a single bed.
 * Returns: { dni, age, sex, institution, diagnosis, prescribingPhysician,
 *            admissionType, admissionTypeCode, admissionDate,
 *            expectedSurgeryDate, authorizedDays, diets, dietTags }
 *
 * Server-side cache per patientCode (10 min TTL).
 * Only 2 Gamma calls per request (1 patient + 1 event).
 */

import { requireAuth } from './jwt.js';
import {
  getToken, fetchPatientDetails, fetchEventDetails, getEventCached, setEventCache,
} from './gamma-client.js';
import { buildPatientData, buildEventData, type EnrichResult } from './enrich-core.js';

// ── Cache de paciente (TTL largo). Para el EVENTO usamos el cache compartido
// de gamma-client.ts (getEventCached) — así /api/beds y este endpoint pegan al
// mismo store y evitamos doble fetch cuando el cliente carga el mapa y luego
// clickea una cama. El cliente que necesita data ultra-fresca pasa ?fresh=1
// (modal): en ese path se bypassa el cache compartido y se hace fetch directo.
const patientCache = new Map<string, { data: Partial<EnrichResult>; exp: number }>();
const PATIENT_TTL  = 10 * 60 * 1000; // 10 minutos

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url ?? '/', 'http://localhost');
  const patientCode = url.searchParams.get('patientCode')?.trim();
  const eventOrigin = url.searchParams.get('eventOrigin');
  const eventNumber = url.searchParams.get('eventNumber');
  // ?fresh=1 fuerza re-fetch del EVENTO (dieta, diagnóstico, plan, fechas).
  // El cache de paciente sigue siendo válido — DNI/edad/sexo no cambian durante
  // la internación. Lo usa el modal de detalle al hacer click; los PDFs NO lo pasan
  // (procesan muchas camas en serie y benefician del cache de 30s).
  const fresh = url.searchParams.get('fresh') === '1';

  if (!patientCode) {
    return res.status(400).json({ error: 'patientCode required' });
  }

  const now = Date.now();
  const needEvent = !!(eventOrigin && eventNumber);

  // Decidir si hace falta tocar el endpoint /pacientes (cache 10 min).
  const cachedPatient = patientCache.get(patientCode);
  const patientFresh  = cachedPatient && cachedPatient.exp > now;
  const needPatient   = !patientFresh;

  try {
    const [tokenPat, tokenEvt] = await Promise.all([
      needPatient ? getToken('consultarpacientecodigo') : Promise.resolve(''),
      needEvent   ? getToken('obtenereventointernacion') : Promise.resolve(''),
    ]);

    // El evento: si fresh=1 (modal on-click) → bypass cache y refrescar el shared cache.
    // Si fresh!=1 → usar el shared cache de gamma-client (mismo que pega /api/beds).
    const [patient, event] = await Promise.all([
      needPatient ? fetchPatientDetails(tokenPat, patientCode) : Promise.resolve(null),
      needEvent && eventOrigin && eventNumber
        ? (fresh
            ? fetchEventDetails(tokenEvt, eventOrigin, parseInt(eventNumber)).then(ev => {
                setEventCache(eventOrigin, parseInt(eventNumber), ev);
                return ev;
              })
            : getEventCached(tokenEvt, eventOrigin, parseInt(eventNumber)))
        : Promise.resolve(null),
    ]);

    // Bloque "paciente" — cache 10 min. Si vino del fetch, lo recacheamos.
    let patientData: Partial<EnrichResult> = patientFresh ? cachedPatient!.data : {};
    if (patient) {
      patientData = buildPatientData(patient);
      patientCache.set(patientCode, { data: patientData, exp: now + PATIENT_TTL });
    }

    // Bloque "evento" — derivado en cada request (el cache vive en gamma-client).
    const eventData = buildEventData(event, { fallbackInstitution: !patientData.institution });

    // Mergear paciente + evento. El evento gana en campos compartidos por si el
    // último update de PROGAL vino vía el endpoint del evento (raro pero posible).
    const merged: Partial<EnrichResult> = { ...patientData, ...eventData };
    return res.status(200).json(merged);
  } catch (err: any) {
    console.error('[bed-enrich] Error:', err);
    return res.status(502).json({ error: 'Gamma enrichment failed' });
  }
}

export default requireAuth(handler);
