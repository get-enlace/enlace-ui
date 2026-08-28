import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowStore } from './workflowStore.js';

// Reset to a clean slate before each test — zustand stores are module-level
// singletons, so state otherwise leaks across tests.
beforeEach(() => {
  useWorkflowStore.setState({
    nodes: [],
    connections: [],
    nodePositions: {},
    selectedNodeId: null,
    credentials: [],
    declaredCredentials: [],
    operations: [],
    baseUrl: null,
    runResult: null,
    stepStatusByNodeId: {},
    isRunning: false,
    error: null,
  });
});

describe('removeNode', () => {
  it('removes the node itself, its position, and any connections referencing it (either direction)', () => {
    const { addNode, connectNodes, removeNode } = useWorkflowStore.getState();
    const a = addNode('GET /a', { x: 0, y: 0 });
    const b = addNode('GET /b', { x: 100, y: 0 });
    connectNodes(a, b);

    removeNode(a);

    const state = useWorkflowStore.getState();
    expect(state.nodes.map((n) => n.id)).toEqual([b]);
    expect(state.nodePositions[a]).toBeUndefined();
    expect(state.connections).toEqual([]);
  });

  it("resets another node's field mapped from the deleted node to an empty static value, instead of a dangling reference", () => {
    const { addNode, setFieldValue, removeNode } = useWorkflowStore.getState();
    const a = addNode('GET /a');
    const b = addNode('GET /b');
    setFieldValue(b, 'path.id', { source: 'mapped', fromNodeId: a, fromResponseFieldPath: 'id' });

    removeNode(a);

    const nodeB = useWorkflowStore.getState().nodes.find((n) => n.id === b)!;
    expect(nodeB.fieldValues['path.id']).toEqual({ source: 'static', value: '' });
  });

  it('clears selectedNodeId if the removed node was selected', () => {
    const { addNode, selectNode, removeNode } = useWorkflowStore.getState();
    const a = addNode('GET /a');
    selectNode(a);

    removeNode(a);

    expect(useWorkflowStore.getState().selectedNodeId).toBeNull();
  });

  it('leaves an unrelated selected node alone', () => {
    const { addNode, selectNode, removeNode } = useWorkflowStore.getState();
    const a = addNode('GET /a');
    const b = addNode('GET /b');
    selectNode(b);

    removeNode(a);

    expect(useWorkflowStore.getState().selectedNodeId).toBe(b);
  });
});

describe('connectNodes / disconnectNodes', () => {
  it('disconnectNodes removes just the one matching connection, leaving others intact', () => {
    const { addNode, connectNodes, disconnectNodes } = useWorkflowStore.getState();
    const a = addNode('GET /a');
    const b = addNode('GET /b');
    const c = addNode('GET /c');
    connectNodes(a, b);
    connectNodes(a, c);

    disconnectNodes(a, b);

    expect(useWorkflowStore.getState().connections).toEqual([{ fromNodeId: a, toNodeId: c }]);
  });

  it('disconnectNodes is a no-op when no such connection exists', () => {
    const { addNode, connectNodes, disconnectNodes } = useWorkflowStore.getState();
    const a = addNode('GET /a');
    const b = addNode('GET /b');
    connectNodes(a, b);

    disconnectNodes(b, a); // reversed direction — not the same edge

    expect(useWorkflowStore.getState().connections).toEqual([{ fromNodeId: a, toNodeId: b }]);
  });

  it("doesn't touch fieldValues — a connection is an ordering edge only, separate from field mapping", () => {
    const { addNode, connectNodes, disconnectNodes, setFieldValue } = useWorkflowStore.getState();
    const a = addNode('GET /a');
    const b = addNode('GET /b');
    connectNodes(a, b);
    setFieldValue(b, 'path.id', { source: 'mapped', fromNodeId: a, fromResponseFieldPath: 'id' });

    disconnectNodes(a, b);

    expect(useWorkflowStore.getState().connections).toEqual([]);
    expect(useWorkflowStore.getState().nodes.find((n) => n.id === b)!.fieldValues['path.id']).toEqual({
      source: 'mapped',
      fromNodeId: a,
      fromResponseFieldPath: 'id',
    });
  });
});

describe('addCredential / updateCredential / removeCredential', () => {
  it('assigns a fresh id to a new credential', () => {
    const { addCredential } = useWorkflowStore.getState();
    addCredential({ name: 'staging', type: 'bearer', token: 'secret' });

    const credentials = useWorkflowStore.getState().credentials;
    expect(credentials).toHaveLength(1);
    expect(credentials[0]).toMatchObject({ name: 'staging', type: 'bearer', token: 'secret' });
    expect(credentials[0].id).toBeTruthy();
  });

  it('removes the credential and unsets it from any node still referencing it, instead of a dangling credentialId', () => {
    const { addNode, addCredential, setCredential, removeCredential } = useWorkflowStore.getState();
    const a = addNode('GET /a');
    const b = addNode('GET /b');
    addCredential({ name: 'staging', type: 'bearer', token: 'secret' });
    const credentialId = useWorkflowStore.getState().credentials[0].id;
    setCredential(a, credentialId);
    setCredential(b, credentialId);

    removeCredential(credentialId);

    const state = useWorkflowStore.getState();
    expect(state.credentials).toEqual([]);
    expect(state.nodes.find((n) => n.id === a)?.credentialId).toBeNull();
    expect(state.nodes.find((n) => n.id === b)?.credentialId).toBeNull();
  });

  it('leaves an unrelated node\'s credential alone', () => {
    const { addNode, addCredential, setCredential, removeCredential } = useWorkflowStore.getState();
    const a = addNode('GET /a');
    const b = addNode('GET /b');
    addCredential({ name: 'staging', type: 'bearer', token: 'secret' });
    addCredential({ name: 'prod', type: 'bearer', token: 'secret2' });
    const [staging, prod] = useWorkflowStore.getState().credentials;
    setCredential(a, staging.id);
    setCredential(b, prod.id);

    removeCredential(staging.id);

    const state = useWorkflowStore.getState();
    expect(state.credentials).toEqual([prod]);
    expect(state.nodes.find((n) => n.id === a)?.credentialId).toBeNull();
    expect(state.nodes.find((n) => n.id === b)?.credentialId).toBe(prod.id);
  });

  it('updateCredential replaces a credential\'s fields in place, keeping its id', () => {
    const { addNode, addCredential, setCredential, updateCredential } = useWorkflowStore.getState();
    const a = addNode('GET /a');
    addCredential({ name: 'staging', type: 'bearer', token: 'secret' });
    const { id } = useWorkflowStore.getState().credentials[0];
    setCredential(a, id);

    updateCredential(id, { name: 'staging-renamed', type: 'bearer', token: 'new-secret' });

    const state = useWorkflowStore.getState();
    expect(state.credentials).toEqual([{ id, name: 'staging-renamed', type: 'bearer', token: 'new-secret' }]);
    // The node's reference is still valid — the id never changed.
    expect(state.nodes.find((n) => n.id === a)?.credentialId).toBe(id);
  });

  it('updateCredential can change a credential\'s type entirely, not just its field values', () => {
    const { addCredential, updateCredential } = useWorkflowStore.getState();
    addCredential({ name: 'staging', type: 'bearer', token: 'secret' });
    const { id } = useWorkflowStore.getState().credentials[0];

    updateCredential(id, { name: 'staging', type: 'basic', username: 'alice', password: 'hunter2' });

    expect(useWorkflowStore.getState().credentials).toEqual([
      { id, name: 'staging', type: 'basic', username: 'alice', password: 'hunter2' },
    ]);
  });

  it('updateCredential leaves other credentials untouched', () => {
    const { addCredential, updateCredential } = useWorkflowStore.getState();
    addCredential({ name: 'staging', type: 'bearer', token: 'secret' });
    addCredential({ name: 'prod', type: 'bearer', token: 'secret2' });
    const [staging, prod] = useWorkflowStore.getState().credentials;

    updateCredential(staging.id, { name: 'staging-renamed', type: 'bearer', token: 'new-secret' });

    expect(useWorkflowStore.getState().credentials).toEqual([
      { id: staging.id, name: 'staging-renamed', type: 'bearer', token: 'new-secret' },
      prod,
    ]);
  });
});

describe('run', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("updates runResult.steps and stepStatusByNodeId incrementally as each node settles, not only once the whole run finishes", async () => {
    const noop = {
      id: 'GET /noop',
      method: 'get' as const,
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      responseSchema: null,
    };
    useWorkflowStore.setState({ baseUrl: 'http://example.test', operations: [noop] });
    const { addNode, run } = useWorkflowStore.getState();
    const a = addNode('GET /noop');
    const b = addNode('GET /noop');

    let resolveB: (() => void) | undefined;
    const fetchMock = vi
      .fn()
      // a settles immediately.
      .mockResolvedValueOnce({ status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({}) })
      // b stays pending until resolveB() is called below.
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveB = () =>
              resolve({ status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({}) });
          })
      );
    vi.stubGlobal('fetch', fetchMock);

    const runPromise = run();

    // Let every microtask that can run without b resolving actually run,
    // so a's settle event has landed in the store but b's hasn't.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const mid = useWorkflowStore.getState();
    expect(mid.isRunning).toBe(true);
    expect(mid.runResult?.steps.map((s) => s.nodeId)).toEqual([a]);
    expect(mid.stepStatusByNodeId[a]).toBe('completed');
    expect(mid.stepStatusByNodeId[b]).toBe('in-flight');

    resolveB!();
    await runPromise;

    const final = useWorkflowStore.getState();
    expect(final.isRunning).toBe(false);
    expect(final.runResult?.steps.map((s) => s.nodeId).sort()).toEqual([a, b].sort());
    expect(final.stepStatusByNodeId[a]).toBe('completed');
    expect(final.stepStatusByNodeId[b]).toBe('completed');
  });
});

describe('loadOperations', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('populates declaredCredentials from the spec\'s components.securitySchemes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          paths: {},
          servers: [{ url: 'http://x' }],
          components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
        }),
      })
    );

    await useWorkflowStore.getState().loadOperations();

    const declared = useWorkflowStore.getState().declaredCredentials;
    expect(declared).toHaveLength(1);
    expect(declared[0]).toMatchObject({ schemeName: 'bearerAuth', template: { type: 'bearer' } });
  });

  it('leaves declaredCredentials empty when the spec declares no securitySchemes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ paths: {}, servers: [{ url: 'http://x' }] }) })
    );

    await useWorkflowStore.getState().loadOperations();

    expect(useWorkflowStore.getState().declaredCredentials).toEqual([]);
  });
});
