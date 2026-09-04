import { buildDependencyGraph } from './dependencyGraph.js';
import { buildNodeLabels } from '../nodeLabel.js';
import { nodeHandlers, type NodeHandlerContext } from './handlers/index.js';
import type {
  Credential,
  Operation,
  RunControl,
  RunEvent,
  RunResult,
  RunStep,
  RunStepRequest,
  RunStepStatus,
  Workflow,
  WorkflowConnection,
  WorkflowNode,
} from '../types.js';

/**
 * The key a `WorkflowConnection` is armed/looked-up under in a breakpoints
 * set — shared so Canvas.tsx (arming, via a click on the connector) and
 * workflowStore.ts (storing the set) agree on the same string with
 * chainExecutor.ts (gating on it) without each inventing their own format.
 */
export function connectionKey(fromNodeId: string, toNodeId: string): string {
  return `${fromNodeId}->${toNodeId}`;
}

export class CyclicWorkflowError extends Error {
  constructor(public readonly nodeIds: string[]) {
    super(`Workflow has a cyclic dependency involving nodes: ${nodeIds.join(', ')}`);
    this.name = 'CyclicWorkflowError';
  }
}

/**
 * Groups nodes into execution "waves" via Kahn's algorithm: each level
 * contains every node whose dependencies are all satisfied by prior
 * levels, so everything within a level is safe to run concurrently — none
 * of them can depend on another node in the same level. This is what lets
 * `executeChain` actually run independent branches in parallel (e.g.
 * "run A, then B+C at once, then D" once D depends on A and C) instead of
 * a single flat sequential order.
 *
 * Throws CyclicWorkflowError if the dependency graph (explicit connections
 * ∪ mapping-implied edges — see buildDependencyGraph) has a cycle: some
 * nodes will never become "ready" and are left over at the end.
 */
export function computeExecutionLevels(
  nodes: WorkflowNode[],
  connections: WorkflowConnection[] = []
): WorkflowNode[][] {
  const dependsOn = buildDependencyGraph(nodes, connections);
  const remaining = new Set(nodes.map((n) => n.id));
  const levels: WorkflowNode[][] = [];

  while (remaining.size > 0) {
    const ready = nodes.filter(
      (n) => remaining.has(n.id) && [...dependsOn.get(n.id)!].every((depId) => !remaining.has(depId))
    );

    if (ready.length === 0) {
      throw new CyclicWorkflowError([...remaining]);
    }

    levels.push(ready);
    for (const n of ready) remaining.delete(n.id);
  }

  return levels;
}

/** Flat run order — levels concatenated in order, original relative order preserved within each. */
export function topologicalSort(nodes: WorkflowNode[], connections: WorkflowConnection[] = []): WorkflowNode[] {
  return computeExecutionLevels(nodes, connections).flat();
}

export interface ChainExecutorOptions {
  /** e.g. "http://localhost:4000" — prepended to each Operation.path. Derived from the spec's `servers[0].url` by the caller (see store/workflowStore.ts). */
  baseUrl: string;
  /**
   * In-memory File blobs for `source: 'file'` field values — see
   * store/workflowStore.ts's `uploadedFiles`. Optional so unit tests that
   * never touch file fields can omit it.
   */
  uploadedFiles?: Record<string, File>;
  /**
   * Fired once per node status transition (at minimum `pending ->
   * in-flight`, then once more on settling) as the run progresses, so a
   * caller can render results live instead of waiting for the whole chain
   * to finish — see store/workflowStore.ts's `run()`. Optional: a caller
   * that ignores it sees no behavior difference, only the final `RunResult`
   * this function still resolves to either way.
   */
  onEvent?: (event: RunEvent) => void;
  /**
   * `connectionKey(fromNodeId, toNodeId)` strings — a node with any
   * incoming `WorkflowConnection` matching one of these pauses (status
   * `'paused'`) the instant it would otherwise fire, instead of actually
   * firing, until released via the `RunControl` handed to `onControl`.
   * Never checked against mapping-implied dependencies, only explicit
   * connections, matching "a breakpoint only ever arms on a connector."
   * Snapshotted once at the start of this call — arming/disarming a
   * breakpoint mid-run has no effect on a run already in progress.
   */
  armedBreakpoints?: Set<string>;
  /**
   * Called synchronously, once, before any node fires — hands the caller a
   * `RunControl` for this specific run. Only meaningful when
   * `armedBreakpoints` is non-empty, but always called either way so a
   * caller has one uniform place to capture it (see store/workflowStore.ts's
   * `run()`, which stashes it as `activeControl`).
   */
  onControl?: (control: RunControl) => void;
}

/**
 * Executes a workflow's nodes in dependency order — each node fires the
 * instant every node it depends on (the union of explicit connections and
 * mapping-implied dependencies — see dependencyGraph.ts) has *completed*,
 * not by waiting for a whole batch of unrelated nodes to finish first. This
 * is a generalization of "run one level at a time, everything in a level
 * concurrently": whenever nothing is gating a node, independent nodes still
 * become ready and fire together in the same pass, exactly as a level would
 * — computeExecutionLevels' level grouping is still used up front purely as
 * a cycle check (throwing CyclicWorkflowError before anything fires), not
 * to drive the actual firing order.
 *
 * A node whose dependencies are all satisfied but sits behind an armed
 * breakpoint (see `ChainExecutorOptions.armedBreakpoints`) pauses instead of
 * firing — from the rest of the graph's point of view this is
 * indistinguishable from the node just being slow, so nothing downstream
 * needs special-casing; the existing dependency-satisfaction check already
 * produces the correct wait.
 *
 * A failure anywhere — or a user-issued Stop via `RunControl` — halts
 * admission of any newly-ready node — no partial recovery — but everything
 * already in flight at that point still runs to completion; requests
 * already fired can't be un-sent. Both also immediately settle every node
 * that was still `'pending'` or `'paused'` at that moment to `'skipped'`,
 * rather than leaving it in limbo for the rest of the run.
 */
export async function executeChain(
  workflow: Workflow,
  operationsById: Map<string, Operation>,
  credentialsById: Map<string, Credential>,
  options: ChainExecutorOptions
): Promise<RunResult> {
  const { nodes, connections } = workflow;

  // Cycle check only — throws CyclicWorkflowError before any request fires,
  // exactly as before. The levels themselves aren't used to drive firing.
  computeExecutionLevels(nodes, connections);

  const dependsOn = buildDependencyGraph(nodes, connections);
  const status = new Map<string, RunStepStatus>(nodes.map((n) => [n.id, 'pending']));
  const stepsByNodeId = new Map<string, RunStep>();
  const steps: RunStep[] = [];
  // Same labels the canvas / inspector chips use — tag-resolution errors
  // must name steps the way people see them, never by internal node id.
  const nodeLabels = buildNodeLabels(nodes, operationsById);
  const armedBreakpoints = options.armedBreakpoints ?? new Set<string>();
  const uploadedFiles = options.uploadedFiles ?? {};
  // Node ids a breakpoint gated but Continue/Step has since released — a
  // node only ever gets evaluated for gating once (it moves straight from
  // 'paused' to 'pending' to 'in-flight' on release, never back), so
  // recording the release here is enough; no need to track "which
  // connection" was released separately from "which node."
  const releasedNodeIds = new Set<string>();
  // Aborted by RunControl.stop() — lets a handler with something worth
  // cutting short mid-flight (Wait's sleep) end early instead of running to
  // its full length pointlessly once the run has already halted. An
  // in-flight HTTP request ignores this; it can't be un-sent anyway.
  const abortController = new AbortController();
  const ctx: NodeHandlerContext = {
    stepsByNodeId,
    credentialsById,
    operationsById,
    baseUrl: options.baseUrl,
    nodeLabels,
    uploadedFiles,
    signal: abortController.signal,
  };

  const emit = (nodeId: string, s: RunStepStatus, step?: RunStep, request?: RunStepRequest) =>
    options.onEvent?.({ nodeId, status: s, step, request });

  const isSatisfied = (nodeId: string) => [...dependsOn.get(nodeId)!].every((depId) => status.get(depId) === 'completed');

  const isGatedByBreakpoint = (nodeId: string) =>
    !releasedNodeIds.has(nodeId) &&
    connections.some((c) => c.toNodeId === nodeId && armedBreakpoints.has(connectionKey(c.fromNodeId, c.toNodeId)));

  // Once true, no *new* node is admitted — whatever's already in-flight
  // still runs to completion (its request was already sent; there's no
  // un-sending it). Set by either a node failing or RunControl.stop().
  let halted = false;
  let inFlightCount = 0;
  // Counts nodes currently sitting at 'paused' — the run isn't over while
  // any of these exist, even though none of them count toward
  // inFlightCount, so the wait loop below has to watch both.
  let pausedCount = 0;
  let unknownOperationError: Error | null = null;

  // Resolves the instant something changes (a node fires, settles, or a
  // RunControl action releases/stops something) so the loop below can
  // re-scan without polling — release/stop can happen an arbitrarily long
  // time after the last node settled, e.g. while the user inspects a
  // paused row, so this isn't purely an internal signal the way it was
  // before breakpoints existed.
  let wake: (() => void) | null = null;
  const progressed = () => {
    wake?.();
    wake = null;
  };
  const nextProgress = () => new Promise<void>((resolve) => (wake = resolve));

  // Shared by an ordinary failure and a user Stop: neither recovers, so
  // anything not already settled or in flight is done for this run —
  // surfacing that immediately (rather than leaving it silently 'pending'
  // forever) is what lets the Debugger tab show *why* a node never ran.
  function skipEverythingStillWaiting() {
    for (const node of nodes) {
      const s = status.get(node.id);
      if (s === 'pending' || s === 'paused') {
        if (s === 'paused') pausedCount--;
        status.set(node.id, 'skipped');
        emit(node.id, 'skipped');
      }
    }
  }

  function fireNode(node: WorkflowNode) {
    status.set(node.id, 'in-flight');
    inFlightCount++;
    emit(node.id, 'in-flight');

    const handler = nodeHandlers[node.kind ?? 'operation'];
    handler.execute(node, ctx).then((step) => {
      steps.push(step);
      stepsByNodeId.set(step.nodeId, step);
      const finalStatus = step.error ? 'failed' : 'completed';
      status.set(node.id, finalStatus);
      inFlightCount--;
      emit(node.id, finalStatus, step);
      if (step.error) {
        halted = true;
        skipEverythingStillWaiting();
      }
      progressed();
    });
  }

  function fireReadyNodes() {
    for (const node of nodes) {
      if (unknownOperationError) return;
      if (status.get(node.id) !== 'pending') continue;
      if (halted || !isSatisfied(node.id)) continue;

      const handler = nodeHandlers[node.kind ?? 'operation'];
      const readyError = handler.checkReady(node, ctx);
      if (readyError) {
        unknownOperationError = new Error(`${readyError} referenced by ${nodeLabels.get(node.id) ?? 'a step'}`);
        progressed();
        return;
      }

      if (isGatedByBreakpoint(node.id)) {
        status.set(node.id, 'paused');
        pausedCount++;
        emit(node.id, 'paused');
        // Preview built asynchronously and reported as a follow-up event —
        // it needs the same credential/mapping resolution buildRequest
        // itself does, which can take a real round-trip (an oauth2 token
        // fetch). A failure here isn't fatal to the pause itself: the row
        // just shows no preview, same as if this were never attempted (and
        // a kind with nothing to preview, e.g. wait, always resolves null).
        handler
          .preview(node, ctx)
          .then((request) => {
            // Guard against a race: Continue/Step may have already fired
            // this node for real by the time the preview finishes building
            // (e.g. a slow oauth2 token fetch) — an event claiming it's
            // still 'paused' at that point would misreport its actual
            // status, so only emit if nothing's changed underneath it.
            if (request && status.get(node.id) === 'paused') emit(node.id, 'paused', undefined, request);
          })
          .catch(() => {});
        continue;
      }

      fireNode(node);
    }
  }

  if (options.onControl) {
    options.onControl({
      continue: () => {
        let released = false;
        for (const node of nodes) {
          if (status.get(node.id) === 'paused') {
            releasedNodeIds.add(node.id);
            status.set(node.id, 'pending');
            pausedCount--;
            released = true;
          }
        }
        if (released) progressed();
      },
      step: (nodeId: string) => {
        if (status.get(nodeId) !== 'paused') return;
        releasedNodeIds.add(nodeId);
        status.set(nodeId, 'pending');
        pausedCount--;
        progressed();
      },
      stop: () => {
        halted = true;
        abortController.abort();
        skipEverythingStillWaiting();
        progressed();
      },
    });
  }

  fireReadyNodes();
  while (inFlightCount > 0 || pausedCount > 0) {
    await nextProgress();
    if (unknownOperationError) break;
    fireReadyNodes();
  }

  if (unknownOperationError) throw unknownOperationError;
  return { steps };
}
