import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkflowSwitcher } from './WorkflowSwitcher.js';
import { useWorkflowStore } from '../../store/workflowStore.js';

describe('WorkflowSwitcher', () => {
  beforeEach(() => {
    useWorkflowStore.setState({ workflowName: 'Untitled', specInfo: null });
  });

  it('shows Untitled by default — not the loaded OpenAPI title', () => {
    useWorkflowStore.setState({ specInfo: { title: 'Sample Store API', version: '1.0' } });
    render(<WorkflowSwitcher />);
    expect(screen.getByRole('button', { name: 'Workflow: Untitled' })).toBeInTheDocument();
    expect(screen.queryByText('Sample Store API')).not.toBeInTheDocument();
  });

  it('shows the workflow name from the store', () => {
    useWorkflowStore.setState({ workflowName: 'Orders sandbox' });
    render(<WorkflowSwitcher />);
    expect(screen.getByRole('button', { name: 'Workflow: Orders sandbox' })).toBeInTheDocument();
  });

  it('renames on Enter and empty commits as Untitled', async () => {
    const user = userEvent.setup();
    render(<WorkflowSwitcher />);

    await user.click(screen.getByRole('button', { name: 'Workflow: Untitled' }));
    const input = screen.getByRole('textbox', { name: 'Workflow name' });
    expect(input).toHaveFocus();

    await user.clear(input);
    await user.type(input, 'My chain');
    await user.keyboard('{Enter}');

    expect(useWorkflowStore.getState().workflowName).toBe('My chain');
    expect(screen.getByRole('button', { name: 'Workflow: My chain' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Workflow: My chain' }));
    await user.clear(screen.getByRole('textbox', { name: 'Workflow name' }));
    await user.keyboard('{Enter}');
    expect(useWorkflowStore.getState().workflowName).toBe('Untitled');
  });

  it('cancels rename on Escape', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({ workflowName: 'Keep me' });
    render(<WorkflowSwitcher />);

    await user.click(screen.getByRole('button', { name: 'Workflow: Keep me' }));
    await user.clear(screen.getByRole('textbox', { name: 'Workflow name' }));
    await user.type(screen.getByRole('textbox', { name: 'Workflow name' }), 'Nope');
    await user.keyboard('{Escape}');

    expect(useWorkflowStore.getState().workflowName).toBe('Keep me');
    expect(screen.getByRole('button', { name: 'Workflow: Keep me' })).toBeInTheDocument();
  });
});
