import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NodeConfig } from './NodeConfig.js';
import { useWorkflowStore } from '../../store/workflowStore.js';
import type { AssertPreset, Operation, OperationNode, Preset, PresetsNode, WaitPreset, WorkflowNode } from '../../types.js';

// Preset is a real discriminated union (WaitPreset | AssertPreset) — these
// narrow-or-throw so a test can read a kind-specific field directly instead
// of every call site repeating an `as`/`!` that would silently hide a
// wrong-kind preset instead of failing the test on it.
function asWaitPreset(preset: Preset): WaitPreset {
  if (preset.kind !== 'wait') throw new Error(`expected a wait preset, got "${preset.kind}"`);
  return preset;
}
function asAssertPreset(preset: Preset): AssertPreset {
  if (preset.kind !== 'assert') throw new Error(`expected an assert preset, got "${preset.kind}"`);
  return preset;
}

// Same "narrow-or-throw" idiom, one level up — WorkflowNode is itself now a
// discriminated union (OperationNode | PresetsNode).
function asOperationNode(node: WorkflowNode): OperationNode {
  if (node.kind === 'presets') throw new Error('expected an operation node, got a presets collection');
  return node;
}
function asPresetsNode(node: WorkflowNode): PresetsNode {
  if (node.kind !== 'presets') throw new Error('expected a presets collection, got an operation node');
  return node;
}

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
  requestBodyContentType: 'application/json',
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
  requestBodyContentType: null,
  responseSchema: petOperation.responseSchema,
};

function makeNode(overrides: Partial<OperationNode> = {}): OperationNode {
  return {
    id: 'node-1',
    kind: 'operation',
    operationId: 'POST /pet',
    requestMode: 'form',
    credentialId: null,
    fieldValues: {},
    ...overrides,
  };
}

// Field labels render as one merged text node ("body.name * (string)"), not
// wrapped around their control — find the row by a prefix match, then scope
// queries to it with `within`.
function fieldRow(pathPrefix: string) {
  const label = screen.getByText((_, el) => el?.tagName === 'LABEL' && el.textContent!.startsWith(pathPrefix));
  return within(label.parentElement!);
}

describe('NodeConfig', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      nodes: [],
      connections: [],
      operations: [petOperation, getPetOperation],
      selectedNodeId: null,
      selectedPresetId: null,
      credentials: [],
      isRunning: false,
    });
  });

  it('shows a placeholder when no node is selected', () => {
    render(<NodeConfig />);
    expect(screen.getByText('Select a node to configure it.')).toBeInTheDocument();
  });

  it('switching selection between a presets node and an operation node does not throw (stable hook order)', () => {
    useWorkflowStore.setState({
      nodes: [
        { id: 'g1', kind: 'presets', credentialId: null, fieldValues: {}, presets: [{ id: 'p1', kind: 'wait', durationMs: 1000 }] },
        makeNode({ id: 'node-1' }),
      ],
      selectedNodeId: 'g1',
      selectedPresetId: 'p1',
    });
    const { rerender } = render(<NodeConfig />);
    expect(screen.getByText('Wait 1s')).toBeInTheDocument();

    useWorkflowStore.setState({ selectedNodeId: 'node-1', selectedPresetId: null });
    rerender(<NodeConfig />);
    expect(screen.getByRole('heading', { name: 'Request' })).toBeInTheDocument();

    useWorkflowStore.setState({ selectedNodeId: 'g1', selectedPresetId: 'p1' });
    rerender(<NodeConfig />);
    expect(screen.getByText('Wait 1s')).toBeInTheDocument();
  });

  it('shows a placeholder for a presets node until a preset is selected', () => {
    useWorkflowStore.setState({
      nodes: [{ id: 'g1', kind: 'presets', credentialId: null, fieldValues: {}, presets: [] }],
      selectedNodeId: 'g1',
      selectedPresetId: null,
    });
    render(<NodeConfig />);

    expect(screen.getByText('Select a preset on the canvas to configure it.')).toBeInTheDocument();
    expect(screen.queryByText('Select a node to configure it.')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Request' })).not.toBeInTheDocument();
  });

  describe('preset config', () => {
    function makePresetsNode(overrides: Partial<PresetsNode> = {}): PresetsNode {
      return { id: 'g1', kind: 'presets', credentialId: null, fieldValues: {}, presets: [], ...overrides };
    }

    it("renders a Wait preset's duration in seconds, and editing it updates the store", () => {
      const presetsNode = makePresetsNode({ presets: [{ id: 'p1', kind: 'wait', durationMs: 1000 }] });
      useWorkflowStore.setState({ nodes: [presetsNode], selectedNodeId: 'g1', selectedPresetId: 'p1' });
      render(<NodeConfig />);

      expect(screen.getByText('Wait 1s')).toBeInTheDocument(); // panel header
      const input = screen.getByLabelText('Duration in seconds');
      expect(input).toHaveValue(1);

      fireEvent.change(input, { target: { value: '3' } });
      expect(asWaitPreset(asPresetsNode(useWorkflowStore.getState().nodes[0]).presets![0]).durationMs).toBe(3000);
    });

    it('dropping an Assert preset from the palette appends it with no checks', () => {
      // Regression coverage for addPreset's own selection behavior — kept
      // here (not just in the store test) since it's what makes an assert
      // preset's config show up immediately after a palette drop.
      const { addPresetsNode, addPreset } = useWorkflowStore.getState();
      const id = addPresetsNode({ x: 0, y: 0 });
      addPreset(id, { kind: 'assert', checks: [] });
      render(<NodeConfig />);

      expect(screen.getByText('Assert (0 checks)')).toBeInTheDocument();
    });

    it('+ Add check appends a blank check to the store', async () => {
      const user = userEvent.setup();
      const presetsNode = makePresetsNode({ presets: [{ id: 'p1', kind: 'assert', checks: [] }] });
      useWorkflowStore.setState({ nodes: [presetsNode], selectedNodeId: 'g1', selectedPresetId: 'p1' });
      render(<NodeConfig />);

      await user.click(screen.getByRole('button', { name: '+ Add check' }));
      const checks = asAssertPreset(asPresetsNode(useWorkflowStore.getState().nodes[0]).presets![0]).checks;
      expect(checks).toHaveLength(1);
      expect(checks[0]).toMatchObject({ operator: 'equals', source: { type: 'response_body' } });
    });

    // Each field's own onChange handler is exercised against a fixture that
    // already has the check in place, rather than chaining off a prior "+
    // Add check" click within the same render — like every other test in
    // this file, `useWorkflowStore.setState` is a snapshot taken before
    // render(), so a store update from an earlier interaction never
    // re-renders this component; only the store's own resulting state is
    // observable afterward.
    it('editing a check row updates the store', async () => {
      const user = userEvent.setup();
      const opNode: WorkflowNode = {
        id: 'op1',
        kind: 'operation',
        requestMode: 'form',
        operationId: 'POST /orders',
        credentialId: null,
        fieldValues: {},
      };
      const presetsNode = makePresetsNode({
        presets: [
          { id: 'p1', kind: 'assert', checks: [{ id: 'c1', source: { type: 'response_body', sourceNodeId: '' }, operator: 'equals' }] },
        ],
      });
      useWorkflowStore.setState({
        nodes: [opNode, presetsNode],
        connections: [{ fromNodeId: 'op1', toNodeId: 'g1' }],
        selectedNodeId: 'g1',
        selectedPresetId: 'p1',
        operations: [
          {
            id: 'POST /orders',
            method: 'post',
            path: '/orders',
            parameters: [],
            requestBodySchema: null,
            requestBodyContentType: null,
            responseSchema: null,
          },
        ],
      });
      render(<NodeConfig />);

      const checksOf1 = () => asAssertPreset(asPresetsNode(useWorkflowStore.getState().nodes[1]).presets![0]).checks;

      await user.selectOptions(screen.getByLabelText('Check 1 source node'), 'op1');
      expect(checksOf1()[0].source.sourceNodeId).toBe('op1');

      await user.selectOptions(screen.getByLabelText('Check 1 source type'), 'response_status');
      expect(checksOf1()[0].source.type).toBe('response_status');

      await user.selectOptions(screen.getByLabelText('Check 1 operator'), 'greaterThan');
      expect(checksOf1()[0].operator).toBe('greaterThan');

      fireEvent.change(screen.getByLabelText('Check 1 expected value'), { target: { value: '199' } });
      expect(checksOf1()[0].expected).toBe('199');
    });

    it('shows the expected-value input for equals but hides it for exists', () => {
      const equalsPreset = makePresetsNode({
        presets: [
          { id: 'p1', kind: 'assert', checks: [{ id: 'c1', source: { type: 'response_body', sourceNodeId: '' }, operator: 'equals' }] },
        ],
      });
      useWorkflowStore.setState({ nodes: [equalsPreset], selectedNodeId: 'g1', selectedPresetId: 'p1' });
      const { unmount } = render(<NodeConfig />);
      expect(screen.getByLabelText('Check 1 expected value')).toBeInTheDocument();
      unmount();

      const existsPreset = makePresetsNode({
        presets: [
          { id: 'p1', kind: 'assert', checks: [{ id: 'c1', source: { type: 'response_body', sourceNodeId: '' }, operator: 'exists' }] },
        ],
      });
      useWorkflowStore.setState({ nodes: [existsPreset], selectedNodeId: 'g1', selectedPresetId: 'p1' });
      render(<NodeConfig />);
      expect(screen.queryByLabelText('Check 1 expected value')).not.toBeInTheDocument();
    });

    it('removes a check via its × button', async () => {
      const user = userEvent.setup();
      const presetsNode = makePresetsNode({
        presets: [
          {
            id: 'p1',
            kind: 'assert',
            checks: [{ id: 'c1', source: { type: 'response_body', sourceNodeId: '' }, operator: 'equals' }],
          },
        ],
      });
      useWorkflowStore.setState({ nodes: [presetsNode], selectedNodeId: 'g1', selectedPresetId: 'p1' });
      render(<NodeConfig />);

      await user.click(screen.getByRole('button', { name: 'Remove check 1' }));
      expect(asAssertPreset(asPresetsNode(useWorkflowStore.getState().nodes[0]).presets![0]).checks).toEqual([]);
    });
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
      requestBodyContentType: null,
      responseSchema: null,
    };
    useWorkflowStore.setState({
      nodes: [makeNode({ operationId: op.id })],
      operations: [op],
      selectedNodeId: 'node-1',
    });
    render(<NodeConfig />);

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
      requestBodyContentType: null,
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
    render(<NodeConfig />);

    expect(screen.getByRole('checkbox', { name: /Switch to Raw view/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Switch to Raw view/ }));

    await waitFor(() => {
      const state = asOperationNode(useWorkflowStore.getState().nodes[0]);
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
    render(<NodeConfig />);

    const lock = screen.getByRole('button', { name: 'Credential' });
    expect(lock).not.toHaveClass('node-config__cred-lock--set');
    await user.click(lock);
    await user.click(screen.getByRole('option', { name: 'staging' }));

    expect(useWorkflowStore.getState().nodes[0].credentialId).toBe('cred-1');
    expect(screen.getByRole('button', { name: 'Credential' })).toHaveClass('node-config__cred-lock--set');
  });

  describe('credential extra params', () => {
    const oauth2Credential = {
      id: 'cred-oauth2',
      name: 'staging-oauth2',
      type: 'oauth2_clientCredentials' as const,
      tokenUrl: 'http://auth.test/token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      clientAuthMethod: 'body' as const,
      extraTokenParams: { audience: 'api://default' },
    };

    it("doesn't render the section when no credential, or a non-oauth2 credential, is attached", () => {
      useWorkflowStore.setState({
        nodes: [makeNode({ credentialId: 'cred-bearer' })],
        selectedNodeId: 'node-1',
        credentials: [{ id: 'cred-bearer', name: 'bearer', type: 'bearer', token: 'x' }],
      });
      const { rerender } = render(<NodeConfig />);
      expect(screen.queryByRole('heading', { name: 'Credential extra params' })).not.toBeInTheDocument();

      useWorkflowStore.setState({ nodes: [makeNode({ credentialId: null })] });
      rerender(<NodeConfig />);
      expect(screen.queryByRole('heading', { name: 'Credential extra params' })).not.toBeInTheDocument();
    });

    it("doesn't render the section for an oauth2 credential with no extraTokenParams configured", () => {
      useWorkflowStore.setState({
        nodes: [makeNode({ credentialId: 'cred-oauth2' })],
        selectedNodeId: 'node-1',
        credentials: [{ ...oauth2Credential, extraTokenParams: undefined }],
      });
      render(<NodeConfig />);
      expect(screen.queryByRole('heading', { name: 'Credential extra params' })).not.toBeInTheDocument();
    });

    it('shows the toggle off by default, with no field rows', () => {
      useWorkflowStore.setState({
        nodes: [makeNode({ credentialId: 'cred-oauth2' })],
        selectedNodeId: 'node-1',
        credentials: [oauth2Credential],
      });
      render(<NodeConfig />);

      expect(screen.getByRole('heading', { name: 'Override credential extra params?' })).toBeInTheDocument();
      const toggle = screen.getByRole('checkbox', { name: 'Override credential extra params' });
      expect(toggle).not.toBeChecked();
      expect(screen.queryByText((_, el) => el?.tagName === 'LABEL' && el.textContent === 'audience')).not.toBeInTheDocument();
    });

    it("stays off, with no rows, even when the node's overrideMap already has data — a leftover override is inert until toggled on", () => {
      useWorkflowStore.setState({
        nodes: [
          makeNode({
            credentialId: 'cred-oauth2',
            credentialExtraParamOverrides: { audience: { source: 'static', value: 'api://leftover' } },
          }),
        ],
        selectedNodeId: 'node-1',
        credentials: [oauth2Credential],
      });
      render(<NodeConfig />);

      expect(screen.getByRole('checkbox', { name: 'Override credential extra params' })).not.toBeChecked();
      expect(screen.queryByText((_, el) => el?.tagName === 'LABEL' && el.textContent === 'audience')).not.toBeInTheDocument();
    });

    it('turning the toggle on reveals one row per extraTokenParams key, defaulting to "Default"', async () => {
      const user = userEvent.setup();
      useWorkflowStore.setState({
        nodes: [makeNode({ credentialId: 'cred-oauth2' })],
        selectedNodeId: 'node-1',
        credentials: [oauth2Credential],
      });
      render(<NodeConfig />);

      await user.click(screen.getByRole('checkbox', { name: 'Override credential extra params' }));

      expect(asOperationNode(useWorkflowStore.getState().nodes[0]).credentialExtraParamOverridesEnabled).toBe(true);
      const row = fieldRow('audience');
      expect(row.getByRole('combobox', { name: 'Source for extra param audience' })).toHaveValue('default');
    });

    it('switching a row to Mapped defaults to the first ancestor with no response field selected, and stores it', async () => {
      const user = userEvent.setup();
      useWorkflowStore.setState({
        nodes: [
          makeNode({ id: 'a', operationId: 'GET /pet/{petId}', credentialId: null }),
          makeNode({ id: 'node-1', credentialId: 'cred-oauth2', credentialExtraParamOverridesEnabled: true }),
        ],
        connections: [{ fromNodeId: 'a', toNodeId: 'node-1' }],
        selectedNodeId: 'node-1',
        credentials: [oauth2Credential],
      });
      render(<NodeConfig />);

      const row = fieldRow('audience');
      await user.selectOptions(row.getByRole('combobox', { name: 'Source for extra param audience' }), 'mapped');

      expect(asOperationNode(useWorkflowStore.getState().nodes[1]).credentialExtraParamOverrides).toEqual({
        audience: { source: 'mapped', fromNodeId: 'a', fromResponseFieldPath: '' },
      });

      await user.selectOptions(screen.getByRole('combobox', { name: 'Map extra param audience from response field' }), 'name');
      expect(asOperationNode(useWorkflowStore.getState().nodes[1]).credentialExtraParamOverrides).toEqual({
        audience: { source: 'mapped', fromNodeId: 'a', fromResponseFieldPath: 'name' },
      });
    });

    it('disables the Mapped option with no ancestor node to map from', () => {
      useWorkflowStore.setState({
        nodes: [makeNode({ credentialId: 'cred-oauth2', credentialExtraParamOverridesEnabled: true })],
        selectedNodeId: 'node-1',
        credentials: [oauth2Credential],
      });
      render(<NodeConfig />);

      const row = fieldRow('audience');
      expect(row.getByRole('option', { name: 'Mapped' })).toBeDisabled();
    });

    it('switching a row to Static shows a text input and stores what is typed', async () => {
      const user = userEvent.setup();
      useWorkflowStore.setState({
        nodes: [makeNode({ credentialId: 'cred-oauth2', credentialExtraParamOverridesEnabled: true })],
        selectedNodeId: 'node-1',
        credentials: [oauth2Credential],
      });
      render(<NodeConfig />);

      const row = fieldRow('audience');
      await user.selectOptions(row.getByRole('combobox', { name: 'Source for extra param audience' }), 'static');
      await user.type(screen.getByRole('textbox', { name: 'Static value for extra param audience' }), 'api://custom');

      expect(asOperationNode(useWorkflowStore.getState().nodes[0]).credentialExtraParamOverrides).toEqual({
        audience: { source: 'static', value: 'api://custom' },
      });
    });

    it('switching a row back to Default clears the override entirely', async () => {
      const user = userEvent.setup();
      useWorkflowStore.setState({
        nodes: [
          makeNode({
            credentialId: 'cred-oauth2',
            credentialExtraParamOverridesEnabled: true,
            credentialExtraParamOverrides: { audience: { source: 'static', value: 'api://custom' } },
          }),
        ],
        selectedNodeId: 'node-1',
        credentials: [oauth2Credential],
      });
      render(<NodeConfig />);

      const row = fieldRow('audience');
      await user.selectOptions(row.getByRole('combobox', { name: 'Source for extra param audience' }), 'default');

      expect(asOperationNode(useWorkflowStore.getState().nodes[0]).credentialExtraParamOverrides).toEqual({});
    });

    it('turning the toggle back off hides the rows without clearing the stored overrides', async () => {
      const user = userEvent.setup();
      useWorkflowStore.setState({
        nodes: [
          makeNode({
            credentialId: 'cred-oauth2',
            credentialExtraParamOverridesEnabled: true,
            credentialExtraParamOverrides: { audience: { source: 'static', value: 'api://custom' } },
          }),
        ],
        selectedNodeId: 'node-1',
        credentials: [oauth2Credential],
      });
      render(<NodeConfig />);

      await user.click(screen.getByRole('checkbox', { name: 'Override credential extra params' }));

      expect(asOperationNode(useWorkflowStore.getState().nodes[0]).credentialExtraParamOverridesEnabled).toBe(false);
      expect(asOperationNode(useWorkflowStore.getState().nodes[0]).credentialExtraParamOverrides).toEqual({
        audience: { source: 'static', value: 'api://custom' },
      });
      expect(screen.queryByText((_, el) => el?.tagName === 'LABEL' && el.textContent === 'audience')).not.toBeInTheDocument();
    });
  });

  it('coerces a static integer field to a real number in the store', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1' });
    render(<NodeConfig />);

    const input = fieldRow('body.qty').getByRole('textbox');
    await user.type(input, '3');

    expect(useWorkflowStore.getState().nodes[0].fieldValues['body.qty']).toEqual({ source: 'static', value: 3 });
  });

  it('renders an enum field as a dropdown and stores the selected value', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1' });
    render(<NodeConfig />);

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
    render(<NodeConfig />);

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
    render(<NodeConfig />);

    // category.id / category.name appear directly — no disabled "body.category" row.
    expect(fieldRow('body.category.id')).toBeTruthy();
    expect(fieldRow('body.category.name')).toBeTruthy();
    expect(screen.queryByText((_, el) => el?.tagName === 'LABEL' && el.textContent === 'body.category')).not.toBeInTheDocument();
  });

  it('marks a genuinely unrecognized schema shape as unsupported and disables its controls', () => {
    useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1' });
    render(<NodeConfig />);

    const row = fieldRow('body.weird');
    expect(row.getByText(/\(unsupported\)/)).toBeInTheDocument();
    expect(row.getByRole('textbox')).toBeDisabled();
  });

  it('shows the connect-a-node hint when there are no ancestors, hides it once connected', () => {
    useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1' });
    const { rerender } = render(<NodeConfig />);
    expect(screen.getByText(/Connect this node from another/)).toBeInTheDocument();

    useWorkflowStore.setState({
      nodes: [makeNode(), makeNode({ id: 'node-2', operationId: 'GET /pet/{petId}' })],
      connections: [{ fromNodeId: 'node-2', toNodeId: 'node-1' }],
    });
    rerender(<NodeConfig />);
    expect(screen.queryByText(/Connect this node from another/)).not.toBeInTheDocument();
  });

  it('maps a field from a connected ancestor\'s compatible response field', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      nodes: [makeNode(), makeNode({ id: 'node-2', operationId: 'GET /pet/{petId}' })],
      connections: [{ fromNodeId: 'node-2', toNodeId: 'node-1' }],
      selectedNodeId: 'node-1',
    });
    render(<NodeConfig />);

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
    render(<NodeConfig />);

    // body.name is a string — GET /pet/{petId}'s response `tags` is an
    // array. An array source is only ever wired into an array-typed target
    // (see flattenSchema.ts's flattenObjectSchema doc), so against a string
    // target it's disabled with a Raw-mode-specific reason, not the generic
    // "type mismatch" wording another kind of mismatch gets below.
    const row = fieldRow('body.name');
    const [sourceKindSelect] = row.getAllByRole('combobox');
    await user.selectOptions(sourceKindSelect, 'mapped');
    const [, , fieldSelect] = row.getAllByRole('combobox');
    const tagsOption = fieldSelect.querySelector('option[value="tags"]')!;

    expect(tagsOption).toHaveTextContent('(array — use Raw mode)');
    expect(tagsOption).toBeDisabled();
    expect(tagsOption).toHaveAttribute('title', expect.stringContaining('Raw mode'));

    const idOption = within(fieldSelect).getByText(/^id/);
    expect(idOption).toBeDisabled(); // integer vs string target — also incompatible

    const nameOption = within(fieldSelect).getByText('name');
    expect(nameOption).not.toBeDisabled();
  });

  it('allows a straight array-to-array mapping when both sides are array-typed', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      nodes: [makeNode(), makeNode({ id: 'node-2', operationId: 'GET /pet/{petId}' })],
      connections: [{ fromNodeId: 'node-2', toNodeId: 'node-1' }],
      selectedNodeId: 'node-1',
    });
    render(<NodeConfig />);

    // body.photoUrls is an array of strings — so is GET /pet/{petId}'s
    // response `tags`. A whole-array copy is fine here; only a mismatched
    // (non-array) target should be pushed toward Raw mode (see above).
    const row = fieldRow('body.photoUrls');
    const [sourceKindSelect] = row.getAllByRole('combobox');
    await user.selectOptions(sourceKindSelect, 'mapped');
    const [, , fieldSelect] = row.getAllByRole('combobox');
    const tagsOption = fieldSelect.querySelector('option[value="tags"]')!;

    expect(tagsOption).not.toBeDisabled();
    expect(tagsOption).not.toHaveTextContent('Raw mode');
  });

  it('still offers the array\'s 0th item as its own scalar field, enabled when its type matches the target', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      nodes: [makeNode(), makeNode({ id: 'node-2', operationId: 'GET /pet/{petId}' })],
      connections: [{ fromNodeId: 'node-2', toNodeId: 'node-1' }],
      selectedNodeId: 'node-1',
    });
    render(<NodeConfig />);

    // body.name is a string — GET /pet/{petId}'s response `tags[0]` (the
    // array's first item) is a string too, so this is a plain, enabled
    // scalar mapping, same as `id`/`name` below it — not everything array-
    // adjacent needs Raw mode, just going past index 0 does.
    const row = fieldRow('body.name');
    const [sourceKindSelect] = row.getAllByRole('combobox');
    await user.selectOptions(sourceKindSelect, 'mapped');
    const [, , fieldSelect] = row.getAllByRole('combobox');
    const firstTagOption = fieldSelect.querySelector('option[value="tags[0]"]')!;

    expect(firstTagOption).toBeTruthy();
    expect(firstTagOption).not.toBeDisabled();
  });

  describe('Raw JSON body mode', () => {
    it('suggests Raw JSON via a banner when the body has a shape the form can\'t fully represent', () => {
      // petOperation's `weird` field is a oneOf — see the fixture above.
      useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1' });
      render(<NodeConfig />);
      expect(screen.getByText(/shape the form can't fully represent/)).toBeInTheDocument();
    });

    it('does not show the banner for a body the form can fully represent', () => {
      const plainOperation: Operation = {
        id: 'POST /plain',
        method: 'post',
        path: '/plain',
        parameters: [],
        requestBodySchema: { type: 'object', properties: { name: { type: 'string' } } },
        requestBodyContentType: 'application/json',
        responseSchema: null,
      };
      useWorkflowStore.setState({
        nodes: [makeNode({ operationId: 'POST /plain' })],
        operations: [petOperation, getPetOperation, plainOperation],
        selectedNodeId: 'node-1',
      });
      render(<NodeConfig />);
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
        requestBodyContentType: 'application/json',
        responseSchema: null,
      };
      useWorkflowStore.setState({
        nodes: [
          makeNode({ operationId: 'POST /plain', fieldValues: { 'body.name': { source: 'static', value: 'fido' } } }),
        ],
        operations: [petOperation, getPetOperation, plainOperation],
        selectedNodeId: 'node-1',
      });
      render(<NodeConfig />);

      const modeSwitch = screen.getByRole('checkbox');
      fireEvent.click(modeSwitch);

      const rawBody = () => asOperationNode(useWorkflowStore.getState().nodes[0]).rawBody;
      await waitFor(() => expect(rawBody()).toBeTruthy());
      expect(JSON.parse(rawBody()!.template).name).toBe('fido');
      expect(asOperationNode(useWorkflowStore.getState().nodes[0]).requestMode).toBe('raw');

      fireEvent.click(modeSwitch);
      expect(asOperationNode(useWorkflowStore.getState().nodes[0]).requestMode).toBe('form');
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
        requestBodyContentType: 'application/json',
        responseSchema: null,
      };
      useWorkflowStore.setState({
        nodes: [
          makeNode({ operationId: 'POST /plain', fieldValues: { 'body.name': { source: 'static', value: 'fido' } } }),
        ],
        operations: [petOperation, getPetOperation, plainOperation],
        selectedNodeId: 'node-1',
      });
      render(<NodeConfig />);
      const modeSwitch = screen.getByRole('checkbox');

      // Form -> Raw: seeded with "fido".
      fireEvent.click(modeSwitch);
      const rawBody = () => asOperationNode(useWorkflowStore.getState().nodes[0]).rawBody;
      await waitFor(() => expect(rawBody()).toBeTruthy());
      expect(JSON.parse(rawBody()!.template).name).toBe('fido');

      // Emptied out directly in Raw mode (as if the user cleared the JSON by hand).
      useWorkflowStore.setState((state) => ({
        nodes: state.nodes.map((n) => (n.id === 'node-1' && n.kind !== 'presets' ? { ...n, rawBody: { template: '{}', tags: {} } } : n)),
      }));

      // Raw -> Form: not lossy (an empty object round-trips through one static-undefined field), so no confirm needed.
      fireEvent.click(modeSwitch);
      expect(asOperationNode(useWorkflowStore.getState().nodes[0]).requestMode).toBe('form');

      // Edit the now-empty field in Form mode.
      fireEvent.change(fieldRow('body.name').getByRole('textbox'), { target: { value: 'rex' } });
      expect(useWorkflowStore.getState().nodes[0].fieldValues['body.name']).toEqual({ source: 'static', value: 'rex' });

      // Form -> Raw again: must reflect "rex", not the stale cached "{}".
      fireEvent.click(modeSwitch);
      await waitFor(() => expect(JSON.parse(rawBody()!.template).name).toBe('rex'));
    });

    it('warns before converting back to Form when the Raw JSON has structure the form would lose, and only converts on confirm', async () => {
      useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1' });
      render(<NodeConfig />);

      const modeSwitch = screen.getByRole('checkbox');
      fireEvent.click(modeSwitch);
      await waitFor(() => expect(asOperationNode(useWorkflowStore.getState().nodes[0]).rawBody).toBeTruthy());

      // Inject an extra top-level key the flat form has no field for.
      useWorkflowStore.setState((state) => ({
        nodes: state.nodes.map((n) =>
          n.id === 'node-1' && n.kind !== 'presets'
            ? { ...n, rawBody: { ...n.rawBody!, template: n.rawBody!.template.replace('{', '{"surprise":1,') } }
            : n
        ),
      }));

      fireEvent.click(modeSwitch);
      expect(screen.getByText(/Switching to Form view may lose custom JSON structure/)).toBeInTheDocument();
      expect(asOperationNode(useWorkflowStore.getState().nodes[0]).requestMode).toBe('raw'); // not switched yet

      fireEvent.click(screen.getByText('Switch anyway'));
      expect(asOperationNode(useWorkflowStore.getState().nodes[0]).requestMode).toBe('form');
    });
  });

  describe('locked while a run is in progress', () => {
    it('shows a banner and disables every field/credential control via the fieldset', () => {
      useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1', isRunning: true });
      render(<NodeConfig />);

      expect(screen.getByText('Workflow is running — editing is locked until it finishes.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Credential' })).toBeDisabled();
      expect(fieldRow('body.qty').getByRole('textbox')).toBeDisabled();
    });

    it("doesn't show the banner or disable anything when not running", () => {
      useWorkflowStore.setState({ nodes: [makeNode()], selectedNodeId: 'node-1', isRunning: false });
      render(<NodeConfig />);

      expect(screen.queryByText(/editing is locked/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Credential' })).not.toBeDisabled();
    });
  });

  describe('multipart file upload', () => {
    const productOp: Operation = {
      id: 'POST /products',
      method: 'post',
      path: '/products',
      parameters: [],
      requestBodySchema: {
        type: 'object',
        required: ['name', 'price'],
        properties: {
          name: { type: 'string' },
          price: { type: 'number' },
          image: { type: 'string', format: 'binary' },
        },
      },
      requestBodyContentType: 'multipart/form-data',
      responseSchema: null,
    };

    it('renders a file picker for format: binary — the Form/Raw toggle is available too (Raw mode can hold a file field via an uploaded_file tag)', async () => {
      const user = userEvent.setup();
      useWorkflowStore.setState({
        nodes: [makeNode({ operationId: productOp.id })],
        operations: [productOp],
        selectedNodeId: 'node-1',
        uploadedFiles: {},
      });
      render(<NodeConfig />);

      expect(screen.getByRole('checkbox', { name: /Switch to Raw view/ })).toBeInTheDocument();
      expect(screen.getByText(/body\.image.*\(file\)/)).toBeInTheDocument();
      expect(fieldRow('body.image').getByLabelText('body.image')).toHaveAttribute('type', 'file');
      expect(fieldRow('body.name').getByRole('textbox')).toBeInTheDocument();

      const file = new File(['hello'], 'gadget.png', { type: 'image/png' });
      await user.upload(fieldRow('body.image').getByLabelText('body.image'), file);

      expect(useWorkflowStore.getState().nodes[0].fieldValues['body.image']).toEqual({
        source: 'file',
        fileName: 'gadget.png',
      });
      expect(useWorkflowStore.getState().uploadedFiles['node-1::body.image']).toBe(file);
      expect(screen.getByText('gadget.png')).toBeInTheDocument();
      // Native choose-file chrome is gone; clear is an icon button in the drop.
      expect(screen.queryByText('Clear')).not.toBeInTheDocument();
      expect(fieldRow('body.image').getByRole('button', { name: 'Clear body.image' })).toBeInTheDocument();

      await user.click(fieldRow('body.image').getByRole('button', { name: 'Clear body.image' }));
      expect(useWorkflowStore.getState().nodes[0].fieldValues['body.image']).toBeUndefined();
      expect(screen.queryByText('gadget.png')).not.toBeInTheDocument();
      expect(fieldRow('body.image').getByLabelText('body.image')).toHaveAttribute('type', 'file');
    });

    it('switching to Raw turns a set file field into an uploaded_file tag and copies the File across; switching back restores the Form file field', async () => {
      const user = userEvent.setup();
      const file = new File(['hello'], 'gadget.png', { type: 'image/png' });
      useWorkflowStore.setState({
        nodes: [
          makeNode({
            operationId: productOp.id,
            fieldValues: {
              'body.name': { source: 'static', value: 'Gadget' },
              'body.image': { source: 'file', fileName: 'gadget.png' },
            },
          }),
        ],
        operations: [productOp],
        selectedNodeId: 'node-1',
        uploadedFiles: { 'node-1::body.image': file },
      });
      render(<NodeConfig />);

      await user.click(screen.getByRole('checkbox', { name: /Switch to Raw view/ }));

      let tagId = '';
      await waitFor(() => {
        const state = asOperationNode(useWorkflowStore.getState().nodes[0]);
        expect(state.requestMode).toBe('raw');
        const parsed = JSON.parse(state.rawBody!.template);
        tagId = parsed.image.match(/\{\{enlace:(.+)\}\}/)![1];
        expect(state.rawBody!.tags[tagId]).toEqual({ id: tagId, type: 'uploaded_file', fileName: 'gadget.png' });
      });
      // The File blob followed the field to its new tag-keyed slot — not
      // just the fileName marker (see bodyTags.ts's rawFileTagFieldPath).
      expect(useWorkflowStore.getState().uploadedFiles[`node-1::body:tag:${tagId}`]).toBe(file);

      await user.click(screen.getByRole('checkbox', { name: /Switch to Form view/ }));

      await waitFor(() => {
        const state = asOperationNode(useWorkflowStore.getState().nodes[0]);
        expect(state.requestMode).toBe('form');
        expect(state.fieldValues['body.image']).toEqual({ source: 'file', fileName: 'gadget.png' });
      });
      // ...and followed it back to the field's own key on the way home.
      expect(useWorkflowStore.getState().uploadedFiles['node-1::body.image']).toBe(file);
    });
  });
});
