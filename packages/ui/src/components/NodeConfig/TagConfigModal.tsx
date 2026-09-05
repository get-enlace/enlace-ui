import { useState } from 'react';
import { useWorkflowStore } from '../../store/workflowStore.js';
import { getHeaderCaseInsensitive, resolveJsonPath } from '@get-enlace/core';
import { randomId } from '../../utils/randomId.js';
import type { BodyTag, BodyTagType, WorkflowNode } from '../../types.js';
import { Modal } from '../Modal.js';
import { TrashIcon, UploadIcon } from '../chromeIcons.js';

const TYPE_LABELS: Record<BodyTagType, string> = {
  response_body: 'Response → Body Attribute',
  response_raw: 'Response → Raw Body',
  response_header: 'Response → Header',
  response_status: 'Response → Status Code',
  uploaded_file: 'Upload file',
};

// 'uploaded_file' is only ever offered when the caller says so (body-only,
// multipart-only — see RawBodyEditor.tsx's `allowFileUpload`); every other
// type is always on offer.
const RESPONSE_TAG_TYPES: BodyTagType[] = ['response_body', 'response_raw', 'response_header', 'response_status'];

export interface TagConfigModalProps {
  /** Reachable-via-connection ancestors of the node being edited — see engine/dependencyGraph.ts's computeAncestors, the same set NodeConfig's form "Map from..." picker already uses. */
  ancestorNodes: WorkflowNode[];
  /** Precomputed by the caller across the *whole* workflow (see utils/nodeLabel.ts's
   * buildNodeLabels) — not just `ancestorNodes` — so an option here always matches what the same
   * node shows on its canvas card and in every other picker. */
  nodeLabels: Map<string, string>;
  initialType: BodyTagType;
  /** Present when editing an existing chip (opened by clicking it in the editor) rather than inserting a new one. */
  initialTag?: BodyTag;
  /** Body-only, multipart-only — see RawBodyEditor.tsx's own prop of the same name for why. */
  allowFileUpload?: boolean;
  /**
   * `file` is set only when inserting a new `uploaded_file` tag, or
   * replacing an existing one's file — the caller (RawBodyEditor.tsx) is
   * what actually owns the node id needed to store it in `uploadedFiles`,
   * this component only collects it. Editing an existing file tag without
   * picking a new file confirms with `file: undefined`, meaning "keep
   * whatever's already stored".
   */
  onConfirm: (tag: BodyTag, file?: File) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

export function TagConfigModal({
  ancestorNodes,
  nodeLabels,
  initialType,
  initialTag,
  allowFileUpload = false,
  onConfirm,
  onDelete,
  onCancel,
}: TagConfigModalProps) {
  const runResult = useWorkflowStore((s) => s.runResult);
  const [type, setType] = useState<BodyTagType>(initialTag?.type ?? initialType);
  // Editing a broken chip whose source node was deleted: `initialTag.sourceNodeId`
  // isn't one of `ancestorNodes` any more, so it can't be the initial value —
  // a <select> bound to a value with no matching <option> silently falls back
  // to showing whatever the browser defaults to (commonly the first option)
  // while React's own state stays on the stale id, so "Save" without
  // touching the dropdown looks like it updated the source but doesn't.
  // Starting from '' instead forces an explicit, real pick (see the
  // placeholder option below) and keeps "Save" disabled until one is made.
  const initialSourceIsValid =
    initialTag && initialTag.type !== 'uploaded_file' ? ancestorNodes.some((n) => n.id === initialTag.sourceNodeId) : true;
  const [sourceNodeId, setSourceNodeId] = useState(
    initialTag && initialTag.type !== 'uploaded_file'
      ? initialSourceIsValid
        ? initialTag.sourceNodeId
        : ''
      : (ancestorNodes[0]?.id ?? '')
  );
  const [jsonPath, setJsonPath] = useState(initialTag?.type === 'response_body' ? (initialTag.jsonPath ?? '') : '');
  const [headerName, setHeaderName] = useState(initialTag?.type === 'response_header' ? initialTag.headerName : '');
  const [file, setFile] = useState<File | null>(null);
  const existingFileName = initialTag?.type === 'uploaded_file' ? initialTag.fileName : '';

  const canConfirm =
    type === 'uploaded_file'
      ? Boolean(file) || Boolean(existingFileName) // editing without picking a new file keeps the old one
      : Boolean(sourceNodeId) && (type !== 'response_header' || headerName.trim().length > 0);

  function preview(): string {
    if (type === 'uploaded_file') {
      const name = file?.name ?? existingFileName;
      return name ? `File: ${name}` : 'Choose a file to attach.';
    }
    if (!sourceNodeId) return 'Select a request first.';
    const step = runResult?.steps.find((s) => s.nodeId === sourceNodeId);
    if (!step || !step.response) return 'No prior run captured for this node yet — run the chain once to preview.';

    if (type === 'response_header') {
      const value = getHeaderCaseInsensitive(step.response.headers, headerName);
      return value === undefined ? `(no "${headerName}" header in the last response)` : value;
    }
    if (type === 'response_status') return String(step.response.status);
    const value = type === 'response_raw' ? step.response.body : resolveJsonPath(step.response.body, jsonPath);
    return JSON.stringify(value, null, 2) ?? 'undefined';
  }

  function handleConfirm() {
    if (!canConfirm) return;
    const id = initialTag?.id ?? randomId();

    if (type === 'uploaded_file') {
      const fileName = file?.name ?? existingFileName;
      onConfirm({ id, type: 'uploaded_file', fileName }, file ?? undefined);
      return;
    }
    if (!sourceNodeId) return;
    if (type === 'response_body') {
      onConfirm({ id, type, sourceNodeId, jsonPath: jsonPath.trim() || undefined });
    } else if (type === 'response_header') {
      onConfirm({ id, type, sourceNodeId, headerName: headerName.trim() });
    } else {
      onConfirm({ id, type, sourceNodeId });
    }
  }

  return (
    <Modal title={initialTag ? 'Edit mapping' : 'Insert response mapping'} onClose={onCancel}>
      <label className="tag-config-modal__field">
        Map
        <select value={type} onChange={(e) => setType(e.target.value as BodyTagType)}>
          {RESPONSE_TAG_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
          {allowFileUpload && <option value="uploaded_file">{TYPE_LABELS.uploaded_file}</option>}
        </select>
      </label>

      {type === 'uploaded_file' ? (
        <label className="tag-config-modal__field">
          File
          {file ? (
            // A freshly picked file — this is the only state "Clear" makes
            // sense in: discarding it falls back to `existingFileName`
            // (still there, editing) or an empty picker (a new insert).
            <div className="node-config__file-drop node-config__file-drop--filled">
              <span className="node-config__file-name" title={file.name}>
                {file.name}
              </span>
              <button type="button" className="node-config__file-clear" aria-label="Clear file" onClick={() => setFile(null)}>
                <TrashIcon />
              </button>
            </div>
          ) : (
            <>
              {existingFileName && (
                <p className="node-config__hint">
                  Currently "{existingFileName}" — choose a file below to replace it, or Save to keep it as-is.
                </p>
              )}
              <div className="node-config__file-drop">
                <input
                  key="empty"
                  type="file"
                  className="node-config__file-input"
                  aria-label="File to upload"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <span className="node-config__file-prompt" aria-hidden="true">
                  <UploadIcon />
                </span>
              </div>
            </>
          )}
        </label>
      ) : (
        <label className="tag-config-modal__field">
          Request
          {ancestorNodes.length === 0 ? (
            <p className="node-config__hint">No upstream nodes reachable from here yet — connect this node from another on the canvas first.</p>
          ) : (
            <select value={sourceNodeId} onChange={(e) => setSourceNodeId(e.target.value)}>
              <option value="" disabled>
                {initialTag && !initialSourceIsValid
                  ? '-- Original request no longer exists — pick a new one --'
                  : '-- Select request --'}
              </option>
              {ancestorNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {nodeLabels.get(n.id)}
                </option>
              ))}
            </select>
          )}
        </label>
      )}

      {type === 'response_body' && (
        <label className="tag-config-modal__field">
          Filter (JSONPath)
          <input
            type="text"
            placeholder="e.g. $.items[0].id (blank = whole body)"
            value={jsonPath}
            onChange={(e) => setJsonPath(e.target.value)}
          />
        </label>
      )}

      {type === 'response_header' && (
        <label className="tag-config-modal__field">
          Header name
          <input type="text" placeholder="e.g. x-trace-id" value={headerName} onChange={(e) => setHeaderName(e.target.value)} />
        </label>
      )}

      <div className="tag-config-modal__preview">
        <span className="tag-config-modal__preview-label">Live Preview</span>
        <pre>{preview()}</pre>
      </div>

      <div className="tag-config-modal__actions">
        {initialTag && onDelete && (
          <button type="button" className="tag-config-modal__delete" onClick={onDelete}>
            Remove mapping
          </button>
        )}
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" disabled={!canConfirm} onClick={handleConfirm}>
          {initialTag ? 'Save' : 'Insert'}
        </button>
      </div>
    </Modal>
  );
}
