import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { CredentialForm } from './CredentialForm.js';
import { emptyDraft } from '../../utils/credentialDraft.js';
import { __clearCredentialTokenCacheForTests } from '@get-enlace/core';
import type { NewCredential } from '../../types.js';

function mockTokenResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

// CredentialForm is fully controlled (draft/setDraft owned by the caller,
// same as the real CredentialsPanel usage) — this harness gives that state
// somewhere to actually live, so typing/selecting in the rendered inputs
// behaves the same way it does in the real drawer.
function Harness({
  initialDraft,
  editingId = null,
  onCancel = () => {},
  onSave = () => {},
}: {
  initialDraft: NewCredential;
  editingId?: string | null;
  onCancel?: () => void;
  onSave?: () => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  return <CredentialForm draft={draft} setDraft={setDraft} editingId={editingId} onCancel={onCancel} onSave={onSave} />;
}

describe('CredentialForm', () => {
  it('focuses the name input on mount', () => {
    render(<Harness initialDraft={emptyDraft('bearer', '')} />);
    expect(screen.getByPlaceholderText('name')).toHaveFocus();
  });

  it('keeps Save disabled until the draft is complete, and calls onSave when clicked', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Harness initialDraft={emptyDraft('bearer', '')} onSave={onSave} />);

    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText('name'), 'staging');
    await user.type(screen.getByPlaceholderText('bearer token'), 'secret-token');
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);
    expect(onSave).toHaveBeenCalled();
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<Harness initialDraft={emptyDraft('bearer', '')} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('reads "Save changes" instead of "Save" while editing (editingId set)', () => {
    render(<Harness initialDraft={emptyDraft('bearer', 'staging')} editingId="c1" />);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('switching the Type select swaps the rendered field set', async () => {
    const user = userEvent.setup();
    render(<Harness initialDraft={emptyDraft('bearer', '')} />);

    expect(screen.getByPlaceholderText('bearer token')).toBeInTheDocument();
    await user.selectOptions(screen.getByDisplayValue('Bearer token'), 'basic');

    expect(screen.queryByPlaceholderText('bearer token')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('password')).toBeInTheDocument();
  });

  it('shows the fresh pre-fill banner when adding from a declared scheme', () => {
    const draft: NewCredential = { name: 'bearerAuth', type: 'bearer', token: '', fromSecurityScheme: 'bearerAuth' };
    render(<Harness initialDraft={draft} />);

    expect(screen.getByText(/declared in the spec's/)).toBeInTheDocument();
    expect(screen.getByText('securitySchemes.bearerAuth')).toBeInTheDocument();
  });

  it('shows the past-tense banner (not the fresh pre-fill one) when editing a credential that came from a declared scheme', () => {
    const draft: NewCredential = { name: 'bearerAuth', type: 'bearer', token: '', fromSecurityScheme: 'bearerAuth' };
    render(<Harness initialDraft={draft} editingId="c1" />);

    expect(screen.getByText(/Originally configured from/)).toBeInTheDocument();
    expect(screen.queryByText(/fill in the secret value\(s\) below/)).not.toBeInTheDocument();
  });

  it('shows no spec banner at all for a credential with no fromSecurityScheme', () => {
    render(<Harness initialDraft={emptyDraft('bearer', '')} />);
    expect(screen.queryByText(/securitySchemes\./)).not.toBeInTheDocument();
  });

  describe('oauth2_* Verify & Save', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      __clearCredentialTokenCacheForTests();
    });

    it('reads "Verify & Save" (not plain "Save") for oauth2_clientCredentials', () => {
      render(<Harness initialDraft={emptyDraft('oauth2_clientCredentials', '')} />);
      expect(screen.getByRole('button', { name: 'Verify & Save' })).toBeInTheDocument();
    });

    it('hits the token endpoint and calls onSave with the id it verified, on success', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockResolvedValue(mockTokenResponse(200, { access_token: 'tok', expires_in: 60 }));
      vi.stubGlobal('fetch', fetchMock);
      const onSave = vi.fn();

      render(<Harness initialDraft={emptyDraft('oauth2_clientCredentials', '')} onSave={onSave} />);
      await user.type(screen.getByPlaceholderText('name'), 'guest-token');
      await user.type(screen.getByPlaceholderText('https://auth.example.com/oauth/token'), 'http://auth.test/token');
      await user.type(screen.getByPlaceholderText('client id'), 'client-id');
      await user.type(screen.getByPlaceholderText('client secret'), 'client-secret');

      await user.click(screen.getByRole('button', { name: 'Verify & Save' }));

      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(fetchMock).toHaveBeenCalledWith('http://auth.test/token', expect.anything());
      expect(typeof onSave.mock.calls[0][0]).toBe('string');
      expect(onSave.mock.calls[0][0]).not.toBe('');
    });

    it('shows the failure inline and does not call onSave when the token endpoint rejects the request', async () => {
      const user = userEvent.setup();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockTokenResponse(401, {})));
      const onSave = vi.fn();

      render(<Harness initialDraft={emptyDraft('oauth2_clientCredentials', '')} onSave={onSave} />);
      await user.type(screen.getByPlaceholderText('name'), 'guest-token');
      await user.type(screen.getByPlaceholderText('https://auth.example.com/oauth/token'), 'http://auth.test/token');
      await user.type(screen.getByPlaceholderText('client id'), 'client-id');
      await user.type(screen.getByPlaceholderText('client secret'), 'client-secret');

      await user.click(screen.getByRole('button', { name: 'Verify & Save' }));

      expect(await screen.findByText(/Verification failed:.*failed with status 401/)).toBeInTheDocument();
      expect(onSave).not.toHaveBeenCalled();
      // Back to idle, editable — not stuck on "Verifying…".
      expect(screen.getByRole('button', { name: 'Verify & Save' })).toBeEnabled();
    });

    it('clears a previous verification error as soon as any field changes', async () => {
      const user = userEvent.setup();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockTokenResponse(401, {})));

      render(<Harness initialDraft={emptyDraft('oauth2_clientCredentials', '')} />);
      await user.type(screen.getByPlaceholderText('name'), 'guest-token');
      await user.type(screen.getByPlaceholderText('https://auth.example.com/oauth/token'), 'http://auth.test/token');
      await user.type(screen.getByPlaceholderText('client id'), 'client-id');
      await user.type(screen.getByPlaceholderText('client secret'), 'client-secret');
      await user.click(screen.getByRole('button', { name: 'Verify & Save' }));
      expect(await screen.findByText(/Verification failed/)).toBeInTheDocument();

      await user.type(screen.getByPlaceholderText('client secret'), '-retry');

      expect(screen.queryByText(/Verification failed/)).not.toBeInTheDocument();
    });
  });
});
