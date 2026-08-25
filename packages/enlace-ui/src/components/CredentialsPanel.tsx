import { useEffect, useRef, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore.js';
import type { DeclaredCredential } from '../engine/securitySchemes.js';
import type { Credential, CredentialType, NewCredential } from '../types.js';

const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  bearer: 'Bearer token',
  basic: 'Basic auth',
  apiKey: 'API key',
  oauth2_clientCredentials: 'OAuth2 (client credentials)',
  oauth2_password: 'OAuth2 (password) · Legacy',
  popup_login: 'Popup login',
};

/** A fresh, empty draft for `type` — swapping type mid-edit resets the type-specific fields (and drops any spec-declared origin, since it no longer matches what was declared) rather than carrying stale ones across. `popup_login` defaults to responseType 'cookie' — see the dedicated responseType switch inline in the form for changing that afterward without losing `loginUrl`. */
function emptyDraft(type: CredentialType, name: string): NewCredential {
  switch (type) {
    case 'bearer':
      return { name, type, token: '' };
    case 'basic':
      return { name, type, username: '', password: '' };
    case 'apiKey':
      return { name, type, paramName: '', in: 'header', key: '' };
    case 'oauth2_clientCredentials':
      return { name, type, tokenUrl: '', clientId: '', clientSecret: '', scope: '' };
    case 'oauth2_password':
      return { name, type, tokenUrl: '', username: '', password: '', clientId: '', clientSecret: '', scope: '' };
    case 'popup_login':
      return { name, type, loginUrl: '', responseType: 'cookie' };
  }
}

function isDraftComplete(draft: NewCredential): boolean {
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
      if (!draft.loginUrl) return false;
      // 'cookie' carries no secret value at all — the login URL is the whole form. 'token' still needs the pasted-in value and where to send it.
      return draft.responseType === 'cookie' || Boolean(draft.token && draft.paramName);
  }
}

/** Never the raw secret — just enough to tell two similarly-named credentials apart at a glance. */
function maskTail(value: string): string {
  if (!value) return '';
  return `••••${value.slice(-4)}`;
}

/**
 * A real browser popup, not a fetch() call — this is the whole mechanism
 * for `popup_login`, per auth-strategy.md's discussion: third-party-IdP
 * login (GitHub, Google, SSO, MFA — anything requiring a human to click
 * through pages on another origin) can't be driven by a node at all, so
 * the actual login happens right here, in a window Enlace never reads
 * from or writes to. Sized rather than left default so it reads as a
 * deliberate login window, not a stray full-size tab.
 */
function openLoginPopup(loginUrl: string): void {
  window.open(loginUrl, '_blank', 'width=520,height=680');
}

/** Strips `id` off a saved credential so it can seed the edit form's draft — the inverse of what addCredential/updateCredential do with a NewCredential. */
function toDraft(credential: Credential): NewCredential {
  const { id: _id, ...rest } = credential;
  return rest;
}

function maskedPreview(credential: Credential): string {
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
      return credential.responseType === 'cookie'
        ? 'Session cookie — no stored secret, relies on your browser being logged in'
        : `${credential.paramName} (${credential.in}) · ${maskTail(credential.token)}`;
  }
}

export function CredentialsPanel() {
  const { credentials, declaredCredentials, nodes, addCredential, updateCredential, removeCredential } =
    useWorkflowStore();
  const [isOpen, setIsOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  // Non-null while editing an existing credential rather than adding a new
  // one — same form, but Save calls updateCredential(editingId, draft)
  // instead of addCredential(draft), keeping the id (and every node's
  // credentialId reference to it) stable.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NewCredential>(() => emptyDraft('bearer', ''));
  const nameInputRef = useRef<HTMLInputElement>(null);

  const resetDraft = () => {
    setIsAdding(false);
    setEditingId(null);
    setDraft(emptyDraft('bearer', ''));
  };

  const closeDrawer = () => {
    setIsOpen(false);
    resetDraft();
  };

  const startConfiguring = (entry: DeclaredCredential) => {
    setDraft(entry.template);
    setIsAdding(true);
  };

  const startEditing = (credential: Credential) => {
    setDraft(toDraft(credential));
    setEditingId(credential.id);
    setIsAdding(true);
  };

  // Escape closes the drawer, same as a backdrop click — standard for any
  // overlay, and the only keyboard way out since the drawer isn't a <dialog>.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (isAdding) nameInputRef.current?.focus();
  }, [isAdding]);

  // Once a declared credential has been configured, drop it from the list
  // rather than leaving it there as a re-clickable entry — the credential
  // it produced is now visible in the list above (tagged "From spec:
  // ..."), so keeping it around too would just be showing the same thing
  // twice. This is purely a list-visibility choice, not a gate:
  // auth-strategy.md §4 never blocks manual/repeat creation, and "+ New
  // credential" still works for a second credential from the same scheme.
  const configuredSchemeNames = new Set(credentials.map((c) => c.fromSecurityScheme).filter(Boolean));
  const unconfiguredCredentials = declaredCredentials.filter((d) => !configuredSchemeNames.has(d.schemeName));

  return (
    <>
      <button type="button" className="credentials-trigger" onClick={() => setIsOpen(true)}>
        <span className="credentials-trigger__count">{credentials.length}</span>
        credential{credentials.length === 1 ? '' : 's'}
      </button>

      {isOpen && (
        <>
          <div className="credentials-drawer__backdrop" onClick={closeDrawer} />
          <aside className="credentials-drawer">
            <div className="credentials-drawer__header">
              <h2>Credentials</h2>
              <button
                type="button"
                className="pane-collapse-btn"
                onClick={closeDrawer}
                title="Close"
                aria-label="Close credentials"
              >
                ✕
              </button>
            </div>

            <div className="credentials-drawer__body">
              {credentials.length === 0 && !isAdding && (
                <p className="credentials-drawer__empty">
                  No credentials yet. Add one, then attach it to a node from the inspector's "Credential" dropdown.
                </p>
              )}

              {credentials.length > 0 && (
                <ul className="credentials-drawer__list">
                  {credentials.map((c) => {
                    const usageCount = nodes.filter((n) => n.credentialId === c.id).length;
                    return (
                      <li key={c.id} className={`credential-card credential-card--${c.type}`}>
                        <div className="credential-card__header">
                          <span className={`credential-badge credential-badge--${c.type}`}>
                            {CREDENTIAL_TYPE_LABELS[c.type]}
                          </span>
                          <div className="credential-card__actions">
                            {c.type === 'popup_login' && (
                              <button
                                type="button"
                                className="credential-card__login"
                                onClick={() => openLoginPopup(c.loginUrl)}
                                aria-label={`Log in for ${c.name}`}
                                // Sessions expire — shown on the saved card, not just at
                                // creation time, since re-establishing login is a
                                // recurring action rather than a one-off.
                                title="Opens the login page in a popup — complete login there, then re-run your nodes."
                              >
                                Log in
                              </button>
                            )}
                            <button
                              type="button"
                              className="credential-card__edit"
                              onClick={() => startEditing(c)}
                              aria-label={`Edit ${c.name}`}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="credential-card__delete"
                              onClick={() => removeCredential(c.id)}
                              aria-label={`Delete ${c.name}`}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        <div className="credential-card__name">{c.name}</div>
                        <div className="credential-card__preview">{maskedPreview(c)}</div>
                        {c.fromSecurityScheme && (
                          <div className="credential-card__source">
                            From spec: <code>{c.fromSecurityScheme}</code>
                          </div>
                        )}
                        {usageCount > 0 && (
                          <div className="credential-card__usage">
                            Used by {usageCount} node{usageCount === 1 ? '' : 's'} — deleting clears it from{' '}
                            {usageCount === 1 ? 'that node' : 'those nodes'}.
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Declared in the spec itself, per auth-strategy.md §4 — read
                  straight from the loaded spec's `components.securitySchemes`,
                  matching Swagger UI's own "Authorize" dialog behavior. Not a
                  "suggestion": Enlace isn't guessing, it's stating a fact the
                  spec's author already declared. Hidden while the add-form is
                  open (the form's own banner below takes over as the
                  "this came from the spec" indicator at that point). */}
              {!isAdding && unconfiguredCredentials.length > 0 && (
                <div className="credentials-drawer__declared">
                  <h3>Declared in spec</h3>
                  <ul className="credentials-drawer__declared-list">
                    {unconfiguredCredentials.map((entry) => (
                      <li key={entry.schemeName} className="declared-credential">
                        <div className="declared-credential__info">
                          <div className="declared-credential__name">
                            <code>{entry.schemeName}</code>
                          </div>
                          <div className="declared-credential__type">
                            {CREDENTIAL_TYPE_LABELS[entry.template.type]}
                            {entry.description ? ` — ${entry.description}` : ''}
                          </div>
                        </div>
                        <button type="button" className="btn btn--secondary" onClick={() => startConfiguring(entry)}>
                          Configure
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {isAdding ? (
                <div className="credentials-drawer__form">
                  {draft.fromSecurityScheme && (
                    <p className="credentials-panel__spec-banner">
                      {editingId ? (
                        <>
                          Originally configured from the spec's{' '}
                          <code>securitySchemes.{draft.fromSecurityScheme}</code>.
                        </>
                      ) : (
                        <>
                          This credential is declared in the spec's{' '}
                          <code>securitySchemes.{draft.fromSecurityScheme}</code> — fill in the secret value(s)
                          below.
                        </>
                      )}
                    </p>
                  )}

                  <label className="credentials-panel__field">
                    Name
                    <input
                      ref={nameInputRef}
                      placeholder="name"
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </label>

                  <label className="credentials-panel__field">
                    Type
                    <select
                      value={draft.type}
                      onChange={(e) => setDraft(emptyDraft(e.target.value as CredentialType, draft.name))}
                    >
                      {(Object.keys(CREDENTIAL_TYPE_LABELS) as CredentialType[]).map((type) => (
                        <option key={type} value={type}>
                          {CREDENTIAL_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </label>

                  {draft.type === 'bearer' && (
                    <label className="credentials-panel__field">
                      Token
                      <input
                        placeholder="bearer token"
                        type="password"
                        value={draft.token}
                        onChange={(e) => setDraft({ ...draft, token: e.target.value })}
                      />
                    </label>
                  )}

                  {draft.type === 'basic' && (
                    <>
                      <label className="credentials-panel__field">
                        Username
                        <input
                          placeholder="username"
                          value={draft.username}
                          onChange={(e) => setDraft({ ...draft, username: e.target.value })}
                        />
                      </label>
                      <label className="credentials-panel__field">
                        Password
                        <input
                          placeholder="password"
                          type="password"
                          value={draft.password}
                          onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                        />
                      </label>
                    </>
                  )}

                  {draft.type === 'apiKey' && (
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
                        <select
                          value={draft.in}
                          onChange={(e) => setDraft({ ...draft, in: e.target.value as 'header' | 'query' })}
                        >
                          <option value="header">Header</option>
                          <option value="query">Query param</option>
                        </select>
                      </label>
                      <label className="credentials-panel__field">
                        Key value
                        <input
                          placeholder="key value"
                          type="password"
                          value={draft.key}
                          onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                        />
                      </label>
                    </>
                  )}

                  {draft.type === 'oauth2_clientCredentials' && (
                    <>
                      {/* Client secrets get an explicit, hard-to-miss warning per auth-strategy.md §3 — not a buried disclaimer. */}
                      <p className="credentials-panel__warning">
                        Only use test/sandbox credentials here. This value is visible to anyone with access to this
                        browser, per Enlace's pre-prod trust model.
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
                      <label className="credentials-panel__field">
                        Client secret
                        <input
                          placeholder="client secret"
                          type="password"
                          value={draft.clientSecret}
                          onChange={(e) => setDraft({ ...draft, clientSecret: e.target.value })}
                        />
                      </label>
                      <label className="credentials-panel__field">
                        Scope (optional)
                        <input
                          placeholder="scope"
                          value={draft.scope ?? ''}
                          onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
                        />
                      </label>
                    </>
                  )}

                  {draft.type === 'oauth2_password' && (
                    <>
                      {/* Resource-owner password grant hands the user's actual password to the client — same explicit warning as a client secret, per auth-strategy.md §3. */}
                      <p className="credentials-panel__warning">
                        Legacy grant type — deprecated in general OAuth2 guidance. Only use test/sandbox credentials
                        here. This value is visible to anyone with access to this browser, per Enlace's pre-prod
                        trust model.
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
                      <label className="credentials-panel__field">
                        Password
                        <input
                          placeholder="resource owner password"
                          type="password"
                          value={draft.password}
                          onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                        />
                      </label>
                      <label className="credentials-panel__field">
                        Client ID (optional)
                        <input
                          placeholder="client id"
                          value={draft.clientId ?? ''}
                          onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}
                        />
                      </label>
                      <label className="credentials-panel__field">
                        Client secret (optional)
                        <input
                          placeholder="client secret"
                          type="password"
                          value={draft.clientSecret ?? ''}
                          onChange={(e) => setDraft({ ...draft, clientSecret: e.target.value })}
                        />
                      </label>
                      <label className="credentials-panel__field">
                        Scope (optional)
                        <input
                          placeholder="scope"
                          value={draft.scope ?? ''}
                          onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
                        />
                      </label>
                    </>
                  )}

                  {draft.type === 'popup_login' && (
                    <>
                      {/* Third-party-IdP-driven login (GitHub, Google, SSO, MFA — anything
                          requiring a human to click through pages on another origin) can never
                          be completed by a fetch()-driven node: CORS, consent screens, and
                          registered-redirect-URI mismatches make that impossible regardless of
                          what the login produces. The popup below is the whole mechanism —
                          Enlace never drives or inspects that navigation. */}
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

                      <label className="credentials-panel__field">
                        What happens after login?
                        <select
                          value={draft.responseType}
                          onChange={(e) => {
                            const responseType = e.target.value;
                            // Only 'cookie'/'token' ever reach here — the 'code' option
                            // below is disabled, so the browser never fires onChange for
                            // it (a disabled <option> can't be selected via mouse or
                            // keyboard). Rebuilt fully (not just a field patch) since the
                            // two responseTypes carry entirely different fields.
                            setDraft(
                              responseType === 'token'
                                ? {
                                    name: draft.name,
                                    type: 'popup_login',
                                    loginUrl: draft.loginUrl,
                                    responseType: 'token',
                                    token: '',
                                    paramName: '',
                                    in: 'header',
                                  }
                                : {
                                    name: draft.name,
                                    type: 'popup_login',
                                    loginUrl: draft.loginUrl,
                                    responseType: 'cookie',
                                  }
                            );
                          }}
                        >
                          <option value="cookie">Sets a session cookie</option>
                          <option value="token">Gives me a token to paste in</option>
                          <option value="code" disabled title="Requires a server-side token exchange (client secret or PKCE) — not supported yet">
                            Authorization code (not supported)
                          </option>
                        </select>
                      </label>

                      {draft.responseType === 'cookie' && (
                        <p className="credentials-panel__hint">
                          Nothing else to configure. Once you've logged in above, this browser
                          already has the session cookie — future requests attach it
                          automatically. This only works if the target's CORS policy allows
                          credentialed requests from Enlace's origin; that's the target's call,
                          not something Enlace can fix (ARCHITECTURE.md §7).
                        </p>
                      )}

                      {draft.responseType === 'token' && (
                        <>
                          {/* No automatic capture of a token embedded in the popup's own
                              redirect URL — that needs Enlace to own a registered callback
                              route (full authorizationCode-grant territory, see ROADMAP.md).
                              This is the manual fallback: get the token however the login
                              flow surfaces it, paste it in. */}
                          <label className="credentials-panel__field">
                            Token
                            <input
                              placeholder="paste the token you got after logging in"
                              type="password"
                              value={draft.token}
                              onChange={(e) => setDraft({ ...draft, token: e.target.value })}
                            />
                          </label>
                          <label className="credentials-panel__field">
                            Header/query param name
                            <input
                              placeholder="e.g. Authorization"
                              value={draft.paramName}
                              onChange={(e) => setDraft({ ...draft, paramName: e.target.value })}
                            />
                          </label>
                          <label className="credentials-panel__field">
                            Sent in
                            <select
                              value={draft.in}
                              onChange={(e) => setDraft({ ...draft, in: e.target.value as 'header' | 'query' })}
                            >
                              <option value="header">Header</option>
                              <option value="query">Query param</option>
                            </select>
                          </label>
                        </>
                      )}
                    </>
                  )}

                  <div className="credentials-drawer__form-actions">
                    <button type="button" className="btn btn--secondary" onClick={resetDraft}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn--authorize"
                      disabled={!isDraftComplete(draft)}
                      onClick={() => {
                        if (editingId) {
                          updateCredential(editingId, draft);
                        } else {
                          addCredential(draft);
                        }
                        resetDraft();
                      }}
                    >
                      {editingId ? 'Save changes' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="credentials-drawer__add-btn" onClick={() => setIsAdding(true)}>
                  + New credential
                </button>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
