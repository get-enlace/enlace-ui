import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider, Position, type NodeProps } from 'reactflow';
import { WorkflowNodeCard, type WorkflowNodeData } from './WorkflowNodeCard.js';
import { useWorkflowStore } from '../store/workflowStore.js';
import type { Operation, WorkflowNode } from '../types.js';

function makeNode(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return { id: 'node-1', operationId: 'POST /pet', credentialId: null, fieldValues: {}, ...overrides };
}

function makeOperation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: 'POST /pet',
    method: 'post',
    path: '/pet',
    parameters: [],
    requestBodySchema: null,
    responseSchema: null,
    ...overrides,
  };
}

// WorkflowNodeCard is a React Flow custom node component — it's normally
// instantiated by <ReactFlow nodeTypes={...}>, which supplies the full
// NodeProps shape and a store context via ReactFlowProvider (Handle
// throws without one). Rendering it directly still needs both: a
// ReactFlowProvider wrapper, and a fake-but-complete NodeProps object.
function renderCard(data: WorkflowNodeData) {
  const props: NodeProps<WorkflowNodeData> = {
    id: data.node.id,
    data,
    dragHandle: undefined,
    type: 'workflowNode',
    selected: data.selected,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    zIndex: 0,
    dragging: false,
    targetPosition: Position.Left,
    sourcePosition: Position.Right,
  };
  return render(
    <ReactFlowProvider>
      <WorkflowNodeCard {...props} />
    </ReactFlowProvider>
  );
}

describe('WorkflowNodeCard', () => {
  beforeEach(() => {
    useWorkflowStore.setState({ nodes: [], nodePositions: {}, connections: [], selectedNodeId: null });
  });

  it('renders the method, path, and summary', () => {
    renderCard({
      node: makeNode(),
      operation: makeOperation({ method: 'post', path: '/pet', summary: 'Add a new pet to the store.' }),
      selected: false,
    });

    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('/pet')).toBeInTheDocument();
    expect(screen.getByText('Add a new pet to the store.')).toBeInTheDocument();
  });

  it('shows the operationId as a legend when present, omits it otherwise', () => {
    const { rerender } = renderCard({
      node: makeNode(),
      operation: makeOperation({ operationId: 'addPet' }),
      selected: false,
      label: 'addPet',
    });
    expect(screen.getByText('addPet')).toBeInTheDocument();

    rerender(
      <ReactFlowProvider>
        <WorkflowNodeCard
          id="node-1"
          data={{ node: makeNode(), operation: makeOperation({ operationId: undefined }), selected: false }}
          dragHandle={undefined}
          type="workflowNode"
          selected={false}
          isConnectable
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
        />
      </ReactFlowProvider>
    );
    expect(document.querySelector('legend')).not.toBeInTheDocument();
  });

  it('shows a "#N" legend even without a declared operationId, when this operation is used more than once', () => {
    // The one case a legend earns its place despite repeating the method+path already shown below
    // it: disambiguating this card from another node using the same operation — see Canvas.tsx's
    // buildNodeLabels call, which is what actually produces the "#N" suffix in practice.
    renderCard({
      node: makeNode(),
      operation: makeOperation({ operationId: undefined }),
      selected: false,
      label: 'POST /pet #2',
    });
    expect(screen.getByText('POST /pet #2')).toBeInTheDocument();
  });

  it('falls back to "Unknown operation" when the operation can\'t be found (e.g. spec changed since the node was added)', () => {
    renderCard({ node: makeNode(), operation: undefined, selected: false });
    expect(screen.getByText('Unknown operation')).toBeInTheDocument();
    // No operation means no known method either — defaults to GET's styling rather than crashing.
    expect(screen.getByText('GET')).toBeInTheDocument();
  });

  it('applies the --selected modifier class when selected', () => {
    renderCard({ node: makeNode(), operation: makeOperation(), selected: true });
    expect(document.querySelector('.workflow-node')).toHaveClass('workflow-node--selected');
  });

  it('removes the node from the store when the × button is clicked', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({ nodes: [makeNode({ id: 'node-1' })], nodePositions: { 'node-1': { x: 0, y: 0 } } });

    renderCard({ node: makeNode({ id: 'node-1' }), operation: makeOperation(), selected: false });
    await user.click(screen.getByRole('button', { name: 'Remove this node' }));

    expect(useWorkflowStore.getState().nodes).toEqual([]);
  });
});
