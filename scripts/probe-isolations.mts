/**
 * Script de diagnóstico (TEMPORAL / descartable): valida la estructura del nuevo
 * campo AISLAMIENTOS[] que Gamma agregó a `obtenereventointernacion`.
 *
 * Escanea las camas ocupadas (obtenermapacamasocupadas), consulta el evento de cada
 * una y reporta:
 *   1. Estructura cruda de AISLAMIENTOS de 3-4 eventos que lo traigan no vacío.
 *   2. Todos los HCG_DESCRIPCION distintos vistos (con conteo).
 *   3. Todos los EIP_RESPUESTA_VALOR distintos (¿Prescribe / Ninguno?).
 *   4. Si las observaciones llegan como filas "<Tipo> - Observaciones".
 *   5. Descripciones DESCONOCIDAS (no mapeadas en la tabla propuesta).
 *
 * Uso:
 *   npx tsx scripts/probe-isolations.mts [maxBeds]
 *   (maxBeds opcional: limita cuántas camas ocupadas consultar; default = todas)
 *
 * NO toca código de producción. Borrar cuando termine la validación.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Cargar .env.local ────────────────────────────────────────────────────────
try {
  const envPath = resolve(import.meta.dirname ?? '.', '..', '.env.local');
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch (e: any) {
  console.error('No pude cargar .env.local:', e.message);
  process.exit(1);
}

const GAMMA_BASE    = process.env.GAMMA_VM_URL ?? 'http://35.224.5.114/proxy/index.php';
const CLIENT_ID     = process.env.CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.CLIENT_SECRET ?? '';
const TIMEOUT_MS    = Number(process.env.GAMMA_FETCH_TIMEOUT_MS ?? 30_000);
const WORKERS       = 8;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Faltan CLIENT_ID / CLIENT_SECRET en .env.local');
  process.exit(1);
}

const maxBeds = process.argv[2] ? parseInt(process.argv[2], 10) : Infinity;

// Tipos base que ESPERAMOS de Gamma (según el form de enfermería). Para detectar
// descripciones "desconocidas". Normalizados (sin acentos, lower, espacios colapsados).
const KNOWN_BASES = [
  'por gotas',
  'respiratorio',
  'neutropenico',
  'de contacto',
  'de contacto preventivo',
  'de contacto c. difficile',
  'entomologico',
  'covid 19',
  'trasplante',
];

const norm = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function isObservacion(desc: string): boolean {
  return norm(desc).includes('observ');
}

// Quita el sufijo "- Observaciones" para obtener la base.
function baseOf(desc: string): string {
  return norm(desc).replace(/\s*-\s*observaci.*$/i, '').trim();
}

function classify(desc: string): 'base-known' | 'obs-known' | 'unknown' {
  const base = baseOf(desc);
  const known = KNOWN_BASES.includes(base);
  if (isObservacion(desc)) return known ? 'obs-known' : 'unknown';
  return known ? 'base-known' : 'unknown';
}

// ── fetch con timeout ────────────────────────────────────────────────────────
async function fetchT(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

// ── OAuth (mismo flujo que api/gamma-client.ts) ──────────────────────────────
async function getToken(scope: string): Promise<string> {
  const codeRes = await fetchT(
    `${GAMMA_BASE}/oauth_authorize?response_type=code&client_id=${encodeURIComponent(CLIENT_ID)}&state=xyz`,
  );
  const codeText = await codeRes.text();
  let code: string;
  try {
    const p = JSON.parse(codeText) as any;
    code = String(p.code ?? p.auth_code ?? p.authorization_code ?? '').trim() || codeText.trim();
  } catch { code = codeText.trim(); }

  const tokenRes = await fetchT(`${GAMMA_BASE}/oauth_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, scope,
    }),
  });
  const tokenData: any = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Token error: ' + JSON.stringify(tokenData).slice(0, 200));
  return tokenData.access_token;
}

interface OccBed { origen: string; numero: number; paciente: string; }

async function fetchEvent(token: string, origen: string, numero: number): Promise<any | null> {
  try {
    const url = `${GAMMA_BASE}/oauth_resource/obtenereventointernacion?empresa=HPR&origen=${encodeURIComponent(origen)}&numero=${encodeURIComponent(String(numero))}`;
    const res = await fetchT(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === 'object' ? data : null;
  } catch { return null; }
}

(async () => {
  console.log('\n=== 1) Obteniendo camas ocupadas (obtenermapacamasocupadas) ===');
  const tokenOcc = await getToken('obtenermapacamasocupadas');
  const occRes = await fetchT(`${GAMMA_BASE}/oauth_resource/obtenermapacamasocupadas`, {
    headers: { Authorization: `Bearer ${tokenOcc}` },
  });
  if (!occRes.ok) { console.error('Falló obtenermapacamasocupadas:', occRes.status); process.exit(1); }
  const occData: any[] = await occRes.json();

  const beds: OccBed[] = [];
  for (const sector of occData ?? []) {
    for (const room of sector.habitaciones ?? []) {
      for (const cama of room.camas ?? []) {
        const origen = cama.origen_evento ? String(cama.origen_evento).trim() : '';
        const numero = typeof cama.numero_evento === 'number' ? cama.numero_evento : Number(cama.numero_evento);
        if (!origen || !numero) continue;
        beds.push({ origen, numero, paciente: String(cama.paciente ?? '').trim() });
      }
    }
  }
  const targetBeds = beds.slice(0, maxBeds);
  console.log(`Camas ocupadas con evento válido: ${beds.length}${maxBeds !== Infinity ? ` (consultando primeras ${targetBeds.length})` : ''}`);

  console.log('\n=== 2) Consultando eventos (obtenereventointernacion) ===');
  const tokenEvt = await getToken('obtenereventointernacion');

  // Acumuladores
  const hcgCounts   = new Map<string, number>();   // HCG_DESCRIPCION → count (raw)
  const respCounts  = new Map<string, number>();   // EIP_RESPUESTA_VALOR → count (raw)
  const extraKeys   = new Set<string>();           // claves extra dentro de cada entry
  const unknownDescs = new Set<string>();
  const rawSamples: any[] = [];                    // hasta 4 eventos con AISLAMIENTOS no vacío
  let fieldPresent = 0, fieldArrayNonEmpty = 0, fieldMissing = 0, fetchFailed = 0;
  let prescribeBeds = 0; // camas con al menos un tipo en "Prescribe"

  const queue = [...targetBeds];
  let done = 0;
  const worker = async () => {
    while (queue.length > 0) {
      const b = queue.shift();
      if (!b) return;
      const ev = await fetchEvent(tokenEvt, b.origen, b.numero);
      done++;
      if (done % 20 === 0) console.log(`  ...${done}/${targetBeds.length}`);
      if (!ev) { fetchFailed++; continue; }

      const ais = (ev as any).AISLAMIENTOS;
      if (ais === undefined || ais === null) { fieldMissing++; continue; }
      fieldPresent++;
      if (!Array.isArray(ais) || ais.length === 0) continue;
      fieldArrayNonEmpty++;

      let hasPrescribe = false;
      for (const entry of ais) {
        const desc = String(entry?.HCG_DESCRIPCION ?? '');
        const resp = String(entry?.EIP_RESPUESTA_VALOR ?? '');
        hcgCounts.set(desc, (hcgCounts.get(desc) ?? 0) + 1);
        respCounts.set(resp, (respCounts.get(resp) ?? 0) + 1);
        for (const k of Object.keys(entry ?? {})) {
          if (k !== 'HCG_DESCRIPCION' && k !== 'EIP_RESPUESTA_VALOR') extraKeys.add(k);
        }
        if (classify(desc) === 'unknown') unknownDescs.add(desc);
        if (norm(resp) === 'prescribe') hasPrescribe = true;
      }
      if (hasPrescribe) prescribeBeds++;

      // Guardar hasta 4 muestras crudas (preferentemente con algún "Prescribe").
      if (rawSamples.length < 4 && hasPrescribe) {
        rawSamples.push({
          EVE_ORIGEN: ev.EVE_ORIGEN, EVE_NUMERO: ev.EVE_NUMERO,
          PACIENTE_NOMBRE: ev.PACIENTE_NOMBRE ?? b.paciente,
          AISLAMIENTOS: ais,
        });
      }
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));

  // ── Reporte ────────────────────────────────────────────────────────────────
  console.log('\n\n========================= REPORTE =========================');
  console.log('\n--- Cobertura del campo AISLAMIENTOS ---');
  console.table({
    'eventos consultados':            done,
    'fetch fallido/timeout':          fetchFailed,
    'con campo AISLAMIENTOS presente': fieldPresent,
    'sin campo AISLAMIENTOS':         fieldMissing,
    'con array NO vacío':             fieldArrayNonEmpty,
    'con al menos un "Prescribe"':    prescribeBeds,
  });

  console.log('\n--- 3-4 eventos con AISLAMIENTOS (crudo) ---');
  if (rawSamples.length === 0) console.log('  (ninguna cama ocupada trajo aislamientos con "Prescribe")');
  for (const s of rawSamples) console.log(JSON.stringify(s, null, 2));

  console.log('\n--- HCG_DESCRIPCION distintos (conteo) ---');
  const hcgRows = [...hcgCounts.entries()].sort((a, b) => b[1] - a[1]).map(([desc, count]) => ({
    HCG_DESCRIPCION: desc, count, clasif: classify(desc),
  }));
  console.table(hcgRows);

  console.log('\n--- EIP_RESPUESTA_VALOR distintos (conteo) ---');
  console.table([...respCounts.entries()].sort((a, b) => b[1] - a[1]).map(([v, c]) => ({ valor: v, count: c })));

  console.log('\n--- ¿Hay claves extra en cada entry (más allá de HCG/EIP)? ---');
  console.log(extraKeys.size ? [...extraKeys] : '  (no — solo HCG_DESCRIPCION + EIP_RESPUESTA_VALOR)');

  console.log('\n--- Observaciones: filas tipo "<Tipo> - Observaciones" detectadas ---');
  const obsRows = hcgRows.filter(r => isObservacion(r.HCG_DESCRIPCION));
  console.log(obsRows.length ? obsRows.map(r => r.HCG_DESCRIPCION) : '  (ninguna observación detectada en este universo)');

  console.log('\n--- DESCONOCIDOS (no mapeados en la tabla propuesta) ---');
  console.log(unknownDescs.size ? [...unknownDescs] : '  (0 desconocidos — todo cae en la tabla)');

  console.log('\n===========================================================\n');
})().catch(err => { console.error('Error:', err); process.exit(1); });
