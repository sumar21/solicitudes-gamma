/**
 * Rate limiting helper para login (anti brute-force).
 *
 * Estrategia: 5 intentos fallidos en 5 minutos → bloqueo de 15 minutos.
 * Login exitoso resetea el contador.
 *
 * Backend:
 *  - Si UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN están configurados,
 *    usa Upstash Redis (contador compartido entre instancias Vercel y persiste cold-starts).
 *  - Si no, fallback a Map<key, ...> in-memory (vive en una sola instancia).
 *
 * Para activar Redis:
 *   1. Crear cuenta en https://upstash.com → Create Database (Global, plan Free).
 *   2. Copiar REST URL y REST Token desde el dashboard.
 *   3. Agregar al .env.local y a Vercel envs:
 *        UPSTASH_REDIS_REST_URL=https://...
 *        UPSTASH_REDIS_REST_TOKEN=...
 *   4. Redeploy. Ya queda activo automáticamente.
 */

import { Redis } from '@upstash/redis';

// ── Config ───────────────────────────────────────────────────────────────────
const MAX_ATTEMPTS    = 5;
const ATTEMPTS_WINDOW = 5 * 60;   // 5 minutos
const LOCKOUT_TTL     = 15 * 60;  // 15 minutos

// Timeout por operación contra Upstash. Si tarda más, no bloqueamos al usuario:
// se cae al circuit breaker y queda usando memoria. Login completo no debería
// tardar más de eso por un check anti-brute-force.
const UPSTASH_TIMEOUT_MS = 1_500;

// Circuit breaker: si hay N errores consecutivos contra Upstash (timeouts, 429
// por cuota agotada, etc.), deshabilitarlo por COOLDOWN_MS. Mientras tanto, todo
// el rate-limit corre con el Map in-memory. Después del cooldown se reintenta
// y, si responde bien, vuelve a operar normal.
const BREAKER_THRESHOLD  = 3;
const BREAKER_COOLDOWN_MS = 5 * 60 * 1000; // 5 min

// ── Upstash Redis client (lazy, solo si las envs están) ──────────────────────
let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

// ── Circuit breaker state ───────────────────────────────────────────────────
let breakerFailures = 0;
let breakerOpenUntil = 0;

function isUpstashHealthy(): boolean {
  return Date.now() >= breakerOpenUntil;
}
function recordUpstashSuccess(): void {
  if (breakerFailures > 0) breakerFailures = 0;
}
function recordUpstashError(reason: string): void {
  breakerFailures += 1;
  if (breakerFailures >= BREAKER_THRESHOLD && Date.now() >= breakerOpenUntil) {
    breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
    console.warn(
      `[rate-limit] Upstash temporalmente deshabilitado (${reason}). ` +
      `Usando memoria local por ${BREAKER_COOLDOWN_MS / 60_000} min.`,
    );
  }
}

/**
 * Devuelve el cliente Redis solo si está sano (envs presentes + breaker cerrado).
 * Cualquiera de las funciones públicas usa esto para decidir Upstash vs memoria.
 */
function activeRedis(): Redis | null {
  if (!isUpstashHealthy()) return null;
  return getRedis();
}

/** Wrap una promesa con timeout. Si vence, rechaza con un Error genérico. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Upstash ${label} timeout (${ms}ms)`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// ── In-memory fallback ──────────────────────────────────────────────────────
type MemEntry = { count: number; firstAt: number; blockedUntil?: number };
const memStore = new Map<string, MemEntry>();

function memCheck(key: string): { allowed: true } | { allowed: false; retryAfter: number } {
  const now = Date.now();
  const entry = memStore.get(key);
  if (!entry) return { allowed: true };
  // Bloqueo activo
  if (entry.blockedUntil && entry.blockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
  }
  // Bloqueo expiró → reset
  if (entry.blockedUntil && entry.blockedUntil <= now) {
    memStore.delete(key);
    return { allowed: true };
  }
  // Ventana de intentos expiró → reset
  if (now - entry.firstAt > ATTEMPTS_WINDOW * 1000) {
    memStore.delete(key);
    return { allowed: true };
  }
  return { allowed: true };
}

function memRecordFailure(key: string): void {
  const now = Date.now();
  const entry = memStore.get(key);
  if (!entry || (entry.blockedUntil && entry.blockedUntil <= now) || now - entry.firstAt > ATTEMPTS_WINDOW * 1000) {
    memStore.set(key, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + LOCKOUT_TTL * 1000;
  }
  memStore.set(key, entry);
}

function memReset(key: string): void {
  memStore.delete(key);
}

// ── API pública ──────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number; // segundos hasta poder reintentar (solo si allowed === false)
}

/**
 * Chequea si la key tiene permitido intentar. Llamar ANTES de validar credenciales.
 * Si retorna allowed: false, responder 429 con Retry-After header.
 */
export async function checkRateLimit(key: string): Promise<RateLimitResult> {
  const redis = activeRedis();
  if (!redis) return memCheck(key);
  try {
    const lockKey = `auth:lock:${key}`;
    const ttl = await withTimeout(redis.ttl(lockKey), UPSTASH_TIMEOUT_MS, 'check');
    recordUpstashSuccess();
    if (typeof ttl === 'number' && ttl > 0) return { allowed: false, retryAfter: ttl };
    return { allowed: true };
  } catch (e: any) {
    recordUpstashError(e?.message ?? 'check failed');
    return memCheck(key);
  }
}

/**
 * Registra un intento fallido. Si supera el umbral, activa el lock de 15min.
 *
 * Estrategia ante fallo de Upstash: además del catch genérico, cualquier intento
 * fallido se registra TAMBIÉN en memoria (best-effort). Así, si el breaker se abre
 * después del primer intento, el contador local mantiene continuidad.
 */
export async function recordFailure(key: string): Promise<void> {
  // Siempre escribimos en memoria como respaldo. La operación es O(1) y no costa nada.
  memRecordFailure(key);
  const redis = activeRedis();
  if (!redis) return;
  try {
    const attemptsKey = `auth:attempts:${key}`;
    const lockKey     = `auth:lock:${key}`;
    const count = await withTimeout(redis.incr(attemptsKey), UPSTASH_TIMEOUT_MS, 'incr');
    if (count === 1) {
      await withTimeout(redis.expire(attemptsKey, ATTEMPTS_WINDOW), UPSTASH_TIMEOUT_MS, 'expire');
    }
    if (count >= MAX_ATTEMPTS) {
      await withTimeout(redis.set(lockKey, '1', { ex: LOCKOUT_TTL }), UPSTASH_TIMEOUT_MS, 'set-lock');
      await withTimeout(redis.del(attemptsKey), UPSTASH_TIMEOUT_MS, 'del-attempts');
    }
    recordUpstashSuccess();
  } catch (e: any) {
    recordUpstashError(e?.message ?? 'record-failure failed');
  }
}

/**
 * Limpia contador y lock tras login exitoso.
 */
export async function resetRateLimit(key: string): Promise<void> {
  // Reset siempre en memoria
  memReset(key);
  const redis = activeRedis();
  if (!redis) return;
  try {
    await withTimeout(
      redis.del(`auth:attempts:${key}`, `auth:lock:${key}`),
      UPSTASH_TIMEOUT_MS,
      'reset',
    );
    recordUpstashSuccess();
  } catch (e: any) {
    recordUpstashError(e?.message ?? 'reset failed');
  }
}

/**
 * Construye una key estable a partir de username + IP del cliente.
 */
export function buildAuthKey(username: string | undefined, ip: string | undefined): string {
  const u = (username ?? 'unknown').toLowerCase().trim();
  const i = (ip ?? 'unknown').trim();
  return `${u}:${i}`;
}
