import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider, Position, type NodeProps } from 'reactflow';
import { PresetsNodeCard, type PresetsNodeData } from './PresetsNodeCard.js';
import { useWorkflowStore } from '../../store/workflowStore.js';
import type { PresetsNode, WorkflowNode } from '../../types.js';

function makePresetsNode(overrides: Partial<PresetsNode> = {}): PresetsNode {
  return { id: 'g1', kind: 'presets', credentialId: null, fieldValues: {}, presets: [], ...overrides };
}

function asPresetsNode(node: WorkflowNode): PresetsNode {
  if (node.kind !== 'presets') throw new Error('expected a presets collection, got an operation node');
  return node;
}

/** Re-reads node `id`'s current `presets` list straight from the store — used after an interaction to see what actually landed, not the props the card was first rendered with. */
function presetsOf(id = 'g1'): PresetsNode['presets'] {
  return asPresetsNode(useWorkflowStore.getState().nodes.find((n) => n.id === id)!).presets;
}

function cardProps(data: PresetsNodeData): NodeProps<PresetsNodeData> {
  return {
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
}

function renderCard(data: PresetsNodeData) {
  return render(
    <ReactFlowProvider>
      <PresetsNodeCard {...cardProps(data)} />
    </ReactFlowProvider>
  );
}

// Canvas.tsx's real <ReactFlow> wires `onNodeClick={(_, node) => selectNode(node.id)}`
// on every node — a plain DOM listener, so it sees any click that bubbles
// out of this card unless a row button stops it first. `renderCard` above
// doesn't reproduce that (no <ReactFlow> present), so a real bubble-order
// regression (a row button's own state update getting clobbered by
// selectNode resetting selectedPresetId right after) wouldn't fail there —
// only here, where the wrapper reproduces exactly that listener.
function renderCardInsideSimulatedCanvas(data: PresetsNodeData) {
  return render(
    <ReactFlowProvider>
      <div onClick={() => useWorkflowStore.getState().selectNode(data.node.id)}>
        <PresetsNodeCard {...cardProps(data)} />
      </div>
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
      selectedPresetId: null,
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

  function presetDataTransfer(kind: string) {
    return { getData: (type: string) => (type === 'text/preset-kind' ? kind : ''), types: ['text/preset-kind'] };
  }

  it('expanded with no presets shows an empty hint to drag one in — no "+ Add" button', () => {
    const presetsNode = makePresetsNode();
    useWorkflowStore.setState({ nodes: [presetsNode] });
    renderCard({ node: presetsNode, collapsed: false, selected: false });

    expect(screen.getByText('Drag a preset here to add it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add Wait/ })).not.toBeInTheDocument();
  });

  it('dropping a Wait preset from the palette appends it to the collection', () => {
    const presetsNode = makePresetsNode();
    useWorkflowStore.setState({ nodes: [presetsNode] });
    const { container } = renderCard({ node: presetsNode, collapsed: false, selected: false });

    const card = container.querySelector('.presets-node--expanded')!;
    fireEvent.drop(card, { dataTransfer: presetDataTransfer('wait') });

    expect(presetsOf()).toHaveLength(1);
    expect(presetsOf()![0]).toMatchObject({ kind: 'wait' });
  });

  it('dropping a Wait preset onto the collapsed card also appends it', () => {
    const presetsNode = makePresetsNode();
    useWorkflowStore.setState({ nodes: [presetsNode] });
    const { container } = renderCard({ node: presetsNode, collapsed: true, selected: false });

    const card = container.querySelector('.presets-node--collapsed')!;
    fireEvent.drop(card, { dataTransfer: presetDataTransfer('wait') });

    expect(presetsOf()).toHaveLength(1);
  });

  it('ignores a drop that is not a known preset kind (e.g. an operation drag)', () => {
    const presetsNode = makePresetsNode();
    useWorkflowStore.setState({ nodes: [presetsNode] });
    const { container } = renderCard({ node: presetsNode, collapsed: false, selected: false });

    const card = container.querySelector('.presets-node--expanded')!;
    fireEvent.drop(card, { dataTransfer: { getData: () => '', types: [] } });

    expect(presetsOf()).toEqual([]);
  });

  it('renders each preset as a uniform summary row — icon + formatPresetLabel, same shape for every kind', () => {
    const presetsNode = makePresetsNode({
      presets: [
        { id: 's1', kind: 'wait', durationMs: 1000 },
        { id: 'p1', kind: 'assert', checks: [{ id: 'c1', source: { type: 'response_body', sourceNodeId: '' }, operator: 'equals' }] },
      ],
    });
    useWorkflowStore.setState({ nodes: [presetsNode] });
    renderCard({ node: presetsNode, collapsed: false, selected: false });

    expect(screen.getByRole('button', { name: 'Wait 1s' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assert (1 check)' })).toBeInTheDocument();
    // No per-kind editor leaks onto the card — that's NodeConfig's job now.
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByText('+ Add check')).not.toBeInTheDocument();
  });

  it('clicking a preset row opens its config via selectPreset', async () => {
    const user = userEvent.setup();
    const presetsNode = makePresetsNode({ presets: [{ id: 's1', kind: 'wait', durationMs: 1000 }] });
    useWorkflowStore.setState({ nodes: [presetsNode] });
    renderCard({ node: presetsNode, collapsed: false, selected: false });

    await user.click(screen.getByRole('button', { name: 'Wait 1s' }));

    expect(useWorkflowStore.getState().selectedNodeId).toBe('g1');
    expect(useWorkflowStore.getState().selectedPresetId).toBe('s1');
  });

  it('highlights the selected preset row', () => {
    const presetsNode = makePresetsNode({
      presets: [
        { id: 's1', kind: 'wait', durationMs: 1000 },
        { id: 's2', kind: 'wait', durationMs: 2000 },
      ],
    });
    useWorkflowStore.setState({ nodes: [presetsNode], selectedNodeId: 'g1', selectedPresetId: 's2' });
    renderCard({ node: presetsNode, collapsed: false, selected: false });

    expect(screen.getByRole('button', { name: 'Wait 1s' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Wait 2s' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('regression: selecting a preset survives the click bubbling to Canvas.tsx\'s onNodeClick (which would otherwise reset selectedPresetId via selectNode)', async () => {
    const user = userEvent.setup();
    const presetsNode = makePresetsNode({ presets: [{ id: 's1', kind: 'wait', durationMs: 1000 }] });
    useWorkflowStore.setState({ nodes: [presetsNode] });
    renderCardInsideSimulatedCanvas({ node: presetsNode, collapsed: false, selected: false });

    await user.click(screen.getByRole('button', { name: 'Wait 1s' }));

    expect(useWorkflowStore.getState().selectedNodeId).toBe('g1');
    expect(useWorkflowStore.getState().selectedPresetId).toBe('s1'); // not clobbered back to null
  });

  it('regression: move/remove row buttons and the collapse chevron also stop the bubble, so a live preset selection survives clicking them', async () => {
    const user = userEvent.setup();
    const presetsNode = makePresetsNode({
      presets: [
        { id: 's1', kind: 'wait', durationMs: 1000 },
        { id: 's2', kind: 'wait', durationMs: 2000 },
      ],
    });
    useWorkflowStore.setState({ nodes: [presetsNode], selectedNodeId: 'g1', selectedPresetId: 's1' });
    renderCardInsideSimulatedCanvas({ node: presetsNode, collapsed: false, selected: false });

    await user.click(screen.getByRole('button', { name: 'Move preset 1 down' }));
    expect(useWorkflowStore.getState().selectedPresetId).toBe('s1');

    await user.click(screen.getByRole('button', { name: 'Collapse collection' }));
    expect(useWorkflowStore.getState().selectedPresetId).toBe('s1');
  });

  it('removes a preset via its × button', async () => {
    const user = userEvent.setup();
    const presetsNode = makePresetsNode({ presets: [{ id: 's1', kind: 'wait', durationMs: 1000 }] });
    useWorkflowStore.setState({ nodes: [presetsNode] });
    renderCard({ node: presetsNode, collapsed: false, selected: false });

    await user.click(screen.getByRole('button', { name: 'Remove preset 1' }));
    expect(presetsOf()).toEqual([]);
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
    expect(presetsOf()!.map((p) => p.id)).toEqual(['s2', 's1']);
  });

  it('removes the whole collection via the remove button', async () => {
    const user = userEvent.setup();
    const presetsNode = makePresetsNode();
    useWorkflowStore.setState({ nodes: [presetsNode], nodePositions: { g1: { x: 0, y: 0 } } });
    renderCard({ node: presetsNode, collapsed: false, selected: false });

    await user.click(screen.getByRole('button', { name: 'Remove this collection' }));
    expect(useWorkflowStore.getState().nodes).toEqual([]);
  });

  it('disables editing chrome (including a preset drop) while the workflow is running', () => {
    const presetsNode = makePresetsNode({ presets: [{ id: 's1', kind: 'wait', durationMs: 1000 }] });
    useWorkflowStore.setState({ nodes: [presetsNode], isRunning: true });
    const { container } = renderCard({ node: presetsNode, collapsed: false, selected: false });

    const card = container.querySelector('.presets-node--expanded')!;
    fireEvent.drop(card, { dataTransfer: presetDataTransfer('wait') });
    expect(presetsOf()).toHaveLength(1); // unchanged — drop is a no-op while locked

    expect(screen.getByRole('button', { name: 'Wait 1s' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove this collection' })).toBeDisabled();
  });

  describe('assert presets', () => {
    it('dropping an Assert preset from the palette appends it with no checks', () => {
      const presetsNode = makePresetsNode();
      useWorkflowStore.setState({ nodes: [presetsNode] });
      const { container } = renderCard({ node: presetsNode, collapsed: false, selected: false });

      const card = container.querySelector('.presets-node--expanded')!;
      fireEvent.drop(card, { dataTransfer: presetDataTransfer('assert') });

      const presets = presetsOf()!;
      expect(presets).toHaveLength(1);
      expect(presets[0]).toMatchObject({ kind: 'assert', checks: [] });
    });

    it('labels a collapsed assert preset by its check count via formatPresetLabel', () => {
      const presetsNode = makePresetsNode({
        presets: [
          {
            id: 'p1',
            kind: 'assert',
            checks: [
              { id: 'c1', source: { type: 'response_body', sourceNodeId: 'n1' }, operator: 'exists' },
              { id: 'c2', source: { type: 'response_status', sourceNodeId: 'n1' }, operator: 'equals', expected: '200' },
            ],
          },
        ],
      });
      useWorkflowStore.setState({ nodes: [presetsNode] });
      renderCard({ node: presetsNode, collapsed: true, selected: false });

      expect(screen.getByText('1')).toBeInTheDocument(); // preset count
      expect(screen.getByText('Presets')).toHaveAttribute('title', 'Assert (2 checks)');
    });
  });
});
