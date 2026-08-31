import { describe, expect, it } from 'vitest';
import type { Credential, CredentialStub, Operation, WorkflowNode } from '../types.js';
import { ENLACE_COLLECTION_FORMAT, ENLACE_COLLECTION_VERSION } from '../types.js';
import {
  collectionFilename,
  formatUnknownOperationsError,
  hydrateCredential,
  hydrateCollection,
  parseCollection,
  referencedIncompleteCredentials,
  serializeCollection,
} from './workflowDocument.js';

const operation: Operation = {
  id: 'POST /orders',
  method: 'post',
  path: '/orders',
  parameters: [],
  requestBodySchema: null,
  responseSchema: null,
};

const node: WorkflowNode = {
  id: 'n1',
  operationId: 'POST /orders',
  credentialId: 'c-bearer',
  fieldValues: {
    'body.qty': { source: 'static', value: 2 },
    'body.customerId': { source: 'mapped', fromNodeId: 'n0', fromResponseFieldPath: 'id' },
  },
  requestMode: 'raw',
  rawBody: {
    template: '{"id":"{{enlace:tag-1}}"}',
    tags: { 'tag-1': { id: 'tag-1', type: 'response_body', sourceNodeId: 'n0', jsonPath: 'id' } },
  },
};

const allCredentials: Credential[] = [
  { id: 'c-bearer', name: 'staging', type: 'bearer', token: 'super-secret-token', fromSecurityScheme: 'bearerAuth' },
  { id: 'c-basic', name: 'basic', type: 'basic', username: 'alice', password: 'hunter2' },
  { id: 'c-key', name: 'key', type: 'apiKey', paramName: 'X-Api-Key', in: 'header', key: 'abc123' },
  {
    id: 'c-cc',
    name: 'cc',
    type: 'oauth2_clientCredentials',
    tokenUrl: 'https://auth.test/token',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    scope: 'orders',
    clientAuthMethod: 'basic',
  },
  {
    id: 'c-pw',
    name: 'pw',
    type: 'oauth2_password',
    tokenUrl: 'https://auth.test/token',
    username: 'bob',
    password: 'pw-secret',
    clientId: 'public',
    clientSecret: 'not-public',
    clientAuthMethod: 'body',
  },
  { id: 'c-cookie', name: 'github', type: 'cookie', loginUrl: 'https://app.test/login' },
];

function serializeAll(options: { includeSecrets?: boolean; name?: string } = {}) {
  return serializeCollection({
    name: options.name,
    includeSecrets: options.includeSecrets,
    nodes: [node],
    connections: [{ fromNodeId: 'n0', toNodeId: 'n1' }],
    nodePositions: { n1: { x: 10, y: 20 } },
    credentials: allCredentials,
    specInfo: { title: 'Sample API', version: '1.0.0' },
    now: () => '2026-08-28T00:00:00.000Z',
  });
}

describe('serializeCollection', () => {
  it('round-trips nodes, connections, positions, rawBody tags, and spec hint', () => {
    const doc = serializeAll();
    expect(doc.format).toBe(ENLACE_COLLECTION_FORMAT);
    expect(doc.version).toBe(ENLACE_COLLECTION_VERSION);
    expect(doc.name).toBe('Sample API');
    expect(doc.secrets).toBe('stripped');
    expect(doc.exportedAt).toBe('2026-08-28T00:00:00.000Z');
    expect(doc.workflows).toHaveLength(1);
    expect(doc.workflows[0].name).toBe('Sample API');
    expect(doc.workflows[0].specHint).toEqual({
      title: 'Sample API',
      version: '1.0.0',
      operationIds: ['POST /orders'],
    });
    expect(doc.workflows[0].nodes).toEqual([node]);
    expect(doc.workflows[0].connections).toEqual([{ fromNodeId: 'n0', toNodeId: 'n1' }]);
    expect(doc.workflows[0].nodePositions).toEqual({ n1: { x: 10, y: 20 } });
  });

  it('drops the authenticating field on every credential type and keeps non-secret config', () => {
    const stubs = serializeAll().credentials;
    expect(stubs).toEqual([
      { id: 'c-bearer', name: 'staging', fromSecurityScheme: 'bearerAuth', type: 'bearer' },
      { id: 'c-basic', name: 'basic', type: 'basic', username: 'alice' },
      { id: 'c-key', name: 'key', type: 'apiKey', paramName: 'X-Api-Key', in: 'header' },
      {
        id: 'c-cc',
        name: 'cc',
        type: 'oauth2_clientCredentials',
        tokenUrl: 'https://auth.test/token',
        clientId: 'client-id',
        scope: 'orders',
        clientAuthMethod: 'basic',
      },
      {
        id: 'c-pw',
        name: 'pw',
        type: 'oauth2_password',
        tokenUrl: 'https://auth.test/token',
        username: 'bob',
        clientId: 'public',
        clientAuthMethod: 'body',
      },
      { id: 'c-cookie', name: 'github', type: 'cookie', loginUrl: 'https://app.test/login' },
    ]);
    const serialized = JSON.stringify(serializeAll());
    expect(serialized).not.toContain('super-secret-token');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('abc123');
    expect(serialized).not.toContain('client-secret');
    expect(serialized).not.toContain('pw-secret');
    expect(serialized).not.toContain('not-public');
    expect(serialized).not.toMatch(/"token"/);
    expect(serialized).not.toMatch(/"password"/);
    expect(serialized).not.toMatch(/"clientSecret"/);
    expect(serialized).not.toMatch(/"key":/);
  });

  it('includes every authenticating field only when explicitly requested', () => {
    const collection = serializeAll({ includeSecrets: true, name: 'Private backup' });
    expect(collection.name).toBe('Private backup');
    expect(collection.secrets).toBe('included');
    expect(collection.credentials).toEqual(allCredentials);
    const serialized = JSON.stringify(collection);
    expect(serialized).toContain('super-secret-token');
    expect(serialized).toContain('hunter2');
    expect(serialized).toContain('abc123');
    expect(serialized).toContain('client-secret');
    expect(serialized).toContain('pw-secret');
    expect(serialized).toContain('not-public');
  });
});

describe('parseCollection', () => {
  it('accepts a serialized document and reports unknown operations plus incomplete credentials', () => {
    const result = parseCollection(JSON.stringify(serializeAll()), { operations: [operation] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.collection.workflows[0].nodes).toEqual([node]);
    expect(result.warnings.unknownOperationIds).toEqual([]);
    expect(result.warnings.secretsIncluded).toBe(false);
    expect(result.warnings.unexpectedSecretsDiscarded).toBe(false);
    expect(result.warnings.credentialsNeedingSecrets.map((c) => c.id).sort()).toEqual(
      ['c-basic', 'c-bearer', 'c-cc', 'c-key', 'c-pw'].sort()
    );
  });

  it('flags unknown operationIds without blocking the parse', () => {
    const result = parseCollection(serializeAll(), { operations: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.unknownOperationIds).toEqual(['POST /orders']);
  });

  it('discards injected secret keys and still hydrates empty secrets', () => {
    const poisoned = {
      ...serializeAll(),
      credentials: [
        { id: 'c-bearer', name: 'staging', type: 'bearer', token: 'leaked-token' },
        { id: 'c-basic', name: 'basic', type: 'basic', username: 'alice', password: 'leaked-pw' },
        { id: 'c-key', name: 'key', type: 'apiKey', paramName: 'X-Api-Key', in: 'header', key: 'leaked-key' },
        {
          id: 'c-cc',
          name: 'cc',
          type: 'oauth2_clientCredentials',
          tokenUrl: 'https://auth.test/token',
          clientId: 'client-id',
          clientSecret: 'leaked-secret',
        },
      ],
    };
    const result = parseCollection(poisoned);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.unexpectedSecretsDiscarded).toBe(true);
    const hydrated = result.collection.credentials.map((credential) => hydrateCredential(credential as CredentialStub));
    expect(hydrated.find((c) => c.id === 'c-bearer')).toMatchObject({ token: '' });
    expect(hydrated.find((c) => c.id === 'c-basic')).toMatchObject({ password: '' });
    expect(hydrated.find((c) => c.id === 'c-key')).toMatchObject({ key: '' });
    expect(hydrated.find((c) => c.id === 'c-cc')).toMatchObject({ clientSecret: '' });
    expect(JSON.stringify(result.collection)).not.toContain('leaked-');
  });

  it('imports explicitly included full credentials without stripping their secrets', () => {
    const result = parseCollection(serializeAll({ includeSecrets: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.secretsIncluded).toBe(true);
    expect(result.warnings.credentialsNeedingSecrets).toEqual([]);
    expect(hydrateCollection(result.collection).credentials).toEqual(allCredentials);
  });

  it('rejects a bad format, version, or non-JSON string', () => {
    expect(parseCollection('{')).toEqual({ ok: false, error: 'Could not parse Enlace collection as JSON.' });
    expect(parseCollection({ format: 'other', version: 1 })).toEqual({
      ok: false,
      error: 'Unknown Enlace collection format "other".',
    });
    expect(parseCollection({ format: ENLACE_COLLECTION_FORMAT, version: 2 })).toEqual({
      ok: false,
      error: 'Unsupported Enlace collection version "2".',
    });
  });
});

describe('hydrateCollection / helpers', () => {
  it('hydrates stubs to credentials with empty secrets and keeps cookie complete', () => {
    const doc = serializeAll();
    const hydrated = hydrateCollection(doc);
    expect(hydrated.credentials.find((c) => c.type === 'bearer')).toMatchObject({ token: '' });
    expect(hydrated.credentials.find((c) => c.type === 'cookie')).toMatchObject({
      loginUrl: 'https://app.test/login',
    });
    expect(referencedIncompleteCredentials(hydrated.nodes, hydrated.credentials).map((c) => c.id)).toEqual([
      'c-bearer',
    ]);
  });

  it('builds a filename from the spec title', () => {
    const doc = serializeAll();
    expect(collectionFilename(doc)).toBe('sample-api.enlace');
    expect(collectionFilename(serializeAll({ includeSecrets: true }))).toBe('sample-api-with-secrets.enlace');
    expect(collectionFilename({ ...doc, name: '---' })).toBe('enlace-collection.enlace');
  });

  it('names an encrypted export by what is actually on disk, not by collection.secrets alone', () => {
    const doc = serializeAll({ includeSecrets: true });
    expect(collectionFilename(doc, true)).toBe('sample-api-encrypted.enlace');
    // Stripped collections are never encrypted, but the flag is still honored if passed.
    expect(collectionFilename(serializeAll(), true)).toBe('sample-api-encrypted.enlace');
  });

  it('reports unknown operations only — credential problems are the drawer’s job', () => {
    const warnings = {
      credentialsNeedingSecrets: [{ id: 'c-bearer', name: 'staging', type: 'bearer' as const }],
      secretsIncluded: false,
      unexpectedSecretsDiscarded: true,
    };
    expect(formatUnknownOperationsError({ ...warnings, unknownOperationIds: [] })).toBeNull();
    expect(formatUnknownOperationsError({ ...warnings, unknownOperationIds: ['POST /missing'] })).toBe(
      "Operation POST /missing isn't in the loaded spec — load the matching spec before running."
    );
    expect(
      formatUnknownOperationsError({ ...warnings, unknownOperationIds: ['POST /missing', 'GET /gone'] })
    ).toBe("Operations POST /missing, GET /gone aren't in the loaded spec — load the matching spec before running.");
  });

  it('accepts legacy bodyMode on import as requestMode, and round-trips rawPath/rawQuery', () => {
    const withParams: WorkflowNode = {
      id: 'n-patch',
      operationId: 'PATCH /customers/{id}',
      credentialId: null,
      fieldValues: {},
      requestMode: 'raw',
      rawPath: { template: '{"id":"c1"}', tags: {} },
      rawQuery: { template: '{"dryRun":true}', tags: {} },
    };
    const doc = serializeCollection({
      nodes: [withParams],
      connections: [],
      nodePositions: {},
      credentials: [],
    });
    expect(doc.workflows[0].nodes[0].requestMode).toBe('raw');
    expect(doc.workflows[0].nodes[0].rawPath).toEqual({ template: '{"id":"c1"}', tags: {} });
    expect(doc.workflows[0].nodes[0].rawQuery).toEqual({ template: '{"dryRun":true}', tags: {} });

    const legacy = parseCollection({
      format: ENLACE_COLLECTION_FORMAT,
      version: ENLACE_COLLECTION_VERSION,
      name: 'Legacy',
      exportedAt: '',
      secrets: 'stripped',
      credentials: [],
      workflows: [
        {
          id: 'workflow-1',
          name: 'Legacy',
          specHint: { operationIds: [] },
          nodes: [
            {
              id: 'n1',
              operationId: 'POST /x',
              credentialId: null,
              fieldValues: {},
              bodyMode: 'raw',
              rawBody: { template: '{}', tags: {} },
            },
          ],
          connections: [],
          nodePositions: {},
        },
      ],
    });
    expect(legacy.ok).toBe(true);
    if (legacy.ok) {
      expect(legacy.collection.workflows[0].nodes[0].requestMode).toBe('raw');
      expect(legacy.collection.workflows[0].nodes[0].rawBody).toEqual({ template: '{}', tags: {} });
    }
  });

  it('round-trips a file FieldValue marker (fileName only — no bytes)', () => {
    const withFile: WorkflowNode = {
      id: 'n-product',
      operationId: 'POST /products',
      credentialId: null,
      fieldValues: {
        'body.image': { source: 'file', fileName: 'gadget.png' },
        'body.name': { source: 'static', value: 'Gadget' },
      },
    };
    const collection = serializeCollection({
      name: 'Product',
      nodes: [withFile],
      connections: [],
      nodePositions: { 'n-product': { x: 0, y: 0 } },
      credentials: [],
    });
    const serialized = JSON.stringify(collection);
    expect(serialized).toContain('"source":"file"');
    expect(serialized).toContain('gadget.png');
    expect(serialized).not.toContain('Blob');

    const result = parseCollection(collection);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.collection.workflows[0].nodes[0].fieldValues['body.image']).toEqual({
      source: 'file',
      fileName: 'gadget.png',
    });
  });
});
