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

export interface WorkflowNode {
  id: string; // unique per canvas instance
  operationId: string; // references an Operation.id
  credentialId: string | null;
  fieldValues: Record<string, FieldValue>;
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

/** In-memory only for now — persistence is planned but not built yet. */
export interface Workflow {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
}

// Phase 1 added bearer/basic/apiKey/oauth2_clientCredentials/oauth2_password
// — every type resolvable from a plain fetch(), no browser navigation
// needed. `popup_login` is the one type that DOES need a real interactive
// browser window: login driven by a third-party identity provider (GitHub,
// Google, SSO, MFA — anything requiring a human to click through pages on
// another origin) can never be completed by a fetch()-driven node — CORS,
// consent screens, and registered-redirect-URI mismatches make that
// impossible regardless of what the login produces. See PopupLoginCredential
// below for what Enlace can and can't do once the popup closes.
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
  | 'popup_login';

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
 * ('header' | 'query') — no 'cookie' here; that's the PRD's separate
 * Cookie credential type, not built yet.
 */
export interface ApiKeyCredential extends CredentialBase {
  type: 'apiKey';
  paramName: string;
  in: 'header' | 'query';
  key: string;
}

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
}

/**
 * OAuth2 resource-owner password-credentials grant — deprecated in general
 * OAuth2 guidance (the client handles the user's actual password) but kept
 * pragmatically given Enlace's pre-prod-only trust model; the UI labels it
 * "legacy" and shows the same client-secret-style warning bearer/basic
 * don't get. `clientId`/`clientSecret` are optional because plenty of
 * token endpoints accept a public client with neither — when either is
 * present it's sent alongside `username`/`password`, per RFC 6749 §4.3.
 */
export interface OAuth2PasswordCredential extends CredentialBase {
  type: 'oauth2_password';
  tokenUrl: string;
  username: string;
  password: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
}

/**
 * Login driven by a real browser popup (`window.open`) — the target sets a
 * session cookie as a side effect of the user completing login themselves,
 * on the target's own origin; Enlace never drives or inspects that
 * navigation, and never sees a token.
 *
 * Unlike every other Credential variant, resolving this one injects
 * nothing into the request at all — no header, no query param.
 * `resolveCredentialInjection` just flips `credentials: 'include'` on the
 * fetch call; the actual value transfer (the cookie itself) happens
 * invisibly, via the browser's own cookie jar, entirely outside Enlace's
 * control (`Cookie` is a forbidden fetch() request header — see
 * engine/credentials.ts — so there is no way for Enlace to attach one
 * explicitly, for any credential type, ever). Conceptually this is closer
 * to "perform an action (log in), then rely on a side effect" than "hold
 * a secret value", which is what every other Credential variant actually
 * does. It's modeled as a Credential today because that's the closest
 * existing mechanism — something attachable to a node — not because it
 * holds anything secret; it's the one variant with no stored value in its
 * own state at all. If more UI-triggered, non-value-bearing actions come
 * up later (re-run login, refresh a token, clear a session), they likely
 * deserve a first-class "Action" concept of their own rather than
 * continuing to stretch Credential to cover both meanings.
 *
 * Deliberately scoped to *only* this cookie case. A "the login flow hands
 * back a token instead, paste it in" variant was designed and built, then
 * dropped: the token can only be obtained by clicking the very "Log in"
 * button sitting on the same form as the now-required Token field, which
 * nothing communicated — the field just sat there empty and required,
 * indistinguishable from "type in a secret you already have" the way
 * every other credential type's fields work. Revisit only on real demand,
 * with that ordering problem actually solved (not just re-added).
 */
export interface PopupLoginCredential extends CredentialBase {
  type: 'popup_login';
  /**
   * Opened in a real browser popup for the user to complete login
   * themselves. Shown both when configuring the credential and afterward
   * on its saved card, since a session is something the user may need to
   * re-establish later (cookies expire), not just once at creation time.
   */
  loginUrl: string;
}

/**
 * Held entirely in browser memory (the store, not persisted) — the secret
 * values never leave the tab except as headers/query params on the actual
 * request to the target API itself (or, for the oauth2_* types, the token
 * endpoint). See engine/credentials.ts's `resolveCredentialInjection`.
 */
export type Credential =
  | BearerCredential
  | BasicCredential
  | ApiKeyCredential
  | OAuth2ClientCredentialsCredential
  | OAuth2PasswordCredential
  | PopupLoginCredential;

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
   * Set to `'include'` when the node's credential is a
   * `popup_login`/`cookie` type — see engine/chainExecutor.ts. Shown as-is
   * in the debug pane (not a secret; there's nothing to redact) so it's
   * visible *why* a cookie-based call succeeded or failed, since nothing
   * else about the request reveals that a cookie was expected at all.
   */
  credentials?: 'include';
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
