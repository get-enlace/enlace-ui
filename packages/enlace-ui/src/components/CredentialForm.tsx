import { useEffect, useRef, useState } from 'react';
import {
  BasicFields,
  ApiKeyFields,
  BearerFields,
  OAuth2ClientCredentialsFields,
  OAuth2PasswordFields,
  CookieFields,
} from './CredentialTypeFields.js';
import { CREDENTIAL_TYPE_LABELS, credentialNeedsVerification, emptyDraft, isDraftComplete } from '../utils/credentialDraft.js';
import { resolveCredentialInjection } from '../engine/credentials.js';
import { randomId } from '../utils/randomId.js';
import type { Credential, CredentialType, NewCredential } from '../types.js';

export interface CredentialFormProps {
  draft: NewCredential;
  setDraft: (draft: NewCredential) => void;
  /** Non-null while editing an existing credential rather than adding a new one — only changes the banner/button copy; CredentialsPanel.tsx decides addCredential vs. updateCredential on save. */
  editingId: string | null;
  onCancel: () => void;
  /**
   * `verifiedId` is set only by the oauth2_* "Verify & Save" path below,
   * carrying the id that `resolveCredentialInjection` already cached a
   * token under — CredentialsPanel.tsx passes it straight through to
   * addCredential so the credential is saved under that exact id instead
   * of minting a fresh one, letting the first real run reuse the cached
   * token. Every other type calls onSave() with no id, same as before.
   */
  onSave: (verifiedId?: string) => void;
}

/**
 * The add/edit form inside the Credentials drawer — name, type, and
 * whichever CredentialTypeFields matches `draft.type`. Mounts only while
 * adding/editing (CredentialsPanel.tsx renders it conditionally), so
 * autofocusing the name input on mount is exactly "focus when this form
 * appears".
 *
 * For oauth2_clientCredentials/oauth2_password (see
 * credentialNeedsVerification), Save becomes "Verify & Save": it actually
 * hits the token endpoint via resolveCredentialInjection *before* anything
 * reaches the store, and only calls onSave on success. This is the whole
 * point — it's the difference between finding out the token endpoint
 * rejects your clientAuthMethod right now, in this form, versus after
 * saving, attaching it to a node, and running a chain. A failed attempt
 * saves nothing, so there's never a half-configured, non-functional
 * credential sitting in the list.
 */
export function CredentialForm({ draft, setDraft, editingId, onCancel, onSave }: CredentialFormProps) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  // Minted once per form mount (not per click) so a retry after a failed
  // attempt reuses the same id rather than a fresh one each time — doesn't
  // change behavior (resolveCredentialInjection only caches on success,
  // and this id never reaches the store until a save actually happens),
  // just avoids generating ids nobody uses.
  const pendingIdRef = useRef<string>(randomId());

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  // Any field edit invalidates whatever the last verify attempt found —
  // stale success or failure both stop meaning anything once the draft
  // that produced them no longer matches what's on screen.
  const handleSetDraft = (next: NewCredential) => {
    setVerifyError(null);
    setDraft(next);
  };

  const needsVerification = credentialNeedsVerification(draft.type);

  const handleSave = async () => {
    if (!needsVerification) {
      onSave();
      return;
    }
    setVerifying(true);
    setVerifyError(null);
    try {
      const id = editingId ?? pendingIdRef.current;
      await resolveCredentialInjection({ ...draft, id } as Credential);
      onSave(id);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(false);
    }
  };

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
          onChange={(e) => handleSetDraft({ ...draft, name: e.target.value })}
        />
      </label>

      <label className="credentials-panel__field">
        Type
        <select
          value={draft.type}
          onChange={(e) => handleSetDraft(emptyDraft(e.target.value as CredentialType, draft.name))}
        >
          {(Object.keys(CREDENTIAL_TYPE_LABELS) as CredentialType[]).map((type) => (
            <option key={type} value={type}>
              {CREDENTIAL_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>

      {draft.type === 'bearer' && <BearerFields draft={draft} setDraft={handleSetDraft} />}
      {draft.type === 'basic' && <BasicFields draft={draft} setDraft={handleSetDraft} />}
      {draft.type === 'apiKey' && <ApiKeyFields draft={draft} setDraft={handleSetDraft} />}
      {draft.type === 'oauth2_clientCredentials' && (
        <OAuth2ClientCredentialsFields draft={draft} setDraft={handleSetDraft} />
      )}
      {draft.type === 'oauth2_password' && <OAuth2PasswordFields draft={draft} setDraft={handleSetDraft} />}
      {draft.type === 'cookie' && <CookieFields draft={draft} setDraft={handleSetDraft} />}

      {verifyError && (
        <p className="credentials-panel__verify-error" role="alert">
          Verification failed: {verifyError}
        </p>
      )}

      <div className="credentials-drawer__form-actions">
        <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={verifying}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--authorize"
          disabled={!isDraftComplete(draft) || verifying}
          onClick={handleSave}
        >
          {verifying
            ? 'Verifying…'
            : editingId
              ? needsVerification
                ? 'Verify & save changes'
                : 'Save changes'
              : needsVerification
                ? 'Verify & Save'
                : 'Save'}
        </button>
      </div>
    </div>
  );
}
