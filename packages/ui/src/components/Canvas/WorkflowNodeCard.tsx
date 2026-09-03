import { Handle, Position, useStore, type NodeProps } from 'reactflow';
import { useWorkflowStore } from '../../store/workflowStore.js';
import { formatWaitDuration } from '@get-enlace/core';
import type { Operation, RunStepStatus, WorkflowNode } from '../../types.js';
import { DeleteNodeIcon, LeaveGroupIcon, STATUS_BADGE_GLYPH } from '../chromeIcons.js';

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
  /** Set when this node belongs to a canvas group — drives the leave-group control. */
  groupId?: string;
  groupName?: string;
}

export function WorkflowNodeCard({ data }: NodeProps<WorkflowNodeData>) {
  const { node, operation, selected, status, label, groupId, groupName } = data;
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const removeFromGroup = useWorkflowStore((s) => s.removeFromGroup);
  // removeNode itself already no-ops while running (workflowStore.ts's
  // isLocked) — disabling the button too is just so it doesn't look
  // clickable when it wouldn't do anything.
  const isRunning = useWorkflowStore((s) => s.isRunning);
  // This button is plain custom chrome, not React Flow's own machinery —
  // so unlike dragging (which RF blocks natively), it has no built-in
  // awareness of the Controls panel's lock/unlock toggle at all and would
  // happily remove a node while the canvas is locked. See Canvas.tsx's
  // elementsSelectable comment for the fuller story (that fix covers
  // click-to-select and Delete/Backspace; this covers this button, the
  // third, separate way a node could be removed).
  const elementsSelectable = useStore((s) => s.elementsSelectable);
  const chromeDisabled = isRunning || !elementsSelectable;
  const isWait = node.kind === 'wait';
  const method = operation?.method ?? 'get';
  // Skip the legend when it would just repeat the method+path already shown in the header below —
  // only worth a second line when the spec names the operation, or this operation appears more
  // than once in the workflow (the "#N" suffix a duplicate gets, the whole reason `label` exists).
  const showLegend = Boolean(operation?.operationId) || (label !== undefined && /#\d+$/.test(label));
  const badgeGlyph = status && STATUS_BADGE_GLYPH[status];

  return (
    // Shell wraps the fieldset so the × can pin to the true top-right of the
    // card. Absolute children of a <fieldset> (especially with a <legend>)
    // sit below the legend/padding in some engines, which left a gap under
    // the top border — see the remove-btn rule in styles/canvas.css.
    <div className="workflow-node-shell">
      {/* A real <fieldset>/<legend> — same as OperationList's cards — so the
          browser cuts the operationId's gap in the top border itself, rather
          than us hand-positioning a label over it. Method color lives only on
          the verb badge; the card chrome is neutral until a run status paints
          a border (see styles/canvas.css's workflow-node--{in-flight,paused,failed}). */}
      <fieldset
        className={`workflow-node${isWait ? ' workflow-node--wait' : ''}${selected ? ' workflow-node--selected' : ''}${status ? ` workflow-node--${status}` : ''}${groupId ? ' workflow-node--grouped' : ''}`}
      >
        {/* No legend on a Wait card — "Wait 2s" already carries the whole
            identity in the header below, unlike an operation card where the
            legend is the only place operationId/#N ever shows. */}
        {!isWait && showLegend && <legend className="workflow-node__operation-id">{label}</legend>}
        {badgeGlyph && (
          <span className={`workflow-node__status-badge workflow-node__status-badge--${status}`} aria-hidden="true">
            {badgeGlyph}
          </span>
        )}
        {/* Drag from one box's right handle to another's left handle to
            establish execution ORDER (a WorkflowConnection) — separate from
            field mapping (data source), which stays in the Node Config's
            "map from..." picker. onConnect is wired up in Canvas.tsx. */}
        <Handle type="target" position={Position.Left} title="Drop here to connect" />
        {isWait ? (
          <div className="workflow-node__header">
            <span className="wait-node__icon" aria-hidden="true">
              ⏱
            </span>
            <span className="wait-node__label">Wait {formatWaitDuration(node.durationMs ?? 0)}</span>
          </div>
        ) : (
          <>
            <div className="workflow-node__header">
              <span className={`method-badge method-badge--${method}`}>{method.toUpperCase()}</span>
              <span className="workflow-node__path">{operation?.path ?? 'Unknown operation'}</span>
            </div>
            {operation?.summary && (
              <div className="workflow-node__summary" title={operation.summary}>
                {operation.summary}
              </div>
            )}
          </>
        )}
        {/* Point-of-truth for "why hasn't this fired" without needing the
            Debugger tab open — the corner badge alone reads as "something's
            up" at a glance across a busy canvas, this line says what. */}
        {status === 'paused' && <div className="workflow-node__paused-label">⏸ Paused here</div>}
        <Handle type="source" position={Position.Right} title="Drag to connect" />
      </fieldset>
      {/* After the fieldset so it paints above the card border — a sibling
          underneath let the fieldset's top/right edges cut through the × and
          look like a half-ring when the button itself had no border.
          `nodrag`/`nopan`: React Flow's convention for interactive chrome
          inside a node (same as BreakpointConnectionEdge). Without them, a
          mousedown on × starts a node-drag via RF's native listeners —
          React's stopPropagation alone doesn't reach those — and the click
          that should call removeNode never lands, especially right after
          selecting a previously-deselected node. */}
      {groupId && (
        <button
          type="button"
          className="nodrag nopan workflow-node__leave-group-btn"
          disabled={chromeDisabled}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            removeFromGroup(groupId, node.id);
          }}
          title={
            isRunning
              ? "Can't leave a group while the workflow is running"
              : !elementsSelectable
                ? 'Canvas is locked — unlock it to edit groups'
                : `Remove from group${groupName ? ` “${groupName}”` : ''} — keeps the node on the canvas`
          }
          aria-label="Remove from group"
        >
          <LeaveGroupIcon />
        </button>
      )}
      <button
        type="button"
        className="nodrag nopan workflow-node__remove-btn"
        disabled={chromeDisabled}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          removeNode(node.id);
        }}
        title={
          isRunning
            ? "Can't remove a node while the workflow is running"
            : !elementsSelectable
              ? 'Canvas is locked — unlock it to remove nodes'
              : 'Remove this node'
        }
        aria-label="Remove this node"
      >
        <DeleteNodeIcon />
      </button>
    </div>
  );
}
