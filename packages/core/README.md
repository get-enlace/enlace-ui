# @get-enlace/core

Portable Enlace chain-execution engine — no React, no DOM, no CSS.

**Workspace-only** — not published to npm. The UI (and a future CLI in this
repo) depend on it via the npm workspace and bundle it at build time. Flip
`private` and restore publish wiring later if an external consumer needs it.

## What it is

Spec parsing, dependency graph, credential injection (bearer / basic / apiKey /
OAuth2 token fetch), raw-body tag resolution, `executeChain`, and password
encryption/decryption for `.enlace` full-credential exports (Web Crypto /
AES-GCM).

## Node

Requires Node `>=18` (`fetch`, `FormData`, `File`, `btoa`, `crypto.subtle`).

## Cookie credentials

`cookie` type still resolves to `{ credentials: 'include' }` for the browser.
A future CLI should reject workflows that use it — core stays environment-dumb.

## Develop

```bash
npm test --workspace @get-enlace/core
npm run build --workspace @get-enlace/core
```
