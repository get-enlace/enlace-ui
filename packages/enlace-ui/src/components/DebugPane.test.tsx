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
    },
    response: { status: 200, headers: {}, body: { id: 1, name: 'Rex' } },
    timestampStart: '2026-01-01T00:00:00.000Z',
    timestampEnd: '2026-01-01T00:00:01.000Z',
    ...overrides,
  };
}

describe('DebugPane', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      runResult: null,
      isRunning: false,
      error: null,
      nodes: [],
      connections: [],
      operations: [],
      stepStatusByNodeId: {},
      armedBreakpoints: new Set(),
      previewRequestByNodeId: {},
      activeControl: null,
    });
  });

  it('shows a placeholder before any run', () => {
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);
    expect(screen.getByText(/Run the workflow to see each step/)).toBeInTheDocument();
  });

  it('shows "Running…" while a run is in flight', () => {
    useWorkflowStore.setState({ isRunning: true });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);
    expect(screen.getByText('Running…')).toBeInTheDocument();
  });

  it('shows the run-level error message when one is set', () => {
    useWorkflowStore.setState({ error: 'Could not determine a target base URL — add a `servers` entry to the OpenAPI spec.' });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);
    expect(screen.getByText(/Could not determine a target base URL/)).toBeInTheDocument();
  });

  it('redacts the Authorization header in the request headers table, case-insensitively, without touching other headers', () => {
    useWorkflowStore.setState({
      runResult: {
        steps: [makeStep({ request: { ...makeStep().request, headers: { 'content-type': 'application/json', authorization: 'Bearer super-secret-token' } } })],
      },
    });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);

    const dump = document.querySelector('.debug-step')!.textContent!;
    expect(dump).not.toContain('super-secret-token');
    expect(dump).toContain('[redacted]');
    expect(dump).toContain('application/json'); // non-auth headers pass through untouched
  });

  it('redacts an apiKey-in-query credential value in both the summary URL and the request panel', () => {
    useWorkflowStore.setState({
      runResult: {
        steps: [
          makeStep({
            request: {
              method: 'GET',
              url: 'http://localhost:4000/pet?apiKey=super-secret-key&limit=10',
              headers: { 'Content-Type': 'application/json' },
              redactQueryParams: ['apiKey'],
            },
          }),
        ],
      },
    });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);

    expect(screen.getByText('http://localhost:4000/pet?apiKey=%5Bredacted%5D&limit=10')).toBeInTheDocument();

    const dump = document.querySelector('.debug-step')!.textContent!;
    expect(dump).not.toContain('super-secret-key');
    expect(dump).toContain('limit=10'); // non-secret query params pass through untouched
  });

  it('shows the request and response bodies immediately, without needing to open a headers toggle', () => {
    useWorkflowStore.setState({ runResult: { steps: [makeStep()] } });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);

    const [requestBody, responseBody] = document.querySelectorAll('.debug-body__pre');
    expect(requestBody.textContent).toContain('"name": "Rex"');
    expect(responseBody.textContent).toContain('"id": 1');
  });

  it('shows a credentials: include chip on the request panel for cookie-based steps', () => {
    useWorkflowStore.setState({
      runResult: { steps: [makeStep({ request: { ...makeStep().request, credentials: 'include' } })] },
    });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);

    expect(screen.getByText('credentials: include')).toBeInTheDocument();
  });

  it('shows the step count and a status badge per step', () => {
    useWorkflowStore.setState({ runResult: { steps: [makeStep(), makeStep({ nodeId: 'node-2' })] } });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);

    expect(screen.getByText('2 call(s)')).toBeInTheDocument();
    // One "200" badge per step in the summary row, plus one in each step's opened Response panel.
    expect(document.querySelectorAll('.debug-step__summary .status-badge--ok')).toHaveLength(2);
  });

  it('shows ERROR status and the error message for a failed step', () => {
    useWorkflowStore.setState({
      runResult: { steps: [makeStep({ response: undefined, error: 'Network request failed' })] },
    });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);

    expect(screen.getByText('ERROR')).toBeInTheDocument();
    // Shown twice on purpose: once in the collapsed summary, once in the Response panel in place
    // of a body, so the reason for "no response" is visible without opening anything further.
    expect(screen.getAllByText('Network request failed')).toHaveLength(2);
  });

  it('hides the body (but not the header/count) when collapsed', () => {
    useWorkflowStore.setState({ runResult: { steps: [makeStep()] } });
    render(<DebugPane collapsed={true} onToggleCollapsed={() => {}} />);

    expect(screen.getByText('1 call(s)')).toBeInTheDocument();
    expect(screen.queryByText('POST')).not.toBeInTheDocument();
  });

  it('calls onToggleCollapsed when the header button is clicked', async () => {
    const user = userEvent.setup();
    let collapsed = false;
    const onToggleCollapsed = () => {
      collapsed = !collapsed;
    };
    render(<DebugPane collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />);

    await user.click(screen.getByRole('button', { name: 'Hide run output' }));
    expect(collapsed).toBe(true);
  });

  it('starts on the Run output tab, and stays there for anyone not using breakpoints', () => {
    useWorkflowStore.setState({ runResult: { steps: [makeStep()] } });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);

    expect(screen.getByRole('tab', { name: 'Run output' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('POST')).toBeInTheDocument();
  });

  describe('Debugger tab', () => {
    it('shows a hint instead of rows when no breakpoint is armed', async () => {
      const user = userEvent.setup();
      render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);

      await user.click(screen.getByRole('tab', { name: 'Debugger' }));
      expect(screen.getByText('Arm a breakpoint on a connector to start debugging.')).toBeInTheDocument();
    });

    it('shows an aggregate status breakdown and a row per node once a breakpoint is armed', async () => {
      const user = userEvent.setup();
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
        armedBreakpoints: new Set(['a->b']),
        stepStatusByNodeId: { a: 'completed', b: 'paused' },
      });
      render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);

      await user.click(screen.getByRole('tab', { name: 'Debugger' }));

      expect(screen.getByText('1 paused · 1 completed')).toBeInTheDocument();
      expect(screen.getByText('/a')).toBeInTheDocument();
      expect(screen.getByText('/b')).toBeInTheDocument();
    });

    it("expands a paused row into a unified 'preview' JSON block, distinct from Run Output's split panels", async () => {
      const user = userEvent.setup();
      useWorkflowStore.setState({
        nodes: [{ id: 'a', operationId: 'GET /a', credentialId: null, fieldValues: {} }],
        connections: [],
        operations: [
          { id: 'GET /a', method: 'get', path: '/a', parameters: [], requestBodySchema: null, responseSchema: null },
        ],
        armedBreakpoints: new Set(['x->a']),
        stepStatusByNodeId: { a: 'paused' },
        previewRequestByNodeId: {
          a: { method: 'GET', url: 'http://localhost:4000/a', headers: { 'Content-Type': 'application/json' } },
        },
      });
      render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);
      await user.click(screen.getByRole('tab', { name: 'Debugger' }));
      await user.click(screen.getByText('/a'));

      expect(screen.getByText('Preview — resolved, not yet sent')).toBeInTheDocument();
      // Not the Run Output tab's Request/Response side-by-side panels.
      expect(document.querySelector('.debug-step__panels')).not.toBeInTheDocument();
      // The row's own icon-only controls — see App.test.tsx for the
      // separate global header controls this complements, not replaces.
      expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
      const dump = document.querySelector('.debugger-row__json')!.textContent!;
      expect(dump).toContain('"url": "http://localhost:4000/a"');
    });

    it("wires a paused row's inline Step button to step that exact node", async () => {
      const user = userEvent.setup();
      const stepNode = vi.fn();
      useWorkflowStore.setState({
        nodes: [{ id: 'a', operationId: 'GET /a', credentialId: null, fieldValues: {} }],
        connections: [],
        operations: [
          { id: 'GET /a', method: 'get', path: '/a', parameters: [], requestBodySchema: null, responseSchema: null },
        ],
        armedBreakpoints: new Set(['x->a']),
        stepStatusByNodeId: { a: 'paused' },
        previewRequestByNodeId: {
          a: { method: 'GET', url: 'http://localhost:4000/a', headers: {} },
        },
        stepNode,
      });
      render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);
      await user.click(screen.getByRole('tab', { name: 'Debugger' }));

      await user.click(screen.getByRole('button', { name: 'Step' }));
      expect(stepNode).toHaveBeenCalledWith('a');
    });

    it('auto-switches to the Debugger tab the instant a node pauses, but not on every re-render while still paused', () => {
      useWorkflowStore.setState({
        nodes: [{ id: 'a', operationId: 'GET /a', credentialId: null, fieldValues: {} }],
        armedBreakpoints: new Set(['x->a']),
        stepStatusByNodeId: { a: 'pending' },
      });
      const { rerender } = render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);
      expect(screen.getByRole('tab', { name: 'Run output' })).toHaveAttribute('aria-selected', 'true');

      useWorkflowStore.setState({ stepStatusByNodeId: { a: 'paused' } });
      rerender(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);
      expect(screen.getByRole('tab', { name: 'Debugger' })).toHaveAttribute('aria-selected', 'true');

      // Switch back to Run output manually — a second render while `a` is
      // still paused shouldn't force it back to Debugger.
      screen.getByRole('tab', { name: 'Run output' }).click();
      rerender(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);
      expect(screen.getByRole('tab', { name: 'Run output' })).toHaveAttribute('aria-selected', 'true');
    });
  });
});
