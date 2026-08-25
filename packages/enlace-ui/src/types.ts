// Shared data model, per ARCHITECTURE.md §4. Field paths in `fieldValues`
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

/** In-memory only for now — see ROADMAP.md for the planned persistence layer. */
export interface Workflow {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
}

// Phase 1 added bearer/basic/apiKey/oauth2_clientCredentials — the types
// needing no browser redirect/popup. This phase adds oauth2_password
// (still no redirect, just a second, deprecated-but-pragmatic grant type —
// see OAuth2PasswordCredential below). OAuth2 authorizationCode (needs an
// actual redirect/popup + callback route) and the Cookie type remain a
// later phase — see auth-strategy.md at the workspace root.
export type CredentialType = 'bearer' | 'basic' | 'apiKey' | 'oauth2_clientCredentials' | 'oauth2_password';

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
  | OAuth2PasswordCredential;

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
