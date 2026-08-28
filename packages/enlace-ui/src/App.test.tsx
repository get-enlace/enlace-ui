import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.js';
import { useWorkflowStore } from './store/workflowStore.js';

describe('App', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      operations: [],
      nodes: [],
      nodePositions: {},
      connections: [],
      selectedNodeId: null,
      credentials: [],
      isRunning: false,
      stepStatusByNodeId: {},
      activeControl: null,
    });
    // App loads the spec on mount (loadOperations -> fetchSpec) — stub it
    // out so tests don't depend on a real server, and can assert it's
    // actually called.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ paths: {}, servers: [{ url: 'http://x' }] }) })
    );
  });

  it('fetches the spec on mount', () => {
    render(<App />);
    expect(fetch).toHaveBeenCalledWith('api/spec');
  });

  it('disables the Run button while a run is in progress', () => {
    useWorkflowStore.setState({ isRunning: true });
    render(<App />);
    expect(screen.getByRole('button', { name: 'Running…' })).toBeDisabled();
  });

  it('Run and Debug are two separate buttons — Run ignores breakpoints, Debug honors them', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    useWorkflowStore.setState({ run });
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(run).toHaveBeenLastCalledWith();

    await user.click(screen.getByRole('button', { name: 'Debug' }));
    expect(run).toHaveBeenLastCalledWith({ useBreakpoints: true });
  });

  it('also disables Debug while a run is in progress', () => {
    useWorkflowStore.setState({ isRunning: true });
    render(<App />);
    expect(screen.getByRole('button', { name: 'Debug' })).toBeDisabled();
  });

  it('collapses the inspector to a strip and can reopen it', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText('Select a node to configure it.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide inspector' }));
    expect(screen.queryByText('Select a node to configure it.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show inspector' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show inspector' }));
    expect(screen.getByText('Select a node to configure it.')).toBeInTheDocument();
  });

  describe('run controls', () => {
    it("hides Continue/Step/Stop when there's no run in progress", () => {
      render(<App />);
      expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Step' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Stop/ })).not.toBeInTheDocument();
    });

    it('hides Run/Debug (not just disables them) once activeControl is set, so it never looks like a plain run is also happening', () => {
      useWorkflowStore.setState({
        isRunning: true,
        nodes: [{ id: 'a', operationId: 'GET /a', credentialId: null, fieldValues: {} }],
        stepStatusByNodeId: { a: 'paused' },
        activeControl: { continue: vi.fn(), step: vi.fn(), stop: vi.fn() },
      });
      render(<App />);

      expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Running…' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Debug' })).not.toBeInTheDocument();
    });

    it('shows one global set of controls once a run is controllable, not one per paused node', () => {
      useWorkflowStore.setState({
        isRunning: true,
        nodes: [
          { id: 'a', operationId: 'GET /a', credentialId: null, fieldValues: {} },
          { id: 'b', operationId: 'GET /b', credentialId: null, fieldValues: {} },
        ],
        stepStatusByNodeId: { a: 'paused', b: 'paused' },
        activeControl: { continue: vi.fn(), step: vi.fn(), stop: vi.fn() },
      });
      render(<App />);

      expect(screen.getAllByRole('button', { name: /Continue/ })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: 'Step' })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: /Stop/ })).toHaveLength(1);
    });

    it('Continue and Stop forward to activeControl', async () => {
      const user = userEvent.setup();
      const control = { continue: vi.fn(), step: vi.fn(), stop: vi.fn() };
      useWorkflowStore.setState({
        isRunning: true,
        nodes: [{ id: 'a', operationId: 'GET /a', credentialId: null, fieldValues: {} }],
        stepStatusByNodeId: { a: 'paused' },
        activeControl: control,
      });
      render(<App />);

      await user.click(screen.getByRole('button', { name: /Continue/ }));
      expect(control.continue).toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: /Stop/ }));
      expect(control.stop).toHaveBeenCalled();
    });

    it("Step targets the selected node when it's paused", async () => {
      const user = userEvent.setup();
      const control = { continue: vi.fn(), step: vi.fn(), stop: vi.fn() };
      useWorkflowStore.setState({
        isRunning: true,
        nodes: [
          { id: 'a', operationId: 'GET /a', credentialId: null, fieldValues: {} },
          { id: 'b', operationId: 'GET /b', credentialId: null, fieldValues: {} },
        ],
        stepStatusByNodeId: { a: 'paused', b: 'paused' },
        selectedNodeId: 'b',
        activeControl: control,
      });
      render(<App />);

      await user.click(screen.getByRole('button', { name: 'Step' }));
      expect(control.step).toHaveBeenCalledWith('b');
    });

    it('Step falls back to the first paused node when nothing paused is selected', async () => {
      const user = userEvent.setup();
      const control = { continue: vi.fn(), step: vi.fn(), stop: vi.fn() };
      useWorkflowStore.setState({
        isRunning: true,
        nodes: [
          { id: 'a', operationId: 'GET /a', credentialId: null, fieldValues: {} },
          { id: 'b', operationId: 'GET /b', credentialId: null, fieldValues: {} },
        ],
        stepStatusByNodeId: { a: 'paused', b: 'paused' },
        selectedNodeId: null,
        activeControl: control,
      });
      render(<App />);

      await user.click(screen.getByRole('button', { name: 'Step' }));
      expect(control.step).toHaveBeenCalledWith('a');
    });

    it('disables Continue and Step (but not Stop) once nothing is actually paused, e.g. mid-flight with no breakpoint hit yet', () => {
      useWorkflowStore.setState({
        isRunning: true,
        nodes: [{ id: 'a', operationId: 'GET /a', credentialId: null, fieldValues: {} }],
        stepStatusByNodeId: { a: 'in-flight' },
        activeControl: { continue: vi.fn(), step: vi.fn(), stop: vi.fn() },
      });
      render(<App />);

      expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Step' })).toBeDisabled();
      expect(screen.getByRole('button', { name: /Stop/ })).not.toBeDisabled();
    });
  });
});
