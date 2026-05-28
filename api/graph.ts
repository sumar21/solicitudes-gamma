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
