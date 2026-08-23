// Local copy of @get-enlace/express's mount function — that package now
// lives in the separate get-enlace/enlace-js repo (see ROADMAP.md), so
// this repo no longer depends on it (as a workspace or otherwise) for its
// own local dev/e2e testing. It's small enough that a copy is simpler and
// more self-contained than depending on the other repo's published
// package here, which would mean auth against GitHub Packages just to run
// `npm start` or the e2e suite. Keep this in sync with
// get-enlace/enlace-js's packages/enlace-express/src/index.ts by hand if
// that package's behavior ever changes — there's no other coupling
// between the two repos.
import express from 'express';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import path from 'node:path';
import { createRequire } from 'node:module';
import yaml from 'js-yaml';

const require = createRequire(import.meta.url);

export type SpecSource = string | Record<string, any>;

function loadSpec(source: SpecSource): Record<string, any> {
  if (typeof source !== 'string') return source;
  const raw = readFileSync(source, 'utf-8');
  const ext = extname(source);
  if (ext === '.yaml' || ext === '.yml') {
    return yaml.load(raw) as Record<string, any>;
  }
  return JSON.parse(raw);
}

export interface EnlaceOptions {
  /** A file/URL path or an already-parsed object — the only input this needs is a valid OpenAPI 3.x document, however it's produced or served. */
  spec: SpecSource;
}

/**
 * Mounts the Enlace canvas.
 *
 *   app.use('/enlace', enlace({ spec }))
 */
export function enlace(options: EnlaceOptions): express.Router {
  const router = express.Router();

  // Read fresh on each request, not cached — matches the "not stored, read
  // fresh each load" rule from ARCHITECTURE.md §4.
  router.get('/api/spec', (_req, res) => {
    res.json(loadSpec(options.spec));
  });

  // Static canvas UI bundle, resolved via Node's own module resolution
  // against the installed @get-enlace/ui package — must already be built
  // (`npm run build:ui`) before this resolves; see scripts/ensure-ui-built.mjs.
  const uiPackageJson = require.resolve('@get-enlace/ui/package.json');
  const uiDist = path.join(path.dirname(uiPackageJson), 'dist');
  router.use(express.static(uiDist));

  return router;
}
