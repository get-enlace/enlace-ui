import { describe, expect, it } from 'vitest';
import { extractDeclaredCredentials, securitySchemeCredentialType } from './securitySchemes.js';

function specWithSchemes(securitySchemes: Record<string, any>) {
  return { openapi: '3.0.3', paths: {}, components: { securitySchemes } };
}

describe('extractDeclaredCredentials', () => {
  it('returns an empty list when the spec declares no securitySchemes', () => {
    expect(extractDeclaredCredentials({ paths: {} })).toEqual([]);
    expect(extractDeclaredCredentials(specWithSchemes({}))).toEqual([]);
  });

  it('maps an http/bearer scheme to a bearer template', () => {
    const spec = specWithSchemes({ bearerAuth: { type: 'http', scheme: 'bearer', description: 'JWT auth' } });
    const declared = extractDeclaredCredentials(spec);

    expect(declared).toEqual([
      {
        schemeName: 'bearerAuth',
        description: 'JWT auth',
        template: { name: 'bearerAuth', type: 'bearer', token: '', fromSecurityScheme: 'bearerAuth' },
      },
    ]);
  });

  it('maps an http/basic scheme to a basic template', () => {
    const spec = specWithSchemes({ basicAuth: { type: 'http', scheme: 'basic' } });
    const [entry] = extractDeclaredCredentials(spec);

    expect(entry.template).toEqual({
      name: 'basicAuth',
      type: 'basic',
      username: '',
      password: '',
      fromSecurityScheme: 'basicAuth',
    });
  });

  it('maps an apiKey/header scheme to an apiKey template, carrying the header name', () => {
    const spec = specWithSchemes({ apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' } });
    const [entry] = extractDeclaredCredentials(spec);

    expect(entry.template).toEqual({
      name: 'apiKeyAuth',
      type: 'apiKey',
      paramName: 'X-API-Key',
      in: 'header',
      key: '',
      fromSecurityScheme: 'apiKeyAuth',
    });
  });

  it('maps an apiKey/query scheme the same way, with in: "query"', () => {
    const spec = specWithSchemes({ apiKeyAuth: { type: 'apiKey', in: 'query', name: 'api_key' } });
    const [entry] = extractDeclaredCredentials(spec);
    expect(entry.template).toMatchObject({ type: 'apiKey', paramName: 'api_key', in: 'query' });
  });

  it('maps an apiKey/cookie scheme to a cookie template, with loginUrl left blank for the user to supply', () => {
    const spec = specWithSchemes({ cookieAuth: { type: 'apiKey', in: 'cookie', name: 'session' } });
    const [entry] = extractDeclaredCredentials(spec);

    expect(entry.template).toEqual({
      name: 'cookieAuth',
      type: 'cookie',
      loginUrl: '',
      fromSecurityScheme: 'cookieAuth',
    });
  });

  it('maps an oauth2 clientCredentials flow, joining scopes into a space-separated string', () => {
    const spec = specWithSchemes({
      oauth2ClientCreds: {
        type: 'oauth2',
        flows: {
          clientCredentials: {
            tokenUrl: 'https://auth.example.com/token',
            scopes: { read: 'Read access', write: 'Write access' },
          },
        },
      },
    });
    const [entry] = extractDeclaredCredentials(spec);

    expect(entry.template).toEqual({
      name: 'oauth2ClientCreds',
      type: 'oauth2_clientCredentials',
      tokenUrl: 'https://auth.example.com/token',
      clientId: '',
      clientSecret: '',
      scope: 'read write',
      clientAuthMethod: 'basic',
      fromSecurityScheme: 'oauth2ClientCreds',
    });
  });

  it('maps an oauth2 password flow', () => {
    const spec = specWithSchemes({
      oauth2Password: {
        type: 'oauth2',
        flows: { password: { tokenUrl: 'https://auth.example.com/token', scopes: {} } },
      },
    });
    const [entry] = extractDeclaredCredentials(spec);

    expect(entry.template).toEqual({
      name: 'oauth2Password',
      type: 'oauth2_password',
      tokenUrl: 'https://auth.example.com/token',
      username: '',
      password: '',
      clientId: '',
      clientSecret: '',
      scope: '',
      clientAuthMethod: 'basic',
      fromSecurityScheme: 'oauth2Password',
    });
  });

  it('prefers clientCredentials over password when a scheme declares both flows', () => {
    const spec = specWithSchemes({
      oauth2Both: {
        type: 'oauth2',
        flows: {
          clientCredentials: { tokenUrl: 'https://auth.example.com/cc-token' },
          password: { tokenUrl: 'https://auth.example.com/pw-token' },
        },
      },
    });
    const [entry] = extractDeclaredCredentials(spec);
    expect(entry.template.type).toBe('oauth2_clientCredentials');
  });

  it('skips an oauth2 scheme with only authorizationCode/implicit flows — no non-interactive pre-fill possible', () => {
    const spec = specWithSchemes({
      oauth2AuthCode: {
        type: 'oauth2',
        flows: { authorizationCode: { authorizationUrl: 'https://auth.example.com/authorize', tokenUrl: 'https://auth.example.com/token' } },
      },
    });
    expect(extractDeclaredCredentials(spec)).toEqual([]);
  });

  it('skips an unsupported scheme type (openIdConnect)', () => {
    const spec = specWithSchemes({ oidc: { type: 'openIdConnect', openIdConnectUrl: 'https://auth.example.com/.well-known' } });
    expect(extractDeclaredCredentials(spec)).toEqual([]);
  });

  it('extracts one entry per declared scheme, skipping unsupported ones in the mix', () => {
    const spec = specWithSchemes({
      bearerAuth: { type: 'http', scheme: 'bearer' },
      oidc: { type: 'openIdConnect', openIdConnectUrl: 'https://auth.example.com/.well-known' },
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    });
    const declared = extractDeclaredCredentials(spec);
    expect(declared.map((s) => s.schemeName).sort()).toEqual(['apiKeyAuth', 'bearerAuth']);
  });
});

describe('securitySchemeCredentialType', () => {
  it('maps every supported scheme shape to its CredentialType', () => {
    expect(securitySchemeCredentialType({ type: 'http', scheme: 'bearer' })).toBe('bearer');
    expect(securitySchemeCredentialType({ type: 'http', scheme: 'basic' })).toBe('basic');
    expect(securitySchemeCredentialType({ type: 'apiKey', in: 'header', name: 'X-API-Key' })).toBe('apiKey');
    expect(securitySchemeCredentialType({ type: 'apiKey', in: 'query', name: 'api_key' })).toBe('apiKey');
    expect(securitySchemeCredentialType({ type: 'apiKey', in: 'cookie', name: 'session' })).toBe('cookie');
    expect(securitySchemeCredentialType({ type: 'oauth2', flows: { clientCredentials: {} } })).toBe(
      'oauth2_clientCredentials'
    );
    expect(securitySchemeCredentialType({ type: 'oauth2', flows: { password: {} } })).toBe('oauth2_password');
  });

  it('returns null for a scheme this phase does not resolve to a CredentialType', () => {
    expect(securitySchemeCredentialType({ type: 'openIdConnect', openIdConnectUrl: 'https://x' })).toBeNull();
    expect(securitySchemeCredentialType({ type: 'oauth2', flows: { authorizationCode: {} } })).toBeNull();
    expect(securitySchemeCredentialType(undefined)).toBeNull();
    expect(securitySchemeCredentialType(null)).toBeNull();
  });
});
