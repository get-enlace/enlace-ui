import { create } from 'zustand';
import { fetchSpec } from '../api/client.js';
import { parseOperations } from '../engine/specParser.js';
import { executeChain } from '../engine/chainExecutor.js';
import { extractDeclaredCredentials, type DeclaredCredential } from '../engine/securitySchemes.js';
import { randomId } from '../utils/randomId.js';
import type {
  Credential,
  FieldValue,
  NewCredential,
  Operation,
  RawBody,
  RunResult,
  WorkflowConnection,
  WorkflowNode,
} from '../types.js';

export interface Position {
  x: number;
  y: number;
}

/** Grid fallback for a node with no explicit position — matches the old default layout. */
function defaultPosition(index: number): Position {
  return { x: 80 + (index % 4) * 220, y: 80 + Math.floor(index / 4) * 140 };
}

/**
 * Reads the target base URL from the spec itself — `servers[0].url` —
 * exactly the convention swagger-ui-express's own "Try it out" already
 * relies on. There's no adapter-side `targetBaseUrl` option anymore: the
 * browser is what makes the request now, so it's the browser that needs
 * this, not the adapter.
 */
function resolveBaseUrl(spec: Record<string, any>): string | null {
  const servers: Array<{ url?: string }> = spec.servers ?? [];
  if (servers.length === 0 || !servers[0]?.url) return null;

  if (servers.length > 1) {
    console.warn(
      `enlace: spec declares ${servers.length} servers; defaulting to the first ` +
        `(${servers[0].url}).`
    );
  }

  return servers[0].url;
}

interface WorkflowState {
  operations: Operation[];
  /** Derived from the loaded spec's `servers[0].url` — null until loadOperations() resolves. */
  baseUrl: string | null;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  /** Canvas layout only — not part of the executed Workflow. */
  nodePositions: Record<string, Position>;
  credentials: Credential[];
  /** Pre-fill templates read from the loaded spec's own `components.securitySchemes` — see engine/securitySchemes.ts. Empty until loadOperations() resolves; never gates manually creating any credential type regardless of what's in here. */
  declaredCredentials: DeclaredCredential[];
  selectedNodeId: string | null;
  runResult: RunResult | null;
  isRunning: boolean;
  error: string | null;

  loadOperations: () => Promise<void>;
  /** `position` is where the box was actually dropped on the canvas, if known. */
  addNode: (operationId: string, position?: Position) => string;
  updateNodePosition: (nodeId: string, position: Position) => void;
  /**
   * Removes a node and everything that referenced it: its connections
   * (either direction), and any other node's field mapped from it (reset
   * to an empty static value — a dangling `fromNodeId` would otherwise
   * silently resolve to `undefined` at run time instead of failing loudly).
   */
  removeNode: (nodeId: string) => void;
  selectNode: (nodeId: string | null) => void;
  setCredential: (nodeId: string, credentialId: string | null) => void;
  setFieldValue: (nodeId: string, fieldPath: string, value: FieldValue) => void;
  /** Batch version of setFieldValue — sets several field paths in one `set()`, so a Raw->Form conversion (which can touch many leaves at once, see utils/bodyTemplate.ts) doesn't trigger a render per leaf. */
  mergeFieldValues: (nodeId: string, values: Record<string, FieldValue>) => void;
  /** Toggles a node's body editor between the flat form and Raw JSON — see NodeInspector.tsx for the Form<->Raw conversion this surrounds. */
  setBodyMode: (nodeId: string, mode: 'form' | 'raw') => void;
  setRawBody: (nodeId: string, rawBody: RawBody | null) => void;
  /** Establishes execution ORDER only — separate from field mapping (data source). */
  connectNodes: (fromNodeId: string, toNodeId: string) => void;
  /** Held in browser memory only — never sent anywhere except as the resolved header/query param on the actual request (see engine/credentials.ts). */
  addCredential: (credential: NewCredential) => void;
  /** Replaces a credential's fields in place, keeping its id — so every node's `credentialId` reference stays valid, unlike delete+re-add. */
  updateCredential: (credentialId: string, credential: NewCredential) => void;
  /** Removes a credential and unsets it from any node still referencing it — same dangling-reference reasoning as removeNode's cleanup of mapped fields. */
  removeCredential: (credentialId: string) => void;
  run: () => Promise<void>;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  operations: [],
  baseUrl: null,
  nodes: [],
  connections: [],
  nodePositions: {},
  credentials: [],
  declaredCredentials: [],
  selectedNodeId: null,
  runResult: null,
  isRunning: false,
  error: null,

  loadOperations: async () => {
    try {
      const spec = await fetchSpec();
      const operations = parseOperations(spec);
      const baseUrl = resolveBaseUrl(spec);
      const declaredCredentials = extractDeclaredCredentials(spec);
      set({
        operations,
        baseUrl,
        declaredCredentials,
        error: baseUrl
          ? null
          : 'Could not determine a target base URL — add a `servers` entry to the OpenAPI spec.',
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  addNode: (operationId, position) => {
    const id = randomId();
    const node: WorkflowNode = { id, operationId, credentialId: null, fieldValues: {} };
    set((state) => ({
      nodes: [...state.nodes, node],
      nodePositions: { ...state.nodePositions, [id]: position ?? defaultPosition(state.nodes.length) },
      selectedNodeId: id,
    }));
    return id;
  },

  updateNodePosition: (nodeId, position) =>
    set((state) => ({ nodePositions: { ...state.nodePositions, [nodeId]: position } })),

  removeNode: (nodeId) =>
    set((state) => {
      const nodePositions = { ...state.nodePositions };
      delete nodePositions[nodeId];

      const nodes = state.nodes
        .filter((n) => n.id !== nodeId)
        .map((n) => {
          const fieldValues = { ...n.fieldValues };
          let changed = false;
          for (const [path, fv] of Object.entries(fieldValues)) {
            if (fv.source === 'mapped' && fv.fromNodeId === nodeId) {
              fieldValues[path] = { source: 'static', value: '' };
              changed = true;
            }
          }
          return changed ? { ...n, fieldValues } : n;
        });

      return {
        nodes,
        nodePositions,
        connections: state.connections.filter((c) => c.fromNodeId !== nodeId && c.toNodeId !== nodeId),
        selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      };
    }),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  setCredential: (nodeId, credentialId) =>
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, credentialId } : n)),
    })),

  setFieldValue: (nodeId, fieldPath, value) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, fieldValues: { ...n.fieldValues, [fieldPath]: value } } : n
      ),
    })),

  mergeFieldValues: (nodeId, values) =>
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, fieldValues: { ...n.fieldValues, ...values } } : n)),
    })),

  setBodyMode: (nodeId, mode) =>
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, bodyMode: mode } : n)),
    })),

  setRawBody: (nodeId, rawBody) =>
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, rawBody } : n)),
    })),

  connectNodes: (fromNodeId, toNodeId) =>
    set((state) => {
      if (fromNodeId === toNodeId) return state; // no self-loops
      const exists = state.connections.some((c) => c.fromNodeId === fromNodeId && c.toNodeId === toNodeId);
      if (exists) return state;
      return { connections: [...state.connections, { fromNodeId, toNodeId }] };
    }),

  addCredential: (credential) => {
    const withId = { ...credential, id: randomId() } as Credential;
    set((state) => ({ credentials: [...state.credentials, withId] }));
  },

  updateCredential: (credentialId, credential) => {
    const withId = { ...credential, id: credentialId } as Credential;
    set((state) => ({
      credentials: state.credentials.map((c) => (c.id === credentialId ? withId : c)),
    }));
  },

  removeCredential: (credentialId) =>
    set((state) => ({
      credentials: state.credentials.filter((c) => c.id !== credentialId),
      nodes: state.nodes.map((n) => (n.credentialId === credentialId ? { ...n, credentialId: null } : n)),
    })),

  run: async () => {
    set({ isRunning: true, error: null });
    try {
      const { nodes, connections, operations, credentials, baseUrl } = get();
      if (!baseUrl) {
        throw new Error('Could not determine a target base URL — add a `servers` entry to the OpenAPI spec.');
      }
      const operationsById = new Map(operations.map((o) => [o.id, o]));
      const credentialsById = new Map(credentials.map((c) => [c.id, c]));
      const result = await executeChain({ nodes, connections }, operationsById, credentialsById, { baseUrl });
      set({ runResult: result });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ isRunning: false });
    }
  },
}));
