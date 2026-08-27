import { Handle, Position, type NodeProps } from 'reactflow';
import { useWorkflowStore } from '../store/workflowStore.js';
import type { Operation, WorkflowNode } from '../types.js';

export interface WorkflowNodeData {
  node: WorkflowNode;
  operation?: Operation;
  selected: boolean;
  /**
   * Precomputed by Canvas via utils/nodeLabel.ts's `buildNodeLabels`, across every node in the
   * workflow at once — global, not scoped to this node's neighborhood, so a node used twice
   * always shows the same "createCustomer #1"/"createCustomer #2" here as it does in every
   * "Map from..." picker and tag chip elsewhere. That "#N" is the only reason this exists
   * separately from `operation.operationId` — otherwise the two agree.
   */
  label?: string;
}

export function WorkflowNodeCard({ data }: NodeProps<WorkflowNodeData>) {
  const { node, operation, selected, label } = data;
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const method = operation?.method ?? 'get';
  // Skip the legend when it would just repeat the method+path already shown in the header below —
  // only worth a second line when the spec names the operation, or this operation appears more
  // than once in the workflow (the "#N" suffix a duplicate gets, the whole reason `label` exists).
  const showLegend = Boolean(operation?.operationId) || (label !== undefined && /#\d+$/.test(label));

  return (
    // A real <fieldset>/<legend> — same as OperationList's cards — so the
    // browser cuts the operationId's gap in the top border itself, rather
    // than us hand-positioning a label over it.
    <fieldset className={`workflow-node workflow-node--${method}${selected ? ' workflow-node--selected' : ''}`}>
      {showLegend && <legend className="workflow-node__operation-id">{label}</legend>}
      {/* Drag from one box's right handle to another's left handle to
          establish execution ORDER (a WorkflowConnection) — separate from
          field mapping (data source), which stays in the Node Inspector's
          "map from..." picker. onConnect is wired up in Canvas.tsx. */}
      <Handle type="target" position={Position.Left} title="Drop here to connect — sets run order, not data" />
      <button
        type="button"
        className="workflow-node__remove-btn"
        // Stop both so this doesn't also select the node or start a
        // React-Flow drag gesture before the click registers.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          removeNode(node.id);
        }}
        title="Remove this node"
        aria-label="Remove this node"
      >
        ×
      </button>
      <div className="workflow-node__header">
        <span className={`method-badge method-badge--${method}`}>{method.toUpperCase()}</span>
        <span className="workflow-node__path">{operation?.path ?? 'Unknown operation'}</span>
      </div>
      {operation?.summary && (
        <div className="workflow-node__summary" title={operation.summary}>
          {operation.summary}
        </div>
      )}
      <Handle type="source" position={Position.Right} title="Drag to connect — sets run order, not data" />
    </fieldset>
  );
}
