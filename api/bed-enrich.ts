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
  diets?: DietEntry[];           // Respuestas completas del formulario de dieta
  // Chips resumen para mostrar rápido en la tarjeta — ya filtrados: solo
  // condiciones con valor "Sí" (excepto "Tipo" que se guarda con su valor).
  dietTags?: string[];
}

// ── Enrichment cache: patientCode → result (10 min TTL) ─────────────────────
const enrichCache = new Map<string, { data: EnrichResult; exp: number }>();
const ENRICH_TTL = 10 * 60 * 1000; // 10 minutes

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url ?? '/', 'http://localhost');
  const patientCode = url.searchParams.get('patientCode')?.trim();
  const eventOrigin = url.searchParams.get('eventOrigin');
  const eventNumber = url.searchParams.get('eventNumber');

  if (!patientCode) {
    return res.status(400).json({ error: 'patientCode required' });
  }

  // Check cache
  const cached = enrichCache.get(patientCode);
  if (cached && Date.now() < cached.exp) {
    return res.status(200).json(cached.data);
  }

  try {
    const [tokenPat, tokenEvt] = await Promise.all([
      getToken('consultarpacientecodigo'),
      getToken('obtenereventointernacion'),
    ]);

    const [patient, event] = await Promise.all([
      fetchPatientDetails(tokenPat, patientCode),
      eventOrigin && eventNumber
        ? fetchEventDetails(tokenEvt, eventOrigin, parseInt(eventNumber))
        : Promise.resolve(null),
    ]);

    const data: EnrichResult = {};
    if (patient) {
      data.institution = patient.ENT_NOMBRE_FANTASIA?.trim() || undefined;
      data.dni = patient.ENT_NUMERO_DOCUMENTO?.trim() || undefined;
      data.age = patient.PCN_FECHA_NACIMIENTO ? calcAge(patient.PCN_FECHA_NACIMIENTO) : undefined;
      data.sex = patient.PCN_SEXO === 'M' || patient.PCN_SEXO === 'F' ? patient.PCN_SEXO : undefined;
    }
    if (event) {
      data.diagnosis = event.EVE_DIAGNOSTICO?.trim() || undefined;
      if (event.PROFESIONAL_NOMBRE?.trim()) {
        data.prescribingPhysician = event.PROFESIONAL_NOMBRE.trim();
      }
      if (!data.institution && event.INSTITUCION_NOMBRE) {
        data.institution = event.INSTITUCION_NOMBRE.trim();
      }

      // Tipo de internación — guardamos el código crudo + label humano
      const typeCode = event.EVE_TIPO_INTERNACION?.trim().toUpperCase();
      if (typeCode) {
        data.admissionTypeCode = typeCode;
        data.admissionType = ADMISSION_TYPE_LABELS[typeCode] ?? typeCode;
      }

      // Fechas — Gamma ya las devuelve como strings ISO; las pasamos tal cual
      if (event.EVE_FECHA_HORA_INGRESO) {
        data.admissionDate = String(event.EVE_FECHA_HORA_INGRESO);
      }
      if (event.EVE_FECHA_PROBABLE_CIRUGIA) {
        data.expectedSurgeryDate = String(event.EVE_FECHA_PROBABLE_CIRUGIA);
      }

      if (typeof event.EVE_DIAS_AUTORIZADOS === 'number') {
        data.authorizedDays = event.EVE_DIAS_AUTORIZADOS;
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
          data.diets = diets;
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
          if (tags.length > 0) data.dietTags = tags;
        }
      }
    }

    // Cache result
    enrichCache.set(patientCode, { data, exp: Date.now() + ENRICH_TTL });

    return res.status(200).json(data);
  } catch (err: any) {
    console.error('[bed-enrich] Error:', err);
    return res.status(502).json({ error: 'Gamma enrichment failed' });
  }
}

export default requireAuth(handler);
