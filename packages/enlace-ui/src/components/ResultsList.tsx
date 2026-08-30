import { useEffect, useMemo, useRef, useState } from 'react';
import { CyclicWorkflowError, topologicalSort } from '../engine/chainExecutor.js';
import { useWorkflowStore } from '../store/workflowStore.js';
import { buildNodeLabels } from '../utils/nodeLabel.js';
import { redactRequest, RequestPanel, ResponsePanel } from './debugPaneShared.js';
import type { Operation, RunStep, RunStepRequest, RunStepStatus, WorkflowNode } from '../types.js';

// Kept in visual lockstep with WorkflowNodeCard.tsx's STATUS_BADGE_GLYPH.
const STATUS_ICON: Record<RunStepStatus, string> = {
  pending: '○',
  'in-flight': '●',
  paused: '⏸',
  completed: '✓',
  failed: '!',
  skipped: '–',
};

function StatusIcon({ status }: { status: RunStepStatus }) {
  return (
    <span className={`debugger-row__status-icon debugger-row__status-icon--${status}`} aria-label={status}>
      {STATUS_ICON[status]}
    </span>
  );
}

interface ResultsRowProps {
  operation: Operation | undefined;
  label: string;
  status: RunStepStatus;
  step: RunStep | undefined;
  previewRequest: RunStepRequest | undefined;
  /** Prefer open on rising-edge pause for the focused paused row. */
  preferOpen: boolean;
}

function ResultsRow({ operation, label, status, step, previewRequest, preferOpen }: ResultsRowProps) {
  const method = operation?.method ?? step?.request.method.toLowerCase() ?? 'get';
  const hasDetail = Boolean(step) || Boolean(previewRequest);
  const rowRef = useRef<HTMLDetailsElement | HTMLDivElement | null>(null);

  useEffect(() => {
    if (!preferOpen || !rowRef.current) return;
    const el = rowRef.current;
    if (el instanceof HTMLDetailsElement) el.open = true;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [preferOpen]);

  const summary = (
    <>
      <StatusIcon status={status} />
      <span className={`method-badge method-badge--${method}`}>{method.toUpperCase()}</span>
      <span className="debug-step__url">{label}</span>
      {step?.response && (
        <span className={`status-badge ${step.error ? 'status-badge--error' : 'status-badge--ok'}`}>
          {step.response.status}
        </span>
      )}
      {step?.error && !step.response && <span className="status-badge status-badge--error">ERROR</span>}
      {step?.error && <span className="debug-step__error">{step.error}</span>}
    </>
  );

  if (!hasDetail) {
    return (
      <div className="debugger-row debugger-row--plain">
        <div className="debugger-row__summary">{summary}</div>
      </div>
    );
  }

  return (
    <details ref={rowRef as React.RefObject<HTMLDetailsElement>} className="debugger-row">
      <summary className="debugger-row__summary">
        <span className="debugger-row__chevron" aria-hidden="true">
          ▶
        </span>
        {summary}
      </summary>
      <div className="debug-step__panels">
        {step ? (
          <>
            <RequestPanel request={redactRequest(step.request)} />
            <ResponsePanel response={step.response} error={step.error} />
          </>
        ) : (
          <div className="debug-step__panel debug-step__panel--preview">
            <div className="debugger-row__detail-label debugger-row__detail-label--preview">
              Preview — resolved, not yet sent
            </div>
            <RequestPanel request={redactRequest(previewRequest!)} />
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * Unified Results list: debugger-style status rows for every workflow node,
 * with Run-output request/response panels on expand. Prepares the surface for
 * a future debug-only console split (not built in this pass).
 */
export function ResultsList() {
  const {
    nodes,
    connections,
    operations,
    stepStatusByNodeId,
    previewRequestByNodeId,
    runResult,
    isRunning,
    error,
    selectedNodeId,
    continueExecution,
    stepNode,
  } = useWorkflowStore();

  const operationsById = useMemo(() => new Map(operations.map((o) => [o.id, o])), [operations]);
  const stepsByNodeId = useMemo(() => new Map((runResult?.steps ?? []).map((s) => [s.nodeId, s])), [runResult]);
  const nodeLabels = useMemo(() => buildNodeLabels(nodes, operationsById), [nodes, operationsById]);

  const orderedNodes = useMemo(() => {
    try {
      return topologicalSort(nodes, connections);
    } catch (err) {
      if (err instanceof CyclicWorkflowError) return nodes;
      throw err;
    }
  }, [nodes, connections]);

  const pausedNodeIds = useMemo(
    () => orderedNodes.filter((n) => stepStatusByNodeId[n.id] === 'paused').map((n) => n.id),
    [orderedNodes, stepStatusByNodeId]
  );
  const pauseFocusId = pausedNodeIds.includes(selectedNodeId ?? '') ? selectedNodeId! : pausedNodeIds[0];
  const pauseFocusLabel = pauseFocusId ? (nodeLabels.get(pauseFocusId) ?? pauseFocusId) : null;

  const preferOpenIdRef = useRef<string | null>(null);
  const [preferOpenId, setPreferOpenId] = useState<string | null>(null);
  const prevPausedRef = useRef(false);
  useEffect(() => {
    const anyPaused = pausedNodeIds.length > 0;
    if (anyPaused && !prevPausedRef.current && pauseFocusId) {
      setPreferOpenId(pauseFocusId);
    }
    if (!anyPaused) setPreferOpenId(null);
    prevPausedRef.current = anyPaused;
  }, [pausedNodeIds, pauseFocusId]);

  const hasGraph = nodes.length > 0;
  const hasSteps = (runResult?.steps.length ?? 0) > 0;
  const empty = !hasGraph && !hasSteps && !isRunning && !error;

  return (
    <div className="debug-pane__body results-list">
      {pausedNodeIds.length > 0 && pauseFocusLabel && (
        <div className="results-pause-bar" role="status">
          <span className="results-pause-bar__label">
            Paused at <strong>{pauseFocusLabel}</strong>
          </span>
          <span className="results-pause-bar__actions">
            <button
              type="button"
              className="btn btn--icon btn--execute"
              onClick={continueExecution}
              title="Continue — release every node currently paused"
              aria-label="Continue"
            >
              ▶
            </button>
            <button
              type="button"
              className="btn btn--icon btn--secondary"
              onClick={() => pauseFocusId && stepNode(pauseFocusId)}
              title="Step — release just this paused node"
              aria-label="Step"
            >
              ⏭
            </button>
          </span>
        </div>
      )}

      {isRunning && pausedNodeIds.length === 0 && (
        <p className="debug-pane__status debug-pane__status--running">Running…</p>
      )}
      {!isRunning && error && <p className="debug-pane__status debug-pane__status--error">{error}</p>}
      {empty && (
        <p className="debug-pane__status">Run the workflow to see each step&apos;s request and response.</p>
      )}

      {hasGraph &&
        orderedNodes.map((node) => {
          const status = stepStatusByNodeId[node.id] ?? (stepsByNodeId.has(node.id) ? 'completed' : 'pending');
          // After a finished run with no status map, treat settled steps as completed.
          const resolvedStatus: RunStepStatus =
            !isRunning && !stepStatusByNodeId[node.id] && stepsByNodeId.has(node.id)
              ? stepsByNodeId.get(node.id)!.error
                ? 'failed'
                : 'completed'
              : status;
          return (
            <ResultsRow
              key={node.id}
              operation={operationsById.get(node.operationId)}
              label={nodeLabels.get(node.id) ?? node.operationId}
              status={resolvedStatus}
              step={stepsByNodeId.get(node.id)}
              previewRequest={previewRequestByNodeId[node.id]}
              preferOpen={preferOpenId === node.id}
            />
          );
        })}

      {/* Settled-only fallback when the canvas was cleared but a result remains. */}
      {!hasGraph &&
        hasSteps &&
        runResult!.steps.map((step) => (
          <ResultsRow
            key={step.nodeId}
            operation={undefined}
            label={step.request.method}
            status={step.error ? 'failed' : 'completed'}
            step={step}
            previewRequest={undefined}
            preferOpen={false}
          />
        ))}
    </div>
  );
}

export function summarizeResultsStatus(
  nodes: WorkflowNode[],
  stepStatusByNodeId: Record<string, RunStepStatus>,
  settledCount: number
): string {
  if (nodes.length === 0) {
    return settledCount > 0 ? `${settledCount} call(s)` : '';
  }
  const counts = new Map<RunStepStatus, number>();
  for (const node of nodes) {
    const status = stepStatusByNodeId[node.id] ?? 'pending';
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const hasLive = [...counts.keys()].some((s) => s !== 'pending') || Object.keys(stepStatusByNodeId).length > 0;
  if (!hasLive && settledCount === 0) {
    return `${nodes.length} step(s)`;
  }
  if (!hasLive && settledCount > 0) {
    return `${settledCount} call(s)`;
  }
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
    .filter((status) => (counts.get(status) ?? 0) > 0)
    .map((status) => `${counts.get(status)} ${label[status]}`)
    .join(' · ');
}
