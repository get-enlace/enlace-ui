import { useEffect, useMemo, useRef, useState } from 'react';
import { CyclicWorkflowError, formatWaitDuration, topologicalSort } from '@get-enlace/core';
import { useWorkflowStore } from '../../store/workflowStore.js';
import { buildNodeLabels } from '@get-enlace/core';
import { redactRequest, RequestPanel, ResponsePanel } from './debugPaneShared.js';
import { RUN_STATUS_GLYPH } from '../chromeIcons.js';
import type { Operation, RunStep, RunStepRequest, RunStepStatus, WorkflowNode } from '../../types.js';


function StatusIcon({ status }: { status: RunStepStatus }) {
  return (
    <span className={`debugger-row__status-icon debugger-row__status-icon--${status}`} aria-label={status}>
      {RUN_STATUS_GLYPH[status]}
    </span>
  );
}

/** A presets sub-step's own short label, derived from its settled `RunStep` alone (no `node`/`Preset` needed — see this file's fallback rows, which have neither). */
function subStepLabel(subStep: RunStep): string {
  if (subStep.request.method === 'WAIT') {
    const match = /^wait:(\d+)ms$/.exec(subStep.request.url);
    return match ? `Wait ${formatWaitDuration(Number(match[1]))}` : 'Wait';
  }
  return subStep.request.method;
}

interface ResultsRowProps {
  nodeId: string;
  /** `kind: 'presets'` renders as one aggregate row — no method badge, expandable into each settled sub-step (see `RunStep.subSteps`). */
  isPresets: boolean;
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
  isPresets,
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
  // A presets step's detail is its settled sub-steps, once it has any (it
  // never gets a pause preview — see presetsNodeHandler.preview).
  const hasDetail = isPresets ? Boolean(step) : Boolean(step) || Boolean(previewRequest);
  const rowRef = useRef<HTMLDetailsElement | HTMLDivElement | null>(null);

  useEffect(() => {
    if (!preferOpen || !rowRef.current) return;
    const el = rowRef.current;
    if (el instanceof HTMLDetailsElement) el.open = true;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [preferOpen]);

  const summary = isPresets ? (
    <>
      <StatusIcon status={status} />
      <span className="presets-node__diamond" aria-hidden="true" />
      <span className="debug-step__url">{label}</span>
      {step?.subSteps && <span className="status-badge status-badge--ok">{step.subSteps.length} steps</span>}
      {step?.error && <span className="debug-step__error">{step.error}</span>}
    </>
  ) : (
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
        {isPresets ? (
          <ul className="presets-node__steps presets-results__sub-steps">
            {(step?.subSteps ?? []).map((subStep, i) => (
              <li key={i} className="presets-node__step">
                <span className="presets-node__step-connector" aria-hidden="true" />
                <StatusIcon status={subStep.error ? 'failed' : 'completed'} />
                <span className="presets-node__step-label">{subStepLabel(subStep)}</span>
                {subStep.error && <span className="debug-step__error">{subStep.error}</span>}
              </li>
            ))}
            {(step?.subSteps?.length ?? 0) === 0 && (
              <li className="presets-node__empty-hint">No presets ran — this collection is empty.</li>
            )}
          </ul>
        ) : step ? (
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
          const operationId = node.kind === 'presets' ? undefined : node.operationId;
          return (
            <ResultsRow
              key={node.id}
              nodeId={node.id}
              isPresets={node.kind === 'presets'}
              operation={operationId ? operationsById.get(operationId) : undefined}
              label={nodeLabels.get(node.id) ?? operationId ?? node.id}
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
              // No `node` survives a cleared canvas — the synthetic
              // `method: 'PRESETS'` set by presetsNodeHandler is the only
              // signal left to tell a settled presets step apart from an
              // operation one.
              isPresets={step.request.method === 'PRESETS'}
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
    text: active.map((status) => `${counts.get(status)} ${RUN_STATUS_GLYPH[status]}`).join(' · '),
    title: active.map((status) => `${counts.get(status)} ${words[status]}`).join(' · '),
  };
}
