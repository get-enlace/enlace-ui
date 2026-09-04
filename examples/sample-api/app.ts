// Local dev harness only — not part of any published package. Builds the
// Express app (sample API + the Enlace canvas adapter) without starting a
// listener, so both server.ts (the CLI entry point) and the e2e test suite
// (test/e2e/helpers.ts) can construct the exact same app instead of two
// slightly-different copies drifting apart.
import express, { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { enlace } from './enlace.js';
import { customersRouter } from './customers.js';
import { productsRouter } from './products.js';
import { ordersRouter } from './orders.js';
import { handleDemoLogin } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.join(__dirname, 'openapi.json');
export const spec = JSON.parse(readFileSync(specPath, 'utf-8'));

/**
 * Three CRUD resources with a real cross-reference (orders validates
 * customerId/productId against the other two), deliberately shaped for the
 * parallel-execution demo: create a customer (A) and, independently,
 * connect-then-create a product (C) — both scheduled after A but not
 * dependent on each other — then create an order (D) that maps fields from
 * both A and C. See README's "Try the parallel execution demo".
 *
 * POST /products is multipart/form-data (optional image) so the canvas can
 * exercise real FormData file uploads on a first-class resource.
 */
const sampleApiRouter = Router();
sampleApiRouter.use(customersRouter);
sampleApiRouter.use(productsRouter);
sampleApiRouter.use(ordersRouter);
// Not a resource, so deliberately not part of any *Router above — backs
// cookieAuth's demo login (see auth.ts's handleDemoLogin/requireCookie).
sampleApiRouter.get('/auth/demo-login', handleDemoLogin);

export function createApp() {
  const app = express();
  app.use(express.json());

  // The API under test — what the canvas's client-side chain execution
  // will actually call, directly from the browser (no server-side executor
  // in this adapter at all — see enlace.ts, a local copy of
  // @get-enlace/express's mount function).
  app.use(sampleApiRouter);

  // The Enlace canvas. Enlace only needs a valid OpenAPI document — it has
  // no dependency on Swagger UI (ARCHITECTURE.md §1). The optional Swagger
  // UI mount that demonstrates the two can ride along side by side lives
  // in server.ts, not here, since e2e tests don't need it and it'd be an
  // unused devDependency in this module.
  //
  // AI assist is opt-in and off by default. Read here (not inside enlace.ts
  // itself), mirroring ENLACE_EXAMPLE_NO_AUTH's pattern in auth.ts:
  // env-var wiring is this harness's own concern, not the adapter's.
  //
  //   ENLACE_EXAMPLE_AI_PROVIDER  'anthropic' (default) or 'ollama'
  //   ENLACE_EXAMPLE_AI_API_KEY   required for anthropic; optional for
  //                               ollama (only needed against a remote/
  //                               cloud-key-gated endpoint, not a local
  //                               signed-in daemon) — see EnlaceAiOptions.
  //   ENLACE_EXAMPLE_AI_MODEL     defaults to a current Sonnet-tier Claude
  //                               model for anthropic, or a gpt-oss cloud
  //                               model for ollama — not the cheapest tier
  //                               either way.
  //   ENLACE_EXAMPLE_AI_BASE_URL  ollama only — overrides the default local
  //                               http://localhost:11434.
  //
  // anthropic is only enabled when its required API key is present;
  // ollama's local/cloud-proxied mode needs no key at all, so it's enabled
  // by provider selection alone.
  const aiProvider = process.env.ENLACE_EXAMPLE_AI_PROVIDER === 'ollama' ? 'ollama' : 'anthropic';
  const aiApiKey = process.env.ENLACE_EXAMPLE_AI_API_KEY;
  const aiEnabled = aiProvider === 'ollama' || Boolean(aiApiKey);
  app.use(
    '/enlace',
    enlace({
      spec,
      ai: aiEnabled
        ? {
            enabled: true,
            provider: aiProvider,
            apiKey: aiApiKey,
            baseUrl: process.env.ENLACE_EXAMPLE_AI_BASE_URL,
            model:
              process.env.ENLACE_EXAMPLE_AI_MODEL ?? (aiProvider === 'ollama' ? 'gpt-oss:20b-cloud' : 'claude-sonnet-5'),
          }
        : undefined,
    })
  );

  return app;
}
