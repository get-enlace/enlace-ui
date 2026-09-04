import type {
  Credential,
  Operation,
  Preset,
  RunStep,
  RunStepRequest,
  WorkflowNode,
  WorkflowNodeKind,
} from '../../types.js';
import { operationNodeHandler } from './operationNodeHandler.js';
import { presetsNodeHandler } from './presetsNodeHandler.js';

/**
 * Everything a `NodeHandler` needs to check/run/preview one node — built
 * once per `executeChain` call and passed through unchanged to every
 * handler invocation for that run (see chainExecutor.ts). Handlers must not
 * mutate any of these except by writing into `stepsByNodeId` (already the
 * convention `runNode`'s caller followed before this registry existed).
 */
export interface NodeHandlerContext {
  stepsByNodeId: Map<string, RunStep>;
  credentialsById: Map<string, Credential>;
  operationsById: Map<string, Operation>;
  baseUrl: string;
  nodeLabels: Map<string, string>;
  uploadedFiles: Record<string, File>;
  signal: AbortSignal;
}

export interface NodeHandler {
  /**
   * Returns an error message if this node can't run at all (e.g. an
   * `'operation'` node whose `operationId` isn't in the loaded spec)
   */
  checkReady(node: WorkflowNode, ctx: NodeHandlerContext): string | null;
  /** Runs the node for real and resolves once it's settled*/
  execute(node: WorkflowNode, ctx: NodeHandlerContext): Promise<RunStep>;
  /**
   * Resolves this node's about-to-fire request for a breakpoint's pause
   * preview, without sending it — or `null` when this kind has nothing to
   * preview.
   */
  preview(node: WorkflowNode, ctx: NodeHandlerContext): Promise<RunStepRequest | null>;
}

export interface PresetHandler {
  /** Same contract as `NodeHandler.checkReady` — `null` means good to go. Both kinds today always return `null`: neither references anything that can be "missing" the way an operation's `operationId` can. */
  checkReady(preset: Preset, ctx: NodeHandlerContext): string | null;
  /**
   * Runs one preset and resolves once it's settled. `stepNodeId` is the
   * synthetic id (`${presetsNodeId}::${preset.id}`) `presetsNodeHandler`
   * computes for this preset's own `RunStep.nodeId` — the handler doesn't
   * need to know the collection it's running inside, only what to stamp
   * its result with.
   */
  execute(preset: Preset, ctx: NodeHandlerContext, stepNodeId: string): Promise<RunStep>;
}

export const nodeHandlers: Record<WorkflowNodeKind, NodeHandler> = {
  operation: operationNodeHandler,
  presets: presetsNodeHandler,
};

export { buildRequest, operationNodeHandler } from './operationNodeHandler.js';
export { presetsNodeHandler, presetHandlers } from './presetsNodeHandler.js';
export { waitPresetHandler } from './waitPresetHandler.js';
export { assertPresetHandler } from './assertPresetHandler.js';
