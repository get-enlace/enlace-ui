import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkflowStore } from '../../store/workflowStore.js';
import { coerceStaticValue } from '../../utils/coerceValue.js';
import { areFieldTypesCompatible, flattenRequestFields, flattenResponseFields } from '../../utils/flattenSchema.js';
import { computeAncestors } from '@get-enlace/core';
import { hasUnrepresentableShape } from '../../utils/schemaExample.js';
import { buildRawBodyFromForm, buildRawParamsFromForm, convertRawBodyToFieldValues, convertRawParamsToFieldValues } from '../../utils/bodyTemplate.js';
import { buildNodeLabels } from '@get-enlace/core';
import { RawBodyEditor } from './RawBodyEditor.js';
import { Modal } from '../Modal.js';
import type { SchemaField } from '../../utils/flattenSchema.js';
import type { FieldValue } from '../../types.js';

/** Stroked lock — same outline style as CredentialTypeFields eye icons. */
function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

export function NodeInspector() {
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
    setUploadedFile,
    setRequestMode,
    setRawPath,
    setRawQuery,
    setRawBody,
  } = useWorkflowStore();

  const node = nodes.find((n) => n.id === selectedNodeId);
  const operation = operations.find((o) => o.id === node?.operationId);
  const operationsById = useMemo(() => new Map(operations.map((o) => [o.id, o])), [operations]);
  const fields = useMemo(() => (operation ? flattenRequestFields(operation) : []), [operation]);
  const pathFields = useMemo(() => fields.filter((f) => f.path.startsWith('path.')), [fields]);
  const queryFields = useMemo(() => fields.filter((f) => f.path.startsWith('query.')), [fields]);
  const headerFields = useMemo(() => fields.filter((f) => f.path.startsWith('header.')), [fields]);
  const bodyFields = useMemo(() => fields.filter((f) => f.path.startsWith('body.')), [fields]);

  const [switchError, setSwitchError] = useState<string | null>(null);
  const [pendingFormSwitch, setPendingFormSwitch] = useState<Record<string, FieldValue> | null>(null);
  const [credPickerOpen, setCredPickerOpen] = useState(false);
  const credPickerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!credPickerOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (credPickerRef.current && !credPickerRef.current.contains(e.target as Node)) {
        setCredPickerOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setCredPickerOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [credPickerOpen]);

  // Close the picker when the selected node changes so a leftover menu
  // doesn't sit open under a different operation's title.
  useEffect(() => {
    setCredPickerOpen(false);
  }, [selectedNodeId]);

  if (!node || !operation) {
    return (
      <aside className="node-inspector node-inspector--empty">
        <p className="node-inspector__empty-msg">Select a node to configure it.</p>
      </aside>
    );
  }

  const isMultipart = operation.requestBodyContentType === 'multipart/form-data';
  // Multipart bodies can't be represented as Raw JSON (a File isn't text), so
  // force Form mode and hide the toggle for these operations.
  const bodyMode = isMultipart ? 'form' : (node.requestMode ?? 'form');
  const hasRequestToggle =
    !isMultipart && (pathFields.length > 0 || queryFields.length > 0 || Boolean(operation.requestBodySchema));
  const selectedCredential = credentials.find((c) => c.id === node.credentialId) ?? null;

  function switchToRaw() {
    if (!node || !operation) return;
    setSwitchError(null);
    // Always rebuild from the current form fields — Form is the mode being
    // left, so it's the authoritative source. Stale raw* left over from an
    // earlier raw-mode session must not win over field edits made since.
    if (pathFields.length > 0) {
      setRawPath(node.id, buildRawParamsFromForm('path', operation, node.fieldValues));
    }
    if (queryFields.length > 0) {
      setRawQuery(node.id, buildRawParamsFromForm('query', operation, node.fieldValues));
    }
    if (operation.requestBodySchema) {
      setRawBody(node.id, buildRawBodyFromForm(operation, node.fieldValues));
    }
    setRequestMode(node.id, 'raw');
  }

  function switchToForm() {
    if (!node || !operation) return;
    setSwitchError(null);

    const merged: Record<string, FieldValue> = {};
    let lossy = false;

    if (node.rawPath && pathFields.length > 0) {
      const result = convertRawParamsToFieldValues('path', node.rawPath, operation);
      if (result.parseError) {
        setSwitchError(`Can't switch to Form view — path Raw JSON isn't valid: ${result.parseError}`);
        return;
      }
      Object.assign(merged, result.fieldValues);
      lossy = lossy || result.lossy;
    }
    if (node.rawQuery && queryFields.length > 0) {
      const result = convertRawParamsToFieldValues('query', node.rawQuery, operation);
      if (result.parseError) {
        setSwitchError(`Can't switch to Form view — query Raw JSON isn't valid: ${result.parseError}`);
        return;
      }
      Object.assign(merged, result.fieldValues);
      lossy = lossy || result.lossy;
    }
    if (node.rawBody && operation.requestBodySchema) {
      const result = convertRawBodyToFieldValues(node.rawBody, operation);
      if (result.parseError) {
        setSwitchError(`Can't switch to Form view — body Raw JSON isn't valid: ${result.parseError}`);
        return;
      }
      Object.assign(merged, result.fieldValues);
      lossy = lossy || result.lossy;
    }

    if (lossy) {
      setPendingFormSwitch(merged);
      return;
    }
    mergeFieldValues(node.id, merged);
    setRequestMode(node.id, 'form');
  }

  function confirmLossyFormSwitch() {
    if (!node || !pendingFormSwitch) return;
    mergeFieldValues(node.id, pendingFormSwitch);
    setRequestMode(node.id, 'form');
    setPendingFormSwitch(null);
  }

  function renderField(field: SchemaField) {
    const fieldValue = node!.fieldValues[field.path];
    const isFileField = field.format === 'binary';
    const isMapped = !isFileField && fieldValue?.source === 'mapped';
    const disabled = !field.supported;

    // Nested/array fields are still shown, just disabled — a missing
    // field looks like a bug, a disabled one with a reason doesn't.
    const sourceNode = isMapped ? ancestorNodes.find((n) => n.id === fieldValue.fromNodeId) : undefined;
    const sourceOperation = sourceNode ? operations.find((o) => o.id === sourceNode.operationId) : undefined;
    const responseFields = sourceOperation ? flattenResponseFields(sourceOperation) : [];

    if (isFileField) {
      const fileName = fieldValue?.source === 'file' ? fieldValue.fileName : '';
      return (
        <div
          key={field.path}
          className={`node-inspector__field${disabled ? ' node-inspector__field--disabled' : ''}`}
          title={field.reason}
        >
          <label>
            {field.path}
            {field.required ? ' *' : ''}
            {' (file)'}
            {disabled ? ' (unsupported)' : ''}
          </label>
          <div
            className={`node-inspector__file-drop${fileName ? ' node-inspector__file-drop--filled' : ''}${disabled ? ' node-inspector__file-drop--disabled' : ''}`}
          >
            {fileName ? (
              <>
                <span className="node-inspector__file-name" title={fileName}>
                  {fileName}
                </span>
                <button
                  type="button"
                  className="node-inspector__file-clear"
                  disabled={disabled}
                  aria-label={`Clear ${field.path}`}
                  onClick={() => setUploadedFile(node!.id, field.path, null)}
                >
                  <TrashIcon />
                </button>
              </>
            ) : (
              <>
                {/* Remount on clear so the same file can be re-picked. */}
                <input
                  key="empty"
                  type="file"
                  className="node-inspector__file-input"
                  disabled={disabled}
                  aria-label={field.path}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setUploadedFile(node!.id, field.path, file);
                  }}
                />
                <span className="node-inspector__file-prompt" aria-hidden="true">
                  <UploadIcon />
                </span>
              </>
            )}
          </div>
        </div>
      );
    }

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

        <div className={`node-inspector__field-row${isMapped ? ' node-inspector__field-row--mapped' : ''}`}>
          <select
            className="node-inspector__source-select"
            disabled={disabled}
            value={isMapped ? 'mapped' : 'static'}
            aria-label={`Source for ${field.path}`}
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
            <option value="static">Static</option>
            <option value="mapped" disabled={ancestorNodes.length === 0}>
              Mapped
            </option>
          </select>

          {!isMapped &&
            (field.type === 'array' ? (
              <textarea
                rows={3}
                disabled={disabled}
                placeholder={field.reason}
                title={field.reason}
                aria-label={field.path}
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
                aria-label={field.path}
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
                aria-label={field.path}
                value={fieldValue?.source === 'static' ? String(fieldValue.value ?? '') : ''}
                onChange={(e) =>
                  setFieldValue(node!.id, field.path, {
                    source: 'static',
                    value: coerceStaticValue(e.target.value, field.type),
                  })
                }
              />
            ))}

          {isMapped && (
            <>
              <select
                disabled={disabled}
                aria-label={`Map ${field.path} from node`}
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
                aria-label={`Map ${field.path} from response field`}
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
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <aside className="node-inspector">
      {/* Operation verb+path is the pane header (no separate "Inspector" title).
          Credential lock stays here — it's about this operation, not chrome. */}
      {isRunning && (
        <p className="node-inspector__banner">Workflow is running — editing is locked until it finishes.</p>
      )}
      <fieldset className="node-inspector__fieldset" disabled={isRunning}>
      <div className="node-inspector__header" ref={credPickerRef}>
        <div className="node-inspector__op-title">
          <button
            type="button"
            className={`node-inspector__cred-lock${selectedCredential ? ' node-inspector__cred-lock--set' : ''}`}
            aria-label="Credential"
            aria-expanded={credPickerOpen}
            aria-haspopup="listbox"
            title={selectedCredential ? `Credential: ${selectedCredential.name}` : 'No credential'}
            onClick={() => setCredPickerOpen((open) => !open)}
          >
            <LockIcon />
          </button>
          <span className={`method-badge method-badge--${operation.method}`}>{operation.method.toUpperCase()}</span>
          <h2 className="node-inspector__path">{operation.path}</h2>
        </div>
        {credPickerOpen && (
          <ul className="node-inspector__cred-menu" role="listbox" aria-label="Available credentials">
            <li role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={!selectedCredential}
                className={`node-inspector__cred-option${!selectedCredential ? ' node-inspector__cred-option--active' : ''}`}
                onClick={() => {
                  setCredential(node.id, null);
                  setCredPickerOpen(false);
                }}
              >
                None
              </button>
            </li>
            {credentials.map((c) => (
              <li key={c.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedCredential?.id === c.id}
                  className={`node-inspector__cred-option${selectedCredential?.id === c.id ? ' node-inspector__cred-option--active' : ''}`}
                  onClick={() => {
                    setCredential(node.id, c.id);
                    setCredPickerOpen(false);
                  }}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="node-inspector__request-header">
        <h3>Request</h3>
        {hasRequestToggle && (
          <label
            className="body-mode-switch"
            title="Switch to Raw to edit path, query, and body as JSON and map values with tag chips."
          >
            <span className="body-mode-switch__label">{bodyMode === 'raw' ? 'Raw' : 'Form'}</span>
            <input
              type="checkbox"
              checked={bodyMode === 'raw'}
              onChange={(e) => (e.target.checked ? switchToRaw() : switchToForm())}
              aria-label={bodyMode === 'raw' ? 'Switch to Form view' : 'Switch to Raw view'}
            />
            <span className="body-mode-switch__track">
              <span className="body-mode-switch__thumb" />
            </span>
          </label>
        )}
      </div>
      {/* Form mode: path/query/header "Map from..." needs an upstream node.
          Raw mode: tag chips in the editors have their own empty-state messaging. */}
      {ancestorNodes.length === 0 && bodyMode === 'form' && fields.length > 0 && (
        <p className="node-inspector__hint">
          Connect this node from another on the canvas (drag box to box) to enable "Map from...".
        </p>
      )}

      {switchError && <p className="node-inspector__error">{switchError}</p>}

      {bodyMode === 'raw' && (
        <p className="node-inspector__hint">
          Type <code>{'{{'}</code> inside a string to map a value from an upstream response.
        </p>
      )}

      {pathFields.length > 0 && (
        <section className="node-inspector__section">
          <h4 className="node-inspector__section-title">Path variables</h4>
          {bodyMode === 'form' ? (
            pathFields.map(renderField)
          ) : node.rawPath ? (
            <RawBodyEditor
              rawBody={node.rawPath}
              onChange={(rawPath) => setRawPath(node.id, rawPath)}
              ancestorNodes={ancestorNodes}
              nodeLabels={nodeLabels}
              readOnly={isRunning}
              showHint={false}
            />
          ) : null}
        </section>
      )}

      {queryFields.length > 0 && (
        <section className="node-inspector__section">
          <h4 className="node-inspector__section-title">Query params</h4>
          {bodyMode === 'form' ? (
            queryFields.map(renderField)
          ) : node.rawQuery ? (
            <RawBodyEditor
              rawBody={node.rawQuery}
              onChange={(rawQuery) => setRawQuery(node.id, rawQuery)}
              ancestorNodes={ancestorNodes}
              nodeLabels={nodeLabels}
              readOnly={isRunning}
              showHint={false}
            />
          ) : null}
        </section>
      )}

      {headerFields.length > 0 && (
        <section className="node-inspector__section">
          <h4 className="node-inspector__section-title">Headers</h4>
          {headerFields.map(renderField)}
        </section>
      )}

      {operation.requestBodySchema && (
        <section className="node-inspector__section node-inspector__body">
          <h4 className="node-inspector__section-title">Body</h4>

          {bodyMode === 'form' && hasUnrepresentableShape(operation.requestBodySchema) ? (
            <p className="node-inspector__banner">
              This body has a shape the form can't fully represent (arrays of objects or polymorphic fields).{' '}
              <button type="button" onClick={switchToRaw}>
                Switch to Raw
              </button>
            </p>
          ) : null}

          {bodyMode === 'form' ? (
            bodyFields.map(renderField)
          ) : node.rawBody ? (
            <RawBodyEditor
              rawBody={node.rawBody}
              onChange={(rawBody) => setRawBody(node.id, rawBody)}
              ancestorNodes={ancestorNodes}
              nodeLabels={nodeLabels}
              readOnly={isRunning}
              showHint={false}
            />
          ) : null}
        </section>
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
