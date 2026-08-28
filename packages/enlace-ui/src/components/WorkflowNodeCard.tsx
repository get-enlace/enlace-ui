import { Handle, Position, type NodeProps } from 'reactflow';
import { useWorkflowStore } from '../store/workflowStore.js';
import type { Operation, RunStepStatus, WorkflowNode } from '../types.js';

export interface WorkflowNodeData {
  node: WorkflowNode;
  operation?: Operation;
  selected: boolean;
  /**
   * This node's live status for the current/last run — sourced from the
   * store's `stepStatusByNodeId` (see store/workflowStore.ts's `run()`,
   * which streams `executeChain`'s per-node events live). `undefined`
   * before any run. Purely a transient visual cue; not persisted, and
   * unrelated to `selected`. Only `'in-flight'`/`'paused'`/`'completed'`/
   * `'failed'` get a visual treatment here — `'pending'`/`'skipped'` render
   * like a node with no run history at all.
   */
  status?: RunStepStatus;
  /**
   * Precomputed by Canvas via utils/nodeLabel.ts's `buildNodeLabels`, across every node in the
   * workflow at once — global, not scoped to this node's neighborhood, so a node used twice
   * always shows the same "createCustomer #1"/"createCustomer #2" here as it does in every
   * "Map from..." picker and tag chip elsewhere. That "#N" is the only reason this exists
   * separately from `operation.operationId` — otherwise the two agree.
   */
  label?: string;
}

// A small badge at the card's top-left corner (the remove button already
// owns top-right) — only for the statuses worth calling out at a glance on
// the canvas itself, without opening the Debugger tab. Text content is the
// glyph; styling (color, per status) lives in styles.css.
// Note: failed is `!`, not an `×`/`✕` — the remove button on the opposite
// corner is already an `×`, so a red-circle-with-an-X badge would read as
// a second "cancel/close" affordance rather than a failure indicator.
const STATUS_BADGE_GLYPH: Partial<Record<RunStepStatus, string>> = {
  'in-flight': '●',
  paused: '⏸',
  completed: '✓',
  failed: '!',
};

export function WorkflowNodeCard({ data }: NodeProps<WorkflowNodeData>) {
  const { node, operation, selected, status, label } = data;
  const removeNode = useWorkflowStore((s) => s.removeNode);
  // removeNode itself already no-ops while running (workflowStore.ts's
  // isLocked) — disabling the button too is just so it doesn't look
  // clickable when it wouldn't do anything.
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const method = operation?.method ?? 'get';
  // Skip the legend when it would just repeat the method+path already shown in the header below —
  // only worth a second line when the spec names the operation, or this operation appears more
  // than once in the workflow (the "#N" suffix a duplicate gets, the whole reason `label` exists).
  const showLegend = Boolean(operation?.operationId) || (label !== undefined && /#\d+$/.test(label));
  const badgeGlyph = status && STATUS_BADGE_GLYPH[status];

  return (
    // A real <fieldset>/<legend> — same as OperationList's cards — so the
    // browser cuts the operationId's gap in the top border itself, rather
    // than us hand-positioning a label over it.
    <fieldset
      className={`workflow-node workflow-node--${method}${selected ? ' workflow-node--selected' : ''}${status ? ` workflow-node--${status}` : ''}`}
    >
      {showLegend && <legend className="workflow-node__operation-id">{label}</legend>}
      {badgeGlyph && (
        <span className={`workflow-node__status-badge workflow-node__status-badge--${status}`} aria-hidden="true">
          {badgeGlyph}
        </span>
      )}
      {/* Drag from one box's right handle to another's left handle to
          establish execution ORDER (a WorkflowConnection) — separate from
          field mapping (data source), which stays in the Node Inspector's
          "map from..." picker. onConnect is wired up in Canvas.tsx. */}
      <Handle type="target" position={Position.Left} title="Drop here to connect — sets run order, not data" />
      <button
        type="button"
        className="workflow-node__remove-btn"
        disabled={isRunning}
        // Stop both so this doesn't also select the node or start a
        // React-Flow drag gesture before the click registers.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          removeNode(node.id);
        }}
        title={isRunning ? "Can't remove a node while the workflow is running" : 'Remove this node'}
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
      {/* Point-of-truth for "why hasn't this fired" without needing the
          Debugger tab open — the corner badge alone reads as "something's
          up" at a glance across a busy canvas, this line says what. */}
      {status === 'paused' && <div className="workflow-node__paused-label">⏸ Paused here</div>}
      <Handle type="source" position={Position.Right} title="Drag to connect — sets run order, not data" />
    </fieldset>
  );
}
