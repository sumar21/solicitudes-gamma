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
  getToken, fetchPatientDetails, fetchEventDetails, getEventCached, setEventCache, calcAge,
} from './gamma-client.js';
import { parseDiets, type DietEntry } from './diet-tags.js';
import { summarizeFasting, type FastingSummary } from './ayunos.js';

// Maps the EVE_TIPO_INTERNACION code to its human label.
// Grupo Gamma uses 1- and 2-letter codes:
//   C  = Clínica
//   CO = COVID-19
//   H  = Hemodinamia
//   K  = Quemado
//   O  = Oncológica
//   Q  = Quirúrgica
//   R  = Trasplante Renal
//   T  = Trasplante Hepático
const ADMISSION_TYPE_LABELS: Record<string, string> = {
  C:  'Clínica',
  CO: 'COVID-19',
  H:  'Hemodinamia',
  K:  'Quemado',
  O:  'Oncológica',
  Q:  'Quirúrgica',
  R:  'Trasplante Renal',
  T:  'Trasplante Hepático',
};

interface EnrichResult {
  dni?: string;
  age?: number;
  sex?: 'M' | 'F';
  institution?: string;
  diagnosis?: string;
  prescribingPhysician?: string;
  // Nuevos campos derivados del evento (obtenereventointernacion v2):
  admissionType?: string;        // Etiqueta legible ("Clínica", "Quirúrgica", ...)
  admissionTypeCode?: string;    // Código crudo ("C", "Q", ...)
  admissionDate?: string;        // ISO string de EVE_FECHA_HORA_INGRESO
  expectedSurgeryDate?: string;  // ISO string de EVE_FECHA_PROBABLE_CIRUGIA (si aplica)
  authorizedDays?: number;       // EVE_DIAS_AUTORIZADOS
  // Plan médico del paciente (IPM_*). El código (`medicalPlan`) ya viene también en
  // /api/beds desde camas ocupadas; este endpoint solo agrega la `medicalPlanDescription`.
  medicalPlan?: string;
  medicalPlanDescription?: string;
  diets?: DietEntry[];           // Respuestas completas del formulario de dieta
  // Chips resumen para mostrar rápido en la tarjeta — ya filtrados: solo
  // condiciones con valor "Sí" (excepto "Tipo" que se guarda con su valor).
  dietTags?: string[];
  // Ayunos programados (resumen + lista de indicaciones para el modal).
  fasting?: FastingSummary;
}

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

    // Bloque "paciente" — cache 10 min.
    let patientData: Partial<EnrichResult> = patientFresh ? cachedPatient!.data : {};
    if (patient) {
      patientData = {};
      patientData.institution = patient.ENT_NOMBRE_FANTASIA?.trim() || undefined;
      patientData.dni = patient.ENT_NUMERO_DOCUMENTO?.trim() || undefined;
      patientData.age = patient.PCN_FECHA_NACIMIENTO ? calcAge(patient.PCN_FECHA_NACIMIENTO) : undefined;
      patientData.sex = patient.PCN_SEXO === 'M' || patient.PCN_SEXO === 'F' ? patient.PCN_SEXO : undefined;
      patientCache.set(patientCode, { data: patientData, exp: now + PATIENT_TTL });
    }

    // Bloque "evento" — derivado en cada request (el cache vive en gamma-client).
    const eventData: Partial<EnrichResult> = {};
    if (event) {
      eventData.diagnosis = event.EVE_DIAGNOSTICO?.trim() || undefined;
      if (event.PROFESIONAL_NOMBRE?.trim()) {
        eventData.prescribingPhysician = event.PROFESIONAL_NOMBRE.trim();
      }
      // Fallback de institution si vino vacía del paciente.
      if (!patientData.institution && event.INSTITUCION_NOMBRE) {
        eventData.institution = event.INSTITUCION_NOMBRE.trim();
      }

      // Tipo de internación — guardamos el código crudo + label humano.
      const typeCode = event.EVE_TIPO_INTERNACION?.trim().toUpperCase();
      if (typeCode) {
        eventData.admissionTypeCode = typeCode;
        eventData.admissionType = ADMISSION_TYPE_LABELS[typeCode] ?? typeCode;
      }

      if (event.EVE_FECHA_HORA_INGRESO) {
        eventData.admissionDate = String(event.EVE_FECHA_HORA_INGRESO);
      }
      if (event.EVE_FECHA_PROBABLE_CIRUGIA) {
        eventData.expectedSurgeryDate = String(event.EVE_FECHA_PROBABLE_CIRUGIA);
      }

      if (typeof event.EVE_DIAS_AUTORIZADOS === 'number') {
        eventData.authorizedDays = event.EVE_DIAS_AUTORIZADOS;
      }

      if (event.IPM_PLAN_MEDICO) {
        eventData.medicalPlan = String(event.IPM_PLAN_MEDICO).trim() || undefined;
      }
      if (event.IPM_DESCRIPCION) {
        eventData.medicalPlanDescription = String(event.IPM_DESCRIPCION).trim() || undefined;
      }

      // Dietas — helper compartido con /api/beds.
      const { diets, dietTags } = parseDiets(event.DIETAS);
      if (diets) eventData.diets = diets;
      if (dietTags) eventData.dietTags = dietTags;

      // Ayunos — helper compartido.
      const fasting = summarizeFasting(event.AYUNOS);
      if (fasting) eventData.fasting = fasting;
    }

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
