// Real end-to-end coverage of the auth enforcement wired into
// examples/sample-api (see auth.ts, mockOAuth2.ts, and each resource
// router) — proves each of the six credential types Enlace's Credentials
// drawer supports is genuinely checked over real HTTP, not just unit-level
// middleware logic. The two OAuth2 types fetch an actual token from the
// real (mock) issuer helpers.ts starts alongside the app, then send it — a
// real signature verification happens on the other end, not a stub. The
// cookie type (see the last describe block) has no token/header to fetch
// at all — its "login" is GET /auth/demo-login setting a cookie directly.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { E2E_BASE_URL, E2E_OAUTH2_ISSUER_URL, startTestServer, stopTestServer } from './helpers.js';

beforeAll(startTestServer);
afterAll(stopTestServer);

async function fetchOAuth2Token(params: Record<string, string>): Promise<string> {
  const res = await fetch(`${E2E_OAUTH2_ISSUER_URL}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

describe('POST /customers — requires Basic auth', () => {
  it('401s with no credential', async () => {
    const res = await fetch(`${E2E_BASE_URL}/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' }),
    });
    expect(res.status).toBe(401);
  });

  // Basic auth here is presence-checked only, per openapi.json's own
  // description — not verified against a real user store — so any
  // well-formed value succeeds.
  it('succeeds with any Basic credential', async () => {
    const res = await fetch(`${E2E_BASE_URL}/customers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from('anyone:anything').toString('base64')}`,
      },
      body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' }),
    });
    expect(res.status).toBe(201);
  });
});

describe('PATCH/DELETE /customers/{id} — requires a Bearer token', () => {
  it('401s with no credential', async () => {
    const res = await fetch(`${E2E_BASE_URL}/customers/does-not-matter`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'verified' }),
    });
    expect(res.status).toBe(401);
  });

  it('gets past auth with any bearer token — 404 (not 401) proves auth ran and passed before the not-found check', async () => {
    const res = await fetch(`${E2E_BASE_URL}/customers/does-not-exist`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer anything' },
      body: JSON.stringify({ status: 'verified' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /orders — requires an X-API-Key header', () => {
  it('401s with no credential', async () => {
    const res = await fetch(`${E2E_BASE_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('gets past auth with any X-API-Key value — 400 (not 401) proves auth ran and passed before body validation', async () => {
    const res = await fetch(`${E2E_BASE_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'any-value' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /products — requires a real OAuth2 password-grant token ("only an admin can manage the catalog")', () => {
  it('401s with no credential', async () => {
    const res = await fetch(`${E2E_BASE_URL}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Widget', price: 9.99 }),
    });
    expect(res.status).toBe(401);
  });

  it('401s with a bearer token that was not signed by the mock issuer', async () => {
    const res = await fetch(`${E2E_BASE_URL}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-a-real-token' },
      body: JSON.stringify({ name: 'Widget', price: 9.99 }),
    });
    expect(res.status).toBe(401);
  });

  it('succeeds with a real token fetched via the password grant — any username/password accepted at the token endpoint', async () => {
    const token = await fetchOAuth2Token({ grant_type: 'password', username: 'admin', password: 'anything' });
    const res = await fetch(`${E2E_BASE_URL}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Widget', price: 9.99 }),
    });
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ name: 'Widget', price: 9.99 });
  });
});

describe('DELETE /orders/{id} — requires a real OAuth2 client-credentials token (automated cleanup job, no human login)', () => {
  it('401s with no credential', async () => {
    const res = await fetch(`${E2E_BASE_URL}/orders/does-not-matter`, { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('gets past auth with a real client-credentials token — 404 (not 401) proves auth ran and passed before the not-found check', async () => {
    const token = await fetchOAuth2Token({
      grant_type: 'client_credentials',
      client_id: 'cleanup-job',
      client_secret: 'anything',
    });
    const res = await fetch(`${E2E_BASE_URL}/orders/does-not-exist`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  // The whole point of requireOAuth2Token being grant-agnostic (see
  // auth.ts): a token from the *other* oauth2-protected flow is still
  // just a valid token from our issuer, so it works here too.
  it('also accepts a token obtained via the password grant — the middleware checks token validity, not which grant produced it', async () => {
    const token = await fetchOAuth2Token({ grant_type: 'password', username: 'someone', password: 'anything' });
    const res = await fetch(`${E2E_BASE_URL}/orders/does-not-exist`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /orders/{id} — requires a session cookie (independent login, not driven by Enlace)', () => {
  it('401s with no cookie', async () => {
    const res = await fetch(`${E2E_BASE_URL}/orders/does-not-matter`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'shipped' }),
    });
    expect(res.status).toBe(401);
  });

  // Node's fetch has no automatic cookie jar the way a browser does — a
  // real browser attaches this via `credentials: 'include'` (see
  // chainExecutor.ts) with no manual step at all; this test just has to
  // do by hand what the browser does invisibly.
  it('gets past auth once the demo-login cookie is set — 404 (not 401) proves auth ran and passed before the not-found check', async () => {
    const loginRes = await fetch(`${E2E_BASE_URL}/auth/demo-login`);
    const setCookie = loginRes.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    const cookie = setCookie!.split(';')[0];

    const res = await fetch(`${E2E_BASE_URL}/orders/does-not-exist`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'shipped' }),
    });
    expect(res.status).toBe(404);
  });
});
