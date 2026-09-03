import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore.js';
import {
  collectionFilename,
  formatUnknownOperationsError,
  parseCollection,
  serializeCollection,
} from '../utils/workflowDocument.js';
import {
  decryptCollection,
  encryptCollection,
  isEncryptedCollection,
  isEncryptionSupported,
  type EncryptedCollectionEnvelope,
} from '@get-enlace/core';
import type { CollectionWarnings, EnlaceCollection } from '../types.js';
import { Modal } from './Modal.js';

const MIN_PASSWORD_LENGTH = 8;

interface PendingImport {
  collection: EnlaceCollection;
  warnings: CollectionWarnings;
  /** True when this collection was decrypted from a password-protected
   * envelope — false for a stripped import, or for a legacy plaintext
   * "with secrets" file (an older Enlace build's export, never encrypted). */
  wasEncrypted: boolean;
}

interface PendingDecrypt {
  envelope: EncryptedCollectionEnvelope;
}

export interface WorkflowFileMenuHandle {
  openExport: () => void;
  openImport: () => void;
}

export interface WorkflowFileMenuProps {
  /** When true, only modals + file input mount — a parent menu triggers actions via ref. */
  hideButtons?: boolean;
}

function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Export / Import for a versioned `.enlace` collection. V1 contains one named
 * workflow plus credentials. Secrets are stripped by default; "Full
 * credentials" export is always encrypted (password -> PBKDF2 -> AES-GCM,
 * see @get-enlace/core collectionCrypto) — there's no unencrypted-secrets path left
 * in this build, though a *legacy* file produced by an older build that did
 * write plaintext secrets is still importable, with a loud warning.
 *
 * Header chrome hosts these behind the settings menu (`hideButtons` + ref);
 * tests and any standalone use still render Export/Import buttons.
 */
export const WorkflowFileMenu = forwardRef<WorkflowFileMenuHandle, WorkflowFileMenuProps>(
  function WorkflowFileMenu({ hideButtons = false }, ref) {
    const nodes = useWorkflowStore((s) => s.nodes);
    const connections = useWorkflowStore((s) => s.connections);
    const nodePositions = useWorkflowStore((s) => s.nodePositions);
    const groups = useWorkflowStore((s) => s.groups);
    const credentials = useWorkflowStore((s) => s.credentials);
    const specInfo = useWorkflowStore((s) => s.specInfo);
    const workflowName = useWorkflowStore((s) => s.workflowName);
    const operations = useWorkflowStore((s) => s.operations);
    const isRunning = useWorkflowStore((s) => s.isRunning);
    const replaceWorkflow = useWorkflowStore((s) => s.replaceWorkflow);
    const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName);
    const setCredentialReview = useWorkflowStore((s) => s.setCredentialReview);
    const setError = (error: string | null) => useWorkflowStore.setState({ error });

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [pending, setPending] = useState<PendingImport | null>(null);
    const [pendingDecrypt, setPendingDecrypt] = useState<PendingDecrypt | null>(null);
    const [decryptPassword, setDecryptPassword] = useState('');
    const [decryptError, setDecryptError] = useState<string | null>(null);
    const [isDecrypting, setIsDecrypting] = useState(false);
    const [showExport, setShowExport] = useState(false);
    const [exportName, setExportName] = useState('');
    const [includeSecrets, setIncludeSecrets] = useState(false);
    const [exportPassword, setExportPassword] = useState('');
    const [exportPasswordConfirm, setExportPasswordConfirm] = useState('');
    const [isEncrypting, setIsEncrypting] = useState(false);

    const openExport = () => {
      // Prefer the canvas workflow name; fall back to the OpenAPI title only
      // when the user hasn't named anything yet (still "Untitled").
      const named = workflowName.trim() && workflowName !== 'Untitled' ? workflowName : null;
      setExportName(named || specInfo?.title?.trim() || 'Untitled');
      setIncludeSecrets(false);
      setExportPassword('');
      setExportPasswordConfirm('');
      setShowExport(true);
    };

    const openImport = () => {
      fileInputRef.current?.click();
    };

    useImperativeHandle(ref, () => ({ openExport, openImport }));

    const passwordsValid =
      exportPassword.length >= MIN_PASSWORD_LENGTH && exportPassword === exportPasswordConfirm;
    const canExport =
      exportName.trim().length > 0 && (!includeSecrets || (isEncryptionSupported() && passwordsValid));

    const exportCollection = async () => {
      const collection = serializeCollection({
        name: exportName,
        includeSecrets,
        nodes,
        connections,
        nodePositions,
        groups,
        credentials,
        specInfo,
      });

      if (includeSecrets) {
        setIsEncrypting(true);
        try {
          const envelope = await encryptCollection(collection, exportPassword);
          downloadJson(envelope, collectionFilename(collection, true));
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to encrypt this export.');
          return;
        } finally {
          setIsEncrypting(false);
        }
      } else {
        downloadJson(collection, collectionFilename(collection));
      }

      setWorkflowName(exportName);
      setShowExport(false);
    };

    const applyCollection = (collection: EnlaceCollection, warnings: CollectionWarnings) => {
      // replaceWorkflow itself already no-ops while a run is in progress
      // (workflowStore.ts's isLocked) — checked again here (rather than just
      // relying on the Import button's disabled state below) because a run
      // can still start in the gap between picking a file and this call
      // resolving (onFileChosen awaits reading the file's text first). Report
      // that honestly instead of closing the dialog and claiming success on a
      // canvas that was never touched.
      if (useWorkflowStore.getState().isRunning) {
        setPending(null);
        setError("Can't import while the workflow is running.");
        return;
      }
      replaceWorkflow(collection);
      setPending(null);
      setError(formatUnknownOperationsError(warnings));
      const needsValueIds = warnings.credentialsNeedingSecrets.map((c) => c.id);
      setCredentialReview(
        needsValueIds.length > 0 || warnings.unexpectedSecretsDiscarded
          ? { needsValueIds, secretsDiscarded: warnings.unexpectedSecretsDiscarded }
          : null
      );
    };

    /** Shared tail of both the plaintext and decrypted-envelope import paths
     * — everything from here on is the same parseCollection -> confirm flow
     * regardless of which one got us here. */
    const finishParsing = (raw: unknown, wasEncrypted: boolean) => {
      const result = parseCollection(raw, { operations });
      if (!result.ok) {
        setPending(null);
        setPendingDecrypt(null);
        setError(result.error);
        return;
      }
      setPendingDecrypt(null);
      if (nodes.length > 0 || result.warnings.secretsIncluded) {
        setPending({ collection: result.collection, warnings: result.warnings, wasEncrypted });
        return;
      }
      applyCollection(result.collection, result.warnings);
    };

    const onFileChosen = async (file: File | undefined) => {
      if (!file) return;
      const text = await readFileText(file);
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        setPending(null);
        setError('Could not parse Enlace collection as JSON.');
        return;
      }
      if (isEncryptedCollection(raw)) {
        setDecryptPassword('');
        setDecryptError(null);
        setPendingDecrypt({ envelope: raw });
        return;
      }
      finishParsing(raw, false);
    };

    const submitDecrypt = async () => {
      if (!pendingDecrypt) return;
      setIsDecrypting(true);
      setDecryptError(null);
      try {
        const plaintext = await decryptCollection(pendingDecrypt.envelope, decryptPassword);
        finishParsing(plaintext, true);
      } catch (err) {
        setDecryptError(err instanceof Error ? err.message : 'Something went wrong decrypting this file.');
      } finally {
        setIsDecrypting(false);
      }
    };

    return (
      <div className={`workflow-file-menu${hideButtons ? ' workflow-file-menu--host' : ''}`}>
        {!hideButtons && (
          <>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={openExport}
              disabled={nodes.length === 0}
              title="Download this workflow and its credentials as an Enlace collection."
            >
              Export
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={openImport}
              disabled={isRunning}
              title={isRunning ? "Can't import while the workflow is running." : undefined}
            >
              Import
            </button>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".enlace,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            void onFileChosen(file);
          }}
        />
        {showExport && (
          <Modal title="Export Enlace collection" onClose={() => setShowExport(false)}>
            <label className="workflow-export__field">
              <span>Name</span>
              <input
                autoFocus
                value={exportName}
                onChange={(event) => setExportName(event.target.value)}
                placeholder="Collection name"
              />
            </label>
            <fieldset className="workflow-export__credentials">
              <legend>Credentials</legend>
              <label>
                <input
                  type="radio"
                  name="credential-export"
                  checked={!includeSecrets}
                  onChange={() => {
                    setIncludeSecrets(false);
                    setExportPassword('');
                    setExportPasswordConfirm('');
                  }}
                />
                <span>
                  <strong>Partial (recommended)</strong>
                  <small>Include credential names and configuration, but strip tokens, passwords, and keys.</small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="credential-export"
                  checked={includeSecrets}
                  disabled={!isEncryptionSupported()}
                  onChange={() => setIncludeSecrets(true)}
                />
                <span>
                  <strong>Full credentials</strong>
                  <small>Include usable tokens, passwords, API keys, and client secrets, encrypted with a password you set below.</small>
                  {!isEncryptionSupported() && (
                    <small className="workflow-export__unsupported">
                      Unavailable here — encryption needs a secure context (HTTPS or localhost), and this page isn't
                      one.
                    </small>
                  )}
                </span>
              </label>
            </fieldset>
            {includeSecrets && (
              <div className="workflow-export__warning" role="alert">
                <strong>Warning: this file can authenticate as you.</strong>
                <p>
                  It's encrypted with the password below, so both the file and the password are needed to use it —
                  store them separately, and don't share or commit the file to source control regardless.
                </p>
                <label className="workflow-export__field">
                  <span>Password</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={exportPassword}
                    onChange={(event) => setExportPassword(event.target.value)}
                    placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                  />
                </label>
                <label className="workflow-export__field">
                  <span>Confirm password</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={exportPasswordConfirm}
                    onChange={(event) => setExportPasswordConfirm(event.target.value)}
                  />
                </label>
                {exportPassword.length > 0 && exportPassword.length < MIN_PASSWORD_LENGTH && (
                  <p className="workflow-export__hint">Password must be at least {MIN_PASSWORD_LENGTH} characters.</p>
                )}
                {exportPasswordConfirm.length > 0 && exportPassword !== exportPasswordConfirm && (
                  <p className="workflow-export__hint">Passwords don't match.</p>
                )}
              </div>
            )}
            <div className="tag-config-modal__actions">
              <button type="button" onClick={() => setShowExport(false)}>
                Cancel
              </button>
              <button type="button" onClick={() => void exportCollection()} disabled={!canExport || isEncrypting}>
                {isEncrypting ? 'Encrypting…' : 'Export'}
              </button>
            </div>
          </Modal>
        )}
        {pendingDecrypt && (
          <Modal
            title="Enter password"
            onClose={() => {
              setPendingDecrypt(null);
              setDecryptError(null);
            }}
          >
            <p>This Enlace collection is password-protected. Enter the password it was exported with.</p>
            <label className="workflow-export__field">
              <span>Password</span>
              <input
                autoFocus
                type="password"
                value={decryptPassword}
                onChange={(event) => {
                  setDecryptPassword(event.target.value);
                  setDecryptError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && decryptPassword && !isDecrypting) void submitDecrypt();
                }}
              />
            </label>
            {decryptError && (
              <p className="workflow-export__hint" role="alert">
                {decryptError}
              </p>
            )}
            <div className="tag-config-modal__actions">
              <button
                type="button"
                onClick={() => {
                  setPendingDecrypt(null);
                  setDecryptError(null);
                }}
              >
                Cancel
              </button>
              <button type="button" onClick={() => void submitDecrypt()} disabled={!decryptPassword || isDecrypting}>
                {isDecrypting ? 'Decrypting…' : 'Decrypt'}
              </button>
            </div>
          </Modal>
        )}
        {pending && (
          <Modal
            title={pending.collection.secrets === 'included' ? 'Import collection with secrets?' : 'Replace current canvas?'}
            onClose={() => setPending(null)}
          >
            <p>
              {nodes.length > 0
                ? `Importing this file will replace ${nodes.length} node${nodes.length === 1 ? '' : 's'} on the canvas.`
                : 'Importing this file will replace the current empty canvas.'}
              {pending.collection.secrets === 'included'
                ? pending.wasEncrypted
                  ? ' This collection was password-protected and contains full credential secrets, which will be imported into memory.'
                  : ' This collection contains full credential secrets, which will be imported into memory.'
                : ' Credential secrets in this tab are discarded; imported credentials will need their values filled in.'}
            </p>
            {pending.collection.secrets === 'included' && !pending.wasEncrypted && (
              <div className="workflow-export__warning" role="alert">
                <strong>This file was exported unencrypted by an older version of Enlace.</strong>
                <p>It carries usable secrets in plain text. Treat it as sensitive — don't share it or commit it to source control.</p>
              </div>
            )}
            <div className="tag-config-modal__actions">
              <button type="button" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => applyCollection(pending.collection, pending.warnings)}
                disabled={isRunning}
              >
                {pending.collection.secrets === 'included' ? 'Import secrets' : 'Replace'}
              </button>
            </div>
          </Modal>
        )}
      </div>
    );
  }
);
