/**
 * GET /api/bed-enrich?patientCode=X&eventOrigin=Y&eventNumber=Z
 *
 * On-demand enrichment for a single bed.
 * Returns: { dni, age, sex, institution, diagnosis, prescribingPhysician }
 *
 * Server-side cache per patientCode (10 min TTL).
 * Only 2 Gamma calls per request (1 patient + 1 event).
 */

import { requireAuth } from './jwt.js';
import { getToken, fetchPatientDetails, fetchEventDetails, calcAge } from './gamma-client.js';

interface EnrichResult {
  dni?: string;
  age?: number;
  sex?: 'M' | 'F';
  institution?: string;
  diagnosis?: string;
  prescribingPhysician?: string;
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
