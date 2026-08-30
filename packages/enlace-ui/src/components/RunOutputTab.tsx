import { useMemo } from 'react';
import { useWorkflowStore } from '../store/workflowStore.js';
import { buildNodeLabels } from '../utils/nodeLabel.js';
import { redactRequest, RequestPanel, ResponsePanel } from './debugPaneShared.js';

/**
 * The plain "what happened" view — every run's steps, in the order they
 * settled, unaffected by whether any breakpoint is armed. Extracted as-is
 * out of what used to be the whole of DebugPane.tsx, once a second
 * "Debugger" tab was added alongside it (see DebugPane.tsx, DebuggerTab.tsx)
 * — no behavior change for anyone not using breakpoints.
 */
export function RunOutputTab() {
  const { runResult, isRunning, error, nodes, operations } = useWorkflowStore();
  const operationsById = useMemo(() => new Map(operations.map((o) => [o.id, o])), [operations]);
  // Same labels the canvas cards use (including "… #1" / "… #2" when the
  // same operation appears more than once) — the summary must distinguish
  // those steps; the resolved URL alone cannot.
  const nodeLabels = useMemo(() => buildNodeLabels(nodes, operationsById), [nodes, operationsById]);

  return (
    <div className="debug-pane__body">
      {/* A hint alongside the list, not a gate in front of it — rows
          for steps that have already settled render immediately as
          each one completes, instead of waiting for isRunning to flip
          false at the very end of the whole chain. */}
      {isRunning && <p className="debug-pane__status debug-pane__status--running">Running…</p>}
      {!isRunning && error && <p className="debug-pane__status debug-pane__status--error">{error}</p>}
      {!isRunning && !error && !runResult && (
        <p className="debug-pane__status">Run the workflow to see each step's request and response.</p>
      )}

      {!error &&
        runResult?.steps.map((step) => {
          const ok = !step.error;
          const label = nodeLabels.get(step.nodeId) ?? step.request.method;
          return (
            // Collapsed by default — this pane shows the call list only,
            // until a row is opened. Raw request/response detail lives
            // inside, not stacked loose in the same visual space as the list.
            <details key={step.nodeId} className="debug-step">
              <summary className="debug-step__summary">
                <span className="debug-step__chevron" aria-hidden="true">
                  ▶
                </span>
                <span className={`method-badge method-badge--${step.request.method.toLowerCase()}`}>
                  {step.request.method}
                </span>
                <span className="debug-step__url">{label}</span>
                <span className={`status-badge ${ok ? 'status-badge--ok' : 'status-badge--error'}`}>
                  {step.response?.status ?? 'ERROR'}
                </span>
                {step.error && <span className="debug-step__error">{step.error}</span>}
              </summary>
              {/* Redacted here, client-side — the only place this can happen now that
                  execution runs entirely in the browser and there's no server round-trip
                  to redact it in transit. Side-by-side so the body — what a step is opened
                  to actually read — never sits below a wall of headers on either side. */}
              <div className="debug-step__panels">
                <RequestPanel request={redactRequest(step.request)} />
                <ResponsePanel response={step.response} error={step.error} />
              </div>
            </details>
          );
        })}
    </div>
  );
}
