import { CREDENTIAL_TYPE_LABELS, maskedPreview, openLoginPopup } from '../utils/credentialDraft.js';
import type { Credential } from '../types.js';

export interface CredentialCardProps {
  credential: Credential;
  /** How many WorkflowNodes currently reference this credential — drives the "Used by N nodes" hint below. */
  usageCount: number;
  onEdit: (credential: Credential) => void;
  onDelete: (credentialId: string) => void;
}

/** One saved credential's row in the Credentials drawer — type badge, masked preview, and actions (Log in, for popup_login; Edit; Delete). */
export function CredentialCard({ credential, usageCount, onEdit, onDelete }: CredentialCardProps) {
  return (
    <li className={`credential-card credential-card--${credential.type}`}>
      <div className="credential-card__header">
        <span className={`credential-badge credential-badge--${credential.type}`}>
          {CREDENTIAL_TYPE_LABELS[credential.type]}
        </span>
        <div className="credential-card__actions">
          {credential.type === 'popup_login' && (
            <button
              type="button"
              className="credential-card__login"
              onClick={() => openLoginPopup(credential.loginUrl)}
              aria-label={`Log in for ${credential.name}`}
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
            onClick={() => onEdit(credential)}
            aria-label={`Edit ${credential.name}`}
          >
            Edit
          </button>
          <button
            type="button"
            className="credential-card__delete"
            onClick={() => onDelete(credential.id)}
            aria-label={`Delete ${credential.name}`}
          >
            Delete
          </button>
        </div>
      </div>
      <div className="credential-card__name">{credential.name}</div>
      <div className="credential-card__preview">{maskedPreview(credential)}</div>
      {credential.fromSecurityScheme && (
        <div className="credential-card__source">
          From spec: <code>{credential.fromSecurityScheme}</code>
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
}
