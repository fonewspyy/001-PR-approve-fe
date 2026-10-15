import { cookies } from "next/headers";

/**
 * Microsoft Entra ID (Azure AD) authorization-code + PKCE sign-in.
 *
 * This obtains a *user* (delegated) token for the 8Bit API — the identity the
 * user actually signed in as — instead of the app-only client_credentials token
 * in `lib/auth/oauth.ts`. See the auth-user-token migration plan.
 */

export interface AuthTokenResponse {
  token_type: string;
  scope?: string;
  expires_in: number;
  ext_expires_in?: number;
  access_token: string;
  refresh_token?: string;
  id_token?: string;
}

// httpOnly session cookies set after a successful callback.
export const ACCESS_TOKEN_COOKIE = "ms_access_token";
export const REFRESH_TOKEN_COOKIE = "ms_refresh_token";
export const EXPIRES_AT_COOKIE = "ms_expires_at";

// Short-lived cookies that carry PKCE/state across the redirect to Microsoft.
const PKCE_VERIFIER_COOKIE = "ms_pkce_verifier";
const STATE_COOKIE = "ms_oauth_state";
const RETURN_TO_COOKIE = "ms_return_to";

const TRANSIENT_MAX_AGE = 600; // 10 minutes to complete the login round-trip.

export function getAuthConfig() {
  const tenantId = process.env.NEXT_PUBLIC_MS_TENANT_ID;
  const clientId = process.env.NEXT_PUBLIC_MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  // Delegated scope for the 8Bit API. `.default` works with statically
  // configured (admin-consented) delegated permissions and cannot be combined
  // with other scopes. offline_access (for a refresh token) and openid/profile
  // must be granted as delegated permissions on the app registration.
  const scope = process.env.MS_LOGIN_SCOPE || process.env.MS_OAUTH_SCOPE;

  if (!tenantId || !clientId || !clientSecret || !scope) {
    throw new Error(
      "Missing Microsoft OAuth configuration. Required: NEXT_PUBLIC_MS_TENANT_ID, NEXT_PUBLIC_MS_CLIENT_ID, MS_CLIENT_SECRET, and MS_LOGIN_SCOPE or MS_OAUTH_SCOPE."
    );
  }

  return { tenantId, clientId, clientSecret, scope };
}

export function getRedirectUri(request: Request) {
  if (process.env.MS_REDIRECT_URI) return process.env.MS_REDIRECT_URI;
  const url = new URL(request.url);
  // Honor a reverse proxy if one is in front of the app.
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(/:$/, "");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  return `${proto}://${host}/api/auth/callback`;
}

function authorityBase(tenantId: string) {
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0`;
}

// ---- PKCE helpers (Web Crypto, available in the Node/Edge runtime) ----

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (const b of arr) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomUrlSafe(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function sha256(input: string) {
  const data = new TextEncoder().encode(input);
  return crypto.subtle.digest("SHA-256", data);
}

/**
 * Build the Microsoft authorize URL and stash the PKCE verifier + state in
 * transient httpOnly cookies so the callback can validate the round-trip.
 */
export async function beginLogin(request: Request, returnTo: string) {
  const { tenantId, clientId, scope } = getAuthConfig();
  const redirectUri = getRedirectUri(request);

  const verifier = randomUrlSafe(48);
  const challenge = base64UrlEncode(await sha256(verifier));
  const state = randomUrlSafe(24);

  const cookieStore = await cookies();
  const secure = new URL(redirectUri).protocol === "https:";
  const transient = {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: TRANSIENT_MAX_AGE,
  };
  cookieStore.set(PKCE_VERIFIER_COOKIE, verifier, transient);
  cookieStore.set(STATE_COOKIE, state, transient);
  cookieStore.set(RETURN_TO_COOKIE, returnTo, transient);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  return `${authorityBase(tenantId)}/authorize?${params.toString()}`;
}

export interface CallbackResult {
  tokens: AuthTokenResponse;
  returnTo: string;
}

/**
 * Validate the callback, exchange the authorization code for tokens, and clear
 * the transient cookies. Throws on any mismatch or token error.
 */
export async function completeLogin(request: Request): Promise<CallbackResult> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    throw new Error(errorDescription || error);
  }

  const cookieStore = await cookies();
  const verifier = cookieStore.get(PKCE_VERIFIER_COOKIE)?.value;
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  const returnTo = cookieStore.get(RETURN_TO_COOKIE)?.value || "/";

  // Clear transient cookies regardless of outcome.
  cookieStore.delete(PKCE_VERIFIER_COOKIE);
  cookieStore.delete(STATE_COOKIE);
  cookieStore.delete(RETURN_TO_COOKIE);

  if (!code) throw new Error("Authorization code missing from callback.");
  if (!verifier) throw new Error("Login session expired. Please sign in again.");
  if (!returnedState || returnedState !== expectedState) {
    throw new Error("OAuth state mismatch. Possible CSRF — please sign in again.");
  }

  const { tenantId, clientId, clientSecret, scope } = getAuthConfig();
  const redirectUri = getRedirectUri(request);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    scope,
  });

  const response = await fetch(`${authorityBase(tenantId)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });

  const raw = (await response.json().catch(() => null)) as
    | (Partial<AuthTokenResponse> & { error?: string; error_description?: string })
    | null;

  if (!response.ok || !raw?.access_token) {
    throw new Error(raw?.error_description || raw?.error || "Token exchange failed.");
  }

  return {
    tokens: {
      token_type: raw.token_type || "Bearer",
      scope: raw.scope,
      expires_in: typeof raw.expires_in === "number" ? raw.expires_in : 3599,
      ext_expires_in: raw.ext_expires_in,
      access_token: raw.access_token,
      refresh_token: raw.refresh_token,
      id_token: raw.id_token,
    },
    returnTo,
  };
}

/** Persist the user tokens in httpOnly cookies after a successful callback. */
export async function storeSession(request: Request, tokens: AuthTokenResponse) {
  const cookieStore = await cookies();
  const secure = new URL(getRedirectUri(request)).protocol === "https:";
  const base = { httpOnly: true, secure, sameSite: "lax" as const, path: "/" };
  const expiresAt = Date.now() + tokens.expires_in * 1000;

  cookieStore.set(ACCESS_TOKEN_COOKIE, tokens.access_token, {
    ...base,
    maxAge: tokens.expires_in,
  });
  cookieStore.set(EXPIRES_AT_COOKIE, String(expiresAt), {
    ...base,
    maxAge: tokens.expires_in,
  });
  if (tokens.refresh_token) {
    // Refresh tokens live far longer than the access token.
    cookieStore.set(REFRESH_TOKEN_COOKIE, tokens.refresh_token, {
      ...base,
      maxAge: 60 * 60 * 24 * 14,
    });
  }
}
