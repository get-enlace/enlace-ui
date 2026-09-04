// Real end-to-end coverage of the AI-assist proxy routes added to
// examples/sample-api/enlace.ts (GET /api/ai/capabilities, POST
// /api/ai/complete) — an actual Express server, actual HTTP requests. The
// outbound call to the configured endpoint is always stubbed (see
// mockAiResponse below); this suite never hits a real LLM, in CI or
// anywhere else.
//
// "Disabled by default" coverage runs against the same shared server every
// other e2e file in this directory uses (see helpers.ts — no AI config is
// ever passed there). "Enabled" coverage spins up its own small,
// standalone instances instead, since AI config is only ever passed to
// enlace() at construction time, not read from an env var mid-test.
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { enlace } from '../../examples/sample-api/enlace.js';
import { spec } from '../../examples/sample-api/app.js';
import { E2E_BASE_URL, startTestServer, stopTestServer } from './helpers.js';

describe('AI assist — disabled by default (no ai option passed to enlace())', () => {
  beforeAll(startTestServer);
  afterAll(stopTestServer);

  it('GET /api/ai/capabilities reports disabled', async () => {
    const res = await fetch(`${E2E_BASE_URL}/enlace/api/ai/capabilities`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
  });

  it('POST /api/ai/complete 404s — the route genuinely does not exist for an operator who has not opted in', async () => {
    const res = await fetch(`${E2E_BASE_URL}/enlace/api/ai/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(404);
  });
});

const AI_TEST_PORT = 4124;
const AI_BASE_URL = `http://localhost:${AI_TEST_PORT}`;
const AI_UPSTREAM_URL = 'https://example-ai-endpoint.test/v1';

function mockAiResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AI assist — enabled (baseUrl + apiKey + model)', () => {
  let server: Server;
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const app = express();
    app.use(
      '/enlace',
      enlace({
        spec,
        ai: { enabled: true, baseUrl: AI_UPSTREAM_URL, apiKey: 'test-key', model: 'test-model' },
      })
    );
    server = app.listen(AI_TEST_PORT);
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(() => {
    // Stubs only the outbound provider call — every other fetch (this
    // test's own calls into AI_BASE_URL) passes through to the real
    // implementation.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith(AI_UPSTREAM_URL)) {
        expect(url).toBe(`${AI_UPSTREAM_URL}/chat/completions`);
        const headers = new Headers((init as RequestInit | undefined)?.headers);
        expect(headers.get('authorization')).toBe('Bearer test-key');
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body.model).toBe('test-model');
        return mockAiResponse('hello from the mock');
      }
      return realFetch(input as any, init);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /api/ai/capabilities reports the configured model', async () => {
    const res = await fetch(`${AI_BASE_URL}/enlace/api/ai/capabilities`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, model: 'test-model' });
  });

  it('POST /api/ai/complete 400s on a missing/malformed "messages" array', async () => {
    const res = await fetch(`${AI_BASE_URL}/enlace/api/ai/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: 'not-an-array' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/ai/complete forwards to the endpoint and returns its text, key never echoed back', async () => {
    const res = await fetch(`${AI_BASE_URL}/enlace/api/ai/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'suggest a value' }] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ content: 'hello from the mock' });
    expect(JSON.stringify(body)).not.toContain('test-key');
  });

  it('POST /api/ai/complete returns 502 when the provider call fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith(AI_UPSTREAM_URL)) {
        return new Response('rate limited', { status: 429 });
      }
      return realFetch(input as any, init);
    });

    const res = await fetch(`${AI_BASE_URL}/enlace/api/ai/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'suggest a value' }] }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('429');
  });
});

const AI_NO_AUTH_TEST_PORT = 4125;
const AI_NO_AUTH_BASE_URL = `http://localhost:${AI_NO_AUTH_TEST_PORT}`;
const AI_NO_AUTH_UPSTREAM_URL = 'http://localhost:11434/v1';

describe('AI assist — enabled (baseUrl only, no apiKey, no model)', () => {
  let server: Server;
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const app = express();
    app.use(
      '/enlace',
      // No apiKey, no model — both are genuinely optional (see enlace.ts's
      // aiIsUsable and aiProviders.ts's callAiProvider): plenty of local/
      // self-hosted endpoints don't gate on a key, and a single-model
      // endpoint doesn't need one specified.
      enlace({ spec, ai: { enabled: true, baseUrl: AI_NO_AUTH_UPSTREAM_URL } })
    );
    server = app.listen(AI_NO_AUTH_TEST_PORT);
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(() => {
    // Stubs only the outbound provider call — every other fetch (this
    // test's own calls into AI_NO_AUTH_BASE_URL) passes through to the
    // real implementation.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith(AI_NO_AUTH_UPSTREAM_URL)) {
        expect(url).toBe(`${AI_NO_AUTH_UPSTREAM_URL}/chat/completions`);
        // No Authorization header should be sent when apiKey is absent.
        const headers = new Headers((init as RequestInit | undefined)?.headers);
        expect(headers.has('authorization')).toBe(false);
        // No model field should be sent when model is absent.
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body.model).toBeUndefined();
        return mockAiResponse('hello from the local endpoint');
      }
      return realFetch(input as any, init);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /api/ai/capabilities reports enabled with model omitted', async () => {
    const res = await fetch(`${AI_NO_AUTH_BASE_URL}/enlace/api/ai/capabilities`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true });
  });

  it('POST /api/ai/complete forwards to the configured endpoint and returns its message content', async () => {
    const res = await fetch(`${AI_NO_AUTH_BASE_URL}/enlace/api/ai/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'suggest a value' }] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ content: 'hello from the local endpoint' });
  });
});
