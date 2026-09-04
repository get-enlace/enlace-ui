import { describe, expect, it } from 'vitest';
import { getByPath, setByPath } from './path.js';

describe('path utilities', () => {
  describe('getByPath', () => {
    it('resolves nested and array paths', () => {
      const obj = { order: { items: [{ id: 'abc' }] } };
      expect(getByPath(obj, 'order.items[0].id')).toBe('abc');
    });

    it('returns undefined for missing paths without throwing', () => {
      expect(getByPath({ a: 1 }, 'a.b.c')).toBeUndefined();
      expect(getByPath(null, 'a.b')).toBeUndefined();
    });
  });

  describe('setByPath', () => {
    it('sets a top-level key', () => {
      const target: Record<string, unknown> = {};
      setByPath(target, 'name', 'Widget');
      expect(target).toEqual({ name: 'Widget' });
    });

    it('creates intermediate objects along a dotted path', () => {
      const target: Record<string, unknown> = {};
      setByPath(target, 'customer.address.city', 'Springfield');
      expect(target).toEqual({ customer: { address: { city: 'Springfield' } } });
    });

    it('overwrites an existing leaf without disturbing its siblings', () => {
      const target: Record<string, unknown> = { customer: { name: 'Alice', age: 30 } };
      setByPath(target, 'customer.age', 31);
      expect(target).toEqual({ customer: { name: 'Alice', age: 31 } });
    });

    it('reuses an already-built intermediate object across separate calls, same as buildRequest looping over fieldValues one entry at a time', () => {
      const target: Record<string, unknown> = {};
      setByPath(target, 'customer.name', 'Alice');
      setByPath(target, 'customer.age', 30);
      expect(target).toEqual({ customer: { name: 'Alice', age: 30 } });
    });

    it('treats a bracket segment as a literal key, unlike getByPath — setByPath never parses "[0]" as an array index', () => {
      const target: Record<string, unknown> = {};
      setByPath(target, 'items[0].id', 'abc');
      expect(target).toEqual({ 'items[0]': { id: 'abc' } });
    });

    it('ignores empty segments from a leading, trailing, or doubled dot', () => {
      const target: Record<string, unknown> = {};
      setByPath(target, '.customer..name.', 'Alice');
      expect(target).toEqual({ customer: { name: 'Alice' } });
    });
  });
});
