import { useEffect, useMemo, useRef, useState } from 'react';
import { aiSuggestionKey, useWorkflowStore } from '../../store/workflowStore.js';
import { coerceStaticValue } from '../../utils/coerceValue.js';
import { areFieldTypesCompatible, flattenRequestFields, flattenResponseFields } from '../../utils/flattenSchema.js';
import { buildNodeLabels, computeAncestors, formatPresetLabel } from '@get-enlace/core';
import { hasUnrepresentableShape } from '../../utils/schemaExample.js';
import { buildRawBodyFromForm, buildRawParamsFromForm, convertRawBodyToFieldValues, convertRawParamsToFieldValues } from '../../utils/bodyTemplate.js';
import { RawBodyEditor } from './RawBodyEditor.js';
import { Modal } from '../Modal.js';
import { LockIcon, SparkleIcon, TrashIcon, UploadIcon } from '../chromeIcons.js';
import type { SchemaField } from '../../utils/flattenSchema.js';
import type { AssertCheck, AssertOperator, BodyTagType, FieldValue, Operation, WorkflowNode } from '../../types.js';

/** An ancestor node picked as a "map from…" source may be either kind — a presets collection has no `operationId` at all. `undefined` in that case, same as a plain missing operationId. */
function operationIdOf(node: WorkflowNode | undefined): string | undefined {
  return node && node.kind !== 'presets' ? node.operationId : undefined;
}

const SOURCE_TYPE_LABELS: Record<BodyTagType, string> = {
  response_status: 'Status',
  response_body: 'Body field',
  response_header: 'Header',
  response_raw: 'Raw body',
};

const OPERATOR_LABELS: Record<AssertOperator, string> = {
  equals: 'equals',
  notEquals: 'not equals',
  contains: 'contains',
  exists: 'exists',
  notExists: "doesn't exist",
  greaterThan: '>',
  lessThan: '<',
};

/**
 * One check row inside an assert preset's config — source node + what to
 * read from it (mirrors this file's own request-field "Map from..."
 * picker, minus its target-field type-compatibility filtering: a check
 * isn't matching against a typed request field, any response shape is
 * fair game) + the comparison itself. Lives here, not on the presets
 * canvas card — see NodeConfig's own presets-kind branch below for why.
 */
function AssertCheckRow({
  check,
  index,
  ancestorNodes,
  operations,
  nodeLabels,
  disabled,
  onUpdate,
  onRemove,
}: {
  check: AssertCheck;
  index: number;
  ancestorNodes: WorkflowNode[];
  operations: Operation[];
  nodeLabels: Map<string, string>;
  disabled: boolean;
  onUpdate: (patch: Partial<Omit<AssertCheck, 'id'>>) => void;
  onRemove: () => void;
}) {
  const sourceNode = ancestorNodes.find((n) => n.id === check.source.sourceNodeId);
  const sourceOperation = operations.find((o) => o.id === operationIdOf(sourceNode));
  const responseFields = sourceOperation ? flattenResponseFields(sourceOperation) : [];
  const needsExpected = check.operator !== 'exists' && check.operator !== 'notExists';

  return (
    <li className="node-config__check-row">
      <select
        disabled={disabled}
        aria-label={`Check ${index + 1} source node`}
        value={check.source.sourceNodeId}
        onChange={(e) => onUpdate({ source: { ...check.source, sourceNodeId: e.target.value } })}
      >
        <option value="">Select node...</option>
        {ancestorNodes.map((n) => (
          <option key={n.id} value={n.id}>
            {nodeLabels.get(n.id) ?? n.id}
          </option>
        ))}
      </select>
      <select
        disabled={disabled}
        aria-label={`Check ${index + 1} source type`}
        value={check.source.type}
        onChange={(e) => onUpdate({ source: { ...check.source, type: e.target.value as BodyTagType } })}
      >
        {(Object.keys(SOURCE_TYPE_LABELS) as BodyTagType[]).map((type) => (
          <option key={type} value={type}>
            {SOURCE_TYPE_LABELS[type]}
          </option>
        ))}
      </select>
      {check.source.type === 'response_body' &&
        (responseFields.length > 0 ? (
          <select
            disabled={disabled}
            aria-label={`Check ${index + 1} response field`}
            value={check.source.jsonPath ?? ''}
            onChange={(e) => onUpdate({ source: { ...check.source, jsonPath: e.target.value } })}
          >
            <option value="">Select field...</option>
            {responseFields.map((rf) => (
              <option key={rf.path} value={rf.path} disabled={!rf.supported} title={rf.reason}>
                {rf.path}
                {!rf.supported ? ' (unsupported)' : ''}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            disabled={disabled}
            placeholder="e.g. items[0].id"
            aria-label={`Check ${index + 1} response field path`}
            value={check.source.jsonPath ?? ''}
            onChange={(e) => onUpdate({ source: { ...check.source, jsonPath: e.target.value } })}
          />
        ))}
      {check.source.type === 'response_header' && (
        <input
          type="text"
          disabled={disabled}
          placeholder="e.g. x-trace-id"
          aria-label={`Check ${index + 1} header name`}
          value={check.source.headerName ?? ''}
          onChange={(e) => onUpdate({ source: { ...check.source, headerName: e.target.value } })}
        />
      )}
      <select
        disabled={disabled}
        aria-label={`Check ${index + 1} operator`}
        value={check.operator}
        onChange={(e) => onUpdate({ operator: e.target.value as AssertOperator })}
      >
        {(Object.keys(OPERATOR_LABELS) as AssertOperator[]).map((op) => (
          <option key={op} value={op}>
            {OPERATOR_LABELS[op]}
          </option>
        ))}
      </select>
      {needsExpected && (
        <input
          type="text"
          disabled={disabled}
          placeholder="expected value"
          aria-label={`Check ${index + 1} expected value`}
          value={check.expected ?? ''}
          onChange={(e) => onUpdate({ expected: e.target.value })}
        />
      )}
      <button
        type="button"
        className="node-config__check-remove"
        disabled={disabled}
        aria-label={`Remove check ${index + 1}`}
        title="Remove check"
        onClick={onRemove}
      >
        ×
      </button>
    </li>
  );
}

export function NodeConfig() {
  const {
    nodes,
    connections,
    operations,
    selectedNodeId,
    selectedPresetId,
    credentials,
    isRunning,
    aiCapabilities,
    aiSuggestionsByKey,
    aiCredentialSuggestionByNodeId,
    requestNodeSuggestions,
    acceptAiSuggestion,
    dismissAiSuggestion,
    acceptAllAiSuggestions,
    dismissAllAiSuggestions,
    setCredential,
    setFieldValue,
    mergeFieldValues,
    setCredentialExtraParamOverride,
    setCredentialExtraParamOverridesEnabled,
    setUploadedFile,
    setRequestMode,
    setRawPath,
    setRawQuery,
    setRawBody,
    setPresetDurationMs,
    addAssertCheck,
    removeAssertCheck,
    updateAssertCheck,
  } = useWorkflowStore();

  const node = nodes.find((n) => n.id === selectedNodeId);
  const operation = operations.find((o) => o.id === operationIdOf(node));
  const operationsById = useMemo(() => new Map(operations.map((o) => [o.id, o])), [operations]);
  const fields = useMemo(() => (operation ? flattenRequestFields(operation) : []), [operation]);
  const pathFields = useMemo(() => fields.filter((f) => f.path.startsWith('path.')), [fields]);
  const queryFields = useMemo(() => fields.filter((f) => f.path.startsWith('query.')), [fields]);
  const headerFields = useMemo(() => fields.filter((f) => f.path.startsWith('header.')), [fields]);
  const bodyFields = useMemo(() => fields.filter((f) => f.path.startsWith('body.')), [fields]);
  // What requestNodeSuggestions actually asks the model about — path/query/body,
  // never header, never a field the schema can't represent. Mirrors
  // slices/aiSlice.ts's own suggestableFieldsOf so the button's enabled state
  // matches what a click would actually do.
  const suggestableFields = useMemo(() => fields.filter((f) => f.supported && !f.path.startsWith('header.')), [fields]);

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

  // A preset's own config lives here, not on the canvas card — the card
  // (PresetsNodeCard.tsx) only ever shows a summary row (icon +
  // formatPresetLabel) plus reorder/remove, so every row stays the same
  // compact width regardless of kind; clicking one just calls
  // `selectPreset`, which is what `selectedPresetId` reflects. Reorder,
  // add (drag from the palette), and remove-the-whole-preset stay on the
  // card itself — only per-preset *configuration* moved.
  if (node && node.kind === 'presets') {
    const preset = node.presets?.find((p) => p.id === selectedPresetId);
    if (!preset) {
      return (
        <aside className="node-config node-config--empty">
          <p className="node-config__empty-msg">Select a preset on the canvas to configure it.</p>
        </aside>
      );
    }
    return (
      <aside className="node-config">
        {isRunning && (
          <p className="node-config__banner">Workflow is running — editing is locked until it finishes.</p>
        )}
        <fieldset className="node-config__fieldset" disabled={isRunning}>
          <div className="node-config__header">
            <div className="node-config__op-title">
              <span
                className={`presets-node__step-icon${preset.kind === 'assert' ? ' presets-node__step-icon--assert' : ' presets-node__step-icon--wait'}`}
                aria-hidden="true"
              >
                {preset.kind === 'wait' ? '⏱' : '✓'}
              </span>
              <h2 className="node-config__path">{formatPresetLabel(preset)}</h2>
            </div>
          </div>

          {preset.kind === 'wait' ? (
            <div className="node-config__field">
              <label>Duration (seconds)</label>
              <div className="node-config__field-row">
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  aria-label="Duration in seconds"
                  value={(preset.durationMs ?? 0) / 1000}
                  onChange={(e) => {
                    const seconds = Number(e.target.value);
                    const nextMs = Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : 0;
                    setPresetDurationMs(node!.id, preset.id, nextMs);
                  }}
                />
              </div>
            </div>
          ) : (
            <section className="node-config__section">
              <h4 className="node-config__section-title">Checks</h4>
              {(preset.checks ?? []).length === 0 && <p className="node-config__hint">No checks yet — add one below.</p>}
              <ul className="node-config__check-list">
                {(preset.checks ?? []).map((check, index) => (
                  <AssertCheckRow
                    key={check.id}
                    check={check}
                    index={index}
                    ancestorNodes={ancestorNodes}
                    operations={operations}
                    nodeLabels={nodeLabels}
                    disabled={isRunning}
                    onUpdate={(patch) => updateAssertCheck(node!.id, preset.id, check.id, patch)}
                    onRemove={() => removeAssertCheck(node!.id, preset.id, check.id)}
                  />
                ))}
              </ul>
              <button type="button" className="node-config__add-check" onClick={() => addAssertCheck(node!.id, preset.id)}>
                + Add check
              </button>
            </section>
          )}
        </fieldset>
      </aside>
    );
  }

  if (!node || !operation) {
    return (
      <aside className="node-config node-config--empty">
        <p className="node-config__empty-msg">Select a node to configure it.</p>
      </aside>
    );
  }
  // Narrowed to OperationNode by the presets-kind branch's own early return
  // above — captured in its own const (rather than relying on nested
  // closures below to keep re-deriving the narrowing from `node`, which TS
  // doesn't carry through a function declaration's body) so the rest of
  // this component can read operation-only fields directly.
  const opNode = node;

  const isMultipart = operation.requestBodyContentType === 'multipart/form-data';
  // Multipart bodies can't be represented as Raw JSON (a File isn't text), so
  // force Form mode and hide the toggle for these operations.
  const bodyMode = isMultipart ? 'form' : (node.requestMode ?? 'form');
  const hasRequestToggle =
    !isMultipart && (pathFields.length > 0 || queryFields.length > 0 || Boolean(operation.requestBodySchema));
  // Suggest-values only makes sense in Form mode — Raw mode edits path/query/body
  // as JSON with its own tag-chip mapping UI, not the per-field rows renderField
  // produces suggestion panels under.
  const canSuggestNode = Boolean(aiCapabilities?.enabled) && bodyMode === 'form' && suggestableFields.length > 0;
  const nodeSuggestionLoading = suggestableFields.some(
    (f) => aiSuggestionsByKey[aiSuggestionKey(node!.id, f.path)]?.status === 'loading'
  );
  const selectedCredential = credentials.find((c) => c.id === node.credentialId) ?? null;
  // Only these two grant types have extraTokenParams at all — see
  // WorkflowNode.credentialExtraParamOverrides's own comment on why this
  // stays a per-node override rather than living on the shared Credential.
  const extraParamKeys =
    selectedCredential?.type === 'oauth2_clientCredentials' || selectedCredential?.type === 'oauth2_password'
      ? Object.keys(selectedCredential.extraTokenParams ?? {})
      : [];
  const overridesEnabled = node.credentialExtraParamOverridesEnabled ?? false;

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

    if (opNode.rawPath && pathFields.length > 0) {
      const result = convertRawParamsToFieldValues('path', opNode.rawPath, operation);
      if (result.parseError) {
        setSwitchError(`Can't switch to Form view — path Raw JSON isn't valid: ${result.parseError}`);
        return;
      }
      Object.assign(merged, result.fieldValues);
      lossy = lossy || result.lossy;
    }
    if (opNode.rawQuery && queryFields.length > 0) {
      const result = convertRawParamsToFieldValues('query', opNode.rawQuery, operation);
      if (result.parseError) {
        setSwitchError(`Can't switch to Form view — query Raw JSON isn't valid: ${result.parseError}`);
        return;
      }
      Object.assign(merged, result.fieldValues);
      lossy = lossy || result.lossy;
    }
    if (opNode.rawBody && operation.requestBodySchema) {
      const result = convertRawBodyToFieldValues(opNode.rawBody, operation);
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

  // One-line preview of an AI-suggested value, shown in the accept/reject
  // panel before the user commits — mirrors how a Mapped field's own two
  // selects would read once applied, so the preview text and the field's
  // eventual post-Use appearance say the same thing.
  function describeAiSuggestion(fieldValue: FieldValue): string {
    if (fieldValue.source === 'mapped') {
      return `mapped from "${nodeLabels.get(fieldValue.fromNodeId) ?? fieldValue.fromNodeId}" → "${fieldValue.fromResponseFieldPath}"`;
    }
    if (fieldValue.source === 'static') {
      return String(fieldValue.value);
    }
    return '';
  }

  /**
   * Node-wide summary banner, shown once a requestNodeSuggestions call for
   * the selected node has resolved (not while it's still loading — the
   * per-field/per-credential panels below already cover that) and at least
   * one entry exists. "Accept all" applies every currently-'suggested'
   * field plus the credential suggestion in one go (acceptAllAiSuggestions)
   * — the granular per-field Use/Dismiss panels in renderField still work
   * independently for anyone who wants to cherry-pick instead.
   */
  function renderAiSuggestionBanner() {
    const prefix = `${node!.id}::`;
    const fieldEntries = Object.entries(aiSuggestionsByKey).filter(([key]) => key.startsWith(prefix));
    const credentialEntry = aiCredentialSuggestionByNodeId[node!.id];
    if (fieldEntries.length === 0 && !credentialEntry) return null;

    const anyLoading = fieldEntries.some(([, e]) => e.status === 'loading') || credentialEntry?.status === 'loading';
    if (anyLoading) return null;

    const suggestedFieldCount = fieldEntries.filter(([, e]) => e.status === 'suggested').length;
    const credentialSuggested = credentialEntry?.status === 'suggested';
    const totalSuggested = suggestedFieldCount + (credentialSuggested ? 1 : 0);

    const credentialName = credentialSuggested
      ? (credentials.find((c) => c.id === credentialEntry.credentialId)?.name ?? credentialEntry.credentialId)
      : null;

    const parts = [
      suggestedFieldCount > 0 ? `${suggestedFieldCount} field${suggestedFieldCount === 1 ? '' : 's'}` : null,
      credentialName ? `credential "${credentialName}"` : null,
    ].filter((p): p is string => p !== null);
    const summary = totalSuggested === 0 ? 'AI found no suggestions for this node.' : `AI suggested ${parts.join(' and ')}.`;

    return (
      // Reuses the same per-field suggestion-panel chrome (.node-config__ai-suggestion)
      // rather than a bespoke banner style — same visual language, just placed once
      // under the header instead of once per field.
      <div className="node-config__ai-suggestion node-config__ai-suggestion--banner">
        <span className="node-config__ai-suggestion-text">{summary}</span>
        {totalSuggested > 0 && (
          <button type="button" onClick={() => acceptAllAiSuggestions(node!.id)}>
            Accept all
          </button>
        )}
        <button type="button" onClick={() => dismissAllAiSuggestions(node!.id)}>
          Dismiss all
        </button>
      </div>
    );
  }

  function renderField(field: SchemaField) {
    const fieldValue = node!.fieldValues[field.path];
    const isFileField = field.format === 'binary';
    const isMapped = !isFileField && fieldValue?.source === 'mapped';
    const disabled = !field.supported;
    // Populated (if at all) by the node-level Suggest button above, not a
    // per-field affordance here — see canSuggestNode/requestNodeSuggestions.
    const suggestionEntry = aiSuggestionsByKey[aiSuggestionKey(node!.id, field.path)];

    // Nested/array fields are still shown, just disabled — a missing
    // field looks like a bug, a disabled one with a reason doesn't.
    const sourceNode = isMapped ? ancestorNodes.find((n) => n.id === fieldValue.fromNodeId) : undefined;
    const sourceOperation = operations.find((o) => o.id === operationIdOf(sourceNode));
    const responseFields = sourceOperation ? flattenResponseFields(sourceOperation) : [];

    if (isFileField) {
      const fileName = fieldValue?.source === 'file' ? fieldValue.fileName : '';
      return (
        <div
          key={field.path}
          className={`node-config__field${disabled ? ' node-config__field--disabled' : ''}`}
          title={field.reason}
        >
          <label>
            {field.path}
            {field.required ? ' *' : ''}
            {' (file)'}
            {disabled ? ' (unsupported)' : ''}
          </label>
          <div
            className={`node-config__file-drop${fileName ? ' node-config__file-drop--filled' : ''}${disabled ? ' node-config__file-drop--disabled' : ''}`}
          >
            {fileName ? (
              <>
                <span className="node-config__file-name" title={fileName}>
                  {fileName}
                </span>
                <button
                  type="button"
                  className="node-config__file-clear"
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
                  className="node-config__file-input"
                  disabled={disabled}
                  aria-label={field.path}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setUploadedFile(node!.id, field.path, file);
                  }}
                />
                <span className="node-config__file-prompt" aria-hidden="true">
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
        className={`node-config__field${disabled ? ' node-config__field--disabled' : ''}`}
        title={field.reason}
      >
        <label>
          {field.path}
          {field.required ? ' *' : ''}
          {field.type ? ` (${field.type})` : ''}
          {disabled ? ' (unsupported)' : ''}
        </label>

        <div className={`node-config__field-row${isMapped ? ' node-config__field-row--mapped' : ''}`}>
          <select
            className="node-config__source-select"
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

        {suggestionEntry && suggestionEntry.status !== 'loading' && (
          <div className="node-config__ai-suggestion">
            {suggestionEntry.status === 'suggested' && (
              <>
                <span className="node-config__ai-suggestion-text">
                  AI suggests: {describeAiSuggestion(suggestionEntry.fieldValue)}
                </span>
                <button type="button" onClick={() => acceptAiSuggestion(node!.id, field.path)}>
                  Use
                </button>
                <button type="button" onClick={() => dismissAiSuggestion(node!.id, field.path)}>
                  Dismiss
                </button>
              </>
            )}
            {suggestionEntry.status === 'none' && (
              <>
                <span className="node-config__ai-suggestion-text">No suggestion available.</span>
                <button type="button" onClick={() => dismissAiSuggestion(node!.id, field.path)}>
                  Dismiss
                </button>
              </>
            )}
            {suggestionEntry.status === 'error' && (
              <>
                <span className="node-config__ai-suggestion-text node-config__ai-suggestion-text--error">
                  {suggestionEntry.error}
                </span>
                {/* No per-field retry endpoint exists anymore — this re-runs the whole node's single suggestion call, same as the Suggest button above. */}
                <button type="button" title="Re-run AI suggestions for this node" onClick={() => requestNodeSuggestions(node!.id)}>
                  Retry
                </button>
                <button type="button" onClick={() => dismissAiSuggestion(node!.id, field.path)}>
                  Dismiss
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  /**
   * One row per key the attached oauth2 credential declares in its
   * `extraTokenParams`, always visible while `overridesEnabled` (the
   * section's own toggle) is on — three states: "Default" (no entry in
   * `credentialExtraParamOverrides`, falls through to whatever the
   * credential itself has configured), "Mapped" (pulled from an ancestor
   * node's response), "Static" (a literal value typed here, scoped to this
   * node only — for when you want a different value per node without
   * editing the shared credential).
   */
  function renderCredentialParamOverride(key: string) {
    const override = opNode.credentialExtraParamOverrides?.[key];
    const mode = override?.source ?? 'default';
    const isMapped = override?.source === 'mapped';
    const sourceNode = isMapped ? ancestorNodes.find((n) => n.id === override.fromNodeId) : undefined;
    const sourceOperation = operations.find((o) => o.id === operationIdOf(sourceNode));
    const responseFields = sourceOperation ? flattenResponseFields(sourceOperation) : [];

    return (
      <div key={key} className="node-config__field">
        <label>{key}</label>

        <div className={`node-config__field-row${isMapped ? ' node-config__field-row--mapped' : ''}`}>
          <select
            className="node-config__source-select"
            value={mode}
            aria-label={`Source for extra param ${key}`}
            onChange={(e) => {
              const next = e.target.value;
              if (next === 'default') {
                setCredentialExtraParamOverride(node!.id, key, null);
              } else if (next === 'static') {
                setCredentialExtraParamOverride(node!.id, key, { source: 'static', value: '' });
              } else if (next === 'mapped' && ancestorNodes[0]) {
                setCredentialExtraParamOverride(node!.id, key, {
                  source: 'mapped',
                  fromNodeId: ancestorNodes[0].id,
                  fromResponseFieldPath: '',
                });
              }
            }}
          >
            <option value="default">Default</option>
            <option value="mapped" disabled={ancestorNodes.length === 0}>
              Mapped
            </option>
            <option value="static">Static</option>
          </select>

          {override?.source === 'static' && (
            <input
              type="text"
              aria-label={`Static value for extra param ${key}`}
              value={String(override.value ?? '')}
              onChange={(e) => setCredentialExtraParamOverride(node!.id, key, { source: 'static', value: e.target.value })}
            />
          )}

          {override?.source === 'mapped' && (
            <>
              <select
                aria-label={`Map extra param ${key} from node`}
                value={override.fromNodeId}
                onChange={(e) =>
                  setCredentialExtraParamOverride(node!.id, key, { ...override, fromNodeId: e.target.value })
                }
              >
                {ancestorNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {nodeLabels.get(n.id)}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Map extra param ${key} from response field`}
                value={override.fromResponseFieldPath}
                onChange={(e) =>
                  setCredentialExtraParamOverride(node!.id, key, {
                    ...override,
                    fromResponseFieldPath: e.target.value,
                  })
                }
              >
                <option value="">Select field...</option>
                {responseFields.map((rf) => (
                  <option key={rf.path} value={rf.path} disabled={!rf.supported} title={rf.reason}>
                    {rf.path}
                    {!rf.supported ? ' (unsupported)' : ''}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <aside className="node-config">
      {/* Operation verb+path is the pane header (no separate "Inspector" title).
          Credential lock stays here — it's about this operation, not chrome. */}
      {isRunning && (
        <p className="node-config__banner">Workflow is running — editing is locked until it finishes.</p>
      )}
      <fieldset className="node-config__fieldset" disabled={isRunning}>
      <div className="node-config__header" ref={credPickerRef}>
        <div className="node-config__op-title">
          <button
            type="button"
            className={`node-config__cred-lock${selectedCredential ? ' node-config__cred-lock--set' : ''}`}
            aria-label="Credential"
            aria-expanded={credPickerOpen}
            aria-haspopup="listbox"
            title={selectedCredential ? `Credential: ${selectedCredential.name}` : 'No credential'}
            onClick={() => setCredPickerOpen((open) => !open)}
          >
            <LockIcon />
          </button>
          <span className={`method-badge method-badge--${operation.method}`}>{operation.method.toUpperCase()}</span>
          <h2 className="node-config__path">{operation.path}</h2>
          {canSuggestNode && (
            <button
              type="button"
              className={`node-config__ai-suggest-node${nodeSuggestionLoading ? ' node-config__ai-suggest-node--loading' : ''}`}
              title="Suggest values for this node (AI)"
              aria-label="Suggest values for this node (AI)"
              // disabled only to prevent duplicate clicks while this one
              // request resolves — every field in this panel stays fully
              // interactive throughout, per the non-blocking requirement.
              disabled={nodeSuggestionLoading}
              onClick={() => requestNodeSuggestions(node!.id)}
            >
              <SparkleIcon />
            </button>
          )}
        </div>
        {credPickerOpen && (
          <ul className="node-config__cred-menu" role="listbox" aria-label="Available credentials">
            <li role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={!selectedCredential}
                className={`node-config__cred-option${!selectedCredential ? ' node-config__cred-option--active' : ''}`}
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
                  className={`node-config__cred-option${selectedCredential?.id === c.id ? ' node-config__cred-option--active' : ''}`}
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

      {renderAiSuggestionBanner()}

      {extraParamKeys.length > 0 && (
        <section className="node-config__section">
          <div className="node-config__request-header">
            <h4 className="node-config__section-title">Override credential extra params?</h4>
            <label className="body-mode-switch" title="Override this node's oauth2 credential's extra token params.">
              <span className="body-mode-switch__label">{overridesEnabled ? 'On' : 'Off'}</span>
              <input
                type="checkbox"
                checked={overridesEnabled}
                onChange={(e) => setCredentialExtraParamOverridesEnabled(node!.id, e.target.checked)}
                aria-label="Override credential extra params"
              />
              <span className="body-mode-switch__track">
                <span className="body-mode-switch__thumb" />
              </span>
            </label>
          </div>
          {overridesEnabled && extraParamKeys.map(renderCredentialParamOverride)}
        </section>
      )}

      <div className="node-config__request-header">
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
        <p className="node-config__hint">
          Connect this node from another on the canvas (drag box to box) to enable "Map from...".
        </p>
      )}

      {switchError && <p className="node-config__error">{switchError}</p>}

      {bodyMode === 'raw' && (
        <p className="node-config__hint">
          Type <code>{'{{'}</code> inside a string to map a value from an upstream response.
        </p>
      )}

      {pathFields.length > 0 && (
        <section className="node-config__section">
          <h4 className="node-config__section-title">Path variables</h4>
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
        <section className="node-config__section">
          <h4 className="node-config__section-title">Query params</h4>
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
        <section className="node-config__section">
          <h4 className="node-config__section-title">Headers</h4>
          {headerFields.map(renderField)}
        </section>
      )}

      {operation.requestBodySchema && (
        <section className="node-config__section node-config__body">
          <h4 className="node-config__section-title">Body</h4>

          {bodyMode === 'form' && hasUnrepresentableShape(operation.requestBodySchema) ? (
            <p className="node-config__banner">
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
