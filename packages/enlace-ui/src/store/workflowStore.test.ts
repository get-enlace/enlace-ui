import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkflowStore } from './workflowStore.js';

// Reset to a clean slate before each test — zustand stores are module-level
// singletons, so state otherwise leaks across tests.
beforeEach(() => {
  useWorkflowStore.setState({
    nodes: [],
    connections: [],
    nodePositions: {},
    selectedNodeId: null,
  });
});

describe('removeNode', () => {
  it('removes the node itself, its position, and any connections referencing it (either direction)', () => {
    const { addNode, connectNodes, removeNode } = useWorkflowStore.getState();
    const a = addNode('GET /a', { x: 0, y: 0 });
    const b = addNode('GET /b', { x: 100, y: 0 });
    connectNodes(a, b);

    removeNode(a);

    const state = useWorkflowStore.getState();
    expect(state.nodes.map((n) => n.id)).toEqual([b]);
    expect(state.nodePositions[a]).toBeUndefined();
    expect(state.connections).toEqual([]);
  });

  it("resets another node's field mapped from the deleted node to an empty static value, instead of a dangling reference", () => {
    const { addNode, setFieldValue, removeNode } = useWorkflowStore.getState();
    const a = addNode('GET /a');
    const b = addNode('GET /b');
    setFieldValue(b, 'path.id', { source: 'mapped', fromNodeId: a, fromResponseFieldPath: 'id' });

    removeNode(a);

    const nodeB = useWorkflowStore.getState().nodes.find((n) => n.id === b)!;
    expect(nodeB.fieldValues['path.id']).toEqual({ source: 'static', value: '' });
  });

  it('clears selectedNodeId if the removed node was selected', () => {
    const { addNode, selectNode, removeNode } = useWorkflowStore.getState();
    const a = addNode('GET /a');
    selectNode(a);

    removeNode(a);

    expect(useWorkflowStore.getState().selectedNodeId).toBeNull();
  });

  it('leaves an unrelated selected node alone', () => {
    const { addNode, selectNode, removeNode } = useWorkflowStore.getState();
    const a = addNode('GET /a');
    const b = addNode('GET /b');
    selectNode(b);

    removeNode(a);

    expect(useWorkflowStore.getState().selectedNodeId).toBe(b);
  });
});
