import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore.js';
import { buildNodeLabels } from '@get-enlace/core';
import { DebugConsole } from './DebugConsole.js';
import { ResultsList, summarizeResultsStatus } from './ResultsList.js';

export interface DebugPaneProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const DEFAULT_HEIGHT = 140; // match min so first paint stays compact
const MIN_HEIGHT = 140;
const MAX_HEIGHT_RATIO = 0.55;

/**
 * Bottom pane — Results (step list) always; while a Debug session is active
 * the body splits horizontally into Results | Console (REPL).
 */
export function DebugPane({ collapsed, onToggleCollapsed }: DebugPaneProps) {
  const runResult = useWorkflowStore((s) => s.runResult);
  const nodes = useWorkflowStore((s) => s.nodes);
  const operations = useWorkflowStore((s) => s.operations);
  const stepStatusByNodeId = useWorkflowStore((s) => s.stepStatusByNodeId);
  const previewRequestByNodeId = useWorkflowStore((s) => s.previewRequestByNodeId);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const error = useWorkflowStore((s) => s.error);
  const clearResults = useWorkflowStore((s) => s.clearResults);
  const continueExecution = useWorkflowStore((s) => s.continueExecution);
  const stepNode = useWorkflowStore((s) => s.stepNode);
  const debugConsoleOpen = useWorkflowStore((s) => s.debugConsoleOpen);

  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { startY: e.clientY, startHeight: height };
    },
    [height]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - e.clientY;
      const max = Math.floor(window.innerHeight * MAX_HEIGHT_RATIO);
      setHeight(Math.min(max, Math.max(MIN_HEIGHT, dragRef.current.startHeight + delta)));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const operationsById = useMemo(() => new Map(operations.map((o) => [o.id, o])), [operations]);
  const nodeLabels = useMemo(() => buildNodeLabels(nodes, operationsById), [nodes, operationsById]);
  const pausedNodeIds = useMemo(
    () => nodes.filter((n) => stepStatusByNodeId[n.id] === 'paused').map((n) => n.id),
    [nodes, stepStatusByNodeId]
  );
  const pauseFocusId = pausedNodeIds.includes(selectedNodeId ?? '') ? selectedNodeId! : pausedNodeIds[0];
  const pauseFocusLabel = pauseFocusId ? (nodeLabels.get(pauseFocusId) ?? pauseFocusId) : null;

  const summary = summarizeResultsStatus(nodes, stepStatusByNodeId, runResult?.steps.length ?? 0);
  const canClear =
    !isRunning &&
    Boolean(
      error ||
        Object.keys(stepStatusByNodeId).length > 0 ||
        Object.keys(previewRequestByNodeId).length > 0
    );
  const showConsole = debugConsoleOpen && !collapsed;

  return (
    <div
      className={`debug-pane${collapsed ? ' debug-pane--collapsed' : ''}${showConsole ? ' debug-pane--with-console' : ''}`}
      style={collapsed ? undefined : { height, maxHeight: 'none' }}
    >
      {!collapsed && (
        <div
          className="debug-pane__resize"
          onPointerDown={onResizePointerDown}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize results"
          title="Drag to resize"
        />
      )}
      <div className="debug-pane__header">
        <button
          type="button"
          className="debug-pane__toggle"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Show results' : 'Hide results'}
          aria-expanded={!collapsed}
        >
          <span className="debug-pane__toggle-chevron" aria-hidden="true">
            {collapsed ? '▲' : '▼'}
          </span>
          <span className="debug-pane__title">{showConsole ? 'Debug' : 'Results'}</span>
        </button>
        {pauseFocusLabel && (
          <div className="results-pause-bar results-pause-bar--header" role="status">
            <span className="results-pause-bar__label">
              Paused at <strong>{pauseFocusLabel}</strong>
            </span>
            <span className="results-pause-bar__actions">
              <button
                type="button"
                className="btn btn--icon btn--execute"
                onClick={continueExecution}
                title="Continue — release every node currently paused"
                aria-label="Continue"
              >
                ▶
              </button>
              <button
                type="button"
                className="btn btn--icon btn--secondary"
                onClick={() => pauseFocusId && stepNode(pauseFocusId)}
                title="Step — release just this paused node"
                aria-label="Step"
              >
                ⏭
              </button>
            </span>
          </div>
        )}
        {summary && (
          <span className="debug-pane__count" title={summary.title}>
            {summary.text}
          </span>
        )}
        <button
          type="button"
          className="debug-pane__clear"
          onClick={clearResults}
          disabled={!canClear}
          title={isRunning ? "Can't clear while a run is in progress." : 'Clear results'}
        >
          Clear
        </button>
      </div>

      {!collapsed && (
        <div className={`debug-pane__split${showConsole ? ' debug-pane__split--console' : ''}`}>
          <ResultsList />
          {showConsole && <DebugConsole />}
        </div>
      )}
    </div>
  );
}
