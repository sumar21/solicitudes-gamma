/**
 * Cliente de Supabase para el FRONTEND.
 *
 * Contexto de la migración (ver docs/traslados-migracion-supabase.md): estamos moviendo el
 * subsistema de traslados de SharePoint/Vercel a Supabase para matar el poll de tickets cada
 * 15s (el mayor consumo de Vercel). El navegador se va a suscribir a los cambios de la tabla
 * `traslados` vía Realtime en vez de pollear.
 *
 * Auth: NO usamos Supabase Auth. La identidad y los roles siguen en SharePoint (mediflow_token).
 * Para las lecturas por Realtime, `/api/auth` va a firmar un "pase" JWT con los claims
 * { sede, entorno } que las policies de RLS leen con auth.jwt(). Ese pase se inyecta acá con la
 * opción `accessToken` cuando lo implementemos (paso B de la migración). Por ahora el cliente
 * arranca con la publishable key sola (pública, protegida por RLS).
 *
 * La publishable key es pública POR DISEÑO (va en el bundle). Lo que protege los datos es el RLS,
 * no esconder la key. Por eso NUNCA va acá la secret key.
 */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !publishableKey) {
  // Falla ruidosa en dev: sin estas dos, cualquier llamada a Supabase daría un error opaco.
  console.error('[supabase] Faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_PUBLISHABLE_KEY en el entorno.');
}

export const supabase = createClient(url ?? '', publishableKey ?? '', {
  auth: {
    // No usamos Supabase Auth: no persistir sesión ni auto-refrescar tokens propios de Supabase.
    persistSession: false,
    autoRefreshToken: false,
  },
  // TODO (paso B): inyectar el "pase" JWT de SharePoint:
  //   accessToken: async () => localStorage.getItem('mediflow_supabase_token') ?? '',
});
