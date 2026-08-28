import { useEffect, useState } from 'react';
import { useWorkflowStore } from './store/workflowStore.js';
import { OperationList } from './components/OperationList.js';
import { Canvas } from './components/Canvas.js';
import { NodeInspector } from './components/NodeInspector.js';
import { DebugPane } from './components/DebugPane.js';
import { CredentialsPanel } from './components/CredentialsPanel.js';

export default function App() {
  const {
    operations,
    loadOperations,
    run,
    isRunning,
    nodes,
    stepStatusByNodeId,
    selectedNodeId,
    activeControl,
    continueExecution,
    stepNode,
    stopExecution,
  } = useWorkflowStore();
  // Pure view state (not workflow data) — collapsing a pane doesn't change
  // what gets run, just how much canvas room the user gets to work with.
  const [showInspector, setShowInspector] = useState(true);
  const [showDebugPane, setShowDebugPane] = useState(true);

  useEffect(() => {
    loadOperations();
  }, [loadOperations]);

  // One global set of controls for the whole run, not one per paused node
  // (see DebuggerTab.tsx — it used to repeat these per row; a single place
  // is both less noisy and matches "there's one run happening", even
  // though several nodes can be paused at once).
  const pausedNodeIds = nodes.filter((n) => stepStatusByNodeId[n.id] === 'paused').map((n) => n.id);
  // Step needs one specific target: the selected node if it's actually
  // paused right now, otherwise whichever paused node comes first — so the
  // button always has a sensible default even before you've clicked
  // anything on canvas, but respects your selection once you have.
  const stepTarget = pausedNodeIds.includes(selectedNodeId ?? '') ? selectedNodeId! : pausedNodeIds[0];

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="app__logo" />
          Enlace
        </h1>
        <CredentialsPanel />
        {/* Run vs. Debug are two distinct actions, not one button whose
            behavior silently depends on whatever's armed: a user with
            breakpoints set up may still just want a plain, uninterrupted
            run — see store/workflowStore.ts's run(), which only honors
            armedBreakpoints (and sets activeControl at all) when told to.
            Both — and this pair specifically — disappear once a debug run
            is actually controllable, replaced by Continue/Step/Stop below;
            showing "Running…" alongside those would just be noise; a plain
            "Run" already covers the non-debug in-flight case. */}
        {!activeControl && (
          <>
            <button type="button" className="btn btn--execute" onClick={() => run()} disabled={isRunning}>
              {isRunning ? 'Running…' : 'Run'}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => run({ useBreakpoints: true })}
              disabled={isRunning}
              title="Run, honoring any breakpoints armed on the canvas"
            >
              Debug
            </button>
          </>
        )}
        {/* Icon-only — a hover title is the accessible name (no visible
            label to duplicate it), keeping this compact instead of three
            full text buttons. Same actions are also available inline on
            each paused row in the Debugger tab (DebuggerTab.tsx), where
            Step has an unambiguous per-row target instead of this
            fallback-to-selected-or-first-paused heuristic. */}
        {activeControl && (
          <div className="app__run-controls">
            <button
              type="button"
              className="btn btn--icon btn--execute"
              onClick={continueExecution}
              disabled={pausedNodeIds.length === 0}
              title="Continue — release every node currently paused"
              aria-label="Continue"
            >
              ▶
            </button>
            <button
              type="button"
              className="btn btn--icon btn--secondary"
              onClick={() => stepTarget && stepNode(stepTarget)}
              disabled={!stepTarget}
              title={
                pausedNodeIds.length > 1
                  ? 'Step — release just the selected paused node (or the first paused node, if none is selected)'
                  : 'Step — release the paused node'
              }
              aria-label="Step"
            >
              ⏭
            </button>
            <button
              type="button"
              className="btn btn--icon btn--stop"
              onClick={stopExecution}
              title="Stop — nothing new fires; anything already in flight still completes"
              aria-label="Stop"
            >
              ■
            </button>
          </div>
        )}
      </header>
      <div className={`app__body${showInspector ? '' : ' app__body--inspector-collapsed'}`}>
        <OperationList operations={operations} />
        <Canvas />
        {showInspector ? (
          <NodeInspector onCollapse={() => setShowInspector(false)} />
        ) : (
          <button
            type="button"
            className="pane-strip pane-strip--right"
            onClick={() => setShowInspector(true)}
            title="Show inspector"
            aria-label="Show inspector"
          >
            ‹
          </button>
        )}
      </div>
      <DebugPane collapsed={!showDebugPane} onToggleCollapsed={() => setShowDebugPane((v) => !v)} />
    </div>
  );
}
