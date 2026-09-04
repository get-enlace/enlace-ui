import type { AssertOperator } from '../types.js';

/** True if `text` parses as a finite JS number — used to decide whether a comparison runs numerically or as a string. */
function isNumeric(text: string): boolean {
  return text.trim() !== '' && Number.isFinite(Number(text));
}

/**
 * `equals`/`notEquals` compare numerically when both sides look numeric
 * (e.g. a response status `200` against a user-typed expected `"200"`) —
 * `expected` is always a plain string (see `AssertCheck.expected`'s own
 * comment), so a strict `===` would otherwise never match a numeric
 * `actual`. Falls back to a string compare for everything else.
 */
function looseEquals(actual: unknown, expected: string): boolean {
  const actualText = String(actual);
  if (isNumeric(actualText) && isNumeric(expected)) return Number(actualText) === Number(expected);
  return actualText === expected;
}

/**
 * Runs one `AssertCheck`'s comparison — `actual` already resolved (see
 * engine/nodeHandlers.ts's `assertPresetHandler`, which resolves `source`
 * via bodyTags.ts's `resolveTagValue` before calling this). Returns `null` on
 * pass, a human-readable failure reason on fail — never throws; a
 * non-numeric operand for `greaterThan`/`lessThan` is a failed check with a
 * clear reason, not a crash.
 */
export function evaluateCheck(actual: unknown, operator: AssertOperator, expected: string | undefined): string | null {
  switch (operator) {
    case 'equals':
      return looseEquals(actual, expected ?? '') ? null : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    case 'notEquals':
      return !looseEquals(actual, expected ?? '') ? null : `expected anything but ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    case 'contains': {
      const needle = expected ?? '';
      const found = Array.isArray(actual) ? actual.some((v) => looseEquals(v, needle)) : String(actual).includes(needle);
      return found ? null : `expected to contain ${JSON.stringify(needle)}, got ${JSON.stringify(actual)}`;
    }
    case 'exists':
      return actual !== undefined && actual !== null ? null : `expected a value, got ${JSON.stringify(actual)}`;
    case 'notExists':
      return actual === undefined || actual === null ? null : `expected no value, got ${JSON.stringify(actual)}`;
    case 'greaterThan':
    case 'lessThan': {
      const actualNum = Number(actual);
      const expectedNum = Number(expected);
      if (!Number.isFinite(actualNum) || !Number.isFinite(expectedNum)) {
        return `can't compare non-numeric values (${JSON.stringify(actual)} vs ${JSON.stringify(expected)})`;
      }
      const pass = operator === 'greaterThan' ? actualNum > expectedNum : actualNum < expectedNum;
      return pass ? null : `expected ${operator === 'greaterThan' ? '>' : '<'} ${expectedNum}, got ${actualNum}`;
    }
  }
}
