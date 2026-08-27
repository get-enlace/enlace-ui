<h1>
  <img src="https://raw.githubusercontent.com/get-enlace/.github/refs/heads/main/brand/svgs/icon-full-100.svg" alt="" style="width: 32px; height: 32px; vertical-align: middle;"> Enlace
</h1>

A visual, chained-execution canvas for any OpenAPI-documented API. Drag
operations onto a canvas, wire the output of one call into the input of the
next, and run the whole chain — independent branches execute concurrently —
directly from your browser.

Enlace only needs one thing: a valid OpenAPI 3.x document. It doesn't care
what produced or serves it — swagger-ui-express, Swashbuckle, Springdoc, a
hand-written file, anything.

## What's here

- **`packages/enlace-ui`** (`@get-enlace/ui`) — the canvas itself: the
  operations list, the drag-and-drop canvas, the node inspector for field
  mapping and credentials, the debug pane, and the execution engine (spec
  parsing and the level-based concurrent chain executor). All of it runs
  client-side, in the browser.
- **`examples/sample-api`** — a small sample API (three cross-referencing
  CRUD resources) plus a dev harness, so you can try Enlace immediately
  without wiring up anything of your own. Mounts the canvas via
  `examples/sample-api/enlace.ts`, a small local copy of
  `@get-enlace/express`'s mount function (see below) — self-contained, no
  cross-repo dependency needed to run this repo's own dev server or tests.

Adapters (Express, and eventually Nest/Fastify/...) live in a separate
repo, [`get-enlace/enlace-js`](https://github.com/get-enlace/enlace-js) —
each is a thin package serving the OpenAPI document and this package's
built UI bundle in its own ecosystem's idiomatic way. Nothing here depends
on that repo; it depends on `@get-enlace/ui`, published from here.

## Quickstart

```bash
git clone https://github.com/get-enlace/enlace-ui.git
cd enlace-ui
npm install
npm start
```

Open `http://localhost:4000/enlace`.

## How it works

- **Connection vs. mapping.** Drag box-to-box on the canvas to set execution
  *order*; use the Node Inspector's "Map from..." picker to wire a field's
  *data source* from any upstream node in that connection graph, not just
  the one immediately before it.
- **Concurrent execution.** Nodes are grouped into dependency-ordered
  levels; everything within a level fires concurrently. A chain like
  "A, then B+C in parallel, then D (needs A and C, not B)" really does run
  B and C at the same time, not just in a permissive order.
- **Credentials stay in your browser.** Bearer tokens live in browser
  memory for the session and are attached directly to outgoing requests —
  they're never sent to or stored by the adapter, and the debug pane
  redacts them before ever rendering.
- **The adapter's job is small.** It serves the OpenAPI document and the UI
  bundle; it reads the target base URL from the spec's own
  `servers[0].url`. Everything else — resolving fields, firing requests,
  showing results — happens entirely in the browser.

## Try the parallel-execution demo

`examples/sample-api` is deliberately shaped for this: **A** (create a
customer), then **B + C run concurrently** (B updates that customer, C
creates a product — independent of each other), then **D** (create an
order) needs data from **A and C, not B**.

1. `npm start`, open `http://localhost:4000/enlace`.
2. Drag onto the canvas: `POST /customers` (A), `PATCH /customers/{id}` (B), `POST /products` (C), `POST /orders` (D).
3. Fill A's `name`/`email` and C's `name`/`price` with any static values.
4. Connect box-to-box (drag right handle → left handle): A→B, A→C, A→D, C→D.
5. On B: set `path.id` to "Map from..." → A → `id`; give `status` a static value like `"verified"`.
6. On D: set `body.customerId` to "Map from..." → A → `id`, and `body.productId` to "Map from..." → C → `id`; give `qty` a static value.
7. Click **Run**. All 4 calls come back green, in the order A, B, C, D — but B and C actually fire concurrently (see `computeExecutionLevels` in `packages/enlace-ui/src/engine/chainExecutor.ts`).

## Try the credentials demo

Each of `examples/sample-api`'s write operations requires a *different*
credential type, genuinely enforced server-side — not decoration. `npm
start` also boots a local mock OAuth2 issuer
([`oauth2-mock-server`](https://github.com/axa-group/oauth2-mock-server),
on port 4001) so the two OAuth2 types are a real signed-JWT round trip, not
a stub:

| Operation | Requires | Story |
|---|---|---|
| `POST /customers` | Basic auth | back-office tool creates the record |
| `PATCH`/`DELETE /customers/{id}` | Bearer token | the customer's own session token |
| `POST /orders` | API key (header) | a POS/kiosk integration |
| `POST`/`PATCH`/`DELETE /products/{id}` | OAuth2 (password grant) | **only an admin**, logging in with their own username/password, can manage the catalog |
| `DELETE /orders/{id}` | OAuth2 (client credentials) | an automated cleanup job — service-to-service, no human login |

The mock issuer accepts *any* client id/secret or username/password — it's
not really authenticating anyone, just proving the actual protocol
round-trip (POST for a token, verify its signature, attach it) works.

1. Continue from the parallel-execution demo above (or start fresh — either works).
2. Open the **Credentials** drawer (topbar). Under "Declared in spec" you'll see all five schemes read straight from `openapi.json`, tokenUrl and all — click "Configure" on each and just fill in the missing name/secret field(s) (any value works).
3. Attach each credential to the matching node via its inspector's "Credential" dropdown, then **Run**.
4. To see the enforcement actually bite: leave one node's credential unset (or attach the wrong type) and Run again — that step comes back red with a 401, while the debug pane still redacts whatever credential *was* sent on the others.

## Learn more

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — how Enlace is designed and why.
- [`ROADMAP.md`](ROADMAP.md) — what's planned next.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — local development setup, test
  commands, and how CI/CD works.
