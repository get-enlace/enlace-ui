import { describe, expect, it } from 'vitest';
import { buildRawBodyFromForm, convertRawBodyToFieldValues } from './bodyTemplate.js';
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
    expect(JSON.parse(raw.template)).toEqual({ name: 'string', category: { id: 0 } });
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
