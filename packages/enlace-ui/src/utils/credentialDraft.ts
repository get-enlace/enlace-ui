import type { Credential, CredentialType, NewCredential } from '../types.js';

export const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  bearer: 'Bearer token',
  basic: 'Basic auth',
  apiKey: 'API key',
  oauth2_clientCredentials: 'OAuth2 (client credentials)',
  oauth2_password: 'OAuth2 (password) · Legacy',
  popup_login: 'Popup login (session cookie)',
};

/** A fresh, empty draft for `type` — swapping type mid-edit resets the type-specific fields (and drops any spec-declared origin, since it no longer matches what was declared) rather than carrying stale ones across. */
export function emptyDraft(type: CredentialType, name: string): NewCredential {
  switch (type) {
    case 'bearer':
      return { name, type, token: '' };
    case 'basic':
      return { name, type, username: '', password: '' };
    case 'apiKey':
      return { name, type, paramName: '', in: 'header', key: '' };
    case 'oauth2_clientCredentials':
      return { name, type, tokenUrl: '', clientId: '', clientSecret: '', scope: '', clientAuthMethod: 'basic' };
    case 'oauth2_password':
      return {
        name,
        type,
        tokenUrl: '',
        username: '',
        password: '',
        clientId: '',
        clientSecret: '',
        scope: '',
        clientAuthMethod: 'basic',
      };
    case 'popup_login':
      return { name, type, loginUrl: '' };
  }
}

/**
 * True only for the credential types that resolve via a live network call
 * (the oauth2_* grants hitting their token endpoint — see
 * engine/credentials.ts's resolveCredentialInjection) rather than a value
 * the user already holds. Drives CredentialForm.tsx's "Verify & Save" vs
 * plain "Save": bearer/basic/apiKey are static values with no endpoint of
 * their own to check against, and popup_login's verification already *is*
 * its "Log in…" button, so none of those four get a second check here.
 */
export function credentialNeedsVerification(type: CredentialType): boolean {
  return type === 'oauth2_clientCredentials' || type === 'oauth2_password';
}

export function isDraftComplete(draft: NewCredential): boolean {
  if (!draft.name) return false;
  switch (draft.type) {
    case 'bearer':
      return Boolean(draft.token);
    case 'basic':
      return Boolean(draft.username && draft.password);
    case 'apiKey':
      return Boolean(draft.paramName && draft.key);
    case 'oauth2_clientCredentials':
      return Boolean(draft.tokenUrl && draft.clientId && draft.clientSecret);
    case 'oauth2_password':
      // clientId/clientSecret are optional (public-client token endpoints) — see OAuth2PasswordCredential in types.ts.
      return Boolean(draft.tokenUrl && draft.username && draft.password);
    case 'popup_login':
      // No secret value at all — the login URL is the whole form.
      return Boolean(draft.loginUrl);
  }
}

/**
 * A fixed, non-revealing stand-in for "a secret is set here" — deliberately
 * carries no information about the actual value (not even its length):
 * partially revealing a secret's tail character, as this used to do, gives
 * away real characters of it for essentially no benefit, since the
 * credential's own `name` field (shown above this on the card) is already
 * what tells two similarly-configured credentials apart at a glance.
 */
const REDACTED = '••••••••';

/**
 * A real browser popup, not a fetch() call — this is the whole mechanism
 * for `popup_login`: third-party-IdP login (GitHub, Google, SSO, MFA —
 * anything requiring a human to click through pages on another origin)
 * can't be driven by a node at all, so the actual login happens right
 * here, in a window Enlace never reads from or writes to. Sized rather
 * than left default so it reads as a deliberate login window, not a
 * stray full-size tab.
 */
export function openLoginPopup(loginUrl: string): void {
  window.open(loginUrl, '_blank', 'width=520,height=680');
}

/** Strips `id` off a saved credential so it can seed the edit form's draft — the inverse of what addCredential/updateCredential do with a NewCredential. */
export function toDraft(credential: Credential): NewCredential {
  const { id: _id, ...rest } = credential;
  return rest;
}

/**
 * The saved card's second line, under the credential's own `name`. Per
 * type, shows whatever *non-secret* structural detail actually helps tell
 * two credentials apart at a glance — never a fragment of the secret
 * itself (see REDACTED above):
 *
 * - bearer / oauth2_clientCredentials: nothing at all. A bearer token is
 *   just an opaque string with no other field, and a client id/secret pair
 *   is "mostly random chars" per its own nature — neither has a
 *   non-secret detail worth surfacing, so the preview line is omitted
 *   entirely (CredentialCard.tsx hides the row when this returns '').
 *   `name` is already how the user is expected to tell these apart.
 * - basic / oauth2_password: the username — genuinely useful to confirm
 *   which account this is, unlike the password itself, which the form
 *   below already flags as sensitive.
 * - apiKey: the header/query param name — confirms *how* the key gets
 *   sent without hinting at its value. The key is always shown as
 *   REDACTED alongside it, purely as an "a value is set" indicator.
 * - popup_login: unchanged — there's genuinely no stored value at all.
 */
export function maskedPreview(credential: Credential): string {
  switch (credential.type) {
    case 'bearer':
      return '';
    case 'basic':
      return credential.username;
    case 'apiKey':
      return `${credential.paramName} (${credential.in}) · ${REDACTED}`;
    case 'oauth2_clientCredentials':
      return '';
    case 'oauth2_password':
      return `${credential.username} · ${REDACTED}`;
    case 'popup_login':
      return 'Session cookie — no stored secret, relies on your browser being logged in';
  }
}
