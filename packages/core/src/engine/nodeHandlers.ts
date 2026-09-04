import { resolveCredentialInjection } from './credentials.js';
import { resolveRawBody } from './rawBodyResolver.js';
import { getByPath, setByPath } from './path.js';
import { resolveTagsInValue, resolveTagValue } from '../bodyTags.js';
import { evaluateCheck } from './assertCompare.js';
import type {
  Credential,
  FieldValue,
  Preset,
  PresetKind,
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

/**
 * One entry per `PresetKind` — the same "behavior lives in the registry,
 * not the data" split `NodeHandler` gives top-level nodes, sized for what a
 * `Preset` actually is: never a graph node of its own (no `checkReady`
 * gate worth having independent of its collection — see `checkReady`'s own
 * comment below — and no `preview`, since a preset never fires ahead of
 * time for a breakpoint the way an operation node's request does; only the
 * collection as a whole is ever a breakpoint target, and its own `preview`
 * already always returns `null`). `presetsNodeHandler` is the only caller,
 * dispatching on `preset.kind` via the `presetHandlers` registry below.
 */
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
 * ARCHITECTURE.md's "Preset nodes" section). Runs in its turn inside
 * `presetsNodeHandler`'s loop by sleeping `durationMs`, and settles with a
 * synthetic `RunStep` (a made-up `request.method: 'WAIT'`, no `response`)
 * so it still shows up in Results under its collection's `subSteps` — it
 * just never produces a response body a later node could map a field from
 * (`getByPath(undefined, path)` already returns `undefined`, so this needs
 * no special-casing in `resolveFieldValue` above).
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

/**
 * The Assert preset — a run of `checks` against an already-captured
 * response (see ARCHITECTURE.md's "Preset nodes" section), each resolved
 * via bodyTags.ts's `resolveTagValue` (the same "reference into a prior
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
    // Always true — see waitPresetHandler's own comment on this guard.
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

/** One entry per `PresetKind` — see `PresetHandler`'s own comment above. */
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
  checkReady(node, ctx) {
    for (const preset of node.presets ?? []) {
      const error = presetHandlers[preset.kind].checkReady(preset, ctx);
      if (error) return error;
    }
    return null;
  },
  async execute(node, ctx) {
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

export const nodeHandlers: Record<WorkflowNodeKind, NodeHandler> = {
  operation: operationNodeHandler,
  presets: presetsNodeHandler,
};
