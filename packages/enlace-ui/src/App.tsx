import { useEffect, useState } from 'react';
import { useWorkflowStore } from './store/workflowStore.js';
import { OperationList } from './components/OperationList.js';
import { Canvas } from './components/Canvas.js';
import { NodeInspector } from './components/NodeInspector.js';
import { DebugPane } from './components/DebugPane.js';
import { ChromeSettingsMenu } from './components/ChromeSettingsMenu.js';
import { WorkflowSwitcher } from './components/WorkflowSwitcher.js';
import { RunControls } from './components/RunControls.js';

export default function App() {
  const {
    operations,
    loadOperations,
    run,
    isRunning,
    nodes,
    stepStatusByNodeId,
    selectedNodeId,
    isDebugRun,
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
        <WorkflowSwitcher />
        <div className="app__chrome-actions">
          <RunControls
            isRunning={isRunning}
            isDebugRun={isDebugRun}
            pausedCount={pausedNodeIds.length}
            canStep={!!stepTarget}
            onRun={() => run()}
            onDebug={() => run({ useBreakpoints: true })}
            onContinue={continueExecution}
            onStep={() => stepTarget && stepNode(stepTarget)}
            onStop={stopExecution}
            stepTitle={
              pausedNodeIds.length > 1
                ? 'Step — release just the selected paused node (or the first paused node, if none is selected)'
                : 'Step — release the paused node'
            }
          />
          <ChromeSettingsMenu />
        </div>
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
