// Real end-to-end coverage of the AI-assist proxy routes added to
// examples/sample-api/enlace.ts (GET /api/ai/capabilities, POST
// /api/ai/complete) — an actual Express server, actual HTTP requests. The
// outbound call to the configured LLM provider is always stubbed (see
// mockAnthropicResponse below); this suite never hits a real LLM, in CI or
// anywhere else.
//
// "Disabled by default" coverage runs against the same shared server every
// other e2e file in this directory uses (see helpers.ts — no AI config is
// ever passed there). "Enabled" coverage spins up its own small,
// standalone instance instead, since AI config is only ever passed to
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

function mockAnthropicResponse(text: string, status = 200): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AI assist — enabled', () => {
  let server: Server;
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const app = express();
    app.use(
      '/enlace',
      enlace({
        spec,
        ai: { enabled: true, provider: 'anthropic', apiKey: 'test-key', model: 'test-model' },
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
      if (url.includes('api.anthropic.com')) {
        return mockAnthropicResponse('hello from the mock');
      }
      return realFetch(input as any, init);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /api/ai/capabilities reports the configured provider/model', async () => {
    const res = await fetch(`${AI_BASE_URL}/enlace/api/ai/capabilities`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, provider: 'anthropic', model: 'test-model' });
  });

  it('POST /api/ai/complete 400s on a missing/malformed "messages" array', async () => {
    const res = await fetch(`${AI_BASE_URL}/enlace/api/ai/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: 'not-an-array' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/ai/complete forwards to the provider and returns its text, key never echoed back', async () => {
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
      if (url.includes('api.anthropic.com')) {
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

const OLLAMA_TEST_PORT = 4125;
const OLLAMA_BASE_URL = `http://localhost:${OLLAMA_TEST_PORT}`;

function mockOllamaResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ message: { role: 'assistant', content } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AI assist — enabled (ollama, local/cloud-proxied, no apiKey)', () => {
  let server: Server;
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const app = express();
    app.use(
      '/enlace',
      // No apiKey at all — local Ollama mode never needs a BYOK secret
      // (see enlace.ts's aiIsUsable and aiProviders.ts's callOllama).
      enlace({ spec, ai: { enabled: true, provider: 'ollama', model: 'gpt-oss:20b-cloud' } })
    );
    server = app.listen(OLLAMA_TEST_PORT);
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
    // test's own calls into OLLAMA_BASE_URL) passes through to the real
    // implementation.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('localhost:11434')) {
        // No Authorization header should be sent when apiKey is absent.
        const headers = new Headers((init as RequestInit | undefined)?.headers);
        expect(headers.has('authorization')).toBe(false);
        return mockOllamaResponse('hello from ollama');
      }
      return realFetch(input as any, init);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /api/ai/capabilities reports the configured provider/model', async () => {
    const res = await fetch(`${OLLAMA_BASE_URL}/enlace/api/ai/capabilities`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, provider: 'ollama', model: 'gpt-oss:20b-cloud' });
  });

  it('POST /api/ai/complete forwards to the local Ollama daemon and returns its message content', async () => {
    const res = await fetch(`${OLLAMA_BASE_URL}/enlace/api/ai/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'suggest a value' }] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ content: 'hello from ollama' });
  });
});
