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

| Package | Language | Repo | Responsibility |
|---|---|---|---|
| `enlace-ui` (`@get-enlace/ui`) | JS (framework-agnostic bundle) | `get-enlace/enlace-ui` (this repo) | Canvas, inspector, debug pane, in-browser execution logic. Built once, shipped as static assets consumed by every adapter. |
| `enlace-express` (`@get-enlace/express`) | Node/TS | [`get-enlace/enlace-js`](https://github.com/get-enlace/enlace-js) | Serves the UI bundle, resolves the OpenAPI document. |

`@get-enlace/ui` lives in this repo (`packages/enlace-ui`), alongside a
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

// A discriminated union on `type` — each variant carries only the fields
// that type needs. All held in browser memory only, never persisted.
// `fromSecurityScheme?` on every variant records the spec's own
// `components.securitySchemes` key when the credential was configured
// from what the spec declares (see engine/securitySchemes.ts) — purely
// informational, shown as a tag on the credential's card.
Credential =
  | { id, name, fromSecurityScheme?, type: "bearer", token }
  | { id, name, fromSecurityScheme?, type: "basic", username, password }
  | { id, name, fromSecurityScheme?, type: "apiKey", paramName, in: "header" | "query", key }
  | { id, name, fromSecurityScheme?, type: "oauth2_clientCredentials", tokenUrl, clientId, clientSecret, scope? }
  | { id, name, fromSecurityScheme?, type: "oauth2_password", tokenUrl, username, password, clientId?, clientSecret?, scope? }
  | { id, name, fromSecurityScheme?, type: "popup_login", loginUrl }
  // more variants planned (full OAuth2 authorizationCode-grant support) — see ROADMAP.md

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
2. The dependency graph is the union of explicit `connections` and mapping-implied dependencies (a node mapping a field from another node's response must run after it, connection or not) — `computeExecutionLevels` (Kahn's algorithm) still runs once up front purely as a `CyclicWorkflowError` check before anything fires.
3. Execution itself is **per-node, readiness-driven**, not batched by level: each node fires the instant every node it depends on has *completed*, independent of whatever else is or isn't still in flight elsewhere in the graph. Independent nodes with no pending dependencies still become ready and fire together in the same pass — exactly what a level would produce whenever nothing is gating anything — but a node is never held back waiting on an unrelated sibling that merely happens to share an ancestor (e.g. `A -> B` and `A -> C` in the same wave: a slow `B` never delays `C`, or anything depending only on `C`). This generalization exists so a future breakpoint on one connection can gate exactly the node(s) downstream of it without incorrectly gating unrelated concurrent branches — see `packages/enlace-ui/src/engine/chainExecutor.ts`'s `executeChain`.
4. For each node's request, once it's ready to fire:
   - Resolve `fieldValues` — static values used directly; mapped values pulled from the actual captured response of the referenced upstream node.
   - Attach credential, if any — resolved per its type (`engine/credentials.ts`) into a header (bearer/basic/apiKey-in-header/either oauth2 grant), a query param (apiKey-in-query), or — uniquely for `popup_login` — a `credentials: 'include'` fetch option instead of any injected value at all, since `Cookie` is a forbidden fetch() request header and can only ever be attached by the browser's own cookie jar. The oauth2 types (`clientCredentials`, `password`) fetch (and in-memory-cache) a token from the credential's `tokenUrl` first; `popup_login` requires the user to complete login in a real browser popup first (see §7) — no fetch()-driven node can do this itself.
   - Execute the real HTTP request **directly from the browser** to the target API.
   - Capture request + response, and emit a status-change event the store consumes to update the debug pane live (see point 6) — redacting credential values in the displayed log.
5. If any node fails, halt admission of any newly-ready node — no partial recovery — but everything already in flight at that point still runs to completion, since those requests can't be un-sent.
6. The debug pane renders each step as its request/response actually settles, not only once the whole run finishes — see `store/workflowStore.ts`'s `run()`, which streams `executeChain`'s per-node events into `runResult`/`stepStatusByNodeId` incrementally.

Verified with a concurrency-counter unit test (not just an order assertion) proving independent branches genuinely overlap in flight, plus a fan-out test proving a node fires as soon as its own dependency settles regardless of an unrelated slower sibling — see `packages/enlace-ui/src/engine/chainExecutor.test.ts`.

## 6. Frontend Structure

- **Canvas**: renders the `Operation` list as draggable boxes; dragging one onto the canvas adds a `WorkflowNode`. Dragging box-to-box (via each node's connect handles) creates a `WorkflowConnection` — order only, no data — rendered as a solid arrow. Field mappings render as a separate dashed, animated edge, derived from `fieldValues`, not drawn directly on the canvas (see `ROADMAP.md` for direct field-to-field drag-connect).
- **Node inspector**: per selected node — credential dropdown, and a list of request fields, each either a static input or a "map from..." picker listing every ancestor node in the connection graph.
- **Run button**: triggers execution, disables interaction until the result returns.
- **Debug pane**: renders `RunResult.steps` as each one settles during a run, not only once it finishes, expandable per step (request/response detail); collapsible as a whole panel.
- Both side panels (node inspector, debug pane) and the operations sidebar are independently collapsible, so the canvas can reclaim their space.
- Nodes are drag-repositionable and individually removable, with connections/mappings referencing a removed node cleaned up automatically rather than left dangling.

Built with React, React Flow, and Zustand.

## 7. Security Notes

- Credentials are held in browser memory only for the session — never written to disk or logs by the UI itself.
- The debug pane redacts the `Authorization` header value, and (for an apiKey credential sent `in: "query"`, where the secret lives in the URL itself rather than a header) the named query param in the displayed URL — shows that a credential was sent without exposing the raw value.
- CORS is the target API's responsibility, since requests fire directly from the browser — this tool doesn't solve it, and that must be documented clearly wherever it matters.
- No per-user auth inside the tool; access control is inherited entirely from whatever network perimeter (VPN, internal network, SSO-gated proxy) already protects the host environment.
- `popup_login` never involves any secret Enlace holds — the actual login (third-party-IdP-driven: GitHub, Google, SSO, MFA — anything requiring a human to click through pages on another origin) happens in a real `window.open()`'d browser window that Enlace's own code never reads from or writes to. That's a deliberate limitation, not an oversight: CORS, consent screens, and registered-redirect-URI mismatches make it impossible for any fetch()-driven node to complete that kind of login itself. Once the popup closes, `chainExecutor.ts` sets `credentials: 'include'` on the actual request so the browser's own cookie jar attaches whatever the login set — this depends entirely on the target's CORS policy allowing credentialed cross-origin requests, same as any other CORS concern above. Deliberately scoped to *only* the server-sets-a-session-cookie case — a "the login flow hands back a token instead, paste it in" variant was designed and built, then dropped: the token could only be obtained via the very "Log in" button on the same form as the now-required Token field, which nothing communicated, leaving a required field the user had no way to fill in on their first attempt. Revisit only on real demand, with that ordering problem actually solved — see ROADMAP.md. Automatic capture of a token embedded in a popup's own redirect URL remains a separate, later concern (full OAuth2 `authorizationCode`-grant support, needing Enlace to own a registered callback route).

## 8. Deployment / Distribution

- One shared UI bundle plus one or more thin adapter packages, each published via its own ecosystem's normal channel.
- No Docker, no separate service, no required database — runs in the same process as the existing API, travels with it through its normal deployment pipeline.
- Access control is whatever already protects that environment; the tool adds none of its own.

## 9. Open Technical Decisions

- Confidence-scoring approach for auto-suggested field mapping, once built (how to rank multiple candidate fields sharing type/name) — not yet decided.
- Strategy for handling a workflow that references a spec which has since changed shape (fail loudly vs. attempt best-effort remap) — not yet decided.
- Keeping multiple adapters' behavior identical, once more than one exists, will need a shared conformance test suite — not built yet.
