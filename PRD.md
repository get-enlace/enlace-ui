# Enlace — Product Requirements Document

## 1. Problem Statement

Teams using Swagger/OpenAPI-documented APIs frequently need to call multiple endpoints in sequence during pre-prod testing and exploration — e.g., create a resource, then fetch it by the ID returned. Swagger UI supports calling one endpoint at a time but has no concept of chaining calls, passing data between them, or managing multiple credentials across APIs.

Existing tools that solve parts of this (Postman Flows, n8n, Bruno) are either heavyweight (self-hosted, separate infra), not integrated into the existing API-docs workflow developers already use, or treat auth as a single global token rather than a first-class, per-node, multi-credential concern.

## 2. Solution Summary

A visual canvas for building and running chained sequences of OpenAPI-documented API calls: every operation appears as a draggable box, response fields from one wire into request fields of another, credentials attach per box, and the whole chain runs with step-by-step debug output — independent branches executing concurrently, not just in a flat sequential order.

Execution runs entirely client-side, in the browser — the same trust/execution model Swagger UI's own "Try it out" already uses, just extended from a single call to a whole chain of them. The tool depends only on the OpenAPI Specification itself, not on Swagger UI, Swashbuckle, Springdoc, or any particular spec-generation toolchain. A thin per-framework adapter serves the UI bundle and resolves the spec — no execution logic lives server-side.

The tool runs inside the user's own environment (local, dev, or QA) — not a hosted SaaS. No user data, specs, or credentials touch infrastructure we operate. This mirrors how Swagger UI itself is distributed and trusted today.

## 3. Target User & Context

- Backend/API developers and QA engineers working pre-prod.
- Have an OpenAPI 3.x document for their API — whether or not it's served via Swagger UI, Swashbuckle, Springdoc, or any UI at all.
- Comfortable installing a package for their stack.
- Operate in local/dev/QA environments — **not** intended for production deployment.

## 4. Non-Goals

- **Not a hosted product.** We do not store, transmit, or have access to any user's specs, credentials, or workflow data.
- **Not a production tool.** Explicitly pre-prod only, same trust model as Swagger UI's own "Authorize" button.
- **No per-user authentication/authorization** inside the tool. Access control is inherited entirely from whatever network perimeter (VPN, internal network, SSO-gated proxy) already protects the host environment.
- **No multi-tenant isolation.** Single install = single trust boundary, same as Swagger UI.

## 5. Scope

- Point the adapter at an existing OpenAPI 3.x document (URL, file path, or a parsed object) — the same one already used for Swagger UI/Swashbuckle/Springdoc if present, or standalone if not.
- Every operation in the spec renders as a draggable box on the canvas.
- Execution **order** and field **data source** are separate concerns: drag box-to-box on the canvas to connect nodes (order only); use the Node Inspector's "map from..." picker to wire a field's value from any upstream node reachable in that connection graph, not just the one directly before it.
- Bearer-token credentials, entered by the user, held in browser memory for the session — assignable per node, reusable across nodes.
- Independent branches execute concurrently: nodes are grouped into dependency-ordered levels, and everything within a level fires at once. A failure in a level halts before the next level starts; requests already in flight in that level still run to completion.
- Cyclic connection graphs are rejected with a clear error before execution ever starts.
- Debug pane shows each step's full request and response, in execution order, with credential values redacted in the displayed log even though they were genuinely sent.

This is the current scope. For what's planned next — persistence, more credential types, more adapters, canvas drag-connect for fields, auto-suggested mapping — see `ROADMAP.md`.

## 6. Distribution Model

One UI package (a framework-agnostic static bundle: canvas, inspector, debug pane, and the execution engine), built once and shipped as static assets consumed by every adapter. Each adapter is a thin package for its own framework, published via that ecosystem's normal channel, mounting a route that serves the UI bundle and the OpenAPI document. Runs in the same process/host as the existing API, travels with it through its normal deployment pipeline — no separate hosting decision, no Docker, no required database.

## 7. Testing Strategy

Unit tests (mocked `fetch`) cover the execution engine, including a concurrency-counter test that proves independent branches genuinely overlap in flight — not just an order assertion. Real-HTTP e2e tests run against a live adapter instance. A Playwright smoke test confirms the built UI actually renders. All three run in CI on every pull request.

## 8. Open Questions / Risks

- Credential values aren't encrypted at rest, and — since execution is client-side — are visible to anyone with browser dev tools open on that machine. Acceptable under the stated pre-prod, perimeter-trust model, but must be stated plainly in every adapter's README.
- Browser-side execution makes CORS the target API's problem to solve, the same way it already is for Swagger UI's own "Try it out" — must be documented clearly, not hidden as a "gotcha."
- No decision yet on what happens when the underlying OpenAPI spec changes shape after a workflow was built (stale field references) — fail loudly vs. attempt best-effort remap.
- Auto-suggested field mapping's confidence/ranking approach, once built, is still an open design question — not just "exact match wins."
