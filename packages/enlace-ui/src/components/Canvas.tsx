import { useCallback, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useWorkflowStore } from '../store/workflowStore.js';
import { WorkflowNodeCard, type WorkflowNodeData } from './WorkflowNodeCard.js';

const nodeTypes = { workflowNode: WorkflowNodeCard };

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
    addNode,
    updateNodePosition,
    selectNode,
    connectNodes,
    removeNode,
  } = useWorkflowStore();
  const { screenToFlowPosition } = useReactFlow();

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
        },
      })),
    [nodes, nodePositions, operations, selectedNodeId]
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
      className: 'edge-connection',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#9aa0a6' },
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
    return edges;
  }, [nodes, connections]);

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

  return (
    <div className="canvas" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => selectNode(node.id)}
        onPaneClick={() => selectNode(null)}
        onConnect={onConnect}
        onNodesChange={onNodesChange}
        fitView
      >
        <Background color="#3a3d42" gap={16} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
