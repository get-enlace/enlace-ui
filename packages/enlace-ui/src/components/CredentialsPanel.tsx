import { useEffect, useRef, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore.js';
import type { CredentialType, NewCredential } from '../types.js';

const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  bearer: 'Bearer token',
  basic: 'Basic auth',
  apiKey: 'API key',
  oauth2_clientCredentials: 'OAuth2 (client credentials)',
};

/** A fresh, empty draft for `type` — swapping type mid-edit resets the type-specific fields rather than carrying stale ones across. */
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
  }
}

export function CredentialsPanel() {
  const { credentials, addCredential } = useWorkflowStore();
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<NewCredential>(() => emptyDraft('bearer', ''));
  const popoverRef = useRef<HTMLDivElement>(null);

  const closeAndReset = () => {
    setIsOpen(false);
    setDraft(emptyDraft('bearer', ''));
  };

  // Dismiss on outside click, same as any other popover — a stray click on
  // the canvas shouldn't leave an abandoned draft form hanging around.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        closeAndReset();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isOpen]);

  return (
    <div className="credentials-panel">
      <span className="credentials-panel__count">
        {credentials.length} credential{credentials.length === 1 ? '' : 's'}
      </span>
      <div className="credentials-panel__anchor" ref={popoverRef}>
        <button type="button" className="btn btn--authorize" onClick={() => setIsOpen((v) => !v)}>
          + Add credential
        </button>

        {isOpen && (
          <div className="credentials-panel__popover">
            <label className="credentials-panel__field">
              Name
              <input placeholder="name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
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
                  <select value={draft.in} onChange={(e) => setDraft({ ...draft, in: e.target.value as 'header' | 'query' })}>
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
                  <input placeholder="scope" value={draft.scope ?? ''} onChange={(e) => setDraft({ ...draft, scope: e.target.value })} />
                </label>
              </>
            )}

            <div className="credentials-panel__popover-actions">
              <button type="button" className="btn btn--secondary" onClick={closeAndReset}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--authorize"
                disabled={!isDraftComplete(draft)}
                onClick={() => {
                  addCredential(draft);
                  closeAndReset();
                }}
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
