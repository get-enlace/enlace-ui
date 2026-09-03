// Shared data model for Enlace chains, credentials, and run results.
// Lives in @get-enlace/core so UI and (later) CLI share one portable copy.

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface OperationParameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  schema: Record<string, any>;
}

/** Derived from the spec fresh on each load — never stored. */
export interface Operation {
  id: string; // e.g. "POST /orders"
  method: HttpMethod;
  path: string;
  summary?: string;
  /** The spec's own `operationId` (e.g. "addPet"), when the spec declares one — not every operation has one. */
  operationId?: string;
  /** First tag wins for grouping; operations with no tags land in the "Untagged" group. */
  tags?: string[];
  parameters: OperationParameter[];
  requestBodySchema: Record<string, any> | null;
  /**
   * Which requestBody content type `requestBodySchema` came from.
   * Prefer `application/json` when the op offers both; `multipart/form-data`
   * only when JSON is absent. Null when there is no request body. Optional
   * so older test fixtures keep compiling — treat absent as JSON whenever a
   * schema is present.
   */
  requestBodyContentType?: 'application/json' | 'multipart/form-data' | null;
  responseSchema: Record<string, any> | null;
}

export type FieldValue =
  | { source: 'static'; value: unknown }
  | { source: 'mapped'; fromNodeId: string; fromResponseFieldPath: string }
  /** Marker only — the real `File` lives in the store's `uploadedFiles` map and is never serialized. */
  | { source: 'file'; fileName: string };

/**
 * What a single inline "tag chip" in a Raw JSON body resolves against —
 * see engine/rawBodyResolver.ts. `response_body` reads a JSONPath-ish
 * filter (utils/bodyTags.ts's `resolveJsonPath`, a thin wrapper over
 * chainExecutor.ts's `getByPath`) out of the source node's parsed response
 * body; `response_raw` takes that response body whole, no filter applied;
 * `response_header` reads one named response header (case-insensitively).
 */
export type BodyTagType = 'response_body' | 'response_raw' | 'response_header';

export interface BodyTag {
  id: string;
  type: BodyTagType;
  sourceNodeId: string;
  /** `response_body` only — dot/bracket path, e.g. "items[0].id"; an optional leading "$."/"$" is stripped. Omitted/empty means "the whole body". */
  jsonPath?: string;
  /** `response_header` only. */
  headerName?: string;
}

/**
 * The Raw JSON alternative to per-leaf `fieldValues['body.*']` entries —
 * see utils/bodyTemplate.ts for the Form<->Raw conversion and
 * components/RawBodyEditor.tsx for the editor itself. `template` is
 * always valid JSON text; a mapped value is represented as literal text
 * `{{enlace:<tagId>}}` sitting inside an existing string's quotes (see
 * utils/bodyTags.ts's `tagPattern`/`makeTagPlaceholder`), never as a
 * standalone token that would make the JSON invalid.
 */
export interface RawBody {
  template: string;
  tags: Record<string, BodyTag>;
}

/**
 * Discriminates what a `WorkflowNode` actually does when it runs —
 * dispatched by engine/nodeHandlers.ts's handler registry (`chainExecutor.ts`
 * only knows this contract, never a kind's specifics). `'operation'` is
 * every node from before this field existed: it fires an HTTP call
 * described by `operationId`. `'wait'` is the first non-HTTP preset (see
 * ARCHITECTURE.md's "Preset nodes" section) — a pure pacing step with no
 * request/response of its own.
 */
export type WorkflowNodeKind = 'operation' | 'wait';

export interface WorkflowNode {
  id: string; // unique per canvas instance
  /**
   * Optional, and absent means `'operation'` — every pre-existing
   * `WorkflowNode` literal (fixtures, older in-memory state, older
   * `.enlace` imports) keeps compiling and behaving exactly as before with
   * no migration step of its own. See utils/workflowDocument.ts for the
   * explicit `kind` an import writes/reads today.
   */
  kind?: WorkflowNodeKind;
  /**
   * References an Operation.id. Required in practice for `kind: 'operation'`
   * (the default) — optional on the type only because other kinds (e.g.
   * `'wait'`) don't have one at all and still need to satisfy this same
   * interface (see this file's own note on why `WorkflowNode` stays one
   * flat shape rather than a discriminated union: every existing consumer
   * already treats most of these fields as optional/absent-safe).
   */
  operationId?: string;
  credentialId: string | null;
  fieldValues: Record<string, FieldValue>;
  /**
   * `kind: 'wait'` only — how long the node pauses execution, in
   * milliseconds, once its dependencies are satisfied and no breakpoint
   * gates it. Ignored by every other kind.
   */
  durationMs?: number;
  /**
   * Optional (not required) so every pre-existing `WorkflowNode` literal
   * (fixtures, older in-memory state) keeps compiling/behaving unchanged —
   * treat an absent value as `'form'`. Orthogonal to `fieldValues`: raw
   * mode stops reading/writing `path.*` / `query.*` / `body.*` keys from
   * `fieldValues` and uses `rawPath` / `rawQuery` / `rawBody` instead.
   * Header fields always stay on the form.
   *
   * Older collections may still serialize this as `bodyMode` — import
   * accepts either key (see utils/workflowDocument.ts).
   */
  requestMode?: 'form' | 'raw';
  rawPath?: RawBody | null;
  rawQuery?: RawBody | null;
  rawBody?: RawBody | null;
  /**
   * Per-node overrides of an oauth2 credential's `extraTokenParams`
   * (`oauth2_clientCredentials` / `oauth2_password` only — no effect on
   * any other credential type), keyed by the same param name, resolved
   * the same way a mapped `FieldValue` in `fieldValues` is: from a static
   * value, or from an ancestor node's captured response.
   *
   * Deliberately layered *on top of* the credential's own
   * `extraTokenParams` at request time rather than stored on the shared
   * `Credential` itself — a `Credential` is collection-level and may be
   * reused by several nodes (even across workflows), so a `fromNodeId`
   * living there wouldn't reliably resolve everywhere it's used. Scoping
   * the override to the node also means it deliberately bypasses
   * engine/credentials.ts's token cache entirely (fetches a fresh token
   * every time, never caches or reuses it, never mutates the stored
   * credential) — correct, not just simpler, since a value pulled from a
   * node's response can differ from one run to the next.
   *
   * Only takes effect at all when `credentialExtraParamOverridesEnabled`
   * is `true` — see that flag's own comment below for why this map's
   * contents alone are never enough to activate an override.
   */
  credentialExtraParamOverrides?: Record<string, FieldValue>;
  /**
   * Master switch for `credentialExtraParamOverrides` above — toggled off
   * (the default), the map is inert: ignored by both `buildDependencyGraph`
   * (no implied "runs after" edge) and `buildRequest` (no merge, normal
   * cached token), *even if* it holds entries from a previous session with
   * the toggle on. Turning the toggle off deliberately doesn't clear the
   * map, so flipping it back on restores whatever was configured — this is
   * a visibility/activation switch, not a delete action.
   */
  credentialExtraParamOverridesEnabled?: boolean;
}

/**
 * An explicit "runs after" edge between two nodes — this is what
 * establishes execution ORDER. It is a separate concern from `FieldValue`
 * mapping, which establishes a field's DATA SOURCE. A node's fields may be
 * mapped from any ancestor in this connection graph, not just the node
 * immediately before it — e.g. A -> B -> C where B carries no data, C can
 * still map a field from A.
 *
 * A mapped FieldValue also implies its own "runs after" edge (the source
 * must execute before the target regardless of whether the user drew an
 * explicit connection) — the executor's dependency graph is the union of
 * both sources.
 */
export interface WorkflowConnection {
  fromNodeId: string;
  toNodeId: string;
}

/**
 * Canvas-only named group of workflow nodes — layout/chrome, never part of
 * the executed `Workflow`. Members stay real `WorkflowNode`s; collapsing
 * hides their cards and routes external edges through the group shell.
 * Persisted beside `nodePositions` in `.enlace` exports.
 */
export interface NodeGroup {
  id: string;
  name: string;
  nodeIds: string[];
  collapsed: boolean;
  /** Origin of the group chrome (expanded frame / collapsed compact card). */
  position: { x: number; y: number };
  /** When true, dropping another node onto this group joins without a confirm. */
  skipConfirmOnDrop: boolean;
}

/**
 * In-memory execution shape — `nodes` + `connections` only. Layout,
 * credential records, and spec hints live in an `EnlaceCollection`, the
 * shareable file format (see utils/workflowDocument.ts).
 */
export interface Workflow {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
}

export const ENLACE_COLLECTION_FORMAT = 'enlace-collection' as const;
export const ENLACE_COLLECTION_VERSION = 1 as const;

export interface CollectionSpecHint {
  title?: string;
  version?: string;
  /** Unique `WorkflowNode.operationId` values used by this chain. */
  operationIds: string[];
}

/**
 * A credential as written to a stripped `EnlaceCollection` — same `id` as the
 * in-memory credential so `node.credentialId` still points at it, but
 * without any value that authenticates. Hydrated back to a `Credential`
 * with empty secret fields on import (see utils/workflowDocument.ts).
 */
export type CredentialStub =
  | { id: string; name: string; fromSecurityScheme?: string; type: 'bearer' }
  | { id: string; name: string; fromSecurityScheme?: string; type: 'basic'; username?: string }
  | {
      id: string;
      name: string;
      fromSecurityScheme?: string;
      type: 'apiKey';
      paramName: string;
      in: 'header' | 'query';
    }
  | {
      id: string;
      name: string;
      fromSecurityScheme?: string;
      type: 'oauth2_clientCredentials';
      tokenUrl: string;
      clientId?: string;
      scope?: string;
      extraTokenParams?: Record<string, string>;
      clientAuthMethod?: OAuth2ClientAuthMethod;
    }
  | {
      id: string;
      name: string;
      fromSecurityScheme?: string;
      type: 'oauth2_password';
      tokenUrl: string;
      username?: string;
      clientId?: string;
      scope?: string;
      extraTokenParams?: Record<string, string>;
      clientAuthMethod?: OAuth2ClientAuthMethod;
    }
  | { id: string; name: string; fromSecurityScheme?: string; type: 'cookie'; loginUrl?: string };

export interface CollectionWorkflow {
  id: string;
  name: string;
  specHint: CollectionSpecHint;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  nodePositions: Record<string, { x: number; y: number }>;
  /** Canvas groups — same tier as `nodePositions`. */
  groups: NodeGroup[];
}

export type CollectionSecretsMode = 'stripped' | 'included';

/**
 * Versioned `.enlace` file. V1 exports one workflow but uses an array so
 * later multi-workflow support does not require another envelope format.
 */
export interface EnlaceCollection {
  format: typeof ENLACE_COLLECTION_FORMAT;
  version: typeof ENLACE_COLLECTION_VERSION;
  name: string;
  exportedAt: string;
  secrets: CollectionSecretsMode;
  credentials: Array<CredentialStub | Credential>;
  workflows: CollectionWorkflow[];
}

export interface CollectionWarnings {
  unknownOperationIds: string[];
  credentialsNeedingSecrets: Array<{ id: string; name: string; type: CredentialType }>;
  /** The imported collection deliberately contains usable credential secrets. */
  secretsIncluded: boolean;
  /** Secret keys were present despite `secrets: "stripped"` and were discarded. */
  unexpectedSecretsDiscarded: boolean;
}

// Phase 1 added bearer/basic/apiKey/oauth2_clientCredentials/oauth2_password
// — every type resolvable from a plain fetch(), no browser navigation
// needed. `cookie` is the odd one out: it doesn't resolve to a value at
// all. The user logs into the target themselves, in any tab of this same
// browser, entirely independent of Enlace — Enlace never drives or
// inspects that login, and never sees a token. See CookieCredential below
// for what this does and doesn't do.
//
// Full OAuth2 `authorizationCode` support (Enlace owning a registered
// callback route to capture a code/token itself, then exchanging a code
// for a token) remains a later phase, not built yet.
export type CredentialType =
  | 'bearer'
  | 'basic'
  | 'apiKey'
  | 'oauth2_clientCredentials'
  | 'oauth2_password'
  | 'cookie';

interface CredentialBase {
  id: string;
  name: string;
  /**
   * The `components.securitySchemes` key (e.g. "bearerAuth") this
   * credential was configured from, if the user picked it from what the
   * spec itself declares rather than starting a blank form — see
   * engine/securitySchemes.ts and CredentialsPanel.tsx. Purely
   * informational (shown as a small tag on the credential's card); never
   * read by the execution engine.
   */
  fromSecurityScheme?: string;
}

export interface BearerCredential extends CredentialBase {
  type: 'bearer';
  token: string;
}

export interface BasicCredential extends CredentialBase {
  type: 'basic';
  username: string;
  password: string;
}

/**
 * `in` mirrors an OpenAPI apiKey securityScheme's own `in` field
 * ('header' | 'query') — no 'cookie' here; that's the separate
 * CookieCredential type below.
 */
export interface ApiKeyCredential extends CredentialBase {
  type: 'apiKey';
  paramName: string;
  in: 'header' | 'query';
  key: string;
}

/**
 * How clientId/clientSecret are sent on the *token endpoint* request
 * itself (never the actual API call — that always gets the resulting
 * bearer token in an Authorization header, regardless of this setting).
 * `'basic'` is RFC 6749 §2.3.1's `client_secret_basic` — an
 * `Authorization: Basic base64(clientId:clientSecret)` header on the
 * token request — which is what most .NET identity servers (IdentityServer/
 * Duende and similar) require and reject anything else for. `'body'` is
 * `client_secret_post` — clientId/clientSecret as form params alongside
 * grant_type, which is what Enlace sent unconditionally before this field
 * existed. Defaults to `'basic'` since RFC 6749 requires every token
 * endpoint to support it, while body-param auth is only an optional
 * extension some servers skip.
 */
export type OAuth2ClientAuthMethod = 'basic' | 'body';

/**
 * OAuth2 client-credentials grant — no human interaction, so it's the one
 * OAuth2 grant fully automatable from the browser: POST to `tokenUrl` with
 * clientId/clientSecret, cache the resulting bearer token in memory (see
 * engine/credentials.ts). The other grants (authorizationCode, password)
 * need a redirect/popup and are a later phase.
 */
export interface OAuth2ClientCredentialsCredential extends CredentialBase {
  type: 'oauth2_clientCredentials';
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  /**
   * Extra form-body params on the token request (e.g. `audience`, `resource`,
   * vendor-specific claims). Never overrides grant_type / scope / client_* /
   * username / password — those stay first-class fields.
   */
  extraTokenParams?: Record<string, string>;
  clientAuthMethod: OAuth2ClientAuthMethod;
}

/**
 * OAuth2 resource-owner password-credentials grant — deprecated in general
 * OAuth2 guidance (the client handles the user's actual password) but kept
 * pragmatically given Enlace's pre-prod-only trust model; the UI labels it
 * "legacy" and shows the same client-secret-style warning bearer/basic
 * don't get. `clientId`/`clientSecret` are optional because plenty of
 * token endpoints accept a public client with neither — when either is
 * present it's sent alongside `username`/`password`, per RFC 6749 §4.3.
 * `clientAuthMethod` (see OAuth2ClientAuthMethod) only takes effect when
 * clientId/clientSecret are actually set — a public client with neither
 * has nothing to send via Basic or body either way.
 */
export interface OAuth2PasswordCredential extends CredentialBase {
  type: 'oauth2_password';
  tokenUrl: string;
  username: string;
  password: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  /** Same meaning as OAuth2ClientCredentialsCredential.extraTokenParams. */
  extraTokenParams?: Record<string, string>;
  clientAuthMethod: OAuth2ClientAuthMethod;
}

/**
 * The target authenticates via a session cookie. The user logs into the
 * target themselves, in any tab of this same browser, using whatever
 * login flow the target itself requires — entirely independent of Enlace,
 * which has no part in that login and never sees the cookie's value.
 *
 * Unlike every other Credential variant, resolving this one injects
 * nothing into the request at all — no header, no query param.
 * `resolveCredentialInjection` just flips `credentials: 'include'` on the
 * fetch call; the actual value transfer (the cookie itself) happens
 * invisibly, via the browser's own cookie jar, entirely outside Enlace's
 * control (`Cookie` is a forbidden fetch() request header — see
 * engine/credentials.ts — so there is no way for Enlace to attach one
 * explicitly, for any credential type, ever). Conceptually this is closer
 * to "rely on an out-of-band side effect" than "hold a secret value",
 * which is what every other Credential variant actually does. It's
 * modeled as a Credential today because that's the closest existing
 * mechanism — something attachable to a node — not because it holds
 * anything secret; it's the one variant with no stored value in its own
 * state at all. If more UI-triggered, non-value-bearing actions come up
 * later (re-run login, refresh a token, clear a session), they likely
 * deserve a first-class "Action" concept of their own rather than
 * continuing to stretch Credential to cover both meanings.
 *
 * Deliberately scoped to *only* this cookie case. A "the login flow hands
 * back a token instead, paste it in" variant was designed and built, then
 * dropped: the token could only be obtained by clicking a login-triggering
 * button sitting on the same form as the now-required Token field, which
 * nothing communicated — the field just sat there empty and required,
 * indistinguishable from "type in a secret you already have" the way
 * every other credential type's fields work. Revisit only on real demand,
 * with that ordering problem actually solved (not just re-added).
 */
export interface CookieCredential extends CredentialBase {
  type: 'cookie';
  /**
   * A plain convenience link, not a mechanism Enlace drives — the user's
   * actual login happens independently, however that target's login flow
   * works (a simple form, a multi-step SSO/MFA redirect chain ending on
   * the target's own UI, whatever). Optional: this credential is usable
   * with nothing but a name. Shown both when configuring the credential
   * and again on its saved card, since a session is something the user
   * may need to re-establish later (cookies expire), not just once at
   * creation time.
   */
  loginUrl?: string;
}

/**
 * Held in browser memory by default. The only persistence path for secret
 * values is an explicitly acknowledged full-credential `.enlace` export;
 * normal exports contain `CredentialStub` records instead.
 */
export type Credential =
  | BearerCredential
  | BasicCredential
  | ApiKeyCredential
  | OAuth2ClientCredentialsCredential
  | OAuth2PasswordCredential
  | CookieCredential;

// Omit doesn't distribute over a union on its own (it'd collapse to the
// intersection of keys) — this does, so NewCredential stays a proper union
// of "each variant minus id".
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type NewCredential = DistributiveOmit<Credential, 'id'>;

export interface RunStepRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  /**
   * Names of `url`'s query params that hold a credential secret (from an
   * apiKey credential with `in: 'query'`) — unlike a header, there's no
   * single well-known key ("Authorization") to redact by convention, so
   * the debug pane (the only place `url` is ever displayed) needs this
   * list to know which params to mask. Never used to build the actual
   * request — only to redact the copy shown in the UI.
   */
  redactQueryParams?: string[];
  /**
   * `'include'` only when the node's credential is a `cookie` type,
   * `'omit'` otherwise — always explicit, never left for fetch()'s own
   * default to decide (see engine/chainExecutor.ts's real `fetch()` call).
   * That matters: fetch()'s default is `'same-origin'`, not `'omit'` — for
   * any target sharing an origin with wherever Enlace's canvas is served
   * from (the norm, not an edge case: adapters commonly serve the canvas
   * and the target API from the same host/port), the browser would send
   * along any cookie already sitting in its jar for that origin even with
   * no Cookie credential attached at all, silently defeating the entire
   * point of credential-per-node scoping. Explicit `'omit'` closes that
   * gap — no Cookie credential attached genuinely means no cookies, ever,
   * regardless of origin. Shown as-is in the debug pane when `'include'`
   * (not a secret; there's nothing to redact) so it's visible *why* a
   * cookie-based call succeeded or failed, since nothing else about the
   * request reveals that a cookie was expected at all.
   */
  credentials: 'include' | 'omit';
}

export interface RunStepResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface RunStep {
  nodeId: string;
  request: RunStepRequest;
  response?: RunStepResponse;
  timestampStart: string;
  timestampEnd: string;
  error?: string;
}

export interface RunResult {
  steps: RunStep[];
}

/**
 * A node's live status during a run — distinct from a `RunStep`, which only
 * exists once a node has actually settled (`'completed'`/`'failed'`).
 * `'paused'` means every dependency is satisfied but an armed breakpoint on
 * an incoming connection is holding it back (see engine/chainExecutor.ts's
 * `executeChain` and its `RunControl`); `'skipped'` means it will never
 * fire this run — either a Stop was issued, or some other node failed —
 * assigned the instant that becomes true, not lazily at run's end.
 */
export type RunStepStatus = 'pending' | 'in-flight' | 'paused' | 'completed' | 'failed' | 'skipped';

/**
 * One progress notification from `executeChain`'s `onEvent` callback,
 * fired as each node transitions status — at minimum once on
 * `pending -> in-flight` and once more on settling. `step` is only present
 * once a `RunStep` actually exists for the node, i.e. on `'completed'`/
 * `'failed'` events; the store (see store/workflowStore.ts's `run()`)
 * consumes this stream to update `runResult`/live status incrementally
 * instead of only once, after the whole chain finishes.
 */
export interface RunEvent {
  nodeId: string;
  status: RunStepStatus;
  step?: RunStep;
  /**
   * Present only on a `'paused'` event, and only once the preview finishes
   * building (a second event follows the first `'paused'` event, which
   * fires immediately with no `request` yet) — the fully-resolved request
   * this node would send once released (headers/query/body/credential
   * already applied), built the same way `runNode` builds one, just without
   * firing it. Lets the Debugger tab show exactly what's about to go out
   * before the user commits to Continue/Step.
   */
  request?: RunStepRequest;
}

/**
 * A live handle into one in-progress `executeChain` call, handed back via
 * `ChainExecutorOptions.onControl` — this is how Continue/Step/Stop
 * (driven by the store, in response to user action) reach into a run
 * that's already underway. See store/workflowStore.ts's `run()`, which
 * captures this and exposes it as `continueExecution`/`stepNode`/
 * `stopExecution` store actions.
 */
export interface RunControl {
  /** Releases every node currently paused at a breakpoint. A *later* breakpoint further down the graph still pauses — this only clears what's paused right now. */
  continue(): void;
  /** Releases exactly one specific paused node, by id — the rest stay paused. */
  step(nodeId: string): void;
  /** Admits nothing new from here on; anything already in flight still runs to completion. Every node that was `'pending'` or `'paused'` at the moment of the call becomes `'skipped'`. */
  stop(): void;
}
