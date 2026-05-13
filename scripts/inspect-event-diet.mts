/**
 * Script de diagnóstico: consulta Gamma `obtenereventointernacion` para un
 * paciente específico y muestra el response crudo del campo DIETAS.
 *
 * Uso:
 *   npx tsx scripts/inspect-event-diet.mts <eventOrigin> <eventNumber>
 *
 * Ejemplo:
 *   npx tsx scripts/inspect-event-diet.mts HIN 58218
 *
 * Nos sirve para confirmar si Gamma manda la dieta actualizada o un snapshot
 * viejo, y si el procesamiento de MediFlow (extractDietTags) está bien.
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

const GAMMA_BASE = process.env.GAMMA_VM_URL ?? 'http://35.224.5.114/proxy/index.php';
const CLIENT_ID  = process.env.CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.CLIENT_SECRET ?? '';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Faltan CLIENT_ID / CLIENT_SECRET en .env.local');
  process.exit(1);
}

const [, , eventOrigin, eventNumber] = process.argv;
if (!eventOrigin || !eventNumber) {
  console.error('Uso: npx tsx scripts/inspect-event-diet.mts <eventOrigin> <eventNumber>');
  console.error('Ej:  npx tsx scripts/inspect-event-diet.mts HIN 58218');
  process.exit(1);
}

// ── OAuth flow (mismo que api/gamma-client.ts) ──────────────────────────────
async function getToken(scope: string): Promise<string> {
  // Step 1
  const codeRes = await fetch(
    `${GAMMA_BASE}/oauth_authorize?response_type=code&client_id=${encodeURIComponent(CLIENT_ID)}&state=xyz`,
  );
  const codeText = await codeRes.text();
  let code: string;
  try {
    const p = JSON.parse(codeText) as any;
    code = String(p.code ?? p.auth_code ?? p.authorization_code ?? '').trim() || codeText.trim();
  } catch { code = codeText.trim(); }

  // Step 2
  const tokenRes = await fetch(`${GAMMA_BASE}/oauth_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, scope,
    }),
  });
  const tokenData: any = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Token error: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

(async () => {
  console.log(`\nConsultando obtenereventointernacion para ${eventOrigin}-${eventNumber}...\n`);
  const token = await getToken('obtenereventointernacion');
  const url = `${GAMMA_BASE}/oauth_resource/obtenereventointernacion?empresa=HPR&origen=${encodeURIComponent(eventOrigin)}&numero=${encodeURIComponent(eventNumber)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  console.log(`HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();

  let data: any;
  try { data = JSON.parse(text); }
  catch {
    console.log('Response no es JSON. Crudo:');
    console.log(text.slice(0, 2000));
    return;
  }

  // Resumen de campos clave
  console.log('\n=== Campos clave del evento ===');
  console.log({
    EVE_ORIGEN:                data.EVE_ORIGEN,
    EVE_NUMERO:                data.EVE_NUMERO,
    PACIENTE_NOMBRE:           data.PACIENTE_NOMBRE ?? data.EVE_PACIENTE,
    EVE_TIPO_INTERNACION:      data.EVE_TIPO_INTERNACION,
    EVE_FECHA_HORA_INGRESO:    data.EVE_FECHA_HORA_INGRESO,
    EVE_DIAGNOSTICO:           data.EVE_DIAGNOSTICO,
    PROFESIONAL_NOMBRE:        data.PROFESIONAL_NOMBRE,
    IPM_PLAN_MEDICO:           data.IPM_PLAN_MEDICO,
  });

  console.log('\n=== DIETAS (raw) ===');
  if (!Array.isArray(data.DIETAS)) {
    console.log('NO hay campo DIETAS (o no es array). Valor:', data.DIETAS);
  } else if (data.DIETAS.length === 0) {
    console.log('Array DIETAS vacío.');
  } else {
    console.log(`Total: ${data.DIETAS.length} entradas`);
    console.table(data.DIETAS.map((d: any, i: number) => ({
      idx: i,
      HCG_DESCRIPCION: d.HCG_DESCRIPCION,
      EIP_RESPUESTA_VALOR: d.EIP_RESPUESTA_VALOR,
      // Otros campos por si Gamma sumó algo
      ...Object.fromEntries(
        Object.entries(d).filter(([k]) => k !== 'HCG_DESCRIPCION' && k !== 'EIP_RESPUESTA_VALOR')
      ),
    })));
  }

  console.log('\n=== JSON crudo completo (para mandar al equipo Gamma si hace falta) ===');
  console.log(JSON.stringify(data, null, 2));
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
