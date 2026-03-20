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
