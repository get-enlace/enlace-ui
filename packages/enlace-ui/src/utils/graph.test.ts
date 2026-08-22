import { describe, expect, it } from 'vitest';
import { computeAncestors } from './graph.js';
import type { WorkflowConnection, WorkflowNode } from '../types.js';

function node(id: string, fieldValues: WorkflowNode['fieldValues'] = {}): WorkflowNode {
  return { id, operationId: id, credentialId: null, fieldValues };
}

describe('computeAncestors', () => {
  it('includes a transitive ancestor reached only through a connection, even when the middle node carries no data', () => {
    // A -> B -> C via explicit connections; B has no field mapping at all.
    const a = node('a');
    const b = node('b');
    const c = node('c');
    const connections: WorkflowConnection[] = [
      { fromNodeId: 'a', toNodeId: 'b' },
      { fromNodeId: 'b', toNodeId: 'c' },
    ];

    expect(computeAncestors([a, b, c], connections, 'c')).toEqual(new Set(['a', 'b']));
  });

  it('treats a mapped field as an implied connection even with no explicit edge drawn', () => {
    const a = node('a');
    const b = node('b', { x: { source: 'mapped', fromNodeId: 'a', fromResponseFieldPath: 'id' } });

    expect(computeAncestors([a, b], [], 'b')).toEqual(new Set(['a']));
  });

  it('returns an empty set for a node with no connections or mappings pointing to it', () => {
    const a = node('a');
    const b = node('b');

    expect(computeAncestors([a, b], [], 'b')).toEqual(new Set());
  });
});
