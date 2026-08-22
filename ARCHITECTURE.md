# Enlace — Architecture Document

## 1. Design Principles

1. **Depend on OpenAPI, not on Swagger UI.** The only input contract is "a URL, file, or object that resolves to a valid OpenAPI 3.x document." No dependency on Swagger UI, Swashbuckle, Springdoc, or any specific spec-generation toolchain.
2. **One UI, executed where Swagger UI already executes: the browser.** Chain execution (HTTP calls, field resolution, ordering) runs entirely client-side — the same trust model Swagger UI's own "Try it out" already uses, extended from one call to a chain of them.
3. **Adapters are thin, symmetric across languages.** Each adapter serves the UI's static bundle and resolves/serves the OpenAPI document. Nothing else varies by language.
4. **No server-side engine.** Execution is UI work (client-side, in the browser); persistence, once built, is adapter work (per-language CRUD). There's no stateful, complex logic that needs porting or sidecar-hosting across languages.
5. **Trust model matches Swagger UI's own.** No per-user auth inside the tool; whoever can reach the URL has the same access Swagger UI's "Authorize" button already implicitly grants.

## 2. High-Level Component Diagram

```
                     ┌───────────────────────────────┐
                     │   Browser (all execution here)  │
                     │                                  │
                     │  UI package (one codebase, JS):   │
                     │   - Canvas (nodes, connections)   │
                     │   - Node inspector (fields, creds)│
                     │   - Execution engine (in-browser):│
                     │       resolve order, resolve      │
                     │       field values, fetch() calls │
                     │   - Debug pane                    │
                     └───────────────┬───────────────────┘
                                     │
             ┌───────────────────────┼────────────────────────┐
             │ HTTP (spec)                                     │ HTTP (direct calls,
             │                                                  │ browser → target API)
             ▼                                                  ▼
   ┌─────────────────────────┐                       ┌───────────────────────┐
   │  Adapter (Express today,│                       │  User's own target API │
   │  more planned)          │                       │  (any language)        │
   │                          │                       └───────────────────────┘
   │  - Serves UI static bundle
   │  - Serves/proxies OpenAPI doc
   └─────────────────────────┘
```

Two distinct HTTP relationships exist, and they don't cross: the browser talks to its own adapter for UI assets and the spec; separately, the browser talks directly to the target API to execute chain steps. The adapter never proxies execution calls.

The **target API** being tested can be written in any language — the browser only ever talks to it over plain HTTP, per the OpenAPI spec. Language dependence only exists on the *hosting* side (what serves the canvas UI and spec), not the target API side.

## 3. Repo/Package Layout

| Package | Language | Responsibility |
|---|---|---|
| `enlace-ui` (`@get-enlace/ui`) | JS (framework-agnostic bundle) | Canvas, inspector, debug pane, in-browser execution logic. Built once, shipped as static assets consumed by every adapter. |
| `enlace-express` (`@get-enlace/express`) | Node/TS | Serves the UI bundle, resolves the OpenAPI document. |

Both packages live in this repo today (`packages/enlace-ui`, `packages/enlace-express`), alongside a sample API and dev harness (`examples/sample-api`) for trying Enlace without wiring up anything of your own.

None of these need to talk to each other, to a shared engine process, or to any particular runtime beyond their own — each adapter is a self-contained, idiomatic package in its own ecosystem, exactly matching how Springdoc and Swashbuckle each independently serve the same Swagger UI bundle without any cross-language coordination.

See `ROADMAP.md` for planned additional adapters and packaging changes.

## 4. Data Model

Core types, used identically inside the UI package regardless of adapter:

```
Operation (derived from the spec, not stored — read fresh each load) {
  id: string              // e.g. "POST /orders"
  method: string
  path: string
  parameters: OperationParameter[]
  requestBodySchema: object | null
  responseSchema: object | null
}

WorkflowNode {
  id: string               // unique per canvas instance
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
}

WorkflowConnection {
  fromNodeId: string
  toNodeId: string
}

Workflow {
  nodes: WorkflowNode[]
  connections: WorkflowConnection[]
}

Credential {
  id: string
  name: string
  type: "bearer"           // more types planned, see ROADMAP.md
  token: string            // held in browser memory only
}

RunResult {
  steps: [
    {
      nodeId: string
      request: { method, url, headers, body }
      response?: { status, headers, body }
      timestampStart: string
      timestampEnd: string
      error?: string
    }
  ]
}
```

**Connection and mapping are two separate concerns.** A `WorkflowConnection` establishes execution *order* only — it carries no data. A mapped `FieldValue` establishes a field's *data source* — it always implies its source must run first too, whether or not the user also drew an explicit connection, but the reverse isn't true: a node can be connected after another purely for sequencing, with no data flowing between them.

A field may be mapped from **any ancestor** in the connection graph, not just the node directly before it — e.g. `A -> B -> C` where `B` carries no data at all, `C` can still map a field from `A` directly, skipping `B`.

## 5. Request Flow

1. User hits **Run** in the browser.
2. The UI groups nodes into execution **levels** (waves) via Kahn's algorithm over the union of explicit `connections` and mapping-implied dependencies (a node mapping a field from another node's response must run after it, connection or not) — every node in a level has all its dependencies satisfied by prior levels, so nothing in a level can depend on another node in the same level. Throws `CyclicWorkflowError` before attempting execution if a cycle exists.
3. Levels run one at a time, in order; **every node within a level fires concurrently** (concurrent `fetch()` calls), since the level-grouping guarantee makes that safe — this is what makes "run A, then B+C in parallel, then D (needs A and C)" actually run B and C concurrently, not just in a permissive relative order.
4. For each node's request, in the level it's scheduled to:
   - Resolve `fieldValues` — static values used directly; mapped values pulled from the actual captured response of the referenced upstream node.
   - Attach credential, if any (bearer token → `Authorization` header).
   - Execute the real HTTP request **directly from the browser** to the target API.
   - Capture request + response for the debug pane, redacting credential values in the displayed log.
5. If any node in a level fails, halt before the next level starts — everything else already in flight in that same level still runs to completion, since those requests can't be un-sent.
6. Full run result rendered in the debug pane.

Verified with a concurrency-counter unit test (not just an order assertion) proving independent branches genuinely overlap in flight — see `packages/enlace-ui/src/engine/chainExecutor.test.ts`.

## 6. Frontend Structure

- **Canvas**: renders the `Operation` list as draggable boxes; dragging one onto the canvas adds a `WorkflowNode`. Dragging box-to-box (via each node's connect handles) creates a `WorkflowConnection` — order only, no data — rendered as a solid arrow. Field mappings render as a separate dashed, animated edge, derived from `fieldValues`, not drawn directly on the canvas (see `ROADMAP.md` for direct field-to-field drag-connect).
- **Node inspector**: per selected node — credential dropdown, and a list of request fields, each either a static input or a "map from..." picker listing every ancestor node in the connection graph.
- **Run button**: triggers execution, disables interaction until the result returns.
- **Debug pane**: renders `RunResult.steps` in order, expandable per step (request/response detail); collapsible as a whole panel.
- Both side panels (node inspector, debug pane) and the operations sidebar are independently collapsible, so the canvas can reclaim their space.
- Nodes are drag-repositionable and individually removable, with connections/mappings referencing a removed node cleaned up automatically rather than left dangling.

Built with React, React Flow, and Zustand.

## 7. Security Notes

- Credentials are held in browser memory only for the session — never written to disk or logs by the UI itself.
- The debug pane redacts the `Authorization` header value before it's ever rendered — shows that a credential was sent without exposing the raw token.
- CORS is the target API's responsibility, since requests fire directly from the browser — this tool doesn't solve it, and that must be documented clearly wherever it matters.
- No per-user auth inside the tool; access control is inherited entirely from whatever network perimeter (VPN, internal network, SSO-gated proxy) already protects the host environment.

## 8. Deployment / Distribution

- One shared UI bundle plus one or more thin adapter packages, each published via its own ecosystem's normal channel.
- No Docker, no separate service, no required database — runs in the same process as the existing API, travels with it through its normal deployment pipeline.
- Access control is whatever already protects that environment; the tool adds none of its own.

## 9. Open Technical Decisions

- Confidence-scoring approach for auto-suggested field mapping, once built (how to rank multiple candidate fields sharing type/name) — not yet decided.
- Strategy for handling a workflow that references a spec which has since changed shape (fail loudly vs. attempt best-effort remap) — not yet decided.
- Keeping multiple adapters' behavior identical, once more than one exists, will need a shared conformance test suite — not built yet.
