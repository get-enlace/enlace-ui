import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Canvas } from './Canvas.js';
import { useWorkflowStore } from '../store/workflowStore.js';
import type { Operation } from '../types.js';

const petOperation: Operation = {
  id: 'POST /pet',
  method: 'post',
  path: '/pet',
  parameters: [],
  requestBodySchema: null,
  responseSchema: null,
};

// Canvas's own logic worth unit-testing is the onDrop handler (reads
// dataTransfer, calls addNode) and onConnect (calls connectNodes) — the
// rest is React Flow's own rendering/gesture machinery, already covered
// by the Playwright smoke test (test/e2e-ui/smoke.spec.ts) against the
// real, fully-rendered app rather than simulated here.
describe('Canvas', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      nodes: [],
      nodePositions: {},
      connections: [],
      operations: [petOperation],
      selectedNodeId: null,
    });
  });

  it('adds a node to the store when an operation is dropped onto the canvas', () => {
    const { container } = render(<Canvas />);
    const canvas = container.querySelector('.canvas')!;

    fireEvent.drop(canvas, {
      dataTransfer: { getData: (type: string) => (type === 'text/operation-id' ? 'POST /pet' : '') },
      clientX: 100,
      clientY: 100,
    });

    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
    expect(useWorkflowStore.getState().nodes[0].operationId).toBe('POST /pet');
  });

  it('does nothing when the drop carries no operation id (e.g. a stray file drop)', () => {
    const { container } = render(<Canvas />);
    const canvas = container.querySelector('.canvas')!;

    fireEvent.drop(canvas, { dataTransfer: { getData: () => '' } });

    expect(useWorkflowStore.getState().nodes).toHaveLength(0);
  });
});
