import { describe, it, expect } from 'vitest';
import { evaluateCheck } from './assertCompare.js';

describe('evaluateCheck', () => {
  describe('equals', () => {
    it('passes on an exact string match', () => {
      expect(evaluateCheck('ok', 'equals', 'ok')).toBeNull();
    });

    it('is numeric-aware — a numeric actual matches a numeric-looking expected string', () => {
      expect(evaluateCheck(200, 'equals', '200')).toBeNull();
    });

    it('fails with a descriptive reason on mismatch', () => {
      expect(evaluateCheck(404, 'equals', '200')).toBe('expected "200", got 404');
    });
  });

  describe('notEquals', () => {
    it('passes when values differ', () => {
      expect(evaluateCheck(404, 'notEquals', '200')).toBeNull();
    });

    it('fails when values match', () => {
      expect(evaluateCheck(200, 'notEquals', '200')).not.toBeNull();
    });
  });

  describe('contains', () => {
    it('passes on a substring match', () => {
      expect(evaluateCheck('not found: order 42', 'contains', 'not found')).toBeNull();
    });

    it('passes when an array contains a loosely-equal element', () => {
      expect(evaluateCheck([1, 2, 3], 'contains', '2')).toBeNull();
    });

    it('fails when the needle is absent', () => {
      expect(evaluateCheck('all good', 'contains', 'error')).not.toBeNull();
    });
  });

  describe('exists / notExists', () => {
    it('exists passes for a defined, non-null value', () => {
      expect(evaluateCheck(0, 'exists', undefined)).toBeNull();
      expect(evaluateCheck('', 'exists', undefined)).toBeNull();
    });

    it('exists fails for undefined/null', () => {
      expect(evaluateCheck(undefined, 'exists', undefined)).not.toBeNull();
      expect(evaluateCheck(null, 'exists', undefined)).not.toBeNull();
    });

    it('notExists is the exact inverse', () => {
      expect(evaluateCheck(undefined, 'notExists', undefined)).toBeNull();
      expect(evaluateCheck(0, 'notExists', undefined)).not.toBeNull();
    });
  });

  describe('greaterThan / lessThan', () => {
    it('compares numerically', () => {
      expect(evaluateCheck(10, 'greaterThan', '5')).toBeNull();
      expect(evaluateCheck(3, 'lessThan', '5')).toBeNull();
      expect(evaluateCheck(3, 'greaterThan', '5')).not.toBeNull();
    });

    it('fails clearly (not throws) on a non-numeric operand', () => {
      const result = evaluateCheck('not-a-number', 'greaterThan', '5');
      expect(result).not.toBeNull();
      expect(result).toMatch(/non-numeric/);
    });
  });
});
