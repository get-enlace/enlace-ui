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

// POC/MVP supports "bearer" only; a later pass adds apiKey | basic | oauth2_client_credentials.
export type CredentialType = 'bearer';

/**
 * Held entirely in browser memory (this store, not persisted) — the token
 * never leaves the tab except as the Authorization header on the actual
 * request to the target API itself. See engine/chainExecutor.ts's
 * `toAuthHeader`.
 */
export interface Credential {
  id: string;
  name: string;
  type: CredentialType;
  token: string;
}

export type NewCredential = Omit<Credential, 'id'>;

export interface RunStepRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
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
