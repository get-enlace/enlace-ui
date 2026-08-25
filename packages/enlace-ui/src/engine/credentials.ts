import type { Credential, OAuth2ClientCredentialsCredential } from '../types.js';

export interface CredentialInjection {
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

/** btoa() alone mangles non-ASCII input; this is MDN's own recommended round-trip for UTF-8-safe base64. */
function toBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

// Module-level, browser-memory-only (per auth-strategy.md's "never
// persisted" principle — this resets on page reload same as everything
// else). Keyed by credential id so every node sharing one
// oauth2_clientCredentials credential, across one run or many, reuses the
// same token instead of re-hitting the token endpoint per node.
const tokenCache = new Map<string, CachedToken>();

// A level's nodes all fire concurrently (see chainExecutor.ts's Promise.all
// over a level) — if two of them share one oauth2_clientCredentials
// credential, both can call in before either has written tokenCache,
// otherwise racing each other into two token-endpoint requests. Tracking
// the in-flight request per credential id lets the second caller await the
// first's result instead of starting its own.
const inFlightRequests = new Map<string, Promise<string>>();

// Refetch this much before actual expiry so a token doesn't go stale
// mid-chain between when it's resolved and when the last node using it fires.
const EXPIRY_BUFFER_MS = 30_000;
const DEFAULT_TOKEN_TTL_SECONDS = 300;

async function fetchClientCredentialsToken(credential: OAuth2ClientCredentialsCredential): Promise<string> {
  const cached = tokenCache.get(credential.id);
  if (cached && cached.expiresAt > Date.now() + EXPIRY_BUFFER_MS) {
    return cached.accessToken;
  }

  const inFlight = inFlightRequests.get(credential.id);
  if (inFlight) return inFlight;

  const request = (async () => {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credential.clientId,
      client_secret: credential.clientSecret,
    });
    if (credential.scope) body.set('scope', credential.scope);

    // Direct browser -> auth server call — same "browser talks straight to
    // the target" relationship as the actual API request (ARCHITECTURE.md
    // §2), no adapter round-trip. The secret never touches enlace-ui's own
    // server side because there isn't one.
    const res = await fetch(credential.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      throw new Error(
        `OAuth2 client-credentials token request to ${credential.tokenUrl} failed with status ${res.status}`
      );
    }

    const json = await res.json().catch(() => null);
    if (!json?.access_token) {
      throw new Error(`OAuth2 client-credentials token response from ${credential.tokenUrl} had no access_token`);
    }

    const expiresInSeconds = typeof json.expires_in === 'number' ? json.expires_in : DEFAULT_TOKEN_TTL_SECONDS;
    tokenCache.set(credential.id, {
      accessToken: json.access_token,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    });

    return json.access_token as string;
  })();

  // Cleared once settled (success or failure) so the next call — after
  // expiry, or retrying past a failure — starts a fresh request rather than
  // replaying this one forever. Caught separately (not chained onto the
  // `request` returned below) so a rejection here doesn't become a second,
  // unhandled rejection alongside the one the actual caller awaits.
  inFlightRequests.set(credential.id, request);
  request.finally(() => inFlightRequests.delete(credential.id)).catch(() => {});

  return request;
}

/**
 * Resolves a credential into what to inject on the actual request — a
 * header (bearer/basic/apiKey-in-header/oauth2) or a query param
 * (apiKey-in-query). Async because oauth2_clientCredentials may need a
 * live token-endpoint round-trip (cached after the first — see above);
 * every other type resolves synchronously in practice but still returns a
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
      const accessToken = await fetchClientCredentialsToken(credential);
      return { headers: { Authorization: `Bearer ${accessToken}` } };
    }
  }
}

/** Test-only: this module's caches are module-level state that otherwise leaks between test cases. */
export function __clearCredentialTokenCacheForTests() {
  tokenCache.clear();
  inFlightRequests.clear();
}
