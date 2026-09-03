import { CREDENTIAL_TYPE_LABELS } from '../utils/credentialDraft.js';
import type { DeclaredCredential } from '@get-enlace/core';

export interface DeclaredCredentialsListProps {
  /** Already filtered to schemes with no configured credential yet — see CredentialsPanel.tsx. */
  entries: DeclaredCredential[];
  onConfigure: (entry: DeclaredCredential) => void;
}

/**
 * Credentials the spec itself declares (components.securitySchemes),
 * read straight from the loaded spec, matching Swagger UI's own
 * "Authorize" dialog behavior of auto-detecting declared schemes. Not a
 * "suggestion": Enlace isn't guessing, it's stating a fact the spec's
 * author already declared.
 */
export function DeclaredCredentialsList({ entries, onConfigure }: DeclaredCredentialsListProps) {
  if (entries.length === 0) return null;

  return (
    <div className="credentials-drawer__declared">
      <h3>Declared in spec</h3>
      <ul className="credentials-drawer__declared-list">
        {entries.map((entry) => (
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
            <button type="button" className="btn btn--secondary" onClick={() => onConfigure(entry)}>
              Configure
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
