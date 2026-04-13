/**
 * Shared Gamma API client — token management, fetch helpers, types.
 * Used by api/beds.ts and api/bed-enrich.ts.
 * Token cache is module-level (survives warm Vercel invocations).
 */

export const GAMMA_BASE = process.env.GAMMA_VM_URL ?? 'http://35.224.5.114/proxy/index.php';
const CLIENT_ID = process.env.CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.CLIENT_SECRET ?? '';

// ── Gamma response types ─────────────────────────────────────────────────────
export interface GammaBed {
  codigo: number;
  nombre?: string;
  estado?: string;
  origen_evento?: string;
  numero_evento?: number;
  codigo_paciente?: string;
  paciente?: string;
  codigo_profesional?: string;
  profesional?: string;
  codigo_institucion?: string;
  institucion?: string;
}

export interface GammaPatient {
  PCN_NUMERO?: string;
  ENT_NOMBRE?: string;
  ENT_TIPO_DOCUMENTO?: string;
  ENT_NUMERO_DOCUMENTO?: string;
  PCN_FECHA_NACIMIENTO?: string; // "DD/MM/YYYY"
  ENT_NOMBRE_FANTASIA?: string;  // obra social / financiador
  PCN_NUMERO_AFILIADO?: string;
  PCN_SEXO?: string;
}

export interface GammaRoom {
  codigo: number;
  nombre: string;
  tipo?: string;
  camas: GammaBed[];
}

export interface GammaSector {
  codigo: string;
  nombre: string;
  habitaciones: GammaRoom[];
}

export interface GammaEvent {
  EVE_ORIGEN?: string;
  EVE_NUMERO?: number;
  EVE_PACIENTE?: string;
  PACIENTE_NOMBRE?: string;
  EVE_PROFESIONAL_SOLICITANTE?: string;
  PROFESIONAL_NOMBRE?: string;
  EVC_INSTITUCION?: string;
  INSTITUCION_NOMBRE?: string;
  EVE_DIAGNOSTICO?: string;
}

// ── Token cache (survives warm invocations) ──────────────────────────────────
const tokenCache = new Map<string, { token: string; exp: number }>();

export async function getToken(scope: string): Promise<string> {
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
    console.warn(`[gamma-client] Token non-JSON for scope "${scope}" (status ${tokenRes.status})`);
    return '';
  }
  if (!tokenData.access_token) {
    console.warn(`[gamma-client] No access_token for scope "${scope}":`, JSON.stringify(tokenData).slice(0, 200));
    return '';
  }

  const expiresIn = parseInt(String(tokenData.expires_in ?? '3600'), 10);
  tokenCache.set(scope, {
    token: String(tokenData.access_token),
    exp: Date.now() + (expiresIn - 60) * 1000,
  });

  return String(tokenData.access_token);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function calcAge(fechaNac: string): number | undefined {
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

export async function fetchPatientDetails(token: string, patientCode: string): Promise<GammaPatient | null> {
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

export async function fetchEventDetails(token: string, eventOrigin: string, eventNumber: number): Promise<GammaEvent | null> {
  try {
    const res = await fetch(
      `${GAMMA_BASE}/oauth_resource/obtenereventointernacion?empresa=HPR&origen=${encodeURIComponent(eventOrigin)}&numero=${encodeURIComponent(String(eventNumber))}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (data && typeof data === 'object') return data as GammaEvent;
    return null;
  } catch {
    return null;
  }
}

/** DJB2 string hash */
export function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}
