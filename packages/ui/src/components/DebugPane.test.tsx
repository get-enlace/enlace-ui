import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DebugPane } from './DebugPane.js';
import { useWorkflowStore } from '../store/workflowStore.js';
import type { RunStep } from '../types.js';

function makeStep(overrides: Partial<RunStep> = {}): RunStep {
  return {
    nodeId: 'node-1',
    request: {
      method: 'POST',
      url: 'http://localhost:4000/pet',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer super-secret-token' },
      body: { name: 'Rex' },
      credentials: 'omit',
    },
    response: { status: 200, headers: {}, body: { id: 1, name: 'Rex' } },
    timestampStart: '2026-01-01T00:00:00.000Z',
    timestampEnd: '2026-01-01T00:00:01.000Z',
    ...overrides,
  };
}

const petOp = {
  id: 'POST /pet',
  method: 'post' as const,
  path: '/pet',
  parameters: [],
  requestBodySchema: null,
  responseSchema: null,
};

describe('DebugPane (Results)', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      runResult: null,
      isRunning: false,
      isDebugRun: false,
      error: null,
      nodes: [],
      connections: [],
      operations: [],
      stepStatusByNodeId: {},
      armedBreakpoints: new Set(),
      previewRequestByNodeId: {},
      activeControl: null,
      selectedNodeId: null,
      debugConsoleOpen: false,
    });
  });

  it('shows Results title and a placeholder before any run', () => {
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);
    expect(screen.getByText('Results')).toBeInTheDocument();
    expect(screen.getByText(/Run the workflow to see each step/)).toBeInTheDocument();
  });

  it('splits Console beside Results when debugConsoleOpen', () => {
    useWorkflowStore.setState({ debugConsoleOpen: true });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);
    expect(screen.getByText('Debug')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Console query' })).toBeInTheDocument();
    expect(screen.queryByText('Console')).not.toBeInTheDocument();
  });

  it('shows "Running…" while a run is in flight', () => {
    useWorkflowStore.setState({ isRunning: true });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);
    expect(screen.getByText('Running…')).toBeInTheDocument();
  });

  it('shows the run-level error message when one is set', () => {
    useWorkflowStore.setState({
      error: 'Could not determine a target base URL — add a `servers` entry to the OpenAPI spec.',
    });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);
    expect(screen.getByText(/Could not determine a target base URL/)).toBeInTheDocument();
  });

  it('redacts the Authorization header in the request panels', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      nodes: [{ id: 'node-1', operationId: 'POST /pet', credentialId: null, fieldValues: {} }],
      operations: [petOp],
      runResult: {
        steps: [
          makeStep({
            request: {
              ...makeStep().request,
              headers: { 'content-type': 'application/json', authorization: 'Bearer super-secret-token' },
            },
          }),
        ],
      },
      stepStatusByNodeId: { 'node-1': 'completed' },
    });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);
    await user.click(screen.getByText('POST /pet'));

    const dump = document.querySelector('.debugger-row')!.textContent!;
    expect(dump).not.toContain('super-secret-token');
    expect(dump).toContain('[redacted]');
    expect(dump).toContain('application/json');
  });

  it('redacts an apiKey-in-query credential value in the request panel URL', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      nodes: [{ id: 'node-1', operationId: 'POST /pet', credentialId: null, fieldValues: {} }],
      operations: [petOp],
      runResult: {
        steps: [
          makeStep({
            request: {
              method: 'GET',
              url: 'http://localhost:4000/pet?apiKey=super-secret-key&limit=10',
              headers: { 'Content-Type': 'application/json' },
              redactQueryParams: ['apiKey'],
              credentials: 'omit',
            },
          }),
        ],
      },
      stepStatusByNodeId: { 'node-1': 'completed' },
    });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);
    await user.click(screen.getByText('POST /pet'));

    expect(screen.getByText('http://localhost:4000/pet?apiKey=%5Bredacted%5D&limit=10')).toBeInTheDocument();
    const dump = document.querySelector('.debugger-row')!.textContent!;
    expect(dump).not.toContain('super-secret-key');
    expect(dump).toContain('limit=10');
  });

  it('summarizes each step with the canvas node label, including #N for duplicates', () => {
    useWorkflowStore.setState({
      nodes: [
        { id: 'node-1', operationId: 'POST /pet', credentialId: null, fieldValues: {} },
        { id: 'node-2', operationId: 'POST /pet', credentialId: null, fieldValues: {} },
      ],
      operations: [petOp],
      runResult: { steps: [makeStep(), makeStep({ nodeId: 'node-2' })] },
      stepStatusByNodeId: { 'node-1': 'completed', 'node-2': 'completed' },
    });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);

    expect(screen.getByText('POST /pet #1')).toBeInTheDocument();
    expect(screen.getByText('POST /pet #2')).toBeInTheDocument();
    expect(document.querySelector('.debugger-row__summary')!.textContent).not.toContain('http://localhost:4000/pet');
  });

  it('shows request and response bodies in expand panels', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      nodes: [{ id: 'node-1', operationId: 'POST /pet', credentialId: null, fieldValues: {} }],
      operations: [petOp],
      runResult: { steps: [makeStep()] },
      stepStatusByNodeId: { 'node-1': 'completed' },
    });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);
    await user.click(screen.getByText('POST /pet'));

    const [requestBody, responseBody] = document.querySelectorAll('.debug-body__pre');
    expect(requestBody.textContent).toContain('"name": "Rex"');
    expect(responseBody.textContent).toContain('"id": 1');
  });

  it('shows a credentials: include chip on the request panel', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      nodes: [{ id: 'node-1', operationId: 'POST /pet', credentialId: null, fieldValues: {} }],
      operations: [petOp],
      runResult: { steps: [makeStep({ request: { ...makeStep().request, credentials: 'include' } })] },
      stepStatusByNodeId: { 'node-1': 'completed' },
    });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);
    await user.click(screen.getByText('POST /pet'));

    expect(screen.getByText('credentials: include')).toBeInTheDocument();
  });

  it('shows a status summary and status badges', () => {
    useWorkflowStore.setState({
      nodes: [
        { id: 'node-1', operationId: 'POST /pet', credentialId: null, fieldValues: {} },
        { id: 'node-2', operationId: 'POST /pet', credentialId: null, fieldValues: {} },
      ],
      operations: [petOp],
      runResult: { steps: [makeStep(), makeStep({ nodeId: 'node-2' })] },
      stepStatusByNodeId: { 'node-1': 'completed', 'node-2': 'completed' },
    });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);

    expect(screen.getByText('2 ✓')).toBeInTheDocument();
    expect(document.querySelectorAll('.debugger-row__summary .status-badge--ok')).toHaveLength(2);
  });

  it('shows ERROR status and the error message for a failed step', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      nodes: [{ id: 'node-1', operationId: 'POST /pet', credentialId: null, fieldValues: {} }],
      operations: [petOp],
      runResult: { steps: [makeStep({ response: undefined, error: 'Network request failed' })] },
      stepStatusByNodeId: { 'node-1': 'failed' },
    });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);

    expect(screen.getByText('ERROR')).toBeInTheDocument();
    await user.click(screen.getByText('POST /pet'));
    expect(screen.getAllByText('Network request failed').length).toBeGreaterThanOrEqual(2);
  });

  it('hides the body when collapsed', () => {
    useWorkflowStore.setState({
      nodes: [{ id: 'node-1', operationId: 'POST /pet', credentialId: null, fieldValues: {} }],
      operations: [petOp],
      runResult: { steps: [makeStep()] },
      stepStatusByNodeId: { 'node-1': 'completed' },
    });
    render(<DebugPane collapsed={true} onToggleCollapsed={() => {}} />);

    expect(screen.getByText('1 ✓')).toBeInTheDocument();
    expect(screen.queryByText('POST /pet')).not.toBeInTheDocument();
  });

  it('calls onToggleCollapsed when the header button is clicked', async () => {
    const user = userEvent.setup();
    let collapsed = false;
    const onToggleCollapsed = () => {
      collapsed = !collapsed;
    };
    render(<DebugPane collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />);

    await user.click(screen.getByRole('button', { name: 'Hide results' }));
    expect(collapsed).toBe(true);
  });

  it('does not list canvas nodes as pending before any run', () => {
    useWorkflowStore.setState({
      nodes: [
        { id: 'node-1', operationId: 'POST /pet', credentialId: null, fieldValues: {} },
        { id: 'node-2', operationId: 'POST /pet', credentialId: null, fieldValues: {} },
      ],
      operations: [petOp],
    });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);
    expect(screen.getByText(/Run the workflow to see each step/)).toBeInTheDocument();
    expect(document.querySelector('.debugger-row')).toBeNull();
  });

  it('clears results when Clear is clicked', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      nodes: [{ id: 'node-1', operationId: 'POST /pet', credentialId: null, fieldValues: {} }],
      operations: [petOp],
      runResult: { steps: [makeStep()] },
      stepStatusByNodeId: { 'node-1': 'completed' },
    });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);
    expect(document.querySelector('.debugger-row')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(useWorkflowStore.getState().runResult).toEqual({ steps: [makeStep()] });
    expect(useWorkflowStore.getState().stepStatusByNodeId).toEqual({});
    expect(document.querySelector('.debugger-row')).toBeNull();
    expect(screen.getByText(/Run the workflow to see each step/)).toBeInTheDocument();
  });

  it('shows a pause bar with Step targeting the paused node', async () => {
    const user = userEvent.setup();
    const stepNode = vi.fn();
    useWorkflowStore.setState({
      nodes: [{ id: 'a', operationId: 'GET /a', credentialId: null, fieldValues: {} }],
      connections: [],
      operations: [
        { id: 'GET /a', method: 'get', path: '/a', parameters: [], requestBodySchema: null, responseSchema: null },
      ],
      stepStatusByNodeId: { a: 'paused' },
      previewRequestByNodeId: {
        a: { method: 'GET', url: 'http://localhost:4000/a', headers: {}, credentials: 'omit' },
      },
      stepNode,
      isDebugRun: true,
    });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);

    expect(screen.getByText(/Paused at/)).toBeInTheDocument();
    expect(screen.getByText('Preview — resolved, not yet sent')).toBeInTheDocument();
    expect(document.querySelector('.debug-step__panels')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Step' }));
    expect(stepNode).toHaveBeenCalledWith('a');
  });

  it('lists every node with live status once the canvas has steps', () => {
    useWorkflowStore.setState({
      nodes: [
        { id: 'a', operationId: 'GET /a', credentialId: null, fieldValues: {} },
        { id: 'b', operationId: 'GET /b', credentialId: null, fieldValues: {} },
      ],
      connections: [{ fromNodeId: 'a', toNodeId: 'b' }],
      operations: [
        { id: 'GET /a', method: 'get', path: '/a', parameters: [], requestBodySchema: null, responseSchema: null },
        { id: 'GET /b', method: 'get', path: '/b', parameters: [], requestBodySchema: null, responseSchema: null },
      ],
      stepStatusByNodeId: { a: 'completed', b: 'paused' },
    });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);

    expect(screen.getByText('1 ⏸ · 1 ✓')).toBeInTheDocument();
    expect(screen.getByTitle('1 paused · 1 completed')).toBeInTheDocument();
    expect(screen.getByText('GET /a')).toBeInTheDocument();
    expect(screen.getAllByText('GET /b').length).toBeGreaterThanOrEqual(1);
  });
});
