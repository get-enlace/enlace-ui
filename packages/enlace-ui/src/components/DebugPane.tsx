import { useWorkflowStore } from '../store/workflowStore.js';
import type { RunStepRequest, RunStepResponse } from '../types.js';

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

/** `body` is `unknown` — could be a parsed JSON value, a plain string, or absent entirely. Pretty-print
 * objects/arrays; show strings as-is; anything else falls back to String() rather than risking a throw. */
function formatBody(body: unknown): string | null {
  if (body === undefined || body === null) return null;
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

function HeadersList({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  return (
    <details className="debug-headers">
      <summary className="debug-headers__summary">Headers ({entries.length})</summary>
      {entries.length === 0 ? (
        <p className="debug-headers__empty">None</p>
      ) : (
        <table className="debug-headers__table">
          <tbody>
            {entries.map(([key, value]) => (
              <tr key={key}>
                <th>{key}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}

// Body is the thing a user opens a step to actually read — shown immediately, full width, never
// behind a second click the way headers are. That's the fix for "doom scrolling" past headers to
// reach it.
function BodyBlock({ value }: { value: unknown }) {
  const text = formatBody(value);
  return (
    <div className="debug-body">
      <div className="debug-body__label">Body</div>
      {text === null ? <p className="debug-body__empty">No body</p> : <pre className="debug-body__pre">{text}</pre>}
    </div>
  );
}

function RequestPanel({ request }: { request: RunStepRequest }) {
  return (
    <div className="debug-step__panel">
      <div className="debug-step__panel-title">
        Request
        {/* Not a secret — see RunStepRequest.credentials — but shown so it's visible *why* a
            cookie-based call succeeded or failed, since nothing else about the request reveals
            that a cookie was expected at all. */}
        {request.credentials === 'include' && <span className="debug-step__credentials-chip">credentials: include</span>}
      </div>
      <HeadersList headers={request.headers} />
      <BodyBlock value={request.body} />
    </div>
  );
}

function ResponsePanel({ response, error }: { response: RunStepResponse | undefined; error: string | undefined }) {
  if (!response) {
    return (
      <div className="debug-step__panel">
        <div className="debug-step__panel-title">Response</div>
        <p className="debug-step__panel-empty">{error ?? 'No response'}</p>
      </div>
    );
  }
  return (
    <div className="debug-step__panel">
      <div className="debug-step__panel-title">
        Response
        <span className={`status-badge ${response.status < 400 ? 'status-badge--ok' : 'status-badge--error'}`}>{response.status}</span>
      </div>
      <HeadersList headers={response.headers} />
      <BodyBlock value={response.body} />
    </div>
  );
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
      )}
    </div>
  );
}
