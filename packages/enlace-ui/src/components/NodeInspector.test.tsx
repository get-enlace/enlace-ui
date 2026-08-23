import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NodeInspector } from './NodeInspector.js';
import { useWorkflowStore } from '../store/workflowStore.js';
import type { Operation, WorkflowNode } from '../types.js';

const petOperation: Operation = {
  id: 'POST /pet',
  method: 'post',
  path: '/pet',
  parameters: [],
  requestBodySchema: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string' },
      qty: { type: 'integer' },
      status: { type: 'string', enum: ['available', 'pending', 'sold'] },
      photoUrls: { type: 'array', items: { type: 'string' } },
      category: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } },
      weird: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
    },
  },
  responseSchema: {
    type: 'object',
    properties: { id: { type: 'integer' }, name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
  },
};

const getPetOperation: Operation = {
  id: 'GET /pet/{petId}',
  method: 'get',
  path: '/pet/{petId}',
  parameters: [],
  requestBodySchema: null,
  responseSchema: petOperation.responseSchema,
};

function makeNode(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return { id: 'node-1', operationId: 'POST /pet', credentialId: null, fieldValues: {}, ...overrides };
}

// Field labels render as one merged text node ("body.name * (string)"), not
// wrapped around their control — find the row by a prefix match, then scope
// queries to it with `within`.
function fieldRow(pathPrefix: string) {
  const label = screen.getByText((_, el) => el?.tagName === 'LABEL' && el.textContent!.startsWith(pathPrefix));
  return within(label.parentElement!);
}

describe('NodeInspector', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      nodes: [],
      connections: [],
      operations: [petOperation, getPetOperation],
      selectedNodeId: null,
      credentials: [],
    });
  });

  it('shows a placeholder when no node is selected', () => {
    render(<NodeInspector onCollapse={() => {}} />);
    expect(screen.getByText('Select a node to configure it.')).toBeInTheDocument();
  });

  it('lists credentials and sets the selected one on the node', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      nodes: [makeNode()],
      selectedNodeId: 'node-1',
      credentials: [{ id: 'cred-1', name: 'staging', type: 'bearer', token: 'x' }],
    });
    render(<NodeInspector onCollapse={() => {}} />);

    await user.selectOptions(screen.getByLabelText('Credential'), 'staging');

    expect(useWorkflowStore.getState().nodes[0].credentialId).toBe('cred-1');
  });

  it('coerces a static integer field to a real number in the store', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1' });
    render(<NodeInspector onCollapse={() => {}} />);

    const input = fieldRow('body.qty').getByRole('textbox');
    await user.type(input, '3');

    expect(useWorkflowStore.getState().nodes[0].fieldValues['body.qty']).toEqual({ source: 'static', value: 3 });
  });

  it('renders an enum field as a dropdown and stores the selected value', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1' });
    render(<NodeInspector onCollapse={() => {}} />);

    const row = fieldRow('body.status');
    // Two unlabelled comboboxes in this row: [source-kind, enum value].
    const [, valueSelect] = row.getAllByRole('combobox');
    await user.selectOptions(valueSelect, 'pending');

    expect(useWorkflowStore.getState().nodes[0].fieldValues['body.status']).toEqual({
      source: 'static',
      value: 'pending',
    });
  });

  it('renders an array field as a JSON textarea, parsing valid JSON and falling back to raw text while invalid', () => {
    useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1' });
    render(<NodeInspector onCollapse={() => {}} />);

    const textarea = fieldRow('body.photoUrls').getByRole('textbox');
    expect(textarea).toHaveAttribute('placeholder', '["string","string"]');

    // fireEvent.change (not user.type) — user-event v14 treats "[" and "{"
    // as special key-sequence syntax, so a literal JSON string needs escaping
    // there; setting the value directly is more direct for this assertion.
    fireEvent.change(textarea, { target: { value: '["a","b"]' } });
    expect(useWorkflowStore.getState().nodes[0].fieldValues['body.photoUrls']).toEqual({
      source: 'static',
      value: ['a', 'b'],
    });

    fireEvent.change(textarea, { target: { value: '["a"' } }); // incomplete/invalid JSON
    expect(useWorkflowStore.getState().nodes[0].fieldValues['body.photoUrls']).toEqual({
      source: 'static',
      value: '["a"', // raw text preserved, not lost, while mid-typing/invalid
    });
  });

  it('recurses into nested object properties as their own directly-editable fields', () => {
    useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1' });
    render(<NodeInspector onCollapse={() => {}} />);

    // category.id / category.name appear directly — no disabled "body.category" row.
    expect(fieldRow('body.category.id')).toBeTruthy();
    expect(fieldRow('body.category.name')).toBeTruthy();
    expect(screen.queryByText((_, el) => el?.tagName === 'LABEL' && el.textContent === 'body.category')).not.toBeInTheDocument();
  });

  it('marks a genuinely unrecognized schema shape as unsupported and disables its controls', () => {
    useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1' });
    render(<NodeInspector onCollapse={() => {}} />);

    const row = fieldRow('body.weird');
    expect(row.getByText(/\(unsupported\)/)).toBeInTheDocument();
    expect(row.getByRole('textbox')).toBeDisabled();
  });

  it('shows the connect-a-node hint when there are no ancestors, hides it once connected', () => {
    useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1' });
    const { rerender } = render(<NodeInspector onCollapse={() => {}} />);
    expect(screen.getByText(/Connect this node from another/)).toBeInTheDocument();

    useWorkflowStore.setState({
      nodes: [makeNode(), makeNode({ id: 'node-2', operationId: 'GET /pet/{petId}' })],
      connections: [{ fromNodeId: 'node-2', toNodeId: 'node-1' }],
    });
    rerender(<NodeInspector onCollapse={() => {}} />);
    expect(screen.queryByText(/Connect this node from another/)).not.toBeInTheDocument();
  });

  it('maps a field from a connected ancestor\'s compatible response field', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      nodes: [makeNode(), makeNode({ id: 'node-2', operationId: 'GET /pet/{petId}' })],
      connections: [{ fromNodeId: 'node-2', toNodeId: 'node-1' }],
      selectedNodeId: 'node-1',
    });
    render(<NodeInspector onCollapse={() => {}} />);

    const row = fieldRow('body.name');
    const [sourceKindSelect] = row.getAllByRole('combobox');
    await user.selectOptions(sourceKindSelect, 'mapped');
    // Three comboboxes once mapped: [source-kind, ancestor node, response field].
    const [, , fieldSelect] = row.getAllByRole('combobox');
    await user.selectOptions(fieldSelect, 'name');

    expect(useWorkflowStore.getState().nodes[0].fieldValues['body.name']).toEqual({
      source: 'mapped',
      fromNodeId: 'node-2',
      fromResponseFieldPath: 'name',
    });
  });

  it('disables a type-incompatible field in the map-from picker, with an explanatory reason', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      nodes: [makeNode(), makeNode({ id: 'node-2', operationId: 'GET /pet/{petId}' })],
      connections: [{ fromNodeId: 'node-2', toNodeId: 'node-1' }],
      selectedNodeId: 'node-1',
    });
    render(<NodeInspector onCollapse={() => {}} />);

    // body.name is a string — GET /pet/{petId}'s response `tags` is an array.
    const row = fieldRow('body.name');
    const [sourceKindSelect] = row.getAllByRole('combobox');
    await user.selectOptions(sourceKindSelect, 'mapped');
    const [, , fieldSelect] = row.getAllByRole('combobox');
    const tagsOption = within(fieldSelect).getByText(/tags/);

    expect(tagsOption).toHaveTextContent('(type mismatch)');
    expect(tagsOption).toBeDisabled();
    expect(tagsOption).toHaveAttribute('title', expect.stringContaining('Type mismatch'));

    const idOption = within(fieldSelect).getByText(/^id/);
    expect(idOption).toBeDisabled(); // integer vs string target — also incompatible

    const nameOption = within(fieldSelect).getByText('name');
    expect(nameOption).not.toBeDisabled();
  });
});
