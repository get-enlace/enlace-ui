import { useEffect, useMemo, useRef, useState } from 'react';
import { CyclicWorkflowError, topologicalSort } from '@get-enlace/core';
import { useWorkflowStore } from '../store/workflowStore.js';
import { buildNodeLabels } from '@get-enlace/core';
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
  nodeId: string;
  operation: Operation | undefined;
  label: string;
  status: RunStepStatus;
  step: RunStep | undefined;
  previewRequest: RunStepRequest | undefined;
  focused: boolean;
  /** Prefer open on rising-edge pause for the focused paused row. */
  preferOpen: boolean;
  onSelect: (nodeId: string) => void;
}

function ResultsRow({
  nodeId,
  operation,
  label,
  status,
  step,
  previewRequest,
  focused,
  preferOpen,
  onSelect,
}: ResultsRowProps) {
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

  const rowClass = `debugger-row${focused ? ' debugger-row--focused' : ''}`;

  if (!hasDetail) {
    return (
      <div
        className={`${rowClass} debugger-row--plain`}
        onClick={() => onSelect(nodeId)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(nodeId);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="debugger-row__summary">{summary}</div>
      </div>
    );
  }

  return (
    <details
      ref={rowRef as React.RefObject<HTMLDetailsElement>}
      className={rowClass}
      onClickCapture={() => onSelect(nodeId)}
    >
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
 * Unified Results list: debugger-style status rows for nodes that have
 * run/preview data (not every canvas node). Clear wipes that data and the
 * list goes empty so the pane stops eating space with pending ghosts.
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
    selectNode,
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

  /** Only nodes with live Results chrome (status or pause preview) — not
   * every canvas node, and not `runResult` alone (kept after Clear for mapping). */
  const resultNodes = useMemo(
    () =>
      orderedNodes.filter(
        (n) => n.id in stepStatusByNodeId || previewRequestByNodeId[n.id] !== undefined
      ),
    [orderedNodes, stepStatusByNodeId, previewRequestByNodeId]
  );

  const pausedNodeIds = useMemo(
    () => resultNodes.filter((n) => stepStatusByNodeId[n.id] === 'paused').map((n) => n.id),
    [resultNodes, stepStatusByNodeId]
  );
  const pauseFocusId = pausedNodeIds.includes(selectedNodeId ?? '') ? selectedNodeId! : pausedNodeIds[0];

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
  const hasLiveResults =
    Object.keys(stepStatusByNodeId).length > 0 || Object.keys(previewRequestByNodeId).length > 0;
  const empty = !hasLiveResults && !isRunning && !error;

  return (
    <div className="debug-pane__body results-list">
      <div className="results-list__scroll">
        {isRunning && pausedNodeIds.length === 0 && (
          <p className="debug-pane__status debug-pane__status--running">Running…</p>
        )}
        {!isRunning && error && <p className="debug-pane__status debug-pane__status--error">{error}</p>}
        {empty && (
          <p className="debug-pane__status">Run the workflow to see each step&apos;s request and response.</p>
        )}

        {resultNodes.map((node) => {
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
              nodeId={node.id}
              operation={operationsById.get(node.operationId)}
              label={nodeLabels.get(node.id) ?? node.operationId}
              status={resolvedStatus}
              step={stepsByNodeId.get(node.id)}
              previewRequest={previewRequestByNodeId[node.id]}
              focused={selectedNodeId === node.id}
              preferOpen={preferOpenId === node.id}
              onSelect={selectNode}
            />
          );
        })}

        {/* Settled-only fallback when the canvas was cleared but Results chrome remains. */}
        {!hasGraph &&
          hasLiveResults &&
          hasSteps &&
          runResult!.steps.map((step) => (
            <ResultsRow
              key={step.nodeId}
              nodeId={step.nodeId}
              operation={undefined}
              label={step.request.method}
              status={step.error ? 'failed' : 'completed'}
              step={step}
              previewRequest={undefined}
              focused={selectedNodeId === step.nodeId}
              preferOpen={false}
              onSelect={selectNode}
            />
          ))}
      </div>
    </div>
  );
}

export interface ResultsStatusSummary {
  /** Compact glyph form for the header, e.g. `1 ⏸ · 2 ✓`. */
  text: string;
  /** Hover / accessible expansion, e.g. `1 paused · 2 completed`. */
  title: string;
}

export function summarizeResultsStatus(
  nodes: WorkflowNode[],
  stepStatusByNodeId: Record<string, RunStepStatus>,
  _settledCount: number
): ResultsStatusSummary | null {
  const statusEntries = Object.entries(stepStatusByNodeId);
  if (statusEntries.length === 0) {
    // `runResult` may still exist after Clear (mapping preview) — don't
    // surface a stale count in the Results header.
    return null;
  }
  const counts = new Map<RunStepStatus, number>();
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const [id, status] of statusEntries) {
    if (nodes.length > 0 && !nodeIds.has(id)) continue;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  const order: RunStepStatus[] = ['in-flight', 'paused', 'completed', 'failed', 'skipped', 'pending'];
  const words: Record<RunStepStatus, string> = {
    pending: 'pending',
    'in-flight': 'in flight',
    paused: 'paused',
    completed: 'completed',
    failed: 'failed',
    skipped: 'skipped',
  };
  const active = order.filter((status) => (counts.get(status) ?? 0) > 0);
  return {
    text: active.map((status) => `${counts.get(status)} ${STATUS_ICON[status]}`).join(' · '),
    title: active.map((status) => `${counts.get(status)} ${words[status]}`).join(' · '),
  };
}
