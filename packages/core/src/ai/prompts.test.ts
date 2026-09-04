import { describe, expect, it } from 'vitest';
import { buildNodeSuggestionMessages, NO_SUGGESTION_SENTINEL, parseNodeSuggestionResponse } from './prompts.js';
import type { AiNodeSuggestionContext, AiTargetField } from './types.js';

function makeField(overrides: Partial<AiTargetField> = {}): AiTargetField {
  return {
    path: 'body.customerId',
    required: true,
    type: 'string',
    candidateBindings: [
      { tagId: 'af0_0', fromNodeId: 'node-1', fromNodeLabel: 'Create customer', fromResponseFieldPath: 'id', type: 'string' },
    ],
    ...overrides,
  };
}

function makeContext(overrides: Partial<AiNodeSuggestionContext> = {}): AiNodeSuggestionContext {
  return {
    targetFields: [makeField()],
    currentOperation: { method: 'post', path: '/orders' },
    ancestorOperations: [{ nodeLabel: 'Create customer', method: 'post', path: '/customers' }],
    availableCredentials: [{ id: 'cred-1', name: 'Prod bearer', type: 'bearer' }],
    ...overrides,
  };
}

describe('buildNodeSuggestionMessages', () => {
  it('explains what Enlace, a node, and a credential are in the system prompt', () => {
    const [system] = buildNodeSuggestionMessages(makeContext());
    expect(system.content).toContain('Enlace');
    expect(system.content.toLowerCase()).toContain('node');
    expect(system.content.toLowerCase()).toContain('credential');
  });

  it('lists every field candidate binding as a {{enlace:<tagId>}} placeholder in the user message', () => {
    const [, user] = buildNodeSuggestionMessages(makeContext());
    expect(user.content).toContain('{{enlace:af0_0}}');
  });

  it('explains the reply format and sentinel in the system prompt, credential line first', () => {
    const [system] = buildNodeSuggestionMessages(makeContext());
    expect(system.role).toBe('system');
    expect(system.content).toContain('<key>: <answer>');
    expect(system.content).toContain('first "credential"');
    expect(system.content).toContain(NO_SUGGESTION_SENTINEL);
  });

  it('describes every target field, the current operation, and ancestor operations in the user message', () => {
    const [, user] = buildNodeSuggestionMessages(
      makeContext({
        targetFields: [makeField({ path: 'body.customerId' }), makeField({ path: 'body.productId', candidateBindings: [] })],
      })
    );
    expect(user.role).toBe('user');
    expect(user.content).toContain('body.customerId');
    expect(user.content).toContain('body.productId');
    expect(user.content).toContain('POST /orders');
    expect(user.content).toContain('Create customer');
    expect(user.content).toContain('POST /customers');
  });

  it('lists available credentials by id, name, and type', () => {
    const [, user] = buildNodeSuggestionMessages(
      makeContext({ availableCredentials: [{ id: 'cred-1', name: 'Prod bearer', type: 'bearer' }] })
    );
    expect(user.content).toContain('cred-1');
    expect(user.content).toContain('Prod bearer');
    expect(user.content).toContain('bearer');
  });

  it('says plainly when no credentials are configured', () => {
    const [, user] = buildNodeSuggestionMessages(makeContext({ availableCredentials: [] }));
    expect(user.content).toContain('none configured');
  });

  it("mentions the operation's required credential type(s) when the spec declares one", () => {
    const [, user] = buildNodeSuggestionMessages(
      makeContext({ currentOperation: { method: 'post', path: '/orders', requiredCredentialTypes: ['bearer', 'apiKey'] } })
    );
    expect(user.content).toContain('bearer, apiKey');
  });

  it('says plainly when the operation declares no security requirement', () => {
    const [, user] = buildNodeSuggestionMessages(makeContext({ currentOperation: { method: 'post', path: '/orders' } }));
    expect(user.content).toContain('declares no security requirement');
  });

  it('says plainly when no candidate bindings exist for a field', () => {
    const [, user] = buildNodeSuggestionMessages(makeContext({ targetFields: [makeField({ candidateBindings: [] })] }));
    expect(user.content).toContain('none available');
  });

  it('says plainly when no ancestor operations are connected', () => {
    const [, user] = buildNodeSuggestionMessages(makeContext({ ancestorOperations: [] }));
    expect(user.content).toContain('No upstream operations are connected yet.');
  });
});

describe('parseNodeSuggestionResponse', () => {
  it('resolves the credential line and one line per field, mapped/static/credential mixed together', () => {
    const ctx = makeContext({
      targetFields: [makeField({ path: 'body.customerId' }), makeField({ path: 'body.productId', candidateBindings: [] })],
    });
    const result = parseNodeSuggestionResponse(
      'credential: cred-1\nbody.customerId: {{enlace:af0_0}}\nbody.productId: sku_123',
      ctx
    );
    expect(result.credential).toEqual({ kind: 'suggested', credentialId: 'cred-1' });
    expect(result.fields.get('body.customerId')).toEqual({ kind: 'mapped', fromNodeId: 'node-1', fromResponseFieldPath: 'id' });
    expect(result.fields.get('body.productId')).toEqual({ kind: 'static', rawValue: 'sku_123' });
  });

  it('resolves the sentinel to none for both the credential and a field', () => {
    const ctx = makeContext();
    const result = parseNodeSuggestionResponse(
      `credential: ${NO_SUGGESTION_SENTINEL}\nbody.customerId: ${NO_SUGGESTION_SENTINEL}`,
      ctx
    );
    expect(result.credential).toEqual({ kind: 'none' });
    expect(result.fields.get('body.customerId')).toEqual({ kind: 'none' });
  });

  it('treats an unknown/hallucinated credential id as none, not a literal value', () => {
    const ctx = makeContext();
    const result = parseNodeSuggestionResponse('credential: cred-does-not-exist', ctx);
    expect(result.credential).toEqual({ kind: 'none' });
  });

  it('resolves to none for the credential and every field when the model never answers', () => {
    const ctx = makeContext({
      targetFields: [makeField({ path: 'body.customerId' }), makeField({ path: 'body.productId' })],
    });
    const result = parseNodeSuggestionResponse('body.customerId: cust_1', ctx);
    expect(result.credential).toEqual({ kind: 'none' });
    expect(result.fields.get('body.customerId')).toEqual({ kind: 'static', rawValue: 'cust_1' });
    expect(result.fields.get('body.productId')).toEqual({ kind: 'none' });
  });

  it('ignores a line whose key does not match "credential" or any target field', () => {
    const ctx = makeContext();
    const result = parseNodeSuggestionResponse('body.unknownField: whatever\nbody.customerId: cust_1', ctx);
    expect(result.fields.size).toBe(1);
    expect(result.fields.get('body.customerId')).toEqual({ kind: 'static', rawValue: 'cust_1' });
  });

  it("only matches a field placeholder against its own field's candidate bindings, not another field's", () => {
    const ctx = makeContext({
      targetFields: [
        makeField({ path: 'body.customerId', candidateBindings: [{ tagId: 'af0_0', fromNodeId: 'node-1', fromNodeLabel: 'Create customer', fromResponseFieldPath: 'id', type: 'string' }] }),
        makeField({ path: 'body.productId', candidateBindings: [] }),
      ],
    });
    const result = parseNodeSuggestionResponse('body.productId: {{enlace:af0_0}}', ctx);
    expect(result.fields.get('body.productId')).toEqual({ kind: 'static', rawValue: '{{enlace:af0_0}}' });
  });

  it('ignores a repeated line for the same key, keeping only the first (credential and fields alike)', () => {
    const ctx = makeContext();
    const result = parseNodeSuggestionResponse(
      'credential: cred-1\ncredential: NO_SUGGESTION\nbody.customerId: cust_1\nbody.customerId: cust_2',
      ctx
    );
    expect(result.credential).toEqual({ kind: 'suggested', credentialId: 'cred-1' });
    expect(result.fields.get('body.customerId')).toEqual({ kind: 'static', rawValue: 'cust_1' });
  });

  it('tolerates blank lines and surrounding whitespace', () => {
    const ctx = makeContext();
    const result = parseNodeSuggestionResponse('\n  credential: cred-1  \n\n  body.customerId: cust_1  \n\n', ctx);
    expect(result.credential).toEqual({ kind: 'suggested', credentialId: 'cred-1' });
    expect(result.fields.get('body.customerId')).toEqual({ kind: 'static', rawValue: 'cust_1' });
  });
});
