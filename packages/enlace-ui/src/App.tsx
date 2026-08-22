import { useEffect, useState } from 'react';
import { useWorkflowStore } from './store/workflowStore.js';
import { OperationList } from './components/OperationList.js';
import { Canvas } from './components/Canvas.js';
import { NodeInspector } from './components/NodeInspector.js';
import { DebugPane } from './components/DebugPane.js';
import { CredentialsPanel } from './components/CredentialsPanel.js';

export default function App() {
  const { operations, loadOperations, run, isRunning } = useWorkflowStore();
  // Pure view state (not workflow data) — collapsing a pane doesn't change
  // what gets run, just how much canvas room the user gets to work with.
  const [showInspector, setShowInspector] = useState(true);
  const [showDebugPane, setShowDebugPane] = useState(true);

  useEffect(() => {
    loadOperations();
  }, [loadOperations]);

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Enlace</h1>
        <CredentialsPanel />
        <button className="btn btn--execute" onClick={run} disabled={isRunning}>
          {isRunning ? 'Running…' : 'Run'}
        </button>
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
