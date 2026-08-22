// Real end-to-end coverage of @get-enlace/express itself: an actual
// Express server, actual HTTP requests over the network stack. This
// adapter's job is deliberately small now (spec passthrough + static UI
// serving — no execution endpoint at all), so that's all this proves.
// The parallel-execution / cyclic-dependency / referential-validation
// scenarios previously covered here now live in
// packages/enlace-ui/src/engine/chainExecutor.test.ts, since that's where
// execution actually runs (client-side, mocked fetch, no live server
// needed to prove it).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { E2E_BASE_URL, startTestServer, stopTestServer } from './helpers.js';

beforeAll(startTestServer);
afterAll(stopTestServer);

describe('GET /enlace/api/spec', () => {
  it('passes through the raw OpenAPI document, unparsed, over real HTTP', async () => {
    const res = await fetch(`${E2E_BASE_URL}/enlace/api/spec`);
    expect(res.status).toBe(200);

    const spec = (await res.json()) as Record<string, any>;
    expect(spec.servers).toEqual([{ url: 'http://localhost:4000' }]);
    expect(spec.paths).toHaveProperty('/customers');
    expect(spec.paths).toHaveProperty('/products');
    expect(spec.paths).toHaveProperty('/orders');
  });
});

describe('static UI bundle', () => {
  it('serves the built canvas at /enlace/', async () => {
    const res = await fetch(`${E2E_BASE_URL}/enlace/`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<div id="root">');
  });
});
