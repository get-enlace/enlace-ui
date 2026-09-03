import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { CyclicWorkflowError, topologicalSort, buildNodeLabels } from '@get-enlace/core';
import { useWorkflowStore } from '../../../store/workflowStore.js';
import { type ConsoleHistoryEntry } from './types.js';
import { resolveConsoleFocus } from './context.js';
import { evaluateConsoleQuery } from './evaluate.js';
import { buildConsoleInputExtensions } from './inputExtensions.js';

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
