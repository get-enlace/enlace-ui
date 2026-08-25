import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CredentialsPanel } from './CredentialsPanel.js';
import { useWorkflowStore } from '../store/workflowStore.js';

describe('CredentialsPanel', () => {
  beforeEach(() => {
    useWorkflowStore.setState({ credentials: [], nodes: [] });
  });

  it('shows a singular/plural credential count on the trigger', () => {
    const { rerender } = render(<CredentialsPanel />);
    expect(screen.getByRole('button', { name: '0 credentials' })).toBeInTheDocument();

    useWorkflowStore.setState({
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: 'secret' }],
    });
    rerender(<CredentialsPanel />);
    expect(screen.getByRole('button', { name: '1 credential' })).toBeInTheDocument();
  });

  it('opens the drawer on trigger click, and closes it via the close button', async () => {
    const user = userEvent.setup();
    render(<CredentialsPanel />);

    expect(screen.queryByText('Credentials')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '0 credentials' }));
    expect(screen.getByText('Credentials')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close credentials' }));
    expect(screen.queryByText('Credentials')).not.toBeInTheDocument();
  });

  it('closes the drawer on Escape', async () => {
    const user = userEvent.setup();
    render(<CredentialsPanel />);

    await user.click(screen.getByRole('button', { name: '0 credentials' }));
    expect(screen.getByText('Credentials')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByText('Credentials')).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no credentials', async () => {
    const user = userEvent.setup();
    render(<CredentialsPanel />);
    await user.click(screen.getByRole('button', { name: '0 credentials' }));
    expect(screen.getByText(/No credentials yet/)).toBeInTheDocument();
  });

  it('lists existing credentials as cards with a masked preview', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: 'super-secret-token' }],
    });
    render(<CredentialsPanel />);
    await user.click(screen.getByRole('button', { name: '1 credential' }));

    expect(screen.getByText('staging')).toBeInTheDocument();
    expect(screen.getByText('Bearer token')).toBeInTheDocument();
    expect(screen.getByText(/••••/)).toHaveTextContent('••••oken');
    expect(screen.queryByText('super-secret-token')).not.toBeInTheDocument();
  });

  it('shows how many nodes use a credential, and clears it from them on delete', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: 'secret' }],
      nodes: [
        { id: 'n1', operationId: 'GET /a', credentialId: 'c1', fieldValues: {} },
        { id: 'n2', operationId: 'GET /b', credentialId: 'c1', fieldValues: {} },
        { id: 'n3', operationId: 'GET /c', credentialId: null, fieldValues: {} },
      ],
    });
    render(<CredentialsPanel />);
    await user.click(screen.getByRole('button', { name: '1 credential' }));

    expect(screen.getByText(/Used by 2 nodes/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete staging' }));

    const state = useWorkflowStore.getState();
    expect(state.credentials).toHaveLength(0);
    expect(state.nodes.find((n) => n.id === 'n1')?.credentialId).toBeNull();
    expect(state.nodes.find((n) => n.id === 'n2')?.credentialId).toBeNull();
    expect(state.nodes.find((n) => n.id === 'n3')?.credentialId).toBeNull();
  });

  it('opens the add-credential form defaulted to bearer, and keeps Save disabled until name and token are filled', async () => {
    const user = userEvent.setup();
    render(<CredentialsPanel />);

    await user.click(screen.getByRole('button', { name: '0 credentials' }));
    await user.click(screen.getByRole('button', { name: '+ New credential' }));
    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText('name'), 'staging');
    expect(saveButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText('bearer token'), 'secret-token');
    expect(saveButton).toBeEnabled();
  });

  it('adds a bearer credential to the store and returns to the list on save', async () => {
    const user = userEvent.setup();
    render(<CredentialsPanel />);

    await user.click(screen.getByRole('button', { name: '0 credentials' }));
    await user.click(screen.getByRole('button', { name: '+ New credential' }));
    await user.type(screen.getByPlaceholderText('name'), 'staging');
    await user.type(screen.getByPlaceholderText('bearer token'), 'secret-token');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const credentials = useWorkflowStore.getState().credentials;
    expect(credentials).toHaveLength(1);
    expect(credentials[0]).toMatchObject({ name: 'staging', token: 'secret-token', type: 'bearer' });

    expect(screen.queryByPlaceholderText('name')).not.toBeInTheDocument();
    expect(screen.getByText('staging')).toBeInTheDocument();
  });

  it('masks the token input as a password field', async () => {
    const user = userEvent.setup();
    render(<CredentialsPanel />);
    await user.click(screen.getByRole('button', { name: '0 credentials' }));
    await user.click(screen.getByRole('button', { name: '+ New credential' }));
    expect(screen.getByPlaceholderText('bearer token')).toHaveAttribute('type', 'password');
  });

  it('switches field sets when the credential type changes, and resets type-specific fields', async () => {
    const user = userEvent.setup();
    render(<CredentialsPanel />);

    await user.click(screen.getByRole('button', { name: '0 credentials' }));
    await user.click(screen.getByRole('button', { name: '+ New credential' }));
    await user.type(screen.getByPlaceholderText('name'), 'prod-basic');
    await user.selectOptions(screen.getByDisplayValue('Bearer token'), 'basic');

    expect(screen.queryByPlaceholderText('bearer token')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('password')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('username'), 'alice');
    await user.type(screen.getByPlaceholderText('password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(useWorkflowStore.getState().credentials[0]).toMatchObject({
      name: 'prod-basic',
      type: 'basic',
      username: 'alice',
      password: 'hunter2',
    });
  });

  it('shows the client-secret warning only for oauth2 client-credentials', async () => {
    const user = userEvent.setup();
    render(<CredentialsPanel />);

    await user.click(screen.getByRole('button', { name: '0 credentials' }));
    await user.click(screen.getByRole('button', { name: '+ New credential' }));
    expect(screen.queryByText(/Only use test\/sandbox credentials/)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByDisplayValue('Bearer token'), 'oauth2_clientCredentials');
    expect(screen.getByText(/Only use test\/sandbox credentials/)).toBeInTheDocument();
  });

  it('adds an apiKey credential sent as a query param', async () => {
    const user = userEvent.setup();
    render(<CredentialsPanel />);

    await user.click(screen.getByRole('button', { name: '0 credentials' }));
    await user.click(screen.getByRole('button', { name: '+ New credential' }));
    await user.type(screen.getByPlaceholderText('name'), 'api-key-cred');
    await user.selectOptions(screen.getByDisplayValue('Bearer token'), 'apiKey');
    await user.type(screen.getByPlaceholderText('e.g. X-API-Key'), 'apiKey');
    await user.selectOptions(screen.getByDisplayValue('Header'), 'query');
    await user.type(screen.getByPlaceholderText('key value'), 'secret-key');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(useWorkflowStore.getState().credentials[0]).toMatchObject({
      name: 'api-key-cred',
      type: 'apiKey',
      paramName: 'apiKey',
      in: 'query',
      key: 'secret-key',
    });
  });

  it('cancels and discards the draft, returning to the list without adding a credential', async () => {
    const user = userEvent.setup();
    render(<CredentialsPanel />);

    await user.click(screen.getByRole('button', { name: '0 credentials' }));
    await user.click(screen.getByRole('button', { name: '+ New credential' }));
    await user.type(screen.getByPlaceholderText('name'), 'discard-me');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(useWorkflowStore.getState().credentials).toHaveLength(0);
    expect(screen.queryByPlaceholderText('name')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ New credential' })).toBeInTheDocument();
  });
});
