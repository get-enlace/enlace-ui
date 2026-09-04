import { describe, it, expect } from 'vitest';
import { areFieldTypesCompatible, flattenRequestFields } from './flattenSchema.js';
import type { Operation } from '../types.js';

function makeOperation(overrides: Partial<Operation>): Operation {
  return {
    id: 'POST /pet',
    method: 'post',
    path: '/pet',
    parameters: [],
    requestBodySchema: null,
    requestBodyContentType: null,
    responseSchema: null,
    ...overrides,
  };
}

describe('flattenRequestFields', () => {
  it('carries enum through for a query parameter', () => {
    const operation = makeOperation({
      parameters: [
        { name: 'status', in: 'query', required: true, schema: { type: 'string', enum: ['available', 'pending', 'sold'] } },
      ],
    });

    const [status] = flattenRequestFields(operation);

    expect(status.path).toBe('query.status');
    expect(status.enum).toEqual(['available', 'pending', 'sold']);
  });

  it('carries enum through for a body property', () => {
    const operation = makeOperation({
      requestBodySchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['available', 'pending', 'sold'] },
        },
      },
    });

    const [status] = flattenRequestFields(operation);

    expect(status.path).toBe('body.status');
    expect(status.supported).toBe(true);
    expect(status.enum).toEqual(['available', 'pending', 'sold']);
  });

  it('recurses fully through nested objects — no depth cap, no row for the object itself', () => {
    const operation = makeOperation({
      requestBodySchema: {
        type: 'object',
        properties: {
          category: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              owner: {
                type: 'object',
                properties: { name: { type: 'string' } },
              },
            },
          },
        },
      },
    });

    const fields = flattenRequestFields(operation);
    const paths = fields.map((f) => f.path);

    // category itself never appears as its own field — only its leaves do,
    // however deep. setByPath (chainExecutor.ts) already handles arbitrary
    // dotted depth, so there's no reason to cap this.
    expect(paths).not.toContain('body.category');
    expect(paths).not.toContain('body.category.owner');
    expect(paths).toEqual(['body.category.id', 'body.category.owner.name']);
    expect(fields.every((f) => f.supported)).toBe(true);
  });

  it('treats an array property as one JSON field, with an example placeholder', () => {
    const operation = makeOperation({
      requestBodySchema: {
        type: 'object',
        properties: {
          photoUrls: { type: 'array', items: { type: 'string' } },
        },
      },
    });

    const [photoUrls] = flattenRequestFields(operation);

    expect(photoUrls.path).toBe('body.photoUrls');
    expect(photoUrls.supported).toBe(true);
    expect(photoUrls.type).toBe('array');
    expect(JSON.parse(photoUrls.reason!)).toEqual(['string', 'string']);
  });

  it('builds an example object for an array-of-objects field (e.g. Pet.tags)', () => {
    const operation = makeOperation({
      requestBodySchema: {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'integer' }, name: { type: 'string' } },
            },
          },
        },
      },
    });

    const [tags] = flattenRequestFields(operation);

    expect(tags.supported).toBe(true);
    expect(JSON.parse(tags.reason!)).toEqual([{ id: 0, name: 'string' }]);
  });

  it('treats an array query parameter the same way as an array body property', () => {
    const operation = makeOperation({
      parameters: [{ name: 'tags', in: 'query', required: false, schema: { type: 'array', items: { type: 'string' } } }],
    });

    const [tags] = flattenRequestFields(operation);

    expect(tags.path).toBe('query.tags');
    expect(tags.supported).toBe(true);
    expect(tags.type).toBe('array');
  });

  it('does not restrict array or nested-object-leaf fields to static-only — Map from... stays available like any other field', () => {
    // resolveFieldValue/setByPath (chainExecutor.ts) copy a mapped value
    // through untyped regardless of shape, so there's no technical reason
    // to single out arrays or object leaves here — supported is the only
    // flag NodeConfig.tsx checks to gate "Map from...".
    const operation = makeOperation({
      requestBodySchema: {
        type: 'object',
        properties: {
          tags: { type: 'array', items: { type: 'string' } },
          category: { type: 'object', properties: { id: { type: 'integer' } } },
        },
      },
    });

    const fields = flattenRequestFields(operation);

    expect(fields.every((f) => f.supported)).toBe(true);
    expect(fields.every((f) => !('staticOnly' in f))).toBe(true);
  });

  it('marks a genuinely unrecognized schema shape (e.g. oneOf) unsupported, rather than silently mistreating it as a plain scalar', () => {
    const operation = makeOperation({
      requestBodySchema: {
        type: 'object',
        properties: {
          value: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
        },
      },
    });

    const [value] = flattenRequestFields(operation);

    expect(value.supported).toBe(false);
    expect(value.reason).toBeTruthy();
  });

  it('carries format: binary through so the inspector can render a file picker', () => {
    const operation = makeOperation({
      requestBodySchema: {
        type: 'object',
        required: ['file'],
        properties: {
          file: { type: 'string', format: 'binary' },
          description: { type: 'string' },
        },
      },
    });

    const fields = flattenRequestFields(operation);
    const file = fields.find((f) => f.path === 'body.file')!;
    const description = fields.find((f) => f.path === 'body.description')!;

    expect(file.format).toBe('binary');
    expect(file.type).toBe('string');
    expect(file.required).toBe(true);
    expect(description.format).toBeUndefined();
  });
});

describe('areFieldTypesCompatible', () => {
  it('rejects a clear mismatch, e.g. a string field mapped from an array source', () => {
    expect(areFieldTypesCompatible('string', 'array')).toBe(false);
  });

  it('accepts an exact match', () => {
    expect(areFieldTypesCompatible('string', 'string')).toBe(true);
  });

  it('treats integer and number as interchangeable', () => {
    expect(areFieldTypesCompatible('integer', 'number')).toBe(true);
    expect(areFieldTypesCompatible('number', 'integer')).toBe(true);
  });

  it('allows it through when either side has no known type — can\'t rule it out', () => {
    expect(areFieldTypesCompatible(undefined, 'array')).toBe(true);
    expect(areFieldTypesCompatible('string', undefined)).toBe(true);
  });
});
