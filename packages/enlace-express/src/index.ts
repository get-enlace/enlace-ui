import express from 'express';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadSpec, type SpecSource } from './specLoader.js';

const require = createRequire(import.meta.url);

export interface EnlaceOptions {
  /** A file/URL path or an already-parsed object — the only input this needs is a valid OpenAPI 3.x document, however it's produced or served. */
  spec: SpecSource;
}

/**
 * Mounts the Enlace canvas.
 *
 *   app.use('/enlace', enlace({ spec }))
 *
 * This adapter's job is deliberately small — per ARCHITECTURE.md's MVP
 * model, execution runs entirely client-side in @get-enlace/ui, so there's
 * no `/api/run` or `/api/credentials` here at all. All this does is:
 *   - serve the raw OpenAPI document (parsed into an Operation[] list
 *     client-side, not here — see @get-enlace/ui's engine/specParser.ts)
 *   - serve the built UI bundle
 *
 * This package is testing/dev scaffolding for this repo right now — it's
 * destined for extraction into a separate `enlace-js` monorepo (alongside
 * enlace-nest, enlace-fastify, etc.) once that split is real.
 */
export function enlace(options: EnlaceOptions): express.Router {
  const router = express.Router();

  // Read fresh on each request, not cached — matches the "not stored, read
  // fresh each load" rule from ARCHITECTURE.md §4.
  router.get('/api/spec', (_req, res) => {
    res.json(loadSpec(options.spec));
  });

  // Static canvas UI bundle. Resolved via Node's own module resolution
  // against the installed `@get-enlace/ui` package (a real dependency, see
  // package.json) — not a relative path into this monorepo — so this works
  // identically whether `@get-enlace/ui` got here via an npm workspace
  // symlink (local dev) or a real `node_modules` install (anyone who
  // installs @get-enlace/express on its own). There's nothing to copy or
  // build into this package itself; the bundle lives wherever
  // @get-enlace/ui's own "files" field ships it (dist/), and it must
  // already be built (`npm run build --workspace @get-enlace/ui`) before
  // this resolves.
  const uiPackageJson = require.resolve('@get-enlace/ui/package.json');
  const uiDist = path.join(path.dirname(uiPackageJson), 'dist');
  router.use(express.static(uiDist));

  return router;
}
