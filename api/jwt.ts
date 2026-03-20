/**
 * JWT helpers — sign, verify, and requireAuth middleware.
 * Uses `jose` (pure JS, compatible with Vercel serverless + Edge).
 *
 * Token lifetime: 8 hours (una jornada laboral).
 * Secret: JWT_SECRET env var — must be a long random string.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const SECRET  = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret-change-in-production');
const EXPIRY  = '8h';

export interface AppTokenPayload extends JWTPayload {
  id:    string;
  name:  string;
  role:  string;
  sede:  string;
  email: string;
}

// ── Sign ─────────────────────────────────────────────────────────────────────
export async function signToken(payload: Omit<AppTokenPayload, keyof JWTPayload>): Promise<string> {
  return new SignJWT(payload as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
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
