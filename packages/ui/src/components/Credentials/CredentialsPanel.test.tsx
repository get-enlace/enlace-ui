import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CredentialsPanel } from './CredentialsPanel.js';
import { useWorkflowStore } from '../../store/workflowStore.js';

// CredentialsPanel is now the drawer shell + wiring for CredentialCard,
// DeclaredCredentialsList, and CredentialForm (each covered by their own
// test file) — these tests cover only what's actually CredentialsPanel's
// own responsibility: open/close, the store wiring (add/update/remove),
// and the "Declared in spec" filtering logic derived from
// credentials + declaredCredentials.
describe('CredentialsPanel', () => {
  beforeEach(() => {
    useWorkflowStore.setState({ credentials: [], nodes: [], declaredCredentials: [], credentialReview: null });
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

  it('"+ New credential" opens the form, and Cancel returns to the button — no credential added', async () => {
    const user = userEvent.setup();
    render(<CredentialsPanel />);

    await user.click(screen.getByRole('button', { name: '0 credentials' }));
    await user.click(screen.getByRole('button', { name: '+ New credential' }));
    expect(screen.getByRole('heading', { name: 'New credential' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('name')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('name'), 'discard-me');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(useWorkflowStore.getState().credentials).toHaveLength(0);
    expect(screen.queryByPlaceholderText('name')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Credentials' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ New credential' })).toBeInTheDocument();
  });

  it('Save on the form adds the credential to the store and returns to the list', async () => {
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

  it('clicking "Configure" on a declared credential opens the form pre-filled from its template', async () => {
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

    await user.click(screen.getByRole('button', { name: 'Configure' }));

    expect(screen.getByPlaceholderText('name')).toHaveValue('bearerAuth');
    expect(screen.getByDisplayValue('Bearer token')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('bearer token'), 'secret-token');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(useWorkflowStore.getState().credentials[0]).toMatchObject({
      name: 'bearerAuth',
      fromSecurityScheme: 'bearerAuth',
    });
  });

  it('a declared credential drops out of "Declared in spec" once a credential from it exists, and only that one', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      declaredCredentials: [
        {
          schemeName: 'bearerAuth',
          template: { name: 'bearerAuth', type: 'bearer', token: '', fromSecurityScheme: 'bearerAuth' },
        },
        {
          schemeName: 'apiKeyAuth',
          template: {
            name: 'apiKeyAuth',
            type: 'apiKey',
            paramName: 'X-API-Key',
            in: 'header',
            key: '',
            fromSecurityScheme: 'apiKeyAuth',
          },
        },
      ],
      credentials: [{ id: 'c1', name: 'bearerAuth', type: 'bearer', token: 'secret', fromSecurityScheme: 'bearerAuth' }],
    });
    render(<CredentialsPanel />);
    await user.click(screen.getByRole('button', { name: '1 credential' }));

    expect(screen.getByText('Declared in spec')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Configure' })).toHaveLength(1);
    expect(screen.getByText('apiKeyAuth')).toBeInTheDocument();
  });

  it('clicking Edit on a card opens the form pre-filled, and Save changes updates it in place (same id)', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: 'old-token' }],
    });
    render(<CredentialsPanel />);
    await user.click(screen.getByRole('button', { name: '1 credential' }));
    await user.click(screen.getByRole('button', { name: 'Edit staging' }));

    expect(screen.getByRole('heading', { name: 'Edit credential' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('name')).toHaveValue('staging');
    expect(screen.getByPlaceholderText('bearer token')).toHaveValue('old-token');

    await user.clear(screen.getByPlaceholderText('name'));
    await user.type(screen.getByPlaceholderText('name'), 'staging-renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const credentials = useWorkflowStore.getState().credentials;
    expect(credentials).toHaveLength(1);
    expect(credentials[0]).toMatchObject({ id: 'c1', name: 'staging-renamed' });
  });

  it('opens itself with a review banner when an import leaves credentials without values', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      credentials: [
        { id: 'c1', name: 'staging', type: 'bearer', token: '' },
        { id: 'c2', name: 'kiosk-key', type: 'apiKey', paramName: 'X-API-Key', in: 'header', key: '' },
      ],
      credentialReview: { needsValueIds: ['c1', 'c2'], secretsDiscarded: false },
    });
    render(<CredentialsPanel />);

    expect(screen.getByText('Credentials')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 imported credentials need a value');
    expect(screen.getAllByText('Needs a value')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Close credentials' }));
    expect(useWorkflowStore.getState().credentialReview).toBeNull();
  });

  it('drops the review banner once every flagged credential has a value', () => {
    useWorkflowStore.setState({
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: 'filled-in' }],
      credentialReview: { needsValueIds: ['c1'], secretsDiscarded: false },
    });
    render(<CredentialsPanel />);

    expect(screen.getByText('Credentials')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('reports discarded secrets from a stripped collection in the same banner', () => {
    useWorkflowStore.setState({
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: '' }],
      credentialReview: { needsValueIds: ['c1'], secretsDiscarded: true },
    });
    render(<CredentialsPanel />);

    expect(screen.getByRole('status')).toHaveTextContent(
      '1 imported credential needs a value before this chain can run — it’s marked below. Unexpected secrets in a stripped collection were discarded on import.'
    );
  });

  it('clicking Delete on a card removes the credential from the store', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: 'secret' }],
    });
    render(<CredentialsPanel />);
    await user.click(screen.getByRole('button', { name: '1 credential' }));
    await user.click(screen.getByRole('button', { name: 'Delete staging' }));

    expect(useWorkflowStore.getState().credentials).toHaveLength(0);
  });
});
