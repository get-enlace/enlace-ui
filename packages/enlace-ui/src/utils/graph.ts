import type { WorkflowConnection, WorkflowNode } from '../types.js';

/**
 * All nodes that come before `nodeId` in the workflow graph — i.e. valid
 * "map from" sources for it. "Before" is defined by the union of explicit
 * connections (order) and mapped-field edges (a mapping always implies its
 * source runs first, connection or not) — mirrors the engine's
 * topologicalSort dependency graph in src/engine/chainExecutor.ts.
 *
 * This is deliberately graph ancestry, not array position: in A -> B -> C
 * where B carries no data, C's ancestors are {A, B} even though A isn't
 * connected to C directly.
 */
export function computeAncestors(
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
  nodeId: string
): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // predecessors[x] = nodes that must run before x
  const predecessors = new Map<string, Set<string>>();
  for (const n of nodes) predecessors.set(n.id, new Set());

  for (const { fromNodeId, toNodeId } of connections) {
    if (byId.has(fromNodeId) && predecessors.has(toNodeId)) {
      predecessors.get(toNodeId)!.add(fromNodeId);
    }
  }

  for (const n of nodes) {
    for (const fieldValue of Object.values(n.fieldValues)) {
      if (fieldValue.source === 'mapped' && byId.has(fieldValue.fromNodeId)) {
        predecessors.get(n.id)!.add(fieldValue.fromNodeId);
      }
    }
  }

  const ancestors = new Set<string>();
  const queue = [...(predecessors.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (ancestors.has(current)) continue;
    ancestors.add(current);
    queue.push(...(predecessors.get(current) ?? []));
  }

  return ancestors;
}
