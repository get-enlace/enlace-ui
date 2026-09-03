import type { Operation, WorkflowNode } from './types.js';

function operationName(node: WorkflowNode, operationsById: Map<string, Operation>): string {
  const operation = operationsById.get(node.operationId);
  return operation?.operationId ?? operation?.id ?? node.operationId;
}

/**
 * Human-friendly labels for a set of nodes — used anywhere a node needs to be named for a
 * person: raw-JSON tag chips, the "Map from..." picker, the response-mapping modal's request
 * picker. Prefers the spec's own `operationId` (e.g. "createCustomer") over the synthetic
 * "METHOD /path" id `specParser.ts` falls back to when the spec declares none.
 *
 * A node's internal id means nothing to a user, so it's never shown. Instead, when the same
 * operation is used by more than one node in `nodes` (the same API called twice in this
 * workflow), those nodes get a stable "#N" suffix — ordered by where they appear in `nodes`,
 * which callers already pass in canvas/creation order.
 */
export function buildNodeLabels(nodes: WorkflowNode[], operationsById: Map<string, Operation>): Map<string, string> {
  const names = nodes.map((n) => operationName(n, operationsById));
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);

  const ordinals = new Map<string, number>();
  const labels = new Map<string, string>();
  nodes.forEach((node, i) => {
    const name = names[i];
    if ((counts.get(name) ?? 0) < 2) {
      labels.set(node.id, name);
      return;
    }
    const ordinal = (ordinals.get(name) ?? 0) + 1;
    ordinals.set(name, ordinal);
    labels.set(node.id, `${name} #${ordinal}`);
  });
  return labels;
}
