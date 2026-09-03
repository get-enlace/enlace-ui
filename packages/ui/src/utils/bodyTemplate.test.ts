import { describe, expect, it } from 'vitest';
import { buildRawBodyFromForm, buildRawParamsFromForm, convertRawBodyToFieldValues, convertRawParamsToFieldValues } from './bodyTemplate.js';
import type { FieldValue, Operation } from '../types.js';

function op(requestBodySchema: Record<string, any> | null): Operation {
  return {
    id: 'POST /orders',
    method: 'post',
    path: '/orders',
    parameters: [],
    requestBodySchema,
    responseSchema: null,
  };
}

const simpleSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    category: { type: 'object', properties: { id: { type: 'integer' } } },
  },
};

describe('buildRawBodyFromForm', () => {
  it('fills in static field values at their nested path', () => {
    const fieldValues: Record<string, FieldValue> = {
      'body.name': { source: 'static', value: 'widget' },
      'body.category.id': { source: 'static', value: 7 },
    };
    const raw = buildRawBodyFromForm(op(simpleSchema), fieldValues);
    expect(JSON.parse(raw.template)).toEqual({ name: 'widget', category: { id: 7 } });
    expect(raw.tags).toEqual({});
  });

  it('uses the schema example for fields with no fieldValue set', () => {
    const raw = buildRawBodyFromForm(op(simpleSchema), {});
    expect(JSON.parse(raw.template)).toEqual({ name: '', category: { id: 0 } });
  });

  it('only falls back to the schema default where Form mode set nothing — an already-set field is never overwritten', () => {
    const schema = {
      type: 'object',
      required: ['name', 'active'],
      properties: {
        name: { type: 'string' },
        active: { type: 'boolean' },
        nickname: { type: 'string' },
      },
    };
    const fieldValues: Record<string, FieldValue> = {
      // "name" is required but the user already gave it a real value in
      // Form mode — that value must win over the "" default entirely.
      'body.name': { source: 'static', value: 'Widget Co' },
    };
    const raw = buildRawBodyFromForm(op(schema), fieldValues);
    expect(JSON.parse(raw.template)).toEqual({
      name: 'Widget Co', // untouched by the default — Form's value wins
      active: false, // required, untouched in Form mode -> empty default
      nickname: null, // not required, untouched -> null
    });
  });

  it('turns a mapped field into a tag chip placeholder registered in tags', () => {
    const fieldValues: Record<string, FieldValue> = {
      'body.name': { source: 'mapped', fromNodeId: 'node-a', fromResponseFieldPath: 'item.title' },
    };
    const raw = buildRawBodyFromForm(op(simpleSchema), fieldValues);
    const parsed = JSON.parse(raw.template);

    const tagId = Object.keys(raw.tags)[0];
    expect(tagId).toBeTruthy();
    expect(parsed.name).toBe(`{{enlace:${tagId}}}`);
    expect(raw.tags[tagId]).toEqual({
      id: tagId,
      type: 'response_body',
      sourceNodeId: 'node-a',
      jsonPath: 'item.title',
    });
  });

  it('places a chip correctly inside a nested object path', () => {
    const fieldValues: Record<string, FieldValue> = {
      'body.category.id': { source: 'mapped', fromNodeId: 'node-a', fromResponseFieldPath: 'category.id' },
    };
    const raw = buildRawBodyFromForm(op(simpleSchema), fieldValues);
    const parsed = JSON.parse(raw.template);
    const tagId = Object.keys(raw.tags)[0];
    expect(parsed.category.id).toBe(`{{enlace:${tagId}}}`);
  });
});

describe('buildRawParamsFromForm / convertRawParamsToFieldValues', () => {
  const patchOp: Operation = {
    id: 'PATCH /customers/{id}',
    method: 'patch',
    path: '/customers/{id}',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'dryRun', in: 'query', required: false, schema: { type: 'boolean' } },
      { name: 'notify', in: 'query', required: false, schema: { type: 'boolean' } },
    ],
    requestBodySchema: null,
    responseSchema: null,
  };

  it('builds a path JSON object from form fieldValues', () => {
    const raw = buildRawParamsFromForm('path', patchOp, {
      'path.id': { source: 'static', value: 'cust-1' },
    });
    expect(JSON.parse(raw.template)).toEqual({ id: 'cust-1' });
  });

  it('includes every declared param key even when unset (empty string skeleton)', () => {
    const raw = buildRawParamsFromForm('query', patchOp, {
      'query.dryRun': { source: 'static', value: true },
    });
    expect(JSON.parse(raw.template)).toEqual({ dryRun: true, notify: '' });
  });

  it('builds a query JSON object and round-trips losslessly', () => {
    const fieldValues: Record<string, FieldValue> = {
      'query.dryRun': { source: 'static', value: true },
      'query.notify': { source: 'mapped', fromNodeId: 'node-a', fromResponseFieldPath: 'flag' },
    };
    const raw = buildRawParamsFromForm('query', patchOp, fieldValues);
    const result = convertRawParamsToFieldValues('query', raw, patchOp);
    expect(result.lossy).toBe(false);
    expect(result.fieldValues).toEqual(fieldValues);
  });

  it('flags lossy when the query JSON has an unknown key', () => {
    const result = convertRawParamsToFieldValues(
      'query',
      { template: JSON.stringify({ dryRun: true, extra: 1 }), tags: {} },
      patchOp
    );
    expect(result.lossy).toBe(true);
    expect(result.fieldValues['query.dryRun']).toEqual({ source: 'static', value: true });
  });
});

describe('convertRawBodyToFieldValues', () => {
  it('reads static leaves back into fieldValues', () => {
    const rawBody = { template: JSON.stringify({ name: 'widget', category: { id: 7 } }), tags: {} };
    const result = convertRawBodyToFieldValues(rawBody, op(simpleSchema));
    expect(result.parseError).toBeUndefined();
    expect(result.fieldValues['body.name']).toEqual({ source: 'static', value: 'widget' });
    expect(result.fieldValues['body.category.id']).toEqual({ source: 'static', value: 7 });
    expect(result.lossy).toBe(false);
  });

  it('turns a whole-string tag chip back into a mapped fieldValue', () => {
    const rawBody = {
      template: JSON.stringify({ name: '{{enlace:tag1}}', category: { id: 1 } }),
      tags: { tag1: { id: 'tag1', type: 'response_body' as const, sourceNodeId: 'node-a', jsonPath: 'item.title' } },
    };
    const result = convertRawBodyToFieldValues(rawBody, op(simpleSchema));
    expect(result.fieldValues['body.name']).toEqual({ source: 'mapped', fromNodeId: 'node-a', fromResponseFieldPath: 'item.title' });
    expect(result.lossy).toBe(false);
  });

  it('reports a parse error for invalid JSON without computing lossy', () => {
    const result = convertRawBodyToFieldValues({ template: '{not json', tags: {} }, op(simpleSchema));
    expect(result.parseError).toBeTruthy();
    expect(result.fieldValues).toEqual({});
  });

  it('flags lossy when the template has extra structure the schema fields cannot capture', () => {
    const rawBody = { template: JSON.stringify({ name: 'widget', category: { id: 1 }, extra: 'surprise' }), tags: {} };
    const result = convertRawBodyToFieldValues(rawBody, op(simpleSchema));
    expect(result.lossy).toBe(true);
  });

  it('flags lossy when a tag chip is embedded inside a larger string (not a whole-leaf mapping)', () => {
    const rawBody = {
      template: JSON.stringify({ name: 'prefix-{{enlace:tag1}}-suffix', category: { id: 1 } }),
      tags: { tag1: { id: 'tag1', type: 'response_body' as const, sourceNodeId: 'node-a' } },
    };
    const result = convertRawBodyToFieldValues(rawBody, op(simpleSchema));
    expect(result.lossy).toBe(true);
    // Still readable as a static (garbled) string rather than dropped entirely.
    expect(result.fieldValues['body.name']).toEqual({ source: 'static', value: 'prefix-{{enlace:tag1}}-suffix' });
  });

  it('flags lossy when a tag chip sits inside an array item, unreachable by any flat leaf path', () => {
    const schema = { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } } } };
    const rawBody = {
      template: JSON.stringify({ items: [{ id: '{{enlace:tag1}}' }] }),
      tags: { tag1: { id: 'tag1', type: 'response_body' as const, sourceNodeId: 'node-a' } },
    };
    const result = convertRawBodyToFieldValues(rawBody, op(schema));
    expect(result.lossy).toBe(true);
  });

  it('round-trips buildRawBodyFromForm -> convertRawBodyToFieldValues losslessly for supported shapes', () => {
    const fieldValues: Record<string, FieldValue> = {
      'body.name': { source: 'static', value: 'widget' },
      'body.category.id': { source: 'mapped', fromNodeId: 'node-a', fromResponseFieldPath: 'category.id' },
    };
    const raw = buildRawBodyFromForm(op(simpleSchema), fieldValues);
    const result = convertRawBodyToFieldValues(raw, op(simpleSchema));
    expect(result.lossy).toBe(false);
    expect(result.fieldValues).toEqual(fieldValues);
  });
});
