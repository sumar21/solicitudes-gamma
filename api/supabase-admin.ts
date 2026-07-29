/**
 * Cliente de Supabase para el BACKEND (service_role).
 *
 * A diferencia de lib/supabase.ts (frontend, publishable key + RLS), este cliente usa la
 * SECRET key (SUPABASE_SECRET_KEY, `sb_secret_...`) que BYPASSA la RLS. Es el único camino
 * server-side para leer/escribir tablas con candado solo-service_role (public.roles,
 * public.push_subscriptions). 🔴 NUNCA debe llegar al cliente: se importa solo desde api/.
 *
 * Contexto (migración de roles, ver docs): las tablas public.roles y push_subscriptions tienen
 * RLS on SIN policies y grants solo a service_role. anon/authenticated no las ven. El backend
 * entra por acá.
 *
 * La URL se toma de SUPABASE_URL o, en su defecto, VITE_SUPABASE_URL (misma URL del proyecto;
 * el prefijo VITE_ solo importa para el bundle del cliente, en el server ambas viven en
 * process.env). Sin URL o sin secret key, getSupabaseAdmin() lanza con un mensaje accionable
 * en vez de crear un cliente que falle opaco en la primera query.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Se leen las envs DENTRO de las funciones (no a nivel módulo) para no depender del orden de
// carga: en dev-server las envs se cargan antes de importar los api/, pero un import temprano
// dejaría estos valores congelados en ''. Leerlas lazy evita ese footgun.
function readEnv() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SECRET_KEY ?? '';
  return { url, key };
}

let client: SupabaseClient | null = null;

/**
 * Devuelve el cliente admin (singleton por instancia de lambda). Lanza si faltan las envs,
 * para que el caller responda un error claro (ej. 503) en vez de un fallo opaco de red.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;
  const { url, key } = readEnv();
  if (!url || !key) {
    throw new Error(
      '[supabase-admin] Falta SUPABASE_URL/VITE_SUPABASE_URL o SUPABASE_SECRET_KEY en el entorno.',
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** True si las envs necesarias están configuradas (para chequear antes de usar el seam). */
export function isSupabaseAdminConfigured(): boolean {
  const { url, key } = readEnv();
  return Boolean(url && key);
}
