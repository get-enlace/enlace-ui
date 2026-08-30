import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectionKey } from '../engine/chainExecutor.js';
import { useWorkflowStore } from './workflowStore.js';
import { serializeCollection } from '../utils/workflowDocument.js';

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
    specInfo: null,
    runResult: null,
    stepStatusByNodeId: {},
    armedBreakpoints: new Set(),
    previewRequestByNodeId: {},
    activeControl: null,
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

  it('disconnectNodes also disarms a breakpoint on that exact connection — same dangling-reference cleanup as removeNode', () => {
    const { addNode, connectNodes, disconnectNodes, toggleBreakpoint } = useWorkflowStore.getState();
    const a = addNode('GET /a');
    const b = addNode('GET /b');
    connectNodes(a, b);
    toggleBreakpoint(a, b);
    expect(useWorkflowStore.getState().armedBreakpoints.size).toBe(1);

    disconnectNodes(a, b);

    expect(useWorkflowStore.getState().armedBreakpoints.size).toBe(0);
  });
});

describe('toggleBreakpoint', () => {
  it('arms on the first call, disarms on the second, for that exact fromNodeId/toNodeId pair only', () => {
    const { addNode, toggleBreakpoint } = useWorkflowStore.getState();
    const a = addNode('GET /a');
    const b = addNode('GET /b');
    const c = addNode('GET /c');

    toggleBreakpoint(a, b);
    expect(useWorkflowStore.getState().armedBreakpoints).toEqual(new Set([connectionKey(a, b)]));

    toggleBreakpoint(a, c);
    expect(useWorkflowStore.getState().armedBreakpoints.size).toBe(2);

    toggleBreakpoint(a, b);
    expect(useWorkflowStore.getState().armedBreakpoints.size).toBe(1);
  });
});

describe('continueExecution / stepNode / stopExecution', () => {
  it('are no-ops when no run is in progress (activeControl is null)', () => {
    const { continueExecution, stepNode, stopExecution } = useWorkflowStore.getState();
    expect(() => continueExecution()).not.toThrow();
    expect(() => stepNode('some-node')).not.toThrow();
    expect(() => stopExecution()).not.toThrow();
  });

  it('forward to whatever activeControl currently holds', () => {
    const continueSpy = vi.fn();
    const stepSpy = vi.fn();
    const stopSpy = vi.fn();
    useWorkflowStore.setState({ activeControl: { continue: continueSpy, step: stepSpy, stop: stopSpy } });

    const { continueExecution, stepNode, stopExecution } = useWorkflowStore.getState();
    continueExecution();
    stepNode('node-1');
    stopExecution();

    expect(continueSpy).toHaveBeenCalled();
    expect(stepSpy).toHaveBeenCalledWith('node-1');
    expect(stopSpy).toHaveBeenCalled();
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

  it('run({ useBreakpoints: true }) pauses at an armed breakpoint, populates a preview, and resumes via continueExecution', async () => {
    const noop = {
      id: 'GET /noop',
      method: 'get' as const,
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      responseSchema: null,
    };
    useWorkflowStore.setState({ baseUrl: 'http://example.test', operations: [noop] });
    const { addNode, connectNodes, toggleBreakpoint, run } = useWorkflowStore.getState();
    const a = addNode('GET /noop');
    const b = addNode('GET /noop');
    connectNodes(a, b);
    toggleBreakpoint(a, b);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({}) })
    );

    const runPromise = run({ useBreakpoints: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const mid = useWorkflowStore.getState();
    expect(mid.stepStatusByNodeId[a]).toBe('completed');
    expect(mid.stepStatusByNodeId[b]).toBe('paused');
    expect(mid.previewRequestByNodeId[b]?.url).toBe('http://example.test/noop');
    expect(mid.isRunning).toBe(true); // still "running" — a run isn't over just because it's paused
    expect(mid.activeControl).not.toBeNull();

    mid.continueExecution();
    await runPromise;

    const final = useWorkflowStore.getState();
    expect(final.stepStatusByNodeId[b]).toBe('completed');
    expect(final.activeControl).toBeNull();
  });

  it('a plain run() ignores armed breakpoints entirely and never sets activeControl — "Run" is not "Debug"', async () => {
    const noop = {
      id: 'GET /noop',
      method: 'get' as const,
      path: '/noop',
      parameters: [],
      requestBodySchema: null,
      responseSchema: null,
    };
    useWorkflowStore.setState({ baseUrl: 'http://example.test', operations: [noop] });
    const { addNode, connectNodes, toggleBreakpoint, run } = useWorkflowStore.getState();
    const a = addNode('GET /noop');
    const b = addNode('GET /noop');
    connectNodes(a, b);
    toggleBreakpoint(a, b);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({}) })
    );

    await run();

    const final = useWorkflowStore.getState();
    expect(final.stepStatusByNodeId[a]).toBe('completed');
    expect(final.stepStatusByNodeId[b]).toBe('completed'); // never paused, despite the armed breakpoint
    expect(final.activeControl).toBeNull();
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

  it('stashes spec info.title and info.version for workflow export', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          info: { title: 'Sample API', version: '1.0.0' },
          paths: {},
          servers: [{ url: 'http://x' }],
        }),
      })
    );

    await useWorkflowStore.getState().loadOperations();

    expect(useWorkflowStore.getState().specInfo).toEqual({ title: 'Sample API', version: '1.0.0' });
  });
});

describe('replaceWorkflow', () => {
  it('swaps the graph and credentials, clears runResult, and leaves operations / baseUrl intact', () => {
    const keepOp = {
      id: 'GET /kept',
      method: 'get' as const,
      path: '/kept',
      parameters: [],
      requestBodySchema: null,
      responseSchema: null,
    };
    useWorkflowStore.setState({
      operations: [keepOp],
      baseUrl: 'http://example.test',
      specInfo: { title: 'Sample API' },
      runResult: {
        steps: [
          {
            nodeId: 'old',
            request: { method: 'GET', url: 'http://example.test/old', headers: {}, credentials: 'omit',},
            timestampStart: '',
            timestampEnd: '',
          },
        ],
      },
    });
    const { addNode, addCredential, setCredential, selectNode, replaceWorkflow } = useWorkflowStore.getState();
    const oldId = addNode('GET /old', { x: 1, y: 1 });
    addCredential({ name: 'old-cred', type: 'bearer', token: 'old-secret' });
    setCredential(oldId, useWorkflowStore.getState().credentials[0].id);
    selectNode(oldId);

    const incoming = serializeCollection({
      nodes: [{ id: 'n-new', operationId: 'POST /orders', credentialId: 'c-new', fieldValues: {} }],
      connections: [],
      nodePositions: { 'n-new': { x: 40, y: 80 } },
      credentials: [{ id: 'c-new', name: 'imported', type: 'bearer', token: 'must-not-survive' }],
    });
    replaceWorkflow(incoming);

    const state = useWorkflowStore.getState();
    expect(state.nodes).toEqual([{ id: 'n-new', operationId: 'POST /orders', credentialId: 'c-new', fieldValues: {} }]);
    expect(state.nodePositions).toEqual({ 'n-new': { x: 40, y: 80 } });
    expect(state.credentials).toEqual([{ id: 'c-new', name: 'imported', type: 'bearer', token: '' }]);
    expect(state.selectedNodeId).toBeNull();
    expect(state.runResult).toBeNull();
    expect(state.operations).toEqual([keepOp]);
    expect(state.baseUrl).toBe('http://example.test');
    expect(state.specInfo).toEqual({ title: 'Sample API' });
  });
});

describe('run incomplete-credential guard', () => {
  it('refuses to run when a referenced credential has no secret, and does not call fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    useWorkflowStore.setState({
      baseUrl: 'http://example.test',
      operations: [
        {
          id: 'GET /noop',
          method: 'get',
          path: '/noop',
          parameters: [],
          requestBodySchema: null,
          responseSchema: null,
        },
      ],
      credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: '' }],
    });
    const { addNode, setCredential, run } = useWorkflowStore.getState();
    const id = addNode('GET /noop');
    setCredential(id, 'c1');

    await run();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useWorkflowStore.getState().isRunning).toBe(false);
    expect(useWorkflowStore.getState().error).toBe('Credential "staging" needs a secret before this chain can run.');
    vi.unstubAllGlobals();
  });
});

describe('locked while a run is in progress', () => {
  // executeChain (chainExecutor.ts) reads nodes/connections/credentials/
  // armedBreakpoints exactly once, when run() calls it — every mutating
  // action below would otherwise let the Inspector/Canvas look editable
  // and "take" in the store while silently having no effect on the run
  // already using the old snapshot. See workflowStore.ts's isLocked.
  it('no-ops every node-config/data-mapping/graph-structure mutation while isRunning, leaving state untouched', () => {
    const {
      addNode,
      connectNodes,
      setCredential,
      setFieldValue,
      mergeFieldValues,
      setRequestMode,
      setRawBody,
      toggleBreakpoint,
    } = useWorkflowStore.getState();
    const a = addNode('GET /a', { x: 0, y: 0 });
    const b = addNode('GET /b', { x: 100, y: 0 });
    connectNodes(a, b);

    useWorkflowStore.setState({ isRunning: true });
    const before = useWorkflowStore.getState();

    expect(addNode('GET /c')).toBe('');
    setCredential(a, 'some-credential-id');
    setFieldValue(a, 'body.x', { source: 'static', value: 'nope' });
    mergeFieldValues(a, { 'body.y': { source: 'static', value: 'nope' } });
    setRequestMode(a, 'raw');
    setRawBody(a, { template: '{}', tags: {} });
    useWorkflowStore.getState().connectNodes(b, a);
    useWorkflowStore.getState().disconnectNodes(a, b);
    toggleBreakpoint(a, b);
    useWorkflowStore.getState().removeNode(a);

    const after = useWorkflowStore.getState();
    expect(after.nodes).toEqual(before.nodes);
    expect(after.connections).toEqual(before.connections);
    expect(after.armedBreakpoints).toEqual(before.armedBreakpoints);
  });

  it('still allows repositioning a node while running — purely visual, not config/data', () => {
    const { addNode, updateNodePosition } = useWorkflowStore.getState();
    const a = addNode('GET /a', { x: 0, y: 0 });

    useWorkflowStore.setState({ isRunning: true });
    updateNodePosition(a, { x: 250, y: 250 });

    expect(useWorkflowStore.getState().nodePositions[a]).toEqual({ x: 250, y: 250 });
  });

  it('nudges a newly dropped node clear of an existing card', () => {
    const { addNode } = useWorkflowStore.getState();
    const a = addNode('GET /a', { x: 40, y: 40 });
    const b = addNode('GET /b', { x: 40, y: 40 });
    const positions = useWorkflowStore.getState().nodePositions;
    expect(positions[a]).toEqual({ x: 40, y: 40 });
    expect(positions[b]).not.toEqual({ x: 40, y: 40 });
  });

  it('nudges on drag-end when avoidOverlap is set, but not while dragging freely', () => {
    const { addNode, updateNodePosition } = useWorkflowStore.getState();
    const a = addNode('GET /a', { x: 0, y: 0 });
    const b = addNode('GET /b', { x: 400, y: 0 });
    updateNodePosition(b, { x: 10, y: 10 }); // mid-drag style — raw
    expect(useWorkflowStore.getState().nodePositions[b]).toEqual({ x: 10, y: 10 });
    updateNodePosition(b, { x: 10, y: 10 }, { avoidOverlap: true });
    const settled = useWorkflowStore.getState().nodePositions[b];
    expect(settled).not.toEqual({ x: 10, y: 10 });
    // Nearest free slot — not a far spiral jump off-canvas.
    expect(Math.hypot(settled.x - 10, settled.y - 10)).toBeLessThan(300);
    expect(useWorkflowStore.getState().nodePositions[a]).toEqual({ x: 0, y: 0 });
  });

  it('disconnectNodes locked while running does NOT disarm a breakpoint either — the whole action is a no-op, not just the connection removal', () => {
    const { addNode, connectNodes, toggleBreakpoint, disconnectNodes } = useWorkflowStore.getState();
    const a = addNode('GET /a');
    const b = addNode('GET /b');
    connectNodes(a, b);
    toggleBreakpoint(a, b);

    useWorkflowStore.setState({ isRunning: true });
    disconnectNodes(a, b);

    const state = useWorkflowStore.getState();
    expect(state.connections).toEqual([{ fromNodeId: a, toNodeId: b }]);
    expect(state.armedBreakpoints).toEqual(new Set([connectionKey(a, b)]));
  });
});
