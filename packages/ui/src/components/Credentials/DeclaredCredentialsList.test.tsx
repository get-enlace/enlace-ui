import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeclaredCredentialsList } from './DeclaredCredentialsList.js';
import type { DeclaredCredential } from '@get-enlace/core';

const bearerEntry: DeclaredCredential = {
  schemeName: 'bearerAuth',
  description: 'JWT bearer auth',
  template: { name: 'bearerAuth', type: 'bearer', token: '', fromSecurityScheme: 'bearerAuth' },
};

const apiKeyEntry: DeclaredCredential = {
  schemeName: 'apiKeyAuth',
  template: {
    name: 'apiKeyAuth',
    type: 'apiKey',
    paramName: 'X-API-Key',
    in: 'header',
    key: '',
    fromSecurityScheme: 'apiKeyAuth',
  },
};

describe('DeclaredCredentialsList', () => {
  it('renders nothing when entries is empty', () => {
    const { container } = render(<DeclaredCredentialsList entries={[]} onConfigure={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each entry's scheme name, type label, and description", () => {
    render(<DeclaredCredentialsList entries={[bearerEntry]} onConfigure={() => {}} />);

    expect(screen.getByText('Declared in spec')).toBeInTheDocument();
    expect(screen.getByText('bearerAuth')).toBeInTheDocument();
    expect(screen.getByText(/Bearer token/)).toBeInTheDocument();
    expect(screen.getByText(/JWT bearer auth/)).toBeInTheDocument();
  });

  it('renders one row (and one Configure button) per entry', () => {
    render(<DeclaredCredentialsList entries={[bearerEntry, apiKeyEntry]} onConfigure={() => {}} />);
    expect(screen.getAllByRole('button', { name: 'Configure' })).toHaveLength(2);
  });

  it('calls onConfigure with the entry when its "Configure" button is clicked', async () => {
    const user = userEvent.setup();
    const onConfigure = vi.fn();
    render(<DeclaredCredentialsList entries={[bearerEntry, apiKeyEntry]} onConfigure={onConfigure} />);

    await user.click(screen.getAllByRole('button', { name: 'Configure' })[1]);
    expect(onConfigure).toHaveBeenCalledWith(apiKeyEntry);
  });
});
