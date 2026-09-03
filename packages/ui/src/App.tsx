import { useCallback, useEffect, useState } from 'react';
import { useWorkflowStore } from './store/workflowStore.js';
import {
  Canvas,
  ChromeSettingsMenu,
  DebugPane,
  NodeConfig,
  NodeConfigShell,
  NODE_CONFIG_DEFAULT_WIDTH,
  OperationList,
  RunControls,
  WorkflowSwitcher,
} from './components/index.js';

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
  const [showNodeConfig, setShowNodeConfig] = useState(true);
  const [showDebugPane, setShowDebugPane] = useState(true);
  const [nodeConfigWidth, setNodeConfigWidth] = useState(NODE_CONFIG_DEFAULT_WIDTH);
  const onNodeConfigWidthChange = useCallback((width: number) => setNodeConfigWidth(width), []);

  useEffect(() => {
    loadOperations();
  }, [loadOperations]);

  // One global set of controls for the whole run, not one per paused node
  // (Results pane pause bar also offers Continue/Step for the focused node).
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
      <div
        className={`app__body${showNodeConfig ? '' : ' app__body--inspector-collapsed'}`}
        style={
          showNodeConfig
            ? { gridTemplateColumns: `240px minmax(240px, 1fr) ${nodeConfigWidth}px` }
            : undefined
        }
      >
        <OperationList operations={operations} />
        <Canvas />
        {showNodeConfig ? (
          <NodeConfigShell onCollapse={() => setShowNodeConfig(false)} onWidthChange={onNodeConfigWidthChange}>
            <NodeConfig />
          </NodeConfigShell>
        ) : (
          <button
            type="button"
            className="pane-strip pane-strip--right"
            onClick={() => setShowNodeConfig(true)}
            title="Show node config"
            aria-label="Show node config"
          >
            ‹
          </button>
        )}
      </div>
      <DebugPane collapsed={!showDebugPane} onToggleCollapsed={() => setShowDebugPane((v) => !v)} />
    </div>
  );
}
