import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeExecutionLevels,
  CyclicWorkflowError,
  executeChain,
  getByPath,
  topologicalSort,
} from './chainExecutor.js';
import { __clearCredentialTokenCacheForTests } from './credentials.js';
import type { Credential, Operation, RunEvent, WorkflowConnection, WorkflowNode } from '../types.js';

function node(id: string, fieldValues: WorkflowNode['fieldValues'] = {}): WorkflowNode {
  return { id, operationId: id, credentialId: null, fieldValues };
}

/** A minimal Operation whose `id` and `path` are both derived from `id`, so `operationsById.get(id)` and the mocked fetch's URL both key off the same identifier. */
function op(id: string, path: string): Operation {
  return { id, method: 'get', path, parameters: [], requestBodySchema: null, responseSchema: null };
}

function mockResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as unknown as Response;
}

describe('topologicalSort', () => {
  it('orders a node after the node it maps a field from', () => {
    const a = node('a');
    const b = node('b', {
      'body.orderId': { source: 'mapped', fromNodeId: 'a', fromResponseFieldPath: 'id' },
    });

    expect(topologicalSort([b, a]).map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('leaves independent nodes in their original relative order', () => {
    const a = node('a');
    const b = node('b');
    expect(topologicalSort([a, b]).map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('throws CyclicWorkflowError on a cyclic mapping', () => {
    const a = node('a', { x: { source: 'mapped', fromNodeId: 'b', fromResponseFieldPath: 'y' } });
    const b = node('b', { y: { source: 'mapped', fromNodeId: 'a', fromResponseFieldPath: 'x' } });

    expect(() => topologicalSort([a, b])).toThrow(CyclicWorkflowError);
  });

  it('orders via explicit connections even when a middle node carries no data (A -> B -> C, C maps from A)', () => {
    const a = node('a');
    const b = node('b'); // no field mapping at all — pure sequencing
    const c = node('c', { x: { source: 'mapped', fromNodeId: 'a', fromResponseFieldPath: 'id' } });
    const connections: WorkflowConnection[] = [
      { fromNodeId: 'a', toNodeId: 'b' },
      { fromNodeId: 'b', toNodeId: 'c' },
    ];

    // Passed in a shuffled order to prove the connections (not array order) drive the sort.
    expect(topologicalSort([c, a, b], connections).map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('throws CyclicWorkflowError on a cyclic explicit connection with no field mapping involved', () => {
    const a = node('a');
    const b = node('b');
    const connections: WorkflowConnection[] = [
      { fromNodeId: 'a', toNodeId: 'b' },
      { fromNodeId: 'b', toNodeId: 'a' },
    ];

    expect(() => topologicalSort([a, b], connections)).toThrow(CyclicWorkflowError);
  });
});

describe('computeExecutionLevels', () => {
  it('groups "run A, then B+C in parallel, then D (needs A and C, not B)"', () => {
    const a = node('a');
    const b = node('b'); // connected after A, but no data dependency
    const c = node('c'); // also connected after A only — same level as B
    const d = node('d', {
      x: { source: 'mapped', fromNodeId: 'a', fromResponseFieldPath: 'id' },
      y: { source: 'mapped', fromNodeId: 'c', fromResponseFieldPath: 'id' },
    });
    const connections: WorkflowConnection[] = [
      { fromNodeId: 'a', toNodeId: 'b' },
      { fromNodeId: 'a', toNodeId: 'c' },
    ];

    const levels = computeExecutionLevels([a, b, c, d], connections);
    expect(levels.map((level) => level.map((n) => n.id))).toEqual([['a'], ['b', 'c'], ['d']]);
  });
});

describe('executeChain', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __clearCredentialTokenCacheForTests();
  });

  it('resolves path/query/header/body field sections, including a value mapped from a prior step', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(201, { id: 'order-1' }))
      .mockResolvedValueOnce(mockResponse(200, { id: 'order-1', status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    const createOrder: Operation = {
      id: 'POST /orders',
      method: 'post',
      path: '/orders',
      parameters: [],
      requestBodySchema: { type: 'object', properties: { item: { type: 'string' } } },
      responseSchema: null,
    };
    const getOrder: Operation = {
      id: 'GET /orders/{id}',
      method: 'get',
      path: '/orders/{id}',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBodySchema: null,
      responseSchema: null,
    };

    const n1: WorkflowNode = {
      id: 'n1',
      operationId: 'POST /orders',
      credentialId: null,
      fieldValues: {
        'body.item': { source: 'static', value: 'Widget' },
        'header.x-trace-id': { source: 'static', value: 'abc123' },
      },
    };
    const n2: WorkflowNode = {
      id: 'n2',
      operationId: 'GET /orders/{id}',
      credentialId: null,
      fieldValues: {
        'path.id': { source: 'mapped', fromNodeId: 'n1', fromResponseFieldPath: 'id' },
      },
    };
    const workflow = { nodes: [n1, n2], connections: [] };

    const operationsById = new Map([
      ['POST /orders', createOrder],
      ['GET /orders/{id}', getOrder],
    ]);

    const result = await executeChain(workflow, operationsById, new Map<string, Credential>(), {
      baseUrl: 'http://example.test',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [firstUrl, firstInit] = fetchMock.mock.calls[0];
    expect(firstUrl).toBe('http://example.test/orders');
    expect(firstInit.headers['x-trace-id']).toBe('abc123');
    expect(JSON.parse(firstInit.body)).toEqual({ item: 'Widget' });

    const [secondUrl] = fetchMock.mock.calls[1];
    expect(secondUrl).toBe('http://example.test/orders/order-1');

    expect(result.steps).toHaveLength(2);
    expect(result.steps[1].response?.body).toEqual({ id: 'order-1', status: 'ok' });
  });

  it('runs independent nodes within the same level concurrently, not sequentially', async () => {
    let active = 0;
    let maxActive = 0;
    const fetchMock = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      return mockResponse(200, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      responseSchema: null,
    };

    const a: WorkflowNode = { id: 'a', operationId: 'GET /noop', credentialId: null, fieldValues: {} };
    const b: WorkflowNode = { id: 'b', operationId: 'GET /noop', credentialId: null, fieldValues: {} };
    const c: WorkflowNode = { id: 'c', operationId: 'GET /noop', credentialId: null, fieldValues: {} };
    const connections: WorkflowConnection[] = [
      { fromNodeId: 'a', toNodeId: 'b' },
      { fromNodeId: 'a', toNodeId: 'c' },
    ];

    await executeChain(
      { nodes: [a, b, c], connections },
      new Map([['GET /noop', noop]]),
      new Map<string, Credential>(),
      { baseUrl: 'http://example.test' }
    );

    // b and c are both in the same level (level 1, after a) — if they ran
    // sequentially, "active" would never exceed 1 concurrently in flight.
    expect(maxActive).toBeGreaterThanOrEqual(2);
  });

  it('sends a bearer Authorization header for a node with a credential set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      responseSchema: null,
    };
    const a: WorkflowNode = { id: 'a', operationId: 'GET /noop', credentialId: 'cred-1', fieldValues: {} };
    const credentialsById = new Map<string, Credential>([
      ['cred-1', { id: 'cred-1', name: 'Test', type: 'bearer', token: 'secret-token' }],
    ]);

    await executeChain(
      { nodes: [a], connections: [] },
      new Map([['GET /noop', noop]]),
      credentialsById,
      { baseUrl: 'http://example.test' }
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer secret-token');
  });

  it('sends a Basic Authorization header for a basic credential', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      responseSchema: null,
    };
    const a: WorkflowNode = { id: 'a', operationId: 'GET /noop', credentialId: 'cred-1', fieldValues: {} };
    const credentialsById = new Map<string, Credential>([
      ['cred-1', { id: 'cred-1', name: 'Test', type: 'basic', username: 'alice', password: 'hunter2' }],
    ]);

    await executeChain(
      { nodes: [a], connections: [] },
      new Map([['GET /noop', noop]]),
      credentialsById,
      { baseUrl: 'http://example.test' }
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe(`Basic ${btoa('alice:hunter2')}`);
  });

  it('sends an apiKey credential as a query param when `in` is "query"', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      responseSchema: null,
    };
    const a: WorkflowNode = { id: 'a', operationId: 'GET /noop', credentialId: 'cred-1', fieldValues: {} };
    const credentialsById = new Map<string, Credential>([
      ['cred-1', { id: 'cred-1', name: 'Test', type: 'apiKey', paramName: 'apiKey', in: 'query', key: 'secret-key' }],
    ]);

    await executeChain(
      { nodes: [a], connections: [] },
      new Map([['GET /noop', noop]]),
      credentialsById,
      { baseUrl: 'http://example.test' }
    );

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://example.test/noop?apiKey=secret-key');
  });

  it('sets credentials: "include" on the actual fetch() call for a popup_login/cookie credential, with no headers/query injected', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      responseSchema: null,
    };
    const a: WorkflowNode = { id: 'a', operationId: 'GET /noop', credentialId: 'cred-1', fieldValues: {} };
    const credentialsById = new Map<string, Credential>([
      [
        'cred-1',
        { id: 'cred-1', name: 'Test', type: 'popup_login', loginUrl: 'https://app.test/auth/github' },
      ],
    ]);

    await executeChain(
      { nodes: [a], connections: [] },
      new Map([['GET /noop', noop]]),
      credentialsById,
      { baseUrl: 'http://example.test' }
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe('include');
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('leaves fetch()\'s credentials option unset (its own default) for a node with no credential, or a non-cookie one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      responseSchema: null,
    };
    const a: WorkflowNode = { id: 'a', operationId: 'GET /noop', credentialId: null, fieldValues: {} };

    await executeChain(
      { nodes: [a], connections: [] },
      new Map([['GET /noop', noop]]),
      new Map<string, Credential>(),
      { baseUrl: 'http://example.test' }
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBeUndefined();
  });

  it('fetches an oauth2 password-grant token and sends it as a Bearer header', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === 'http://auth.test/token') {
        return Promise.resolve(mockResponse(200, { access_token: 'issued-token', expires_in: 3600 }));
      }
      return Promise.resolve(mockResponse(200, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      responseSchema: null,
    };
    const a: WorkflowNode = { id: 'a', operationId: 'GET /noop', credentialId: 'cred-1', fieldValues: {} };
    const credentialsById = new Map<string, Credential>([
      [
        'cred-1',
        {
          id: 'cred-1',
          name: 'Test',
          type: 'oauth2_password',
          tokenUrl: 'http://auth.test/token',
          username: 'alice',
          password: 'hunter2',
        },
      ],
    ]);

    await executeChain(
      { nodes: [a], connections: [] },
      new Map([['GET /noop', noop]]),
      credentialsById,
      { baseUrl: 'http://example.test' }
    );

    const [, init] = fetchMock.mock.calls.find(([url]) => url === 'http://example.test/noop')!;
    expect(init.headers.Authorization).toBe('Bearer issued-token');
  });

  it('fetches and caches an oauth2 client-credentials token, reusing it across nodes', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === 'http://auth.test/token') {
        return Promise.resolve(mockResponse(200, { access_token: 'issued-token', expires_in: 3600 }));
      }
      return Promise.resolve(mockResponse(200, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      responseSchema: null,
    };
    // Two independent nodes (no connection between them, same level) sharing
    // one credential — the token endpoint should be hit once, not twice.
    const a: WorkflowNode = { id: 'a', operationId: 'GET /noop', credentialId: 'cred-1', fieldValues: {} };
    const b: WorkflowNode = { id: 'b', operationId: 'GET /noop', credentialId: 'cred-1', fieldValues: {} };
    const credentialsById = new Map<string, Credential>([
      [
        'cred-1',
        {
          id: 'cred-1',
          name: 'Test',
          type: 'oauth2_clientCredentials',
          tokenUrl: 'http://auth.test/token',
          clientId: 'client-id',
          clientSecret: 'client-secret',
        },
      ],
    ]);

    await executeChain(
      { nodes: [a, b], connections: [] },
      new Map([['GET /noop', noop]]),
      credentialsById,
      { baseUrl: 'http://example.test' }
    );

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => url === 'http://auth.test/token');
    expect(tokenCalls).toHaveLength(1);

    const requestCalls = fetchMock.mock.calls.filter(([url]) => url !== 'http://auth.test/token');
    for (const [, init] of requestCalls) {
      expect(init.headers.Authorization).toBe('Bearer issued-token');
    }
  });

  it('records a failed oauth2 token fetch as a normal failed RunStep, not an uncaught rejection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(401, {}));
    vi.stubGlobal('fetch', fetchMock);

    const noop: Operation = {
      id: 'GET /noop',
      method: 'get',
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      responseSchema: null,
    };
    const a: WorkflowNode = { id: 'a', operationId: 'GET /noop', credentialId: 'cred-1', fieldValues: {} };
    const credentialsById = new Map<string, Credential>([
      [
        'cred-1',
        {
          id: 'cred-1',
          name: 'Test',
          type: 'oauth2_clientCredentials',
          tokenUrl: 'http://auth.test/token',
          clientId: 'client-id',
          clientSecret: 'client-secret',
        },
      ],
    ]);

    const result = await executeChain(
      { nodes: [a], connections: [] },
      new Map([['GET /noop', noop]]),
      credentialsById,
      { baseUrl: 'http://example.test' }
    );

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].error).toMatch(/token request.*failed with status 401/);
  });

  it('resolves a tag chip embedded in an ordinary Form-mode static field, even with bodyMode back to "form"', async () => {
    // Reproduces a real reported scenario: insert a tag chip in Raw JSON
    // mode (whole-match), then type extra text right before it ("str"),
    // making it embedded — then switch to Form anyway despite the "may
    // lose custom JSON structure" warning. The resulting static field
    // holds the literal "str{{enlace:tag1}}" text; it must still resolve
    // at request time using the tag config `rawBody` still carries, not
    // get sent to the target API unresolved.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(201, { id: 'cust-1' }))
      .mockResolvedValueOnce(mockResponse(201, {}));
    vi.stubGlobal('fetch', fetchMock);

    const createCustomer: Operation = {
      id: 'POST /customers',
      method: 'post',
      path: '/customers',
      parameters: [],
      requestBodySchema: { type: 'object', properties: { name: { type: 'string' } } },
      responseSchema: { type: 'object', properties: { id: { type: 'string' } } },
    };
    const createOrder: Operation = {
      id: 'POST /orders',
      method: 'post',
      path: '/orders',
      parameters: [],
      requestBodySchema: { type: 'object', properties: { note: { type: 'string' } } },
      responseSchema: null,
    };

    const a: WorkflowNode = {
      id: 'a',
      operationId: 'POST /customers',
      credentialId: null,
      fieldValues: { 'body.name': { source: 'static', value: 'Ada' } },
    };
    const b: WorkflowNode = {
      id: 'b',
      operationId: 'POST /orders',
      credentialId: null,
      bodyMode: 'form',
      fieldValues: { 'body.note': { source: 'static', value: 'str{{enlace:tag1}}' } },
      rawBody: {
        template: '{"note":"str{{enlace:tag1}}"}',
        tags: { tag1: { id: 'tag1', type: 'response_body', sourceNodeId: 'a', jsonPath: 'id' } },
      },
    };

    const result = await executeChain(
      { nodes: [a, b], connections: [{ fromNodeId: 'a', toNodeId: 'b' }] },
      new Map([
        ['POST /customers', createCustomer],
        ['POST /orders', createOrder],
      ]),
      new Map(),
      { baseUrl: 'http://example.test' }
    );

    expect(result.steps.every((s) => !s.error)).toBe(true);
    const [, orderInit] = fetchMock.mock.calls[1];
    expect(JSON.parse(orderInit.body)).toEqual({ note: 'strcust-1' });
  });

  it('fires a node the instant its own dependency settles, without waiting for an unrelated slower sibling in the same wave', async () => {
    // a -> b (slow) and a -> c (fast) are independent siblings once a
    // completes; d depends only on c. d must fire right after c settles,
    // not wait around for b — the exact fan-out case level-batching got
    // wrong (see engine/chainExecutor.ts's executeChain doc comment).
    const callOrder: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      callOrder.push(`start:${path}`);
      const delay = path === '/b' ? 40 : 5;
      await new Promise((resolve) => setTimeout(resolve, delay));
      callOrder.push(`end:${path}`);
      return mockResponse(200, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    const a = node('a');
    const b = node('b');
    const c = node('c');
    const d = node('d');
    const connections: WorkflowConnection[] = [
      { fromNodeId: 'a', toNodeId: 'b' },
      { fromNodeId: 'a', toNodeId: 'c' },
      { fromNodeId: 'c', toNodeId: 'd' },
    ];
    const operationsById = new Map([
      ['a', op('a', '/a')],
      ['b', op('b', '/b')],
      ['c', op('c', '/c')],
      ['d', op('d', '/d')],
    ]);

    await executeChain({ nodes: [a, b, c, d], connections }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
    });

    expect(callOrder.indexOf('start:/d')).toBeGreaterThan(-1);
    expect(callOrder.indexOf('start:/d')).toBeLessThan(callOrder.indexOf('end:/b'));
  });

  it('halts admission of new nodes after a failure, but lets an already-in-flight sibling complete and never fires a node only reachable after the halt', async () => {
    // a -> b (slow, succeeds) and a -> c (fast, fails) are independent
    // siblings; e depends only on b, not c at all. e's own dependency (b)
    // does succeed, but by the time b finishes, c has already failed —
    // e must still never fire, proving the halt blocks *all* new
    // admissions, not just nodes downstream of the failing one.
    const fetchMock = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === '/b') {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return mockResponse(200, {});
      }
      if (path === '/c') return mockResponse(500, {});
      return mockResponse(200, {}); // /a, and /e if it ever (wrongly) fired
    });
    vi.stubGlobal('fetch', fetchMock);

    const a = node('a');
    const b = node('b');
    const c = node('c');
    const e = node('e');
    const connections: WorkflowConnection[] = [
      { fromNodeId: 'a', toNodeId: 'b' },
      { fromNodeId: 'a', toNodeId: 'c' },
      { fromNodeId: 'b', toNodeId: 'e' },
    ];
    const operationsById = new Map([
      ['a', op('a', '/a')],
      ['b', op('b', '/b')],
      ['c', op('c', '/c')],
      ['e', op('e', '/e')],
    ]);

    const result = await executeChain({ nodes: [a, b, c, e], connections }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
    });

    expect(result.steps.map((s) => s.nodeId).sort()).toEqual(['a', 'b', 'c']);
    expect(result.steps.find((s) => s.nodeId === 'b')?.error).toBeUndefined();
    expect(result.steps.find((s) => s.nodeId === 'c')?.error).toMatch(/status 500/);
  });

  it('emits an in-flight event before a settle event for each node, with independent same-wave nodes\' in-flight events both landing before either settles', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const a = node('a');
    const b = node('b');
    const operationsById = new Map([
      ['a', op('a', '/noop')],
      ['b', op('b', '/noop')],
    ]);

    const events: RunEvent[] = [];
    await executeChain({ nodes: [a, b], connections: [] }, operationsById, new Map(), {
      baseUrl: 'http://example.test',
      onEvent: (event) => events.push(event),
    });

    const statuses = events.map((e) => e.status);
    const lastInFlightIndex = statuses.lastIndexOf('in-flight');
    const firstSettleIndex = statuses.findIndex((s) => s === 'completed' || s === 'failed');
    expect(events.filter((e) => e.status === 'in-flight')).toHaveLength(2);
    expect(events.filter((e) => e.status === 'completed')).toHaveLength(2);
    expect(lastInFlightIndex).toBeLessThan(firstSettleIndex);

    for (const id of ['a', 'b']) {
      const inFlightIndex = events.findIndex((e) => e.nodeId === id && e.status === 'in-flight');
      const settledIndex = events.findIndex((e) => e.nodeId === id && e.status === 'completed');
      expect(inFlightIndex).toBeGreaterThanOrEqual(0);
      expect(settledIndex).toBeGreaterThan(inFlightIndex);
    }

    for (const event of events) {
      if (event.status === 'completed' || event.status === 'failed') {
        expect(event.step).toBeDefined();
      } else {
        expect(event.step).toBeUndefined();
      }
    }
  });
});

describe('getByPath', () => {
  it('resolves nested and array paths', () => {
    const obj = { order: { items: [{ id: 'abc' }] } };
    expect(getByPath(obj, 'order.items[0].id')).toBe('abc');
  });

  it('returns undefined for missing paths without throwing', () => {
    expect(getByPath({ a: 1 }, 'a.b.c')).toBeUndefined();
    expect(getByPath(null, 'a.b')).toBeUndefined();
  });
});
