import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkflowFileMenu } from './WorkflowFileMenu.js';
import { useWorkflowStore } from '../store/workflowStore.js';
import { serializeCollection } from '../utils/workflowDocument.js';
import { encryptCollection } from '../utils/collectionCrypto.js';
import { ENLACE_COLLECTION_FORMAT, ENLACE_COLLECTION_VERSION } from '../types.js';

function resetStore() {
  useWorkflowStore.setState({
    nodes: [],
    connections: [],
    nodePositions: {},
    credentials: [],
    operations: [],
    specInfo: null,
    workflowName: 'Untitled',
    selectedNodeId: null,
    runResult: null,
    error: null,
    credentialReview: null,
  });
}

function workflowFile(contents: unknown, name = 'chain.enlace') {
  return new File([JSON.stringify(contents)], name, { type: 'application/json' });
}

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsText(blob);
  });
}

describe('WorkflowFileMenu', () => {
  beforeEach(() => {
    resetStore();
    Object.defineProperty(URL, 'createObjectURL', {
      writable: true,
      configurable: true,
      value: vi.fn(() => 'blob:test'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      writable: true,
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disables Export when the canvas is empty', () => {
    render(<WorkflowFileMenu />);
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });

  it('opens a named export dialog and defaults to a secret-stripped collection', async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    useWorkflowStore.setState({
      nodes: [{ id: 'n1', operationId: 'GET /a', credentialId: 'c1', fieldValues: {} }],
      nodePositions: { n1: { x: 0, y: 0 } },
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: 'super-secret-token' }],
    });
    render(<WorkflowFileMenu />);

    await user.click(screen.getByRole('button', { name: 'Export' }));
    const dialog = screen.getByRole('dialog', { name: 'Export Enlace collection' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Untitled');
    expect(screen.getByRole('radio', { name: /Partial/ })).toBeChecked();
    await user.clear(screen.getByRole('textbox', { name: 'Name' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'My Chain');
    await user.click(within(dialog).getByRole('button', { name: 'Export' }));

    expect(click).toHaveBeenCalled();
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    const text = await readBlobText(blob);
    expect(text).not.toContain('super-secret-token');
    expect(text).toContain('"format": "enlace-collection"');
    expect(text).toContain('"name": "My Chain"');
    expect(text).toContain('"secrets": "stripped"');
    click.mockRestore();
  });

  it('gates full-credential export behind a matching 8+ character password, then downloads an encrypted envelope', async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    useWorkflowStore.setState({
      nodes: [{ id: 'n1', operationId: 'GET /a', credentialId: 'c1', fieldValues: {} }],
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: 'super-secret-token' }],
    });
    render(<WorkflowFileMenu />);

    await user.click(screen.getByRole('button', { name: 'Export' }));
    const dialog = screen.getByRole('dialog', { name: 'Export Enlace collection' });
    const exportButton = within(dialog).getByRole('button', { name: 'Export' });
    await user.click(screen.getByRole('radio', { name: /Full credentials/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('this file can authenticate as you');
    expect(exportButton).toBeDisabled();

    // Too short: still gated.
    await user.type(screen.getByLabelText('Password'), 'short');
    expect(exportButton).toBeDisabled();
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();

    // Long enough but confirmation doesn't match: still gated.
    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.type(screen.getByLabelText('Confirm password'), 'a different password');
    expect(exportButton).toBeDisabled();
    expect(screen.getByText(/don't match/i)).toBeInTheDocument();

    // Matching: unblocked.
    await user.clear(screen.getByLabelText('Confirm password'));
    await user.type(screen.getByLabelText('Confirm password'), 'correct horse battery staple');
    expect(exportButton).not.toBeDisabled();

    await user.click(exportButton);
    await waitFor(() => expect(click).toHaveBeenCalled());

    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Blob;
    const text = await readBlobText(blob);
    const envelope = JSON.parse(text);
    expect(envelope.format).toBe('enlace-collection-encrypted');
    expect(envelope.kdf.name).toBe('PBKDF2');
    expect(envelope.cipher.name).toBe('AES-GCM');
    expect(text).not.toContain('super-secret-token');
    click.mockRestore();
  });

  it('asks to confirm before replacing a non-empty canvas, then replaces on confirm', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      nodes: [{ id: 'old', operationId: 'GET /old', credentialId: null, fieldValues: {} }],
      nodePositions: { old: { x: 0, y: 0 } },
    });
    const incoming = serializeCollection({
      nodes: [{ id: 'n-new', operationId: 'GET /new', credentialId: null, fieldValues: {} }],
      connections: [],
      nodePositions: { 'n-new': { x: 8, y: 16 } },
      credentials: [],
    });
    render(<WorkflowFileMenu />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, workflowFile(incoming));

    expect(await screen.findByRole('dialog', { name: 'Replace current canvas?' })).toBeInTheDocument();
    expect(useWorkflowStore.getState().nodes[0].id).toBe('old');

    await user.click(screen.getByRole('button', { name: 'Replace' }));

    expect(useWorkflowStore.getState().nodes[0].id).toBe('n-new');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('imports a legacy plaintext "with secrets" file (an older build\'s export) with a loud unencrypted warning', async () => {
    const user = userEvent.setup();
    // Simulates a file this repo's older build produced: secrets:"included"
    // with no encryption envelope at all — must stay importable, unlike a
    // corrupted/malformed file.
    const incoming = serializeCollection({
      name: 'Private backup',
      includeSecrets: true,
      nodes: [{ id: 'n-new', operationId: 'GET /new', credentialId: 'c1', fieldValues: {} }],
      connections: [],
      nodePositions: {},
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: 'imported-secret' }],
    });
    render(<WorkflowFileMenu />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, workflowFile(incoming));

    const dialog = await screen.findByRole('dialog', { name: 'Import collection with secrets?' });
    expect(dialog).toHaveTextContent('This collection contains full credential secrets');
    expect(dialog).not.toHaveTextContent('password-protected');
    expect(dialog).toHaveTextContent('exported unencrypted by an older version of Enlace');
    expect(useWorkflowStore.getState().credentials).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Import secrets' }));
    expect(useWorkflowStore.getState().credentials).toEqual([
      { id: 'c1', name: 'staging', type: 'bearer', token: 'imported-secret' },
    ]);
  });

  it('imports a password-protected collection through the decrypt prompt, rejecting a wrong password first', async () => {
    const user = userEvent.setup();
    const incoming = serializeCollection({
      name: 'Private backup',
      includeSecrets: true,
      nodes: [{ id: 'n-new', operationId: 'GET /new', credentialId: 'c1', fieldValues: {} }],
      connections: [],
      nodePositions: {},
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: 'imported-secret' }],
    });
    const envelope = await encryptCollection(incoming, 'hunter22222');
    render(<WorkflowFileMenu />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, workflowFile(envelope));

    const decryptDialog = await screen.findByRole('dialog', { name: 'Enter password' });
    expect(within(decryptDialog).getByRole('button', { name: 'Decrypt' })).toBeDisabled();

    await user.type(screen.getByLabelText('Password'), 'wrong password');
    await user.click(screen.getByRole('button', { name: 'Decrypt' }));

    // Real PBKDF2 at 600k iterations under jsdom's WebCrypto can comfortably
    // exceed RTL's default 1000ms poll window — this isn't a fake timer, it's
    // the actual crypto.subtle work the component is waiting on, so give it
    // real headroom rather than papering over slowness with a shorter wait.
    expect(
      await screen.findByText('Incorrect password, or this file is corrupted.', {}, { timeout: 3000 })
    ).toBeInTheDocument();
    // Still on the password prompt — nothing was applied to the canvas/store.
    expect(screen.getByRole('dialog', { name: 'Enter password' })).toBeInTheDocument();
    expect(useWorkflowStore.getState().credentials).toEqual([]);

    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'hunter22222');
    await user.click(screen.getByRole('button', { name: 'Decrypt' }));

    const confirmDialog = await screen.findByRole(
      'dialog',
      { name: 'Import collection with secrets?' },
      { timeout: 3000 }
    );
    expect(confirmDialog).toHaveTextContent('was password-protected');
    expect(screen.queryByText(/older version of Enlace/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Import secrets' }));
    expect(useWorkflowStore.getState().credentials).toEqual([
      { id: 'c1', name: 'staging', type: 'bearer', token: 'imported-secret' },
    ]);
  });

  it('hands stripped credentials to the drawer for review instead of naming them in the header', async () => {
    const user = userEvent.setup();
    const incoming = serializeCollection({
      nodes: [{ id: 'n-new', operationId: 'GET /new', credentialId: 'c1', fieldValues: {} }],
      connections: [],
      nodePositions: {},
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: 'super-secret-token' }],
    });
    render(<WorkflowFileMenu />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, workflowFile(incoming));

    await waitFor(() =>
      expect(useWorkflowStore.getState().credentialReview).toEqual({
        needsValueIds: ['c1'],
        secretsDiscarded: false,
      })
    );
    expect(screen.queryByText(/needs a value/i)).not.toBeInTheDocument();
  });

  it('imports immediately when the canvas is empty, and surfaces a parse error for a bad file', async () => {
    const user = userEvent.setup();
    render(<WorkflowFileMenu />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(
      input,
      workflowFile({
        format: ENLACE_COLLECTION_FORMAT,
        version: ENLACE_COLLECTION_VERSION,
        name: 'Imported',
        exportedAt: '',
        secrets: 'stripped',
        credentials: [],
        workflows: [
          {
            id: 'workflow-1',
            name: 'Imported',
            specHint: { operationIds: [] },
            nodes: [{ id: 'n1', operationId: 'GET /a', credentialId: null, fieldValues: {} }],
            connections: [],
            nodePositions: { n1: { x: 1, y: 2 } },
            groups: [],
          },
        ],
      })
    );
    await waitFor(() => expect(useWorkflowStore.getState().nodes[0]?.id).toBe('n1'));

    await user.upload(input, workflowFile({ format: 'nope', version: 1 }));
    await waitFor(() => expect(useWorkflowStore.getState().error).toMatch(/Unknown Enlace collection format/));
  });
});
