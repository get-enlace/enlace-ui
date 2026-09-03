import { describe, it, expect } from 'vitest';
import { buildNodeLabels, formatWaitDuration } from './nodeLabel.js';
import type { Operation, WorkflowNode } from './types.js';

function makeOperation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: 'POST /customers',
    method: 'post',
    path: '/customers',
    parameters: [],
    requestBodySchema: null,
    responseSchema: null,
    ...overrides,
  };
}

function makeNode(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: 'node-1',
    operationId: 'POST /customers',
    credentialId: null,
    fieldValues: {},
    ...overrides,
  };
}

describe('buildNodeLabels', () => {
  it('prefers the spec-declared operationId over the synthetic "METHOD /path" id', () => {
    const operationsById = new Map([['POST /customers', makeOperation({ operationId: 'createCustomer' })]]);
    const node = makeNode();
    expect(buildNodeLabels([node], operationsById).get(node.id)).toBe('createCustomer');
  });

  it('falls back to the synthetic id when the spec declares no operationId', () => {
    const operationsById = new Map([['POST /customers', makeOperation({ operationId: undefined })]]);
    const node = makeNode();
    expect(buildNodeLabels([node], operationsById).get(node.id)).toBe('POST /customers');
  });

  it('falls back to the node\'s raw operationId when the operation can\'t be found', () => {
    const node = makeNode();
    expect(buildNodeLabels([node], new Map()).get(node.id)).toBe('POST /customers');
  });

  it('never shows a node id — a single node for an operation gets no suffix at all', () => {
    const operationsById = new Map([['POST /customers', makeOperation({ operationId: 'createCustomer' })]]);
    const node = makeNode({ id: 'a-very-long-internal-id' });
    expect(buildNodeLabels([node], operationsById).get(node.id)).toBe('createCustomer');
  });

  it('numbers nodes that share the same operation, in the order given', () => {
    const operationsById = new Map([['POST /customers', makeOperation({ operationId: 'createCustomer' })]]);
    const a = makeNode({ id: 'node-a' });
    const b = makeNode({ id: 'node-b' });
    const labels = buildNodeLabels([a, b], operationsById);
    expect(labels.get('node-a')).toBe('createCustomer #1');
    expect(labels.get('node-b')).toBe('createCustomer #2');
  });

  it('only numbers the operation that actually repeats, leaving unique ones bare', () => {
    const operationsById = new Map([
      ['POST /customers', makeOperation({ id: 'POST /customers', operationId: 'createCustomer' })],
      ['POST /orders', makeOperation({ id: 'POST /orders', operationId: 'createOrder' })],
    ]);
    const a = makeNode({ id: 'node-a', operationId: 'POST /customers' });
    const b = makeNode({ id: 'node-b', operationId: 'POST /customers' });
    const c = makeNode({ id: 'node-c', operationId: 'POST /orders' });
    const labels = buildNodeLabels([a, b, c], operationsById);
    expect(labels.get('node-a')).toBe('createCustomer #1');
    expect(labels.get('node-b')).toBe('createCustomer #2');
    expect(labels.get('node-c')).toBe('createOrder');
  });

  it('labels a wait node by its duration, never by operationId (it has none)', () => {
    const node: WorkflowNode = { id: 'w1', kind: 'wait', credentialId: null, fieldValues: {}, durationMs: 2000 };
    expect(buildNodeLabels([node], new Map()).get('w1')).toBe('Wait 2s');
  });

  it('numbers wait nodes that share the same duration, same as repeated operations', () => {
    const a: WorkflowNode = { id: 'w1', kind: 'wait', credentialId: null, fieldValues: {}, durationMs: 500 };
    const b: WorkflowNode = { id: 'w2', kind: 'wait', credentialId: null, fieldValues: {}, durationMs: 500 };
    const labels = buildNodeLabels([a, b], new Map());
    expect(labels.get('w1')).toBe('Wait 500ms #1');
    expect(labels.get('w2')).toBe('Wait 500ms #2');
  });
});

describe('formatWaitDuration', () => {
  it('renders sub-second durations in milliseconds', () => {
    expect(formatWaitDuration(0)).toBe('0ms');
    expect(formatWaitDuration(500)).toBe('500ms');
  });

  it('renders whole seconds with no decimal', () => {
    expect(formatWaitDuration(1000)).toBe('1s');
    expect(formatWaitDuration(2000)).toBe('2s');
  });

  it('renders fractional seconds with one decimal place', () => {
    expect(formatWaitDuration(2500)).toBe('2.5s');
  });
});
