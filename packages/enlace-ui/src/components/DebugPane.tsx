import { useEffect, useRef, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore.js';
import { DebuggerTab, summarizeDebuggerStatus } from './DebuggerTab.js';
import { RunOutputTab } from './RunOutputTab.js';

export interface DebugPaneProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

type Tab = 'run-output' | 'debugger';

export function DebugPane({ collapsed, onToggleCollapsed }: DebugPaneProps) {
  const runResult = useWorkflowStore((s) => s.runResult);
  const nodes = useWorkflowStore((s) => s.nodes);
  const stepStatusByNodeId = useWorkflowStore((s) => s.stepStatusByNodeId);
  const armedBreakpoints = useWorkflowStore((s) => s.armedBreakpoints);

  // Local, not store state — same reasoning as App.tsx's showDebugPane:
  // which tab is showing doesn't change what gets run. The one exception
  // is the auto-switch below, which is a deliberate signal *from* run
  // state *into* this local choice, not the other way around.
  const [tab, setTab] = useState<Tab>('run-output');

  // Arming a breakpoint is a deliberate "I want to see this" signal, so
  // execution actually reaching one should surface the Debugger tab
  // without the user having to go find it — but only on the rising edge
  // (nothing paused -> something paused), so a user who deliberately
  // switches back to Run Output isn't fought every render while the pause
  // is still in effect.
  const anyPaused = Object.values(stepStatusByNodeId).some((status) => status === 'paused');
  const wasAnyPausedRef = useRef(false);
  useEffect(() => {
    if (anyPaused && !wasAnyPausedRef.current) setTab('debugger');
    wasAnyPausedRef.current = anyPaused;
  }, [anyPaused]);

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
        </button>
        <div className="debug-pane__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'run-output'}
            className={`debug-pane__tab${tab === 'run-output' ? ' debug-pane__tab--active' : ''}`}
            onClick={() => setTab('run-output')}
          >
            Run output
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'debugger'}
            className={`debug-pane__tab${tab === 'debugger' ? ' debug-pane__tab--active' : ''}`}
            onClick={() => setTab('debugger')}
          >
            Debugger
          </button>
        </div>
        {tab === 'run-output' && runResult && (
          <span className="debug-pane__count">{runResult.steps.length} call(s)</span>
        )}
        {tab === 'debugger' && armedBreakpoints.size > 0 && (
          <span className="debug-pane__count">{summarizeDebuggerStatus(nodes, stepStatusByNodeId)}</span>
        )}
      </div>

      {!collapsed && (tab === 'run-output' ? <RunOutputTab /> : <DebuggerTab />)}
    </div>
  );
}
