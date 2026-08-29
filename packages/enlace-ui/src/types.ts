// Shared data model. Field paths in `fieldValues`
// use a "<section>.<key>" convention: "path.id", "query.limit",
// "header.x-foo", or "body.<jsonPath>" (e.g. "body.item"). This is the
// canonical copy — everything in this package (canvas, inspector, debug
// pane, and the client-side execution engine under engine/) shares it;
// there's no longer a server-side duplicate to keep in sync with, since
// execution itself now runs entirely in here.

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
  parameters: OperationParameter[];
  requestBodySchema: Record<string, any> | null;
  responseSchema: Record<string, any> | null;
}

export type FieldValue =
  | { source: 'static'; value: unknown }
  | { source: 'mapped'; fromNodeId: string; fromResponseFieldPath: string };

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

export interface WorkflowNode {
  id: string; // unique per canvas instance
  operationId: string; // references an Operation.id
  credentialId: string | null;
  fieldValues: Record<string, FieldValue>;
  /**
   * Optional (not required) so every pre-existing `WorkflowNode` literal
   * (fixtures, older in-memory state) keeps compiling/behaving unchanged —
   * treat an absent value as `'form'`. Orthogonal to `fieldValues`: raw
   * mode simply stops reading/writing the `body.*` keys within it; path/
   * query/header keys are unaffected either way.
   */
  bodyMode?: 'form' | 'raw';
  rawBody?: RawBody | null;
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
 * In-memory execution shape — `nodes` + `connections` only. Layout,
 * credential records, and spec hints live in an `EnlaceCollection`, the
 * shareable file format (see utils/collectionDocument.ts).
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
 * with empty secret fields on import (see utils/collectionDocument.ts).
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
