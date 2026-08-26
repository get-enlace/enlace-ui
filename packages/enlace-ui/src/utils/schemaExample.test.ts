import { describe, expect, it } from 'vitest';
import { buildSchemaExample, hasUnrepresentableShape } from './schemaExample.js';

describe('buildSchemaExample', () => {
  it('returns null for a missing schema', () => {
    expect(buildSchemaExample(null)).toBeNull();
    expect(buildSchemaExample(undefined)).toBeNull();
  });

  it('builds scalar defaults by type', () => {
    expect(buildSchemaExample({ type: 'string' })).toBe('string');
    expect(buildSchemaExample({ type: 'integer' })).toBe(0);
    expect(buildSchemaExample({ type: 'number' })).toBe(0);
    expect(buildSchemaExample({ type: 'boolean' })).toBe(true);
  });

  it('prefers the first enum value for a scalar', () => {
    expect(buildSchemaExample({ type: 'string', enum: ['active', 'inactive'] })).toBe('active');
  });

  it('recurses through nested objects', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        address: { type: 'object', properties: { city: { type: 'string' } } },
      },
    };
    expect(buildSchemaExample(schema)).toEqual({ name: 'string', address: { city: 'string' } });
  });

  it('builds a one-item array example, recursing into object items', () => {
    const schema = { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' } } } };
    expect(buildSchemaExample(schema)).toEqual([{ id: 0 }]);
  });

  it('uses the first oneOf/anyOf branch', () => {
    const oneOf = { oneOf: [{ type: 'string' }, { type: 'integer' }] };
    expect(buildSchemaExample(oneOf)).toBe('string');

    const anyOf = { anyOf: [{ type: 'integer' }, { type: 'string' }] };
    expect(buildSchemaExample(anyOf)).toBe(0);
  });

  it('shallow-merges allOf branches into one object', () => {
    const schema = {
      allOf: [
        { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
        { type: 'object', properties: { name: { type: 'string' } } },
      ],
    };
    expect(buildSchemaExample(schema)).toEqual({ id: 0, name: 'string' });
  });
});

describe('hasUnrepresentableShape', () => {
  it('is false for a plain flat/nested object schema', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' }, address: { type: 'object', properties: { city: { type: 'string' } } } } };
    expect(hasUnrepresentableShape(schema)).toBe(false);
  });

  it('is false for an array of scalars', () => {
    const schema = { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } } };
    expect(hasUnrepresentableShape(schema)).toBe(false);
  });

  it('is true for an array of objects', () => {
    const schema = { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } } } };
    expect(hasUnrepresentableShape(schema)).toBe(true);
  });

  it('is true for a oneOf/anyOf/allOf property anywhere in the tree', () => {
    expect(hasUnrepresentableShape({ type: 'object', properties: { p: { oneOf: [{ type: 'string' }] } } })).toBe(true);
    expect(hasUnrepresentableShape({ type: 'object', properties: { p: { anyOf: [{ type: 'string' }] } } })).toBe(true);
    expect(hasUnrepresentableShape({ type: 'object', properties: { p: { allOf: [{ type: 'string' }] } } })).toBe(true);
  });

  it('is false for a missing schema', () => {
    expect(hasUnrepresentableShape(null)).toBe(false);
    expect(hasUnrepresentableShape(undefined)).toBe(false);
  });
});
