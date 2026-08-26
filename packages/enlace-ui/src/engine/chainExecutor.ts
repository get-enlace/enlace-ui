import { resolveCredentialInjection } from './credentials.js';
import { resolveRawBody } from './rawBodyResolver.js';
import { resolveTagsInValue } from '../utils/bodyTags.js';
import type {
  Credential,
  FieldValue,
  Operation,
  RunResult,
  RunStep,
  RunStepRequest,
  Workflow,
  WorkflowConnection,
  WorkflowNode,
} from '../types.js';

export class CyclicWorkflowError extends Error {
  constructor(public readonly nodeIds: string[]) {
    super(`Workflow has a cyclic dependency involving nodes: ${nodeIds.join(', ')}`);
    this.name = 'CyclicWorkflowError';
  }
}

function buildDependencyGraph(nodes: WorkflowNode[], connections: WorkflowConnection[]): Map<string, Set<string>> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const dependsOn = new Map<string, Set<string>>();
  for (const node of nodes) dependsOn.set(node.id, new Set());

  // Explicit connections (order only, no data — e.g. a node with no mapped
  // fields that still needs to run in a particular slot).
  for (const { fromNodeId, toNodeId } of connections) {
    if (byId.has(fromNodeId) && dependsOn.has(toNodeId)) {
      dependsOn.get(toNodeId)!.add(fromNodeId);
    }
  }

  // Mapped fieldValues (a mapping always implies its source must run first,
  // whether or not the user also drew an explicit connection).
  for (const node of nodes) {
    for (const fieldValue of Object.values(node.fieldValues)) {
      if (fieldValue.source === 'mapped' && byId.has(fieldValue.fromNodeId)) {
        dependsOn.get(node.id)!.add(fieldValue.fromNodeId);
      }
    }
  }

  return dependsOn;
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

async function buildRequest(
  node: WorkflowNode,
  operation: Operation,
  stepsByNodeId: Map<string, RunStep>,
  credentialsById: Map<string, Credential>,
  baseUrl: string
): Promise<RunStepRequest> {
  let requestPath = operation.path;
  const query = new URLSearchParams();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const bodyFields: Record<string, unknown> = {};

  // A field's static value can itself contain a `{{enlace:<id>}}`
  // reference even in Form mode — not something the form UI lets you type
  // deliberately, but a Raw JSON tag chip that ended up embedded in a
  // larger string (e.g. "Bearer {{enlace:...}}") survives a lossy Raw ->
  // Form conversion as literal text in a static field (see
  // utils/bodyTemplate.ts): the "Map from..." UI for it is gone, but the
  // mapping itself shouldn't silently stop working, so it's resolved here
  // too — against the same `tags` the node's `rawBody` still carries even
  // once `bodyMode` is back to `'form'` (switching modes never clears it).
  const nodeTags = node.rawBody?.tags;

  for (const [fieldPath, fieldValue] of Object.entries(node.fieldValues)) {
    let value = resolveFieldValue(fieldValue, stepsByNodeId);
    if (nodeTags && Object.keys(nodeTags).length > 0) {
      value = resolveTagsInValue(value, nodeTags, stepsByNodeId);
    }
    const [section, ...rest] = fieldPath.split('.');
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

  // Runs entirely client-side, same as the request itself: the secret
  // never leaves the tab except as whatever resolveCredentialInjection
  // hands back (a header, a query param, or — uniquely for
  // popup_login/cookie — a `credentials: 'include'` fetch option instead
  // of any injected value at all) — sent straight to the target API, not
  // routed through any adapter.
  const redactQueryParams: string[] = [];
  let credentials: 'include' | undefined;
  if (node.credentialId) {
    const credential = credentialsById.get(node.credentialId);
    if (credential) {
      const injection = await resolveCredentialInjection(credential);
      Object.assign(headers, injection.headers);
      for (const [key, value] of Object.entries(injection.query ?? {})) {
        query.set(key, value);
        redactQueryParams.push(key);
      }
      credentials = injection.credentials;
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
    node.bodyMode === 'raw' && node.rawBody
      ? resolveRawBody(node.rawBody, stepsByNodeId)
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
  baseUrl: string
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
    request = await buildRequest(node, operation, stepsByNodeId, credentialsById, baseUrl);
  } catch (err) {
    return {
      nodeId: node.id,
      request: { method: operation.method.toUpperCase(), url: `${baseUrl}${operation.path}`, headers: {} },
      timestampStart,
      timestampEnd: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const step: RunStep = { nodeId: node.id, request, timestampStart, timestampEnd: '' };

  try {
    // Browser fetch() — same interface as Node's, no adapter round-trip:
    // this hits the target API directly from the tab. `credentials` is
    // left undefined (fetch()'s own default, 'same-origin') unless a
    // popup_login/cookie credential set it to 'include' — most nodes have
    // no reason to send cookies at all, and 'include' has real
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
}

/**
 * Executes a workflow's nodes in dependency order, one level (wave) at a
 * time, but every node within a level fires
 * concurrently via Promise.all, since none of them can depend on each
 * other (see computeExecutionLevels). A failure anywhere in a level halts
 * before the next level starts — no partial recovery — but everything
 * already in flight in that level runs to completion first; requests
 * already fired can't be un-sent.
 */
export async function executeChain(
  workflow: Workflow,
  operationsById: Map<string, Operation>,
  credentialsById: Map<string, Credential>,
  options: ChainExecutorOptions
): Promise<RunResult> {
  const levels = computeExecutionLevels(workflow.nodes, workflow.connections);
  const stepsByNodeId = new Map<string, RunStep>();
  const steps: RunStep[] = [];

  for (const level of levels) {
    const levelSteps = await Promise.all(
      level.map((node) => {
        const operation = operationsById.get(node.operationId);
        if (!operation) {
          throw new Error(`Unknown operation "${node.operationId}" referenced by node ${node.id}`);
        }
        return runNode(node, operation, stepsByNodeId, credentialsById, options.baseUrl);
      })
    );

    let levelFailed = false;
    for (const step of levelSteps) {
      steps.push(step);
      stepsByNodeId.set(step.nodeId, step);
      if (step.error) levelFailed = true;
    }

    if (levelFailed) break;
  }

  return { steps };
}
