# Enlace — Architecture Document

## 1. Design Principles

1. **Depend on OpenAPI, not on Swagger UI.** The only input contract is "a URL, file, or object that resolves to a valid OpenAPI 3.x document." No dependency on Swagger UI, Swashbuckle, Springdoc, or any specific spec-generation toolchain.
2. **One UI, executed where Swagger UI already executes: the browser.** Chain execution (HTTP calls, field resolution, ordering) runs entirely client-side — the same trust model Swagger UI's own "Try it out" already uses, extended from one call to a chain of them.
3. **Adapters are thin, symmetric across languages.** Each adapter serves the UI's static bundle and resolves/serves the OpenAPI document. Nothing else varies by language.
4. **No server-side engine.** Execution is UI work (client-side, in the browser); persistence, once built, is adapter work (per-language CRUD). There's no stateful, complex logic that needs porting or sidecar-hosting across languages.
5. **Trust model matches Swagger UI's own.** No per-user auth inside the tool; whoever can reach the URL has the same access Swagger UI's "Authorize" button already implicitly grants.

## 2. High-Level Component Diagram

```
                     ┌───────────────────────────────────┐
                     │   Browser (all execution here)    │
                     │                                   │
                     │  @get-enlace/ui (React canvas):   │
                     │   - Canvas (nodes, connections)   │
                     │   - Node inspector (fields, creds)│
                     │   - Debug pane                    │
                     │   uses @get-enlace/core:          │
                     │       resolve order, resolve      │
                     │       field values, fetch() calls │
                     └───────────────┬───────────────────┘
                                     │
             ┌───────────────────────┼──────────────────────────┐
             │ HTTP (spec)                                      │ HTTP (direct calls,
             │                                                  │ browser → target API)
             ▼                                                  ▼
   ┌────────────────────────────────┐                      ┌───────────────────────┐
   │  Adapter (Express today,       │                      │  User's own target API│
   │  more planned)                 │                      │  (any language)       │
   │                                │                      └───────────────────────┘
   │  - Serves UI static bundle     |
   │  - Serves/proxies OpenAPI doc  |
   └────────────────────────────────┘
```

Two distinct HTTP relationships exist, and they don't cross: the browser talks to its own adapter for UI assets and the spec; separately, the browser talks directly to the target API to execute chain steps. The adapter never proxies execution calls.

The **target API** being tested can be written in any language — the browser only ever talks to it over plain HTTP, per the OpenAPI spec. Language dependence only exists on the *hosting* side (what serves the canvas UI and spec), not the target API side.

## 3. Repo/Package Layout

| Package | Language | Repo | Responsibility |
|---|---|---|---|
| `core` (`@get-enlace/core`) | JS (Node ≥18, no React/DOM) | `get-enlace/enlace-ui` (this repo) | Spec parsing, dependency graph, credential injection, `executeChain`. Private workspace package (not published); bundled into the UI today, later a headless CLI. |
| `ui` (`@get-enlace/ui`) | JS (framework-agnostic bundle) | `get-enlace/enlace-ui` (this repo) | Canvas, inspector, debug pane. Depends on `@get-enlace/core` at build time. Built once, shipped as static assets consumed by every adapter. |
| `enlace-express` (`@get-enlace/express`) | Node/TS | [`get-enlace/enlace-js`](https://github.com/get-enlace/enlace-js) | Serves the UI bundle, resolves the OpenAPI document. |

Both packages live in this repo (`packages/core`, `packages/ui`), alongside a
sample API and dev harness (`examples/sample-api`) for trying Enlace
without wiring up anything of your own — that harness mounts the canvas
via a small local copy of `@get-enlace/express`'s mount function
(`examples/sample-api/enlace.ts`), not a dependency on the adapter repo,
so this repo's own dev/test loop stays self-contained.

Node/JS adapters (`@get-enlace/express` today, `@get-enlace/nest` /
`@get-enlace/fastify` planned) live together in `get-enlace/enlace-js`, a
separate repo with its own CI and its own dev-publish workflow, each
installing `@get-enlace/ui` from GitHub Packages rather than as a
workspace sibling. Non-Node adapters (`.NET`, Java) will each get their
own repo per the language's own ecosystem conventions.

None of these need to talk to each other, to a shared engine process, or to any particular runtime beyond their own — each adapter is a self-contained, idiomatic package in its own ecosystem, exactly matching how Springdoc and Swashbuckle each independently serve the same Swagger UI bundle without any cross-language coordination.

Additional adapters and packaging changes are tracked in the workspace-level `ROADMAP.md` (one level up — see this workspace's own `CLAUDE.md`), not a file in this repo.

## 4. Data Model

Core types (owned by `@get-enlace/core`, re-exported by the UI), used identically regardless of adapter:

```
Operation (derived from the spec, not stored — read fresh each load) {
  id: string              // e.g. "POST /orders"
  method: string
  path: string
  parameters: OperationParameter[]
  requestBodySchema: object | null
  responseSchema: object | null
}

// A real discriminated union on `kind` (OperationNode | PresetsNode, same
// pattern as `Preset`/`Credential` below) — `id`/`credentialId`/`fieldValues`
// stay on a shared base both variants extend, since almost every existing
// "any WorkflowNode" consumer only ever needs those three; only code that
// actually cares which kind it has narrows further. `credentialId`/
// `fieldValues` go unused on a PresetsNode (it never fires its own request),
// kept there anyway so reading a node's `id` never requires a kind check.
WorkflowNode = OperationNode | PresetsNode

OperationNode {
  id: string               // unique per canvas instance
  kind: "operation"
  operationId: string       // references an Operation.id
  credentialId: string | null
  fieldValues: {
    [ "<section>.<key>" ]: {    // section: path | query | body | header
      source: "static" | "mapped"
      value?: any
      fromNodeId?: string         // if mapped — must be reachable via `connections`
      fromResponseFieldPath?: string
    }
  }
  requestMode: "form" | "raw"
  rawPath?, rawQuery?, rawBody?: RawBody | null   // "raw" mode only
  credentialExtraParamOverrides?: { [paramName]: FieldValue }
  credentialExtraParamOverridesEnabled?: boolean
}

PresetsNode {
  id: string
  kind: "presets"
  credentialId: string | null    // unused — never fires its own request
  fieldValues: {}                 // unused, same reason
  presets: Preset[]        // ordered presets run as one unit — empty, not absent, means none
}

// One preset inside a "presets" node's `presets` — presets only, never
// "operation"; never itself a WorkflowNode (no credentialId/fieldValues/
// graph position, never participates in the main dependency graph
// individually — only the collection as a whole does; see dependencyGraph.ts's
// own `checks` loop for how an assert preset's ancestor dependency still
// attaches to the collection). A real discriminated union — each variant
// carries only the fields its own kind needs (same pattern `Credential`
// above uses) — run by its own registry, `engine/nodeHandlers.ts`'s
// `presetHandlers` (one entry per `PresetKind`, keyed separately from
// `nodeHandlers`'s one entry per `WorkflowNodeKind` — a preset's `kind`
// never appears in that other union at all).
Preset =
  | { id, kind: "wait", durationMs: number }
  | { id, kind: "assert", checks: AssertCheck[] }   // every check must pass or the preset (and collection) fails

// One comparison an "assert" preset runs. `source` is the same "reference
// into a prior step's result" shape a Raw JSON tag chip uses (BodyTag),
// minus the `id` a dictionary key would need there.
AssertCheck {
  id: string
  source: { type: "response_body" | "response_raw" | "response_header" | "response_status", sourceNodeId: string, jsonPath?: string, headerName?: string }
  operator: "equals" | "notEquals" | "contains" | "exists" | "notExists" | "greaterThan" | "lessThan"
  expected?: string          // plain user-typed text; irrelevant for exists/notExists
}

WorkflowConnection {
  fromNodeId: string
  toNodeId: string
}

// Canvas layout chrome — not part of executed Workflow; round-tripped in .enlace.
NodeGroup {
  id, name, nodeIds: string[]
  collapsed: boolean
  position: { x, y }
  skipConfirmOnDrop: boolean
}

Workflow {
  nodes: WorkflowNode[]
  connections: WorkflowConnection[]
}

// Versioned JSON stored in a `.enlace` file. V1 exports one workflow but
// uses an array so collections can hold multiple workflows later. Credentials
// are collection-level so workflow node references keep resolving. Future
// environments belong beside workflows/credentials, not inside Workflow.
EnlaceCollection {
  format: "enlace-collection"
  version: 1
  name: string
  exportedAt: string
  secrets: "stripped" | "included"
  credentials: CredentialStub[] | Credential[]
  workflows: [{
    id, name
    specHint: { title?, version?, operationIds }
    nodes, connections, nodePositions, groups
  }]
}

// A discriminated union on `type` — each variant carries only the fields
// that type needs. Held in browser memory unless the user explicitly chooses
// a warned, full-credential `.enlace` export; stripped export remains default.
// `fromSecurityScheme?` on every variant records the spec's own
// `components.securitySchemes` key when the credential was configured
// from what the spec declares (see engine/securitySchemes.ts) — purely
// informational, shown as a tag on the credential's card.
Credential =
  | { id, name, fromSecurityScheme?, type: "bearer", token }
  | { id, name, fromSecurityScheme?, type: "basic", username, password }
  | { id, name, fromSecurityScheme?, type: "apiKey", paramName, in: "header" | "query", key }
  | { id, name, fromSecurityScheme?, type: "oauth2_clientCredentials", tokenUrl, clientId, clientSecret, scope?, extraTokenParams?, clientAuthMethod }
  | { id, name, fromSecurityScheme?, type: "oauth2_password", tokenUrl, username, password, clientId?, clientSecret?, scope?, extraTokenParams?, clientAuthMethod }
  | { id, name, fromSecurityScheme?, type: "cookie", loginUrl? }
  // more variants planned (full OAuth2 authorizationCode-grant support) — see the workspace-level ROADMAP.md

RunResult {
  steps: [
    {
      nodeId: string
      request: { method, url, headers, body }
      response?: { status, headers, body }
      timestampStart: string
      timestampEnd: string
      error?: string
      subSteps?: RunStep[]   // "presets" nodes only — one settled RunStep per internal preset, in order
    }
  ]
}
```

**Connection and mapping are two separate concerns.** A `WorkflowConnection` establishes execution *order* only — it carries no data. A mapped `FieldValue` establishes a field's *data source* — it always implies its source must run first too, whether or not the user also drew an explicit connection, but the reverse isn't true: a node can be connected after another purely for sequencing, with no data flowing between them.

A field may be mapped from **any ancestor** in the connection graph, not just the node directly before it — e.g. `A -> B -> C` where `B` carries no data at all, `C` can still map a field from `A` directly, skipping `B`.

**Preset nodes.** Not every canvas node fires an HTTP call — `WorkflowNode`'s own `kind` discriminant (`OperationNode | PresetsNode`) says what a node actually does when it runs, dispatched by a small handler registry (`packages/core/src/engine/handlers/index.ts`'s `nodeHandlers`) that `executeChain` calls through without knowing any kind's specifics: `checkReady` (can this node run at all — e.g. an `OperationNode`'s `operationId` must resolve against the loaded spec), `execute` (run it for real, return a settled `RunStep`), `preview` (resolve its about-to-fire request for a breakpoint pause, or `null` if the kind has none). Each concrete handler narrows the `WorkflowNode` it's handed back down to its own variant via a small "narrow-or-throw" helper (`asOperationNode`/`asPresetsNode`, in `engine/handlers/guards.ts`) rather than the registry's shared `NodeHandler` interface itself being widened per-kind. `kind` is required on both variants (`"operation"`/`"presets"`) — every node the store creates and every import writes it explicitly, no default-when-absent case. `"presets"` is the only other `WorkflowNodeKind` — a `Preset`'s own `kind` (`"wait"`/`"assert"`, see `Preset`'s own union just above) is a separate, smaller `PresetKind` union dispatched by a parallel registry, `presetHandlers` (one entry per `PresetKind`, same `checkReady`/`execute` shape minus `preview` — no preset ever fires ahead of time for a breakpoint the way an operation's request does), called by `presetsNodeHandler`'s own loop, never by `executeChain` directly. **Wait** is the simplest `PresetKind`: a pure pacing step (`durationMs`, no credential, no request) that sleeps once its turn in the collection's loop comes up, then settles with a synthetic `RunStep` (`request.method: "WAIT"`, no `response`) attached under its collection's `subSteps`, just with no response body a later node could map a field from. A run's Stop aborts an in-progress Wait's sleep immediately rather than letting it run out its full duration pointlessly — the one preset kind where "everything already in flight still runs to completion" (see §5) has something worth cutting short. Breakpoints only ever arm on a connection into/out of the collection as a whole — a preset is never its own breakpoint target, only its parent collection is. A canvas-layout `NodeGroup` (below) is a different concept from a preset — groups are drop-overlap layout chrome, never a `kind` of their own.

**The presets collection is the only way a preset reaches the canvas.** The palette (`OperationList.tsx`) never offers a "collection" item to drag — only real presets (Wait, Assert) — but dropping any one of them always creates (or, on a drop-onto-an-existing-collection, appends to) a `kind: "presets"` node holding an ordered `Preset[]`, never a standalone graph node of its own. Even a single dropped preset renders with the collection's own chrome (below), never `WorkflowNodeCard`'s. `Preset` is a discriminated union (`WaitPreset | AssertPreset`, each carrying only its own kind's fields — `WorkflowNode` itself is the separate `OperationNode | PresetsNode` union described just above; a preset's `kind` is a smaller `PresetKind` union that never appears there) run by its own registry, `engine/nodeHandlers.ts`'s `presetHandlers` (one entry per `PresetKind`, parallel to `nodeHandlers`'s one entry per `WorkflowNodeKind`) — `presetsNodeHandler` dispatches each preset to `presetHandlers[preset.kind]` directly, no synthetic top-level node ever built. Presets run strictly in order, never concurrently, stopping at the first failure or the instant a Stop's abort signal fires (same "no partial recovery" rule `executeChain` itself follows). A collection is one node in the dependency graph and one row in Results: it settles as a single aggregate `RunStep` (`request.method: "PRESETS"`, no `response`) with every preset's own settled `RunStep` attached under `subSteps`, in order — "one executable unit with per-preset Results detail," not one graph node per preset. `Preset`s never participate in `WorkflowConnection`/the dependency graph individually, are reordered by swapping with an adjacent neighbor only (never an arbitrary jump), and are reordered/removed/selected on the collection's own expanded canvas card (`PresetsNodeCard.tsx`) — collapsed, it renders as a small diamond with a chevron, preset count, and short summary (e.g. `Wait 2s · Wait 500ms`); expanded, a box listing each preset in order (uniform icon + `formatPresetLabel` summary row regardless of kind) with plain "vertical order line" chrome, not real connectors/Handles between rows. A preset's actual *configuration* — Wait's duration, Assert's checks — is edited in the `NodeConfig` inspector instead, not inline on the card; see §6's own paragraph on this split. Outside the collection it's a normal graph node — real target/source `Handle`s, connections, and breakpoints all work exactly as they do for any other node.

**Assert**, the second preset kind, runs an ordered list of `checks` (`AssertCheck`) against an already-captured response — each check's `source` is the same "reference into a prior step's result" shape a Raw JSON tag chip uses (`BodyTag`: body field/raw body/header, plus a fourth `response_status` kind added alongside Assert), resolved via `bodyTags.ts`'s `resolveTagValue` and compared via `engine/assertCompare.ts`'s `evaluateCheck` (`equals`/`notEquals`/`contains`/`exists`/`notExists`/`greaterThan`/`lessThan`, numeric-aware where it matters). Checks run in order and stop at the first failure — same "no partial recovery" rule every other preset/step loop in this codebase follows. A failing check fails the assert preset, which fails the collection's own aggregate `RunStep` exactly the way a failed sub-step already does for Wait, which in turn skips every downstream node — the same propagation an HTTP failure already has, no special-casing added for Assert. Since a check's `source.sourceNodeId` lives inside the preset rather than the collection's own `fieldValues`, `dependencyGraph.ts`'s `buildDependencyGraph` has a third loop (alongside `fieldValues` and `credentialExtraParamOverrides`) that walks every preset's `checks` and attaches the dependency to the *collection's* id — a preset still never participates in the graph individually, only its parent collection does.

## 5. Request Flow

1. User hits **Run** in the browser.
2. The dependency graph is the union of explicit `connections` and mapping-implied dependencies (a node mapping a field from another node's response must run after it, connection or not) — `computeExecutionLevels` (Kahn's algorithm) still runs once up front purely as a `CyclicWorkflowError` check before anything fires.
3. Execution itself is **per-node, readiness-driven**, not batched by level: each node fires the instant every node it depends on has *completed*, independent of whatever else is or isn't still in flight elsewhere in the graph. Independent nodes with no pending dependencies still become ready and fire together in the same pass — exactly what a level would produce whenever nothing is gating anything — but a node is never held back waiting on an unrelated sibling that merely happens to share an ancestor (e.g. `A -> B` and `A -> C` in the same wave: a slow `B` never delays `C`, or anything depending only on `C`). This generalization is what lets a breakpoint on one connection gate exactly the node(s) downstream of it without incorrectly gating unrelated concurrent branches (see below) — see `packages/core/src/engine/chainExecutor.ts`'s `executeChain`.
4. A node whose dependencies are all satisfied but sits behind a **breakpoint** — armed on a `WorkflowConnection` via the red marker on its connector (Canvas.tsx's `BreakpointConnectionEdge`; never on a mapping edge) — pauses instead of firing, and its fully-resolved request (the same resolution a real fire would do) is built and reported as a preview without being sent. A paused run stays "in progress": `executeChain`'s returned promise doesn't settle until every paused/in-flight node does. Three controls drive it from there (`RunControl`, captured by `store/workflowStore.ts`'s `run()` as `activeControl`, exposed as one global set of buttons in `App.tsx`'s header — not per node/row — since Continue/Stop act on the whole run regardless and Step just needs one target, resolved from the selected node if it's paused or else the first paused node): **Continue** releases every node paused right now (a later breakpoint further down the graph still pauses); **Step** releases one specific paused node; **Stop** admits nothing further and settles every still-pending/paused node to `'skipped'`, though anything already in flight still runs to completion.
5. For each node's request, once it's ready to fire (i.e. not paused):
   - Resolve `fieldValues` — static values used directly; mapped values pulled from the actual captured response of the referenced upstream node.
   - Attach credential, if any — resolved per its type (`engine/credentials.ts`) into a header (bearer/basic/apiKey-in-header/either oauth2 grant), a query param (apiKey-in-query), or — uniquely for `cookie` — a `credentials: 'include'` fetch option instead of any injected value at all, since `Cookie` is a forbidden fetch() request header and can only ever be attached by the browser's own cookie jar. The oauth2 types (`clientCredentials`, `password`) fetch (and in-memory-cache) a token from the credential's `tokenUrl` first — form body includes optional `scope` plus any `extraTokenParams` (arbitrary additional claims; reserved keys like `grant_type`/`scope`/`client_id` cannot be overridden that way); `cookie` relies on the user having already logged into the target themselves, in any tab of the same browser, entirely outside Enlace's involvement (see §7).
   - Execute the real HTTP request **directly from the browser** to the target API.
   - Capture request + response, and emit a status-change event the store consumes to update the debug pane live (see point 7) — redacting credential values in the displayed log.
6. If any node fails — or the user issues Stop — halt admission of any newly-ready node — no partial recovery — but everything already in flight at that point still runs to completion, since those requests can't be un-sent; either way, every node still `'pending'`/`'paused'` at that moment settles to `'skipped'` immediately, rather than sitting in limbo for the rest of the run.
7. The bottom pane has two tabs (`DebugPane.tsx`): **Run Output** renders each step as its request/response actually settles, not only once the whole run finishes, unaffected by whether any breakpoint is armed; **Debugger** pre-populates a row for every node before Run even starts (in dependency order, for display only), overlaid with live status (pending/in-flight/paused/completed/failed/skipped) and an aggregate breakdown ("2 completed · 1 paused · 1 pending") rather than one global run status — a run can be simultaneously executing one branch and gated on another. Both consume the same `store/workflowStore.ts`'s `run()`, which streams `executeChain`'s per-node events into `runResult`/`stepStatusByNodeId`/`previewRequestByNodeId` incrementally. The Debugger tab auto-switches into view the instant execution actually reaches an armed breakpoint.
8. **Run** and **Debug** are two separate buttons, not one whose behavior silently depends on whatever's armed — `run()` only honors `armedBreakpoints` (and only sets `activeControl` at all) when called as `run({ useBreakpoints: true })`; a plain "Run" ignores every armed breakpoint outright, so having debug points set up never forces a stop-and-inspect run.

Verified with a concurrency-counter unit test (not just an order assertion) proving independent branches genuinely overlap in flight, a fan-out test proving a node fires as soon as its own dependency settles regardless of an unrelated slower sibling, and dedicated coverage for pause/continue/step/stop (including that Stop's admission-halt applies globally, not just to nodes downstream of whatever triggered it) — see `packages/core/src/engine/chainExecutor.test.ts`.

## 6. Frontend Structure

- **Canvas**: renders the `Operation` list as draggable boxes; dragging one onto the canvas adds a `WorkflowNode`. Dragging box-to-box (via each node's connect handles) creates a `WorkflowConnection` — order only, no data — rendered as a solid arrow (`BreakpointConnectionEdge.tsx`). **Double-clicking a connector arms a breakpoint** on it (wired at the canvas level via React Flow's `onEdgeDoubleClick`, not on any always-visible per-edge affordance) — an armed connector shows a red dot at its midpoint that stays clickable as a redundant disarm target, and a second double-click on the connector also disarms. Field mappings render as a separate dashed, animated edge, derived from `fieldValues`, not drawn directly on the canvas (direct field-to-field drag-connect is on the workspace-level `ROADMAP.md`); double-clicking one is silently ignored — a breakpoint can never arm on a mapping edge. A node's card carries a small top-left status badge and border treatment for its live run status — pulsing blue while in-flight, solid amber (plus an inline "Paused here" label) once paused at a breakpoint, a green check/red cross once settled. Cards keep a fixed clearance via `findOpenPosition` on drop / drag-end — except when drop-overlap (≥ ~50% of the smaller card) hits another node or an existing group: that gesture opens a confirm (`GroupConfirmModal`) to create/join a named canvas group (optional “Don’t ask when dropping into this group”), and Cancel falls back to the usual snap. Groups (`NodeGroup`) are canvas state beside `nodePositions`, never part of the executed `Workflow`, and round-tripped in `.enlace` exports. Expanded = titled frame around members; collapsed = mini cluster listing each member’s method + path (style B) with external edges rewired to the group shell — member cards are hidden while collapsed, so per-member run status (and an aggregate badge/border on the group chrome) is shown on the mini cluster instead. Double-click the collapsed card (or the chevron) to expand. Dragging a member so the expanded frame grows around an ungrouped card offers the same join confirm (Cancel nudges that card clear of the frame). A member can leave via the card’s leave-group control or a row control on the collapsed mini cluster (node stays on the canvas; group dissolves if fewer than 2 members remain). Multi-select → Group is still out of scope.
- **Presets palette + presets-collection chrome**: a "Presets" section above Operations (`OperationList.tsx`) is an icon-grid "library" (bare colored icons, no card chrome, name as a hover tooltip/`aria-label` — not a row-per-item list like Operations) offering only real presets — Wait and Assert — dragged onto the canvas via a distinct `text/preset-kind` drag payload (keeps this drop path from colliding with an operation drop). There's no separate "collection" palette item: dropping one on empty canvas routes through `Canvas.tsx`'s `onDrop` into `addPresetsNode(position, initialPreset)`, which creates a `kind: "presets"` node seeded with that one preset, never a standalone `kind: "wait"`/`"assert"` node; dropping one *onto an existing presets card* instead appends to it directly (`PresetsNodeCard.tsx`'s own `onDrop`, wired on that card only — not `WorkflowNodeCard` — which also stops the event from propagating to `Canvas.tsx`'s handler and creating a second, stray collection at the same spot). `PresetsNodeCard.tsx` is its own React Flow node type (`presetsNode`), not a reuse of `WorkflowNodeCard`/`GroupNodeCard`: collapsed is a small diamond (chevron + preset count + summary); expanded is a box listing each preset in order, up/down move buttons (adjacent-swap reorder only), and a remove button per preset — dragging another preset onto the card (collapsed or expanded) is the *only* way to append one; there's no "+ Add" button, since that stops scaling once more than a couple of preset kinds exist. Every row is the same shape regardless of kind — an icon + `formatPresetLabel(preset)` text (e.g. "Wait 2s", "Assert (2 checks)") in a clickable summary button, so the card stays a fixed width no matter what it holds — clicking a row calls `selectPreset(presetsNodeId, presetId)`, which is the *only* thing that opens that preset's real editor. That editor lives in `NodeConfig.tsx`, not on the card: `NodeConfig`'s own `kind === 'presets'` branch looks up `node.presets.find(p => p.id === selectedPresetId)` — nothing selected renders a "Select a preset on the canvas to configure it." placeholder (same tier as its "Select a node to configure it." placeholder for no node selected at all); a resolved preset renders a small header (icon + `formatPresetLabel`) plus a kind-specific editor — Wait gets a duration-in-seconds field (`setPresetDurationMs`); Assert gets a nested list of check rows — ancestor-node picker, source-type picker (body field/raw body/header/status), an operator picker, and an expected-value input, each backed by `addAssertCheck`/`removeAssertCheck`/`updateAssertCheck` — reusing `NodeConfig.tsx`'s own already-computed "Map from…" ancestors (`computeAncestors`/`flattenResponseFields`), minus its target-field type-compatibility filtering. `selectedPresetId` (store state, alongside `selectedNodeId`) is what `selectPreset` sets; `selectNode` always resets it to `null`, and `addPresetsNode`/`addPreset` auto-select the preset they just created/appended, so a palette drop's config is already open in the inspector without an extra click. Collapsed/expanded state itself (`presetsCollapsed`, keyed by node id) is canvas-only view chrome — same tier as `nodePositions`, round-tripped in `.enlace` exports, never part of the executed `Workflow`.
- **Locked while a run is in progress** (`workflowStore.ts`'s `isLocked`): every node-config/data-mapping/graph-structure mutation — field values, credential assignment, request mode / raw path·query·body, add/remove node, connect/disconnect, arm/disarm breakpoint, create/join/ungroup — no-ops at the store level, not just in whichever UI control also happens to be disabled to match. `executeChain` reads `nodes`/`connections`/`credentials`/`armedBreakpoints` exactly once, at the moment `run()` calls it; before this guard existed, an edit made while a run (or a paused debug session, which can sit open indefinitely) was in progress looked like it "took" in the store — the Inspector showed the new value — but silently had no effect on that run's actual behavior at all. Node position (and moving a whole group) is the deliberate exception: canvas-only, never part of the executed `Workflow`, so dragging a node stays allowed throughout a run.
- **Node inspector**: per selected node — a lock icon before the operation verb opens an inline credential picker (grey when unset, light green when attached), and a **Request** section grouped into Path variables / Query params / Headers / Body. A Form/Raw toggle on the Request heading switches path, query, and body between flat field rows and Raw JSON editors (tag chips supported); headers stay on the form. Locked (a native `<fieldset disabled>` around everything but the collapse button, plus a banner) while a run is in progress, whether debugging or not; each Raw JSON editor (CodeMirror-based, not a plain form control) gets the equivalent treatment via its own `readOnly` prop, since a `<fieldset disabled>` wrapper alone doesn't reach it.
- **Run / Debug buttons**: two distinct actions (see point 8 above), each disabled while a run is in progress. Once a run is actually controllable (`activeControl` set — only ever true for a Debug run), both disappear entirely, replaced by icon-only **Continue/Step/Stop** buttons (hover title as the accessible name, no visible label) — never shown alongside Run/Debug, so it's never ambiguous whether a plain run or a debug session is in progress.
- **Bottom pane**: a unified **Results** surface (`DebugPane.tsx` + `ResultsList.tsx`) — rows only while Results chrome is live (per-node status / pause preview), with expandable request/response (`debugPaneShared.tsx`), pause bar Continue/Step, and Clear (empties the list but **keeps `runResult`** so inspector tag-mapping preview still resolves). Idle or after Clear shows a short empty hint — canvas nodes alone do not pre-populate pending rows. During a **Debug** session (`debugConsoleOpen` / `isDebugRun`), the pane splits horizontally into **Results** on the left and a classic **Console** REPL on the right (`DebugConsole.tsx`); when the session ends, Results expands in place. Console `$` is the workflow run so far, printed **one level at a time** (`nodes`, `credentials`, `focus`; then `$.nodes`, `$.nodes.<label>`, …). Naming: **nodes** (not steps); request `params` / `query` / `headers` / `payload`; response `status` / `headers` / `body` / `error`. Macros: `help`, `clear`/`cls` (screen only; ↑/↓ recall kept). Input is CodeMirror with path/macro autocomplete. Secrets redacted. Session-only.
- Both side panels (node inspector, bottom pane) and the operations sidebar are independently collapsible, so the canvas can reclaim their space.
- Nodes are drag-repositionable and individually removable, with connections/mappings referencing a removed node cleaned up automatically rather than left dangling.

Built with React, React Flow, and Zustand.

## 7. Security Notes

- Credentials are held in browser memory by default and never written to logs. A normal `.enlace` export ("Partial") includes credential configuration but strips authenticating values — this mode is never encrypted, since there's nothing usable in it to protect. The export dialog's "Full credentials" mode includes every authenticating value, and going forward is *mandatorily* encrypted: the user sets a password at export time (min 8 characters, typed twice), and the same password is required at import time to read the file back. Full secrets are never written to `localStorage` or adapter persistence, and the password itself is held in browser memory only for the duration of the `crypto.subtle` call that needs it — never stored anywhere, with no recovery path if it's lost.
- **Encrypted-export envelope** (`utils/collectionCrypto.ts`): a "Full credentials" export wraps the same plaintext `EnlaceCollection` JSON unchanged inside `{ format: "enlace-collection-encrypted", version: 1, kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt }, cipher: { name: "AES-GCM", iv }, ciphertext }`, using only `crypto.subtle` (Web Crypto) — no new dependency. PBKDF2-SHA256 at 600,000 iterations (OWASP's 2023 minimum) derives an AES-256-GCM key from the password; salt and IV are freshly random on every export, so encrypting the same collection with the same password twice never produces the same bytes. `crypto.subtle` is only defined by browsers in a secure context (HTTPS or localhost) — since some of Enlace's real target deployments are plain HTTP pre-prod servers, `isEncryptionSupported()` guards both encrypt and import-side decrypt with a clear error instead of a raw `TypeError`, and the export dialog disables the "Full credentials" option outright when unsupported. What this guarantees: **the file is unreadable without the password** — not "unreadable outside Enlace," which isn't a real property to claim for an MIT-licensed, public-repo tool built on standard, publicly-documented crypto; anyone with the file and the password can decrypt it with five lines of `crypto.subtle` calls and no Enlace code at all, by design. AES-GCM's authentication tag means a wrong password or a tampered/corrupted file both fail the same way (`DecryptionError`) rather than silently returning garbage. A *legacy* plaintext "with secrets" file — produced by a build of this repo from before this envelope existed — remains importable, surfaced with a loud one-time warning that it was never encrypted, rather than being rejected outright.
- The debug pane redacts the `Authorization` header value, and (for an apiKey credential sent `in: "query"`, where the secret lives in the URL itself rather than a header) the named query param in the displayed URL — shows that a credential was sent without exposing the raw value.
- CORS is the target API's responsibility, since requests fire directly from the browser — this tool doesn't solve it, and that must be documented clearly wherever it matters.
- No per-user auth inside the tool; access control is inherited entirely from whatever network perimeter (VPN, internal network, SSO-gated proxy) already protects the host environment.
- `cookie` never involves any secret Enlace holds. The user logs into the target in their own browser — any tab, any time, using whatever login flow the target itself requires (third-party IdP, SSO, MFA, its own form) — entirely independent of Enlace, which has no part in that login and never sees the resulting cookie's value. When a node uses a `cookie` credential, `chainExecutor.ts` sets `credentials: 'include'` on the actual request so the browser's own cookie jar attaches whatever that independent login already set; this depends entirely on the target's CORS policy allowing credentialed cross-origin requests, same as any other CORS concern above. The credential's optional `loginUrl` is just a convenience link (opened in a new tab, on request) to jump to the target's login page — never something Enlace opens or drives itself. Deliberately scoped to *only* this case — a "the login flow hands back a token instead, paste it in" variant was designed and built, then dropped: the token could only be obtained by clicking a login-triggering button on the same form as the now-required Token field, which nothing communicated, leaving a required field the user had no way to fill in on their first attempt. Revisit only on real demand, with that ordering problem actually solved — see the workspace-level `ROADMAP.md`. Automatic capture of a token embedded in a redirect URL remains a separate, later concern (full OAuth2 `authorizationCode`-grant support, needing Enlace to own a registered callback route).

## 8. Deployment / Distribution

- One shared UI bundle plus one or more thin adapter packages, each published via its own ecosystem's normal channel.
- No Docker, no separate service, no required database — runs in the same process as the existing API, travels with it through its normal deployment pipeline.
- Access control is whatever already protects that environment; the tool adds none of its own.

## 9. Open Technical Decisions

- Confidence-scoring approach for auto-suggested field mapping, once built (how to rank multiple candidate fields sharing type/name) — not yet decided.
- Strategy for handling a workflow that references a spec which has since changed shape (fail loudly vs. attempt best-effort remap) — not yet decided.
- Keeping multiple adapters' behavior identical, once more than one exists, will need a shared conformance test suite — not built yet.
