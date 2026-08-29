import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  BearerFields,
  BasicFields,
  ApiKeyFields,
  OAuth2ClientCredentialsFields,
  OAuth2PasswordFields,
  PopupLoginFields,
} from './CredentialTypeFields.js';
import type { NewCredential } from '../types.js';

describe('BearerFields', () => {
  function Harness() {
    const [draft, setDraft] = useState<NewCredential>({ name: '', type: 'bearer', token: '' });
    return <BearerFields draft={draft as Extract<NewCredential, { type: 'bearer' }>} setDraft={setDraft} />;
  }

  it('renders a password-masked token input that updates the draft', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByPlaceholderText('bearer token');
    expect(input).toHaveAttribute('type', 'password');

    await user.type(input, 'secret-token');
    expect(input).toHaveValue('secret-token');
  });
});

describe('BasicFields', () => {
  function Harness() {
    const [draft, setDraft] = useState<NewCredential>({ name: '', type: 'basic', username: '', password: '' });
    return <BasicFields draft={draft as Extract<NewCredential, { type: 'basic' }>} setDraft={setDraft} />;
  }

  it('renders username and password inputs that update the draft', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByPlaceholderText('username'), 'alice');
    await user.type(screen.getByPlaceholderText('password'), 'hunter2');

    expect(screen.getByPlaceholderText('username')).toHaveValue('alice');
    expect(screen.getByPlaceholderText('password')).toHaveValue('hunter2');
    expect(screen.getByPlaceholderText('password')).toHaveAttribute('type', 'password');
  });
});

describe('ApiKeyFields', () => {
  function Harness() {
    const [draft, setDraft] = useState<NewCredential>({
      name: '',
      type: 'apiKey',
      paramName: '',
      in: 'header',
      key: '',
    });
    return <ApiKeyFields draft={draft as Extract<NewCredential, { type: 'apiKey' }>} setDraft={setDraft} />;
  }

  it('renders paramName, "Sent in", and key inputs that update the draft', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByPlaceholderText('e.g. X-API-Key'), 'X-API-Key');
    await user.selectOptions(screen.getByDisplayValue('Header'), 'query');
    await user.type(screen.getByPlaceholderText('key value'), 'secret-key');

    expect(screen.getByPlaceholderText('e.g. X-API-Key')).toHaveValue('X-API-Key');
    expect(screen.getByDisplayValue('Query param')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('key value')).toHaveValue('secret-key');
  });
});

describe('OAuth2ClientCredentialsFields', () => {
  function Harness() {
    const [draft, setDraft] = useState<NewCredential>({
      name: '',
      type: 'oauth2_clientCredentials',
      tokenUrl: '',
      clientId: '',
      clientSecret: '',
      scope: '',
      clientAuthMethod: 'basic',
    });
    return (
      <OAuth2ClientCredentialsFields
        draft={draft as Extract<NewCredential, { type: 'oauth2_clientCredentials' }>}
        setDraft={setDraft}
      />
    );
  }

  it('shows the client-secret warning', () => {
    render(<Harness />);
    expect(screen.getByText(/Only use test\/sandbox credentials/)).toBeInTheDocument();
  });

  it('renders tokenUrl, clientId, clientSecret, and scope inputs that update the draft', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(
      screen.getByPlaceholderText('https://auth.example.com/oauth/token'),
      'https://auth.example.com/token'
    );
    await user.type(screen.getByPlaceholderText('client id'), 'my-client');
    await user.type(screen.getByPlaceholderText('client secret'), 'my-secret');
    await user.type(screen.getByPlaceholderText('scope'), 'read write');

    expect(screen.getByPlaceholderText('https://auth.example.com/oauth/token')).toHaveValue(
      'https://auth.example.com/token'
    );
    expect(screen.getByPlaceholderText('client id')).toHaveValue('my-client');
    expect(screen.getByPlaceholderText('client secret')).toHaveValue('my-secret');
    expect(screen.getByPlaceholderText('scope')).toHaveValue('read write');
  });

  it('defaults clientAuthMethod to Basic and lets it switch to POST body', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByDisplayValue('HTTP Basic header (RFC 6749 client_secret_basic)')).toBeInTheDocument();

    await user.selectOptions(screen.getByDisplayValue('HTTP Basic header (RFC 6749 client_secret_basic)'), 'body');

    expect(screen.getByDisplayValue('POST body params (client_secret_post)')).toBeInTheDocument();
  });
});

describe('OAuth2PasswordFields', () => {
  function Harness() {
    const [draft, setDraft] = useState<NewCredential>({
      name: '',
      type: 'oauth2_password',
      tokenUrl: '',
      username: '',
      password: '',
      clientId: '',
      clientSecret: '',
      scope: '',
      clientAuthMethod: 'basic',
    });
    return (
      <OAuth2PasswordFields draft={draft as Extract<NewCredential, { type: 'oauth2_password' }>} setDraft={setDraft} />
    );
  }

  it('shows the legacy-grant warning', () => {
    render(<Harness />);
    expect(screen.getByText(/Legacy grant type/)).toBeInTheDocument();
  });

  it('renders tokenUrl, username, and password inputs that update the draft, with clientId/clientSecret/scope marked optional', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(
      screen.getByPlaceholderText('https://auth.example.com/oauth/token'),
      'https://auth.example.com/token'
    );
    await user.type(screen.getByPlaceholderText('resource owner username'), 'alice');
    await user.type(screen.getByPlaceholderText('resource owner password'), 'hunter2');

    expect(screen.getByPlaceholderText('resource owner username')).toHaveValue('alice');
    expect(screen.getByPlaceholderText('resource owner password')).toHaveValue('hunter2');
    expect(screen.getByText('Client ID (optional)')).toBeInTheDocument();
    expect(screen.getByText('Client secret (optional)')).toBeInTheDocument();
  });
});

describe('PopupLoginFields', () => {
  function Harness() {
    const [draft, setDraft] = useState<NewCredential>({ name: '', type: 'popup_login', loginUrl: '' });
    return <PopupLoginFields draft={draft as Extract<NewCredential, { type: 'popup_login' }>} setDraft={setDraft} />;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a Login URL input that updates the draft', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByPlaceholderText('https://your-app.example.com/auth/login');
    await user.type(input, 'https://app.test/auth/github');
    expect(input).toHaveValue('https://app.test/auth/github');
  });

  it('explains this credential injects nothing itself and is a login trigger, with no secret to enter at all', () => {
    render(<Harness />);
    expect(screen.getByText(/doesn't add anything to your requests itself/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/token/)).not.toBeInTheDocument();
  });

  it('"Log in…" is disabled until a login URL is entered, then opens it in a popup', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<Harness />);

    const loginButton = screen.getByRole('button', { name: 'Log in…' });
    expect(loginButton).toBeDisabled();

    await user.type(
      screen.getByPlaceholderText('https://your-app.example.com/auth/login'),
      'https://app.test/auth/github'
    );
    expect(loginButton).toBeEnabled();

    await user.click(loginButton);
    expect(openSpy).toHaveBeenCalledWith('https://app.test/auth/github', '_blank', expect.any(String));
  });
});
