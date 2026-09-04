import { resolveTagValue } from '../../bodyTags.js';
import { evaluateCheck } from '../assertCompare.js';
import type { PresetHandler } from './index.js';

/**
 * The Assert preset — a run of `checks` against an already-captured
 * response, each resolved via bodyTags.ts's `resolveTagValue` (the same "reference into a prior
 * step's result" machinery Raw JSON tag chips use) and compared via
 * engine/assertCompare.ts's `evaluateCheck`. Checks run strictly in order
 * and stop at the first failure — same "no partial recovery" rule
 * `presetsNodeHandler`'s own preset loop follows — rather than collecting
 * every failure before reporting one.
 *
 * `resolveTagValue` throws if the source step never captured a response,
 * or a named header is missing — caught here and folded into the same
 * failed-check reporting as an ordinary comparison failure, so a bad
 * reference surfaces as this preset's `error`, not an uncaught rejection.
 */
export const assertPresetHandler: PresetHandler = {
  checkReady() {
    return null;
  },

  async execute(preset, ctx, stepNodeId) {
    if (preset.kind !== 'assert') throw new Error('assertPresetHandler invoked with a non-assert preset');

    const checks = preset.checks;
    const timestampStart = new Date().toISOString();
    let error: string | undefined;

    for (const [index, check] of checks.entries()) {
      try {
        const actual = resolveTagValue(check.source, ctx.stepsByNodeId, ctx.nodeLabels);
        const failure = evaluateCheck(actual, check.operator, check.expected);
        if (failure) {
          error = `Check ${index + 1}: ${failure}`;
          break;
        }
      } catch (err) {
        error = `Check ${index + 1}: ${err instanceof Error ? err.message : String(err)}`;
        break;
      }
    }

    return {
      nodeId: stepNodeId,
      request: {
        method: 'ASSERT',
        url: `assert:${checks.length} check${checks.length === 1 ? '' : 's'}`,
        headers: {},
        credentials: 'omit',
      },
      timestampStart,
      timestampEnd: new Date().toISOString(),
      ...(error ? { error } : {}),
    };
  },
};
