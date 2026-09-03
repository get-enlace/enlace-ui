import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Connection,
  type EdgeChange,
  type Node,
  type NodeChange,
  type Viewport,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { buildNodeLabels } from '@get-enlace/core';
import { useWorkflowStore } from '../../store/workflowStore.js';
import {
  expandedGroupFrame,
  findGroupDropTarget,
  findUngroupedOutsidersInFrame,
  groupContainingNode,
  nudgeOutsideFrame,
  type GroupDropTarget,
} from '../../utils/groupGeometry.js';
import { BreakpointConnectionEdge } from '../BreakpointConnectionEdge.js';
import { GroupConfirmModal } from '../GroupConfirmModal.js';
import { GroupNodeCard } from '../GroupNodeCard.js';
import { WorkflowNodeCard } from '../WorkflowNodeCard.js';
import { buildFlowEdges, buildFlowNodes, collapsedMemberIdSet } from './buildFlowGraph.js';
import { pendingFromDropTarget, suggestGroupName, type PendingGroup } from './pendingGroup.js';

const nodeTypes = { workflowNode: WorkflowNodeCard, nodeGroup: GroupNodeCard };
const edgeTypes = { connection: BreakpointConnectionEdge };

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

  const collapsedMemberIds = useMemo(() => collapsedMemberIdSet(groups), [groups]);

  const flowNodes = useMemo(
    () =>
      buildFlowNodes({
        groups,
        nodes,
        nodePositions,
        operations,
        selectedNodeId,
        stepStatusByNodeId,
        nodeLabels,
        collapsedMemberIds,
      }),
    [groups, nodes, nodePositions, operations, selectedNodeId, stepStatusByNodeId, nodeLabels, collapsedMemberIds]
  );

  const flowEdges = useMemo(
    () =>
      buildFlowEdges({
        nodes,
        connections,
        groups,
        collapsedMemberIds,
        armedBreakpoints,
        selectedEdgeId,
      }),
    [nodes, connections, groups, collapsedMemberIds, armedBreakpoints, selectedEdgeId]
  );

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
      }
      setPendingGroup(pendingFromDropTarget(draggedNodeId, position, target));
    },
    [groups, joinGroup, refitIfNeeded]
  );

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.id.startsWith('g-')) {
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
