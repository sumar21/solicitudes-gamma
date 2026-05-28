/**
 * Construcción del enrich de una cama (paciente + evento) desde Gamma.
 *
 * Helper compartido por:
 *   · /api/bed-enrich   — refresh on-demand al abrir el modal (con su cache de paciente).
 *   · /api/cron-enrich-beds — precompute en background, persiste en 12.EnrichCamas.
 *
 * Las funciones `buildPatientData` / `buildEventData` son PURAS (sin fetch) para que
 * bed-enrich pueda seguir cacheando el bloque paciente por su cuenta. `buildEnrich`
 * hace los fetches y compone el resultado completo (para el cron).
 */

import {
  fetchPatientDetails, getEventCached, calcAge,
  type GammaPatient, type GammaEvent,
} from './gamma-client.js';
import { parseDiets, type DietEntry } from './diet-tags.js';
import { summarizeFasting, type FastingSummary } from './ayunos.js';

// Maps the EVE_TIPO_INTERNACION code to its human label.
//   C = Clínica · CO = COVID-19 · H = Hemodinamia · K = Quemado
//   O = Oncológica · Q = Quirúrgica · R = Trasplante Renal · T = Trasplante Hepático
export const ADMISSION_TYPE_LABELS: Record<string, string> = {
  C:  'Clínica',
  CO: 'COVID-19',
  H:  'Hemodinamia',
  K:  'Quemado',
  O:  'Oncológica',
  Q:  'Quirúrgica',
  R:  'Trasplante Renal',
  T:  'Trasplante Hepático',
};

export interface EnrichResult {
  dni?: string;
  age?: number;
  sex?: 'M' | 'F';
  institution?: string;
  diagnosis?: string;
  prescribingPhysician?: string;
  admissionType?: string;        // Etiqueta legible ("Clínica", "Quirúrgica", ...)
  admissionTypeCode?: string;    // Código crudo ("C", "Q", ...)
  admissionDate?: string;        // ISO de EVE_FECHA_HORA_INGRESO
  expectedSurgeryDate?: string;  // ISO de EVE_FECHA_PROBABLE_CIRUGIA
  authorizedDays?: number;       // EVE_DIAS_AUTORIZADOS
  medicalPlan?: string;
  medicalPlanDescription?: string;
  diets?: DietEntry[];
  dietTags?: string[];
  fasting?: FastingSummary;
}

/** Bloque "paciente" (DNI/edad/sexo/financiador) — datos que no cambian en la internación. */
export function buildPatientData(patient: GammaPatient | null): Partial<EnrichResult> {
  if (!patient) return {};
  return {
    institution: patient.ENT_NOMBRE_FANTASIA?.trim() || undefined,
    dni:         patient.ENT_NUMERO_DOCUMENTO?.trim() || undefined,
    age:         patient.PCN_FECHA_NACIMIENTO ? calcAge(patient.PCN_FECHA_NACIMIENTO) : undefined,
    sex:         patient.PCN_SEXO === 'M' || patient.PCN_SEXO === 'F' ? patient.PCN_SEXO : undefined,
  };
}

/** Bloque "evento" (diagnóstico, internación, plan, dieta, ayunos). */
export function buildEventData(
  event: GammaEvent | null,
  opts?: { fallbackInstitution?: boolean },
): Partial<EnrichResult> {
  if (!event) return {};
  const out: Partial<EnrichResult> = {};

  out.diagnosis = event.EVE_DIAGNOSTICO?.trim() || undefined;
  if (event.PROFESIONAL_NOMBRE?.trim()) out.prescribingPhysician = event.PROFESIONAL_NOMBRE.trim();
  if (opts?.fallbackInstitution && event.INSTITUCION_NOMBRE) out.institution = event.INSTITUCION_NOMBRE.trim();

  const typeCode = event.EVE_TIPO_INTERNACION?.trim().toUpperCase();
  if (typeCode) {
    out.admissionTypeCode = typeCode;
    out.admissionType = ADMISSION_TYPE_LABELS[typeCode] ?? typeCode;
  }

  if (event.EVE_FECHA_HORA_INGRESO) out.admissionDate = String(event.EVE_FECHA_HORA_INGRESO);
  if (event.EVE_FECHA_PROBABLE_CIRUGIA) out.expectedSurgeryDate = String(event.EVE_FECHA_PROBABLE_CIRUGIA);
  if (typeof event.EVE_DIAS_AUTORIZADOS === 'number') out.authorizedDays = event.EVE_DIAS_AUTORIZADOS;

  if (event.IPM_PLAN_MEDICO) out.medicalPlan = String(event.IPM_PLAN_MEDICO).trim() || undefined;
  if (event.IPM_DESCRIPCION) out.medicalPlanDescription = String(event.IPM_DESCRIPCION).trim() || undefined;

  const { diets, dietTags } = parseDiets(event.DIETAS);
  if (diets) out.diets = diets;
  if (dietTags) out.dietTags = dietTags;

  const fasting = summarizeFasting(event.AYUNOS);
  if (fasting) out.fasting = fasting;

  return out;
}

/**
 * Enrich completo (paciente + evento) con fetch a Gamma. Para el cron de precompute.
 * El evento pasa por getEventCached (60s); el paciente se fetcha siempre (el cron corre
 * cada 15min, no necesita cache de paciente propio).
 */
export async function buildEnrich(args: {
  tokenPat: string;
  tokenEvt: string;
  patientCode: string;
  eventOrigin: string;
  eventNumber: number;
}): Promise<EnrichResult> {
  const [patient, event] = await Promise.all([
    fetchPatientDetails(args.tokenPat, args.patientCode),
    getEventCached(args.tokenEvt, args.eventOrigin, args.eventNumber),
  ]);
  const patientData = buildPatientData(patient);
  const eventData = buildEventData(event, { fallbackInstitution: !patientData.institution });
  return { ...patientData, ...eventData };
}
