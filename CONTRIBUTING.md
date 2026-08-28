# Contributing to enlace-ui

## Development

```bash
npm install

npm start        # sample API + adapter + canvas, one process
                  # -> http://localhost:4000/enlace
                  # -> http://localhost:4000/api-docs (the sample API's own Swagger UI)

npm run dev --workspace @get-enlace/ui   # canvas with hot reload, for iterating on the UI itself
                                           # -> http://localhost:5173

npm test              # unit tests (mocked fetch, no real server)
npm run test:e2e       # real HTTP e2e tests against examples/sample-api's enlace.ts
npm run test:e2e-ui    # Playwright smoke test (needs `npx playwright install --with-deps chromium` once)
npm run typecheck
npm run build          # builds enlace-ui (vite)
```

`npm start`'s `predev` hook builds `@get-enlace/ui`'s bundle automatically
on first run if it's missing; run `npm run build:ui` manually after editing
canvas code outside the hot-reload dev server.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for how the codebase is designed —
useful context before making a non-trivial change.

## CI/CD

- **`.github/workflows/pr.yml`** — every PR: typecheck, unit tests, the
  real e2e suite, and the Playwright smoke test.
- **`.github/workflows/main.yml`** — one pipeline, every push to `main`.
  `deploy-dev` always runs first: builds, publishes `@get-enlace/ui@dev` to
  GitHub Packages, tags the build. `deploy-prod` then queues right behind it
  (`needs: deploy-dev`) — gated behind the `production` environment's
  required-reviewer approval, it pauses until someone approves it, then
  publishes whatever version is currently committed in
  `packages/enlace-ui/package.json` to public npmjs.org, tags the release,
  and bumps the patch version for next time — same shape as
  `enlace-js`/`enlace-dotnet`'s own `deploy-prod` jobs. No separate
  tag-push trigger. `notify-downstream-dev` / `notify-downstream-prod` each
  fire independently right after their own publish job succeeds (split in
  two so a pending prod approval can't delay the dev notification): fans
  out a `repository_dispatch: enlace-ui-release` to every known adapter
  repo (currently `enlace-js`, `enlace-dotnet`), so each can decide for
  itself whether it needs to fetch the new build — see
  [`release-strategy.md`](../release-strategy.md) for the full cross-repo
  picture.

One-time setup this needs, done in the repo's GitHub settings, not in code:
- A `development` environment and a `production` environment (the latter
  with a required reviewer) under **Settings → Environments** — already
  created.
- Still outstanding: an `NPM_TOKEN` secret (a public npmjs.org token) on
  the `production` environment, and a `CROSS_REPO_PAT` secret (scoped to
  trigger `repository_dispatch` on `enlace-js`/`enlace-dotnet`) available
  to the `notify-downstream-*` jobs. `GITHUB_TOKEN` (used for the GitHub
  Packages dev channel) is automatic — no setup needed.
