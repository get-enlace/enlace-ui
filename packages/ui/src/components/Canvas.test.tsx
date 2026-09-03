import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Canvas } from './Canvas/index.js';
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
      groups: [],
      connections: [],
      operations: [petOperation],
      selectedNodeId: null,
      stepStatusByNodeId: {},
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

  it('marks the store-selected node as selected on the React Flow node so Delete/Backspace can remove it', () => {
    useWorkflowStore.setState({
      nodes: [{ id: 'n1', operationId: 'POST /pet', credentialId: null, fieldValues: {} }],
      nodePositions: { n1: { x: 0, y: 0 } },
      selectedNodeId: 'n1',
      operations: [petOperation],
    });
    const { container } = render(<Canvas />);
    // RF applies `.selected` from the top-level Node.selected flag — the same
    // flag Delete/Backspace reads. Card CSS separately uses data.selected.
    expect(container.querySelector('.react-flow__node')).toHaveClass('selected');
    expect(container.querySelector('.workflow-node')).toHaveClass('workflow-node--selected');
  });

  it("highlights a node's card while its step status is in-flight", () => {
    useWorkflowStore.setState({
      nodes: [{ id: 'n1', operationId: 'POST /pet', credentialId: null, fieldValues: {} }],
      nodePositions: { n1: { x: 0, y: 0 } },
      connections: [],
      operations: [petOperation],
      selectedNodeId: null,
      stepStatusByNodeId: { n1: 'in-flight' },
    });

    const { container } = render(<Canvas />);

    expect(container.querySelector('.workflow-node')).toHaveClass('workflow-node--in-flight');
  });

  describe('locked canvas (Controls panel lock/unlock button)', () => {
    // Reproduces a reported bug: locking the canvas already correctly
    // blocked dragging (that's React Flow's own internal machinery, no
    // code of ours involved), but nodes stayed clickable-to-select, and a
    // selected node is still delete-eligible (see the Delete/Backspace
    // test above) — so a locked canvas wasn't actually protecting nodes
    // from deletion via a stray keystroke, only from being dragged.

    it('does not select a node on click while locked', () => {
      useWorkflowStore.setState({
        nodes: [{ id: 'n1', operationId: 'POST /pet', credentialId: null, fieldValues: {} }],
        nodePositions: { n1: { x: 0, y: 0 } },
        selectedNodeId: null,
        operations: [petOperation],
      });
      const { container } = render(<Canvas />);

      // The same lock button a user clicks — React Flow's Controls panel.
      fireEvent.click(container.querySelector('.react-flow__controls-interactive')!);
      fireEvent.click(container.querySelector('.react-flow__node')!);

      expect(useWorkflowStore.getState().selectedNodeId).toBeNull();
    });

    it('still selects a node on click while unlocked (the default)', () => {
      useWorkflowStore.setState({
        nodes: [{ id: 'n1', operationId: 'POST /pet', credentialId: null, fieldValues: {} }],
        nodePositions: { n1: { x: 0, y: 0 } },
        selectedNodeId: null,
        operations: [petOperation],
      });
      const { container } = render(<Canvas />);

      fireEvent.click(container.querySelector('.react-flow__node')!);

      expect(useWorkflowStore.getState().selectedNodeId).toBe('n1');
    });

    it('deselects a node that was already selected the moment the canvas is locked', () => {
      useWorkflowStore.setState({
        nodes: [{ id: 'n1', operationId: 'POST /pet', credentialId: null, fieldValues: {} }],
        nodePositions: { n1: { x: 0, y: 0 } },
        selectedNodeId: 'n1',
        operations: [petOperation],
      });
      const { container } = render(<Canvas />);
      expect(useWorkflowStore.getState().selectedNodeId).toBe('n1');

      fireEvent.click(container.querySelector('.react-flow__controls-interactive')!);

      expect(useWorkflowStore.getState().selectedNodeId).toBeNull();
    });
  });

  it("doesn't apply the in-flight pulse to a node that's already settled", () => {
    useWorkflowStore.setState({
      nodes: [{ id: 'n1', operationId: 'POST /pet', credentialId: null, fieldValues: {} }],
      nodePositions: { n1: { x: 0, y: 0 } },
      connections: [],
      operations: [petOperation],
      selectedNodeId: null,
      stepStatusByNodeId: { n1: 'completed' },
    });

    const { container } = render(<Canvas />);

    expect(container.querySelector('.workflow-node')).not.toHaveClass('workflow-node--in-flight');
    expect(container.querySelector('.workflow-node')).toHaveClass('workflow-node--completed');
  });
});
