import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkflowFileMenu } from './WorkflowFileMenu.js';
import { useWorkflowStore } from '../store/workflowStore.js';
import { serializeCollection } from '../utils/workflowDocument.js';
import { ENLACE_COLLECTION_FORMAT, ENLACE_COLLECTION_VERSION } from '../types.js';

function resetStore() {
  useWorkflowStore.setState({
    nodes: [],
    connections: [],
    nodePositions: {},
    credentials: [],
    operations: [],
    specInfo: null,
    selectedNodeId: null,
    runResult: null,
    error: null,
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

  it('requires acknowledgement before exporting full credential secrets', async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    useWorkflowStore.setState({
      nodes: [{ id: 'n1', operationId: 'GET /a', credentialId: 'c1', fieldValues: {} }],
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: 'super-secret-token' }],
    });
    render(<WorkflowFileMenu />);

    await user.click(screen.getByRole('button', { name: 'Export' }));
    const dialog = screen.getByRole('dialog', { name: 'Export Enlace collection' });
    await user.click(screen.getByRole('radio', { name: /Full credentials/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('this file can authenticate as you');
    expect(within(dialog).getByRole('button', { name: 'Export' })).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /I understand/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Export' }));

    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Blob;
    expect(await readBlobText(blob)).toContain('super-secret-token');
    expect(await readBlobText(blob)).toContain('"secrets": "included"');
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

  it('confirms before importing a collection that contains full credential secrets', async () => {
    const user = userEvent.setup();
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

    expect(await screen.findByRole('dialog', { name: 'Import collection with secrets?' })).toBeInTheDocument();
    expect(useWorkflowStore.getState().credentials).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Import secrets' }));
    expect(useWorkflowStore.getState().credentials).toEqual([
      { id: 'c1', name: 'staging', type: 'bearer', token: 'imported-secret' },
    ]);
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
          },
        ],
      })
    );
    await waitFor(() => expect(useWorkflowStore.getState().nodes[0]?.id).toBe('n1'));

    await user.upload(input, workflowFile({ format: 'nope', version: 1 }));
    await waitFor(() => expect(useWorkflowStore.getState().error).toMatch(/Unknown Enlace collection format/));
  });
});
