import { describe, expect, it } from 'vitest';
import { buildNodeSuggestionContext } from './aiFieldContext.js';
import type { SchemaField } from './flattenSchema.js';
import type { Credential, Operation, OperationNode } from '../types.js';

function makeOperation(overrides: Partial<Operation>): Operation {
  return {
    id: 'POST /orders',
    method: 'post',
    path: '/orders',
    parameters: [],
    requestBodySchema: null,
    requestBodyContentType: null,
    responseSchema: null,
    ...overrides,
  };
}

function makeNode(overrides: Partial<OperationNode>): OperationNode {
  return {
    id: 'node-1',
    kind: 'operation',
    credentialId: null,
    fieldValues: {},
    operationId: 'POST /customers',
    requestMode: 'form',
    ...overrides,
  };
}

const customerIdField: SchemaField = {
  path: 'body.customerId',
  required: true,
  supported: true,
  type: 'string',
};

const productIdField: SchemaField = {
  path: 'body.productId',
  required: true,
  supported: true,
  type: 'string',
};

describe('buildNodeSuggestionContext', () => {
  it('lists a compatible response field from an ancestor as a candidate binding under its target field', () => {
    const customerOp = makeOperation({
      id: 'POST /customers',
      path: '/customers',
      responseSchema: { type: 'object', properties: { id: { type: 'string' } } },
    });
    const orderOp = makeOperation({});
    const ancestorNode = makeNode({});

    const ctx = buildNodeSuggestionContext({
      fields: [customerIdField],
      operation: orderOp,
      ancestorNodes: [ancestorNode],
      operations: [customerOp, orderOp],
      nodeLabels: new Map([[ancestorNode.id, 'Create customer']]),
      credentials: [],
    });

    expect(ctx.targetFields).toEqual([
      {
        path: 'body.customerId',
        required: true,
        type: 'string',
        format: undefined,
        enum: undefined,
        candidateBindings: [
          {
            tagId: 'af0_0',
            fromNodeId: 'node-1',
            fromNodeLabel: 'Create customer',
            fromResponseFieldPath: 'id',
            type: 'string',
          },
        ],
      },
    ]);
    expect(ctx.ancestorOperations).toEqual([{ nodeLabel: 'Create customer', method: 'post', path: '/customers' }]);
    expect(ctx.currentOperation).toEqual({
      method: 'post',
      path: '/orders',
      summary: undefined,
      requiredCredentialTypes: undefined,
    });
    expect(ctx.availableCredentials).toEqual([]);
  });

  it('excludes a type-incompatible response field from that field\'s own candidateBindings', () => {
    const customerOp = makeOperation({
      id: 'POST /customers',
      path: '/customers',
      responseSchema: { type: 'object', properties: { id: { type: 'integer' } } },
    });
    const orderOp = makeOperation({});
    const ancestorNode = makeNode({});

    const ctx = buildNodeSuggestionContext({
      fields: [customerIdField], // type: 'string'
      operation: orderOp,
      ancestorNodes: [ancestorNode],
      operations: [customerOp, orderOp],
      nodeLabels: new Map([[ancestorNode.id, 'Create customer']]),
      credentials: [],
    });

    expect(ctx.targetFields[0].candidateBindings).toEqual([]);
    // The ancestor operation itself is still listed for context even when
    // none of its fields are usable — the model still benefits from
    // knowing what's upstream.
    expect(ctx.ancestorOperations).toHaveLength(1);
  });

  it('excludes an unsupported response field shape', () => {
    const customerOp = makeOperation({
      id: 'POST /customers',
      path: '/customers',
      responseSchema: { type: 'object', properties: { blob: { oneOf: [{ type: 'string' }, { type: 'integer' }] } } },
    });
    const orderOp = makeOperation({});
    const ancestorNode = makeNode({});

    const ctx = buildNodeSuggestionContext({
      fields: [customerIdField],
      operation: orderOp,
      ancestorNodes: [ancestorNode],
      operations: [customerOp, orderOp],
      nodeLabels: new Map([[ancestorNode.id, 'Create customer']]),
      credentials: [],
    });

    expect(ctx.targetFields[0].candidateBindings).toEqual([]);
  });

  it('skips an ancestor whose operationId no longer resolves against the loaded spec', () => {
    const orderOp = makeOperation({});
    const ancestorNode = makeNode({ operationId: 'DELETE /gone' });

    const ctx = buildNodeSuggestionContext({
      fields: [customerIdField],
      operation: orderOp,
      ancestorNodes: [ancestorNode],
      operations: [orderOp],
      nodeLabels: new Map([[ancestorNode.id, 'Stale node']]),
      credentials: [],
    });

    expect(ctx.targetFields[0].candidateBindings).toEqual([]);
    expect(ctx.ancestorOperations).toEqual([]);
  });

  it('skips a presets-collection ancestor (no operationId at all)', () => {
    const orderOp = makeOperation({});
    const collection = { id: 'node-2', kind: 'presets' as const, credentialId: null, fieldValues: {}, presets: [] };

    const ctx = buildNodeSuggestionContext({
      fields: [customerIdField],
      operation: orderOp,
      ancestorNodes: [collection],
      operations: [orderOp],
      nodeLabels: new Map([[collection.id, 'Presets']]),
      credentials: [],
    });

    expect(ctx.targetFields[0].candidateBindings).toEqual([]);
    expect(ctx.ancestorOperations).toEqual([]);
  });

  it('mints distinct tagIds per ancestor and per field, stable within one call, shared across target fields', () => {
    const opA = makeOperation({
      id: 'POST /a',
      path: '/a',
      responseSchema: { type: 'object', properties: { x: { type: 'string' }, y: { type: 'string' } } },
    });
    const opB = makeOperation({
      id: 'POST /b',
      path: '/b',
      responseSchema: { type: 'object', properties: { z: { type: 'string' } } },
    });
    const orderOp = makeOperation({});
    const nodeA = makeNode({ id: 'node-a', operationId: 'POST /a' });
    const nodeB = makeNode({ id: 'node-b', operationId: 'POST /b' });

    const ctx = buildNodeSuggestionContext({
      fields: [customerIdField, productIdField],
      operation: orderOp,
      ancestorNodes: [nodeA, nodeB],
      operations: [opA, opB, orderOp],
      nodeLabels: new Map([
        [nodeA.id, 'A'],
        [nodeB.id, 'B'],
      ]),
      credentials: [],
    });

    // Both string target fields see the same three upstream string fields, under the same tagIds.
    expect(ctx.targetFields[0].candidateBindings.map((b) => b.tagId)).toEqual(['af0_0', 'af0_1', 'af1_0']);
    expect(ctx.targetFields[1].candidateBindings.map((b) => b.tagId)).toEqual(['af0_0', 'af0_1', 'af1_0']);
  });

  it('builds one entry in targetFields per input field, in the same order', () => {
    const orderOp = makeOperation({});
    const ctx = buildNodeSuggestionContext({
      fields: [customerIdField, productIdField],
      operation: orderOp,
      ancestorNodes: [],
      operations: [orderOp],
      nodeLabels: new Map(),
      credentials: [],
    });

    expect(ctx.targetFields.map((f) => f.path)).toEqual(['body.customerId', 'body.productId']);
  });

  it('passes the operation\'s requiredCredentialTypes through to currentOperation as-is', () => {
    const orderOp = makeOperation({ requiredCredentialTypes: ['bearer', 'apiKey'] });
    const ctx = buildNodeSuggestionContext({
      fields: [],
      operation: orderOp,
      ancestorNodes: [],
      operations: [orderOp],
      nodeLabels: new Map(),
      credentials: [],
    });

    expect(ctx.currentOperation.requiredCredentialTypes).toEqual(['bearer', 'apiKey']);
  });

  it('reduces each credential to id/name/type only, never a secret field', () => {
    const orderOp = makeOperation({});
    const credentials: Credential[] = [
      { id: 'cred-1', name: 'Prod bearer', type: 'bearer', token: 'super-secret-token' },
      { id: 'cred-2', name: 'Basic auth', type: 'basic', username: 'admin', password: 'hunter2' },
    ];

    const ctx = buildNodeSuggestionContext({
      fields: [],
      operation: orderOp,
      ancestorNodes: [],
      operations: [orderOp],
      nodeLabels: new Map(),
      credentials,
    });

    expect(ctx.availableCredentials).toEqual([
      { id: 'cred-1', name: 'Prod bearer', type: 'bearer' },
      { id: 'cred-2', name: 'Basic auth', type: 'basic' },
    ]);
    expect(JSON.stringify(ctx.availableCredentials)).not.toContain('super-secret-token');
    expect(JSON.stringify(ctx.availableCredentials)).not.toContain('hunter2');
  });
});
