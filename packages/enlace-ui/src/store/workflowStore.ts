import { create } from 'zustand';
import { fetchSpec } from '../api/client.js';
import { parseOperations } from '../engine/specParser.js';
import { connectionKey, executeChain } from '../engine/chainExecutor.js';
import { extractDeclaredCredentials, type DeclaredCredential } from '../engine/securitySchemes.js';
import { randomId } from '../utils/randomId.js';
import type {
  Credential,
  FieldValue,
  NewCredential,
  Operation,
  RawBody,
  RunControl,
  RunResult,
  RunStepRequest,
  RunStepStatus,
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

/**
 * `executeChain` (chainExecutor.ts) reads `nodes`/`connections`/
 * `credentials`/`armedBreakpoints` exactly once, at the moment `run()`
 * calls it — everything downstream (buildRequest, the dependency graph,
 * breakpoint gating) works off that one snapshot for the rest of the run,
 * not a live view of the store. Before this guard existed, editing a
 * node's fields/credential/body, or the connection graph, while a run was
 * in progress silently had no effect on that run at all: the Inspector
 * looked editable and the edit visibly "took" in the store, but the
 * in-flight/paused node's actual request still used whatever was true when
 * the run started. That was already a real gap; the debugger's paused
 * window (which can sit open indefinitely) turns it into an easy trap —
 * exactly the "seems fine, does nothing" class of bug this blocks outright
 * rather than documents. Node positions are explicitly exempt (see
 * `updateNodePosition`) — purely visual, never part of the executed
 * `Workflow`, nothing for a run to go stale against.
 */
function isLocked(state: WorkflowState): boolean {
  return state.isRunning;
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
  /**
   * Live per-node status for the current/last run, keyed by node id — reset
   * to `'pending'` for every node at the start of `run()`, then updated as
   * `executeChain`'s `onEvent` stream reports each transition. `runResult`
   * only ever holds *settled* steps; this is what lets a consumer tell "not
   * reached yet" apart from "currently in flight" for a node with no
   * `RunStep` yet.
   */
  stepStatusByNodeId: Record<string, RunStepStatus>;
  /**
   * Connector keys (`connectionKey(fromNodeId, toNodeId)`) with a
   * breakpoint armed — canvas/session state, not part of the executed
   * `Workflow`, same tier as `nodePositions`. Read by `run()` (snapshotted
   * into `executeChain`'s `armedBreakpoints` option at the start of each
   * run) and by Canvas.tsx (to render the marker).
   */
  armedBreakpoints: Set<string>;
  /**
   * A paused node's fully-resolved, about-to-fire request, keyed by node
   * id — populated as `executeChain`'s pause-preview events arrive (see
   * `RunEvent.request`). Cleared at the start of every run, same as
   * `stepStatusByNodeId`.
   */
  previewRequestByNodeId: Record<string, RunStepRequest>;
  /**
   * The live handle into the current `executeChain` call, captured via its
   * `onControl` callback — `continueExecution`/`stepNode`/`stopExecution`
   * below just forward to whichever methods this holds. `null` whenever no
   * run is in progress; calling any of the three actions then is a no-op.
   */
  activeControl: RunControl | null;
  isRunning: boolean;
  error: string | null;

  loadOperations: () => Promise<void>;
  /**
   * `position` is where the box was actually dropped on the canvas, if
   * known. A no-op (returns `''`) while `isRunning` — see the module-level
   * `isLocked` comment for why every structural/config mutation below
   * shares this guard.
   */
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
  /** Removes one explicit connection edge. Doesn't touch fieldValues — a mapped field that happens to rely on this same ordering still implies its own "runs after" edge regardless (see computeExecutionLevels), so this can't silently break a dependency the way removeNode's cleanup has to guard against. Also disarms any breakpoint on that connection — same dangling-reference reasoning as removeNode's fieldValues cleanup. */
  disconnectNodes: (fromNodeId: string, toNodeId: string) => void;
  /** Toggles a breakpoint on one connection edge — never meaningful for a field-mapping edge, since only WorkflowConnections are ever passed here (see components/Canvas.tsx, the only caller). */
  toggleBreakpoint: (fromNodeId: string, toNodeId: string) => void;
  /** Releases every node currently paused at a breakpoint in the active run. A no-op if no run is in progress. */
  continueExecution: () => void;
  /** Releases exactly one paused node, by id, in the active run. A no-op if no run is in progress or that node isn't currently paused. */
  stepNode: (nodeId: string) => void;
  /** Stops the active run: nothing new fires, everything already in flight still completes, every still-pending/paused node becomes 'skipped'. A no-op if no run is in progress. */
  stopExecution: () => void;
  /**
   * Held in browser memory only — never sent anywhere except as the resolved
   * header/query param on the actual request (see engine/credentials.ts).
   * `id` is optional and normally omitted — a fresh id is minted here. The
   * one exception is the oauth2_* "Verify & Save" flow (CredentialForm.tsx),
   * which already ran the credential through `resolveCredentialInjection`
   * pre-save to confirm the token endpoint works, caching the resulting
   * token under a pre-minted id (see engine/credentials.ts's tokenCache) —
   * passing that same id through here means the credential's first real
   * run reuses that cached token instead of hitting the token endpoint (and
   * any 2FA/guest-token flow behind it) a second time.
   */
  addCredential: (credential: NewCredential, id?: string) => void;
  /** Replaces a credential's fields in place, keeping its id — so every node's `credentialId` reference stays valid, unlike delete+re-add. */
  updateCredential: (credentialId: string, credential: NewCredential) => void;
  /** Removes a credential and unsets it from any node still referencing it — same dangling-reference reasoning as removeNode's cleanup of mapped fields. */
  removeCredential: (credentialId: string) => void;
  /**
   * `useBreakpoints: true` (the "Debug" button) honors whatever's currently
   * in `armedBreakpoints`, snapshotting it into this run and setting
   * `activeControl` once `executeChain` hands one back. Omitted/false (the
   * plain "Run" button) never gates on anything, regardless of what's
   * armed — `activeControl` stays `null` for the whole run, which is also
   * what App.tsx checks to decide whether to show Continue/Step/Stop at
   * all: a plain run should never look like a debug session.
   */
  run: (options?: { useBreakpoints?: boolean }) => Promise<void>;
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
  stepStatusByNodeId: {},
  armedBreakpoints: new Set(),
  previewRequestByNodeId: {},
  activeControl: null,
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
    if (isLocked(get())) return '';
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
      if (isLocked(state)) return state;
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
    set((state) => {
      if (isLocked(state)) return state;
      return { nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, credentialId } : n)) };
    }),

  setFieldValue: (nodeId, fieldPath, value) =>
    set((state) => {
      if (isLocked(state)) return state;
      return {
        nodes: state.nodes.map((n) =>
          n.id === nodeId ? { ...n, fieldValues: { ...n.fieldValues, [fieldPath]: value } } : n
        ),
      };
    }),

  mergeFieldValues: (nodeId, values) =>
    set((state) => {
      if (isLocked(state)) return state;
      return {
        nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, fieldValues: { ...n.fieldValues, ...values } } : n)),
      };
    }),

  setBodyMode: (nodeId, mode) =>
    set((state) => {
      if (isLocked(state)) return state;
      return { nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, bodyMode: mode } : n)) };
    }),

  setRawBody: (nodeId, rawBody) =>
    set((state) => {
      if (isLocked(state)) return state;
      return { nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, rawBody } : n)) };
    }),

  connectNodes: (fromNodeId, toNodeId) =>
    set((state) => {
      if (isLocked(state)) return state;
      if (fromNodeId === toNodeId) return state; // no self-loops
      const exists = state.connections.some((c) => c.fromNodeId === fromNodeId && c.toNodeId === toNodeId);
      if (exists) return state;
      return { connections: [...state.connections, { fromNodeId, toNodeId }] };
    }),

  disconnectNodes: (fromNodeId, toNodeId) =>
    set((state) => {
      if (isLocked(state)) return state;
      const armedBreakpoints = new Set(state.armedBreakpoints);
      armedBreakpoints.delete(connectionKey(fromNodeId, toNodeId));
      return {
        connections: state.connections.filter((c) => !(c.fromNodeId === fromNodeId && c.toNodeId === toNodeId)),
        armedBreakpoints,
      };
    }),

  toggleBreakpoint: (fromNodeId, toNodeId) =>
    set((state) => {
      if (isLocked(state)) return state;
      const key = connectionKey(fromNodeId, toNodeId);
      const armedBreakpoints = new Set(state.armedBreakpoints);
      if (armedBreakpoints.has(key)) armedBreakpoints.delete(key);
      else armedBreakpoints.add(key);
      return { armedBreakpoints };
    }),

  continueExecution: () => get().activeControl?.continue(),
  stepNode: (nodeId) => get().activeControl?.step(nodeId),
  stopExecution: () => get().activeControl?.stop(),

  addCredential: (credential, id) => {
    const withId = { ...credential, id: id ?? randomId() } as Credential;
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

  run: async (options) => {
    const useBreakpoints = options?.useBreakpoints ?? false;
    const { nodes, armedBreakpoints } = get();
    set({
      isRunning: true,
      error: null,
      runResult: { steps: [] },
      stepStatusByNodeId: nodes.reduce<Record<string, RunStepStatus>>((acc, n) => {
        acc[n.id] = 'pending';
        return acc;
      }, {}),
      // Cleared here, not in the `finally` below — a paused/skipped node's
      // preview, and the statuses above, are meant to survive right up
      // until the *next* run starts (real review value on their own), not
      // just until this run happens to finish. Only activeControl resets
      // on completion (below): it's a live handle into a call that's now
      // over, not session state worth keeping around.
      previewRequestByNodeId: {},
      // activeControl deliberately NOT cleared here — it's re-set once
      // executeChain's onControl fires, a moment after this.
    });
    try {
      const { connections, operations, credentials, baseUrl } = get();
      if (!baseUrl) {
        throw new Error('Could not determine a target base URL — add a `servers` entry to the OpenAPI spec.');
      }
      const operationsById = new Map(operations.map((o) => [o.id, o]));
      const credentialsById = new Map(credentials.map((c) => [c.id, c]));
      const result = await executeChain({ nodes, connections }, operationsById, credentialsById, {
        baseUrl,
        // Streams progress into the store as each node settles, instead of
        // only setting `runResult` once at the very end — see
        // components/DebugPane.tsx, which renders `runResult.steps` live.
        onEvent: (event) => {
          set((state) => ({
            stepStatusByNodeId: { ...state.stepStatusByNodeId, [event.nodeId]: event.status },
            runResult: event.step
              ? { steps: [...(state.runResult?.steps ?? []), event.step] }
              : state.runResult,
            previewRequestByNodeId: event.request
              ? { ...state.previewRequestByNodeId, [event.nodeId]: event.request }
              : state.previewRequestByNodeId,
          }));
        },
        // Only wired up for a "Debug" run — a plain "Run" never gates on
        // anything (regardless of what's armed) and never sets
        // activeControl, which is exactly what App.tsx checks to decide
        // whether to show Continue/Step/Stop at all: a plain run should
        // never look like a debug session just because some breakpoint
        // happens to be armed from an earlier debug session.
        ...(useBreakpoints
          ? {
              // Snapshotted at the start of this run — arming/disarming a
              // breakpoint mid-run has no effect on a run already in
              // progress (see ChainExecutorOptions.armedBreakpoints's own
              // doc comment).
              armedBreakpoints: new Set(armedBreakpoints),
              onControl: (control) => set({ activeControl: control }),
            }
          : {}),
      });
      set({ runResult: result });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ isRunning: false, activeControl: null });
    }
  },
}));
