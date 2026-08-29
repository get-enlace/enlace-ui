import { CREDENTIAL_TYPE_LABELS, isDraftComplete, maskedPreview, openLoginUrl, toDraft } from '../utils/credentialDraft.js';
import type { Credential } from '../types.js';

export interface CredentialCardProps {
  credential: Credential;
  /** How many WorkflowNodes currently reference this credential — drives the "Used by N nodes" hint below. */
  usageCount: number;
  onEdit: (credential: Credential) => void;
  onDelete: (credentialId: string) => void;
}

/** One saved credential's row in the Credentials drawer — type badge, masked preview, and actions (Open login page, for cookie; Edit; Delete). */
export function CredentialCard({ credential, usageCount, onEdit, onDelete }: CredentialCardProps) {
  const complete = isDraftComplete(toDraft(credential));
  // '' for bearer/oauth2_clientCredentials — see maskedPreview's own
  // comment for why those two have no non-secret detail worth a second
  // line at all, rather than showing an empty one.
  const preview = maskedPreview(credential);

  return (
    <li className={`credential-card credential-card--${credential.type}`}>
      <div className="credential-card__header">
        <span className={`credential-badge credential-badge--${credential.type}`}>
          {CREDENTIAL_TYPE_LABELS[credential.type]}
        </span>
        <div className="credential-card__actions">
          {credential.type === 'cookie' && credential.loginUrl && (
            <button
              type="button"
              className="credential-card__login"
              onClick={() => openLoginUrl(credential.loginUrl!)}
              aria-label={`Open login page for ${credential.name}`}
              // Sessions expire — shown on the saved card, not just at
              // creation time, since re-establishing login is a
              // recurring action rather than a one-off.
              title="Opens the login page in a new tab — log in there if your session has expired."
            >
              Open login page
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
      {!complete ? (
        <div className="credential-card__preview credential-card__preview--incomplete">Needs a value</div>
      ) : preview ? (
        <div className="credential-card__preview">{preview}</div>
      ) : null}
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
