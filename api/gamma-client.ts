/**
 * Shared Gamma API client — token management, fetch helpers, types.
 * Used by api/beds.ts and api/bed-enrich.ts.
 * Token cache is module-level (survives warm Vercel invocations).
 */

// La URL de PROGAL viene SIEMPRE de la env var GAMMA_VM_URL — es lo que enruta por entorno
// (progal-test.sumardigital.com.ar en TEST, gamma-vm.sumardigital.com.ar en PROD). NO hay fallback
// hardcodeado a propósito: una URL fija sería incorrecta para al menos un entorno y podría cruzar
// datos (TEST leyendo la PROGAL de PROD) o —antes, con http— viajar en texto plano. Si falta la env,
// FAIL-LOUD: se aborta con error claro en vez de pegar a una PROGAL equivocada en silencio.
function requireGammaBase(): string {
  const url = process.env.GAMMA_VM_URL?.trim();
  if (!url) throw new Error('[gamma] Falta la env var GAMMA_VM_URL — se aborta para no pegar a una PROGAL equivocada.');
  return url;
}
export const GAMMA_BASE = requireGammaBase();
const CLIENT_ID = process.env.CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.CLIENT_SECRET ?? '';

// Gamma corre sobre una VM proxy single-node que a veces responde en 20-25s o se
// cuelga indefinidamente. Sin un techo por llamada, un request colgado bloquea su
// worker hasta que Vercel mata la función entera (status 0 / INVOCATION_TIMEOUT).
// Con timeout, la llamada lenta aborta y se trata como error de ESA cama: la corrida
// sigue y reintenta el próximo ciclo. Tuneable por env sin redeploy.
export const GAMMA_TIMEOUT_MS = Number(process.env.GAMMA_FETCH_TIMEOUT_MS ?? 30_000);

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = GAMMA_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

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
  // Plan médico — viene en obtenermapacamasocupadas dentro de cada cama.
  plan_codigo?: string;
  plan?: string;
  // Observaciones — viene en obtenermapacamas (motivo de inhabilitación principalmente).
  observaciones?: string;
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
  // Nuevos campos (Grupo Gamma añadió en la respuesta de obtenereventointernacion):
  EVE_TIPO_INTERNACION?: string;        // "C" (clínica), "Q" (quirúrgica), "T" (trasplante), "K" (quemados), "H" (hemodinamia), "O" (oncológica)
  EVE_FECHA_HORA_INGRESO?: string | null;
  EVE_FECHA_HORA_EGRESO?: string | null;
  EVE_FECHA_PROBABLE_CIRUGIA?: string | null;
  EVE_DIAS_AUTORIZADOS?: number | null;
  // Plan médico del paciente (Grupo Gamma sumó IPM_* en obtenereventointernacion).
  IPM_PLAN_MEDICO?: string;
  IPM_DESCRIPCION?: string;
  // Listado de respuestas del formulario de dieta: cada entry tiene una condición
  // (HCG_DESCRIPCION) y su respuesta ("Sí" / "No" / valor libre como "Liviana").
  DIETAS?: Array<{
    HCG_DESCRIPCION?: string;
    EIP_RESPUESTA_VALOR?: string;
  }>;
  // Ayunos NO ejecutados (vigentes). Cada fila es UNA ocurrencia concreta ya calculada
  // por Progal: la API resuelve repeticiones, suspensiones individuales, modificaciones,
  // etc. y devuelve directamente cada fecha/hora pendiente. El front NO calcula nada,
  // solo agrupa por indicación y muestra/almacena lo recibido.
  //   · PEA_ID_PLANIFICACION — identifica la indicación (agrupa sus ocurrencias).
  //   · PAT_FECHA_HORA — fecha y hora exacta de la ocurrencia (hora Argentina, naive).
  //   · PEA_FECHA_HORA_INICIO — cuándo se cargó la indicación; informativo, NO se usa.
  AYUNOS?: Array<{
    PEA_ID_INDICACION?: number;
    PEA_ID_PLANIFICACION?: number;
    PEA_FECHA_HORA_INICIO?: string;
    PAT_FECHA_HORA?: string;
  }>;
  // Aislamientos prescriptos al paciente. Misma forma que DIETAS: cada fila es una
  // pregunta del form de enfermería (HCG_DESCRIPCION) con su respuesta
  // (EIP_RESPUESTA_VALOR). El tipo base trae "Prescribe"; la observación llega como
  // una fila aparte "<Tipo> - Observaciones" con el texto libre. Ver api/isolations-summary.ts.
  AISLAMIENTOS?: Array<{
    HCG_DESCRIPCION?: string;
    EIP_RESPUESTA_VALOR?: string;
  }>;
}

// ── Token cache (survives warm invocations) ──────────────────────────────────
const tokenCache = new Map<string, { token: string; exp: number }>();

export async function getToken(scope: string): Promise<string> {
  const cached = tokenCache.get(scope);
  if (cached && Date.now() < cached.exp) return cached.token;

  // Step 1 — auth code
  const codeRes = await fetchWithTimeout(
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
  const tokenRes = await fetchWithTimeout(`${GAMMA_BASE}/oauth_token`, {
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
    const res = await fetchWithTimeout(
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
    const res = await fetchWithTimeout(
      `${GAMMA_BASE}/oauth_resource/obtenereventointernacion?empresa=HPR&origen=${encodeURIComponent(eventOrigin)}&numero=${encodeURIComponent(String(eventNumber))}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const ev = data as GammaEvent;
      // Guard anti 200-parcial de Gamma (inestable): un evento de internación VÁLIDO siempre trae su
      // identidad/estructura (origen/número/paciente/tipo/ingreso). Un 200 con objeto vacío o de error
      // NO → lo tratamos como fallo (null) para que buildEnrich marque eventFetchFailed y el cron NO
      // pise el enrich bueno con uno sin dieta/ayuno (reintroduciría el falso "sin dieta") ni emita un
      // falso "Ayuno cancelado". OJO: DIETAS/AYUNOS/AISLAMIENTOS vacíos SÍ son válidos (paciente sin
      // dieta especial) → NO se validan acá. Importa sobre todo con el read-flip a Supabase (PROD lee
      // enrich_camas). Ver docs/historial/runbook-pase-prod-2026-08-24.md (B7).
      const looksLikeEvent =
        ev.EVE_NUMERO != null || !!ev.EVE_ORIGEN || !!ev.EVE_PACIENTE ||
        !!ev.EVE_TIPO_INTERNACION || !!ev.EVE_FECHA_HORA_INGRESO;
      if (looksLikeEvent) return ev;
    }
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

// ── Shared event cache (used by /api/beds enrich AND /api/bed-enrich) ─────────
// Mantener una sola fuente de verdad para "evento de un paciente" evita doble
// fetch cuando el mapa de camas se carga y luego el usuario clickea una cama.
const eventCache = new Map<string, { data: GammaEvent | null; exp: number }>();
const EVENT_TTL = 60_000;

export async function getEventCached(
  token: string,
  origin: string,
  number: number,
): Promise<GammaEvent | null> {
  const key = `${origin}-${number}`;
  const cached = eventCache.get(key);
  if (cached && cached.exp > Date.now()) return cached.data;
  const data = await fetchEventDetails(token, origin, number);
  eventCache.set(key, { data, exp: Date.now() + EVENT_TTL });
  return data;
}

/** Permite que bed-enrich con `fresh=1` actualice el cache compartido tras un fetch directo. */
export function setEventCache(origin: string, number: number, data: GammaEvent | null): void {
  eventCache.set(`${origin}-${number}`, { data, exp: Date.now() + EVENT_TTL });
}
