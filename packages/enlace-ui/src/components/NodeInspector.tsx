import { useMemo, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore.js';
import { coerceStaticValue } from '../utils/coerceValue.js';
import { areFieldTypesCompatible, flattenRequestFields, flattenResponseFields } from '../utils/flattenSchema.js';
import { computeAncestors } from '../engine/dependencyGraph.js';
import { hasUnrepresentableShape } from '../utils/schemaExample.js';
import { buildRawBodyFromForm, convertRawBodyToFieldValues } from '../utils/bodyTemplate.js';
import { buildNodeLabels } from '../utils/nodeLabel.js';
import { RawBodyEditor } from './RawBodyEditor.js';
import { Modal } from './Modal.js';
import type { SchemaField } from '../utils/flattenSchema.js';
import type { FieldValue } from '../types.js';

export interface NodeInspectorProps {
  onCollapse: () => void;
}

export function NodeInspector({ onCollapse }: NodeInspectorProps) {
  const {
    nodes,
    connections,
    operations,
    selectedNodeId,
    credentials,
    isRunning,
    setCredential,
    setFieldValue,
    mergeFieldValues,
    setBodyMode,
    setRawBody,
  } = useWorkflowStore();

  const node = nodes.find((n) => n.id === selectedNodeId);
  const operation = operations.find((o) => o.id === node?.operationId);
  const operationsById = useMemo(() => new Map(operations.map((o) => [o.id, o])), [operations]);
  const fields = useMemo(() => (operation ? flattenRequestFields(operation) : []), [operation]);
  const nonBodyFields = useMemo(() => fields.filter((f) => !f.path.startsWith('body.')), [fields]);
  const bodyFields = useMemo(() => fields.filter((f) => f.path.startsWith('body.')), [fields]);

  const [switchError, setSwitchError] = useState<string | null>(null);
  const [pendingFormSwitch, setPendingFormSwitch] = useState<Record<string, FieldValue> | null>(null);

  // "map from" may reach any ancestor in the connection graph, not just the
  // node directly before it — e.g. A -> B -> C where B carries no data, C
  // can still map a field from A. See utils/graph.ts.
  const ancestorNodes = useMemo(() => {
    if (!node) return [];
    const ancestorIds = computeAncestors(nodes, connections, node.id);
    return nodes.filter((n) => ancestorIds.has(n.id));
  }, [nodes, connections, node]);
  // Global — every node in the workflow, not just this node's ancestors — so a node's label here
  // always matches its canvas card and every other picker, regardless of which node is selected
  // (see Canvas.tsx and utils/nodeLabel.ts's buildNodeLabels doc).
  const nodeLabels = useMemo(() => buildNodeLabels(nodes, operationsById), [nodes, operationsById]);

  const collapseButton = (
    <button
      type="button"
      className="pane-collapse-btn"
      onClick={onCollapse}
      title="Hide inspector"
      aria-label="Hide inspector"
    >
      ›
    </button>
  );

  if (!node || !operation) {
    return (
      <aside className="node-inspector node-inspector--empty">
        <div className="node-inspector__topbar">
          <span>Inspector</span>
          {collapseButton}
        </div>
        <p>Select a node to configure it.</p>
      </aside>
    );
  }

  const bodyMode = node.bodyMode ?? 'form';

  function switchToRaw() {
    if (!node || !operation) return;
    setSwitchError(null);
    // Always rebuild from the current form fields — Form is the mode being
    // left, so it's the authoritative source. A stale `node.rawBody` left
    // over from an earlier raw-mode session (e.g. from before the last
    // Raw -> Form switch) must not win over field edits made since; see
    // switchToForm below, which is already unconditional in the other
    // direction (always re-derives from rawBody.template on every switch).
    setRawBody(node.id, buildRawBodyFromForm(operation, node.fieldValues));
    setBodyMode(node.id, 'raw');
  }

  function switchToForm() {
    if (!node || !operation) return;
    setSwitchError(null);
    if (!node.rawBody) {
      setBodyMode(node.id, 'form');
      return;
    }

    const result = convertRawBodyToFieldValues(node.rawBody, operation);
    if (result.parseError) {
      setSwitchError(`Can't switch to Form view — the Raw JSON isn't valid: ${result.parseError}`);
      return;
    }
    if (result.lossy) {
      setPendingFormSwitch(result.fieldValues);
      return;
    }
    mergeFieldValues(node.id, result.fieldValues);
    setBodyMode(node.id, 'form');
  }

  function confirmLossyFormSwitch() {
    if (!node || !pendingFormSwitch) return;
    mergeFieldValues(node.id, pendingFormSwitch);
    setBodyMode(node.id, 'form');
    setPendingFormSwitch(null);
  }

  function renderField(field: SchemaField) {
    const fieldValue = node!.fieldValues[field.path];
    const isMapped = fieldValue?.source === 'mapped';
    const disabled = !field.supported;

    // Nested/array fields are still shown, just disabled — a missing
    // field looks like a bug, a disabled one with a reason doesn't.
    const sourceNode = isMapped ? ancestorNodes.find((n) => n.id === fieldValue.fromNodeId) : undefined;
    const sourceOperation = sourceNode ? operations.find((o) => o.id === sourceNode.operationId) : undefined;
    const responseFields = sourceOperation ? flattenResponseFields(sourceOperation) : [];

    return (
      <div
        key={field.path}
        className={`node-inspector__field${disabled ? ' node-inspector__field--disabled' : ''}`}
        title={field.reason}
      >
        <label>
          {field.path}
          {field.required ? ' *' : ''}
          {field.type ? ` (${field.type})` : ''}
          {disabled ? ' (unsupported)' : ''}
        </label>

        <div className="node-inspector__field-row">
          <select
            disabled={disabled}
            value={isMapped ? 'mapped' : 'static'}
            onChange={(e) => {
              if (e.target.value === 'static') {
                setFieldValue(node!.id, field.path, { source: 'static', value: '' });
              } else if (ancestorNodes[0]) {
                setFieldValue(node!.id, field.path, {
                  source: 'mapped',
                  fromNodeId: ancestorNodes[0].id,
                  fromResponseFieldPath: '',
                });
              }
            }}
          >
            <option value="static">Static value</option>
            <option value="mapped" disabled={ancestorNodes.length === 0}>
              Map from...
            </option>
          </select>
        </div>

        {!isMapped && (
          <div className="node-inspector__field-row">
            {field.type === 'array' ? (
              <textarea
                rows={3}
                disabled={disabled}
                placeholder={field.reason}
                title={field.reason}
                value={
                  fieldValue?.source === 'static'
                    ? typeof fieldValue.value === 'string'
                      ? fieldValue.value
                      : JSON.stringify(fieldValue.value, null, 2)
                    : ''
                }
                onChange={(e) =>
                  setFieldValue(node!.id, field.path, {
                    source: 'static',
                    value: coerceStaticValue(e.target.value, field.type),
                  })
                }
              />
            ) : field.enum ? (
              <select
                disabled={disabled}
                value={fieldValue?.source === 'static' ? String(fieldValue.value ?? '') : ''}
                onChange={(e) =>
                  setFieldValue(node!.id, field.path, {
                    source: 'static',
                    value: coerceStaticValue(e.target.value, field.type),
                  })
                }
              >
                <option value="">Select...</option>
                {field.enum.map((v) => (
                  <option key={String(v)} value={String(v)}>
                    {String(v)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                disabled={disabled}
                value={fieldValue?.source === 'static' ? String(fieldValue.value ?? '') : ''}
                onChange={(e) =>
                  setFieldValue(node!.id, field.path, {
                    source: 'static',
                    value: coerceStaticValue(e.target.value, field.type),
                  })
                }
              />
            )}
          </div>
        )}

        {isMapped && (
          <div className="node-inspector__field-row node-inspector__field-row--mapped">
            <select
              disabled={disabled}
              value={fieldValue.fromNodeId}
              onChange={(e) => setFieldValue(node!.id, field.path, { ...fieldValue, fromNodeId: e.target.value })}
            >
              {ancestorNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {nodeLabels.get(n.id)}
                </option>
              ))}
            </select>
            <select
              disabled={disabled}
              value={fieldValue.fromResponseFieldPath}
              onChange={(e) =>
                setFieldValue(node!.id, field.path, { ...fieldValue, fromResponseFieldPath: e.target.value })
              }
            >
              <option value="">Select field...</option>
              {responseFields.map((rf) => {
                const typeMismatch = rf.supported && !areFieldTypesCompatible(field.type, rf.type);
                const optionDisabled = !rf.supported || typeMismatch;
                const reason = !rf.supported
                  ? rf.reason
                  : typeMismatch
                    ? `Type mismatch: "${field.path}" expects ${field.type}, this field is ${rf.type}.`
                    : undefined;
                return (
                  <option key={rf.path} value={rf.path} disabled={optionDisabled} title={reason}>
                    {rf.path}
                    {!rf.supported ? ' (unsupported)' : typeMismatch ? ' (type mismatch)' : ''}
                  </option>
                );
              })}
            </select>
          </div>
        )}
      </div>
    );
  }

  return (
    <aside className="node-inspector">
      <div className="node-inspector__topbar">
        <span>Inspector</span>
        {collapseButton}
      </div>

      {/* A native <fieldset disabled> is what actually locks every plain
          input/select/button below in one place — the store-level guards
          on setFieldValue/setCredential/etc. (workflowStore.ts's isLocked)
          are the real correctness fix (nothing here can bypass them even
          if this ever got out of sync), this is just making the "why
          didn't that do anything" question never come up. RawBodyEditor
          gets its own readOnly prop instead, since it isn't a native form
          control this wrapper reaches — see that component's own comment
          on why. */}
      {isRunning && (
        <p className="node-inspector__banner">Workflow is running — editing is locked until it finishes.</p>
      )}
      <fieldset className="node-inspector__fieldset" disabled={isRunning}>
      <h2>{operation.id}</h2>

      <label className="node-inspector__field">
        Credential
        <select value={node.credentialId ?? ''} onChange={(e) => setCredential(node.id, e.target.value || null)}>
          <option value="">None</option>
          {credentials.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <h3>Request fields</h3>
      {/* Path/query/header fields keep their own "Map from..." picker regardless of body mode — only skip this
          hint in Raw JSON mode when there's nothing else on the page it'd apply to; the tag config popup shows
          its own "no upstream nodes" message when you actually need it there (see TagConfigModal.tsx). */}
      {ancestorNodes.length === 0 && (nonBodyFields.length > 0 || bodyMode === 'form') && (
        <p className="node-inspector__hint">
          Connect this node from another on the canvas (drag box to box) to enable "Map from...".
        </p>
      )}
      {nonBodyFields.map(renderField)}

      {operation.requestBodySchema && (
        <div className="node-inspector__body">
          <div className="node-inspector__body-header">
            <span className="node-inspector__body-title">Body</span>
            <label className="body-mode-switch">
              <span className="body-mode-switch__label">{bodyMode === 'raw' ? 'Raw JSON' : 'Form'}</span>
              <input
                type="checkbox"
                checked={bodyMode === 'raw'}
                onChange={(e) => (e.target.checked ? switchToRaw() : switchToForm())}
                aria-label={bodyMode === 'raw' ? 'Switch to Form view' : 'Switch to Raw JSON view'}
              />
              <span className="body-mode-switch__track">
                <span className="body-mode-switch__thumb" />
              </span>
            </label>
          </div>

          {bodyMode === 'form' && hasUnrepresentableShape(operation.requestBodySchema) ? (
            <p className="node-inspector__banner">
              This body has a shape the form can't fully represent (arrays of objects or polymorphic fields).{' '}
              <button type="button" onClick={switchToRaw}>
                Switch to Raw JSON
              </button>
            </p>
          ) : (
            bodyMode === 'form' && (
              <p className="node-inspector__hint">
                Switch to Raw JSON to write the body directly and map values into any nested field.
              </p>
            )
          )}

          {switchError && <p className="node-inspector__error">{switchError}</p>}

          {bodyMode === 'form' ? (
            bodyFields.map(renderField)
          ) : node.rawBody ? (
            <RawBodyEditor
              rawBody={node.rawBody}
              onChange={(rawBody) => setRawBody(node.id, rawBody)}
              ancestorNodes={ancestorNodes}
              nodeLabels={nodeLabels}
              readOnly={isRunning}
            />
          ) : null}
        </div>
      )}
      </fieldset>

      {pendingFormSwitch && (
        <Modal title="Switch to Form view?" onClose={() => setPendingFormSwitch(null)}>
          <p>Switching to Form view may lose custom JSON structure — continue?</p>
          <div className="tag-config-modal__actions">
            <button type="button" onClick={() => setPendingFormSwitch(null)}>
              Cancel
            </button>
            <button type="button" onClick={confirmLossyFormSwitch}>
              Switch anyway
            </button>
          </div>
        </Modal>
      )}
    </aside>
  );
}
