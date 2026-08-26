import { useEffect, useRef } from 'react';
import {
  BasicFields,
  ApiKeyFields,
  BearerFields,
  OAuth2ClientCredentialsFields,
  OAuth2PasswordFields,
  PopupLoginFields,
} from './CredentialTypeFields.js';
import { CREDENTIAL_TYPE_LABELS, emptyDraft, isDraftComplete } from '../utils/credentialDraft.js';
import type { CredentialType, NewCredential } from '../types.js';

export interface CredentialFormProps {
  draft: NewCredential;
  setDraft: (draft: NewCredential) => void;
  /** Non-null while editing an existing credential rather than adding a new one — only changes the banner/button copy; CredentialsPanel.tsx decides addCredential vs. updateCredential on save. */
  editingId: string | null;
  onCancel: () => void;
  onSave: () => void;
}

/** The add/edit form inside the Credentials drawer — name, type, and whichever CredentialTypeFields matches `draft.type`. Mounts only while adding/editing (CredentialsPanel.tsx renders it conditionally), so autofocusing the name input on mount is exactly "focus when this form appears". */
export function CredentialForm({ draft, setDraft, editingId, onCancel, onSave }: CredentialFormProps) {
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  return (
    <div className="credentials-drawer__form">
      {draft.fromSecurityScheme && (
        <p className="credentials-panel__spec-banner">
          {editingId ? (
            <>
              Originally configured from the spec's <code>securitySchemes.{draft.fromSecurityScheme}</code>.
            </>
          ) : (
            <>
              This credential is declared in the spec's <code>securitySchemes.{draft.fromSecurityScheme}</code> —
              fill in the secret value(s) below.
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
        <select value={draft.type} onChange={(e) => setDraft(emptyDraft(e.target.value as CredentialType, draft.name))}>
          {(Object.keys(CREDENTIAL_TYPE_LABELS) as CredentialType[]).map((type) => (
            <option key={type} value={type}>
              {CREDENTIAL_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>

      {draft.type === 'bearer' && <BearerFields draft={draft} setDraft={setDraft} />}
      {draft.type === 'basic' && <BasicFields draft={draft} setDraft={setDraft} />}
      {draft.type === 'apiKey' && <ApiKeyFields draft={draft} setDraft={setDraft} />}
      {draft.type === 'oauth2_clientCredentials' && (
        <OAuth2ClientCredentialsFields draft={draft} setDraft={setDraft} />
      )}
      {draft.type === 'oauth2_password' && <OAuth2PasswordFields draft={draft} setDraft={setDraft} />}
      {draft.type === 'popup_login' && <PopupLoginFields draft={draft} setDraft={setDraft} />}

      <div className="credentials-drawer__form-actions">
        <button type="button" className="btn btn--secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn--authorize" disabled={!isDraftComplete(draft)} onClick={onSave}>
          {editingId ? 'Save changes' : 'Save'}
        </button>
      </div>
    </div>
  );
}
