import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectionKey } from '@get-enlace/core';
import { useWorkflowStore } from './workflowStore.js';
import { serializeCollection } from '../utils/workflowDocument.js';

// Reset to a clean slate before each test — zustand stores are module-level
// singletons, so state otherwise leaks across tests.
beforeEach(() => {
  useWorkflowStore.setState({
    nodes: [],
    connections: [],
    nodePositions: {},
    groups: [],
    selectedNodeId: null,
    credentials: [],
    declaredCredentials: [],
    operations: [],
    baseUrl: null,
    specInfo: null,
    workflowName: 'Untitled',
    runResult: null,
    stepStatusByNodeId: {},
    armedBreakpoints: new Set(),
    previewRequestByNodeId: {},
    activeControl: null,
    isRunning: false,
    isDebugRun: false,
    debugConsoleOpen: false,
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

  it('a plain run() ignores armed breakpoints entirely and never sets isDebugRun — "Run" is not "Debug"', async () => {
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

    const runPromise = run();
    // Mid-run: Stop is available via activeControl, but this is not a debug session.
    expect(useWorkflowStore.getState().isDebugRun).toBe(false);
    expect(useWorkflowStore.getState().activeControl).not.toBeNull();
    await runPromise;

    const final = useWorkflowStore.getState();
    expect(final.stepStatusByNodeId[a]).toBe('completed');
    expect(final.stepStatusByNodeId[b]).toBe('completed'); // never paused, despite the armed breakpoint
    expect(final.activeControl).toBeNull();
    expect(final.isDebugRun).toBe(false);
    expect(final.debugConsoleOpen).toBe(false);
  });

  it('Debug run opens the console for the session and closes it when the session ends', async () => {
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
    addNode('GET /noop');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: true }),
      })
    );

    const runPromise = run({ useBreakpoints: true });
    expect(useWorkflowStore.getState().isDebugRun).toBe(true);
    expect(useWorkflowStore.getState().debugConsoleOpen).toBe(true);

    await runPromise;
    expect(useWorkflowStore.getState().isDebugRun).toBe(false);
    expect(useWorkflowStore.getState().debugConsoleOpen).toBe(false);
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
      name: 'Orders sandbox',
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
    expect(state.workflowName).toBe('Orders sandbox');
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

describe('workflowStore node groups', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      nodes: [],
      connections: [],
      nodePositions: {},
      groups: [],
      operations: [
        { id: 'GET /a', method: 'get', path: '/a', parameters: [], requestBodySchema: null, responseSchema: null },
        { id: 'GET /b', method: 'get', path: '/b', parameters: [], requestBodySchema: null, responseSchema: null },
        { id: 'GET /c', method: 'get', path: '/c', parameters: [], requestBodySchema: null, responseSchema: null },
      ],
      selectedNodeId: null,
      isRunning: false,
    });
  });

  it('createGroup stores members in canvas reading order, not drag order', () => {
    const { addNode, createGroup } = useWorkflowStore.getState();
    const a = addNode('GET /a', { x: 0, y: 0 });
    const b = addNode('GET /b', { x: 400, y: 0 });
    // Same as Canvas: [dragged, target] when the right-hand card is dropped onto the left.
    createGroup({
      name: 'Orders',
      nodeIds: [b, a],
      draggedNodeId: b,
      draggedPosition: { x: 50, y: 0 },
    });
    expect(useWorkflowStore.getState().groups[0].nodeIds).toEqual([a, b]);
  });

  it('createGroup links two nodes and parks the dragged card at the drop position', () => {
    const { addNode, createGroup } = useWorkflowStore.getState();
    const a = addNode('GET /a', { x: 0, y: 0 });
    const b = addNode('GET /b', { x: 400, y: 0 });
    const id = createGroup({
      name: 'Orders',
      nodeIds: [a, b],
      draggedNodeId: a,
      draggedPosition: { x: 390, y: 5 },
      skipConfirmOnDrop: true,
    });
    expect(id).toMatch(/^g-/);
    const group = useWorkflowStore.getState().groups[0];
    expect(group.name).toBe('Orders');
    expect(group.nodeIds).toEqual(expect.arrayContaining([a, b]));
    expect(group.skipConfirmOnDrop).toBe(true);
    expect(useWorkflowStore.getState().nodePositions[a]).toEqual({ x: 390, y: 5 });
  });

  it('joinGroup adds a member and can set skipConfirmOnDrop', () => {
    const { addNode, createGroup, joinGroup } = useWorkflowStore.getState();
    const a = addNode('GET /a', { x: 0, y: 0 });
    const b = addNode('GET /b', { x: 300, y: 0 });
    const c = addNode('GET /c', { x: 600, y: 0 });
    const gid = createGroup({
      name: 'Orders',
      nodeIds: [a, b],
      draggedNodeId: a,
      draggedPosition: { x: 0, y: 0 },
    });
    joinGroup(gid, c, { x: 280, y: 10 }, { skipConfirmOnDrop: true });
    const group = useWorkflowStore.getState().groups.find((g) => g.id === gid)!;
    expect(group.nodeIds).toContain(c);
    expect(group.skipConfirmOnDrop).toBe(true);
  });

  it('ungroup dissolves without removing nodes', () => {
    const { addNode, createGroup, ungroup } = useWorkflowStore.getState();
    const a = addNode('GET /a', { x: 0, y: 0 });
    const b = addNode('GET /b', { x: 300, y: 0 });
    const gid = createGroup({
      name: 'Orders',
      nodeIds: [a, b],
      draggedNodeId: a,
      draggedPosition: { x: 0, y: 0 },
    });
    ungroup(gid);
    expect(useWorkflowStore.getState().groups).toHaveLength(0);
    expect(useWorkflowStore.getState().nodes).toHaveLength(2);
  });

  it('removeNode drops membership and dissolves a 1-member leftover group', () => {
    const { addNode, createGroup, removeNode } = useWorkflowStore.getState();
    const a = addNode('GET /a', { x: 0, y: 0 });
    const b = addNode('GET /b', { x: 300, y: 0 });
    createGroup({
      name: 'Orders',
      nodeIds: [a, b],
      draggedNodeId: a,
      draggedPosition: { x: 0, y: 0 },
    });
    removeNode(a);
    expect(useWorkflowStore.getState().groups).toHaveLength(0);
    expect(useWorkflowStore.getState().nodes.map((n) => n.id)).toEqual([b]);
  });

  it('createGroup / joinGroup / ungroup no-op while running', () => {
    const { addNode, createGroup, joinGroup, ungroup } = useWorkflowStore.getState();
    const a = addNode('GET /a', { x: 0, y: 0 });
    const b = addNode('GET /b', { x: 300, y: 0 });
    const c = addNode('GET /c', { x: 600, y: 0 });
    const gid = createGroup({
      name: 'Orders',
      nodeIds: [a, b],
      draggedNodeId: a,
      draggedPosition: { x: 0, y: 0 },
    });
    useWorkflowStore.setState({ isRunning: true });
    expect(
      createGroup({
        name: 'Nope',
        nodeIds: [b, c],
        draggedNodeId: c,
        draggedPosition: { x: 300, y: 0 },
      })
    ).toBe('');
    joinGroup(gid, c, { x: 280, y: 0 });
    ungroup(gid);
    const state = useWorkflowStore.getState();
    expect(state.groups).toHaveLength(1);
    expect(state.groups[0].nodeIds).toEqual(expect.arrayContaining([a, b]));
    expect(state.groups[0].nodeIds).not.toContain(c);
  });

  it('moveGroup shifts every member by the same delta', () => {
    const { addNode, createGroup, moveGroup } = useWorkflowStore.getState();
    const a = addNode('GET /a', { x: 100, y: 100 });
    const b = addNode('GET /b', { x: 400, y: 100 });
    const gid = createGroup({
      name: 'Orders',
      nodeIds: [a, b],
      draggedNodeId: a,
      draggedPosition: { x: 100, y: 100 },
    });
    const before = useWorkflowStore.getState();
    const origin = before.groups[0].position;
    moveGroup(gid, { x: origin.x + 50, y: origin.y + 20 });
    const after = useWorkflowStore.getState();
    expect(after.nodePositions[a]).toEqual({ x: 150, y: 120 });
    expect(after.nodePositions[b]).toEqual({ x: 450, y: 120 });
  });

  it('keeps tight member packing when the group moves — no min-gap snap between groupmates', () => {
    const { addNode, createGroup, moveGroup, updateNodePosition } = useWorkflowStore.getState();
    const a = addNode('GET /a', { x: 0, y: 0 });
    const b = addNode('GET /b', { x: 400, y: 0 });
    // Overlap them the way drop-to-group does
    createGroup({
      name: 'Orders',
      nodeIds: [a, b],
      draggedNodeId: a,
      draggedPosition: { x: 10, y: 10 },
    });
    const before = useWorkflowStore.getState();
    expect(before.nodePositions[a]).toEqual({ x: 10, y: 10 });
    const origin = before.groups[0].position;
    moveGroup(before.groups[0].id, { x: origin.x + 80, y: origin.y + 40 });
    const mid = useWorkflowStore.getState();
    expect(mid.nodePositions[a]).toEqual({ x: 90, y: 50 });
    expect(mid.nodePositions[b]).toEqual({
      x: before.nodePositions[b].x + 80,
      y: before.nodePositions[b].y + 40,
    });
    // Settling one member must not push it clear of its groupmate
    updateNodePosition(a, mid.nodePositions[a], { avoidOverlap: true });
    expect(useWorkflowStore.getState().nodePositions[a]).toEqual(mid.nodePositions[a]);
  });

  it('removeFromGroup releases one member and dissolves when fewer than 2 remain', () => {
    const { addNode, createGroup, removeFromGroup } = useWorkflowStore.getState();
    const a = addNode('GET /a', { x: 0, y: 0 });
    const b = addNode('GET /b', { x: 300, y: 0 });
    const c = addNode('GET /c', { x: 600, y: 0 });
    const gid = createGroup({
      name: 'Orders',
      nodeIds: [a, b],
      draggedNodeId: a,
      draggedPosition: { x: 0, y: 0 },
    });
    useWorkflowStore.getState().joinGroup(gid, c, { x: 280, y: 10 });
    expect(useWorkflowStore.getState().groups[0].nodeIds).toHaveLength(3);

    removeFromGroup(gid, c);
    const afterOne = useWorkflowStore.getState();
    expect(afterOne.groups[0].nodeIds).toEqual(expect.arrayContaining([a, b]));
    expect(afterOne.groups[0].nodeIds).not.toContain(c);
    expect(afterOne.nodes.map((n) => n.id)).toEqual(expect.arrayContaining([a, b, c]));

    removeFromGroup(gid, a);
    // One member left → group dissolves; both a and b stay on the canvas
    expect(useWorkflowStore.getState().groups).toHaveLength(0);
    expect(useWorkflowStore.getState().nodes).toHaveLength(3);
  });

  it('removeFromGroup no-ops while running', () => {
    const { addNode, createGroup, removeFromGroup } = useWorkflowStore.getState();
    const a = addNode('GET /a', { x: 0, y: 0 });
    const b = addNode('GET /b', { x: 300, y: 0 });
    const gid = createGroup({
      name: 'Orders',
      nodeIds: [a, b],
      draggedNodeId: a,
      draggedPosition: { x: 0, y: 0 },
    });
    useWorkflowStore.setState({ isRunning: true });
    removeFromGroup(gid, a);
    expect(useWorkflowStore.getState().groups[0].nodeIds).toEqual(expect.arrayContaining([a, b]));
  });

  it('replaceWorkflow restores groups from the collection', () => {
    const { addNode, createGroup, replaceWorkflow } = useWorkflowStore.getState();
    const a = addNode('GET /a', { x: 0, y: 0 });
    const b = addNode('GET /b', { x: 100, y: 0 });
    createGroup({
      name: 'Local',
      nodeIds: [a, b],
      draggedNodeId: a,
      draggedPosition: { x: 0, y: 0 },
    });

    const incoming = serializeCollection({
      name: 'Imported',
      nodes: [
        { id: 'n-new', operationId: 'GET /a', credentialId: null, fieldValues: {} },
        { id: 'n-new-2', operationId: 'GET /b', credentialId: null, fieldValues: {} },
      ],
      connections: [],
      nodePositions: { 'n-new': { x: 40, y: 80 }, 'n-new-2': { x: 60, y: 80 } },
      groups: [
        {
          id: 'g-import',
          name: 'Imported group',
          nodeIds: ['n-new', 'n-new-2'],
          collapsed: false,
          position: { x: 20, y: 40 },
          skipConfirmOnDrop: false,
        },
      ],
      credentials: [],
    });
    replaceWorkflow(incoming);
    const state = useWorkflowStore.getState();
    expect(state.groups).toEqual(incoming.workflows[0].groups);
    expect(state.nodes.map((n) => n.id)).toEqual(['n-new', 'n-new-2']);
  });
});
