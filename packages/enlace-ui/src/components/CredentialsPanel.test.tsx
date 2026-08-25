import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CredentialsPanel } from './CredentialsPanel.js';
import { useWorkflowStore } from '../store/workflowStore.js';

describe('CredentialsPanel', () => {
  beforeEach(() => {
    useWorkflowStore.setState({ credentials: [], nodes: [], declaredCredentials: [] });
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

  it('adds an oauth2_password credential, treating client id/secret as optional, and labels the type as legacy', async () => {
    const user = userEvent.setup();
    render(<CredentialsPanel />);

    await user.click(screen.getByRole('button', { name: '0 credentials' }));
    await user.click(screen.getByRole('button', { name: '+ New credential' }));
    await user.type(screen.getByPlaceholderText('name'), 'legacy-password');
    await user.selectOptions(screen.getByDisplayValue('Bearer token'), 'oauth2_password');

    expect(screen.getByRole('option', { name: 'OAuth2 (password) · Legacy' })).toBeInTheDocument();
    expect(screen.getByText(/Legacy grant type/)).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText('https://auth.example.com/oauth/token'), 'https://auth.example.com/token');
    await user.type(screen.getByPlaceholderText('resource owner username'), 'alice');
    await user.type(screen.getByPlaceholderText('resource owner password'), 'hunter2');
    expect(saveButton).toBeEnabled(); // client id/secret left blank — still valid

    await user.click(saveButton);

    expect(useWorkflowStore.getState().credentials[0]).toMatchObject({
      type: 'oauth2_password',
      tokenUrl: 'https://auth.example.com/token',
      username: 'alice',
      password: 'hunter2',
    });
  });

  it('shows nothing under "Declared in spec" when the spec declared no securitySchemes', async () => {
    const user = userEvent.setup();
    render(<CredentialsPanel />);
    await user.click(screen.getByRole('button', { name: '0 credentials' }));
    expect(screen.queryByText('Declared in spec')).not.toBeInTheDocument();
  });

  it('lists a declared credential, pre-fills the form on "Configure", and shows the pre-fill banner', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      declaredCredentials: [
        {
          schemeName: 'bearerAuth',
          description: 'JWT bearer auth',
          template: { name: 'bearerAuth', type: 'bearer', token: '', fromSecurityScheme: 'bearerAuth' },
        },
      ],
    });
    render(<CredentialsPanel />);
    await user.click(screen.getByRole('button', { name: '0 credentials' }));

    expect(screen.getByText('Declared in spec')).toBeInTheDocument();
    expect(screen.getByText('bearerAuth')).toBeInTheDocument();
    expect(screen.getByText(/JWT bearer auth/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Configure' }));

    expect(screen.getByText(/declared in the spec's/)).toBeInTheDocument();
    expect(screen.getByText('securitySchemes.bearerAuth')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('name')).toHaveValue('bearerAuth');
    expect(screen.getByDisplayValue('Bearer token')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('bearer token'), 'secret-token');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(useWorkflowStore.getState().credentials[0]).toMatchObject({
      name: 'bearerAuth',
      type: 'bearer',
      token: 'secret-token',
      fromSecurityScheme: 'bearerAuth',
    });
  });

  it('removes a declared credential from the list once it has been configured, hiding the whole section once none remain', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      declaredCredentials: [
        {
          schemeName: 'bearerAuth',
          template: { name: 'bearerAuth', type: 'bearer', token: '', fromSecurityScheme: 'bearerAuth' },
        },
      ],
    });
    render(<CredentialsPanel />);
    await user.click(screen.getByRole('button', { name: '0 credentials' }));
    await user.click(screen.getByRole('button', { name: 'Configure' }));
    await user.type(screen.getByPlaceholderText('bearer token'), 'secret-token');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.queryByText('Declared in spec')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configure' })).not.toBeInTheDocument();
    // A second credential from the same scheme is still possible — just via "+ New credential", not the (now gone) suggestion.
    expect(screen.getByRole('button', { name: '+ New credential' })).toBeInTheDocument();
  });

  it('only removes the declared credential that was actually configured, leaving the others visible', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      declaredCredentials: [
        {
          schemeName: 'bearerAuth',
          template: { name: 'bearerAuth', type: 'bearer', token: '', fromSecurityScheme: 'bearerAuth' },
        },
        {
          schemeName: 'apiKeyAuth',
          template: { name: 'apiKeyAuth', type: 'apiKey', paramName: 'X-API-Key', in: 'header', key: '', fromSecurityScheme: 'apiKeyAuth' },
        },
      ],
    });
    render(<CredentialsPanel />);
    await user.click(screen.getByRole('button', { name: '0 credentials' }));
    await user.click(screen.getAllByRole('button', { name: 'Configure' })[0]);
    await user.type(screen.getByPlaceholderText('bearer token'), 'secret-token');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Declared in spec')).toBeInTheDocument();
    expect(screen.getByText('apiKeyAuth')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Configure' })).toHaveLength(1);
  });

  it('shows a "From spec" tag on a card whose credential originated from a declared credential', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      credentials: [
        { id: 'c1', name: 'bearerAuth', type: 'bearer', token: 'secret', fromSecurityScheme: 'bearerAuth' },
      ],
    });
    render(<CredentialsPanel />);
    await user.click(screen.getByRole('button', { name: '1 credential' }));

    expect(screen.getByText(/From spec:/)).toBeInTheDocument();
    expect(screen.getByText('bearerAuth', { selector: 'code' })).toBeInTheDocument();
  });

  it('Edit pre-fills the form with the credential\'s existing values, and Save updates it in place (same id, list length unchanged)', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: 'old-token' }],
    });
    render(<CredentialsPanel />);
    await user.click(screen.getByRole('button', { name: '1 credential' }));
    await user.click(screen.getByRole('button', { name: 'Edit staging' }));

    expect(screen.getByPlaceholderText('name')).toHaveValue('staging');
    expect(screen.getByPlaceholderText('bearer token')).toHaveValue('old-token');

    await user.clear(screen.getByPlaceholderText('name'));
    await user.type(screen.getByPlaceholderText('name'), 'staging-renamed');
    await user.clear(screen.getByPlaceholderText('bearer token'));
    await user.type(screen.getByPlaceholderText('bearer token'), 'new-token');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const credentials = useWorkflowStore.getState().credentials;
    expect(credentials).toHaveLength(1);
    expect(credentials[0]).toMatchObject({ id: 'c1', name: 'staging-renamed', token: 'new-token' });
    expect(screen.getByText('staging-renamed')).toBeInTheDocument();
  });

  it('Cancel during Edit discards changes, leaving the original credential untouched', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: 'old-token' }],
    });
    render(<CredentialsPanel />);
    await user.click(screen.getByRole('button', { name: '1 credential' }));
    await user.click(screen.getByRole('button', { name: 'Edit staging' }));
    await user.clear(screen.getByPlaceholderText('name'));
    await user.type(screen.getByPlaceholderText('name'), 'discarded-name');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(useWorkflowStore.getState().credentials).toEqual([
      { id: 'c1', name: 'staging', type: 'bearer', token: 'old-token' },
    ]);
    expect(screen.getByText('staging')).toBeInTheDocument();
  });

  it('editing a credential switches type fields the same way adding does, and Save persists the new type', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: 'old-token' }],
    });
    render(<CredentialsPanel />);
    await user.click(screen.getByRole('button', { name: '1 credential' }));
    await user.click(screen.getByRole('button', { name: 'Edit staging' }));
    await user.selectOptions(screen.getByDisplayValue('Bearer token'), 'basic');
    await user.type(screen.getByPlaceholderText('username'), 'alice');
    await user.type(screen.getByPlaceholderText('password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(useWorkflowStore.getState().credentials).toEqual([
      { id: 'c1', name: 'staging', type: 'basic', username: 'alice', password: 'hunter2' },
    ]);
  });

  it('shows "Originally configured from..." (not the fresh pre-fill banner) when editing a credential that came from a declared scheme', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      credentials: [
        { id: 'c1', name: 'bearerAuth', type: 'bearer', token: 'secret', fromSecurityScheme: 'bearerAuth' },
      ],
    });
    render(<CredentialsPanel />);
    await user.click(screen.getByRole('button', { name: '1 credential' }));
    await user.click(screen.getByRole('button', { name: 'Edit bearerAuth' }));

    expect(screen.getByText(/Originally configured from/)).toBeInTheDocument();
    expect(screen.queryByText(/fill in the secret value\(s\) below/)).not.toBeInTheDocument();
  });
});
