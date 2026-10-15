export interface OAuthTokenResponse {
  token_type: string;
  expires_in: number;
  ext_expires_in: number;
  access_token: string;
}

type CachedToken = {
  accessToken: string;
  expiresAt: number;
  payload: OAuthTokenResponse;
};

let cachedToken: CachedToken | null = null;

function getOAuthConfig() {
  const tenantId = process.env.API_8BIT_MS_TENANT_ID || process.env.NEXT_PUBLIC_MS_TENANT_ID;
  const clientId = process.env.API_8BIT_MS_CLIENT_ID || process.env.NEXT_PUBLIC_MS_CLIENT_ID;
  const clientSecret = process.env.API_8BIT_MS_CLIENT_SECRET || process.env.MS_CLIENT_SECRET;
  const scope = process.env.API_8BIT_MS_SCOPE || process.env.MS_OAUTH_SCOPE;

  if (!tenantId || !clientId || !clientSecret || !scope) {
    throw new Error(
      'Missing Microsoft OAuth configuration. Required: API_8BIT_MS_TENANT_ID or NEXT_PUBLIC_MS_TENANT_ID, API_8BIT_MS_CLIENT_ID, API_8BIT_MS_CLIENT_SECRET, and API_8BIT_MS_SCOPE or MS_OAUTH_SCOPE.'
    );
  }

  return { tenantId, clientId, clientSecret, scope };
}

export async function getMicrosoftOAuthToken(forceRefresh = false): Promise<OAuthTokenResponse> {
  const now = Date.now();

  if (!forceRefresh && cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.payload;
  }

  const { tenantId, clientId, clientSecret, scope } = getOAuthConfig();
  const tokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const payload = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload.toString(),
    cache: 'no-store',
  });

  const rawData = (await response.json().catch(() => null)) as
    | (Partial<OAuthTokenResponse> & { error?: string; error_description?: string })
    | null;

  if (!response.ok || !rawData?.access_token) {
    throw new Error(
      rawData?.error_description || rawData?.error || 'Microsoft OAuth token request failed.'
    );
  }

  const tokenResponse: OAuthTokenResponse = {
    token_type: rawData.token_type || 'Bearer',
    expires_in: typeof rawData.expires_in === 'number' ? rawData.expires_in : 3599,
    ext_expires_in:
      typeof rawData.ext_expires_in === 'number'
        ? rawData.ext_expires_in
        : typeof rawData.expires_in === 'number'
          ? rawData.expires_in
          : 3599,
    access_token: rawData.access_token,
  };

  cachedToken = {
    accessToken: tokenResponse.access_token,
    expiresAt: now + tokenResponse.expires_in * 1000,
    payload: tokenResponse,
  };

  return tokenResponse;
}
