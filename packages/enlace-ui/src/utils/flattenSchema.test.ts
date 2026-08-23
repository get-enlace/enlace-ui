import { describe, it, expect } from 'vitest';
import { flattenRequestFields } from './flattenSchema.js';
import type { Operation } from '../types.js';

function makeOperation(overrides: Partial<Operation>): Operation {
  return {
    id: 'POST /pet',
    method: 'post',
    path: '/pet',
    parameters: [],
    requestBodySchema: null,
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

  it('carries enum through for a supported (scalar) body property, inlined or already $ref-resolved by specParser', () => {
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

  it('does not set enum on an unsupported (nested) body property, even if its schema declares one', () => {
    const operation = makeOperation({
      requestBodySchema: {
        type: 'object',
        properties: {
          category: {
            type: 'object',
            properties: { id: { type: 'integer' } },
            enum: [{ id: 1 }], // pathological, but should still be ignored — nested fields aren't dropdown-able
          },
        },
      },
    });

    const [category] = flattenRequestFields(operation);

    expect(category.path).toBe('body.category');
    expect(category.supported).toBe(false);
    expect(category.enum).toBeUndefined();
  });
});
