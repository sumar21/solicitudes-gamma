/**
 * GET /api/supabase-token — mintea un "pase" JWT para Supabase.
 *
 * El navegador NO usa Supabase Auth: la identidad vive en SharePoint (mediflow_token). Este
 * endpoint valida ese token (requireAuth) y devuelve un JWT corto que Supabase acepta, con el
 * claim `entorno` que leen las policies de RLS. Así el browser puede suscribirse a Realtime
 * (lecturas del mapa) sin exponer datos: solo ve las filas de su entorno.
 *
 * FIRMA: ES256 (asimétrica) con la clave privada del proyecto Supabase. El proyecto es de la
 * generación de "JWT signing keys" (ECC P-256) — no tiene shared secret HS256. La clave se
 * genera aparte (scripts/keygen), se IMPORTA en Supabase (Settings → JWT Keys → import →
 * Rotate para activarla) y su privada vive en SUPABASE_JWT_PRIVATE_KEY (JWK JSON). Supabase
 * verifica el pase contra la pública de esa misma clave. El header `kid` DEBE matchear el de
 * la clave importada.
 *
 * VIDA CORTA (1h) a propósito: el mediflow_token dura ~10 años (PWA que no desloguea), pero un
 * token de Supabase de 10 años no se puede rotar. El cliente re-mintea este pase on-demand
 * (ver lib/supabase.ts), así nunca hay un token largo de Supabase dando vueltas.
 */
import { SignJWT, importJWK, type JWK } from 'jose';
import { requireAuth } from './jwt.js';

// jose no exporta un tipo de clave estable entre versiones; lo inferimos de importJWK.
type SigningKey = Awaited<ReturnType<typeof importJWK>>;

const PRIVATE_JWK_RAW = process.env.SUPABASE_JWT_PRIVATE_KEY ?? '';
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();
const PASE_TTL_SECONDS = 60 * 60; // 1h

// Import de la clave una sola vez por instancia (importJWK es async). Si el JWK está mal
// formado, el error se atrapa por request y se responde 503 en vez de tumbar el módulo.
let signingKeyPromise: Promise<{ key: SigningKey; kid: string }> | null = null;
function getSigningKey() {
  if (!signingKeyPromise) {
    signingKeyPromise = (async () => {
      const jwk = JSON.parse(PRIVATE_JWK_RAW) as JWK;
      const key = await importJWK(jwk, 'ES256');
      return { key, kid: String(jwk.kid ?? '') };
    })();
  }
  return signingKeyPromise;
}

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // CRÍTICO: un token es de un solo uso lógico. Sin esto, el browser o el CDN de Vercel pueden
  // cachear la respuesta GET y devolver SIEMPRE el mismo pase (ya vencido) → loop de tokens
  // muertos. `no-store` en el server + `cache: 'no-store'` en el fetch del cliente lo evita.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!PRIVATE_JWK_RAW) {
    return res.status(503).json({ error: 'SUPABASE_JWT_PRIVATE_KEY no configurado' });
  }

  let key: SigningKey, kid: string;
  try {
    ({ key, kid } = await getSigningKey());
  } catch (e: any) {
    signingKeyPromise = null; // permite reintentar si se corrige el JWK
    console.error('[supabase-token] JWK inválido:', e?.message ?? e);
    return res.status(503).json({ error: 'SUPABASE_JWT_PRIVATE_KEY inválido (¿es un JWK JSON?)' });
  }

  // `req.user` lo puso requireAuth al verificar el mediflow_token (id, name, role, sede, email).
  const user = req.user ?? {};

  const token = await new SignJWT({
    // `role` = rol Postgres que la RLS usa para evaluar las policies. SIEMPRE 'authenticated':
    // el alcance real lo dan los claims + las policies, no este valor.
    role: 'authenticated',
    // El claim que lee la policy `entorno = auth.jwt() ->> 'entorno'`.
    entorno: ENTORNO,
    // Por si más adelante escalamos el scope de lectura por sede.
    sede: String(user.sede ?? 'HPR'),
  })
    // El `kid` DEBE matchear la clave importada en Supabase, si no la verificación falla.
    .setProtectedHeader({ alg: 'ES256', kid, typ: 'JWT' })
    .setSubject(String(user.id ?? ''))       // sub = id del usuario (SharePoint)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(`${PASE_TTL_SECONDS}s`)
    .sign(key);

  return res.status(200).json({ token, expiresIn: PASE_TTL_SECONDS });
}

export default requireAuth(handler);
