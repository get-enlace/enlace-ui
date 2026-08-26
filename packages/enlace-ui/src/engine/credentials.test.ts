import { afterEach, describe, expect, it, vi } from 'vitest';
import { __clearCredentialTokenCacheForTests, resolveCredentialInjection } from './credentials.js';
import type { Credential } from '../types.js';

function mockResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

describe('resolveCredentialInjection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __clearCredentialTokenCacheForTests();
  });

  it('resolves bearer to an Authorization header', async () => {
    const credential: Credential = { id: 'c1', name: 'Test', type: 'bearer', token: 'secret-token' };
    expect(await resolveCredentialInjection(credential)).toEqual({
      headers: { Authorization: 'Bearer secret-token' },
    });
  });

  it('resolves basic to a base64-encoded Authorization header', async () => {
    const credential: Credential = { id: 'c1', name: 'Test', type: 'basic', username: 'alice', password: 'hunter2' };
    expect(await resolveCredentialInjection(credential)).toEqual({
      headers: { Authorization: `Basic ${btoa('alice:hunter2')}` },
    });
  });

  it('resolves apiKey to a header when in="header"', async () => {
    const credential: Credential = {
      id: 'c1',
      name: 'Test',
      type: 'apiKey',
      paramName: 'X-API-Key',
      in: 'header',
      key: 'secret-key',
    };
    expect(await resolveCredentialInjection(credential)).toEqual({ headers: { 'X-API-Key': 'secret-key' } });
  });

  it('resolves apiKey to a query param when in="query"', async () => {
    const credential: Credential = {
      id: 'c1',
      name: 'Test',
      type: 'apiKey',
      paramName: 'apiKey',
      in: 'query',
      key: 'secret-key',
    };
    expect(await resolveCredentialInjection(credential)).toEqual({ query: { apiKey: 'secret-key' } });
  });

  it('POSTs the client-credentials grant to tokenUrl and returns a Bearer header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { access_token: 'issued-token', expires_in: 60 }));
    vi.stubGlobal('fetch', fetchMock);

    const credential: Credential = {
      id: 'c1',
      name: 'Test',
      type: 'oauth2_clientCredentials',
      tokenUrl: 'http://auth.test/token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scope: 'read write',
    };

    expect(await resolveCredentialInjection(credential)).toEqual({ headers: { Authorization: 'Bearer issued-token' } });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://auth.test/token');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(init.body);
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('client-id');
    expect(body.get('client_secret')).toBe('client-secret');
    expect(body.get('scope')).toBe('read write');
  });

  it('reuses a cached token instead of re-fetching while it is still valid', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { access_token: 'issued-token', expires_in: 3600 }));
    vi.stubGlobal('fetch', fetchMock);

    const credential: Credential = {
      id: 'c1',
      name: 'Test',
      type: 'oauth2_clientCredentials',
      tokenUrl: 'http://auth.test/token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    };

    await resolveCredentialInjection(credential);
    await resolveCredentialInjection(credential);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches once a cached token is within the expiry buffer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { access_token: 'issued-token', expires_in: 10 }));
    vi.stubGlobal('fetch', fetchMock);

    const credential: Credential = {
      id: 'c1',
      name: 'Test',
      type: 'oauth2_clientCredentials',
      tokenUrl: 'http://auth.test/token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    };

    // expires_in: 10s is inside the 30s expiry buffer, so every call should refetch.
    await resolveCredentialInjection(credential);
    await resolveCredentialInjection(credential);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws when the token endpoint responds with a non-2xx status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(401, {}));
    vi.stubGlobal('fetch', fetchMock);

    const credential: Credential = {
      id: 'c1',
      name: 'Test',
      type: 'oauth2_clientCredentials',
      tokenUrl: 'http://auth.test/token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    };

    await expect(resolveCredentialInjection(credential)).rejects.toThrow(/failed with status 401/);
  });

  it('throws when the token response has no access_token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const credential: Credential = {
      id: 'c1',
      name: 'Test',
      type: 'oauth2_clientCredentials',
      tokenUrl: 'http://auth.test/token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    };

    await expect(resolveCredentialInjection(credential)).rejects.toThrow(/had no access_token/);
  });

  it('POSTs the password grant to tokenUrl, including optional client_id/client_secret/scope when present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { access_token: 'issued-token', expires_in: 60 }));
    vi.stubGlobal('fetch', fetchMock);

    const credential: Credential = {
      id: 'c1',
      name: 'Test',
      type: 'oauth2_password',
      tokenUrl: 'http://auth.test/token',
      username: 'alice',
      password: 'hunter2',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scope: 'read write',
    };

    expect(await resolveCredentialInjection(credential)).toEqual({ headers: { Authorization: 'Bearer issued-token' } });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://auth.test/token');
    const body = new URLSearchParams(init.body);
    expect(body.get('grant_type')).toBe('password');
    expect(body.get('username')).toBe('alice');
    expect(body.get('password')).toBe('hunter2');
    expect(body.get('client_id')).toBe('client-id');
    expect(body.get('client_secret')).toBe('client-secret');
    expect(body.get('scope')).toBe('read write');
  });

  it('omits client_id/client_secret/scope from the password-grant body when not provided (public-client token endpoints)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { access_token: 'issued-token' }));
    vi.stubGlobal('fetch', fetchMock);

    const credential: Credential = {
      id: 'c1',
      name: 'Test',
      type: 'oauth2_password',
      tokenUrl: 'http://auth.test/token',
      username: 'alice',
      password: 'hunter2',
    };

    await resolveCredentialInjection(credential);

    const [, init] = fetchMock.mock.calls[0];
    const body = new URLSearchParams(init.body);
    expect(body.has('client_id')).toBe(false);
    expect(body.has('client_secret')).toBe(false);
    expect(body.has('scope')).toBe(false);
  });

  it('shares the token cache keyed by credential id between grant types (no cross-type collision, no re-fetch while valid)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { access_token: 'issued-token', expires_in: 3600 }));
    vi.stubGlobal('fetch', fetchMock);

    const credential: Credential = {
      id: 'c1',
      name: 'Test',
      type: 'oauth2_password',
      tokenUrl: 'http://auth.test/token',
      username: 'alice',
      password: 'hunter2',
    };

    await resolveCredentialInjection(credential);
    await resolveCredentialInjection(credential);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves popup_login to credentials: "include", with no headers or query params at all', async () => {
    const credential: Credential = {
      id: 'c1',
      name: 'Test',
      type: 'popup_login',
      loginUrl: 'https://app.example.com/auth/github',
    };
    expect(await resolveCredentialInjection(credential)).toEqual({ credentials: 'include' });
  });
});
