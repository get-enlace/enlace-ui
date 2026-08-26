import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CredentialCard } from './CredentialCard.js';
import type { Credential } from '../types.js';

const bearerCredential: Credential = { id: 'c1', name: 'staging', type: 'bearer', token: 'super-secret-token' };

describe('CredentialCard', () => {
  it('shows the type badge, name, and masked preview — never the raw secret', () => {
    render(<CredentialCard credential={bearerCredential} usageCount={0} onEdit={() => {}} onDelete={() => {}} />);

    expect(screen.getByText('Bearer token')).toBeInTheDocument();
    expect(screen.getByText('staging')).toBeInTheDocument();
    expect(screen.getByText(/••••/)).toHaveTextContent('••••oken');
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

  it('shows a "Used by N node(s)" hint only when usageCount is greater than zero, with correct singular/plural', () => {
    const { rerender } = render(
      <CredentialCard credential={bearerCredential} usageCount={0} onEdit={() => {}} onDelete={() => {}} />
    );
    expect(screen.queryByText(/Used by/)).not.toBeInTheDocument();

    rerender(<CredentialCard credential={bearerCredential} usageCount={1} onEdit={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/Used by 1 node —/)).toBeInTheDocument();

    rerender(<CredentialCard credential={bearerCredential} usageCount={2} onEdit={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/Used by 2 nodes —/)).toBeInTheDocument();
  });

  it('calls onEdit/onDelete with the credential/id when those buttons are clicked', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<CredentialCard credential={bearerCredential} usageCount={0} onEdit={onEdit} onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: 'Edit staging' }));
    expect(onEdit).toHaveBeenCalledWith(bearerCredential);

    await user.click(screen.getByRole('button', { name: 'Delete staging' }));
    expect(onDelete).toHaveBeenCalledWith('c1');
  });

  it('shows no "Log in" button for non-popup_login credentials', () => {
    render(<CredentialCard credential={bearerCredential} usageCount={0} onEdit={() => {}} onDelete={() => {}} />);
    expect(screen.queryByRole('button', { name: /Log in/ })).not.toBeInTheDocument();
  });

  describe('popup_login', () => {
    const popupCredential: Credential = {
      id: 'c1',
      name: 'github-login',
      type: 'popup_login',
      loginUrl: 'https://app.test/auth/github',
    };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('shows a masked-preview note that there is no stored secret', () => {
      render(<CredentialCard credential={popupCredential} usageCount={0} onEdit={() => {}} onDelete={() => {}} />);
      expect(screen.getByText(/no stored secret/)).toBeInTheDocument();
    });

    it('the "Log in" button opens the credential\'s loginUrl in a popup', async () => {
      const user = userEvent.setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      render(<CredentialCard credential={popupCredential} usageCount={0} onEdit={() => {}} onDelete={() => {}} />);

      await user.click(screen.getByRole('button', { name: 'Log in for github-login' }));
      expect(openSpy).toHaveBeenCalledWith('https://app.test/auth/github', '_blank', expect.any(String));
    });
  });
});
