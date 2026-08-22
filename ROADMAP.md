# Roadmap

What's planned but not built yet. See `README.md` for what Enlace does
today.

## Persistence

Workflows and credentials currently live in browser memory only and reset
on refresh. Planned: an opt-in persistence layer in each adapter (SQLite by
default, or a user-supplied database) so a canvas layout and its
credentials can be saved and reloaded.

## More adapters

`@get-enlace/express` is the only adapter today. Planned:

- `enlace-nest`, `enlace-fastify` — alongside `enlace-express`, extracted
  together into a separate `enlace-js` monorepo.
- `enlace-aspnet` (.NET), `enlace-spring` (Java) — each their own repo.

## More credential types

Bearer tokens only today. Planned: `apiKey`, `basic`, and OAuth2
client-credentials.

## Canvas field-to-field mapping

Field mapping is currently done through the Node Inspector's "Map from..."
picker. Planned: drag-connect directly between fields on the canvas itself.

## Deeper body field support

Body field flattening is one level deep today — nested and array fields
are shown but disabled in the picker. Planned: full nested/array field
support.

## Publishing

`@get-enlace/ui` and `@get-enlace/express` aren't published anywhere yet.
GitHub Packages requires the npm scope to match the repository's owner, so
publishing under `@get-enlace/*` needs this repo to live under the
`get-enlace` GitHub org first — not yet done.
