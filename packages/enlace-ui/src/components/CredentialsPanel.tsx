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
};

/** A fresh, empty draft for `type` — swapping type mid-edit resets the type-specific fields (and drops any spec-declared origin, since it no longer matches what was declared) rather than carrying stale ones across. */
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
  }
}

/** Never the raw secret — just enough to tell two similarly-named credentials apart at a glance. */
function maskTail(value: string): string {
  if (!value) return '';
  return `••••${value.slice(-4)}`;
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
