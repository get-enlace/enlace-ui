import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
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
      isRunning: false,
    });
  });

  it('shows a placeholder when no node is selected', () => {
    render(<NodeInspector onCollapse={() => {}} />);
    expect(screen.getByText('Select a node to configure it.')).toBeInTheDocument();
  });

  it('groups request fields under Request with Path / Query / Body sections, toggle beside Request', () => {
    const op: Operation = {
      id: 'GET /items/{id}',
      method: 'get',
      path: '/items/{id}',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
      ],
      requestBodySchema: { type: 'object', properties: { note: { type: 'string' } } },
      responseSchema: null,
    };
    useWorkflowStore.setState({
      nodes: [makeNode({ operationId: op.id })],
      operations: [op],
      selectedNodeId: 'node-1',
    });
    render(<NodeInspector onCollapse={() => {}} />);

    expect(screen.getByRole('heading', { name: 'Request' })).toBeInTheDocument();
    expect(screen.queryByText('Request fields')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Path variables' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Query params' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Body' })).toBeInTheDocument();
    // Form/Raw toggle lives next to Request, not under Body.
    expect(screen.getByRole('checkbox', { name: /Switch to Raw view/ })).toBeInTheDocument();
  });

  it('shows the Form/Raw toggle for path/query-only operations, and switches those sections to Raw editors', async () => {
    const op: Operation = {
      id: 'GET /items/{id}',
      method: 'get',
      path: '/items/{id}',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
        { name: 'offset', in: 'query', required: false, schema: { type: 'integer' } },
      ],
      requestBodySchema: null,
      responseSchema: null,
    };
    useWorkflowStore.setState({
      nodes: [
        makeNode({
          operationId: op.id,
          fieldValues: {
            'path.id': { source: 'static', value: 'item-1' },
            'query.limit': { source: 'static', value: 10 },
          },
        }),
      ],
      operations: [op],
      selectedNodeId: 'node-1',
    });
    render(<NodeInspector onCollapse={() => {}} />);

    expect(screen.getByRole('checkbox', { name: /Switch to Raw view/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Switch to Raw view/ }));

    await waitFor(() => {
      const state = useWorkflowStore.getState().nodes[0];
      expect(state.requestMode).toBe('raw');
      expect(JSON.parse(state.rawPath!.template)).toEqual({ id: 'item-1' });
      // Unset query keys are still present as empty strings so Raw starts with a full skeleton.
      expect(JSON.parse(state.rawQuery!.template)).toEqual({ limit: 10, offset: '' });
    });
    // Form field rows are gone; CodeMirror editors are present instead.
    expect(screen.queryByLabelText('path.id')).not.toBeInTheDocument();
    // Mapping tip appears once under Request, not once per Raw editor.
    expect(screen.getAllByText(/inside a string to map a value/)).toHaveLength(1);
  });

  it('lists credentials on the lock picker and sets the selected one on the node', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      nodes: [makeNode()],
      selectedNodeId: 'node-1',
      credentials: [{ id: 'cred-1', name: 'staging', type: 'bearer', token: 'x' }],
    });
    render(<NodeInspector onCollapse={() => {}} />);

    const lock = screen.getByRole('button', { name: 'Credential' });
    expect(lock).not.toHaveClass('node-inspector__cred-lock--set');
    await user.click(lock);
    await user.click(screen.getByRole('option', { name: 'staging' }));

    expect(useWorkflowStore.getState().nodes[0].credentialId).toBe('cred-1');
    expect(screen.getByRole('button', { name: 'Credential' })).toHaveClass('node-inspector__cred-lock--set');
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

  describe('Raw JSON body mode', () => {
    it('suggests Raw JSON via a banner when the body has a shape the form can\'t fully represent', () => {
      // petOperation's `weird` field is a oneOf — see the fixture above.
      useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1' });
      render(<NodeInspector onCollapse={() => {}} />);
      expect(screen.getByText(/shape the form can't fully represent/)).toBeInTheDocument();
    });

    it('does not show the banner for a body the form can fully represent', () => {
      const plainOperation: Operation = {
        id: 'POST /plain',
        method: 'post',
        path: '/plain',
        parameters: [],
        requestBodySchema: { type: 'object', properties: { name: { type: 'string' } } },
        responseSchema: null,
      };
      useWorkflowStore.setState({
        nodes: [makeNode({ operationId: 'POST /plain' })],
        operations: [petOperation, getPetOperation, plainOperation],
        selectedNodeId: 'node-1',
      });
      render(<NodeInspector onCollapse={() => {}} />);
      expect(screen.queryByText(/shape the form can't fully represent/)).not.toBeInTheDocument();
    });

    it('switching to Raw JSON carries over existing static field values, then switches back losslessly', async () => {
      // A schema the form can fully represent — petOperation's `weird` oneOf
      // field would make any raw round trip inherently lossy, which isn't
      // what this test is checking.
      const plainOperation: Operation = {
        id: 'POST /plain',
        method: 'post',
        path: '/plain',
        parameters: [],
        requestBodySchema: { type: 'object', properties: { name: { type: 'string' } } },
        responseSchema: null,
      };
      useWorkflowStore.setState({
        nodes: [
          makeNode({ operationId: 'POST /plain', fieldValues: { 'body.name': { source: 'static', value: 'fido' } } }),
        ],
        operations: [petOperation, getPetOperation, plainOperation],
        selectedNodeId: 'node-1',
      });
      render(<NodeInspector onCollapse={() => {}} />);

      const modeSwitch = screen.getByRole('checkbox');
      fireEvent.click(modeSwitch);

      const rawBody = () => useWorkflowStore.getState().nodes[0].rawBody;
      await waitFor(() => expect(rawBody()).toBeTruthy());
      expect(JSON.parse(rawBody()!.template).name).toBe('fido');
      expect(useWorkflowStore.getState().nodes[0].requestMode).toBe('raw');

      fireEvent.click(modeSwitch);
      expect(useWorkflowStore.getState().nodes[0].requestMode).toBe('form');
      expect(useWorkflowStore.getState().nodes[0].fieldValues['body.name']).toEqual({ source: 'static', value: 'fido' });
    });

    it('picks up field edits made in Form mode when switching back to Raw a second time', async () => {
      // Regression test for a reported bug: Form -> Raw -> Form -> Raw lost
      // the field edits made during the second stint in Form mode, because
      // switchToRaw only ever seeded `rawBody` from `fieldValues` the very
      // first time (`if (!node.rawBody)`) — every later switch back to Raw
      // just re-showed that stale cached template.
      const plainOperation: Operation = {
        id: 'POST /plain',
        method: 'post',
        path: '/plain',
        parameters: [],
        requestBodySchema: { type: 'object', properties: { name: { type: 'string' } } },
        responseSchema: null,
      };
      useWorkflowStore.setState({
        nodes: [
          makeNode({ operationId: 'POST /plain', fieldValues: { 'body.name': { source: 'static', value: 'fido' } } }),
        ],
        operations: [petOperation, getPetOperation, plainOperation],
        selectedNodeId: 'node-1',
      });
      render(<NodeInspector onCollapse={() => {}} />);
      const modeSwitch = screen.getByRole('checkbox');

      // Form -> Raw: seeded with "fido".
      fireEvent.click(modeSwitch);
      const rawBody = () => useWorkflowStore.getState().nodes[0].rawBody;
      await waitFor(() => expect(rawBody()).toBeTruthy());
      expect(JSON.parse(rawBody()!.template).name).toBe('fido');

      // Emptied out directly in Raw mode (as if the user cleared the JSON by hand).
      useWorkflowStore.setState((state) => ({
        nodes: state.nodes.map((n) => (n.id === 'node-1' ? { ...n, rawBody: { template: '{}', tags: {} } } : n)),
      }));

      // Raw -> Form: not lossy (an empty object round-trips through one static-undefined field), so no confirm needed.
      fireEvent.click(modeSwitch);
      expect(useWorkflowStore.getState().nodes[0].requestMode).toBe('form');

      // Edit the now-empty field in Form mode.
      fireEvent.change(fieldRow('body.name').getByRole('textbox'), { target: { value: 'rex' } });
      expect(useWorkflowStore.getState().nodes[0].fieldValues['body.name']).toEqual({ source: 'static', value: 'rex' });

      // Form -> Raw again: must reflect "rex", not the stale cached "{}".
      fireEvent.click(modeSwitch);
      await waitFor(() => expect(JSON.parse(rawBody()!.template).name).toBe('rex'));
    });

    it('warns before converting back to Form when the Raw JSON has structure the form would lose, and only converts on confirm', async () => {
      useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1' });
      render(<NodeInspector onCollapse={() => {}} />);

      const modeSwitch = screen.getByRole('checkbox');
      fireEvent.click(modeSwitch);
      await waitFor(() => expect(useWorkflowStore.getState().nodes[0].rawBody).toBeTruthy());

      // Inject an extra top-level key the flat form has no field for.
      useWorkflowStore.setState((state) => ({
        nodes: state.nodes.map((n) =>
          n.id === 'node-1' ? { ...n, rawBody: { ...n.rawBody!, template: n.rawBody!.template.replace('{', '{"surprise":1,') } } : n
        ),
      }));

      fireEvent.click(modeSwitch);
      expect(screen.getByText(/Switching to Form view may lose custom JSON structure/)).toBeInTheDocument();
      expect(useWorkflowStore.getState().nodes[0].requestMode).toBe('raw'); // not switched yet

      fireEvent.click(screen.getByText('Switch anyway'));
      expect(useWorkflowStore.getState().nodes[0].requestMode).toBe('form');
    });
  });

  describe('locked while a run is in progress', () => {
    it('shows a banner and disables every field/credential control via the fieldset', () => {
      useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1', isRunning: true });
      render(<NodeInspector onCollapse={() => {}} />);

      expect(screen.getByText('Workflow is running — editing is locked until it finishes.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Credential' })).toBeDisabled();
      expect(fieldRow('body.qty').getByRole('textbox')).toBeDisabled();
    });

    it("doesn't show the banner or disable anything when not running", () => {
      useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1', isRunning: false });
      render(<NodeInspector onCollapse={() => {}} />);

      expect(screen.queryByText(/editing is locked/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Credential' })).not.toBeDisabled();
    });
  });
});
