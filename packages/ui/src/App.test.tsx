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
      isDebugRun: false,
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

  it('shows the workflow name in chrome and folds setup actions behind Settings', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Workflow: Untitled' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /credentials/i })).not.toBeInTheDocument();
  });

  it('disables nothing on idle Run; while running, Run/Debug are replaced by spinner + Stop', () => {
    useWorkflowStore.setState({ isRunning: true, isDebugRun: false });
    render(<App />);
    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Debug' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Run in progress' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
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

  it('also hides Debug while a plain run is in progress', () => {
    useWorkflowStore.setState({ isRunning: true, isDebugRun: false });
    render(<App />);
    expect(screen.queryByRole('button', { name: 'Debug' })).not.toBeInTheDocument();
  });

  it('collapses the node config to a strip and can reopen it', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText('Select a node to configure it.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide node config' }));
    expect(screen.queryByText('Select a node to configure it.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show node config' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show node config' }));
    expect(screen.getByText('Select a node to configure it.')).toBeInTheDocument();
  });

  describe('run controls', () => {
    it("hides Continue/Step/Stop when there's no run in progress", () => {
      render(<App />);
      expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Step' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Stop/ })).not.toBeInTheDocument();
    });

    it('hides Run/Debug (not just disables them) once a debug run is active, so it never looks like a plain run is also happening', () => {
      useWorkflowStore.setState({
        isRunning: true,
        isDebugRun: true,
        nodes: [{ id: 'a', operationId: 'GET /a', credentialId: null, fieldValues: {} }],
        stepStatusByNodeId: { a: 'paused' },
        activeControl: { continue: vi.fn(), step: vi.fn(), stop: vi.fn() },
      });
      render(<App />);

      expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Debug' })).not.toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Debug controls' })).toBeInTheDocument();
    });

    it('shows header debug controls once a run is controllable; pause bar also offers Continue/Step', () => {
      useWorkflowStore.setState({
        isRunning: true,
        isDebugRun: true,
        nodes: [
          { id: 'a', operationId: 'GET /a', credentialId: null, fieldValues: {} },
          { id: 'b', operationId: 'GET /b', credentialId: null, fieldValues: {} },
        ],
        stepStatusByNodeId: { a: 'paused', b: 'paused' },
        activeControl: { continue: vi.fn(), step: vi.fn(), stop: vi.fn() },
      });
      render(<App />);

      const header = document.querySelector('.run-segment')!;
      expect(header.querySelectorAll('[aria-label="Continue"]')).toHaveLength(1);
      expect(header.querySelectorAll('[aria-label="Step"]')).toHaveLength(1);
      expect(header.querySelectorAll('[aria-label="Stop"]')).toHaveLength(1);
      // Pause bar mirrors Continue/Step for the focused paused node (not Stop).
      expect(document.querySelectorAll('.results-pause-bar [aria-label="Continue"]')).toHaveLength(1);
      expect(document.querySelectorAll('.results-pause-bar [aria-label="Step"]')).toHaveLength(1);
    });

    it('Continue and Stop forward to activeControl', async () => {
      const user = userEvent.setup();
      const control = { continue: vi.fn(), step: vi.fn(), stop: vi.fn() };
      useWorkflowStore.setState({
        isRunning: true,
        isDebugRun: true,
        nodes: [{ id: 'a', operationId: 'GET /a', credentialId: null, fieldValues: {} }],
        stepStatusByNodeId: { a: 'paused' },
        activeControl: control,
      });
      render(<App />);

      await user.click(document.querySelector('.run-segment [aria-label="Continue"]')!);
      expect(control.continue).toHaveBeenCalled();

      await user.click(document.querySelector('.run-segment [aria-label="Stop"]')!);
      expect(control.stop).toHaveBeenCalled();
    });

    it("Step targets the selected node when it's paused", async () => {
      const user = userEvent.setup();
      const control = { continue: vi.fn(), step: vi.fn(), stop: vi.fn() };
      useWorkflowStore.setState({
        isRunning: true,
        isDebugRun: true,
        nodes: [
          { id: 'a', operationId: 'GET /a', credentialId: null, fieldValues: {} },
          { id: 'b', operationId: 'GET /b', credentialId: null, fieldValues: {} },
        ],
        stepStatusByNodeId: { a: 'paused', b: 'paused' },
        selectedNodeId: 'b',
        activeControl: control,
      });
      render(<App />);

      await user.click(document.querySelector('.run-segment [aria-label="Step"]')!);
      expect(control.step).toHaveBeenCalledWith('b');
    });

    it('Step falls back to the first paused node when nothing paused is selected', async () => {
      const user = userEvent.setup();
      const control = { continue: vi.fn(), step: vi.fn(), stop: vi.fn() };
      useWorkflowStore.setState({
        isRunning: true,
        isDebugRun: true,
        nodes: [
          { id: 'a', operationId: 'GET /a', credentialId: null, fieldValues: {} },
          { id: 'b', operationId: 'GET /b', credentialId: null, fieldValues: {} },
        ],
        stepStatusByNodeId: { a: 'paused', b: 'paused' },
        selectedNodeId: null,
        activeControl: control,
      });
      render(<App />);

      await user.click(document.querySelector('.run-segment [aria-label="Step"]')!);
      expect(control.step).toHaveBeenCalledWith('a');
    });

    it('disables Continue and Step (but not Stop) once nothing is actually paused, e.g. mid-flight with no breakpoint hit yet', () => {
      useWorkflowStore.setState({
        isRunning: true,
        isDebugRun: true,
        nodes: [{ id: 'a', operationId: 'GET /a', credentialId: null, fieldValues: {} }],
        stepStatusByNodeId: { a: 'in-flight' },
        activeControl: { continue: vi.fn(), step: vi.fn(), stop: vi.fn() },
      });
      render(<App />);

      expect(document.querySelector('.run-segment [aria-label="Continue"]')).toBeDisabled();
      expect(document.querySelector('.run-segment [aria-label="Step"]')).toBeDisabled();
      expect(document.querySelector('.run-segment [aria-label="Stop"]')).not.toBeDisabled();
    });
  });
});
