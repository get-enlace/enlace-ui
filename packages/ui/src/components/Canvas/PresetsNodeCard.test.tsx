import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider, Position, type NodeProps } from 'reactflow';
import { PresetsNodeCard, type PresetsNodeData } from './PresetsNodeCard.js';
import { useWorkflowStore } from '../../store/workflowStore.js';
import type { WorkflowNode } from '../../types.js';

function makePresetsNode(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return { id: 'g1', kind: 'presets', credentialId: null, fieldValues: {}, presets: [], ...overrides };
}

function renderCard(data: PresetsNodeData) {
  const props: NodeProps<PresetsNodeData> = {
    id: data.node.id,
    data,
    dragHandle: undefined,
    type: 'presetsNode',
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
      <PresetsNodeCard {...props} />
    </ReactFlowProvider>
  );
}

describe('PresetsNodeCard', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      nodes: [],
      nodePositions: {},
      connections: [],
      selectedNodeId: null,
      isRunning: false,
      presetsCollapsed: {},
    });
  });

  it('renders collapsed chrome with a preset count and a plain "Presets" label, not a per-preset summary', () => {
    const presetsNode = makePresetsNode({
      presets: [
        { id: 's1', kind: 'wait', durationMs: 2000 },
        { id: 's2', kind: 'wait', durationMs: 500 },
      ],
    });
    useWorkflowStore.setState({ nodes: [presetsNode] });
    renderCard({ node: presetsNode, collapsed: true, selected: false });

    expect(screen.getByText('2')).toBeInTheDocument(); // preset count
    const summary = screen.getByText('Presets');
    expect(summary).toBeInTheDocument();
    expect(summary).toHaveAttribute('title', 'Wait 2s · Wait 500ms'); // full detail on hover only
    expect(screen.queryByText('Wait 2s · Wait 500ms')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand collection' })).toBeInTheDocument();
  });

  it('expanding calls setPresetsCollapsed(false)', async () => {
    const user = userEvent.setup();
    const presetsNode = makePresetsNode();
    useWorkflowStore.setState({ nodes: [presetsNode] });
    renderCard({ node: presetsNode, collapsed: true, selected: false });

    await user.click(screen.getByRole('button', { name: 'Expand collection' }));
    expect(useWorkflowStore.getState().presetsCollapsed[presetsNode.id]).toBe(false);
  });

  it('expanded titlebar reads plainly "Presets" — not a growing per-preset summary', () => {
    const presetsNode = makePresetsNode({
      presets: [
        { id: 's1', kind: 'wait', durationMs: 1000 },
        { id: 's2', kind: 'wait', durationMs: 1000 },
        { id: 's3', kind: 'wait', durationMs: 1000 },
      ],
    });
    useWorkflowStore.setState({ nodes: [presetsNode] });
    renderCard({ node: presetsNode, collapsed: false, selected: false });

    expect(screen.getByText('Presets')).toBeInTheDocument();
    expect(screen.queryByText(/Wait 1s · Wait 1s/)).not.toBeInTheDocument();
  });

  it('expanded with no presets shows an empty hint and an Add Wait button', () => {
    const presetsNode = makePresetsNode();
    useWorkflowStore.setState({ nodes: [presetsNode] });
    renderCard({ node: presetsNode, collapsed: false, selected: false });

    expect(screen.getByText('No presets yet — add one below.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add Wait' })).toBeInTheDocument();
  });

  it('Add Wait appends a preset to the store', async () => {
    const user = userEvent.setup();
    const presetsNode = makePresetsNode();
    useWorkflowStore.setState({ nodes: [presetsNode] });
    renderCard({ node: presetsNode, collapsed: false, selected: false });

    await user.click(screen.getByRole('button', { name: '+ Add Wait' }));
    expect(useWorkflowStore.getState().nodes[0].presets).toHaveLength(1);
    expect(useWorkflowStore.getState().nodes[0].presets![0]).toMatchObject({ kind: 'wait' });
  });

  it('renders each preset with a duration input, and editing it updates the store', () => {
    const presetsNode = makePresetsNode({ presets: [{ id: 's1', kind: 'wait', durationMs: 1000 }] });
    useWorkflowStore.setState({ nodes: [presetsNode] });
    renderCard({ node: presetsNode, collapsed: false, selected: false });

    const input = screen.getByLabelText('Preset 1 duration in seconds');
    expect(input).toHaveValue(1);

    fireEvent.change(input, { target: { value: '3' } });
    expect(useWorkflowStore.getState().nodes[0].presets![0].durationMs).toBe(3000);
  });

  it('removes a preset via its × button', async () => {
    const user = userEvent.setup();
    const presetsNode = makePresetsNode({ presets: [{ id: 's1', kind: 'wait', durationMs: 1000 }] });
    useWorkflowStore.setState({ nodes: [presetsNode] });
    renderCard({ node: presetsNode, collapsed: false, selected: false });

    await user.click(screen.getByRole('button', { name: 'Remove preset 1' }));
    expect(useWorkflowStore.getState().nodes[0].presets).toEqual([]);
  });

  it('reorders presets with the up/down buttons, disabling at each end', async () => {
    const user = userEvent.setup();
    const presetsNode = makePresetsNode({
      presets: [
        { id: 's1', kind: 'wait', durationMs: 1000 },
        { id: 's2', kind: 'wait', durationMs: 2000 },
      ],
    });
    useWorkflowStore.setState({ nodes: [presetsNode] });
    renderCard({ node: presetsNode, collapsed: false, selected: false });

    expect(screen.getByRole('button', { name: 'Move preset 1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move preset 2 down' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Move preset 2 up' }));
    expect(useWorkflowStore.getState().nodes[0].presets!.map((p) => p.id)).toEqual(['s2', 's1']);
  });

  it('removes the whole collection via the remove button', async () => {
    const user = userEvent.setup();
    const presetsNode = makePresetsNode();
    useWorkflowStore.setState({ nodes: [presetsNode], nodePositions: { g1: { x: 0, y: 0 } } });
    renderCard({ node: presetsNode, collapsed: false, selected: false });

    await user.click(screen.getByRole('button', { name: 'Remove this collection' }));
    expect(useWorkflowStore.getState().nodes).toEqual([]);
  });

  it('disables editing chrome while the workflow is running', () => {
    const presetsNode = makePresetsNode({ presets: [{ id: 's1', kind: 'wait', durationMs: 1000 }] });
    useWorkflowStore.setState({ nodes: [presetsNode], isRunning: true });
    renderCard({ node: presetsNode, collapsed: false, selected: false });

    expect(screen.getByRole('button', { name: '+ Add Wait' })).toBeDisabled();
    expect(screen.getByLabelText('Preset 1 duration in seconds')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove this collection' })).toBeDisabled();
  });
});
