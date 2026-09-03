import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useWorkflowStore } from '../../store/workflowStore.js';
import { TagConfigModal } from './TagConfigModal.js';
import { buildNodeLabels } from '@get-enlace/core';
import type { Operation, WorkflowNode } from '../../types.js';

function node(id: string, operationId: string): WorkflowNode {
  return { id, operationId, credentialId: null, fieldValues: {} };
}

const ops: Operation[] = [
  { id: 'GET /orders/{id}', method: 'get', path: '/orders/{id}', parameters: [], requestBodySchema: null, responseSchema: null },
];
const opsById = new Map(ops.map((o) => [o.id, o]));
const labelsFor = (nodes: WorkflowNode[]) => buildNodeLabels(nodes, opsById);

beforeEach(() => {
  useWorkflowStore.setState({ runResult: null });
});

describe('TagConfigModal', () => {
  it('defaults Request to the first ancestor and disables confirm with no ancestors', () => {
    const onConfirm = vi.fn();
    render(
      <TagConfigModal
        ancestorNodes={[]}
        nodeLabels={labelsFor([])}
        initialType="response_body"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText('Insert')).toBeDisabled();
  });

  it('shows the JSONPath filter for response_body and inserts a tag on confirm', () => {
    const onConfirm = vi.fn();
    const a = node('node-a', 'GET /orders/{id}');
    render(
      <TagConfigModal
        ancestorNodes={[a]}
        nodeLabels={labelsFor([a])}
        initialType="response_body"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/blank = whole body/), { target: { value: '$.items[0].id' } });
    fireEvent.click(screen.getByText('Insert'));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'response_body', sourceNodeId: 'node-a', jsonPath: '$.items[0].id' })
    );
  });

  it('shows a header name field for response_header and requires it before confirming', () => {
    const onConfirm = vi.fn();
    const a = node('node-a', 'GET /orders/{id}');
    render(
      <TagConfigModal
        ancestorNodes={[a]}
        nodeLabels={labelsFor([a])}
        initialType="response_header"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );

    expect(screen.getByText('Insert')).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/x-trace-id/), { target: { value: 'x-trace-id' } });
    expect(screen.getByText('Insert')).not.toBeDisabled();

    fireEvent.click(screen.getByText('Insert'));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'response_header', sourceNodeId: 'node-a', headerName: 'x-trace-id' })
    );
  });

  it('shows "no prior run" preview text when the source node has no captured response', () => {
    const a = node('node-a', 'GET /orders/{id}');
    render(
      <TagConfigModal ancestorNodes={[a]} nodeLabels={labelsFor([a])} initialType="response_body" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(screen.getByText(/No prior run captured/)).toBeInTheDocument();
  });

  it('resolves a live preview value from the last run result', () => {
    useWorkflowStore.setState({
      runResult: {
        steps: [
          {
            nodeId: 'node-a',
            request: { method: 'GET', url: 'http://x', headers: {}, credentials: 'omit' },
            response: { status: 200, headers: {}, body: { items: [{ id: 'xyz' }] } },
            timestampStart: '',
            timestampEnd: '',
          },
        ],
      },
    });
    const a = node('node-a', 'GET /orders/{id}');
    render(
      <TagConfigModal ancestorNodes={[a]} nodeLabels={labelsFor([a])} initialType="response_body" onConfirm={() => {}} onCancel={() => {}} />
    );
    fireEvent.change(screen.getByPlaceholderText(/blank = whole body/), { target: { value: 'items[0].id' } });
    expect(screen.getByText('"xyz"')).toBeInTheDocument();
  });

  it('pre-fills fields and offers a delete action when editing an existing tag', () => {
    const onDelete = vi.fn();
    const a = node('node-a', 'GET /orders/{id}');
    render(
      <TagConfigModal
        ancestorNodes={[a]}
        nodeLabels={labelsFor([a])}
        initialType="response_body"
        initialTag={{ id: 'tag1', type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'items[0].id' }}
        onConfirm={() => {}}
        onDelete={onDelete}
        onCancel={() => {}}
      />
    );
    expect(screen.getByDisplayValue('items[0].id')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Remove mapping'));
    expect(onDelete).toHaveBeenCalled();
  });

  it("forces an explicit re-pick when editing a tag whose source node no longer exists, rather than silently keeping the stale one", () => {
    // Regression test for a reported bug: the source node was deleted,
    // then a *different* node was connected and picked as the new source
    // — but Save appeared to work while the tag kept pointing at the
    // deleted node. Root cause: <select value={sourceNodeId}> with no
    // matching <option> (the deleted id isn't in ancestorNodes) falls
    // back to displaying some option while React's own state silently
    // stays on the stale id — so clicking Save without ever firing
    // onChange re-saved the same broken mapping.
    const onConfirm = vi.fn();
    const replacement = node('node-b', 'GET /orders/{id}');
    render(
      <TagConfigModal
        ancestorNodes={[replacement]}
        nodeLabels={labelsFor([replacement])}
        initialType="response_body"
        initialTag={{ id: 'tag1', type: 'response_body', sourceNodeId: 'node-deleted', jsonPath: 'item.title' }}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );

    // Nothing is silently pre-selected from the stale id — Save starts disabled.
    expect(screen.getByText('Save')).toBeDisabled();
    fireEvent.click(screen.getByText('Save'));
    expect(onConfirm).not.toHaveBeenCalled();

    // Only an explicit selection enables it, and with the *new* node's id.
    const requestSelect = screen.getByLabelText('Request');
    fireEvent.change(requestSelect, { target: { value: 'node-b' } });
    expect(screen.getByText('Save')).not.toBeDisabled();
    fireEvent.click(screen.getByText('Save'));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ sourceNodeId: 'node-b' }));
  });
});
