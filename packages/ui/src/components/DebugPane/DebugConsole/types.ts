/** Debug console `$` context shapes and help text. */

export interface ConsoleHistoryEntry {
  query: string;
  focusLabel: string;
  resultText?: string;
  error?: string;
}

/** One workflow node in `$` — request/response with debugger-friendly names. */
export interface ConsoleNodeContext {
  request: {
    method: string;
    url: string;
    /** Resolved pathname (no origin). */
    path: string;
    /** Path template params (`{id}` → value). */
    params: Record<string, string>;
    /** Query string map. */
    query: Record<string, string>;
    headers: Record<string, string>;
    payload?: unknown;
  };
  response?: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
    error?: string;
  };
}

/** Secret-free credential stub under `$.credentials`. */
export interface ConsoleCredentialStub {
  name: string;
  type: string;
  complete: boolean;
}

/**
 * `$` — workflow run so far. Focused node mirrored at top-level
 * `request` / `response` when focus is set.
 */
export interface ConsoleRunContext {
  focus: string | null;
  focusKey: string | null;
  nodes: Record<string, ConsoleNodeContext>;
  /** Keys of `nodes` in execution order (for one-level listing). */
  nodeOrder: string[];
  credentials: Record<string, ConsoleCredentialStub>;
  request?: ConsoleNodeContext['request'];
  response?: ConsoleNodeContext['response'];
}

export interface ConsoleFocus {
  nodeId: string | null;
  label: string | null;
  context: ConsoleRunContext;
}

/** Path-safe key — `createCustomer #2` → `createCustomer_2`. */
export function consoleNodeKey(label: string): string {
  return label.replace(/\s+#/g, '_').replace(/\s+/g, '_');
}

export const CONSOLE_HELP = `Macros:
  clear, cls     clear the screen (keeps ↑/↓ command history)
  help           this message

Symbols (one level expands):
  $                     workflow: nodes, credentials, focus
  $.nodes               nodes in run order
  $.nodes.<label>       one node: request / response
  $.nodes.<label>.request.params|query|headers|payload
  $.nodes.<label>.response.status|headers|body
  $.credentials         credential stubs (no secrets)
  request / response    focused node shorthand`;

/** Pull `{name}` slots out of an OpenAPI path template against the request pathname. */
