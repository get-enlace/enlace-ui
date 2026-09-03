import { describe, expect, it } from 'vitest';
import { coerceStaticValue } from './coerceValue.js';

describe('coerceStaticValue', () => {
  it('coerces integer/number fields to actual numbers', () => {
    expect(coerceStaticValue('3', 'integer')).toBe(3);
    expect(coerceStaticValue('2.5', 'number')).toBe(2.5);
  });

  it('leaves a blank numeric field as an empty string so required-validation still sees it as unset', () => {
    expect(coerceStaticValue('', 'integer')).toBe('');
  });

  it('falls back to the raw string for a non-numeric value in a numeric field', () => {
    expect(coerceStaticValue('abc', 'integer')).toBe('abc');
  });

  it('coerces boolean fields from "true"/"false" strings', () => {
    expect(coerceStaticValue('true', 'boolean')).toBe(true);
    expect(coerceStaticValue('false', 'boolean')).toBe(false);
  });

  it('leaves string fields (or no schema type) untouched', () => {
    expect(coerceStaticValue('Widget', 'string')).toBe('Widget');
    expect(coerceStaticValue('Widget', undefined)).toBe('Widget');
  });

  it('parses array fields as JSON', () => {
    expect(coerceStaticValue('["a","b"]', 'array')).toEqual(['a', 'b']);
    expect(coerceStaticValue('[{"id":1,"name":"cat"}]', 'array')).toEqual([{ id: 1, name: 'cat' }]);
  });

  it('leaves a blank array field as an empty string so required-validation still sees it as unset', () => {
    expect(coerceStaticValue('', 'array')).toBe('');
  });

  it('falls back to the raw string for invalid/mid-typing JSON in an array field', () => {
    expect(coerceStaticValue('[{"id":1', 'array')).toBe('[{"id":1');
  });
});
