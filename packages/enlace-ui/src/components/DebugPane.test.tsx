import { describe, it, expect, beforeEach } from 'vitest';
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
    useWorkflowStore.setState({ runResult: null, isRunning: false, error: null });
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

  it('redacts the Authorization header in the shown request/response JSON, case-insensitively, without touching other headers', () => {
    useWorkflowStore.setState({
      runResult: {
        steps: [makeStep({ request: { ...makeStep().request, headers: { 'content-type': 'application/json', authorization: 'Bearer super-secret-token' } } })],
      },
    });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);

    const dump = document.querySelector('pre')!.textContent!;
    expect(dump).not.toContain('super-secret-token');
    expect(dump).toContain('[redacted]');
    expect(dump).toContain('application/json'); // non-auth headers pass through untouched
  });

  it('shows the step count and a status badge per step', () => {
    useWorkflowStore.setState({ runResult: { steps: [makeStep(), makeStep({ nodeId: 'node-2' })] } });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);

    expect(screen.getByText('2 call(s)')).toBeInTheDocument();
    expect(screen.getAllByText('200')).toHaveLength(2);
  });

  it('shows ERROR status and the error message for a failed step', () => {
    useWorkflowStore.setState({
      runResult: { steps: [makeStep({ response: undefined, error: 'Network request failed' })] },
    });
    render(<DebugPane collapsed={false} onToggleCollapsed={() => {}} />);

    expect(screen.getByText('ERROR')).toBeInTheDocument();
    expect(screen.getByText('Network request failed')).toBeInTheDocument();
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
});
