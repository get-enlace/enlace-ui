import type { Credential } from '../types.js';

export interface CredentialInjection {
  headers?: Record<string, string>;
  query?: Record<string, string>;
  /**
   * Set to `'include'` for a `popup_login`/`cookie` credential — tells
   * chainExecutor.ts's actual `fetch()` call to send the browser's cookies
   * along. This is the *only* mechanism that ever attaches a cookie:
   * `Cookie` is a forbidden fetch() request header (per the Fetch spec —
   * every browser silently drops it if JS tries to set it), so no
   * credential type can inject one via `headers` the way every other type
   * injects an Authorization/apiKey value. Whether this actually works
   * depends entirely on the target's own CORS policy allowing credentialed
   * requests from Enlace's origin — same "not Enlace's to solve" stance as
   * CORS generally.
   */
  credentials?: 'include';
}

/** btoa() alone mangles non-ASCII input; this is MDN's own recommended round-trip for UTF-8-safe base64. */
function toBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

// Module-level, browser-memory-only — never persisted, so this resets on
// page reload same as everything else. Keyed by credential id so every node sharing one oauth2
// credential (client-credentials or password grant), across one run or
// many, reuses the same token instead of re-hitting the token endpoint
// per node. A credential id is unique across every type, so one shared
// map for both grants is safe — there's no cross-grant collision risk.
const tokenCache = new Map<string, CachedToken>();

// A level's nodes all fire concurrently (see chainExecutor.ts's Promise.all
// over a level) — if two of them share one oauth2 credential, both can
// call in before either has written tokenCache, otherwise racing each
// other into two token-endpoint requests. Tracking the in-flight request
// per credential id lets the second caller await the first's result
// instead of starting its own.
const inFlightRequests = new Map<string, Promise<string>>();

// Refetch this much before actual expiry so a token doesn't go stale
// mid-chain between when it's resolved and when the last node using it fires.
const EXPIRY_BUFFER_MS = 30_000;
const DEFAULT_TOKEN_TTL_SECONDS = 300;

/** POSTs a `grant_type`-agnostic token request — the two grants below only differ in which params they put in `params`. */
async function requestOAuth2Token(
  tokenUrl: string,
  params: Record<string, string>
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  // Direct browser -> auth server call — same "browser talks straight to
  // the target" relationship as the actual API request, no adapter
  // round-trip. The secret never touches enlace-ui's own server side
  // because there isn't one.
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });

  if (!res.ok) {
    throw new Error(`OAuth2 token request to ${tokenUrl} failed with status ${res.status}`);
  }

  const json = await res.json().catch(() => null);
  if (!json?.access_token) {
    throw new Error(`OAuth2 token response from ${tokenUrl} had no access_token`);
  }

  const expiresInSeconds = typeof json.expires_in === 'number' ? json.expires_in : DEFAULT_TOKEN_TTL_SECONDS;
  return { accessToken: json.access_token, expiresInSeconds };
}

/** Cache + in-flight-dedup wrapper shared by both oauth2 grants — see the module-level maps above for why. */
async function fetchCachedOAuth2Token(
  credentialId: string,
  tokenUrl: string,
  params: Record<string, string>
): Promise<string> {
  const cached = tokenCache.get(credentialId);
  if (cached && cached.expiresAt > Date.now() + EXPIRY_BUFFER_MS) {
    return cached.accessToken;
  }

  const inFlight = inFlightRequests.get(credentialId);
  if (inFlight) return inFlight;

  const request = (async () => {
    const { accessToken, expiresInSeconds } = await requestOAuth2Token(tokenUrl, params);
    tokenCache.set(credentialId, { accessToken, expiresAt: Date.now() + expiresInSeconds * 1000 });
    return accessToken;
  })();

  // Cleared once settled (success or failure) so the next call — after
  // expiry, or retrying past a failure — starts a fresh request rather than
  // replaying this one forever. Caught separately (not chained onto the
  // `request` returned below) so a rejection here doesn't become a second,
  // unhandled rejection alongside the one the actual caller awaits.
  inFlightRequests.set(credentialId, request);
  request.finally(() => inFlightRequests.delete(credentialId)).catch(() => {});

  return request;
}

/**
 * Resolves a credential into what to inject on the actual request — a
 * header (bearer/basic/apiKey-in-header/oauth2), a query param
 * (apiKey-in-query), or (uniquely for popup_login) a `credentials:
 * 'include'` fetch option instead of any injected value at all — see
 * CredentialInjection's own comment on why a cookie can never be injected
 * as a header. Async because the oauth2 types may need a live
 * token-endpoint round-trip (cached after the first — see above); every
 * other type resolves synchronously in practice but still returns a
 * Promise so chainExecutor.ts has one uniform call site.
 */
export async function resolveCredentialInjection(credential: Credential): Promise<CredentialInjection> {
  switch (credential.type) {
    case 'bearer':
      return { headers: { Authorization: `Bearer ${credential.token}` } };
    case 'basic':
      return { headers: { Authorization: `Basic ${toBase64(`${credential.username}:${credential.password}`)}` } };
    case 'apiKey':
      return credential.in === 'query'
        ? { query: { [credential.paramName]: credential.key } }
        : { headers: { [credential.paramName]: credential.key } };
    case 'oauth2_clientCredentials': {
      const params: Record<string, string> = {
        grant_type: 'client_credentials',
        client_id: credential.clientId,
        client_secret: credential.clientSecret,
      };
      if (credential.scope) params.scope = credential.scope;
      const accessToken = await fetchCachedOAuth2Token(credential.id, credential.tokenUrl, params);
      return { headers: { Authorization: `Bearer ${accessToken}` } };
    }
    case 'oauth2_password': {
      // client_id/client_secret are optional per RFC 6749 §4.3 — plenty of
      // token endpoints accept a public client with neither.
      const params: Record<string, string> = {
        grant_type: 'password',
        username: credential.username,
        password: credential.password,
      };
      if (credential.clientId) params.client_id = credential.clientId;
      if (credential.clientSecret) params.client_secret = credential.clientSecret;
      if (credential.scope) params.scope = credential.scope;
      const accessToken = await fetchCachedOAuth2Token(credential.id, credential.tokenUrl, params);
      return { headers: { Authorization: `Bearer ${accessToken}` } };
    }
    case 'popup_login':
      // No injection at all — the one Credential variant that doesn't
      // actually hold a value to attach. This just flips a fetch option
      // so the browser's own cookie jar (already populated by whatever
      // login the user completed in the popup) tags along on its own.
      // See PopupLoginCredential's own comment in types.ts for the fuller
      // "action, not a credential" framing, and for why a "paste in a
      // token instead" variant was designed, built, and then dropped.
      return { credentials: 'include' };
  }
}

/** Test-only: this module's caches are module-level state that otherwise leaks between test cases. */
export function __clearCredentialTokenCacheForTests() {
  tokenCache.clear();
  inFlightRequests.clear();
}
