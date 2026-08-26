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

`bearer`, `basic`, `apiKey`, OAuth2 `clientCredentials`/`password`, and
`popup_login` today, plus reading what the spec itself declares: a loaded
spec's `components.securitySchemes` populates the Credentials drawer's
"Declared in spec" list with ready-to-configure templates, pre-filling
everything but the secret value(s) (clearly marked as spec-derived, both
at configuration time and afterward on the saved credential's card) —
including `apiKey`-in-`cookie` schemes, mapped to `popup_login`.

`popup_login` covers third-party-IdP-driven login (GitHub, Google, SSO,
MFA — anything requiring a human to click through pages on another
origin), which no fetch()-driven node can complete itself: the user logs
in for real in a `window.open()`'d popup Enlace never reads from or
writes to; the browser's cookie jar already has whatever the login set,
and `credentials: 'include'` picks it up automatically from there. It
injects nothing into the request itself — no header, no query param, no
stored secret — making it more of a login *trigger* than a typical
value-bearing credential; see the "Actions" note below. Deliberately
scoped to *only* this case. A "the login flow hands back a token instead,
paste it in" variant was designed and built, then dropped: the token
could only be obtained via the very "Log in" button on the same form as
the now-required Token field, and nothing communicated that ordering — a
required field the user had no way to fill in on their first attempt.
Worth revisiting on real demand, with that ordering problem actually
solved (not just re-added).

Remaining, later phase: full OAuth2 `authorizationCode`-grant support —
Enlace owning a registered callback route to *automatically* capture a
code/token from a popup's own redirect. Needs Enlace to control the
redirect target, which is a materially different, harder mechanism than
`popup_login` (see ARCHITECTURE.md §7).

## Actions, as a concept distinct from Credentials

`popup_login` doesn't fit the Credential model cleanly — attaching it to
a node injects nothing into the request (no header, no query param); it
triggers something to happen (a real login, in a popup) whose effect (a
cookie) is applied by the browser, invisibly, outside Enlace's control.
It's modeled as a Credential today because that's the closest existing
mechanism — something attachable to a node, configurable in the same
drawer — not because it conceptually holds a secret; it's the one
variant with no stored value in its own state at all.

If more UI-triggered, non-value-bearing steps come up later (explicit
"re-run login", "refresh this token", "clear this session"), they likely
deserve a first-class **Action** concept of their own — something a node
can trigger as part of a run, distinct from a Credential's "here's a
value to attach" — rather than continuing to stretch Credential to cover
both meanings. Not scoped or designed yet; noted here so `popup_login`
isn't mistaken for the intended long-term shape of that idea.

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
