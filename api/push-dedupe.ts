/**
 * Guard de idempotencia por evento (in-memory, sin side-effects a nivel módulo).
 *
 * createRecentEventGuard(ttlMs) devuelve una función seen(key): retorna `true` si esa
 * key se registró hace <ttlMs (evento repetido → el caller debe saltearlo) y `false` si
 * es nueva (y en ese caso la registra con el timestamp actual). Mismo espíritu que
 * lib/utils.createActionLock, pero con ventana temporal en vez de lock en vuelo.
 *
 * ponytail: techo per-instancia-de-lambda (Vercel). Colapsa el caso común —2 PATCH
 * casi simultáneos / reintento en un lambda caliente que comparte esta instancia— pero
 * NO 2 lambdas fríos en paralelo (cada uno tiene su propio Map). Upgrade path si hiciera
 * falta cross-instancia: mover el store a algo compartido (SP/Redis) manteniendo la firma.
 */
export function createRecentEventGuard(ttlMs: number) {
  const seenAt = new Map<string, number>();
  return function seen(key: string): boolean {
    const now = Date.now();
    const prev = seenAt.get(key);
    if (prev !== undefined && now - prev < ttlMs) return true; // visto hace <ttl → skip
    seenAt.set(key, now);
    // Poda barata de entradas vencidas: evita que el Map crezca sin techo en un
    // lambda de vida larga (borrar durante la iteración de un Map es seguro en JS).
    for (const [k, t] of seenAt) if (now - t >= ttlMs) seenAt.delete(k);
    return false;
  };
}
