import type { DeclaredCredential } from '@get-enlace/core';
import type {
  AssertCheck,
  Credential,
  EnlaceCollection,
  FieldValue,
  NewPreset,
  NewCredential,
  NodeGroup,
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

/** What an import left for the user to fix in the credentials drawer. */
export interface CredentialReview {
  /** Imported credentials whose secret came through empty. */
  needsValueIds: string[];
  /** A "stripped" collection still carried secret keys, which were dropped on read. */
  secretsDiscarded: boolean;
}

/** Grid fallback for a node with no explicit position — matches the old default layout. */
export function defaultPosition(index: number): Position {
  return { x: 80 + (index % 4) * 220, y: 80 + Math.floor(index / 4) * 140 };
}

/**
 * Reads the target base URL from the spec itself — `servers[0].url` —
 * exactly the convention swagger-ui-express's own "Try it out" already
 * relies on. There's no adapter-side `targetBaseUrl` option anymore: the
 * browser is what makes the request now, so it's the browser that needs
 * this, not the adapter.
 */
export function resolveBaseUrl(spec: Record<string, any>): string | null {
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
export function isLocked(state: Pick<WorkflowState, 'isRunning'>): boolean {
  return state.isRunning;
}

/** Key for the in-memory `uploadedFiles` map — never serialized. */
export function uploadedFileKey(nodeId: string, fieldPath: string): string {
  return `${nodeId}::${fieldPath}`;
}

export interface WorkflowState {
  operations: Operation[];
  /** Derived from the loaded spec's `servers[0].url` — null until loadOperations() resolves. */
  baseUrl: string | null;
  /** `info.title` / `info.version` from the loaded spec — used only as a hint on exported workflow files. */
  specInfo: { title?: string; version?: string } | null;
  /**
   * Display name for the current canvas workflow — independent of the loaded
   * OpenAPI `info.title`. Starts as `Untitled`; import/export set it from the
   * collection / chosen export name.
   */
  workflowName: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  /** Canvas layout only — not part of the executed Workflow. */
  nodePositions: Record<string, Position>;
  /**
   * Named, collapsible node groups — canvas state beside `nodePositions`,
   * never part of the executed `Workflow`. Round-tripped in `.enlace`
   * exports (see utils/workflowDocument.ts). See types.ts's `NodeGroup`.
   */
  groups: NodeGroup[];
  /**
   * Collapsed/expanded chrome for `kind: 'presets'` nodes, keyed by node id —
   * same tier as `nodePositions`/`groups`: canvas-only, never part of the
   * executed `Workflow`, round-tripped in `.enlace` exports. Absent entry
   * means expanded.
   */
  presetsCollapsed: Record<string, boolean>;
  credentials: Credential[];
  /**
   * In-memory File blobs for `FieldValue` entries with `source: 'file'`.
   * Keyed by `uploadedFileKey(nodeId, fieldPath)`. Never part of an
   * EnlaceCollection — reload/import keeps the fileName marker but the
   * user must re-pick the file (same tradeoff as stripped credentials).
   */
  uploadedFiles: Record<string, File>;
  /** Pre-fill templates read from the loaded spec's own `components.securitySchemes` — see engine/securitySchemes.ts. Empty until loadOperations() resolves; never gates manually creating any credential type regardless of what's in here. */
  declaredCredentials: DeclaredCredential[];
  selectedNodeId: string | null;
  /**
   * Which preset inside `selectedNodeId`'s `presets` (when it's a `kind:
   * 'presets'` node) has its configuration open in NodeConfig — a preset
   * has no config UI on its own canvas card (just a summary row), so this
   * is the only way to know which one's editor to render. Meaningless
   * whenever `selectedNodeId` isn't a presets node; `selectNode` always
   * resets it to `null`, so selecting a different (or no) node never
   * leaves a stale preset's editor showing.
   */
  selectedPresetId: string | null;
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
  /**
   * True while a "Debug" run (breakpoints honored) is in progress. Distinguishes
   * the transport chrome (Continue/Step/Stop) from a plain run's spinner+Stop —
   * both keep `activeControl` so Stop works either way.
   */
  isDebugRun: boolean;
  /**
   * Bottom-pane debug REPL (Results | Console split). Open only while a
   * Debug session is active (`isDebugRun`); closes when the session ends
   * so Results takes the full pane again.
   */
  debugConsoleOpen: boolean;
  error: string | null;
  /**
   * Set by an import that left credentials unusable — non-null pops the
   * credentials drawer open so the affected cards (each marked "Needs a
   * value") are right where the fix happens, instead of listing their names
   * in the header where there's no room and nothing to act on.
   */
  credentialReview: CredentialReview | null;

  loadOperations: () => Promise<void>;
  /**
   * `position` is where the box was actually dropped on the canvas, if
   * known. A no-op (returns `''`) while `isRunning` — see the module-level
   * `isLocked` comment for why every structural/config mutation below
   * shares this guard.
   */
  addNode: (operationId: string, position?: Position) => string;
  /**
   * The only way a preset reaches the canvas — always creates a
   * `kind: 'presets'` collection node (see `WorkflowNodeKind`/`Preset` in
   * `@get-enlace/core`'s types.ts), seeded with `initialPreset` when given.
   * The palette always passes one (e.g. dragging Wait passes
   * `{ kind: 'wait', durationMs: DEFAULT_WAIT_DURATION_MS }`); nothing ever
   * drops an empty collection. Even a single preset renders with the
   * collection's collapsed-diamond/expanded-box chrome, never as a
   * standalone graph node. Same `isLocked`/placement behavior as `addNode`.
   */
  addPresetsNode: (position?: Position, initialPreset?: NewPreset) => string;
  /** Appends one preset to a collection's ordered `presets` list. No-op if `presetsNodeId` isn't a presets node. */
  addPreset: (presetsNodeId: string, preset: NewPreset) => void;
  /** Removes one preset from a collection by its preset id. */
  removePreset: (presetsNodeId: string, presetId: string) => void;
  /** Swaps a preset with its immediate up/down neighbor — "linear order only" (see the issue this implements), no arbitrary reordering. A no-op at either end of the list. */
  movePreset: (presetsNodeId: string, presetId: string, direction: 'up' | 'down') => void;
  /** Sets one Wait preset's `durationMs`. */
  setPresetDurationMs: (presetsNodeId: string, presetId: string, durationMs: number) => void;
  /** Appends one blank check to an assert preset's `checks` list. No-op if `presetsNodeId`/`presetId` don't resolve to an assert preset. */
  addAssertCheck: (presetsNodeId: string, presetId: string) => void;
  /** Removes one check from an assert preset by its check id. */
  removeAssertCheck: (presetsNodeId: string, presetId: string, checkId: string) => void;
  /** Shallow-merges `patch` into one assert check — same "patch one field at a time" shape as `setFieldValue`. */
  updateAssertCheck: (
    presetsNodeId: string,
    presetId: string,
    checkId: string,
    patch: Partial<Omit<AssertCheck, 'id'>>
  ) => void;
  /** Toggles a collection's collapsed (diamond) / expanded (preset-list box) chrome — view-only, see `presetsCollapsed`. */
  setPresetsCollapsed: (presetsNodeId: string, collapsed: boolean) => void;
  /**
   * Moves a node on the canvas. Purely visual — exempt from `isLocked`.
   * Pass `avoidOverlap: true` when the gesture has settled (drop / drag-end)
   * so the card nudges clear of neighbors; leave it off while dragging so the
   * card tracks the pointer without fighting collision snaps mid-gesture.
   * Fellow members of the same canvas group are never obstacles — groups may
   * keep the tight/overlapping layout drop-to-group creates.
   */
  updateNodePosition: (nodeId: string, position: Position, options?: { avoidOverlap?: boolean }) => void;
  /**
   * Removes a node and everything that referenced it: its connections
   * (either direction), and any other node's field mapped from it (reset
   * to an empty static value — a dangling `fromNodeId` would otherwise
   * silently resolve to `undefined` at run time instead of failing loudly).
   */
  removeNode: (nodeId: string) => void;
  /** Also clears `selectedPresetId` — a preset selection never survives switching (or clearing) the selected node. */
  selectNode: (nodeId: string | null) => void;
  /** Opens one preset's config in NodeConfig — sets `selectedNodeId` to the owning collection and `selectedPresetId` to the preset, in one step (so clicking a preset row selects the collection too, even if it wasn't already). */
  selectPreset: (presetsNodeId: string, presetId: string) => void;
  setCredential: (nodeId: string, credentialId: string | null) => void;
  setFieldValue: (nodeId: string, fieldPath: string, value: FieldValue) => void;
  /** Batch version of setFieldValue — sets several field paths in one `set()`, so a Raw->Form conversion (which can touch many leaves at once, see utils/bodyTemplate.ts) doesn't trigger a render per leaf. */
  mergeFieldValues: (nodeId: string, values: Record<string, FieldValue>) => void;
  /**
   * Sets (or, passing `null`, clears) one override in a node's
   * `credentialExtraParamOverrides` — see that field's own comment on
   * `WorkflowNode` in `@get-enlace/core`'s types.ts. Only meaningful when
   * the node's attached credential is `oauth2_clientCredentials` /
   * `oauth2_password` and declares an `extraTokenParams` key by this name;
   * otherwise it's inert (still stored, never read at request time).
   */
  setCredentialExtraParamOverride: (nodeId: string, key: string, value: FieldValue | null) => void;
  /**
   * Master switch for `credentialExtraParamOverrides` — see that flag's own
   * comment on `WorkflowNode` in `@get-enlace/core`'s types.ts. Toggling off
   * leaves the map's contents untouched; it just stops being consulted at
   * request-build time (and stops implying a "runs after" dependency edge).
   */
  setCredentialExtraParamOverridesEnabled: (nodeId: string, enabled: boolean) => void;
  /**
   * Sets or clears a file field: updates `fieldValues` with a `file` marker
   * (or removes it) and keeps the real `File` only in `uploadedFiles`.
   */
  setUploadedFile: (nodeId: string, fieldPath: string, file: File | null) => void;
  /** Toggles a node's request editor between the flat form and Raw JSON — see NodeConfig.tsx for the Form<->Raw conversion this surrounds. */
  setRequestMode: (nodeId: string, mode: 'form' | 'raw') => void;
  setRawPath: (nodeId: string, rawPath: RawBody | null) => void;
  setRawQuery: (nodeId: string, rawQuery: RawBody | null) => void;
  setRawBody: (nodeId: string, rawBody: RawBody | null) => void;
  /** Establishes execution ORDER only — separate from field mapping (data source). */
  connectNodes: (fromNodeId: string, toNodeId: string) => void;
  /** Removes one explicit connection edge. Doesn't touch fieldValues — a mapped field that happens to rely on this same ordering still implies its own "runs after" edge regardless (see computeExecutionLevels), so this can't silently break a dependency the way removeNode's cleanup has to guard against. Also disarms any breakpoint on that connection — same dangling-reference reasoning as removeNode's fieldValues cleanup. */
  disconnectNodes: (fromNodeId: string, toNodeId: string) => void;
  /**
   * Creates a canvas group from two nodes (drop-overlap create). Places the
   * dragged node at `draggedPosition` (no anti-overlap snap). No-op while locked.
   */
  createGroup: (opts: {
    name: string;
    nodeIds: [string, string];
    draggedNodeId: string;
    draggedPosition: Position;
    skipConfirmOnDrop?: boolean;
  }) => string;
  /** Adds a node to an existing group. No-op while locked / if already a member. */
  joinGroup: (groupId: string, nodeId: string, position: Position, opts?: { skipConfirmOnDrop?: boolean }) => void;
  /** Dissolves a group; member nodes stay on the canvas. */
  ungroup: (groupId: string) => void;
  /** Removes one member; dissolves the group if fewer than 2 members remain. */
  removeFromGroup: (groupId: string, nodeId: string) => void;
  setGroupCollapsed: (groupId: string, collapsed: boolean) => void;
  setGroupName: (groupId: string, name: string) => void;
  /**
   * Moves group chrome and every member by the same delta. Visual only —
   * exempt from `isLocked`, like `updateNodePosition`.
   */
  moveGroup: (groupId: string, position: Position) => void;
  /** Toggles a breakpoint on one connection edge — never meaningful for a field-mapping edge, since only WorkflowConnections are ever passed here (see components/Canvas.tsx, the only caller). */
  toggleBreakpoint: (fromNodeId: string, toNodeId: string) => void;
  /** Releases every node currently paused at a breakpoint in the active run. A no-op if no run is in progress. */
  continueExecution: () => void;
  /** Releases exactly one paused node, by id, in the active run. A no-op if no run is in progress or that node isn't currently paused. */
  stepNode: (nodeId: string) => void;
  /** Stops the active run: nothing new fires, everything already in flight still completes, every still-pending/paused node becomes 'skipped'. A no-op if no run is in progress. */
  stopExecution: () => void;
  /**
   * Clears Results pane chrome (statuses, pause previews, errors) so the
   * list goes empty. Keeps `runResult` so tag-mapping preview in the
   * inspector can still resolve against the last responses. A no-op while
   * `isRunning`.
   */
  clearResults: () => void;
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
   * Replaces the canvas (nodes, connections, positions) and credentials
   * with the single workflow in a parsed `EnlaceCollection`. Leaves `operations` / `baseUrl` /
   * `declaredCredentials` / `specInfo` alone — those come from this tab's
   * spec. Clears `runResult`, debug session state, and selection because
   * they belong to the discarded graph. A no-op while `isRunning`.
   */
  replaceWorkflow: (collection: EnlaceCollection) => void;
  /** Renames the current workflow (chrome switcher / export default). Empty → Untitled. */
  setWorkflowName: (name: string) => void;
  /** `null` dismisses the drawer's review banner — called when the drawer closes. */
  setCredentialReview: (review: CredentialReview | null) => void;
  /**
   * `useBreakpoints: true` (the "Debug" button) honors whatever's currently
   * in `armedBreakpoints`, snapshotting it into this run and setting
   * `isDebugRun` so the chrome shows Continue/Step/Stop. Omitted/false
   * (plain "Run") never gates on breakpoints — chrome shows a spinner +
   * Stop instead. Both modes receive `activeControl` so Stop can halt
   * admission of new nodes while in-flight requests still finish.
   */
  run: (options?: { useBreakpoints?: boolean }) => Promise<void>;
}
