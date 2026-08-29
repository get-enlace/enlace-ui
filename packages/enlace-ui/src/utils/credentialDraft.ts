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

/** Never the raw secret — just enough to tell two similarly-named credentials apart at a glance. */
export function maskTail(value: string): string {
  if (!value) return '';
  return `••••${value.slice(-4)}`;
}

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

export function maskedPreview(credential: Credential): string {
  switch (credential.type) {
    case 'bearer':
      return maskTail(credential.token);
    case 'basic':
      return `${credential.username} / ${maskTail(credential.password)}`;
    case 'apiKey':
      return `${credential.paramName} (${credential.in}) · ${maskTail(credential.key)}`;
    case 'oauth2_clientCredentials':
      return `${credential.clientId} · ${maskTail(credential.clientSecret)}`;
    case 'oauth2_password':
      return `${credential.username} · ${maskTail(credential.password)}`;
    case 'popup_login':
      return 'Session cookie — no stored secret, relies on your browser being logged in';
  }
}
