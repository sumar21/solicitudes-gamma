/**
 * GET /api/supabase-token — mintea un "pase" JWT para Supabase.
 *
 * El navegador NO usa Supabase Auth: la identidad vive en SharePoint (mediflow_token). Este
 * endpoint valida ese token (requireAuth) y devuelve un JWT corto que Supabase acepta, con el
 * claim `entorno` que leen las policies de RLS. Así el browser puede suscribirse a Realtime
 * (lecturas del mapa) sin exponer datos: solo ve las filas de su entorno.
 *
 * FIRMA: HS256 con SUPABASE_JWT_SECRET (el "JWT secret" del proyecto Supabase). Es el patrón
 * legacy — Supabase recomienda claves asimétricas, pero para una app interna con el secret
 * server-side es aceptable, y es reversible sin tocar las policies (leen el mismo claim).
 *
 * VIDA CORTA (1h) a propósito: el mediflow_token dura ~10 años (PWA que no desloguea), pero un
 * token de Supabase de 10 años no se puede rotar. El cliente re-mintea este pase on-demand
 * (ver lib/supabase.ts), así nunca hay un token largo de Supabase dando vueltas.
 */
import { SignJWT } from 'jose';
import { requireAuth } from './jwt.js';

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();
const PASE_TTL_SECONDS = 60 * 60; // 1h

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_JWT_SECRET) {
    return res.status(503).json({ error: 'SUPABASE_JWT_SECRET no configurado' });
  }

  // `req.user` lo puso requireAuth al verificar el mediflow_token (id, name, role, sede, email).
  const user = req.user ?? {};
  const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);

  const token = await new SignJWT({
    // `role` = rol Postgres que la RLS usa para evaluar las policies. SIEMPRE 'authenticated':
    // el alcance real lo dan los claims + las policies, no este valor.
    role: 'authenticated',
    // El claim que lee la policy `entorno = auth.jwt() ->> 'entorno'`.
    entorno: ENTORNO,
    // Por si más adelante escalamos el scope de lectura por sede.
    sede: String(user.sede ?? 'HPR'),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id ?? ''))       // sub = id del usuario (SharePoint)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(`${PASE_TTL_SECONDS}s`)
    .sign(secret);

  return res.status(200).json({ token, expiresIn: PASE_TTL_SECONDS });
}

export default requireAuth(handler);
