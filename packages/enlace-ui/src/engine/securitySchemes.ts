import type { NewCredential } from '../types.js';

/**
 * One `components.securitySchemes` entry, turned into a ready-to-use
 * credential draft — per auth-strategy.md §4: the spec has *declared* this
 * scheme exists, matching Swagger UI's own "Authorize" dialog behavior of
 * auto-detecting declared schemes, except here it pre-fills a whole
 * credential template (grant type, tokenUrl/paramName/scope) rather than
 * just prompting for a raw value. Deliberately not called a "suggestion" —
 * this isn't Enlace guessing, it's reading a fact the spec's author
 * already stated. Never gates manual creation — see CredentialsPanel.tsx,
 * which always offers every CredentialType regardless of what the spec
 * declares.
 */
export interface DeclaredCredential {
  /** The scheme's key in `components.securitySchemes`, e.g. "bearerAuth" — becomes the draft's default name, and is recorded as the resulting credential's `fromSecurityScheme`. */
  schemeName: string;
  /** The scheme's own `description`, if the spec provides one. */
  description?: string;
  /** Secret-bearing fields (token/password/clientSecret/key) are always left empty — only structural fields (tokenUrl, paramName, in, scope) are pre-filled. */
  template: NewCredential;
}

/**
 * Extracts one entry per supported `components.securitySchemes` declaration.
 * A scheme this phase doesn't support yet (apiKey-in-cookie, oauth2
 * authorizationCode/implicit, openIdConnect, mutualTLS) is silently
 * skipped — not an error, since arbitrary manual creation covers it
 * regardless (see auth-strategy.md §4).
 */
export function extractDeclaredCredentials(spec: Record<string, any>): DeclaredCredential[] {
  const schemes = spec?.components?.securitySchemes ?? {};
  const declared: DeclaredCredential[] = [];

  for (const [schemeName, scheme] of Object.entries<any>(schemes)) {
    const template = toCredentialTemplate(schemeName, scheme);
    if (template) declared.push({ schemeName, description: scheme?.description, template });
  }

  return declared;
}

function toCredentialTemplate(schemeName: string, scheme: any): NewCredential | null {
  if (!scheme || typeof scheme !== 'object') return null;

  if (scheme.type === 'http' && scheme.scheme === 'bearer') {
    return withSource(schemeName, { name: schemeName, type: 'bearer', token: '' });
  }

  if (scheme.type === 'http' && scheme.scheme === 'basic') {
    return withSource(schemeName, { name: schemeName, type: 'basic', username: '', password: '' });
  }

  if (scheme.type === 'apiKey' && (scheme.in === 'header' || scheme.in === 'query')) {
    return withSource(schemeName, {
      name: schemeName,
      type: 'apiKey',
      paramName: scheme.name ?? '',
      in: scheme.in,
      key: '',
    });
  }

  if (scheme.type === 'oauth2') {
    const flows = scheme.flows ?? {};

    if (flows.clientCredentials) {
      return withSource(schemeName, {
        name: schemeName,
        type: 'oauth2_clientCredentials',
        tokenUrl: flows.clientCredentials.tokenUrl ?? '',
        clientId: '',
        clientSecret: '',
        scope: scopeNames(flows.clientCredentials.scopes),
      });
    }

    if (flows.password) {
      return withSource(schemeName, {
        name: schemeName,
        type: 'oauth2_password',
        tokenUrl: flows.password.tokenUrl ?? '',
        username: '',
        password: '',
        clientId: '',
        clientSecret: '',
        scope: scopeNames(flows.password.scopes),
      });
    }

    // authorizationCode/implicit — no non-interactive way to pre-fill a
    // usable draft yet (see the CredentialType comment in types.ts); the
    // scheme just isn't surfaced as a declared credential.
    return null;
  }

  return null; // openIdConnect, mutualTLS — not supported
}

// Generic-over-T (rather than plain `Omit<NewCredential, 'fromSecurityScheme'>`)
// because `keyof` a union type collapses to the *intersection* of its
// members' keys — plain Omit would only see the fields every credential
// type has in common, not each call site's own variant.
function withSource<T extends NewCredential>(schemeName: string, template: T): T & { fromSecurityScheme: string } {
  return { ...template, fromSecurityScheme: schemeName };
}

function scopeNames(scopes: Record<string, string> | undefined): string {
  return scopes ? Object.keys(scopes).join(' ') : '';
}
