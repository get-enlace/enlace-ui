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
  //   ENLACE_EXAMPLE_AI_BASE_URL  base URL of an OpenAI chat-completions-
  //                               compatible endpoint — the only wire shape
  //                               this adapter speaks (see EnlaceAiOptions
  //                               and aiProviders.ts). No default; AI stays
  //                               disabled entirely unless this is set.
  //   ENLACE_EXAMPLE_AI_API_KEY   optional — plenty of local/self-hosted
  //                               endpoints don't gate on a key at all.
  //   ENLACE_EXAMPLE_AI_MODEL     optional — left unset, the endpoint's own
  //                               default model is used.
  const aiBaseUrl = process.env.ENLACE_EXAMPLE_AI_BASE_URL;
  app.use(
    '/enlace',
    enlace({
      spec,
      ai: aiBaseUrl
        ? {
            enabled: true,
            baseUrl: aiBaseUrl,
            apiKey: process.env.ENLACE_EXAMPLE_AI_API_KEY,
            model: process.env.ENLACE_EXAMPLE_AI_MODEL,
          }
        : undefined,
    })
  );

  return app;
}
