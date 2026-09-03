import { resolveJsonPath } from '@get-enlace/core';
import { CONSOLE_HELP, type ConsoleNodeContext, type ConsoleCredentialStub, type ConsoleRunContext } from './types.js';

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

