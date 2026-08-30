import { resolveCredentialInjection } from './credentials.js';
import { resolveRawBody } from './rawBodyResolver.js';
import { buildDependencyGraph } from './dependencyGraph.js';
import { resolveTagsInValue } from '../utils/bodyTags.js';
import { buildNodeLabels } from '../utils/nodeLabel.js';
import type {
  Credential,
  FieldValue,
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

/** Minimal dot/bracket path getter, e.g. "items[0].id" or "order.id". */
export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);

  let current: any = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

/** Exported for reuse by utils/bodyTemplate.ts, which needs the same dotted-path write when reconstructing a body from form fieldValues to detect a lossy Raw->Form conversion. */
export function setByPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.').filter(Boolean);
  let current = target;
  parts.forEach((part, i) => {
    if (i === parts.length - 1) {
      current[part] = value;
    } else {
      current[part] = current[part] ?? {};
      current = current[part] as Record<string, unknown>;
    }
  });
}

function resolveFieldValue(fieldValue: FieldValue, stepsByNodeId: Map<string, RunStep>): unknown {
  if (fieldValue.source === 'static') return fieldValue.value;
  const priorStep = stepsByNodeId.get(fieldValue.fromNodeId);
  return getByPath(priorStep?.response?.body, fieldValue.fromResponseFieldPath);
}

/**
 * Resolves a node's fully-applied request — fields, tag chips, and
 * credential injection — without sending it. `runNode` (below) is this
 * plus the actual `fetch()`; exported separately so a paused node's row
 * can preview exactly what's about to go out before it's released (see
 * `executeChain`'s pause handling), using the same resolution logic a real
 * fire would.
 */
export async function buildRequest(
  node: WorkflowNode,
  operation: Operation,
  stepsByNodeId: Map<string, RunStep>,
  credentialsById: Map<string, Credential>,
  baseUrl: string,
  nodeLabels?: Map<string, string>
): Promise<RunStepRequest> {
  let requestPath = operation.path;
  const query = new URLSearchParams();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const bodyFields: Record<string, unknown> = {};
  const requestMode = node.requestMode ?? 'form';

  // A field's static value can itself contain a `{{enlace:<id>}}`
  // reference even in Form mode — not something the form UI lets you type
  // deliberately, but a Raw JSON tag chip that ended up embedded in a
  // larger string (e.g. "Bearer {{enlace:...}}") survives a lossy Raw ->
  // Form conversion as literal text in a static field (see
  // utils/bodyTemplate.ts): the "Map from..." UI for it is gone, but the
  // mapping itself shouldn't silently stop working, so it's resolved here
  // too — against tags any raw section still carries even once
  // `requestMode` is back to `'form'` (switching modes never clears them).
  const nodeTags = { ...node.rawPath?.tags, ...node.rawQuery?.tags, ...node.rawBody?.tags };

  for (const [fieldPath, fieldValue] of Object.entries(node.fieldValues)) {
    const [section, ...rest] = fieldPath.split('.');
    // Raw mode owns path/query/body from their templates; form fieldValues
    // for those sections are ignored until the user switches back.
    if (requestMode === 'raw' && (section === 'path' || section === 'query' || section === 'body')) {
      continue;
    }

    let value = resolveFieldValue(fieldValue, stepsByNodeId);
    if (Object.keys(nodeTags).length > 0) {
      value = resolveTagsInValue(value, nodeTags, stepsByNodeId, nodeLabels);
    }
    const key = rest.join('.');

    if (section === 'path') {
      requestPath = requestPath.replace(`{${key}}`, encodeURIComponent(String(value ?? '')));
    } else if (section === 'query') {
      if (value !== undefined) query.set(key, String(value));
    } else if (section === 'header') {
      if (value !== undefined) headers[key] = String(value);
    } else if (section === 'body') {
      setByPath(bodyFields, key, value);
    }
  }

  if (requestMode === 'raw') {
    if (node.rawPath) {
      const pathObj = resolveRawBody(node.rawPath, stepsByNodeId, nodeLabels);
      if (pathObj && typeof pathObj === 'object' && !Array.isArray(pathObj)) {
        for (const [key, value] of Object.entries(pathObj as Record<string, unknown>)) {
          if (value === undefined || value === null) continue;
          requestPath = requestPath.replace(`{${key}}`, encodeURIComponent(String(value)));
        }
      }
    }
    if (node.rawQuery) {
      const queryObj = resolveRawBody(node.rawQuery, stepsByNodeId, nodeLabels);
      if (queryObj && typeof queryObj === 'object' && !Array.isArray(queryObj)) {
        for (const [key, value] of Object.entries(queryObj as Record<string, unknown>)) {
          if (value === undefined || value === null) continue;
          query.set(key, typeof value === 'string' ? value : String(value));
        }
      }
    }
  }

  // Runs entirely client-side, same as the request itself: the secret
  // never leaves the tab except as whatever resolveCredentialInjection
  // hands back (a header, a query param, or — uniquely for cookie — a
  // `credentials: 'include'` fetch option instead of any injected value at
  // all) — sent straight to the target API, not routed through any adapter.
  const redactQueryParams: string[] = [];
  // Explicit 'omit' as the base case, not left undefined — see
  // RunStepRequest.credentials's own comment for why: fetch()'s default
  // ('same-origin') would otherwise leak an existing browser cookie on any
  // same-origin target regardless of whether a Cookie credential is even
  // attached.
  let credentials: 'include' | 'omit' = 'omit';
  if (node.credentialId) {
    const credential = credentialsById.get(node.credentialId);
    if (credential) {
      const injection = await resolveCredentialInjection(credential);
      Object.assign(headers, injection.headers);
      for (const [key, value] of Object.entries(injection.query ?? {})) {
        query.set(key, value);
        redactQueryParams.push(key);
      }
      if (injection.credentials) credentials = injection.credentials;
    }
  }

  const queryString = query.toString();
  const url = `${baseUrl}${requestPath}${queryString ? `?${queryString}` : ''}`;

  // Raw JSON mode bypasses the per-leaf `fieldValues['body.*']` fields
  // entirely — the whole body comes from resolving the node's own
  // `rawBody` template (tag chips substituted against `stepsByNodeId`;
  // see engine/rawBodyResolver.ts). A throw here (unknown tag, missing
  // source response, missing header) is caught by runNode's existing
  // try/catch around buildRequest, same as any other request-building
  // failure — no separate error path needed.
  const body =
    requestMode === 'raw' && node.rawBody
      ? resolveRawBody(node.rawBody, stepsByNodeId, nodeLabels)
      : Object.keys(bodyFields).length > 0
        ? bodyFields
        : undefined;
  const hasBody = Boolean(operation.requestBodySchema) && body !== undefined;

  return {
    method: operation.method.toUpperCase(),
    url,
    headers,
    body: hasBody ? body : undefined,
    redactQueryParams: redactQueryParams.length > 0 ? redactQueryParams : undefined,
    credentials,
  };
}

async function runNode(
  node: WorkflowNode,
  operation: Operation,
  stepsByNodeId: Map<string, RunStep>,
  credentialsById: Map<string, Credential>,
  baseUrl: string,
  nodeLabels: Map<string, string>
): Promise<RunStep> {
  // Built before the request fires — every field this node could need
  // comes from an earlier level, already in stepsByNodeId, so there's no
  // ordering hazard reading it here even though other nodes in this same
  // level are being built/fired concurrently. Now async (credential
  // resolution can require a live token-endpoint round-trip — see
  // credentials.ts), so a failure here (e.g. a bad oauth2 tokenUrl) is
  // caught the same way a failed fetch() is: a normal failed RunStep,
  // not an uncaught rejection out of executeChain's Promise.all.
  const timestampStart = new Date().toISOString();
  let request: RunStepRequest;
  try {
    request = await buildRequest(node, operation, stepsByNodeId, credentialsById, baseUrl, nodeLabels);
  } catch (err) {
    return {
      nodeId: node.id,
      request: {
        method: operation.method.toUpperCase(),
        url: `${baseUrl}${operation.path}`,
        headers: {},
        credentials: 'omit',
      },
      timestampStart,
      timestampEnd: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const step: RunStep = { nodeId: node.id, request, timestampStart, timestampEnd: '' };

  try {
    // Browser fetch() — same interface as Node's, no adapter round-trip:
    // this hits the target API directly from the tab. `credentials` is
    // always explicit ('omit' unless a cookie credential set it to
    // 'include' — see RunStepRequest.credentials) rather than left for
    // fetch()'s own 'same-origin' default to decide — 'include' has real
    // consequences (the target's CORS response must explicitly allow
    // credentialed requests from this origin, not just any).
    const res = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
      credentials: request.credentials,
    });

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => (responseHeaders[key] = value));
    const contentType = res.headers.get('content-type') ?? '';
    const responseBody = contentType.includes('application/json')
      ? await res.json().catch(() => null)
      : await res.text();

    step.response = { status: res.status, headers: responseHeaders, body: responseBody };
    step.timestampEnd = new Date().toISOString();
    if (res.status >= 400) {
      step.error = `Request failed with status ${res.status}`;
    }
  } catch (err) {
    step.timestampEnd = new Date().toISOString();
    step.error = err instanceof Error ? err.message : String(err);
  }

  return step;
}

export interface ChainExecutorOptions {
  /** e.g. "http://localhost:4000" — prepended to each Operation.path. Derived from the spec's `servers[0].url` by the caller (see store/workflowStore.ts). */
  baseUrl: string;
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
  // Node ids a breakpoint gated but Continue/Step has since released — a
  // node only ever gets evaluated for gating once (it moves straight from
  // 'paused' to 'pending' to 'in-flight' on release, never back), so
  // recording the release here is enough; no need to track "which
  // connection" was released separately from "which node."
  const releasedNodeIds = new Set<string>();

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

  function fireNode(node: WorkflowNode, operation: Operation) {
    status.set(node.id, 'in-flight');
    inFlightCount++;
    emit(node.id, 'in-flight');

    runNode(node, operation, stepsByNodeId, credentialsById, options.baseUrl, nodeLabels).then((step) => {
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

      const operation = operationsById.get(node.operationId);
      if (!operation) {
        unknownOperationError = new Error(
          `Unknown operation "${node.operationId}" referenced by ${nodeLabels.get(node.id) ?? 'a step'}`
        );
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
        // just shows no preview, same as if this were never attempted.
        buildRequest(node, operation, stepsByNodeId, credentialsById, options.baseUrl, nodeLabels)
          .then((request) => {
            // Guard against a race: Continue/Step may have already fired
            // this node for real by the time the preview finishes building
            // (e.g. a slow oauth2 token fetch) — an event claiming it's
            // still 'paused' at that point would misreport its actual
            // status, so only emit if nothing's changed underneath it.
            if (status.get(node.id) === 'paused') emit(node.id, 'paused', undefined, request);
          })
          .catch(() => {});
        continue;
      }

      fireNode(node, operation);
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
