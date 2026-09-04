import { CREDENTIAL_TYPE_LABELS, isDraftComplete, maskedPreview, openLoginUrl, toDraft } from '../../utils/credentialDraft.js';
import { ExternalLinkIcon, PencilIcon, TrashIcon } from '../chromeIcons.js';
import type { Credential } from '../../types.js';

export interface CredentialCardProps {
  credential: Credential;
  /** How many WorkflowNodes currently reference this credential — used on delete confirm. */
  usageCount: number;
  onEdit: (credential: Credential) => void;
  onDelete: (credentialId: string) => void;
}

/**
 * One saved credential row — name first, type + status on a quiet meta line.
 * Usage is only surfaced when deleting (confirm), not as always-on copy.
 */
export function CredentialCard({ credential, usageCount, onEdit, onDelete }: CredentialCardProps) {
  const complete = isDraftComplete(toDraft(credential));
  // '' for bearer/oauth2_clientCredentials — see maskedPreview's own
  // comment for why those two have no non-secret detail worth a second
  // line at all, rather than showing an empty one.
  const preview = maskedPreview(credential);

  function handleDelete() {
    if (usageCount > 0) {
      const ok = window.confirm(
        usageCount === 1
          ? `Delete "${credential.name}"? It's used by 1 node — that node will lose this credential.`
          : `Delete "${credential.name}"? It's used by ${usageCount} nodes — those nodes will lose this credential.`
      );
      if (!ok) return;
    }
    onDelete(credential.id);
  }

  return (
    <li className="credential-card">
      <div className="credential-card__top">
        <div className="credential-card__main">
          <div className="credential-card__name">{credential.name}</div>
          <div className="credential-card__meta">
            <span className={`credential-badge credential-badge--${credential.type}`}>
              {CREDENTIAL_TYPE_LABELS[credential.type]}
            </span>
            {!complete ? (
              <span className="credential-card__flag">Needs a value</span>
            ) : preview ? (
              <span className="credential-card__preview">{preview}</span>
            ) : null}
          </div>
          {credential.fromSecurityScheme && (
            <div className="credential-card__source">
              From spec: <code>{credential.fromSecurityScheme}</code>
            </div>
          )}
        </div>
        <div className="credential-card__actions">
          {credential.type === 'cookie' && credential.loginUrl && (
            <button
              type="button"
              className="credential-card__icon-btn"
              onClick={() => openLoginUrl(credential.loginUrl!)}
              aria-label={`Open login page for ${credential.name}`}
              title="Opens the login page in a new tab — log in there if your session has expired."
            >
              <ExternalLinkIcon />
            </button>
          )}
          <button
            type="button"
            className="credential-card__icon-btn"
            onClick={() => onEdit(credential)}
            aria-label={`Edit ${credential.name}`}
            title="Edit"
          >
            <PencilIcon />
          </button>
          <button
            type="button"
            className="credential-card__icon-btn credential-card__icon-btn--danger"
            onClick={handleDelete}
            aria-label={`Delete ${credential.name}`}
            title="Delete"
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    </li>
  );
}
