import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { acceptCompletion, completionStatus, startCompletion } from '@codemirror/autocomplete';
import { useWorkflowStore } from '../../../store/workflowStore.js';
import {
  DebugConsole,
  buildConsoleInputExtensions,
  buildConsoleNodeContext,
  evaluateConsoleQuery,
  extractPathParams,
  extractQueryParams,
  formatOneLevel,
  getConsoleCompletions,
  handleConsoleEnter,
  resolveConsoleFocus,
} from './index.js';
import type { Operation, RunStep, WorkflowNode } from '../../../types.js';

function node(id: string, operationId = 'GET /customers/{id}'): WorkflowNode {
  return { id, operationId, credentialId: null, fieldValues: {} };
}

const customerOp: Operation = {
  id: 'GET /customers/{id}',
  method: 'get',
  path: '/customers/{id}',
  parameters: [],
  requestBodySchema: null,
  responseSchema: null,
  operationId: 'getCustomerById',
};

function step(nodeId: string, body: unknown): RunStep {
  return {
    nodeId,
    request: {
      method: 'GET',
      url: 'http://localhost:4000/customers/abc-123?limit=10&sort=name',
      headers: { Authorization: 'Bearer secret', Accept: 'application/json' },
      credentials: 'omit',
    },
    response: { status: 200, headers: { 'content-type': 'application/json' }, body },
    timestampStart: '2024-01-01T00:00:00.000Z',
    timestampEnd: '2024-01-01T00:00:01.000Z',
  };
}

beforeEach(() => {
  useWorkflowStore.setState({
    nodes: [],
    connections: [],
    operations: [],
    selectedNodeId: null,
    stepStatusByNodeId: {},
    runResult: null,
    previewRequestByNodeId: {},
    credentials: [],
    debugConsoleOpen: true,
  });
});

describe('extractPathParams / extractQueryParams', () => {
  it('extracts template params and query params', () => {
    expect(extractPathParams('/customers/{id}', '/customers/abc-123')).toEqual({ id: 'abc-123' });
    expect(extractQueryParams('http://x/a?limit=10&sort=name')).toEqual({ limit: '10', sort: 'name' });
  });
});

describe('buildConsoleNodeContext', () => {
  it('uses params / query / payload naming', () => {
    const s = step('n1', { id: 1 });
    const ctx = buildConsoleNodeContext(s.request, {
      response: s.response,
      operationPath: '/customers/{id}',
    });
    expect(ctx.request.headers.Authorization).toBe('[redacted]');
    expect(ctx.request.params).toEqual({ id: 'abc-123' });
    expect(ctx.request.query).toEqual({ limit: '10', sort: 'name' });
    expect(ctx.request.payload).toBeUndefined();
    expect(ctx.response?.body).toEqual({ id: 1 });
  });
});

describe('formatOneLevel', () => {
  it('lists only one level of children', () => {
    const text = formatOneLevel({
      nodes: { a: 1, b: 2 },
      credentials: { x: true },
      focus: null,
      focusKey: null,
    });
    expect(text).toContain('nodes');
    expect(text).toContain('(2)');
    expect(text).not.toContain('params');
    expect(text).not.toMatch(/\ba\b/);
  });
});

describe('resolveConsoleFocus', () => {
  it('builds nodes + credentials and mirrors the focused node', () => {
    const nodes = [node('a'), node('b')];
    const focus = resolveConsoleFocus({
      nodes,
      orderedNodes: nodes,
      selectedNodeId: 'b',
      stepStatusByNodeId: { a: 'completed', b: 'completed' },
      stepsByNodeId: new Map([
        ['a', step('a', { a: 1 })],
        ['b', step('b', { b: 2 })],
      ]),
      previewRequestByNodeId: {},
      operationsById: new Map([[customerOp.id, customerOp]]),
      nodeLabels: new Map([
        ['a', 'getCustomerById'],
        ['b', 'getCustomerById #2'],
      ]),
      credentials: [{ id: 'c1', name: 'bearerAuth', type: 'bearer', token: 't' }],
    });
    expect(focus.context.focusKey).toBe('getCustomerById_2');
    expect(focus.context.nodeOrder).toEqual(['getCustomerById', 'getCustomerById_2']);
    expect(focus.context.nodes.getCustomerById.response?.body).toEqual({ a: 1 });
    expect(focus.context.request?.params.id).toBe('abc-123');
    expect(focus.context.credentials.bearerAuth).toMatchObject({
      name: 'bearerAuth',
      type: 'bearer',
      complete: true,
    });
  });
});

describe('evaluateConsoleQuery', () => {
  const focus = resolveConsoleFocus({
    nodes: [node('a'), node('b')],
    orderedNodes: [node('a'), node('b')],
    selectedNodeId: 'b',
    stepStatusByNodeId: { a: 'completed', b: 'completed' },
    stepsByNodeId: new Map([
      ['a', step('a', { id: 'first' })],
      ['b', step('b', { id: 'pet-1' })],
    ]),
    previewRequestByNodeId: {},
    operationsById: new Map([[customerOp.id, customerOp]]),
    nodeLabels: new Map([
      ['a', 'stepA'],
      ['b', 'stepB'],
    ]),
    credentials: [],
  });

  it('prints one level for $', () => {
    const result = evaluateConsoleQuery(focus.context, '$');
    expect(result.kind).toBe('print');
    if (result.kind !== 'print') return;
    expect(result.resultText).toContain('nodes');
    expect(result.resultText).toContain('credentials');
    expect(result.resultText).not.toContain('"params"');
  });

  it('lists nodes in order', () => {
    const result = evaluateConsoleQuery(focus.context, '$.nodes');
    expect(result.kind).toBe('print');
    if (result.kind !== 'print') return;
    expect(result.resultText).toMatch(/^\[0\] stepA/);
    expect(result.resultText).toContain('[1] stepB');
    expect(result.resultText).toContain('→ 200');
  });

  it('expands one node one level', () => {
    const result = evaluateConsoleQuery(focus.context, '$.nodes.stepA');
    expect(result.kind).toBe('print');
    if (result.kind !== 'print') return;
    expect(result.resultText).toContain('request');
    expect(result.resultText).toContain('response');
    expect(result.resultText).toContain('GET /customers/abc-123');
  });

  it('handles clear and help macros', () => {
    expect(evaluateConsoleQuery(focus.context, 'clear').kind).toBe('clear');
    expect(evaluateConsoleQuery(focus.context, 'cls').kind).toBe('clear');
    const help = evaluateConsoleQuery(focus.context, 'help');
    expect(help.kind).toBe('help');
    if (help.kind === 'help') expect(help.resultText).toContain('clear');
  });

  it('still resolves leaf paths', () => {
    const result = evaluateConsoleQuery(focus.context, 'request.params.id');
    expect(result).toEqual({ kind: 'print', query: 'request.params.id', resultText: '"abc-123"' });
  });
});

describe('getConsoleCompletions', () => {
  const focus = resolveConsoleFocus({
    nodes: [node('a'), node('b')],
    orderedNodes: [node('a'), node('b')],
    selectedNodeId: 'b',
    stepStatusByNodeId: { a: 'completed', b: 'completed' },
    stepsByNodeId: new Map([
      ['a', step('a', { id: 'first' })],
      ['b', step('b', { id: 'pet-1' })],
    ]),
    previewRequestByNodeId: {},
    operationsById: new Map([[customerOp.id, customerOp]]),
    nodeLabels: new Map([
      ['a', 'stepA'],
      ['b', 'stepB'],
    ]),
    credentials: [],
  });

  it('suggests macros and shortcuts for a bare prefix', () => {
    const result = getConsoleCompletions(focus.context, 'hel');
    expect(result?.options.map((o) => o.label)).toContain('help');
  });

  it('suggests node keys under $.nodes.', () => {
    const result = getConsoleCompletions(focus.context, '$.nodes.');
    expect(result?.options.map((o) => o.label)).toEqual(['stepA', 'stepB']);
  });

  it('suggests request fields under a node', () => {
    const result = getConsoleCompletions(focus.context, '$.nodes.stepA.request.par');
    expect(result?.options.map((o) => o.label)).toEqual(['params']);
  });
});

describe('buildConsoleInputExtensions', () => {
  it('Enter accepts the highlighted path completion instead of submitting', async () => {
    const focus = resolveConsoleFocus({
      nodes: [node('a')],
      orderedNodes: [node('a')],
      selectedNodeId: 'a',
      stepStatusByNodeId: { a: 'completed' },
      stepsByNodeId: new Map([['a', step('a', { id: 1 })]]),
      previewRequestByNodeId: {},
      operationsById: new Map([[customerOp.id, customerOp]]),
      nodeLabels: new Map([['a', 'stepA']]),
      credentials: [],
    });

    const submitted: string[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({
        doc: '$.nodes.',
        selection: { anchor: '$.nodes.'.length },
        extensions: buildConsoleInputExtensions({
          getContext: () => focus.context,
          onSubmit: (q) => submitted.push(q),
          onHistoryPrev: () => {},
          onHistoryNext: () => {},
        }),
      }),
      parent: host,
    });

    startCompletion(view);
    await waitFor(() => expect(completionStatus(view.state)).toBe('active'));

    handleConsoleEnter(view, (q) => submitted.push(q));
    expect(view.state.doc.toString()).toMatch(/^\$\.nodes\.stepA/);
    expect(submitted).toEqual([]);

    // Line already matches — next Enter submits.
    handleConsoleEnter(view, (q) => submitted.push(q));
    expect(submitted).toEqual(['$.nodes.stepA']);

    view.destroy();
    host.remove();
  });
});

describe('DebugConsole', () => {
  function consoleText(input: HTMLElement): string {
    return (input.textContent ?? '').replace(/\u200b/g, '');
  }

  it('clear macro clears the screen but keeps ↑ recall', async () => {
    const user = userEvent.setup();
    useWorkflowStore.setState({
      nodes: [node('n1')],
      operations: [customerOp],
      selectedNodeId: 'n1',
      stepStatusByNodeId: { n1: 'completed' },
      runResult: { steps: [step('n1', { id: 'pet-1' })] },
    });

    const { container } = render(<DebugConsole />);
    const input = await waitFor(() => {
      const el = container.querySelector('.cm-content') as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    await user.click(input);
    await user.keyboard('$');
    await user.keyboard('{Escape}{Enter}');
    const log = screen.getByRole('log', { name: 'Console history' });
    await waitFor(() => expect(log.querySelector('.debug-console__output')).toHaveTextContent(/nodes/));

    await user.keyboard('clear{Enter}');
    await waitFor(() => expect(log.querySelector('.debug-console__output')).toBeNull());
    expect(screen.getByText(/Type/)).toBeInTheDocument();

    await user.keyboard('{ArrowUp}');
    await waitFor(() => expect(consoleText(input)).toBe('clear'));
    await user.keyboard('{ArrowUp}');
    await waitFor(() => expect(consoleText(input)).toBe('$'));
  });
});
