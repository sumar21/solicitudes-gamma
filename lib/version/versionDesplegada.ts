import { esVersionDeLaApp } from '../version';
import { CORTE_DE_LA_CONSULTA_MS } from './actualizacion';

/**
 * La versión que corre el servidor, o `null` si no se pudo saber (red, corte a los
 * diez segundos, respuesta no 200, cuerpo sin versión con formato).
 * Nunca rechaza y no escribe en consola: la próxima vuelta vuelve a preguntar.
 */
export async function pedirVersionDesplegada({
  signal,
  pedido = fetch,
  corteMs = CORTE_DE_LA_CONSULTA_MS,
}: {
  signal?: AbortSignal;
  /** Para los tests. */
  pedido?: typeof fetch;
  corteMs?: number;
} = {}): Promise<string | null> {
  const controlador = new AbortController();
  const cortar = () => controlador.abort();
  const corte = setTimeout(cortar, corteMs);
  if (signal?.aborted) controlador.abort();
  else signal?.addEventListener('abort', cortar, { once: true });

  try {
    const respuesta = await pedido('/api/version', {
      cache: 'no-store',
      signal: controlador.signal,
    });
    if (!respuesta.ok) return null;

    const cuerpo: unknown = await respuesta.json();
    const version =
      cuerpo !== null && typeof cuerpo === 'object'
        ? (cuerpo as { version?: unknown }).version
        : undefined;
    return esVersionDeLaApp(version) ? version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(corte);
    signal?.removeEventListener('abort', cortar);
  }
}
