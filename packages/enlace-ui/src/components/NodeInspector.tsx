import { useMemo } from 'react';
import { useWorkflowStore } from '../store/workflowStore.js';
import { coerceStaticValue } from '../utils/coerceValue.js';
import { areFieldTypesCompatible, flattenRequestFields, flattenResponseFields } from '../utils/flattenSchema.js';
import { computeAncestors } from '../utils/graph.js';

export interface NodeInspectorProps {
  onCollapse: () => void;
}

export function NodeInspector({ onCollapse }: NodeInspectorProps) {
  const { nodes, connections, operations, selectedNodeId, credentials, setCredential, setFieldValue } =
    useWorkflowStore();

  const node = nodes.find((n) => n.id === selectedNodeId);
  const operation = operations.find((o) => o.id === node?.operationId);
  const fields = useMemo(() => (operation ? flattenRequestFields(operation) : []), [operation]);

  // "map from" may reach any ancestor in the connection graph, not just the
  // node directly before it — e.g. A -> B -> C where B carries no data, C
  // can still map a field from A. See utils/graph.ts.
  const ancestorNodes = useMemo(() => {
    if (!node) return [];
    const ancestorIds = computeAncestors(nodes, connections, node.id);
    return nodes.filter((n) => ancestorIds.has(n.id));
  }, [nodes, connections, node]);

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

  return (
    <aside className="node-inspector">
      <div className="node-inspector__topbar">
        <span>Inspector</span>
        {collapseButton}
      </div>

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
      {ancestorNodes.length === 0 && (
        <p className="node-inspector__hint">
          Connect this node from another on the canvas (drag box to box) to enable "Map from...".
        </p>
      )}
      {fields.map((field) => {
        const fieldValue = node.fieldValues[field.path];
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
                    setFieldValue(node.id, field.path, { source: 'static', value: '' });
                  } else if (ancestorNodes[0]) {
                    setFieldValue(node.id, field.path, {
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
                      setFieldValue(node.id, field.path, {
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
                      setFieldValue(node.id, field.path, {
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
                      setFieldValue(node.id, field.path, {
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
                  onChange={(e) => setFieldValue(node.id, field.path, { ...fieldValue, fromNodeId: e.target.value })}
                >
                  {ancestorNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.operationId} ({n.id.slice(0, 6)})
                    </option>
                  ))}
                </select>
                <select
                  disabled={disabled}
                  value={fieldValue.fromResponseFieldPath}
                  onChange={(e) =>
                    setFieldValue(node.id, field.path, { ...fieldValue, fromResponseFieldPath: e.target.value })
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
      })}
    </aside>
  );
}
