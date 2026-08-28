import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type Viewport,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { connectionKey } from '../engine/chainExecutor.js';
import { useWorkflowStore } from '../store/workflowStore.js';
import { buildNodeLabels } from '../utils/nodeLabel.js';
import { BreakpointConnectionEdge } from './BreakpointConnectionEdge.js';
import { WorkflowNodeCard, type WorkflowNodeData } from './WorkflowNodeCard.js';

const nodeTypes = { workflowNode: WorkflowNodeCard };
const edgeTypes = { connection: BreakpointConnectionEdge };

// useReactFlow (needed to translate a drop's screen coordinates into canvas
// coordinates) only works inside a ReactFlowProvider, so the actual canvas
// logic lives in an inner component wrapped by one.
export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}

function CanvasInner() {
  const {
    nodes,
    nodePositions,
    connections,
    operations,
    selectedNodeId,
    stepStatusByNodeId,
    armedBreakpoints,
    addNode,
    updateNodePosition,
    selectNode,
    connectNodes,
    disconnectNodes,
    removeNode,
  } = useWorkflowStore();
  const { screenToFlowPosition, fitView, getViewport } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const prevNodeCountRef = useRef(nodes.length);

  // Canvas-local, not store state — unlike node selection (which the
  // Inspector panel needs), nothing outside the canvas cares which edge
  // is selected. `flowEdges` is a value freshly computed every render
  // (not React Flow's own internal state, same as `flowNodes` above), so
  // without tracking this ourselves and feeding it back in as each edge's
  // `selected` prop, a click's selection would just vanish on the very
  // next re-render instead of sticking around to show which edge Delete
  // would act on.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Handles live inside the zoomed viewport, so their hit target shrinks
  // right along with the canvas — at the 0.5 minZoom floor the connect
  // gesture from card-cluttered zoom-out targets a couple of screen
  // pixels. Mirror the current zoom onto a CSS var so .react-flow__handle
  // (styles.css) can counter-scale its hit area back to a constant,
  // grabbable screen size at any zoom level, not just a fixed fraction
  // bigger.
  const setZoomVar = useCallback((viewport: Viewport) => {
    wrapperRef.current?.style.setProperty('--rf-zoom', String(viewport.zoom));
  }, []);

  useEffect(() => {
    setZoomVar(getViewport());
  }, [getViewport, setZoomVar]);

  // Global — every node in the workflow at once, not scoped to any one node's ancestors — so a
  // card's "#N" here always matches what that same node shows in every "Map from..." picker and
  // tag chip (see utils/nodeLabel.ts's buildNodeLabels doc).
  const nodeLabels = useMemo(() => {
    const operationsById = new Map(operations.map((o) => [o.id, o]));
    return buildNodeLabels(nodes, operationsById);
  }, [nodes, operations]);

  const flowNodes: Node<WorkflowNodeData>[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: 'workflowNode',
        position: nodePositions[n.id] ?? { x: 80, y: 80 },
        data: {
          node: n,
          operation: operations.find((o) => o.id === n.operationId),
          selected: n.id === selectedNodeId,
          status: stepStatusByNodeId[n.id],
          label: nodeLabels.get(n.id),
        },
      })),
    [nodes, nodePositions, operations, selectedNodeId, stepStatusByNodeId, nodeLabels]
  );

  // Two distinct edge kinds, styled differently (see styles.css):
  //   - "connection" edges are user-drawn (via onConnect below) and
  //     establish execution ORDER only.
  //   - "mapping" edges are derived, not user-drawn, and visualize a
  //     field's DATA SOURCE set via the Node Inspector's "map from..."
  //     picker. A mapping always implies its own order dependency too
  //     (see src/types.ts's WorkflowConnection doc), so it's fine for both
  //     kinds to exist between the same two nodes at once.
  const flowEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = connections.map((c) => ({
      id: `conn-${c.fromNodeId}->${c.toNodeId}`,
      source: c.fromNodeId,
      target: c.toNodeId,
      // 'connection' (registered in edgeTypes above) — never applied to a
      // mapping edge below, which is what makes "a breakpoint can only
      // ever arm on a connector" true at the rendering level, not just a
      // runtime check.
      type: 'connection',
      className: 'edge-connection',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#9aa0a6' },
      // Carried through to onEdgesChange below, so a 'remove' change (select
      // the edge, press Backspace/Delete) can call disconnectNodes with the
      // right pair without parsing it back out of the id string. `armed`
      // drives BreakpointConnectionEdge's marker — see its own doc comment.
      data: {
        fromNodeId: c.fromNodeId,
        toNodeId: c.toNodeId,
        armed: armedBreakpoints.has(connectionKey(c.fromNodeId, c.toNodeId)),
      },
    }));

    for (const node of nodes) {
      for (const fieldValue of Object.values(node.fieldValues)) {
        if (fieldValue.source === 'mapped') {
          edges.push({
            id: `map-${fieldValue.fromNodeId}->${node.id}-${edges.length}`,
            source: fieldValue.fromNodeId,
            target: node.id,
            className: 'edge-mapping',
            animated: true,
          });
        }
      }
    }
    return edges.map((e) => ({ ...e, selected: e.id === selectedEdgeId }));
  }, [nodes, connections, selectedEdgeId, armedBreakpoints]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const operationId = e.dataTransfer.getData('text/operation-id');
      if (!operationId) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(operationId, position);
    },
    [addNode, screenToFlowPosition]
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (params.source && params.target) connectNodes(params.source, params.target);
    },
    [connectNodes]
  );

  // Nodes are otherwise controlled entirely from the store — without this,
  // a drag updates React Flow's internal position for one frame and then
  // gets overwritten by the next render's `flowNodes` (computed from
  // `nodePositions`), so the box snaps back and looks unmovable. The same
  // applies to deletion: React Flow's default deleteKeyCode (Backspace/
  // Delete) fires a 'remove' change here when a selected node is deleted,
  // but without this handler our store never drops it, so it would just
  // reappear on the next render. The node card's own × button is the more
  // discoverable way to remove a node; this is a bonus for keyboard users.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          updateNodePosition(change.id, change.position);
        } else if (change.type === 'remove') {
          removeNode(change.id);
        }
      }
    },
    [updateNodePosition, removeNode]
  );

  // Same story as onNodesChange above, for edges: they're computed fresh
  // from `connections`/`fieldValues` every render (flowEdges), not React
  // Flow's own internal state, so selecting a "connection" edge and
  // pressing Backspace/Delete does nothing to the store without this —
  // the edge just reappears next render. Only "connection" edges (solid,
  // user-drawn via onConnect, carrying `data` above) are removable this
  // way; "mapping" edges (dashed/animated) are derived from a field's
  // "Map from..." source and have no `data`, so they're left alone on
  // 'remove' — clearing that mapping in the Node Inspector is what
  // removes one. Both kinds still respond to 'select' (a click), feeding
  // selectedEdgeId back into flowEdges above so the click's highlight
  // actually sticks instead of disappearing on the next render.
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === 'select') {
          setSelectedEdgeId(change.selected ? change.id : null);
          if (change.selected) selectNode(null); // one selection at a time — an edge click shouldn't leave a node looking selected too
        } else if (change.type === 'remove') {
          const edge = flowEdges.find((e) => e.id === change.id);
          if (edge?.data) disconnectNodes(edge.data.fromNodeId, edge.data.toNodeId);
        }
      }
    },
    [flowEdges, disconnectNodes, selectNode]
  );

  // Two things can otherwise leave a card fully or partially clipped with
  // no visual cue it still exists: dropping a new node past the edge of a
  // canvas that's grown cluttered, or the canvas's own container shrinking
  // (e.g. the inspector panel expanding) around nodes that were fine a
  // moment ago. React Flow's `fitView` prop only runs once, on mount, so
  // neither case re-frames the viewport on its own — check node DOM rects
  // against the wrapper's on both triggers and zoom out to refit only when
  // something's actually out of view, so a deliberate manual zoom/pan
  // isn't fought while everything still fits.
  const refitIfNeeded = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || nodes.length === 0) return;
    const bounds = wrapper.getBoundingClientRect();
    const nodeEls = wrapper.querySelectorAll<HTMLElement>('.react-flow__node');
    const outOfView = [...nodeEls].some((el) => {
      const r = el.getBoundingClientRect();
      return r.left < bounds.left || r.top < bounds.top || r.right > bounds.right || r.bottom > bounds.bottom;
    });
    if (outOfView) fitView({ padding: 0.2, duration: 300 });
  }, [nodes.length, fitView]);

  useEffect(() => {
    if (prevNodeCountRef.current === nodes.length) return;
    prevNodeCountRef.current = nodes.length;
    // Wait a frame so React Flow has measured the new node's DOM rect
    // before we check it.
    const raf = requestAnimationFrame(refitIfNeeded);
    return () => cancelAnimationFrame(raf);
  }, [nodes.length, refitIfNeeded]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(refitIfNeeded);
    });
    observer.observe(wrapper);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [refitIfNeeded]);

  return (
    <div className="canvas" ref={wrapperRef} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, node) => {
          selectNode(node.id);
          setSelectedEdgeId(null);
        }}
        onPaneClick={() => {
          selectNode(null);
          setSelectedEdgeId(null);
        }}
        onConnect={onConnect}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onMove={(_, viewport) => setZoomVar(viewport)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background color="#3a3d42" gap={16} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
