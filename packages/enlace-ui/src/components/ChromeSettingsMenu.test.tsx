import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChromeSettingsMenu } from './ChromeSettingsMenu.js';
import { useWorkflowStore } from '../store/workflowStore.js';

describe('ChromeSettingsMenu', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      credentials: [],
      nodes: [],
      connections: [],
      nodePositions: {},
      isRunning: false,
      credentialReview: null,
      operations: [],
      specInfo: null,
    });
  });

  it('opens a settings menu with Credentials, Export, and Import', async () => {
    const user = userEvent.setup();
    render(<ChromeSettingsMenu />);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Settings' }));

    const menu = screen.getByRole('menu', { name: 'Settings' });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Credentials (0)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Export' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Import' })).toBeInTheDocument();
  });

  it('Credentials menu item opens the credentials drawer', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: 'secret' }],
    });
    render(<ChromeSettingsMenu />);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('menuitem', { name: 'Credentials (1)' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Credentials' })).toBeInTheDocument();
  });

  it('Export menu item opens the export dialog when the canvas has nodes', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      nodes: [{ id: 'n1', operationId: 'GET /a', credentialId: null, fieldValues: {} }],
      nodePositions: { n1: { x: 0, y: 0 } },
    });
    render(<ChromeSettingsMenu />);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export' }));

    expect(screen.getByRole('dialog', { name: 'Export Enlace collection' })).toBeInTheDocument();
  });
});
