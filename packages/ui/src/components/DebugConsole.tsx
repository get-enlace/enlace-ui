import { useEffect, useMemo, useRef, useState } from 'react';
import {
  acceptCompletion,
  autocompletion,
  completionStatus,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { defaultKeymap, history as cmHistory, historyKeymap } from '@codemirror/commands';
import { EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder, tooltips } from '@codemirror/view';
import { CyclicWorkflowError, topologicalSort } from '@get-enlace/core';
import { useWorkflowStore } from '../store/workflowStore.js';
import { resolveJsonPath } from '@get-enlace/core';
import { isDraftComplete, toDraft } from '../utils/credentialDraft.js';
import { buildNodeLabels } from '@get-enlace/core';
import { redactRequest } from './debugPaneShared.js';
import type { Credential, Operation, RunStep, RunStepRequest, RunStepStatus, WorkflowNode } from '../types.js';

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
export function extractPathParams(template: string, pathname: string): Record<string, string> {
  if (!template) return {};
  const names: string[] = [];
  const pattern = template
    .split('/')
    .map((seg) => {
      const m = seg.match(/^\{([^}]+)\}$/);
      if (m) {
        names.push(m[1]);
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  const re = new RegExp(`${pattern}/?$`);
  const match = pathname.match(re);
  if (!match) return {};
  const out: Record<string, string> = {};
  names.forEach((name, i) => {
    try {
      out[name] = decodeURIComponent(match[i + 1] ?? '');
    } catch {
      out[name] = match[i + 1] ?? '';
    }
  });
  return out;
}

export function extractQueryParams(url: string): Record<string, string> {
  try {
    const parsed = new URL(url);
    const out: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  } catch {
    return {};
  }
}

export function buildConsoleNodeContext(
  request: RunStepRequest,
  extras?: { response?: RunStep['response']; error?: string; operationPath?: string }
): ConsoleNodeContext {
  const redacted = redactRequest(request);
  let pathname = '';
  try {
    pathname = new URL(redacted.url).pathname;
  } catch {
    pathname = redacted.url.split('?')[0] ?? '';
  }

  const node: ConsoleNodeContext = {
    request: {
      method: redacted.method,
      url: redacted.url,
      path: pathname,
      params: extractPathParams(extras?.operationPath ?? '', pathname),
      query: extractQueryParams(redacted.url),
      headers: redacted.headers,
      ...(redacted.body !== undefined ? { payload: redacted.body } : {}),
    },
  };
  if (extras?.response) {
    node.response = {
      status: extras.response.status,
      headers: extras.response.headers,
      body: extras.response.body,
      ...(extras.error ? { error: extras.error } : {}),
    };
  } else if (extras?.error) {
    node.response = {
      status: 0,
      headers: {},
      body: undefined,
      error: extras.error,
    };
  }
  return node;
}

export function buildConsoleCredentials(credentials: Credential[]): Record<string, ConsoleCredentialStub> {
  const out: Record<string, ConsoleCredentialStub> = {};
  for (const c of credentials) {
    const key = consoleNodeKey(c.name);
    out[key] = {
      name: c.name,
      type: c.type,
      complete: isDraftComplete(toDraft(c)),
    };
  }
  return out;
}

/**
 * Always returns a `$` context (may have empty nodes). Focus shorthand is
 * set when a node with a request is focused.
 */
export function resolveConsoleFocus(args: {
  nodes: WorkflowNode[];
  orderedNodes: WorkflowNode[];
  selectedNodeId: string | null;
  stepStatusByNodeId: Record<string, RunStepStatus>;
  stepsByNodeId: Map<string, RunStep>;
  previewRequestByNodeId: Record<string, RunStepRequest>;
  operationsById: Map<string, Operation>;
  nodeLabels: Map<string, string>;
  credentials: Credential[];
}): ConsoleFocus {
  const {
    nodes,
    orderedNodes,
    selectedNodeId,
    stepStatusByNodeId,
    stepsByNodeId,
    previewRequestByNodeId,
    operationsById,
    nodeLabels,
    credentials,
  } = args;

  const operationPathFor = (nodeId: string): string | undefined => {
    const n = nodes.find((x) => x.id === nodeId);
    if (!n) return undefined;
    return operationsById.get(n.operationId)?.path;
  };

  const contextFor = (nodeId: string): ConsoleNodeContext | null => {
    const opPath = operationPathFor(nodeId);
    const step = stepsByNodeId.get(nodeId);
    if (step) {
      return buildConsoleNodeContext(step.request, {
        response: step.response,
        error: step.error,
        operationPath: opPath,
      });
    }
    const preview = previewRequestByNodeId[nodeId];
    if (preview) return buildConsoleNodeContext(preview, { operationPath: opPath });
    return null;
  };

  const nodeMap: Record<string, ConsoleNodeContext> = {};
  const nodeOrder: string[] = [];
  const keyByNodeId = new Map<string, string>();
  for (const node of orderedNodes) {
    const ctx = contextFor(node.id);
    if (!ctx) continue;
    const label = nodeLabels.get(node.id) ?? node.id;
    const key = consoleNodeKey(label);
    nodeMap[key] = ctx;
    nodeOrder.push(key);
    keyByNodeId.set(node.id, key);
  }

  const pickFocusId = (): string | null => {
    if (selectedNodeId && keyByNodeId.has(selectedNodeId)) return selectedNodeId;
    const pausedIds = orderedNodes.filter((n) => stepStatusByNodeId[n.id] === 'paused').map((n) => n.id);
    const pauseFocusId = pausedIds.includes(selectedNodeId ?? '') ? selectedNodeId! : pausedIds[0];
    if (pauseFocusId && keyByNodeId.has(pauseFocusId)) return pauseFocusId;
    for (let i = orderedNodes.length - 1; i >= 0; i--) {
      if (keyByNodeId.has(orderedNodes[i].id)) return orderedNodes[i].id;
    }
    return null;
  };

  const focusId = pickFocusId();
  const focusKey = focusId ? keyByNodeId.get(focusId)! : null;
  const focusLabel = focusId ? (nodeLabels.get(focusId) ?? focusId) : null;
  const focusNode = focusKey ? nodeMap[focusKey] : null;

  const context: ConsoleRunContext = {
    focus: focusLabel,
    focusKey,
    nodes: nodeMap,
    nodeOrder,
    credentials: buildConsoleCredentials(credentials),
    ...(focusNode
      ? {
          request: focusNode.request,
          response: focusNode.response,
        }
      : {}),
  };

  return { nodeId: focusId, label: focusLabel, context };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isConsoleNodeContext(value: unknown): value is ConsoleNodeContext {
  return isPlainObject(value) && isPlainObject(value.request) && typeof value.request.method === 'string';
}

function isRequestShape(value: unknown): value is ConsoleNodeContext['request'] {
  return isPlainObject(value) && typeof value.method === 'string' && typeof value.url === 'string';
}

function isResponseShape(value: unknown): value is NonNullable<ConsoleNodeContext['response']> {
  return isPlainObject(value) && typeof value.status === 'number';
}

function isCredentialStub(value: unknown): value is ConsoleCredentialStub {
  return (
    isPlainObject(value) &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.complete === 'boolean'
  );
}

/** One-line summary for a child value (never deep-prints). */
export function summarizeConsoleValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') {
    return value.length > 72 ? JSON.stringify(`${value.slice(0, 69)}…`) : JSON.stringify(value);
  }
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return `(${value.length})`;

  if (isConsoleNodeContext(value)) {
    const { method, path } = value.request;
    if (value.response) {
      const status = value.response.status || value.response.error || '?';
      return `${method} ${path} → ${status}`;
    }
    return `${method} ${path}`;
  }
  if (isRequestShape(value)) return `${value.method} ${value.path || value.url}`;
  if (isResponseShape(value)) {
    if (value.error && !value.status) return `error: ${value.error}`;
    return value.error ? `${value.status} (${value.error})` : String(value.status);
  }
  if (isCredentialStub(value)) {
    return `${value.type}${value.complete ? '' : ' · incomplete'}`;
  }

  const keys = Object.keys(value);
  return `(${keys.length})`;
}

/**
 * Print exactly one level of children. Special-case `nodes` maps to an
 * ordered `[i] key  summary` list when `nodeOrder` is provided.
 */
export function formatOneLevel(value: unknown, options?: { nodeOrder?: string[] }): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value !== 'object') {
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '(empty)';
    return value.map((item, i) => `[${i}] ${summarizeConsoleValue(item)}`).join('\n');
  }

  const obj = value as Record<string, unknown>;

  // Ordered nodes listing: prefer nodeOrder when this looks like the nodes map
  // (all values are node contexts) or when nodeOrder is explicitly passed.
  const order = options?.nodeOrder;
  if (order && order.every((k) => k in obj)) {
    if (order.length === 0) return '(empty)';
    return order
      .map((key, i) => `[${i}] ${key.padEnd(20)} ${summarizeConsoleValue(obj[key])}`)
      .join('\n');
  }

  // Heuristic: record of ConsoleNodeContext without nodeOrder
  const keys = Object.keys(obj);
  if (keys.length > 0 && keys.every((k) => isConsoleNodeContext(obj[k]))) {
    return keys
      .map((key, i) => `[${i}] ${key.padEnd(20)} ${summarizeConsoleValue(obj[key])}`)
      .join('\n');
  }

  if (keys.length === 0) return '(empty)';

  // Root `$`-style: hide internal nodeOrder from display if present
  const displayKeys = keys.filter((k) => k !== 'nodeOrder');
  const width = Math.min(16, Math.max(...displayKeys.map((k) => k.length), 8));
  return displayKeys.map((key) => `${key.padEnd(width)}  ${summarizeConsoleValue(obj[key])}`).join('\n');
}

export type ConsoleEvalResult =
  | { kind: 'print'; query: string; resultText: string }
  | { kind: 'error'; query: string; error: string }
  | { kind: 'clear' }
  | { kind: 'help'; resultText: string };

/** Resolve a path into `$` (`$`, `$.nodes`, `nodes.foo`, …). */
export function resolveConsolePath(context: ConsoleRunContext, rawQuery: string): unknown {
  let path = rawQuery.trim();
  if (path === '' || path === '$' || path === '.') return context;
  if (path.startsWith('$.')) path = path.slice(2);
  else if (path.startsWith('$')) path = path.slice(1);
  if (path.startsWith('.')) path = path.slice(1);
  if (!path) return context;
  return resolveJsonPath(context, path);
}

/**
 * Evaluate a console line: macros (`clear` / `help`) or a `$` path with
 * one-level printing.
 */
export function evaluateConsoleQuery(context: ConsoleRunContext, rawQuery: string): ConsoleEvalResult {
  const trimmed = rawQuery.trim();
  const query = trimmed === '' ? '$' : trimmed;
  const lower = query.toLowerCase();

  if (lower === 'clear' || lower === 'cls') return { kind: 'clear' };
  if (lower === 'help' || lower === '?') return { kind: 'help', resultText: CONSOLE_HELP };

  try {
    const value = resolveConsolePath(context, query);
    if (value === undefined) {
      return { kind: 'error', query, error: `No value at ${query}` };
    }
    const printingNodes = value === context.nodes;
    return {
      kind: 'print',
      query,
      resultText: formatOneLevel(value, printingNodes ? { nodeOrder: context.nodeOrder } : undefined),
    };
  } catch (err) {
    return { kind: 'error', query, error: err instanceof Error ? err.message : String(err) };
  }
}

const CONSOLE_MACROS: { label: string; detail: string }[] = [
  { label: 'help', detail: 'macros & symbols' },
  { label: 'clear', detail: 'clear screen' },
  { label: 'cls', detail: 'clear screen' },
];

const CONSOLE_ROOT_SHORTCUTS: { label: string; detail: string }[] = [
  { label: '$', detail: 'workflow context' },
  { label: '$.nodes', detail: 'nodes in run order' },
  { label: '$.credentials', detail: 'credential stubs' },
  { label: 'request', detail: 'focused request' },
  { label: 'response', detail: 'focused response' },
];

export interface ConsoleCompletionOption {
  label: string;
  detail?: string;
  type?: string;
}

export interface ConsoleCompletions {
  from: number;
  options: ConsoleCompletionOption[];
}

function completionChildKeys(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.map((_, i) => String(i));
  return Object.keys(value as Record<string, unknown>).filter((k) => k !== 'nodeOrder');
}

/**
 * Pure path/macro completions for the text before the caret. Exported for
 * unit tests — the CodeMirror source is a thin wrapper around this.
 */
export function getConsoleCompletions(
  context: ConsoleRunContext,
  line: string,
  cursor: number = line.length
): ConsoleCompletions | null {
  const before = line.slice(0, cursor);
  const lead = before.match(/^\s*/)?.[0].length ?? 0;
  const text = before.slice(lead);
  if (/\s/.test(text)) return null;

  const filterPrefix = (options: ConsoleCompletionOption[], prefix: string): ConsoleCompletionOption[] => {
    if (!prefix) return options;
    const lower = prefix.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().startsWith(lower));
  };

  // Bare prefix (no `$`, no `.`): macros + shortcuts.
  if (!text.includes('.') && !text.startsWith('$')) {
    const options = filterPrefix(
      [
        ...CONSOLE_MACROS.map((m) => ({ ...m, type: 'keyword' })),
        ...CONSOLE_ROOT_SHORTCUTS.map((r) => ({ ...r, type: 'variable' })),
      ],
      text
    );
    return options.length ? { from: lead, options } : null;
  }

  // `$` alone — offer rooted shortcuts.
  if (text === '$') {
    return {
      from: lead,
      options: CONSOLE_ROOT_SHORTCUTS.filter((r) => r.label.startsWith('$')).map((r) => ({
        ...r,
        type: 'variable',
      })),
    };
  }

  // Path: optional `$.` / `$` / `.` prefix, completed segments, partial segment.
  const m = text.match(/^(\$?\.?)((?:[A-Za-z0-9_]+\.)*)([A-Za-z0-9_]*)$/);
  if (!m) return null;

  const [, prefix, completed, partial] = m;
  const parentPath = completed.replace(/\.$/, '');
  const replaceFrom = lead + prefix.length + completed.length;

  let parent: unknown;
  if (!parentPath) {
    parent = context;
  } else {
    parent = resolveConsolePath(context, parentPath);
  }
  if (parent === undefined) return null;

  const keys = completionChildKeys(parent);
  const options = keys
    .filter((k) => !partial || k.toLowerCase().startsWith(partial.toLowerCase()))
    .map((k) => {
      const child =
        isPlainObject(parent) || Array.isArray(parent)
          ? (parent as Record<string, unknown>)[k]
          : undefined;
      return {
        label: k,
        detail: summarizeConsoleValue(child).slice(0, 48),
        type: 'property',
      };
    });

  return options.length ? { from: replaceFrom, options } : null;
}

export function consoleCompletionSource(getContext: () => ConsoleRunContext) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const found = getConsoleCompletions(getContext(), line.text, ctx.pos - line.from);
    if (!found) return null;
    const options: Completion[] = found.options.map((o) => ({
      label: o.label,
      detail: o.detail,
      type: o.type,
    }));
    // Full shortcuts after `$` (e.g. `$.nodes`) don't fuzzy-match `$` — keep them.
    const typed = line.text.slice(found.from, ctx.pos - line.from);
    const filter = !(typed === '$' || typed.startsWith('$.'));
    return {
      from: line.from + found.from,
      to: ctx.pos,
      options,
      filter,
    };
  };
}

export interface ConsoleInputHandlers {
  getContext: () => ConsoleRunContext;
  onSubmit: (query: string) => void;
  onHistoryPrev: (view: EditorView) => void;
  onHistoryNext: (view: EditorView) => void;
}

/**
 * Enter in the console input: insert the highlighted completion when it
 * changes the line; otherwise submit. Shared by the keymap so tests can
 * exercise the same path without synthesizing DOM key events.
 */
export function handleConsoleEnter(view: EditorView, onSubmit: (query: string) => void): boolean {
  if (completionStatus(view.state) === 'active') {
    const before = view.state.doc.toString();
    if (acceptCompletion(view) && view.state.doc.toString() !== before) {
      return true;
    }
  }
  onSubmit(view.state.doc.toString());
  return true;
}

/** Single-line console input — dark CM + path autocomplete + Enter / ↑↓. */
export function buildConsoleInputExtensions(handlers: ConsoleInputHandlers): Extension[] {
  const stripNewlines = EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    const next = tr.newDoc.toString();
    if (!next.includes('\n')) return tr;
    const cleaned = next.replace(/\n/g, '');
    return {
      changes: { from: 0, to: tr.startState.doc.length, insert: cleaned },
      selection: { anchor: Math.min(tr.newSelection.main.head, cleaned.length) },
    };
  });

  return [
    cmHistory(),
    Prec.highest(
      keymap.of([
        {
          key: 'Enter',
          run: (view) => handleConsoleEnter(view, handlers.onSubmit),
        },
        {
          key: 'Tab',
          run: acceptCompletion,
        },
        {
          key: 'ArrowUp',
          run: (view) => {
            if (completionStatus(view.state) === 'active') return false;
            handlers.onHistoryPrev(view);
            return true;
          },
        },
        {
          key: 'ArrowDown',
          run: (view) => {
            if (completionStatus(view.state) === 'active') return false;
            handlers.onHistoryNext(view);
            return true;
          },
        },
        {
          key: 'Ctrl-Space',
          run: startCompletion,
        },
      ])
    ),
    keymap.of([...defaultKeymap.filter((b) => b.key !== 'Enter' && b.key !== 'Tab'), ...historyKeymap]),
    autocompletion({
      override: [consoleCompletionSource(handlers.getContext)],
      activateOnTyping: true,
      defaultKeymap: true,
      // Arrow-then-Enter should accept immediately — the default 75ms delay
      // made Enter fall through and submit the incomplete prefix (`$.`).
      interactionDelay: 0,
    }),
    placeholder('$, $.nodes, help, clear…'),
    EditorView.theme({}, { dark: true }),
    tooltips({ parent: typeof document !== 'undefined' ? document.body : undefined }),
    EditorView.contentAttributes.of({ 'aria-label': 'Console query' }),
    EditorView.lineWrapping,
    stripNewlines,
  ];
}

function setConsoleDoc(view: EditorView, text: string) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: text.length },
  });
}

/**
 * Classic debug REPL — one-level expansion of workflow `$` symbols.
 * Session-only; not persisted. `clear`/`cls` wipe the screen but keep
 * command recall for ↑/↓. Input is CodeMirror with path autocomplete.
 */
export function DebugConsole() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const connections = useWorkflowStore((s) => s.connections);
  const operations = useWorkflowStore((s) => s.operations);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const stepStatusByNodeId = useWorkflowStore((s) => s.stepStatusByNodeId);
  const runResult = useWorkflowStore((s) => s.runResult);
  const previewRequestByNodeId = useWorkflowStore((s) => s.previewRequestByNodeId);
  const credentials = useWorkflowStore((s) => s.credentials);

  const [log, setLog] = useState<ConsoleHistoryEntry[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [, setHistoryIndex] = useState<number | null>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const operationsById = useMemo(() => new Map(operations.map((o) => [o.id, o])), [operations]);
  const nodeLabels = useMemo(() => buildNodeLabels(nodes, operationsById), [nodes, operationsById]);
  const stepsByNodeId = useMemo(() => new Map((runResult?.steps ?? []).map((s) => [s.nodeId, s])), [runResult]);

  const orderedNodes = useMemo(() => {
    try {
      return topologicalSort(nodes, connections);
    } catch (err) {
      if (err instanceof CyclicWorkflowError) return nodes;
      throw err;
    }
  }, [nodes, connections]);

  const focus = useMemo(
    () =>
      resolveConsoleFocus({
        nodes,
        orderedNodes,
        selectedNodeId,
        stepStatusByNodeId,
        stepsByNodeId,
        previewRequestByNodeId,
        operationsById,
        nodeLabels,
        credentials,
      }),
    [
      nodes,
      orderedNodes,
      selectedNodeId,
      stepStatusByNodeId,
      stepsByNodeId,
      previewRequestByNodeId,
      operationsById,
      nodeLabels,
      credentials,
    ]
  );

  const liveRef = useRef({
    context: focus.context,
    label: focus.label,
    commandHistory,
    historyIndex: null as number | null,
  });
  liveRef.current.context = focus.context;
  liveRef.current.label = focus.label;
  liveRef.current.commandHistory = commandHistory;

  useEffect(() => {
    const el = historyEndRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [log]);

  const rememberCommand = (query: string) => {
    setCommandHistory((prev) => (prev[prev.length - 1] === query ? prev : [...prev, query]));
  };

  useEffect(() => {
    if (!editorHostRef.current) return;

    const submitQuery = (raw: string) => {
      const result = evaluateConsoleQuery(liveRef.current.context, raw);
      liveRef.current.historyIndex = null;
      setHistoryIndex(null);
      if (viewRef.current) setConsoleDoc(viewRef.current, '');

      const focusLabel = liveRef.current.label ?? '(workflow)';

      if (result.kind === 'clear') {
        rememberCommand(raw.trim().toLowerCase() || 'clear');
        setLog([]);
        return;
      }
      if (result.kind === 'help') {
        rememberCommand('help');
        setLog((prev) => [...prev, { query: 'help', focusLabel, resultText: result.resultText }]);
        return;
      }
      if (result.kind === 'error') {
        rememberCommand(result.query);
        setLog((prev) => [...prev, { query: result.query, focusLabel, error: result.error }]);
        return;
      }
      rememberCommand(result.query);
      setLog((prev) => [...prev, { query: result.query, focusLabel, resultText: result.resultText }]);
    };

    const view = new EditorView({
      doc: '',
      parent: editorHostRef.current,
      extensions: buildConsoleInputExtensions({
        getContext: () => liveRef.current.context,
        onSubmit: submitQuery,
        onHistoryPrev: (v) => {
          const hist = liveRef.current.commandHistory;
          if (hist.length === 0) return;
          const idx = liveRef.current.historyIndex;
          const next = idx === null ? hist.length - 1 : Math.max(0, idx - 1);
          liveRef.current.historyIndex = next;
          setHistoryIndex(next);
          setConsoleDoc(v, hist[next]);
        },
        onHistoryNext: (v) => {
          const hist = liveRef.current.commandHistory;
          const idx = liveRef.current.historyIndex;
          if (idx === null) return;
          if (idx >= hist.length - 1) {
            liveRef.current.historyIndex = null;
            setHistoryIndex(null);
            setConsoleDoc(v, '');
            return;
          }
          const next = idx + 1;
          liveRef.current.historyIndex = next;
          setHistoryIndex(next);
          setConsoleDoc(v, hist[next]);
        },
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once — handlers read liveRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="debug-console">
      <div className="debug-console__history" role="log" aria-label="Console history">
        {log.length === 0 && (
          <p className="debug-console__hint">
            Type <code>$</code> for a one-level view, <code>$.nodes</code> to list nodes,{' '}
            <code>help</code> for macros. <code>clear</code> clears the screen. Enter accepts a
            completion; Enter again runs it.
          </p>
        )}
        {log.map((entry, i) => (
          <div key={i} className="debug-console__entry">
            <div className="debug-console__query">
              <span className="debug-console__prompt">&gt;</span> {entry.query}
              <span className="debug-console__entry-focus">{entry.focusLabel}</span>
            </div>
            {entry.error ? (
              <pre className="debug-console__output debug-console__output--error">{entry.error}</pre>
            ) : (
              <pre className="debug-console__output">{entry.resultText}</pre>
            )}
          </div>
        ))}
        <div ref={historyEndRef} />
      </div>
      <div className="debug-console__input-row">
        <span className="debug-console__prompt" aria-hidden="true">
          &gt;
        </span>
        <div className="debug-console__input" ref={editorHostRef} />
      </div>
    </div>
  );
}
