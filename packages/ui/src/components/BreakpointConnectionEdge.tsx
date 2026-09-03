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
 * Arming happens via a **double-click on the connector itself** — wired at
 * the canvas level (Canvas.tsx's `onEdgeDoubleClick`), not here, so no
 * always-visible placeholder marker is needed on unarmed edges just to
 * carry a click target. Once armed, the same double-click disarms; the
 * dot rendered below is also directly clickable as a redundant, more
 * discoverable disarm affordance (like an IDE breakpoint gutter).
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

  const hoverHint = isRunning
    ? "Can't change breakpoints while the workflow is running"
    : data?.armed
      ? 'Click to select · Double-click to remove debug point'
      : 'Click to select · Double-click to add debug point';

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {/* SVG-native tooltip on the edge itself — surfaces the double-click
          gesture (which is otherwise not self-advertising, unlike a
          rendered marker). Browser shows it after the usual hover delay
          when the pointer's over anywhere in this edge's group (the
          visible path plus React Flow's own wider `.react-flow__edge-
          interaction` hit-target sibling that this <title> is a sibling
          of too), no JS or custom tooltip layer needed. */}
      <title>{hoverHint}</title>
      {data?.armed && (
        <EdgeLabelRenderer>
          <button
            type="button"
            // nodrag/nopan: React Flow's own convention for interactive
            // elements rendered via EdgeLabelRenderer — without these, a
            // click here also starts a canvas pan/selection-drag gesture.
            className="nodrag nopan breakpoint-marker breakpoint-marker--armed"
            disabled={isRunning}
            // Counter-scaled against the same --rf-zoom CSS var Canvas.tsx
            // maintains, same trick as .react-flow__handle::after in
            // styles/canvas.css — without it this shrinks along with the canvas and
            // becomes nearly unclickable at a zoomed-out cluttered canvas's
            // minZoom floor.
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px) scale(calc(1 / var(--rf-zoom, 1)))`,
            }}
            // Stop both so this doesn't also select the edge (which a plain
            // click on the path itself still does) or start a drag gesture
            // before the click registers — same pattern as WorkflowNodeCard's
            // remove button. onDoubleClick is stopped too so a double-click
            // landing on the marker only disarms once (via the click that's
            // already part of it), not disarm-then-rearm from Canvas.tsx's
            // onEdgeDoubleClick firing on the same gesture.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleBreakpoint(data.fromNodeId, data.toNodeId);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            title={
              isRunning
                ? "Can't change breakpoints while the workflow is running"
                : 'Remove breakpoint'
            }
            aria-label="Remove breakpoint"
            aria-pressed
          />
        </EdgeLabelRenderer>
      )}
    </>
  );
}
