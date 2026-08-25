# Roadmap

What's planned but not built yet. See `README.md` for what Enlace does
today.

## Persistence

Workflows and credentials currently live in browser memory only and reset
on refresh. Planned: an opt-in persistence layer in each adapter (SQLite by
default, or a user-supplied database) so a canvas layout and its
credentials can be saved and reloaded.

## More adapters

`@get-enlace/express` is the only adapter today, extracted into its own
repo, [`get-enlace/enlace-js`](https://github.com/get-enlace/enlace-js) —
a monorepo for Node/JS adapters specifically, with its own CI and
dev-publish workflow. Planned:

- `enlace-nest`, `enlace-fastify` — alongside `enlace-express`, in that
  same `enlace-js` monorepo.
- `enlace-aspnet` (.NET), `enlace-spring` (Java) — each their own repo.

## More credential types

`bearer`, `basic`, `apiKey`, and OAuth2 `clientCredentials` today (the
grant types/subtypes needing a browser redirect/popup or relying on the
target's own cookie — OAuth2 `authorizationCode` and `password`, and the
Cookie type — are the remaining, later phases). Planned: spec-driven
credential template suggestion from a loaded spec's
`components.securitySchemes`, and explicit warning copy on higher-risk
credential types (client secrets, password-grant) beyond the one already
shown for OAuth2 client-credentials.

## Canvas field-to-field mapping

Field mapping is currently done through the Node Inspector's "Map from..."
picker. Planned: drag-connect directly between fields on the canvas itself.

## Deeper body field support

Body field flattening is one level deep today — nested and array fields
are shown but disabled in the picker. Planned: full nested/array field
support.

## Publishing

Both packages publish dev builds to GitHub Packages under the `dev`
dist-tag — `@get-enlace/ui` from this repo's own `main.yml` (on every push
to `main`), `@get-enlace/express` from `enlace-js`'s equivalent workflow
(currently `workflow_dispatch`-only, pending the same "confirm a manual
run works, then go live on push" rollout this repo already went through).
No versioned (non-dev) releases exist yet for either.
