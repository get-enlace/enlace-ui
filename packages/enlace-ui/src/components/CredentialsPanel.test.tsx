import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CredentialsPanel } from './CredentialsPanel.js';
import { useWorkflowStore } from '../store/workflowStore.js';

describe('CredentialsPanel', () => {
  beforeEach(() => {
    useWorkflowStore.setState({ credentials: [] });
  });

  it('shows a singular/plural credential count', () => {
    const { rerender } = render(<CredentialsPanel />);
    expect(screen.getByText('0 credentials')).toBeInTheDocument();

    useWorkflowStore.setState({
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: 'secret' }],
    });
    rerender(<CredentialsPanel />);
    expect(screen.getByText('1 credential')).toBeInTheDocument();

    useWorkflowStore.setState({
      credentials: [
        { id: 'c1', name: 'staging', type: 'bearer', token: 'secret' },
        { id: 'c2', name: 'prod', type: 'bearer', token: 'secret2' },
      ],
    });
    rerender(<CredentialsPanel />);
    expect(screen.getByText('2 credentials')).toBeInTheDocument();
  });

  it('keeps "Add credential" disabled until both name and token are filled', async () => {
    const user = userEvent.setup();
    render(<CredentialsPanel />);

    const addButton = screen.getByRole('button', { name: 'Add credential' });
    expect(addButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText('name'), 'staging');
    expect(addButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText('bearer token'), 'secret-token');
    expect(addButton).toBeEnabled();
  });

  it('adds the credential to the store and clears the inputs on click', async () => {
    const user = userEvent.setup();
    render(<CredentialsPanel />);

    await user.type(screen.getByPlaceholderText('name'), 'staging');
    await user.type(screen.getByPlaceholderText('bearer token'), 'secret-token');
    await user.click(screen.getByRole('button', { name: 'Add credential' }));

    const credentials = useWorkflowStore.getState().credentials;
    expect(credentials).toHaveLength(1);
    expect(credentials[0]).toMatchObject({ name: 'staging', token: 'secret-token', type: 'bearer' });

    expect(screen.getByPlaceholderText('name')).toHaveValue('');
    expect(screen.getByPlaceholderText('bearer token')).toHaveValue('');
  });

  it('masks the token input as a password field', () => {
    render(<CredentialsPanel />);
    expect(screen.getByPlaceholderText('bearer token')).toHaveAttribute('type', 'password');
  });
});
