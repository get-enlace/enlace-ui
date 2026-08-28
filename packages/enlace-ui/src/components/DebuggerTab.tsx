import { useMemo } from 'react';
import { CyclicWorkflowError, topologicalSort } from '../engine/chainExecutor.js';
import { useWorkflowStore } from '../store/workflowStore.js';
import { redactRequest } from './debugPaneShared.js';
import type { Operation, RunStep, RunStepRequest, RunStepStatus, WorkflowNode } from '../types.js';

const STATUS_ICON: Record<RunStepStatus, string> = {
  pending: '○',
  'in-flight': '●',
  paused: '⏸',
  completed: '✓',
  failed: '✕',
  skipped: '–',
};

function StatusIcon({ status }: { status: RunStepStatus }) {
  return (
    <span className={`debugger-row__status-icon debugger-row__status-icon--${status}`} aria-label={status}>
      {STATUS_ICON[status]}
    </span>
  );
}

interface DebuggerRowProps {
  node: WorkflowNode;
  operation: Operation | undefined;
  status: RunStepStatus;
  step: RunStep | undefined;
  previewRequest: RunStepRequest | undefined;
  onStepThis: () => void;
}

// Deliberately its own look, not RunOutputTab's boxy side-by-side
// request/response cards — a compact icon-led summary line, and a single
// unified JSON block (the whole request or response object, redacted) when
// a row expands, closer to a plain code viewer than a form.
function DebuggerRow({ node, operation, status, step, previewRequest, onStepThis }: DebuggerRowProps) {
  const method = operation?.method ?? 'get';
  const path = operation?.path ?? node.operationId;
  const continueExecution = useWorkflowStore((s) => s.continueExecution);
  const stopExecution = useWorkflowStore((s) => s.stopExecution);
  // A row only expands once there's something to show — a completed/failed
  // node's actual RunStep, or a paused node's pre-fire preview (which
  // itself arrives a moment after the 'paused' status does — see
  // executeChain's own pause handling). Pending/in-flight/skipped rows,
  // and a paused row whose preview hasn't landed yet, stay a flat summary.
  const hasDetail = Boolean(step) || Boolean(previewRequest);

  const summary = (
    <>
      <StatusIcon status={status} />
      <span className={`method-badge method-badge--${method}`}>{method.toUpperCase()}</span>
      <span className="debug-step__url">{path}</span>
      {step?.response && (
        <span className={`status-badge ${step.error ? 'status-badge--error' : 'status-badge--ok'}`}>
          {step.response.status}
        </span>
      )}
      {step?.error && <span className="debug-step__error">{step.error}</span>}
    </>
  );

  // Inline, icon-only, same three actions as App.tsx's global header
  // controls — Continue/Stop still act on the whole run regardless of
  // which row you click them from, but Step here has an unambiguous
  // target (this exact node), unlike the header's selected-or-first
  // fallback. Stops the click from also toggling the <details> open/closed.
  const controls = status === 'paused' && (
    <span className="debugger-row__controls" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="btn btn--icon btn--execute" onClick={continueExecution} title="Continue" aria-label="Continue">
        ▶
      </button>
      <button type="button" className="btn btn--icon btn--secondary" onClick={onStepThis} title="Step this node" aria-label="Step">
        ⏭
      </button>
      <button type="button" className="btn btn--icon btn--stop" onClick={stopExecution} title="Stop" aria-label="Stop">
        ■
      </button>
    </span>
  );

  if (!hasDetail) {
    return (
      <div className="debugger-row debugger-row--plain">
        <div className="debugger-row__summary">
          {summary}
          {controls}
        </div>
      </div>
    );
  }

  return (
    <details className="debugger-row">
      <summary className="debugger-row__summary">
        <span className="debugger-row__chevron" aria-hidden="true">
          ▶
        </span>
        {summary}
        {controls}
      </summary>
      <div className="debugger-row__detail">
        <div className={`debugger-row__detail-label${step ? '' : ' debugger-row__detail-label--preview'}`}>
          {step ? 'Request' : 'Preview — resolved, not yet sent'}
        </div>
        <pre className="debugger-row__json">
          {JSON.stringify(redactRequest(step ? step.request : previewRequest!), null, 2)}
        </pre>
        {step && (
          <>
            <div className="debugger-row__detail-label">Response</div>
            {step.response ? (
              <pre className="debugger-row__json">{JSON.stringify(step.response, null, 2)}</pre>
            ) : (
              <p className="debugger-row__detail-empty">{step.error ?? 'No response'}</p>
            )}
          </>
        )}
      </div>
    </details>
  );
}

/**
 * The breakpoint/step-through view — a row for every node in the workflow,
 * pre-populated before Run even starts, overlaid with live status as a run
 * progresses. Only meaningful once at least one breakpoint is armed (see
 * Canvas.tsx's BreakpointConnectionEdge); otherwise shows a hint instead of
 * a row list identical to what Run Output already shows. Continue/Step/Stop
 * also live in App.tsx's header, one global set for the whole run — the
 * per-row controls here are a convenience for picking a specific node,
 * not a replacement for it.
 */
export function DebuggerTab() {
  const {
    nodes,
    connections,
    operations,
    armedBreakpoints,
    stepStatusByNodeId,
    previewRequestByNodeId,
    runResult,
    stepNode,
  } = useWorkflowStore();

  const operationsById = useMemo(() => new Map(operations.map((o) => [o.id, o])), [operations]);
  const stepsByNodeId = useMemo(() => new Map((runResult?.steps ?? []).map((s) => [s.nodeId, s])), [runResult]);

  // Dependency order, not just store/insertion order — reads top-to-bottom
  // roughly the way the chain actually runs. Purely a display convenience:
  // actual firing order is per-node/readiness-driven (chainExecutor.ts),
  // not tied to this list's order at all. Falls back to plain store order
  // if the graph is currently cyclic — nothing here should throw just
  // because Canvas.tsx is mid-edit.
  const orderedNodes = useMemo(() => {
    try {
      return topologicalSort(nodes, connections);
    } catch (err) {
      if (err instanceof CyclicWorkflowError) return nodes;
      throw err;
    }
  }, [nodes, connections]);

  if (armedBreakpoints.size === 0) {
    return (
      <div className="debug-pane__body">
        <p className="debug-pane__status">Arm a breakpoint on a connector to start debugging.</p>
      </div>
    );
  }

  return (
    <div className="debug-pane__body">
      {orderedNodes.map((node) => (
        <DebuggerRow
          key={node.id}
          node={node}
          operation={operationsById.get(node.operationId)}
          status={stepStatusByNodeId[node.id] ?? 'pending'}
          step={stepsByNodeId.get(node.id)}
          previewRequest={previewRequestByNodeId[node.id]}
          onStepThis={() => stepNode(node.id)}
        />
      ))}
    </div>
  );
}

/** Exported for DebugPane.tsx's header, which shows this breakdown next to the tab strip while the Debugger tab is active — see that file for why it lives one level up instead of inside this tab's own body. */
export function summarizeDebuggerStatus(nodes: WorkflowNode[], stepStatusByNodeId: Record<string, RunStepStatus>): string {
  const counts = new Map<RunStepStatus, number>();
  for (const node of nodes) {
    const status = stepStatusByNodeId[node.id] ?? 'pending';
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  // Fixed order, not insertion order — otherwise the summary's word order
  // would jump around between runs depending on which status a node
  // happened to reach first. A run can be simultaneously executing one
  // branch and gated on another, so this is a breakdown, not one status.
  const order: RunStepStatus[] = ['in-flight', 'paused', 'completed', 'failed', 'skipped', 'pending'];
  const label: Record<RunStepStatus, string> = {
    pending: 'pending',
    'in-flight': 'in flight',
    paused: 'paused',
    completed: 'completed',
    failed: 'failed',
    skipped: 'skipped',
  };
  return order
    .filter((status) => counts.has(status))
    .map((status) => `${counts.get(status)} ${label[status]}`)
    .join(' · ');
}
