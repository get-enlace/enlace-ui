import { useState } from 'react';
import { useWorkflowStore } from '../../store/workflowStore.js';
import { getHeaderCaseInsensitive, resolveJsonPath } from '@get-enlace/core';
import { randomId } from '../../utils/randomId.js';
import type { BodyTag, BodyTagType, WorkflowNode } from '../../types.js';
import { Modal } from '../Modal.js';

const TYPE_LABELS: Record<BodyTagType, string> = {
  response_body: 'Response → Body Attribute',
  response_raw: 'Response → Raw Body',
  response_header: 'Response → Header',
};

export interface TagConfigModalProps {
  /** Reachable-via-connection ancestors of the node being edited — see engine/dependencyGraph.ts's computeAncestors, the same set NodeInspector's form "Map from..." picker already uses. */
  ancestorNodes: WorkflowNode[];
  /** Precomputed by the caller across the *whole* workflow (see utils/nodeLabel.ts's
   * buildNodeLabels) — not just `ancestorNodes` — so an option here always matches what the same
   * node shows on its canvas card and in every other picker. */
  nodeLabels: Map<string, string>;
  initialType: BodyTagType;
  /** Present when editing an existing chip (opened by clicking it in the editor) rather than inserting a new one. */
  initialTag?: BodyTag;
  onConfirm: (tag: BodyTag) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

export function TagConfigModal({
  ancestorNodes,
  nodeLabels,
  initialType,
  initialTag,
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
  const initialSourceIsValid = initialTag ? ancestorNodes.some((n) => n.id === initialTag.sourceNodeId) : true;
  const [sourceNodeId, setSourceNodeId] = useState(
    initialTag ? (initialSourceIsValid ? initialTag.sourceNodeId : '') : (ancestorNodes[0]?.id ?? '')
  );
  const [jsonPath, setJsonPath] = useState(initialTag?.jsonPath ?? '');
  const [headerName, setHeaderName] = useState(initialTag?.headerName ?? '');

  const canConfirm = Boolean(sourceNodeId) && (type !== 'response_header' || headerName.trim().length > 0);

  function preview(): string {
    if (!sourceNodeId) return 'Select a request first.';
    const step = runResult?.steps.find((s) => s.nodeId === sourceNodeId);
    if (!step || !step.response) return 'No prior run captured for this node yet — run the chain once to preview.';

    if (type === 'response_header') {
      const value = getHeaderCaseInsensitive(step.response.headers, headerName);
      return value === undefined ? `(no "${headerName}" header in the last response)` : value;
    }
    const value = type === 'response_raw' ? step.response.body : resolveJsonPath(step.response.body, jsonPath);
    return JSON.stringify(value, null, 2) ?? 'undefined';
  }

  function handleConfirm() {
    if (!canConfirm) return;
    const tag: BodyTag = {
      id: initialTag?.id ?? randomId(),
      type,
      sourceNodeId,
      jsonPath: type === 'response_body' ? jsonPath.trim() || undefined : undefined,
      headerName: type === 'response_header' ? headerName.trim() : undefined,
    };
    onConfirm(tag);
  }

  return (
    <Modal title={initialTag ? 'Edit mapping' : 'Insert response mapping'} onClose={onCancel}>
      <label className="tag-config-modal__field">
        Map
        <select value={type} onChange={(e) => setType(e.target.value as BodyTagType)}>
          {(Object.keys(TYPE_LABELS) as BodyTagType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>

      <label className="tag-config-modal__field">
        Request
        {ancestorNodes.length === 0 ? (
          <p className="node-inspector__hint">No upstream nodes reachable from here yet — connect this node from another on the canvas first.</p>
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
