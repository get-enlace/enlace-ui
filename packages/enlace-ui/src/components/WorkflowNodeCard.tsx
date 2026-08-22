import { Handle, Position, type NodeProps } from 'reactflow';
import { useWorkflowStore } from '../store/workflowStore.js';
import type { Operation, WorkflowNode } from '../types.js';

export interface WorkflowNodeData {
  node: WorkflowNode;
  operation?: Operation;
  selected: boolean;
}

export function WorkflowNodeCard({ data }: NodeProps<WorkflowNodeData>) {
  const { node, operation, selected } = data;
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const method = operation?.method ?? 'get';

  return (
    <div className={`workflow-node workflow-node--${method}${selected ? ' workflow-node--selected' : ''}`}>
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
      {operation?.summary && <div className="workflow-node__summary">{operation.summary}</div>}
      <Handle type="source" position={Position.Right} title="Drag to connect — sets run order, not data" />
    </div>
  );
}
