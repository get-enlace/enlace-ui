import { useState } from 'react';
import { openLoginPopup } from '../utils/credentialDraft.js';
import type { NewCredential } from '../types.js';

interface FieldsProps<T> {
  draft: T;
  setDraft: (draft: NewCredential) => void;
}

// Plain stroked-outline icons, not emoji — matches the rest of the app's
// chrome (✕ for close, › for expand, ! for failed), which never uses
// pictographic/colorful glyphs. `currentColor` means each follows
// whatever text color the reveal button already has, so no separate
// dark/light handling is needed.
function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

/**
 * A masked-by-default text input with a show/hide toggle — every secret
 * field (token, password, api key, client secret) uses this instead of a
 * bare `<input type="password">`. Complements the saved card's own
 * REDACTED-only preview (see credentialDraft.ts's maskedPreview): the card
 * never reveals any of the value, so this is the one place a user *can*
 * double-check exactly what they typed — on demand, in the form they
 * themselves are filling in, not leaked passively elsewhere.
 */
function SecretField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <label className="credentials-panel__field">
      {label}
      <span className="credentials-panel__secret-input">
        <input
          placeholder={placeholder}
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="credentials-panel__reveal-btn"
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
          title={revealed ? 'Hide value' : 'Show value'}
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </span>
    </label>
  );
}

type BearerDraft = Extract<NewCredential, { type: 'bearer' }>;

export function BearerFields({ draft, setDraft }: FieldsProps<BearerDraft>) {
  return (
    <SecretField
      label="Token"
      placeholder="bearer token"
      value={draft.token}
      onChange={(token) => setDraft({ ...draft, token })}
    />
  );
}

type BasicDraft = Extract<NewCredential, { type: 'basic' }>;

export function BasicFields({ draft, setDraft }: FieldsProps<BasicDraft>) {
  return (
    <>
      <label className="credentials-panel__field">
        Username
        <input
          placeholder="username"
          value={draft.username}
          onChange={(e) => setDraft({ ...draft, username: e.target.value })}
        />
      </label>
      <SecretField
        label="Password"
        placeholder="password"
        value={draft.password}
        onChange={(password) => setDraft({ ...draft, password })}
      />
    </>
  );
}

type ApiKeyDraft = Extract<NewCredential, { type: 'apiKey' }>;

export function ApiKeyFields({ draft, setDraft }: FieldsProps<ApiKeyDraft>) {
  return (
    <>
      <label className="credentials-panel__field">
        Header/query param name
        <input
          placeholder="e.g. X-API-Key"
          value={draft.paramName}
          onChange={(e) => setDraft({ ...draft, paramName: e.target.value })}
        />
      </label>
      <label className="credentials-panel__field">
        Sent in
        <select value={draft.in} onChange={(e) => setDraft({ ...draft, in: e.target.value as 'header' | 'query' })}>
          <option value="header">Header</option>
          <option value="query">Query param</option>
        </select>
      </label>
      <SecretField
        label="Key value"
        placeholder="key value"
        value={draft.key}
        onChange={(key) => setDraft({ ...draft, key })}
      />
    </>
  );
}

type OAuth2ClientCredentialsDraft = Extract<NewCredential, { type: 'oauth2_clientCredentials' }>;

export function OAuth2ClientCredentialsFields({ draft, setDraft }: FieldsProps<OAuth2ClientCredentialsDraft>) {
  return (
    <>
      {/* Client secrets get an explicit, hard-to-miss warning — not a buried disclaimer. */}
      <p className="credentials-panel__warning">
        Only use test/sandbox credentials here. This value is visible to anyone with access to this browser, per
        Enlace's pre-prod trust model.
      </p>
      <label className="credentials-panel__field">
        Token URL
        <input
          placeholder="https://auth.example.com/oauth/token"
          value={draft.tokenUrl}
          onChange={(e) => setDraft({ ...draft, tokenUrl: e.target.value })}
        />
      </label>
      <label className="credentials-panel__field">
        Client ID
        <input
          placeholder="client id"
          value={draft.clientId}
          onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}
        />
      </label>
      <SecretField
        label="Client secret"
        placeholder="client secret"
        value={draft.clientSecret}
        onChange={(clientSecret) => setDraft({ ...draft, clientSecret })}
      />
      <label className="credentials-panel__field">
        Client auth method
        <select
          value={draft.clientAuthMethod}
          onChange={(e) => setDraft({ ...draft, clientAuthMethod: e.target.value as 'basic' | 'body' })}
        >
          <option value="basic">HTTP Basic header (RFC 6749 client_secret_basic)</option>
          <option value="body">POST body params (client_secret_post)</option>
        </select>
      </label>
      <p className="credentials-panel__hint">
        How clientId/clientSecret are sent on the token request itself. Some identity servers require Basic and reject body params; pick Basic unless your token endpoint specifically
        wants the older body-param style.
      </p>
      <label className="credentials-panel__field">
        Scope (optional)
        <input
          placeholder="scope"
          value={draft.scope ?? ''}
          onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
        />
      </label>
    </>
  );
}

type OAuth2PasswordDraft = Extract<NewCredential, { type: 'oauth2_password' }>;

export function OAuth2PasswordFields({ draft, setDraft }: FieldsProps<OAuth2PasswordDraft>) {
  return (
    <>
      {/* Resource-owner password grant hands the user's actual password to the client — same explicit warning as a client secret. */}
      <p className="credentials-panel__warning">
        Legacy grant type — deprecated in general OAuth2 guidance. Only use test/sandbox credentials here. This
        value is visible to anyone with access to this browser, per Enlace's pre-prod trust model.
      </p>
      <label className="credentials-panel__field">
        Token URL
        <input
          placeholder="https://auth.example.com/oauth/token"
          value={draft.tokenUrl}
          onChange={(e) => setDraft({ ...draft, tokenUrl: e.target.value })}
        />
      </label>
      <label className="credentials-panel__field">
        Username
        <input
          placeholder="resource owner username"
          value={draft.username}
          onChange={(e) => setDraft({ ...draft, username: e.target.value })}
        />
      </label>
      <SecretField
        label="Password"
        placeholder="resource owner password"
        value={draft.password}
        onChange={(password) => setDraft({ ...draft, password })}
      />
      <label className="credentials-panel__field">
        Client ID (optional)
        <input
          placeholder="client id"
          value={draft.clientId ?? ''}
          onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}
        />
      </label>
      <SecretField
        label="Client secret (optional)"
        placeholder="client secret"
        value={draft.clientSecret ?? ''}
        onChange={(clientSecret) => setDraft({ ...draft, clientSecret })}
      />
      <label className="credentials-panel__field">
        Client auth method
        <select
          value={draft.clientAuthMethod}
          onChange={(e) => setDraft({ ...draft, clientAuthMethod: e.target.value as 'basic' | 'body' })}
        >
          <option value="basic">HTTP Basic header (RFC 6749 client_secret_basic)</option>
          <option value="body">POST body params (client_secret_post)</option>
        </select>
      </label>
      <p className="credentials-panel__hint">
        Only applies if client ID/secret above are filled in — a public client with neither has nothing to send
        either way.
      </p>
      <label className="credentials-panel__field">
        Scope (optional)
        <input
          placeholder="scope"
          value={draft.scope ?? ''}
          onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
        />
      </label>
    </>
  );
}

type PopupLoginDraft = Extract<NewCredential, { type: 'popup_login' }>;

/**
 * Deliberately scoped to *only* the server-sets-a-session-cookie case —
 * see PopupLoginCredential's own comment in types.ts for the "gives me a
 * token to paste in" variant that was designed, built, and dropped: the
 * token can only be obtained via the very "Log in" button on this same
 * form, which nothing communicated, leaving a required field the user had
 * no way to fill in on their first attempt.
 */
export function PopupLoginFields({ draft, setDraft }: FieldsProps<PopupLoginDraft>) {
  return (
    <>
      {/* Third-party-IdP-driven login (GitHub, Google, SSO, MFA — anything
          requiring a human to click through pages on another origin) can never
          be completed by a fetch()-driven node: CORS, consent screens, and
          registered-redirect-URI mismatches make that impossible. The popup
          below is the whole mechanism — Enlace never drives or inspects that
          navigation, and never sees the target's cookie either; the browser's
          own cookie jar does that part invisibly, once chainExecutor.ts sets
          `credentials: 'include'` on the actual request. */}
      <label className="credentials-panel__field">
        Login URL
        <input
          placeholder="https://your-app.example.com/auth/login"
          value={draft.loginUrl}
          onChange={(e) => setDraft({ ...draft, loginUrl: e.target.value })}
        />
      </label>
      <button
        type="button"
        className="btn btn--secondary credentials-panel__login-btn"
        disabled={!draft.loginUrl}
        onClick={() => openLoginPopup(draft.loginUrl)}
      >
        Log in…
      </button>

      <p className="credentials-panel__hint">
        This credential doesn't add anything to your requests itself — no header, no query param. It's a trigger:
        click "Log in…" above to complete a real login for the target (e.g. a GitHub/Google/SSO-style login backed
        by your app's own session) in a popup Enlace never sees. Once you're logged in, this browser already holds
        the session cookie, and future requests carry it automatically — as long as the target's server allows
        credentialed requests from this origin; that's the target's own CORS setting, not something Enlace can
        change.
      </p>
    </>
  );
}
