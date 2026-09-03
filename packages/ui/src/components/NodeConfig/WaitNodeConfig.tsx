import { formatWaitDuration } from '@get-enlace/core';
import { useWorkflowStore } from '../../store/workflowStore.js';
import type { WorkflowNode } from '../../types.js';

interface WaitNodeConfigProps {
  node: WorkflowNode;
}

/**
 * Inspector for a Wait preset node — deliberately minimal next to the
 * operation `NodeConfig`: no credential lock (Wait's own scope is "no
 * credentials"), no request/response sections, just the one thing that
 * configures a Wait — its duration. The UI works in seconds; the store
 * always holds milliseconds (`WorkflowNode.durationMs`), same unit the
 * engine's waitNodeHandler sleeps on.
 */
export function WaitNodeConfig({ node }: WaitNodeConfigProps) {
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const setNodeDurationMs = useWorkflowStore((s) => s.setNodeDurationMs);
  const durationMs = node.durationMs ?? 0;

  return (
    <aside className="node-config">
      {isRunning && (
        <p className="node-config__banner">Workflow is running — editing is locked until it finishes.</p>
      )}
      <fieldset className="node-config__fieldset" disabled={isRunning}>
        <div className="node-config__header">
          <div className="node-config__op-title">
            <span className="wait-node__icon" aria-hidden="true">
              ⏱
            </span>
            <h2 className="node-config__path">Wait</h2>
          </div>
        </div>

        <section className="node-config__section">
          <h4 className="node-config__section-title">Duration</h4>
          <div className="node-config__field">
            <label htmlFor="wait-duration-seconds">Seconds</label>
            <input
              id="wait-duration-seconds"
              type="number"
              min={0}
              step={0.1}
              value={durationMs / 1000}
              onChange={(e) => {
                const seconds = Number(e.target.value);
                const nextMs = Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : 0;
                setNodeDurationMs(node.id, nextMs);
              }}
            />
          </div>
          <p className="node-config__hint">
            Pauses this branch for {formatWaitDuration(durationMs)} once its dependencies are satisfied, before
            continuing. No request, no credential, and no response for a downstream node to map from.
          </p>
        </section>
      </fieldset>
    </aside>
  );
}
