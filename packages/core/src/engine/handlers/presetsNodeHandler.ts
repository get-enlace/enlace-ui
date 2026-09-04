import type { PresetKind, RunStep } from '../../types.js';
import { asPresetsNode } from './guards.js';
import { waitPresetHandler } from './waitPresetHandler.js';
import { assertPresetHandler } from './assertPresetHandler.js';
import type { NodeHandler, PresetHandler } from './index.js';

/** One entry per `PresetKind` — see `PresetHandler`'s own comment (in ./index.ts) above. */
export const presetHandlers: Record<PresetKind, PresetHandler> = {
  wait: waitPresetHandler,
  assert: assertPresetHandler,
};

/**
 * The `'presets'` collection kind (see ARCHITECTURE.md's "Preset nodes"
 * section) — one graph node running an ordered list of `presets` as a
 * single executable unit. This is the *only* way a preset ever reaches the
 * canvas: the palette drops a `'presets'` collection even for a single
 * preset (see store/slices/graphSlice.ts's `addPresetsNode`), so this
 * handler is exercised on every preset drop, not just a multi-preset one.
 *
 * Deliberately reuses the `presetHandlers` registry (one entry per
 * `PresetKind`) for each preset rather than a parallel per-kind switch
 * here — a preset's own handler (e.g. `waitPresetHandler`) runs the same
 * way whether its collection holds one preset or ten.
 * Presets run strictly in order (never concurrently — "linear order only",
 * per the issue) and stop at the first failure or the instant the run's
 * abort signal fires, same "no partial recovery, nothing un-runs" rule
 * `executeChain` itself follows at the top level.
 *
 * Settles as one aggregate `RunStep` (`request.method: 'PRESETS'`, no
 * `response`) with every preset's own settled `RunStep` attached under
 * `subSteps`, in order — so the collection is one node in the dependency
 * graph and one row in Results, with per-preset detail available underneath
 * it, exactly the v1 the issue calls out ("one executable unit with
 * per-step Results detail") rather than exploding each preset into its own
 * graph node.
 */
export const presetsNodeHandler: NodeHandler = {
  checkReady(workflowNode, ctx) {
    const node = asPresetsNode(workflowNode);
    for (const preset of node.presets ?? []) {
      const error = presetHandlers[preset.kind].checkReady(preset, ctx);
      if (error) return error;
    }
    return null;
  },
  async execute(workflowNode, ctx) {
    const node = asPresetsNode(workflowNode);
    const presets = node.presets ?? [];
    const timestampStart = new Date().toISOString();
    const subSteps: RunStep[] = [];
    let error: string | undefined;

    for (const preset of presets) {
      // A Stop mid-collection behaves like a Stop mid-anything-else:
      // nothing new starts, but whatever's already running (the current
      // preset) still finishes — the individual preset handler's own abort
      // handling (e.g. Wait's sleep) is what actually shortens that, not
      // this loop.
      if (ctx.signal.aborted) break;
      const stepResult = await presetHandlers[preset.kind].execute(preset, ctx, `${node.id}::${preset.id}`);
      subSteps.push(stepResult);
      if (stepResult.error) {
        error = stepResult.error;
        break;
      }
    }

    return {
      nodeId: node.id,
      request: {
        method: 'PRESETS',
        url: `presets:${presets.length} preset${presets.length === 1 ? '' : 's'}`,
        headers: {},
        credentials: 'omit',
      },
      subSteps,
      timestampStart,
      timestampEnd: new Date().toISOString(),
      ...(error ? { error } : {}),
    };
  },
  async preview() {
    // Presets only, no HTTP — nothing to preview ahead of firing.
    return null;
  },
};
