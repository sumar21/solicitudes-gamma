/**
 * JWT helpers — sign, verify, and requireAuth middleware.
 * Uses `jose` (pure JS, compatible with Vercel serverless + Edge).
 *
 * Token lifetime: 8 hours (una jornada laboral).
 * Secret: JWT_SECRET env var — must be a long random string.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const SECRET  = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret-change-in-production');
const EXPIRY_DEFAULT  = '8h';
const EXPIRY_HOSTESS  = '3650d'; // Azafatas: token válido por ~10 años

export interface AppTokenPayload extends JWTPayload {
  id:    string;
  name:  string;
  role:  string;
  sede:  string;
  email: string;
}

// ── Sign ─────────────────────────────────────────────────────────────────────
export async function signToken(payload: { id: string; name: string; role: string; sede: string; email: string }): Promise<string> {
  const expiry = payload.role === 'HOSTESS' ? EXPIRY_HOSTESS : EXPIRY_DEFAULT;
  return new SignJWT(payload as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(SECRET);
}

// ── Verify ────────────────────────────────────────────────────────────────────
export async function verifyToken(token: string): Promise<AppTokenPayload> {
  const { payload } = await jwtVerify(token, SECRET);
  return payload as AppTokenPayload;
}

// ── requireAuth middleware ────────────────────────────────────────────────────
type Handler = (req: any, res: any) => Promise<unknown>;

export function requireAuth(handler: Handler): Handler {
  return async (req: any, res: any) => {
    const authHeader = req.headers?.authorization ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No autorizado — token requerido' });
    }

    try {
      const token = authHeader.slice(7);
      req.user    = await verifyToken(token);
      return handler(req, res);
    } catch {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
  };
}
