import { useRef, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore.js';
import {
  collectionFilename,
  formatUnknownOperationsError,
  parseCollection,
  serializeCollection,
} from '../utils/workflowDocument.js';
import type { CollectionWarnings, EnlaceCollection } from '../types.js';
import { Modal } from './Modal.js';

interface PendingImport {
  collection: EnlaceCollection;
  warnings: CollectionWarnings;
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

function downloadCollection(collection: EnlaceCollection): void {
  const blob = new Blob([JSON.stringify(collection, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = collectionFilename(collection);
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Header Export / Import for a versioned `.enlace` collection. V1 contains
 * one named workflow plus credentials. Secrets are stripped by default and
 * can only be included through the export modal's explicit acknowledgement.
 */
export function WorkflowFileMenu() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const connections = useWorkflowStore((s) => s.connections);
  const nodePositions = useWorkflowStore((s) => s.nodePositions);
  const credentials = useWorkflowStore((s) => s.credentials);
  const specInfo = useWorkflowStore((s) => s.specInfo);
  const operations = useWorkflowStore((s) => s.operations);
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const replaceWorkflow = useWorkflowStore((s) => s.replaceWorkflow);
  const setCredentialReview = useWorkflowStore((s) => s.setCredentialReview);
  const setError = (error: string | null) => useWorkflowStore.setState({ error });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [exportName, setExportName] = useState('');
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [secretsAcknowledged, setSecretsAcknowledged] = useState(false);

  const openExport = () => {
    setExportName(specInfo?.title?.trim() || 'Untitled');
    setIncludeSecrets(false);
    setSecretsAcknowledged(false);
    setShowExport(true);
  };

  const exportCollection = () => {
    const collection = serializeCollection({
      name: exportName,
      includeSecrets,
      nodes,
      connections,
      nodePositions,
      credentials,
      specInfo,
    });
    downloadCollection(collection);
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

  const onFileChosen = async (file: File | undefined) => {
    if (!file) return;
    const text = await readFileText(file);
    const result = parseCollection(text, { operations });
    if (!result.ok) {
      setPending(null);
      setError(result.error);
      return;
    }
    if (nodes.length > 0 || result.warnings.secretsIncluded) {
      setPending({ collection: result.collection, warnings: result.warnings });
      return;
    }
    applyCollection(result.collection, result.warnings);
  };

  return (
    <div className="workflow-file-menu">
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
        onClick={() => fileInputRef.current?.click()}
        disabled={isRunning}
        title={isRunning ? "Can't import while the workflow is running." : undefined}
      >
        Import
      </button>
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
                  setSecretsAcknowledged(false);
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
                onChange={() => setIncludeSecrets(true)}
              />
              <span>
                <strong>Full credentials</strong>
                <small>Include usable tokens, passwords, API keys, and client secrets.</small>
              </span>
            </label>
          </fieldset>
          {includeSecrets && (
            <div className="workflow-export__warning" role="alert">
              <strong>Warning: this file can authenticate as you.</strong>
              <p>Store it securely and do not share or commit it to source control.</p>
              <label>
                <input
                  type="checkbox"
                  checked={secretsAcknowledged}
                  onChange={(event) => setSecretsAcknowledged(event.target.checked)}
                />
                I understand this export contains usable secrets.
              </label>
            </div>
          )}
          <div className="tag-config-modal__actions">
            <button type="button" onClick={() => setShowExport(false)}>
              Cancel
            </button>
            <button
              type="button"
              onClick={exportCollection}
              disabled={!exportName.trim() || (includeSecrets && !secretsAcknowledged)}
            >
              Export
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
              ? ' This collection contains full credential secrets, which will be imported into memory.'
              : ' Credential secrets in this tab are discarded; imported credentials will need their values filled in.'}
          </p>
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
