import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { resolveConsolePath, summarizeConsoleValue } from './evaluate.js';
import type { ConsoleRunContext } from './types.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

