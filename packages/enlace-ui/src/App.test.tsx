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
});
