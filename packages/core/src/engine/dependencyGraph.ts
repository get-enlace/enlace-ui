import type { WorkflowConnection, WorkflowNode } from '../types.js';

/**
 * The dependency graph every execution-order computation in this package
 * shares: for each node, the set of node ids that must complete before it
 * can run — the union of explicit `WorkflowConnection`s (order only, e.g. a
 * node with no mapped fields that still needs to run in a particular slot)
 * and mapped `FieldValue`s (a mapping always implies its source must run
 * first, whether or not the user also drew an explicit connection).
 *
 * Consumed by chainExecutor.ts's level-grouping and per-node readiness
 * scheduling, and by `computeAncestors` below for the Node Inspector's "Map
 * from…" picker — previously two independent copies of this exact union
 * logic (one in chainExecutor.ts, one inlined in utils/graph.ts); this is
 * the single shared implementation.
 */
export function buildDependencyGraph(
  nodes: WorkflowNode[],
  connections: WorkflowConnection[]
): Map<string, Set<string>> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const dependsOn = new Map<string, Set<string>>();
  for (const node of nodes) dependsOn.set(node.id, new Set());

  // Explicit connections (order only, no data — e.g. a node with no mapped
  // fields that still needs to run in a particular slot).
  for (const { fromNodeId, toNodeId } of connections) {
    if (byId.has(fromNodeId) && dependsOn.has(toNodeId)) {
      dependsOn.get(toNodeId)!.add(fromNodeId);
    }
  }

  // Mapped fieldValues (a mapping always implies its source must run first,
  // whether or not the user also drew an explicit connection).
  for (const node of nodes) {
    for (const fieldValue of Object.values(node.fieldValues)) {
      if (fieldValue.source === 'mapped' && byId.has(fieldValue.fromNodeId)) {
        dependsOn.get(node.id)!.add(fieldValue.fromNodeId);
      }
    }
  }

  // Mapped credentialExtraParamOverrides — same "mapping implies its source
  // must run first" rule as fieldValues above, see WorkflowNode's own
  // comment on why this lives per-node rather than on the shared Credential.
  // Skipped entirely while the override is toggled off: an inert map
  // shouldn't force an ordering edge that only matters once it's live.
  for (const node of nodes) {
    if (!node.credentialExtraParamOverridesEnabled) continue;
    for (const fieldValue of Object.values(node.credentialExtraParamOverrides ?? {})) {
      if (fieldValue.source === 'mapped' && byId.has(fieldValue.fromNodeId)) {
        dependsOn.get(node.id)!.add(fieldValue.fromNodeId);
      }
    }
  }

  return dependsOn;
}

/**
 * All nodes that come before `nodeId` in the workflow graph — i.e. valid
 * "map from" sources for it. Deliberately graph ancestry, not array
 * position: in A -> B -> C where B carries no data, C's ancestors are
 * {A, B} even though A isn't connected to C directly.
 */
export function computeAncestors(
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
  nodeId: string
): Set<string> {
  const dependsOn = buildDependencyGraph(nodes, connections);

  const ancestors = new Set<string>();
  const queue = [...(dependsOn.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (ancestors.has(current)) continue;
    ancestors.add(current);
    queue.push(...(dependsOn.get(current) ?? []));
  }

  return ancestors;
}
