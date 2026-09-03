import { MarkerType, type Edge, type Node } from 'reactflow';
import { connectionKey } from '@get-enlace/core';
import type { NodeGroup, Operation, RunStepStatus, WorkflowConnection, WorkflowNode } from '../../types.js';
import {
  expandedGroupFrame,
  groupContainingNode,
  sortGroupMemberIds,
} from '../../utils/groupGeometry.js';
import { collapsedGroupSize } from '../../utils/nodePlacement.js';
import type { GroupMemberSummary, GroupNodeData } from './GroupNodeCard.js';
import type { WorkflowNodeData } from './WorkflowNodeCard.js';

export function collapsedMemberIdSet(groups: NodeGroup[]): Set<string> {
  const ids = new Set<string>();
  for (const g of groups) {
    if (g.collapsed) for (const id of g.nodeIds) ids.add(id);
  }
  return ids;
}

export function buildFlowNodes(args: {
  groups: NodeGroup[];
  nodes: WorkflowNode[];
  nodePositions: Record<string, { x: number; y: number }>;
  operations: Operation[];
  selectedNodeId: string | null;
  stepStatusByNodeId: Record<string, RunStepStatus>;
  nodeLabels: Map<string, string>;
  collapsedMemberIds: Set<string>;
}): Node[] {
  const {
    groups,
    nodes,
    nodePositions,
    operations,
    selectedNodeId,
    stepStatusByNodeId,
    nodeLabels,
    collapsedMemberIds,
  } = args;
  const result: Node[] = [];

  for (const g of groups) {
    if (g.collapsed) {
      const size = collapsedGroupSize(g.nodeIds.length);
      const members: GroupMemberSummary[] = sortGroupMemberIds(g.nodeIds, nodePositions).map((nodeId) => {
        const node = nodes.find((n) => n.id === nodeId);
        if (node?.kind === 'wait') {
          return {
            nodeId,
            method: 'wait',
            path: nodeLabels.get(nodeId) ?? 'Wait',
            label: nodeLabels.get(nodeId) ?? nodeId,
            status: stepStatusByNodeId[nodeId],
          };
        }
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
}

export function buildFlowEdges(args: {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  groups: NodeGroup[];
  collapsedMemberIds: Set<string>;
  armedBreakpoints: Set<string>;
  selectedEdgeId: string | null;
}): Edge[] {
  const { nodes, connections, groups, collapsedMemberIds, armedBreakpoints, selectedEdgeId } = args;
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
}
