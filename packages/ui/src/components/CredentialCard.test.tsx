import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CredentialCard } from './CredentialCard.js';
import type { Credential } from '../types.js';

const bearerCredential: Credential = { id: 'c1', name: 'staging', type: 'bearer', token: 'super-secret-token' };
const apiKeyCredential: Credential = {
  id: 'c2',
  name: 'kiosk-key',
  type: 'apiKey',
  paramName: 'X-API-Key',
  in: 'header',
  key: 'super-secret-key',
};

describe('CredentialCard', () => {
  it('shows the type badge, name, and a fully redacted preview — never the raw secret', () => {
    render(<CredentialCard credential={apiKeyCredential} usageCount={0} onEdit={() => {}} onDelete={() => {}} />);

    expect(screen.getByText('API key')).toBeInTheDocument();
    expect(screen.getByText('kiosk-key')).toBeInTheDocument();
    expect(screen.getByText(/••••••••/)).toHaveTextContent('X-API-Key (header) · ••••••••');
    expect(screen.queryByText(/super-secret-key/)).not.toBeInTheDocument();
  });

  it('shows no preview line at all for bearer — nothing non-secret to show beyond the badge/name', () => {
    render(<CredentialCard credential={bearerCredential} usageCount={0} onEdit={() => {}} onDelete={() => {}} />);

    expect(screen.getByText('Bearer token')).toBeInTheDocument();
    expect(screen.getByText('staging')).toBeInTheDocument();
    expect(screen.queryByText(/••••/)).not.toBeInTheDocument();
    expect(screen.queryByText('super-secret-token')).not.toBeInTheDocument();
  });

  it('shows a "From spec" tag only when the credential has fromSecurityScheme', () => {
    const { rerender } = render(
      <CredentialCard credential={bearerCredential} usageCount={0} onEdit={() => {}} onDelete={() => {}} />
    );
    expect(screen.queryByText(/From spec:/)).not.toBeInTheDocument();

    const fromSpec: Credential = { ...bearerCredential, fromSecurityScheme: 'bearerAuth' };
    rerender(<CredentialCard credential={fromSpec} usageCount={0} onEdit={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/From spec:/)).toBeInTheDocument();
    expect(screen.getByText('bearerAuth', { selector: 'code' })).toBeInTheDocument();
  });

  it('does not show always-on usage copy — confirms before delete when in use', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<CredentialCard credential={bearerCredential} usageCount={2} onEdit={() => {}} onDelete={onDelete} />);
    expect(screen.queryByText(/Used by/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete staging' }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('used by 2 nodes'));
    expect(onDelete).toHaveBeenCalledWith('c1');

    confirmSpy.mockReturnValue(false);
    onDelete.mockClear();
    await user.click(screen.getByRole('button', { name: 'Delete staging' }));
    expect(onDelete).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('deletes without confirm when unused', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<CredentialCard credential={bearerCredential} usageCount={0} onEdit={() => {}} onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: 'Delete staging' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalledWith('c1');
    confirmSpy.mockRestore();
  });

  it('calls onEdit with the credential when Edit is clicked', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<CredentialCard credential={bearerCredential} usageCount={0} onEdit={onEdit} onDelete={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Edit staging' }));
    expect(onEdit).toHaveBeenCalledWith(bearerCredential);
  });

  it('shows "Needs a value" instead of an empty mask when the secret is missing', () => {
    const incomplete: Credential = { id: 'c1', name: 'staging', type: 'bearer', token: '' };
    render(<CredentialCard credential={incomplete} usageCount={0} onEdit={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('Needs a value')).toBeInTheDocument();
    expect(screen.queryByText(/••••/)).not.toBeInTheDocument();
  });

  it('shows no "Open login page" button for non-cookie credentials', () => {
    render(<CredentialCard credential={bearerCredential} usageCount={0} onEdit={() => {}} onDelete={() => {}} />);
    expect(screen.queryByRole('button', { name: /Open login page|Login/ })).not.toBeInTheDocument();
  });

  describe('cookie', () => {
    const cookieCredential: Credential = {
      id: 'c1',
      name: 'github-login',
      type: 'cookie',
      loginUrl: 'https://app.test/auth/github',
    };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('shows a masked-preview note that there is no stored secret', () => {
      render(<CredentialCard credential={cookieCredential} usageCount={0} onEdit={() => {}} onDelete={() => {}} />);
      expect(screen.getByText(/No stored secret/)).toBeInTheDocument();
    });

    it('the Login button opens the credential\'s loginUrl in a new tab', async () => {
      const user = userEvent.setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      render(<CredentialCard credential={cookieCredential} usageCount={0} onEdit={() => {}} onDelete={() => {}} />);

      await user.click(screen.getByRole('button', { name: 'Open login page for github-login' }));
      expect(openSpy).toHaveBeenCalledWith('https://app.test/auth/github', '_blank');
    });

    it('hides the button entirely when loginUrl is empty', () => {
      const noUrlCredential: Credential = { id: 'c2', name: 'no-url', type: 'cookie', loginUrl: '' };
      render(<CredentialCard credential={noUrlCredential} usageCount={0} onEdit={() => {}} onDelete={() => {}} />);
      expect(screen.queryByRole('button', { name: /Open login page/ })).not.toBeInTheDocument();
    });
  });
});
