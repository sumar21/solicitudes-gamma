/**
 * Microsoft Graph API — client credentials auth helper.
 * Token is cached in module scope (survives warm Vercel invocations).
 */

const TENANT_ID     = process.env.AZURE_TENANT_ID      ?? '';
const CLIENT_ID     = process.env.AZURE_CLIENTE_ID     ?? '';
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET  ?? '';

let _cache: { token: string; exp: number } | null = null;

export async function getGraphToken(): Promise<string> {
  if (_cache && Date.now() < _cache.exp) return _cache.token;

  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope:         'https://graph.microsoft.com/.default',
      }).toString(),
    },
  );

  const data = (await res.json()) as Record<string, unknown>;
  if (!data.access_token) {
    throw new Error(`Graph auth failed: ${JSON.stringify(data)}`);
  }

  const expiresIn = parseInt(String(data.expires_in ?? '3600'), 10);
  _cache = {
    token: String(data.access_token),
    exp:   Date.now() + (expiresIn - 60) * 1000,
  };

  return _cache.token;
}

export async function graphFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getGraphToken();
  return fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// SharePoint/Graph throttlean (429) o devuelven errores transitorios (503/504) bajo
// carga. Estos SÍ conviene reintentar; el resto (4xx de validación) no.
function isTransient(status: number): boolean {
  return status === 429 || status === 503 || status === 504;
}

/**
 * graphFetch con reintento ante throttling/errores transitorios. Honra el header
 * `Retry-After` (segundos) si SharePoint lo manda; si no, backoff exponencial.
 * `init.body` debe ser string (no stream) para poder reusarse entre intentos.
 *
 * Pensado para escrituras (PATCH/POST) dentro de los crons: maximiza que la
 * persistencia salga bien EN LA MISMA corrida —y la notificación se mande al toque—
 * en vez de esperar 15 min al próximo ciclo. Intentos y delays acotados para no
 * pasarnos del maxDuration de la función.
 */
export async function graphFetchRetry(
  path: string,
  init?: RequestInit,
  opts: { retries?: number; baseDelayMs?: number; maxDelayMs?: number } = {},
): Promise<Response> {
  const retries    = opts.retries    ?? 3;
  const baseDelay  = opts.baseDelayMs ?? 400;
  const maxDelay   = opts.maxDelayMs  ?? 8000;

  let res = await graphFetch(path, init);
  for (let attempt = 0; !res.ok && isTransient(res.status) && attempt < retries; attempt++) {
    const retryAfterSec = Number(res.headers.get('Retry-After'));
    const delay = Number.isFinite(retryAfterSec) && retryAfterSec > 0
      ? Math.min(retryAfterSec * 1000, maxDelay)
      : Math.min(baseDelay * 2 ** attempt, maxDelay);
    await sleep(delay);
    res = await graphFetch(path, init);
  }
  return res;
}

/**
 * PATCH masivo vía Microsoft Graph `$batch` (hasta 20 ops por request).
 * Mucho más rápido que PATCH individuales cuando hay cientos de ítems.
 * `itemsBasePath` es relativo a /v1.0, ej. `/sites/{site}/lists/{list}/items`.
 */
export async function graphBatchPatchFields(
  itemsBasePath: string,
  items: { id: string; fields: Record<string, unknown> }[],
): Promise<{ updated: number; failed: number }> {
  let updated = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i += 20) {
    const chunk = items.slice(i, i + 20);
    const requestBody = {
      requests: chunk.map((it, idx) => ({
        id: String(idx),
        method: 'PATCH',
        url: `${itemsBasePath}/${it.id}/fields`,
        headers: { 'Content-Type': 'application/json' },
        body: it.fields,
      })),
    };
    try {
      const res = await graphFetch('/$batch', { method: 'POST', body: JSON.stringify(requestBody) });
      if (!res.ok) { failed += chunk.length; continue; }
      const data = (await res.json()) as { responses?: { status: number }[] };
      for (const r of data.responses ?? []) {
        if (r.status >= 200 && r.status < 300) updated++;
        else failed++;
      }
    } catch {
      failed += chunk.length;
    }
  }
  return { updated, failed };
}

/**
 * DELETE masivo vía Microsoft Graph `$batch` (hasta 20 ops por request).
 * `itemsBasePath` es relativo a /v1.0, ej. `/sites/{site}/lists/{list}/items`.
 * Un 404 se cuenta como borrado (la fila ya no existía → idempotente).
 */
export async function graphBatchDelete(
  itemsBasePath: string,
  ids: string[],
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    const requestBody = {
      requests: chunk.map((id, idx) => ({
        id: String(idx),
        method: 'DELETE',
        url: `${itemsBasePath}/${id}`,
      })),
    };
    try {
      const res = await graphFetch('/$batch', { method: 'POST', body: JSON.stringify(requestBody) });
      if (!res.ok) { failed += chunk.length; continue; }
      const data = (await res.json()) as { responses?: { status: number }[] };
      for (const r of data.responses ?? []) {
        if ((r.status >= 200 && r.status < 300) || r.status === 404) deleted++;
        else failed++;
      }
    } catch {
      failed += chunk.length;
    }
  }
  return { deleted, failed };
}
