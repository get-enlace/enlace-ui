import {
  acceptCompletion,
  autocompletion,
  completionStatus,
  startCompletion,
} from '@codemirror/autocomplete';
import { defaultKeymap, history as cmHistory, historyKeymap } from '@codemirror/commands';
import { EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder, tooltips } from '@codemirror/view';
import { consoleCompletionSource } from './completions.js';
import type { ConsoleRunContext } from './types.js';

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
