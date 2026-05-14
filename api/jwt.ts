/**
 * JWT helpers — sign, verify, and requireAuth middleware.
 * Uses `jose` (pure JS, compatible with Vercel serverless + Edge).
 *
 * Token lifetime: 8 hours (una jornada laboral).
 * Secret: JWT_SECRET env var — must be a long random string.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { checkRequestLocation, checkRequestLocationFull, getClientIp } from './location-check.js';

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
export async function signToken(payload: Omit<AppTokenPayload, keyof JWTPayload>): Promise<string> {
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

// ── requireAuthAndLocation middleware ────────────────────────────────────────
// Composición de requireAuth + check de ubicación por IP **y geo** en cada request.
//
// El cliente manda la geo del browser en un header `X-Geo: lat,lng` (cacheada con
// maximumAge ~60s para no martillar el GPS). Si está presente, validamos IP+geo
// con `checkRequestLocationFull`. Si no está, fallback a IP-only.
//
// Si no autoriza → 403 con `error: 'location_blocked'`.
//
// Performance: el check usa cache server-side de reglas (5 min TTL por sede).
//
// Fail-open: si SP no responde, devuelve allowed=true para no bloquear el
// hospital. Mismo criterio que el login.
function parseGeoHeader(raw: unknown): { lat: number; lng: number } | null {
  if (typeof raw !== 'string' || !raw.includes(',')) return null;
  const [latStr, lngStr] = raw.split(',', 2);
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  return { lat, lng };
}

export function requireAuthAndLocation(handler: Handler): Handler {
  return requireAuth(async (req: any, res: any) => {
    const clientIp = getClientIp(req);
    const sede     = String(req.user?.sede ?? 'HPR');
    const geo      = parseGeoHeader(req.headers?.['x-geo']);

    const check = geo
      ? await checkRequestLocationFull({ sede, clientIp, lat: geo.lat, lng: geo.lng })
      : await checkRequestLocation({ sede, clientIp });

    if (!check.allowed) {
      return res.status(403).json({
        error: 'location_blocked',
        reason: check.reason ?? 'Ubicación no autorizada',
        method: check.method,
      });
    }
    return handler(req, res);
  });
}
