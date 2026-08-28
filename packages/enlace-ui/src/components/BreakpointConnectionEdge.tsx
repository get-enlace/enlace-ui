import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from 'reactflow';
import { useWorkflowStore } from '../store/workflowStore.js';

export interface ConnectionEdgeData {
  fromNodeId: string;
  toNodeId: string;
  /** Whether a breakpoint is currently armed on this exact connector — see store/workflowStore.ts's `armedBreakpoints`. */
  armed: boolean;
}

/**
 * Custom edge type for user-drawn "connection" edges only — registered in
 * Canvas.tsx's `edgeTypes` and applied via `type: 'connection'` on
 * connection edges specifically, never on mapping edges (which keep using
 * React Flow's plain default edge). That split is what makes "a breakpoint
 * can only ever arm on a connector, never a field-mapping edge" true at
 * the rendering level, not just a runtime check — see issue #13.
 *
 * Renders the exact same bezier path a default edge would, plus a small
 * clickable marker at the midpoint (via `EdgeLabelRenderer`, since React
 * Flow has no built-in "extra decoration on an edge" mechanism) that
 * toggles a breakpoint on this connector.
 */
export function BreakpointConnectionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps<ConnectionEdgeData>) {
  const toggleBreakpoint = useWorkflowStore((s) => s.toggleBreakpoint);
  // toggleBreakpoint itself already no-ops while running (workflowStore.ts's
  // isLocked) — arming/disarming mid-run has no effect on a run already in
  // progress anyway (see ChainExecutorOptions.armedBreakpoints's own doc
  // comment), so disabling the marker here just matches what's already true.
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <button
          type="button"
          // nodrag/nopan: React Flow's own convention for interactive
          // elements rendered via EdgeLabelRenderer — without these, a
          // click here also starts a canvas pan/selection-drag gesture.
          className={`nodrag nopan breakpoint-marker${data?.armed ? ' breakpoint-marker--armed' : ''}`}
          disabled={isRunning}
          // Counter-scaled against the same --rf-zoom CSS var Canvas.tsx
          // maintains, same trick as .react-flow__handle::after in
          // styles.css — without it this shrinks along with the canvas and
          // becomes nearly unclickable at a zoomed-out cluttered canvas's
          // minZoom floor.
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px) scale(calc(1 / var(--rf-zoom, 1)))`,
          }}
          // Stop both so this doesn't also select the edge (which a plain
          // click on the path itself still does) or start a drag gesture
          // before the click registers — same pattern as WorkflowNodeCard's
          // remove button.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (data) toggleBreakpoint(data.fromNodeId, data.toNodeId);
          }}
          title={
            isRunning
              ? "Can't change breakpoints while the workflow is running"
              : data?.armed
                ? 'Remove breakpoint'
                : 'Add a breakpoint — pauses the run here'
          }
          aria-label={data?.armed ? 'Remove breakpoint' : 'Add a breakpoint'}
          aria-pressed={data?.armed ?? false}
        />
      </EdgeLabelRenderer>
    </>
  );
}
