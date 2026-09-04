import type { Preset, Operation, WorkflowNode } from './types.js';

/**
 * Renders a millisecond duration the way a person would type it — whole
 * seconds when it divides evenly (`2000` -> `"2s"`), one decimal place
 * otherwise (`2500` -> `"2.5s"`), plain milliseconds under a second
 * (`500` -> `"500ms"`). Shared by the Wait preset's canvas card, inspector,
 * and node label so all three always agree on the same wording.
 */
export function formatWaitDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  const rounded = Math.round(seconds * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}s`;
}

/** One `Preset`'s own short label — same wording a standalone node of that kind would get. */
export function formatPresetLabel(preset: Preset): string {
  switch (preset.kind) {
    case 'wait':
      return `Wait ${formatWaitDuration(preset.durationMs ?? 0)}`;
    case 'assert': {
      const n = preset.checks?.length ?? 0;
      return `Assert (${n} check${n === 1 ? '' : 's'})`;
    }
  }
}

/**
 * A presets collection's short summary — e.g. `Wait 2s · Wait 1s` — shared
 * by the collapsed canvas card (its whole identity, per the issue's
 * "chevron, step count, short summary") and the node label. An empty
 * collection is a valid, if useless, state (see `WorkflowNode.presets`'s own
 * comment) — named plainly rather than left blank; in practice the canvas
 * never creates one empty.
 */
export function formatPresetsSummary(presets: Preset[]): string {
  return presets.length > 0 ? presets.map(formatPresetLabel).join(' · ') : 'Empty';
}

function operationName(node: WorkflowNode, operationsById: Map<string, Operation>): string {
  // 'wait' never appears as a real top-level node's kind (see
  // WorkflowNodeKind's own comment) — only 'operation' and 'presets' do.
  if (node.kind === 'presets') return `Presets: ${formatPresetsSummary(node.presets ?? [])}`;
  const operation = node.operationId ? operationsById.get(node.operationId) : undefined;
  return operation?.operationId ?? operation?.id ?? node.operationId ?? node.id;
}

/**
 * Human-friendly labels for a set of nodes — used anywhere a node needs to be named for a
 * person: raw-JSON tag chips, the "Map from..." picker, the response-mapping modal's request
 * picker. Prefers the spec's own `operationId` (e.g. "createCustomer") over the synthetic
 * "METHOD /path" id `specParser.ts` falls back to when the spec declares none.
 *
 * A node's internal id means nothing to a user, so it's never shown. Instead, when the same
 * operation is used by more than one node in `nodes` (the same API called twice in this
 * workflow), those nodes get a stable "#N" suffix — ordered by where they appear in `nodes`,
 * which callers already pass in canvas/creation order.
 */
export function buildNodeLabels(nodes: WorkflowNode[], operationsById: Map<string, Operation>): Map<string, string> {
  const names = nodes.map((n) => operationName(n, operationsById));
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);

  const ordinals = new Map<string, number>();
  const labels = new Map<string, string>();
  nodes.forEach((node, i) => {
    const name = names[i];
    if ((counts.get(name) ?? 0) < 2) {
      labels.set(node.id, name);
      return;
    }
    const ordinal = (ordinals.get(name) ?? 0) + 1;
    ordinals.set(name, ordinal);
    labels.set(node.id, `${name} #${ordinal}`);
  });
  return labels;
}
