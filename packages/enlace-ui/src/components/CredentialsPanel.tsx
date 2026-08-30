import { useEffect, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore.js';
import { CredentialCard } from './CredentialCard.js';
import { CredentialForm } from './CredentialForm.js';
import { DeclaredCredentialsList } from './DeclaredCredentialsList.js';
import { emptyDraft, isDraftComplete, toDraft } from '../utils/credentialDraft.js';
import type { DeclaredCredential } from '../engine/securitySchemes.js';
import type { Credential, NewCredential } from '../types.js';

export interface CredentialsPanelProps {
  /** When false, the panel is drawer-only — a parent (settings menu) opens it. */
  showTrigger?: boolean;
  /** Controlled open state. Omit for internal (trigger-driven) state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CredentialsPanel({ showTrigger = true, open, onOpenChange }: CredentialsPanelProps = {}) {
  const {
    credentials,
    declaredCredentials,
    nodes,
    credentialReview,
    addCredential,
    updateCredential,
    removeCredential,
    setCredentialReview,
  } = useWorkflowStore();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setIsOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [isAdding, setIsAdding] = useState(false);
  // Non-null while editing an existing credential rather than adding a new
  // one — same form, but Save calls updateCredential(editingId, draft)
  // instead of addCredential(draft), keeping the id (and every node's
  // credentialId reference to it) stable.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NewCredential>(() => emptyDraft('bearer', ''));

  const resetDraft = () => {
    setIsAdding(false);
    setEditingId(null);
    setDraft(emptyDraft('bearer', ''));
  };

  const closeDrawer = () => {
    setIsOpen(false);
    resetDraft();
    // Closing is the acknowledgement — the per-card "Needs a value" marks
    // stay regardless, so nothing is lost by dropping the banner here, and
    // it won't re-open the drawer on the next unrelated render.
    setCredentialReview(null);
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

  // `verifiedId` comes from CredentialForm's oauth2_* "Verify & Save" path
  // — the id resolveCredentialInjection already cached a token under, so
  // addCredential saves under that exact id instead of minting a new one
  // (see workflowStore.ts's addCredential for why that reuse matters).
  // Every other type calls this with no id, same as before.
  const saveDraft = (verifiedId?: string) => {
    if (editingId) {
      updateCredential(editingId, draft);
    } else {
      addCredential(draft, verifiedId);
    }
    resetDraft();
  };

  // An import that needs credential review opens the drawer itself, rather
  // than naming the credentials in the header toolbar where there's no room
  // for them and no way to act on them.
  useEffect(() => {
    if (credentialReview) setIsOpen(true);
  }, [credentialReview]);

  // Recomputed from live credentials rather than trusting the import-time
  // list, so the banner shrinks (and eventually goes) as values get filled
  // in without the drawer having to be closed and re-opened.
  const stillNeedingValue = credentialReview
    ? credentials.filter((c) => credentialReview.needsValueIds.includes(c.id) && !isDraftComplete(toDraft(c)))
    : [];
  const reviewParts: string[] = [];
  if (stillNeedingValue.length > 0) {
    reviewParts.push(
      stillNeedingValue.length === 1
        ? '1 imported credential needs a value before this chain can run — it’s marked below.'
        : `${stillNeedingValue.length} imported credentials need a value before this chain can run — they’re marked below.`
    );
  }
  if (credentialReview?.secretsDiscarded) {
    reviewParts.push('Unexpected secrets in a stripped collection were discarded on import.');
  }

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

  // Once a declared credential has been configured, drop it from the list
  // rather than leaving it there as a re-clickable entry — the credential
  // it produced is now visible in the list above (tagged "From spec:
  // ..."), so keeping it around too would just be showing the same thing
  // twice. This is purely a list-visibility choice, not a gate: nothing
  // blocks manual/repeat creation, and "+ New credential" still works for
  // a second credential from the same scheme.
  const configuredSchemeNames = new Set(credentials.map((c) => c.fromSecurityScheme).filter(Boolean));
  const unconfiguredCredentials = declaredCredentials.filter((d) => !configuredSchemeNames.has(d.schemeName));

  return (
    <>
      {showTrigger && (
        <button type="button" className="credentials-trigger" onClick={() => setIsOpen(true)}>
          <span className="credentials-trigger__count">{credentials.length}</span>
          credential{credentials.length === 1 ? '' : 's'}
        </button>
      )}

      {isOpen && (
        <>
          <div className="credentials-drawer__backdrop" onClick={closeDrawer} />
          <aside className="credentials-drawer">
            <div className="credentials-drawer__header">
              <h2>
                {isAdding ? (editingId ? 'Edit credential' : 'New credential') : 'Credentials'}
              </h2>
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
              {reviewParts.length > 0 && (
                <p className="credentials-drawer__review" role="status">
                  {reviewParts.join(' ')}
                </p>
              )}

              {/* List stays visible under the form so you keep context of what
                  already exists — header title alone marks add vs edit. */}
              {credentials.length === 0 && !isAdding && (
                <p className="credentials-drawer__empty">
                  No credentials yet. Add one, then attach it to a node via the lock icon in the inspector.
                </p>
              )}

              {credentials.length > 0 && (
                <ul className="credentials-drawer__list">
                  {credentials.map((c) => (
                    <CredentialCard
                      key={c.id}
                      credential={c}
                      usageCount={nodes.filter((n) => n.credentialId === c.id).length}
                      onEdit={startEditing}
                      onDelete={removeCredential}
                    />
                  ))}
                </ul>
              )}

              {/* Hidden while the add-form is open — the form's own spec banner
                  takes over as the "this came from the spec" indicator at that point. */}
              {!isAdding && (
                <DeclaredCredentialsList entries={unconfiguredCredentials} onConfigure={startConfiguring} />
              )}

              {isAdding ? (
                <CredentialForm draft={draft} setDraft={setDraft} editingId={editingId} onCancel={resetDraft} onSave={saveDraft} />
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
