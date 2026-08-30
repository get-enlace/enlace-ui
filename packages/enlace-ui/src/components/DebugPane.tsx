import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore.js';
import { ResultsList, summarizeResultsStatus } from './ResultsList.js';

export interface DebugPaneProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const DEFAULT_HEIGHT = 260;
const MIN_HEIGHT = 140;
const MAX_HEIGHT_RATIO = 0.55;

/**
 * Bottom Results pane — unified live step list (debugger chrome + request/
 * response expand). A future debug-only console may split this horizontally;
 * that surface is intentionally not built here.
 */
export function DebugPane({ collapsed, onToggleCollapsed }: DebugPaneProps) {
  const runResult = useWorkflowStore((s) => s.runResult);
  const nodes = useWorkflowStore((s) => s.nodes);
  const stepStatusByNodeId = useWorkflowStore((s) => s.stepStatusByNodeId);
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const error = useWorkflowStore((s) => s.error);
  const clearResults = useWorkflowStore((s) => s.clearResults);

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

  const summary = summarizeResultsStatus(nodes, stepStatusByNodeId, runResult?.steps.length ?? 0);
  const canClear =
    !isRunning && Boolean(runResult || error || Object.keys(stepStatusByNodeId).length > 0);

  return (
    <div
      className={`debug-pane${collapsed ? ' debug-pane--collapsed' : ''}`}
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
          <span className="debug-pane__title">Results</span>
        </button>
        {summary && <span className="debug-pane__count">{summary}</span>}
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

      {!collapsed && <ResultsList />}
    </div>
  );
}
