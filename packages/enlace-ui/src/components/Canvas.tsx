import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
  useStore,
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
import {
  expandedGroupFrame,
  findGroupDropTarget,
  findUngroupedOutsidersInFrame,
  groupContainingNode,
  nudgeOutsideFrame,
  sortGroupMemberIds,
  type GroupDropTarget,
} from '../utils/groupGeometry.js';
import { collapsedGroupSize } from '../utils/nodePlacement.js';
import { BreakpointConnectionEdge } from './BreakpointConnectionEdge.js';
import { GroupConfirmModal } from './GroupConfirmModal.js';
import { GroupNodeCard, type GroupMemberSummary, type GroupNodeData } from './GroupNodeCard.js';
import { WorkflowNodeCard, type WorkflowNodeData } from './WorkflowNodeCard.js';

const nodeTypes = { workflowNode: WorkflowNodeCard, nodeGroup: GroupNodeCard };
const edgeTypes = { connection: BreakpointConnectionEdge };

type PendingGroup =
  | { kind: 'create'; draggedNodeId: string; position: { x: number; y: number }; withNodeId: string }
  | { kind: 'join'; draggedNodeId: string; position: { x: number; y: number }; groupId: string };

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
    groups,
    connections,
    operations,
    selectedNodeId,
    stepStatusByNodeId,
    armedBreakpoints,
    isRunning,
    addNode,
    updateNodePosition,
    selectNode,
    connectNodes,
    disconnectNodes,
    removeNode,
    toggleBreakpoint,
    createGroup,
    joinGroup,
    moveGroup,
  } = useWorkflowStore();
  const { screenToFlowPosition, fitView, getViewport } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const prevNodeCountRef = useRef(nodes.length);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [pendingGroup, setPendingGroup] = useState<PendingGroup | null>(null);

  const elementsSelectable = useStore((s) => s.elementsSelectable);

  useEffect(() => {
    if (!elementsSelectable) {
      selectNode(null);
      setSelectedEdgeId(null);
    }
  }, [elementsSelectable, selectNode]);

  const setZoomVar = useCallback((viewport: Viewport) => {
    wrapperRef.current?.style.setProperty('--rf-zoom', String(viewport.zoom));
  }, []);

  useEffect(() => {
    setZoomVar(getViewport());
  }, [getViewport, setZoomVar]);

  const nodeLabels = useMemo(() => {
    const operationsById = new Map(operations.map((o) => [o.id, o]));
    return buildNodeLabels(nodes, operationsById);
  }, [nodes, operations]);

  const collapsedMemberIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of groups) {
      if (g.collapsed) for (const id of g.nodeIds) ids.add(id);
    }
    return ids;
  }, [groups]);

  const flowNodes: Node[] = useMemo(() => {
    const result: Node[] = [];

    for (const g of groups) {
      if (g.collapsed) {
        const size = collapsedGroupSize(g.nodeIds.length);
        const members: GroupMemberSummary[] = sortGroupMemberIds(g.nodeIds, nodePositions).map((nodeId) => {
          const node = nodes.find((n) => n.id === nodeId);
          const operation = node ? operations.find((o) => o.id === node.operationId) : undefined;
          return {
            nodeId,
            method: operation?.method ?? 'get',
            path: operation?.path ?? '?',
            label: nodeLabels.get(nodeId) ?? nodeId,
            status: stepStatusByNodeId[nodeId],
          };
        });
        result.push({
          id: g.id,
          type: 'nodeGroup',
          position: g.position,
          zIndex: 5,
          data: {
            group: g,
            width: size.width,
            height: size.height,
            memberCount: g.nodeIds.length,
            members,
          } satisfies GroupNodeData,
        });
      } else {
        const frame = expandedGroupFrame(g.nodeIds, nodePositions);
        if (!frame) continue;
        result.push({
          id: g.id,
          type: 'nodeGroup',
          position: frame.position,
          zIndex: 0,
          // Expanded chrome tracks member bounds via data; drag moves the group.
          data: {
            group: { ...g, position: frame.position },
            width: frame.width,
            height: frame.height,
            memberCount: g.nodeIds.length,
          } satisfies GroupNodeData,
        });
      }
    }

    for (const n of nodes) {
      const hidden = collapsedMemberIds.has(n.id);
      const owningGroup = groupContainingNode(groups, n.id);
      result.push({
        id: n.id,
        type: 'workflowNode',
        position: nodePositions[n.id] ?? { x: 80, y: 80 },
        selected: n.id === selectedNodeId,
        hidden,
        zIndex: 2,
        data: {
          node: n,
          operation: operations.find((o) => o.id === n.operationId),
          selected: n.id === selectedNodeId,
          status: stepStatusByNodeId[n.id],
          label: nodeLabels.get(n.id),
          groupId: owningGroup?.id,
          groupName: owningGroup?.name,
        } satisfies WorkflowNodeData,
      });
    }

    return result;
  }, [
    groups,
    nodes,
    nodePositions,
    operations,
    selectedNodeId,
    stepStatusByNodeId,
    nodeLabels,
    collapsedMemberIds,
  ]);

  const flowEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = [];
    const resolveEndpoint = (nodeId: string): string => {
      if (!collapsedMemberIds.has(nodeId)) return nodeId;
      const g = groupContainingNode(groups, nodeId);
      return g?.id ?? nodeId;
    };

    for (const node of nodes) {
      for (const fieldValue of Object.values(node.fieldValues)) {
        if (fieldValue.source !== 'mapped') continue;
        const source = resolveEndpoint(fieldValue.fromNodeId);
        const target = resolveEndpoint(node.id);
        // Hide edges wholly inside a collapsed group.
        if (source === target && groups.some((g) => g.id === source && g.collapsed)) continue;
        edges.push({
          id: `map-${fieldValue.fromNodeId}->${node.id}-${edges.length}`,
          source,
          target,
          className: 'edge-mapping',
          animated: true,
        });
      }
    }

    for (const c of connections) {
      const source = resolveEndpoint(c.fromNodeId);
      const target = resolveEndpoint(c.toNodeId);
      if (source === target && groups.some((g) => g.id === source && g.collapsed)) continue;
      edges.push({
        id: `conn-${c.fromNodeId}->${c.toNodeId}`,
        source,
        target,
        type: 'connection',
        className: 'edge-connection',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#9aa0a6' },
        data: {
          fromNodeId: c.fromNodeId,
          toNodeId: c.toNodeId,
          armed: armedBreakpoints.has(connectionKey(c.fromNodeId, c.toNodeId)),
        },
      });
    }

    return edges.map((e) => ({ ...e, selected: e.id === selectedEdgeId }));
  }, [nodes, connections, selectedEdgeId, armedBreakpoints, collapsedMemberIds, groups]);

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
      if (params.source && params.target) {
        // Don't treat group chrome as a connectable workflow endpoint.
        if (params.source.startsWith('g-') || params.target.startsWith('g-')) return;
        connectNodes(params.source, params.target);
      }
    },
    [connectNodes]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          if (change.id.startsWith('g-')) {
            moveGroup(change.id, change.position);
          } else {
            // Members move independently inside a group; group chrome drag
            // (moveGroup) is what translates the whole cluster. AvoidOverlap
            // on drag-end skips groupmates so tight packing isn't blown apart.
            updateNodePosition(change.id, change.position);
          }
        } else if (change.type === 'remove') {
          if (!change.id.startsWith('g-')) removeNode(change.id);
        }
      }
    },
    [updateNodePosition, removeNode, moveGroup]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === 'select') {
          setSelectedEdgeId(change.selected ? change.id : null);
          if (change.selected) selectNode(null);
        } else if (change.type === 'remove') {
          const edge = flowEdges.find((e) => e.id === change.id);
          if (edge?.data) disconnectNodes(edge.data.fromNodeId, edge.data.toNodeId);
        }
      }
    },
    [flowEdges, disconnectNodes, selectNode]
  );

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

  const applyDropTarget = useCallback(
    (draggedNodeId: string, position: { x: number; y: number }, target: GroupDropTarget) => {
      if (target.kind === 'join') {
        const group = groups.find((g) => g.id === target.groupId);
        if (group?.skipConfirmOnDrop) {
          joinGroup(target.groupId, draggedNodeId, position);
          requestAnimationFrame(() => refitIfNeeded());
          return;
        }
        setPendingGroup({
          kind: 'join',
          draggedNodeId,
          position,
          groupId: target.groupId,
        });
        return;
      }
      setPendingGroup({
        kind: 'create',
        draggedNodeId,
        position,
        withNodeId: target.withNodeId,
      });
    },
    [groups, joinGroup, refitIfNeeded]
  );

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.id.startsWith('g-')) {
        // moveGroup already applied during drag via onNodesChange — never
        // run per-member avoidOverlap (that would blow apart a tight group).
        requestAnimationFrame(() => refitIfNeeded());
        return;
      }
      if (isRunning) {
        updateNodePosition(node.id, node.position, { avoidOverlap: true });
        requestAnimationFrame(() => refitIfNeeded());
        return;
      }

      const target = findGroupDropTarget(
        node.id,
        node.position,
        groups,
        nodes.map((n) => n.id),
        { ...nodePositions, [node.id]: node.position }
      );

      if (target) {
        applyDropTarget(node.id, node.position, target);
        return;
      }

      // Member drag can grow the expanded frame around an ungrouped card
      // without that card ever being dropped — offer join so UI matches membership.
      const ownGroup = groupContainingNode(groups, node.id);
      if (ownGroup && !ownGroup.collapsed) {
        const positionsNow = { ...nodePositions, [node.id]: node.position };
        const swallowed = findUngroupedOutsidersInFrame(
          ownGroup,
          nodes.map((n) => n.id),
          positionsNow,
          groups
        );
        if (swallowed[0]) {
          const outsiderId = swallowed[0].nodeId;
          const outsiderPos = positionsNow[outsiderId] ?? nodePositions[outsiderId];
          if (outsiderPos) {
            applyDropTarget(outsiderId, outsiderPos, {
              kind: 'join',
              groupId: ownGroup.id,
              ratio: swallowed[0].ratio,
            });
            return;
          }
        }
        requestAnimationFrame(() => refitIfNeeded());
        return;
      }

      updateNodePosition(node.id, node.position, { avoidOverlap: true });
      requestAnimationFrame(() => refitIfNeeded());
    },
    [isRunning, groups, nodes, nodePositions, updateNodePosition, refitIfNeeded, applyDropTarget]
  );

  const cancelPendingGroup = useCallback(() => {
    if (!pendingGroup) return;
    let position = pendingGroup.position;
    // Join cancel after a frame-swallow: push the outsider clear of the frame
    // so it doesn't keep looking like a member.
    if (pendingGroup.kind === 'join') {
      const group = groups.find((g) => g.id === pendingGroup.groupId);
      if (group && !group.collapsed) {
        const frame = expandedGroupFrame(group.nodeIds, nodePositions);
        if (frame) position = nudgeOutsideFrame(position, frame);
      }
    }
    updateNodePosition(pendingGroup.draggedNodeId, position, { avoidOverlap: true });
    setPendingGroup(null);
    requestAnimationFrame(() => refitIfNeeded());
  }, [pendingGroup, groups, nodePositions, updateNodePosition, refitIfNeeded]);

  const confirmPendingGroup = useCallback(
    (result: { name: string; skipConfirmOnDrop: boolean }) => {
      if (!pendingGroup) return;
      if (pendingGroup.kind === 'create') {
        createGroup({
          name: result.name,
          nodeIds: [pendingGroup.draggedNodeId, pendingGroup.withNodeId],
          draggedNodeId: pendingGroup.draggedNodeId,
          draggedPosition: pendingGroup.position,
          skipConfirmOnDrop: result.skipConfirmOnDrop,
        });
      } else {
        joinGroup(pendingGroup.groupId, pendingGroup.draggedNodeId, pendingGroup.position, {
          skipConfirmOnDrop: result.skipConfirmOnDrop,
        });
      }
      setPendingGroup(null);
      requestAnimationFrame(() => refitIfNeeded());
    },
    [pendingGroup, createGroup, joinGroup, refitIfNeeded]
  );

  useEffect(() => {
    if (prevNodeCountRef.current === nodes.length) return;
    prevNodeCountRef.current = nodes.length;
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

  const pendingJoinGroup = pendingGroup?.kind === 'join' ? groups.find((g) => g.id === pendingGroup.groupId) : null;
  const pendingCreateLabel =
    pendingGroup?.kind === 'create' ? (nodeLabels.get(pendingGroup.withNodeId) ?? pendingGroup.withNodeId) : '';

  return (
    <div className="canvas" ref={wrapperRef} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, node) => {
          if (!elementsSelectable) return;
          if (node.id.startsWith('g-')) {
            selectNode(null);
            setSelectedEdgeId(null);
            return;
          }
          selectNode(node.id);
          setSelectedEdgeId(null);
        }}
        onPaneClick={() => {
          selectNode(null);
          setSelectedEdgeId(null);
        }}
        onConnect={onConnect}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onEdgesChange={onEdgesChange}
        onEdgeDoubleClick={(_, edge) => {
          const data = edge.data as { fromNodeId?: string; toNodeId?: string } | undefined;
          if (data?.fromNodeId && data.toNodeId) {
            toggleBreakpoint(data.fromNodeId, data.toNodeId);
          }
        }}
        onMove={(_, viewport) => setZoomVar(viewport)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#3a3d42" gap={16} />
        <Controls />
      </ReactFlow>

      {pendingGroup && (
        <GroupConfirmModal
          mode={
            pendingGroup.kind === 'create'
              ? { kind: 'create', withNodeLabel: pendingCreateLabel }
              : { kind: 'join', groupName: pendingJoinGroup?.name ?? 'Group' }
          }
          defaultName={
            pendingGroup.kind === 'create'
              ? suggestGroupName(pendingCreateLabel)
              : (pendingJoinGroup?.name ?? 'Group')
          }
          onConfirm={confirmPendingGroup}
          onCancel={cancelPendingGroup}
        />
      )}
    </div>
  );
}

function suggestGroupName(peerLabel: string): string {
  const cleaned = peerLabel.replace(/\s*#\d+$/, '').trim();
  if (!cleaned) return 'Group';
  // e.g. createOrder → Orders-ish; otherwise use the label as-is.
  return cleaned;
}
