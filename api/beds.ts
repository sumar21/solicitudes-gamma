/**
 * Vercel serverless function — proxies the Grupo Gamma bed map API.
 * Credentials stay server-side; the browser only ever sees /api/beds.
 *
 * Gamma auth flow:
 *  1. GET /oauth_authorize?response_type=code&client_id=...&state=xyz  → auth_code
 *  2. POST /oauth_token { grant_type, client_id, client_secret, code, scope } → access_token
 *  3. GET /oauth_resource/<endpoint>  Authorization: Bearer <token>
 */

import { requireAuth } from './jwt.js';

const GAMMA_BASE = process.env.GAMMA_VM_URL ?? 'http://35.224.5.114/proxy/index.php';
const CLIENT_ID = process.env.AZURE_CLIENTE_ID ?? '';
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET ?? '';

// ── Token cache (survives warm invocations) ──────────────────────────────────
const tokenCache = new Map<string, { token: string; exp: number }>();

async function getToken(scope: string): Promise<string> {
  const cached = tokenCache.get(scope);
  if (cached && Date.now() < cached.exp) return cached.token;

  // Step 1 — auth code
  const codeRes = await fetch(
    `${GAMMA_BASE}/oauth_authorize?response_type=code&client_id=${encodeURIComponent(CLIENT_ID)}&state=xyz`,
  );
  const codeText = await codeRes.text();

  let code: string;
  try {
    const parsed = JSON.parse(codeText) as Record<string, unknown>;
    code =
      String(parsed.code ?? parsed.auth_code ?? parsed.authorization_code ?? '').trim() ||
      codeText.trim();
  } catch {
    code = codeText.trim();
  }

  // Step 2 — access token
  const tokenRes = await fetch(`${GAMMA_BASE}/oauth_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      scope,
    }),
  });

  const tokenText = await tokenRes.text();
  let tokenData: Record<string, unknown>;
  try {
    tokenData = JSON.parse(tokenText) as Record<string, unknown>;
  } catch {
    throw new Error(`Token endpoint returned non-JSON (status ${tokenRes.status}): ${tokenText.slice(0, 200)}`);
  }
  if (!tokenData.access_token) {
    throw new Error(`Token error for scope "${scope}": ${JSON.stringify(tokenData)}`);
  }

  const expiresIn = parseInt(String(tokenData.expires_in ?? '3600'), 10);
  tokenCache.set(scope, {
    token: String(tokenData.access_token),
    exp: Date.now() + (expiresIn - 60) * 1000,
  });

  return String(tokenData.access_token);
}

// ── Gamma response types ─────────────────────────────────────────────────────
interface GammaBed {
  codigo: number;
  nombre?: string;
  estado?: string;
  origen_evento?: string;
  numero_evento?: number;
  codigo_paciente?: string;
  paciente?: string;
}
interface GammaPatient {
  PCN_NUMERO?: string;
  ENT_NOMBRE?: string;
  ENT_TIPO_DOCUMENTO?: string;
  ENT_NUMERO_DOCUMENTO?: string;
  PCN_FECHA_NACIMIENTO?: string; // "DD/MM/YYYY"
  ENT_NOMBRE_FANTASIA?: string;  // obra social / financiador
  PCN_NUMERO_AFILIADO?: string;
  PCN_SEXO?: string;
}
interface GammaRoom {
  codigo: number;
  nombre: string;
  tipo?: string;
  camas: GammaBed[];
}
interface GammaSector {
  codigo: string;
  nombre: string;
  habitaciones: GammaRoom[];
}

// ── Patient helpers ──────────────────────────────────────────────────────────
function calcAge(fechaNac: string): number | undefined {
  // format: "DD/MM/YYYY"
  const parts = fechaNac.split('/');
  if (parts.length !== 3) return undefined;
  const [d, m, y] = parts;
  const born = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  if (isNaN(born.getTime())) return undefined;
  const today = new Date();
  let age = today.getFullYear() - born.getFullYear();
  if (
    today.getMonth() < born.getMonth() ||
    (today.getMonth() === born.getMonth() && today.getDate() < born.getDate())
  ) age--;
  return age;
}

async function fetchPatientDetails(token: string, patientCode: string): Promise<GammaPatient | null> {
  try {
    const res = await fetch(
      `${GAMMA_BASE}/oauth_resource/consultarpacientecodigo?codigo=${encodeURIComponent(patientCode)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (Array.isArray(data) && data.length > 0) return data[0] as GammaPatient;
    if (data && typeof data === 'object') return data as GammaPatient;
    return null;
  } catch {
    return null;
  }
}

// ── BedStatus string values (mirrors types.ts enum) ──────────────────────────
const STATUS = {
  AVAILABLE: 'Disponible',
  OCCUPIED: 'Ocupada',
  PREPARATION: 'En preparación',
  DISABLED: 'Inhabilitada',
} as const;

function mapEstado(estado: string | undefined): string {
  if (!estado) return STATUS.AVAILABLE;
  const e = estado.toLowerCase();
  if (e.includes('ocup')) return STATUS.OCCUPIED;
  if (e.includes('prep')) return STATUS.PREPARATION;
  if (e.includes('inhab')) return STATUS.DISABLED;
  return STATUS.OCCUPIED; // unknown occupied states → OCCUPIED
}

// ── Transform Gamma data → app Bed[] ────────────────────────────────────────
function transformBeds(mapData: GammaSector[], occupiedData: GammaSector[]) {
  // Build lookup by "sectorCode-roomCode-bedCode"
  const occLookup = new Map<string, GammaBed>();
  for (const sector of occupiedData) {
    for (const room of sector.habitaciones ?? []) {
      for (const bed of room.camas ?? []) {
        occLookup.set(`${sector.codigo}-${room.codigo}-${bed.codigo}`, bed);
      }
    }
  }

  const beds = [];
  let id = 1;

  for (const sector of mapData) {
    for (const room of sector.habitaciones ?? []) {
      for (const bed of room.camas ?? []) {
        const occ = occLookup.get(`${sector.codigo}-${room.codigo}-${bed.codigo}`);

        beds.push({
          id: `BED-${id++}`,
          label: `${room.nombre} - ${bed.nombre ?? `Cama 0${bed.codigo}`}`,
          area: sector.nombre,                     // matches Area enum values directly
          status: mapEstado(occ?.estado),
          patientName: occ?.paciente ?? undefined,
          roomCode: String(room.codigo),
          bedCode: String(bed.codigo),
          eventOrigin: occ?.origen_evento ?? undefined,
          eventNumber: occ?.numero_evento ?? undefined,
          patientCode: occ?.codigo_paciente ?? undefined,
          institution: undefined as string | undefined,
          dni: undefined as string | undefined,
          age: undefined as number | undefined,
        });
      }
    }
  }

  return beds;
}

// ── Handler ──────────────────────────────────────────────────────────────────
async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!CLIENT_ID || !CLIENT_SECRET) {
    res.status(503).json({
      error: 'AZURE_CLIENTE_ID / AZURE_CLIENT_SECRET not set in environment variables.',
    });
    return;
  }

  try {
    const [tokenMap, tokenOcc, tokenPat] = await Promise.all([
      getToken('obtenermapacamas'),
      getToken('obtenermapacamasocupadas'),
      getToken('consultarpacientecodigo'),
    ]);

    const [mapRes, occRes] = await Promise.all([
      fetch(`${GAMMA_BASE}/oauth_resource/obtenermapacamas`, {
        headers: { Authorization: `Bearer ${tokenMap}` },
      }),
      fetch(`${GAMMA_BASE}/oauth_resource/obtenermapacamasocupadas`, {
        headers: { Authorization: `Bearer ${tokenOcc}` },
      }),
    ]);

    const [mapData, occData] = (await Promise.all([
      mapRes.json(),
      occRes.json(),
    ])) as [GammaSector[], GammaSector[]];

    const beds = transformBeds(mapData, occData);

    // Enrich occupied beds with patient details (DNI, age, financiador)
    const occupiedBeds = beds.filter(b => b.patientCode && b.status === STATUS.OCCUPIED);
    if (occupiedBeds.length > 0) {
      const patientResults = await Promise.all(
        occupiedBeds.map(b => fetchPatientDetails(tokenPat, b.patientCode!)),
      );
      occupiedBeds.forEach((bed, i) => {
        const p = patientResults[i];
        if (!p) return;
        bed.institution = p.ENT_NOMBRE_FANTASIA?.trim() || undefined;
        bed.dni = p.ENT_NUMERO_DOCUMENTO?.trim() || undefined;
        bed.age = p.PCN_FECHA_NACIMIENTO ? calcAge(p.PCN_FECHA_NACIMIENTO) : undefined;
      });
    }

    res.status(200).json({ beds });
  } catch (err: any) {
    console.error('[api/beds]', err);
    res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}

export default requireAuth(handler);
