import type { PresetHandler } from './index.js';

/** Resolves once `durationMs` has elapsed, or immediately if `signal` aborts first. */
function sleep(durationMs: number, signal: AbortSignal): Promise<void> {
  if (durationMs <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, durationMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * The Wait preset — a pure pacing step with no request of its own (see
 * ARCHITECTURE.md's "Preset nodes" section). Runs in its turn inside
 * `presetsNodeHandler`'s loop by sleeping `durationMs`, and settles with a
 * synthetic `RunStep` (a made-up `request.method: 'WAIT'`, no `response`)
 * so it still shows up in Results under its collection's `subSteps` — it
 * just never produces a response body a later node could map a field from
 * (`getByPath(undefined, path)` already returns `undefined`, so this needs
 * no special-casing in `operationNodeHandler.ts`'s `resolveFieldValue`).
 *
 * Honors the run's abort signal (see `ChainExecutorOptions`/`RunControl.stop`
 * in chainExecutor.ts): a Stop pressed mid-sleep resolves the wait
 * immediately instead of holding up the rest of the run for however long
 * was left, which would otherwise defeat the point of Stop for any chain
 * with a long wait in it.
 */
export const waitPresetHandler: PresetHandler = {
  checkReady() {
    return null;
  },
  async execute(preset, ctx, stepNodeId) {
    // Always true — presetHandlers[preset.kind] only ever dispatches a
    // WaitPreset here. Narrowed with a guard (not a bare cast) so a
    // mis-wired registry fails loudly instead of silently reading
    // `undefined` off the wrong variant.
    if (preset.kind !== 'wait') throw new Error('waitPresetHandler invoked with a non-wait preset');
    const durationMs = Math.max(0, preset.durationMs);
    const timestampStart = new Date().toISOString();
    await sleep(durationMs, ctx.signal);
    return {
      nodeId: stepNodeId,
      request: { method: 'WAIT', url: `wait:${durationMs}ms`, headers: {}, credentials: 'omit' },
      timestampStart,
      timestampEnd: new Date().toISOString(),
    };
  },
};
