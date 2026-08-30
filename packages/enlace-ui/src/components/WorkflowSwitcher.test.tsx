import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkflowSwitcher } from './WorkflowSwitcher.js';
import { useWorkflowStore } from '../store/workflowStore.js';

describe('WorkflowSwitcher', () => {
  beforeEach(() => {
    useWorkflowStore.setState({ specInfo: null });
  });

  it('shows Untitled when the spec has no title', () => {
    render(<WorkflowSwitcher />);
    expect(screen.getByRole('button', { name: 'Workflow: Untitled' })).toBeDisabled();
  });

  it('shows the spec title as the workflow name', () => {
    useWorkflowStore.setState({ specInfo: { title: 'Petstore', version: '1.0' } });
    render(<WorkflowSwitcher />);
    expect(screen.getByRole('button', { name: 'Workflow: Petstore' })).toBeInTheDocument();
  });
});
