import type { OperationNode, PresetsNode, WorkflowNode } from '../../types.js';

/** Narrows a `WorkflowNode` to `OperationNode`, throwing if it's actually a `'presets'` collection. **/
export function asOperationNode(node: WorkflowNode): OperationNode {
  if (node.kind === 'presets') throw new Error('expected an operation node, got a presets collection');
  return node;
}

/** Narrows a `WorkflowNode` to `PresetsNode`, throwing if it's actually an `'operation'` node. **/
export function asPresetsNode(node: WorkflowNode): PresetsNode {
  if (node.kind !== 'presets') throw new Error('expected a presets collection, got an operation node');
  return node;
}
