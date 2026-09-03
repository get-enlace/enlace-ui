import { resolveCredentialInjection } from './credentials.js';
import { resolveRawBody } from './rawBodyResolver.js';
import { getByPath, setByPath } from './path.js';
import { resolveTagsInValue } from '../bodyTags.js';
import type {
  Credential,
  FieldValue,
  Operation,
  RunStep,
  RunStepRequest,
  WorkflowNode,
  WorkflowNodeKind,
} from '../types.js';

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
  /**
   * Aborted the instant `RunControl.stop()` fires. A handler whose
   * `execute()` can meaningfully cut its work short (Wait's sleep) races
   * against this instead of always running to full length; a handler with
   * nothing to shorten (an HTTP request already in flight can't be
   * un-sent) is free to ignore it entirely, same as before this existed.
   */
  signal: AbortSignal;
}

/**
 * One entry per `WorkflowNodeKind` — see ARCHITECTURE.md's "Preset nodes"
 * section. `chainExecutor.ts`'s `executeChain` is the only caller, and it
 * knows nothing about what a given kind actually does, only this contract:
 * behavior lives here, not as methods on the (serializable, JSON-round-
 * tripped) `WorkflowNode` data itself.
 */
export interface NodeHandler {
  /**
   * Returns an error message if this node can't run at all (e.g. an
   * `'operation'` node whose `operationId` isn't in the loaded spec) —
   * checked once, right before a ready node would fire, so a bad reference
   * surfaces as `executeChain`'s existing immediate failure, not a
   * try/catch deep inside `execute`. `null` means good to go.
   */
  checkReady(node: WorkflowNode, ctx: NodeHandlerContext): string | null;
  /** Runs the node for real and resolves once it's settled — same contract `runNode` always had. */
  execute(node: WorkflowNode, ctx: NodeHandlerContext): Promise<RunStep>;
  /**
   * Resolves this node's about-to-fire request for a breakpoint's pause
   * preview, without sending it — or `null` when this kind has nothing to
   * preview (e.g. Wait has no request at all).
   */
  preview(node: WorkflowNode, ctx: NodeHandlerContext): Promise<RunStepRequest | null>;
}

function resolveFieldValue(
  fieldValue: FieldValue,
  fieldPath: string,
  nodeId: string,
  stepsByNodeId: Map<string, RunStep>,
  uploadedFiles: Record<string, File>
): unknown {
  if (fieldValue.source === 'static') return fieldValue.value;
  if (fieldValue.source === 'file') {
    const file = uploadedFiles[`${nodeId}::${fieldPath}`];
    if (!file) {
      throw new Error(
        `Re-select the file for "${fieldPath}"${fieldValue.fileName ? ` (${fieldValue.fileName})` : ''} — file contents are not persisted.`
      );
    }
    return file;
  }
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
  nodeLabels?: Map<string, string>,
  uploadedFiles: Record<string, File> = {}
): Promise<RunStepRequest> {
  let requestPath = operation.path;
  const query = new URLSearchParams();
  const isMultipart = operation.requestBodyContentType === 'multipart/form-data';
  const headers: Record<string, string> = isMultipart ? {} : { 'Content-Type': 'application/json' };
  const bodyFields: Record<string, unknown> = {};
  const requestMode = isMultipart ? 'form' : (node.requestMode ?? 'form');

  // A field's static value can itself contain a `{{enlace:<id>}}` reference
  // even in Form mode — not something the form UI lets you type
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

    let value = resolveFieldValue(fieldValue, fieldPath, node.id, stepsByNodeId, uploadedFiles);
    if (fieldValue.source !== 'file' && Object.keys(nodeTags).length > 0) {
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
      // Two gates, both must pass: the map is only even consulted while
      // `credentialExtraParamOverridesEnabled` is true (toggled off, it's
      // inert regardless of what it holds — see that flag's own comment on
      // WorkflowNode), and even then, this stays `undefined` rather than an
      // empty object unless at least one entry actually resolved to a
      // value (a row can exist with nothing usable yet — no response field
      // picked, or its source node hasn't produced that field).
      // resolveCredentialInjection treats "was I passed anything at all" as
      // "skip the cache", so either gate failing must fall through to
      // `undefined` — that's what lets the credential's own configured
      // extraTokenParams value (and its cached token) keep working
      // untouched — see credentialExtraParamOverrides's own comment on
      // WorkflowNode for why this deliberately isn't stored on Credential
      // itself.
      let extraTokenParamOverrides: Record<string, string> | undefined;
      if (node.credentialExtraParamOverridesEnabled) {
        for (const [key, fieldValue] of Object.entries(node.credentialExtraParamOverrides ?? {})) {
          const value = resolveFieldValue(
            fieldValue,
            `credential.extraTokenParams.${key}`,
            node.id,
            stepsByNodeId,
            uploadedFiles
          );
          if (value === undefined) continue;
          extraTokenParamOverrides ??= {};
          extraTokenParamOverrides[key] = String(value);
        }
      }
      const injection = await resolveCredentialInjection(credential, extraTokenParamOverrides);
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
  let body: unknown;
  if (isMultipart) {
    body = Object.keys(bodyFields).length > 0 ? appendFormData(bodyFields) : undefined;
  } else if (requestMode === 'raw' && node.rawBody) {
    body = resolveRawBody(node.rawBody, stepsByNodeId, nodeLabels);
  } else {
    body = Object.keys(bodyFields).length > 0 ? bodyFields : undefined;
  }
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

/** Flatten a body object into FormData entries (nested keys as dotted paths). */
function appendFormData(fields: Record<string, unknown>, form = new FormData(), prefix = ''): FormData {
  for (const [key, value] of Object.entries(fields)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value instanceof File) {
      form.append(name, value, value.name);
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      appendFormData(value as Record<string, unknown>, form, name);
    } else if (value !== undefined && value !== null) {
      form.append(name, typeof value === 'string' ? value : String(value));
    }
  }
  return form;
}

async function runOperationNode(
  node: WorkflowNode,
  operation: Operation,
  stepsByNodeId: Map<string, RunStep>,
  credentialsById: Map<string, Credential>,
  baseUrl: string,
  nodeLabels: Map<string, string>,
  uploadedFiles: Record<string, File>
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
    request = await buildRequest(node, operation, stepsByNodeId, credentialsById, baseUrl, nodeLabels, uploadedFiles);
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
    //
    // Multipart: pass FormData through and do NOT JSON.stringify — and
    // Content-Type must already have been omitted in buildRequest so fetch
    // can set multipart/form-data; boundary=...
    const body =
      request.body === undefined
        ? undefined
        : request.body instanceof FormData
          ? request.body
          : JSON.stringify(request.body);
    const res = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body,
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

/**
 * `'operation'` (the default/absent `kind`) — today's HTTP-calling path,
 * unchanged behavior, just wrapped to satisfy `NodeHandler` instead of
 * being called directly by `chainExecutor.ts`.
 */
export const operationNodeHandler: NodeHandler = {
  checkReady(node, ctx) {
    const operation = node.operationId ? ctx.operationsById.get(node.operationId) : undefined;
    return operation ? null : `Unknown operation "${node.operationId}"`;
  },
  execute(node, ctx) {
    // checkReady already guaranteed this exists before executeChain fires the node.
    const operation = ctx.operationsById.get(node.operationId!)!;
    return runOperationNode(
      node,
      operation,
      ctx.stepsByNodeId,
      ctx.credentialsById,
      ctx.baseUrl,
      ctx.nodeLabels,
      ctx.uploadedFiles
    );
  },
  async preview(node, ctx) {
    const operation = node.operationId ? ctx.operationsById.get(node.operationId) : undefined;
    if (!operation) return null;
    return buildRequest(
      node,
      operation,
      ctx.stepsByNodeId,
      ctx.credentialsById,
      ctx.baseUrl,
      ctx.nodeLabels,
      ctx.uploadedFiles
    );
  },
};

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
 * ARCHITECTURE.md's "Preset nodes" section). Fires like any other node once
 * its dependencies are satisfied and no breakpoint gates it, "runs" by
 * sleeping `durationMs`, and settles with a synthetic `RunStep` (a made-up
 * `request.method: 'WAIT'`, no `response`) so it still shows up in Results
 * and downstream execution-order logic sees it complete normally — it just
 * never produces a response body a later node could map a field from
 * (`getByPath(undefined, path)` already returns `undefined`, so this needs
 * no special-casing in `resolveFieldValue` above).
 *
 * Honors the run's abort signal (see `ChainExecutorOptions`/`RunControl.stop`
 * in chainExecutor.ts): a Stop pressed mid-sleep resolves the wait
 * immediately instead of holding up the rest of the run for however long
 * was left, which would otherwise defeat the point of Stop for any chain
 * with a long wait in it.
 */
export const waitNodeHandler: NodeHandler = {
  checkReady() {
    return null;
  },
  async execute(node, ctx) {
    const durationMs = Math.max(0, node.durationMs ?? 0);
    const timestampStart = new Date().toISOString();
    await sleep(durationMs, ctx.signal);
    return {
      nodeId: node.id,
      request: { method: 'WAIT', url: `wait:${durationMs}ms`, headers: {}, credentials: 'omit' },
      timestampStart,
      timestampEnd: new Date().toISOString(),
    };
  },
  async preview() {
    // Nothing to preview — a Wait node has no request to resolve ahead of firing.
    return null;
  },
};

export const nodeHandlers: Record<WorkflowNodeKind, NodeHandler> = {
  operation: operationNodeHandler,
  wait: waitNodeHandler,
};
