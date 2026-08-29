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
  app.use('/enlace', enlace({ spec }));

  return app;
}
