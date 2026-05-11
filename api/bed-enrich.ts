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
import { getToken, fetchPatientDetails, fetchEventDetails, calcAge } from './gamma-client.js';

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

interface DietEntry {
  descripcion: string;           // HCG_DESCRIPCION (e.g. "Diabetico", "Tipo", "Celiaco")
  respuesta: string;             // EIP_RESPUESTA_VALOR (e.g. "Sí", "No", "Liviana")
}

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
}

// ── Cache split: patient (TTL largo) vs event+dieta (TTL muy corto) ─────────
// Razón: DNI/edad/sexo/financiador no cambian durante una internación, así que
// 10 min es seguro. Pero el evento incluye DIAGNÓSTICO, PLAN MÉDICO, FECHA DE
// CIRUGÍA y sobre todo la DIETA, que sí cambian (PROGAL las edita en vivo).
// Cachear el evento mucho tiempo causaba que cambios en PROGAL no se vieran
// hasta 10 min después. Ahora el evento sobrevive solo 30s (cubre clicks
// consecutivos del modal sin machacar a Gamma, pero refresca rápido).
const patientCache = new Map<string, { data: Partial<EnrichResult>; exp: number }>();
const PATIENT_TTL  = 10 * 60 * 1000; // 10 minutos

const eventCache = new Map<string, { data: Partial<EnrichResult>; exp: number }>();
const EVENT_TTL  = 30 * 1000; // 30 segundos

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
  const eventKey = eventOrigin && eventNumber ? `${eventOrigin}-${eventNumber}` : null;

  // Decidir qué hace falta fetchear según cada cache
  const cachedPatient = patientCache.get(patientCode);
  const patientFresh  = cachedPatient && cachedPatient.exp > now;

  const cachedEvent = eventKey ? eventCache.get(eventKey) : undefined;
  const eventFresh  = !fresh && cachedEvent && cachedEvent.exp > now;

  // Si ambos están frescos, devolver merge inmediato sin tocar Gamma.
  if (patientFresh && (!eventKey || eventFresh)) {
    return res.status(200).json({
      ...(cachedPatient!.data),
      ...(eventFresh ? cachedEvent!.data : {}),
    });
  }

  try {
    // Solo pedir tokens y data de Gamma para lo que NO está cacheado.
    const needPatient = !patientFresh;
    const needEvent   = !!eventKey && !eventFresh;

    const [tokenPat, tokenEvt] = await Promise.all([
      needPatient ? getToken('consultarpacientecodigo') : Promise.resolve(''),
      needEvent   ? getToken('obtenereventointernacion') : Promise.resolve(''),
    ]);

    const [patient, event] = await Promise.all([
      needPatient ? fetchPatientDetails(tokenPat, patientCode) : Promise.resolve(null),
      needEvent && eventOrigin && eventNumber
        ? fetchEventDetails(tokenEvt, eventOrigin, parseInt(eventNumber))
        : Promise.resolve(null),
    ]);

    // Construir el bloque "paciente" (lento de cachear).
    let patientData: Partial<EnrichResult> = patientFresh ? cachedPatient!.data : {};
    if (patient) {
      patientData = {};
      patientData.institution = patient.ENT_NOMBRE_FANTASIA?.trim() || undefined;
      patientData.dni = patient.ENT_NUMERO_DOCUMENTO?.trim() || undefined;
      patientData.age = patient.PCN_FECHA_NACIMIENTO ? calcAge(patient.PCN_FECHA_NACIMIENTO) : undefined;
      patientData.sex = patient.PCN_SEXO === 'M' || patient.PCN_SEXO === 'F' ? patient.PCN_SEXO : undefined;
      patientCache.set(patientCode, { data: patientData, exp: now + PATIENT_TTL });
    }

    // Construir el bloque "evento" (cache corto, refresca seguido).
    let eventData: Partial<EnrichResult> = eventFresh ? cachedEvent!.data : {};
    if (event) {
      eventData = {};
      eventData.diagnosis = event.EVE_DIAGNOSTICO?.trim() || undefined;
      if (event.PROFESIONAL_NOMBRE?.trim()) {
        eventData.prescribingPhysician = event.PROFESIONAL_NOMBRE.trim();
      }
      // Fallback de institution si vino vacía del paciente.
      if (!patientData.institution && event.INSTITUCION_NOMBRE) {
        eventData.institution = event.INSTITUCION_NOMBRE.trim();
      }

      // Tipo de internación — guardamos el código crudo + label humano
      const typeCode = event.EVE_TIPO_INTERNACION?.trim().toUpperCase();
      if (typeCode) {
        eventData.admissionTypeCode = typeCode;
        eventData.admissionType = ADMISSION_TYPE_LABELS[typeCode] ?? typeCode;
      }

      // Fechas — Gamma ya las devuelve como strings ISO; las pasamos tal cual
      if (event.EVE_FECHA_HORA_INGRESO) {
        eventData.admissionDate = String(event.EVE_FECHA_HORA_INGRESO);
      }
      if (event.EVE_FECHA_PROBABLE_CIRUGIA) {
        eventData.expectedSurgeryDate = String(event.EVE_FECHA_PROBABLE_CIRUGIA);
      }

      if (typeof event.EVE_DIAS_AUTORIZADOS === 'number') {
        eventData.authorizedDays = event.EVE_DIAS_AUTORIZADOS;
      }

      // Plan médico — Gamma sumó IPM_PLAN_MEDICO (código) + IPM_DESCRIPCION (legible).
      if (event.IPM_PLAN_MEDICO) {
        eventData.medicalPlan = String(event.IPM_PLAN_MEDICO).trim() || undefined;
      }
      if (event.IPM_DESCRIPCION) {
        eventData.medicalPlanDescription = String(event.IPM_DESCRIPCION).trim() || undefined;
      }

      // Dietas — Gamma devuelve un array de {HCG_DESCRIPCION, EIP_RESPUESTA_VALOR}.
      // Guardamos el array completo para auditoría y además armamos dietTags
      // con las condiciones "activas" (respuesta Sí) para mostrar en la tarjeta.
      if (Array.isArray(event.DIETAS) && event.DIETAS.length > 0) {
        const diets: DietEntry[] = event.DIETAS
          .filter(d => d?.HCG_DESCRIPCION)
          .map(d => ({
            descripcion: String(d.HCG_DESCRIPCION ?? '').trim(),
            respuesta:   String(d.EIP_RESPUESTA_VALOR ?? '').trim(),
          }));
        if (diets.length > 0) {
          eventData.diets = diets;
          const tags: string[] = [];
          for (const d of diets) {
            const resp = d.respuesta.toLowerCase();
            // "Tipo" guarda su valor libre ("Liviana", "Blanda", ...) como chip;
            // el resto de las condiciones son Sí/No → solo las Sí aparecen.
            if (d.descripcion.toLowerCase() === 'tipo') {
              if (d.respuesta && resp !== 'no') tags.push(d.respuesta);
            } else if (resp === 'sí' || resp === 'si') {
              tags.push(d.descripcion);
            }
          }
          if (tags.length > 0) eventData.dietTags = tags;
        }
      }
      // Persistir el bloque evento en su propio cache (TTL corto: 30s).
      if (eventKey) {
        eventCache.set(eventKey, { data: eventData, exp: now + EVENT_TTL });
      }
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
