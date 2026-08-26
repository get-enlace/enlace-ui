import { useWorkflowStore } from '../store/workflowStore.js';
import type { RunStepRequest } from '../types.js';

/** An apiKey-in-query credential has no header to redact — its secret lives in `url` itself, named in `redactQueryParams` (see types.ts). Malformed/relative URLs fall back to the raw string rather than throwing inside the debug pane. */
function redactUrl(url: string, paramNames: string[] | undefined): string {
  if (!paramNames || paramNames.length === 0) return url;
  try {
    const parsed = new URL(url);
    for (const name of paramNames) {
      if (parsed.searchParams.has(name)) parsed.searchParams.set(name, '[redacted]');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function redactRequest(request: RunStepRequest): RunStepRequest {
  return {
    ...request,
    url: redactUrl(request.url, request.redactQueryParams),
    headers: Object.fromEntries(
      Object.entries(request.headers).map(([key, value]) =>
        key.toLowerCase() === 'authorization' ? [key, '[redacted]'] : [key, value]
      )
    ),
  };
}

export interface DebugPaneProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function DebugPane({ collapsed, onToggleCollapsed }: DebugPaneProps) {
  const { runResult, isRunning, error } = useWorkflowStore();

  return (
    <div className={`debug-pane${collapsed ? ' debug-pane--collapsed' : ''}`}>
      <div className="debug-pane__header">
        <button
          type="button"
          className="debug-pane__toggle"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Show run output' : 'Hide run output'}
        >
          <span className="debug-pane__toggle-chevron" aria-hidden="true">
            {collapsed ? '▲' : '▼'}
          </span>
          Run output
        </button>
        {runResult && <span className="debug-pane__count">{runResult.steps.length} call(s)</span>}
      </div>

      {!collapsed && (
        <div className="debug-pane__body">
          {isRunning && <p className="debug-pane__status">Running…</p>}
          {!isRunning && error && <p className="debug-pane__status debug-pane__status--error">{error}</p>}
          {!isRunning && !error && !runResult && (
            <p className="debug-pane__status">Run the workflow to see each step's request and response.</p>
          )}

          {!isRunning &&
            !error &&
            runResult?.steps.map((step) => {
              const ok = !step.error;
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
                    <span className="debug-step__url">
                      {redactUrl(step.request.url, step.request.redactQueryParams)}
                    </span>
                    <span className={`status-badge ${ok ? 'status-badge--ok' : 'status-badge--error'}`}>
                      {step.response?.status ?? 'ERROR'}
                    </span>
                    {step.error && <span className="debug-step__error">{step.error}</span>}
                  </summary>
                  {/* Redacted here, client-side — the only place this can happen now that
                      execution runs entirely in the browser and there's no server round-trip
                      to redact it in transit. */}
                  <pre>{JSON.stringify({ request: redactRequest(step.request), response: step.response }, null, 2)}</pre>
                </details>
              );
            })}
        </div>
      )}
    </div>
  );
}
