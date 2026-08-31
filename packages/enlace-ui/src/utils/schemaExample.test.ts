import { describe, expect, it } from 'vitest';
import { buildSchemaExample, hasUnrepresentableShape } from './schemaExample.js';

describe('buildSchemaExample', () => {
  it('returns null for a missing schema', () => {
    expect(buildSchemaExample(null)).toBeNull();
    expect(buildSchemaExample(undefined)).toBeNull();
  });

  it('builds empty (not illustrative) scalar defaults by type — "" not "string", false not true', () => {
    // Deliberately different from flattenSchema.ts's exampleScalarValue,
    // which is illustrative placeholder text for a Form-mode tooltip
    // ("here's the shape"). This is a value Raw mode actually starts a
    // required field at, so it should read as "fill this in", not as a
    // plausible-looking value someone might ship unedited.
    expect(buildSchemaExample({ type: 'string' })).toBe('');
    expect(buildSchemaExample({ type: 'integer' })).toBe(0);
    expect(buildSchemaExample({ type: 'number' })).toBe(0);
    expect(buildSchemaExample({ type: 'boolean' })).toBe(false);
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
    expect(buildSchemaExample(schema)).toEqual({ name: '', address: { city: '' } });
  });

  it('builds a one-item array example, recursing into object items', () => {
    const schema = { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' } } } };
    expect(buildSchemaExample(schema)).toEqual([{ id: 0 }]);
  });

  it('uses the first oneOf/anyOf branch', () => {
    const oneOf = { oneOf: [{ type: 'string' }, { type: 'integer' }] };
    expect(buildSchemaExample(oneOf)).toBe('');

    const anyOf = { anyOf: [{ type: 'integer' }, { type: 'string' }] };
    expect(buildSchemaExample(anyOf)).toBe(0);
  });

  it('shallow-merges allOf branches into one object, keeping the merged required list', () => {
    const schema = {
      allOf: [
        { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
        { type: 'object', properties: { name: { type: 'string' } } },
      ],
    };
    // `name` isn't in either branch's `required` — merged, it's optional,
    // so it stubs as null same as any other schema's optional property.
    expect(buildSchemaExample(schema)).toEqual({ id: 0, name: null });
  });

  it('stubs a property left off an explicit required list as null, not a placeholder value', () => {
    const schema = {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        nickname: { type: 'string' },
        age: { type: 'integer' },
        active: { type: 'boolean' },
      },
    };
    expect(buildSchemaExample(schema)).toEqual({ name: '', nickname: null, age: null, active: null });
  });

  it('stubs a non-required nested object or array wholesale as null, without recursing into its shape', () => {
    const schema = {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'integer' },
        address: { type: 'object', properties: { city: { type: 'string' } } },
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
    expect(buildSchemaExample(schema)).toEqual({ id: 0, address: null, tags: null });
  });

  it('stubs every property normally when the schema has no required array at all — no signal either way', () => {
    // An object schema that simply never declares `required` shouldn't be
    // reinterpreted as "everything optional" — that would null out the
    // entire skeleton for the very common case of a spec that just didn't
    // bother writing a required list, not one that deliberately made
    // every field optional.
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'integer' } },
    };
    expect(buildSchemaExample(schema)).toEqual({ name: '', age: 0 });
  });

  it('treats an explicit empty required array as "everything here is optional"', () => {
    const schema = {
      type: 'object',
      required: [],
      properties: { name: { type: 'string' } },
    };
    expect(buildSchemaExample(schema)).toEqual({ name: null });
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
