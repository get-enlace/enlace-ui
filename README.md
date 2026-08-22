# Enlace

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
- **`packages/enlace-express`** (`@get-enlace/express`) — an Express
  adapter: serves an OpenAPI document and the built UI bundle at whatever
  path you mount it.
- **`examples/sample-api`** — a small sample API (three cross-referencing
  CRUD resources) plus a dev harness, so you can try Enlace immediately
  without wiring up anything of your own.

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

## Development

```bash
npm install

npm start        # sample API + adapter + canvas, one process
                  # -> http://localhost:4000/enlace
                  # -> http://localhost:4000/api-docs (the sample API's own Swagger UI)

npm run dev --workspace @get-enlace/ui   # canvas with hot reload, for iterating on the UI itself
                                           # -> http://localhost:5173

npm test              # unit tests (mocked fetch, no real server)
npm run test:e2e       # real HTTP e2e tests against the adapter
npm run test:e2e-ui    # Playwright smoke test (needs `npx playwright install --with-deps chromium` once)
npm run typecheck
npm run build          # builds enlace-express (tsc) + enlace-ui (vite)
```

`npm start`'s `predev` hook builds `@get-enlace/ui`'s bundle automatically
on first run if it's missing; run `npm run build:ui` manually after editing
canvas code outside the hot-reload dev server.

## CI

- **`.github/workflows/pr.yml`** — every PR: typecheck, unit tests, the
  real e2e suite, and the Playwright smoke test.
- **`.github/workflows/main.yml`** — builds and publishes dev builds to
  GitHub Packages, tagging each one it publishes.

## Learn more

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — how Enlace is designed and why.
- [`ROADMAP.md`](ROADMAP.md) — what's planned next.
