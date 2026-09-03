import type { RunStepRequest, RunStepResponse } from '../types.js';

/** An apiKey-in-query credential has no header to redact — its secret lives in `url` itself, named in `redactQueryParams` (see types.ts). Malformed/relative URLs fall back to the raw string rather than throwing inside the debug pane. */
export function redactUrl(url: string, paramNames: string[] | undefined): string {
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

export function redactRequest(request: RunStepRequest): RunStepRequest {
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

/** `body` is `unknown` — could be a parsed JSON value, a plain string, FormData
 * (multipart upload), or absent entirely. Pretty-print objects/arrays; show
 * strings as-is; summarize FormData entries (files by name); anything else
 * falls back to String() rather than risking a throw. */
function formatBody(body: unknown): string | null {
  if (body === undefined || body === null) return null;
  if (typeof body === 'string') return body;
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const entries: Record<string, string> = {};
    body.forEach((value, key) => {
      entries[key] = value instanceof File ? `(file) ${value.name}` : String(value);
    });
    return JSON.stringify(entries, null, 2);
  }
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

export function HeadersList({ headers }: { headers: Record<string, string> }) {
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
export function BodyBlock({ value }: { value: unknown }) {
  const text = formatBody(value);
  return (
    <div className="debug-body">
      <div className="debug-body__label">Body</div>
      {text === null ? <p className="debug-body__empty">No body</p> : <pre className="debug-body__pre">{text}</pre>}
    </div>
  );
}

export function RequestPanel({ request }: { request: RunStepRequest }) {
  return (
    <div className="debug-step__panel">
      <div className="debug-step__panel-title">
        Request
        <span className="debug-step__request-url">
          {redactUrl(request.url, request.redactQueryParams)}
        </span>
        {/* Not a secret — see RunStepRequest.credentials — but shown so it's visible *why* a
            cookie-based call succeeded or failed, since nothing else about the request reveals
            that a cookie was expected at all. */}
        {request.credentials === 'include' && (
          <span className="debug-step__credentials-chip">credentials: include</span>
        )}
      </div>
      <HeadersList headers={request.headers} />
      <BodyBlock value={request.body} />
    </div>
  );
}

export function ResponsePanel({ response, error }: { response: RunStepResponse | undefined; error: string | undefined }) {
  if (!response) {
    return (
      <div className="debug-step__panel">
        <div className="debug-step__panel-title">Response</div>
        <p className="debug-step__panel-empty">{error ?? 'No response'}</p>
      </div>
    );
  }
  // Status lives on the row summary only — repeating it here next to "Response" was noise.
  return (
    <div className="debug-step__panel">
      <div className="debug-step__panel-title">Response</div>
      <HeadersList headers={response.headers} />
      <BodyBlock value={response.body} />
    </div>
  );
}
