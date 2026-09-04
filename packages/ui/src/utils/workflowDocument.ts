import type {
  AssertCheck,
  AssertOperator,
  BodyTag,
  BodyTagType,
  CollectionWarnings,
  CollectionWorkflow,
  Credential,
  CredentialStub,
  CredentialType,
  EnlaceCollection,
  FieldValue,
  Preset,
  NodeGroup,
  Operation,
  RawBody,
  WorkflowConnection,
  WorkflowNode,
} from '../types.js';
import { ENLACE_COLLECTION_FORMAT, ENLACE_COLLECTION_VERSION } from '../types.js';
import type { OAuth2ClientAuthMethod } from '../types.js';
import { isDraftComplete, toDraft } from './credentialDraft.js';

/** A `kind: 'presets'` collection has no `operationId` at all — `undefined` in that case, same as a plain missing one. */
function operationIdOf(node: WorkflowNode): string | undefined {
  return node.kind === 'presets' ? undefined : node.operationId;
}

/** Keys that authenticate. Stripped exports never write or read these. */
const SECRET_KEYS = ['token', 'password', 'key', 'clientSecret'] as const;

const CREDENTIAL_TYPES: ReadonlySet<string> = new Set<CredentialType>([
  'bearer',
  'basic',
  'apiKey',
  'oauth2_clientCredentials',
  'oauth2_password',
  'cookie',
]);

export interface SerializeWorkflowInput {
  name?: string;
  includeSecrets?: boolean;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  nodePositions: Record<string, { x: number; y: number }>;
  groups?: NodeGroup[];
  /** Collapsed/expanded chrome for presets nodes — same tier as `groups`. See `WorkflowState.presetsCollapsed`. */
  presetsCollapsed?: Record<string, boolean>;
  credentials: Credential[];
  specInfo?: { title?: string; version?: string } | null;
  /** Override for tests — defaults to `new Date().toISOString()`. */
  now?: () => string;
}

export type ParseCollectionResult =
  | { ok: true; collection: EnlaceCollection; warnings: CollectionWarnings }
  | { ok: false; error: string };

export function serializeCollection(input: SerializeWorkflowInput): EnlaceCollection {
  const name = input.name?.trim() || input.specInfo?.title?.trim() || 'Untitled';
  const nodes = input.nodes.map(serializeNode);
  // Wait (and any future non-'operation' kind) has no operationId at all —
  // filtered out here rather than coerced to a placeholder string, so it
  // never shows up as a bogus "unknown operation" specHint entry on import.
  const operationIds = [...new Set(nodes.map(operationIdOf).filter((id): id is string => typeof id === 'string'))];
  const specHint: CollectionWorkflow['specHint'] = { operationIds };
  if (input.specInfo?.title) specHint.title = input.specInfo.title;
  if (input.specInfo?.version) specHint.version = input.specInfo.version;

  return {
    format: ENLACE_COLLECTION_FORMAT,
    version: ENLACE_COLLECTION_VERSION,
    name,
    exportedAt: (input.now ?? (() => new Date().toISOString()))(),
    secrets: input.includeSecrets ? 'included' : 'stripped',
    credentials: input.credentials.map((credential) =>
      input.includeSecrets ? serializeFullCredential(credential) : serializeCredentialStub(credential)
    ),
    workflows: [
      {
        id: 'workflow-1',
        name,
        specHint,
        nodes,
        connections: input.connections.map((c) => ({ fromNodeId: c.fromNodeId, toNodeId: c.toNodeId })),
        nodePositions: Object.fromEntries(
          Object.entries(input.nodePositions).map(([id, pos]) => [id, { x: pos.x, y: pos.y }])
        ),
        groups: sanitizeGroups(input.groups ?? [], new Set(nodes.map((n) => n.id))),
        presetsCollapsed: sanitizePresetsCollapsed(input.presetsCollapsed ?? {}, nodes),
      },
    ],
  };
}

export function parseCollection(
  raw: unknown,
  options: { operations?: Operation[] } = {}
): ParseCollectionResult {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    const parsed = parseJson(raw);
    if (!parsed.ok) return parsed;
    value = parsed.value;
  }

  if (!isRecord(value)) {
    return { ok: false, error: 'Enlace collection must be a JSON object.' };
  }
  if (value.format !== ENLACE_COLLECTION_FORMAT) {
    return { ok: false, error: `Unknown Enlace collection format "${String(value.format)}".` };
  }
  if (value.version !== ENLACE_COLLECTION_VERSION) {
    return { ok: false, error: `Unsupported Enlace collection version "${String(value.version)}".` };
  }
  if (value.secrets !== 'stripped' && value.secrets !== 'included') {
    return { ok: false, error: 'Enlace collection has an invalid "secrets" mode.' };
  }
  if (!Array.isArray(value.credentials)) {
    return { ok: false, error: 'Enlace collection is missing a "credentials" array.' };
  }
  if (!Array.isArray(value.workflows) || value.workflows.length !== 1) {
    return { ok: false, error: 'This version supports collections with exactly one workflow.' };
  }
  const workflowValue = value.workflows[0];
  if (!isRecord(workflowValue)) {
    return { ok: false, error: 'Enlace collection has an invalid workflow.' };
  }
  if (!Array.isArray(workflowValue.nodes)) {
    return { ok: false, error: 'Collection workflow is missing a "nodes" array.' };
  }
  if (!Array.isArray(workflowValue.connections)) {
    return { ok: false, error: 'Collection workflow is missing a "connections" array.' };
  }
  if (!isRecord(workflowValue.nodePositions)) {
    return { ok: false, error: 'Collection workflow is missing a "nodePositions" object.' };
  }

  const nodes: WorkflowNode[] = [];
  for (let i = 0; i < workflowValue.nodes.length; i++) {
    const node = parseNode(workflowValue.nodes[i], i);
    if (typeof node === 'string') return { ok: false, error: node };
    nodes.push(node);
  }

  const connections: WorkflowConnection[] = [];
  for (let i = 0; i < workflowValue.connections.length; i++) {
    const connection = parseConnection(workflowValue.connections[i], i);
    if (typeof connection === 'string') return { ok: false, error: connection };
    connections.push(connection);
  }

  const nodePositions: Record<string, { x: number; y: number }> = {};
  for (const [id, pos] of Object.entries(workflowValue.nodePositions)) {
    if (isUnsafeKey(id)) {
      return { ok: false, error: `Collection workflow has an invalid node id "${id}".` };
    }
    if (!isRecord(pos) || typeof pos.x !== 'number' || typeof pos.y !== 'number') {
      return { ok: false, error: `Collection workflow has an invalid position for node "${id}".` };
    }
    nodePositions[id] = { x: pos.x, y: pos.y };
  }

  let groups: NodeGroup[] = [];
  if (workflowValue.groups !== undefined) {
    if (!Array.isArray(workflowValue.groups)) {
      return { ok: false, error: 'Collection workflow "groups" must be an array when present.' };
    }
    for (let i = 0; i < workflowValue.groups.length; i++) {
      const group = parseGroup(workflowValue.groups[i], i);
      if (typeof group === 'string') return { ok: false, error: group };
      groups.push(group);
    }
    groups = sanitizeGroups(groups, new Set(nodes.map((n) => n.id)));
  }

  let presetsCollapsed: Record<string, boolean> = {};
  if (workflowValue.presetsCollapsed !== undefined) {
    if (!isRecord(workflowValue.presetsCollapsed)) {
      return { ok: false, error: 'Collection workflow "presetsCollapsed" must be an object when present.' };
    }
    for (const [id, collapsed] of Object.entries(workflowValue.presetsCollapsed)) {
      if (isUnsafeKey(id)) {
        return { ok: false, error: `Collection workflow has an invalid presetsCollapsed node id "${id}".` };
      }
      if (typeof collapsed !== 'boolean') {
        return { ok: false, error: `Collection workflow has an invalid presetsCollapsed value for node "${id}".` };
      }
      presetsCollapsed[id] = collapsed;
    }
    presetsCollapsed = sanitizePresetsCollapsed(presetsCollapsed, nodes);
  }

  const credentials: Array<CredentialStub | Credential> = [];
  let unexpectedSecretsDiscarded = false;
  for (let i = 0; i < value.credentials.length; i++) {
    const parsedCredential =
      value.secrets === 'included'
        ? parseFullCredential(value.credentials[i], i)
        : parseCredentialStub(value.credentials[i], i);
    if (typeof parsedCredential === 'string') return { ok: false, error: parsedCredential };
    if ('secretsDiscarded' in parsedCredential && parsedCredential.secretsDiscarded) {
      unexpectedSecretsDiscarded = true;
    }
    credentials.push(
      'credential' in parsedCredential ? parsedCredential.credential : parsedCredential.stub
    );
  }

  const specHint = parseSpecHint(workflowValue.specHint, nodes);
  const name =
    typeof value.name === 'string' && value.name.trim()
      ? value.name.trim()
      : typeof workflowValue.name === 'string' && workflowValue.name.trim()
        ? workflowValue.name.trim()
        : 'Untitled';

  const workflow: CollectionWorkflow = {
    id: typeof workflowValue.id === 'string' ? workflowValue.id : 'workflow-1',
    name: typeof workflowValue.name === 'string' && workflowValue.name.trim() ? workflowValue.name.trim() : name,
    specHint,
    nodes,
    connections,
    nodePositions,
    groups,
    presetsCollapsed,
  };
  const collection: EnlaceCollection = {
    format: ENLACE_COLLECTION_FORMAT,
    version: ENLACE_COLLECTION_VERSION,
    name,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
    secrets: value.secrets,
    credentials,
    workflows: [workflow],
  };

  const knownOperations = new Set((options.operations ?? []).map((o) => o.id));
  const unknownOperationIds =
    options.operations === undefined
      ? []
      : [
          ...new Set(
            nodes
              .map(operationIdOf)
              .filter((id): id is string => typeof id === 'string' && !knownOperations.has(id))
          ),
        ];

  const hydratedCredentials = hydrateCredentials(collection);
  const credentialsNeedingSecrets = hydratedCredentials
    .filter((c) => !isDraftComplete(toDraft(c)))
    .map((c) => ({ id: c.id, name: c.name, type: c.type }));

  return {
    ok: true,
    collection,
    warnings: {
      unknownOperationIds,
      credentialsNeedingSecrets,
      secretsIncluded: value.secrets === 'included',
      unexpectedSecretsDiscarded,
    },
  };
}

export function hydrateCollection(collection: EnlaceCollection): {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  nodePositions: Record<string, { x: number; y: number }>;
  groups: NodeGroup[];
  presetsCollapsed: Record<string, boolean>;
  credentials: Credential[];
} {
  const workflow = collection.workflows[0];
  const nodes = workflow.nodes.map(serializeNode);
  return {
    nodes,
    connections: workflow.connections.map((c) => ({ fromNodeId: c.fromNodeId, toNodeId: c.toNodeId })),
    nodePositions: Object.fromEntries(
      Object.entries(workflow.nodePositions).map(([id, pos]) => [id, { x: pos.x, y: pos.y }])
    ),
    groups: sanitizeGroups(workflow.groups ?? [], new Set(nodes.map((n) => n.id))),
    presetsCollapsed: sanitizePresetsCollapsed(workflow.presetsCollapsed ?? {}, nodes),
    credentials: hydrateCredentials(collection),
  };
}

/**
 * Unknown operation ids as a run-blocking message, or null when every node
 * resolved. Credential warnings deliberately don't go through here — those
 * are handled by the credentials drawer's own review banner, since the
 * fix (filling values in) lives there.
 */
export function formatUnknownOperationsError(warnings: CollectionWarnings): string | null {
  if (warnings.unknownOperationIds.length === 0) return null;
  const ids = warnings.unknownOperationIds.join(', ');
  return warnings.unknownOperationIds.length === 1
    ? `Operation ${ids} isn't in the loaded spec — load the matching spec before running.`
    : `Operations ${ids} aren't in the loaded spec — load the matching spec before running.`;
}

/**
 * `encrypted` describes what's actually being written to disk (an
 * `EncryptedCollectionEnvelope`, wrapping the collection rather than being
 * one) — it's independent of `collection.secrets`, which describes the
 * *collection's* contents, not the bytes of the file on disk. A full-secret
 * export is always encrypted going forward, but `collection.secrets ===
 * 'included'` alone still needs to name itself "-with-secrets" for the
 * legacy plaintext path (old exports, and any internal caller that
 * serializes without encrypting).
 */
export function collectionFilename(collection: EnlaceCollection, encrypted = false): string {
  const slug = collection.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const secretSuffix = encrypted ? '-encrypted' : collection.secrets === 'included' ? '-with-secrets' : '';
  return slug ? `${slug}${secretSuffix}.enlace` : `enlace-collection${secretSuffix}.enlace`;
}

export function referencedIncompleteCredentials(
  nodes: Array<{ credentialId: string | null }>,
  credentials: Credential[]
): Credential[] {
  const byId = new Map(credentials.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: Credential[] = [];
  for (const node of nodes) {
    if (!node.credentialId || seen.has(node.credentialId)) continue;
    const credential = byId.get(node.credentialId);
    if (credential && !isDraftComplete(toDraft(credential))) {
      seen.add(credential.id);
      out.push(credential);
    }
  }
  return out;
}

function serializeNode(node: WorkflowNode): WorkflowNode {
  // A presets collection carries none of the operation-only fields below
  // (operationId, requestMode, raw*, credential overrides) — writing them
  // anyway would round-trip meaningless stray keys.
  if (node.kind === 'presets') {
    return {
      id: node.id,
      kind: 'presets',
      credentialId: null,
      fieldValues: {},
      presets: (node.presets ?? []).map((p) => ({ ...p })),
    };
  }

  const out: WorkflowNode = {
    id: node.id,
    operationId: node.operationId,
    credentialId: node.credentialId ?? null,
    fieldValues: { ...node.fieldValues },
  };
  if (node.requestMode) out.requestMode = node.requestMode;
  if (node.rawPath) out.rawPath = cloneRawBody(node.rawPath);
  if (node.rawQuery) out.rawQuery = cloneRawBody(node.rawQuery);
  if (node.rawBody) out.rawBody = cloneRawBody(node.rawBody);
  return out;
}

function serializeCredentialStub(credential: Credential): CredentialStub {
  const base = {
    id: credential.id,
    name: credential.name,
    ...(credential.fromSecurityScheme ? { fromSecurityScheme: credential.fromSecurityScheme } : {}),
  };
  switch (credential.type) {
    case 'bearer':
      return { ...base, type: 'bearer' };
    case 'basic':
      return { ...base, type: 'basic', ...(credential.username ? { username: credential.username } : {}) };
    case 'apiKey':
      return { ...base, type: 'apiKey', paramName: credential.paramName, in: credential.in };
    case 'oauth2_clientCredentials':
      return {
        ...base,
        type: 'oauth2_clientCredentials',
        tokenUrl: credential.tokenUrl,
        ...(credential.clientId ? { clientId: credential.clientId } : {}),
        ...(credential.scope ? { scope: credential.scope } : {}),
        ...spreadExtraTokenParams(credential.extraTokenParams),
        clientAuthMethod: credential.clientAuthMethod,
      };
    case 'oauth2_password':
      return {
        ...base,
        type: 'oauth2_password',
        tokenUrl: credential.tokenUrl,
        ...(credential.username ? { username: credential.username } : {}),
        ...(credential.clientId ? { clientId: credential.clientId } : {}),
        ...(credential.scope ? { scope: credential.scope } : {}),
        ...spreadExtraTokenParams(credential.extraTokenParams),
        clientAuthMethod: credential.clientAuthMethod,
      };
    case 'cookie':
      return { ...base, type: 'cookie', ...(credential.loginUrl ? { loginUrl: credential.loginUrl } : {}) };
  }
}

function serializeFullCredential(credential: Credential): Credential {
  const base = {
    id: credential.id,
    name: credential.name,
    ...(credential.fromSecurityScheme ? { fromSecurityScheme: credential.fromSecurityScheme } : {}),
  };
  switch (credential.type) {
    case 'bearer':
      return { ...base, type: 'bearer', token: credential.token };
    case 'basic':
      return { ...base, type: 'basic', username: credential.username, password: credential.password };
    case 'apiKey':
      return {
        ...base,
        type: 'apiKey',
        paramName: credential.paramName,
        in: credential.in,
        key: credential.key,
      };
    case 'oauth2_clientCredentials':
      return {
        ...base,
        type: 'oauth2_clientCredentials',
        tokenUrl: credential.tokenUrl,
        clientId: credential.clientId,
        clientSecret: credential.clientSecret,
        ...(credential.scope ? { scope: credential.scope } : {}),
        ...spreadExtraTokenParams(credential.extraTokenParams),
        clientAuthMethod: credential.clientAuthMethod,
      };
    case 'oauth2_password':
      return {
        ...base,
        type: 'oauth2_password',
        tokenUrl: credential.tokenUrl,
        username: credential.username,
        password: credential.password,
        ...(credential.clientId ? { clientId: credential.clientId } : {}),
        ...(credential.clientSecret ? { clientSecret: credential.clientSecret } : {}),
        ...(credential.scope ? { scope: credential.scope } : {}),
        ...spreadExtraTokenParams(credential.extraTokenParams),
        clientAuthMethod: credential.clientAuthMethod,
      };
    case 'cookie':
      return { ...base, type: 'cookie', ...(credential.loginUrl ? { loginUrl: credential.loginUrl } : {}) };
  }
}

export function hydrateCredential(stub: CredentialStub): Credential {
  const base = {
    id: stub.id,
    name: stub.name,
    ...(stub.fromSecurityScheme ? { fromSecurityScheme: stub.fromSecurityScheme } : {}),
  };
  switch (stub.type) {
    case 'bearer':
      return { ...base, type: 'bearer', token: '' };
    case 'basic':
      return { ...base, type: 'basic', username: stub.username ?? '', password: '' };
    case 'apiKey':
      return { ...base, type: 'apiKey', paramName: stub.paramName, in: stub.in, key: '' };
    case 'oauth2_clientCredentials':
      return {
        ...base,
        type: 'oauth2_clientCredentials',
        tokenUrl: stub.tokenUrl,
        clientId: stub.clientId ?? '',
        clientSecret: '',
        ...(stub.scope ? { scope: stub.scope } : {}),
        ...spreadExtraTokenParams(stub.extraTokenParams),
        clientAuthMethod: stub.clientAuthMethod ?? 'basic',
      };
    case 'oauth2_password':
      return {
        ...base,
        type: 'oauth2_password',
        tokenUrl: stub.tokenUrl,
        username: stub.username ?? '',
        password: '',
        ...(stub.clientId ? { clientId: stub.clientId } : {}),
        clientSecret: '',
        ...(stub.scope ? { scope: stub.scope } : {}),
        ...spreadExtraTokenParams(stub.extraTokenParams),
        clientAuthMethod: stub.clientAuthMethod ?? 'basic',
      };
    case 'cookie':
      return { ...base, type: 'cookie', ...(stub.loginUrl ? { loginUrl: stub.loginUrl } : {}) };
  }
}

function hydrateCredentials(collection: EnlaceCollection): Credential[] {
  return collection.secrets === 'included'
    ? collection.credentials.map((credential) => serializeFullCredential(credential as Credential))
    : collection.credentials.map((credential) => hydrateCredential(credential as CredentialStub));
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: 'Could not parse Enlace collection as JSON.' };
  }
}

function parseNode(raw: unknown, index: number): WorkflowNode | string {
  if (!isRecord(raw) || typeof raw.id !== 'string') {
    return `Enlace collection has an invalid node at index ${index}.`;
  }

  // 'presets' packages an ordered list of presets as one executable unit —
  // needs no operationId at all, just its own `presets` array to validate.
  // Every node without this exact `kind` falls through to the 'operation'
  // shape below, exactly as before this field existed.
  if (raw.kind === 'presets') {
    const presets = parsePresetsList(raw.presets, raw.id);
    if (typeof presets === 'string') return presets;
    return { id: raw.id, kind: 'presets', credentialId: null, fieldValues: {}, presets };
  }

  if (typeof raw.operationId !== 'string') {
    return `Enlace collection has an invalid node at index ${index}.`;
  }
  if (raw.credentialId != null && typeof raw.credentialId !== 'string') {
    return `Enlace collection node "${raw.id}" has an invalid credentialId.`;
  }
  const fieldValues = parseFieldValues(raw.fieldValues, raw.id);
  if (typeof fieldValues === 'string') return fieldValues;

  const node: WorkflowNode = {
    id: raw.id,
    operationId: raw.operationId,
    credentialId: typeof raw.credentialId === 'string' ? raw.credentialId : null,
    fieldValues,
  };
  // Prefer requestMode; accept legacy bodyMode from older collections.
  const mode = raw.requestMode ?? raw.bodyMode;
  if (mode === 'form' || mode === 'raw') node.requestMode = mode;

  for (const key of ['rawPath', 'rawQuery', 'rawBody'] as const) {
    if (raw[key] != null) {
      const parsed = parseRawBody(raw[key], raw.id, key);
      if (typeof parsed === 'string') return parsed;
      node[key] = parsed;
    }
  }
  return node;
}

function parseAssertChecks(raw: unknown, presetsNodeId: string, presetId: string): AssertCheck[] | string {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    return `Enlace collection presets node "${presetsNodeId}" preset "${presetId}" has an invalid "checks" array.`;
  }
  const checks: AssertCheck[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const check = raw[i];
    if (!isRecord(check) || typeof check.id !== 'string' || isUnsafeKey(check.id)) {
      return `Enlace collection presets node "${presetsNodeId}" preset "${presetId}" has an invalid check at index ${i}.`;
    }
    if (seenIds.has(check.id)) {
      return `Enlace collection presets node "${presetsNodeId}" preset "${presetId}" has a duplicate check id "${check.id}".`;
    }
    const source = check.source;
    if (!isRecord(source) || typeof source.sourceNodeId !== 'string' || !isBodyTagType(source.type)) {
      return `Enlace collection presets node "${presetsNodeId}" preset "${presetId}" check "${check.id}" has an invalid source.`;
    }
    if (!isAssertOperator(check.operator)) {
      return `Enlace collection presets node "${presetsNodeId}" preset "${presetId}" check "${check.id}" has an invalid operator.`;
    }
    if (check.expected !== undefined && typeof check.expected !== 'string') {
      return `Enlace collection presets node "${presetsNodeId}" preset "${presetId}" check "${check.id}" has an invalid expected value.`;
    }
    const copySource: AssertCheck['source'] = { type: source.type, sourceNodeId: source.sourceNodeId };
    if (typeof source.jsonPath === 'string') copySource.jsonPath = source.jsonPath;
    if (typeof source.headerName === 'string') copySource.headerName = source.headerName;
    seenIds.add(check.id);
    checks.push({
      id: check.id,
      source: copySource,
      operator: check.operator,
      ...(check.expected !== undefined ? { expected: check.expected } : {}),
    });
  }
  return checks;
}

function parsePresetsList(raw: unknown, presetsNodeId: string): Preset[] | string {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return `Enlace collection presets node "${presetsNodeId}" has an invalid "presets" array.`;
  const presets: Preset[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const preset = raw[i];
    if (!isRecord(preset) || typeof preset.id !== 'string' || isUnsafeKey(preset.id)) {
      return `Enlace collection presets node "${presetsNodeId}" has an invalid preset at index ${i}.`;
    }
    if (seenIds.has(preset.id)) {
      return `Enlace collection presets node "${presetsNodeId}" has a duplicate preset id "${preset.id}".`;
    }
    // Every other kind is rejected outright rather than silently dropped —
    // a preset from a newer format this version doesn't understand
    // shouldn't quietly vanish from the collection.
    if (preset.kind === 'wait') {
      if (typeof preset.durationMs !== 'number' || !Number.isFinite(preset.durationMs) || preset.durationMs < 0) {
        return `Enlace collection presets node "${presetsNodeId}" preset "${preset.id}" has an invalid durationMs.`;
      }
      seenIds.add(preset.id);
      presets.push({ id: preset.id, kind: 'wait', durationMs: preset.durationMs });
    } else if (preset.kind === 'assert') {
      const checks = parseAssertChecks(preset.checks, presetsNodeId, preset.id);
      if (typeof checks === 'string') return checks;
      seenIds.add(preset.id);
      presets.push({ id: preset.id, kind: 'assert', checks });
    } else {
      return `Enlace collection presets node "${presetsNodeId}" has an unknown preset kind "${String(preset.kind)}".`;
    }
  }
  return presets;
}

function parseFieldValues(raw: unknown, nodeId: string): Record<string, FieldValue> | string {
  if (raw == null) return {};
  if (!isRecord(raw)) return `Enlace collection node "${nodeId}" has invalid fieldValues.`;
  const out: Record<string, FieldValue> = {};
  for (const [path, value] of Object.entries(raw)) {
    if (isUnsafeKey(path)) {
      return `Enlace collection node "${nodeId}" has an invalid field path "${path}".`;
    }
    if (!isRecord(value) || (value.source !== 'static' && value.source !== 'mapped' && value.source !== 'file')) {
      return `Enlace collection node "${nodeId}" has an invalid field value at "${path}".`;
    }
    if (value.source === 'static') {
      out[path] = { source: 'static', value: value.value };
    } else if (value.source === 'file') {
      if (typeof value.fileName !== 'string') {
        return `Enlace collection node "${nodeId}" has an invalid file field at "${path}".`;
      }
      out[path] = { source: 'file', fileName: value.fileName };
    } else if (typeof value.fromNodeId === 'string' && typeof value.fromResponseFieldPath === 'string') {
      out[path] = {
        source: 'mapped',
        fromNodeId: value.fromNodeId,
        fromResponseFieldPath: value.fromResponseFieldPath,
      };
    } else {
      return `Enlace collection node "${nodeId}" has an invalid mapped field at "${path}".`;
    }
  }
  return out;
}

function parseRawBody(raw: unknown, nodeId: string, fieldName = 'rawBody'): RawBody | string {
  if (!isRecord(raw) || typeof raw.template !== 'string' || !isRecord(raw.tags)) {
    return `Enlace collection node "${nodeId}" has an invalid ${fieldName}.`;
  }
  const tags: Record<string, BodyTag> = {};
  for (const [id, tag] of Object.entries(raw.tags)) {
    if (isUnsafeKey(id)) {
      return `Enlace collection node "${nodeId}" has an invalid ${fieldName} tag id "${id}".`;
    }
    if (!isRecord(tag) || typeof tag.id !== 'string' || typeof tag.sourceNodeId !== 'string' || !isBodyTagType(tag.type)) {
      return `Enlace collection node "${nodeId}" has an invalid ${fieldName} tag "${id}".`;
    }
    const copy: BodyTag = { id: tag.id, type: tag.type, sourceNodeId: tag.sourceNodeId };
    if (typeof tag.jsonPath === 'string') copy.jsonPath = tag.jsonPath;
    if (typeof tag.headerName === 'string') copy.headerName = tag.headerName;
    tags[id] = copy;
  }
  return { template: raw.template, tags };
}

function parseConnection(raw: unknown, index: number): WorkflowConnection | string {
  if (!isRecord(raw) || typeof raw.fromNodeId !== 'string' || typeof raw.toNodeId !== 'string') {
    return `Enlace collection has an invalid connection at index ${index}.`;
  }
  return { fromNodeId: raw.fromNodeId, toNodeId: raw.toNodeId };
}

function parseGroup(raw: unknown, index: number): NodeGroup | string {
  if (!isRecord(raw)) {
    return `Enlace collection has an invalid group at index ${index}.`;
  }
  if (typeof raw.id !== 'string' || isUnsafeKey(raw.id)) {
    return `Enlace collection has an invalid group id at index ${index}.`;
  }
  if (typeof raw.name !== 'string') {
    return `Enlace collection group "${raw.id}" is missing a name.`;
  }
  if (!Array.isArray(raw.nodeIds) || !raw.nodeIds.every((id) => typeof id === 'string')) {
    return `Enlace collection group "${raw.id}" has an invalid "nodeIds" array.`;
  }
  if (typeof raw.collapsed !== 'boolean') {
    return `Enlace collection group "${raw.id}" is missing a boolean "collapsed".`;
  }
  if (!isRecord(raw.position) || typeof raw.position.x !== 'number' || typeof raw.position.y !== 'number') {
    return `Enlace collection group "${raw.id}" has an invalid "position".`;
  }
  if (typeof raw.skipConfirmOnDrop !== 'boolean') {
    return `Enlace collection group "${raw.id}" is missing a boolean "skipConfirmOnDrop".`;
  }
  return {
    id: raw.id,
    name: raw.name.trim() || 'Group',
    nodeIds: [...raw.nodeIds],
    collapsed: raw.collapsed,
    position: { x: raw.position.x, y: raw.position.y },
    skipConfirmOnDrop: raw.skipConfirmOnDrop,
  };
}

/** Drop dangling member ids; dissolve groups left with fewer than 2 members. */
function sanitizeGroups(groups: NodeGroup[], knownNodeIds: Set<string>): NodeGroup[] {
  return groups
    .map((g) => ({
      ...g,
      name: g.name.trim() || 'Group',
      nodeIds: [...new Set(g.nodeIds.filter((id) => knownNodeIds.has(id)))],
      position: { x: g.position.x, y: g.position.y },
    }))
    .filter((g) => g.nodeIds.length >= 2);
}

/** Drop entries for anything that isn't an actual `kind: 'presets'` node in `nodes` — same dangling-reference cleanup as `sanitizeGroups`. */
function sanitizePresetsCollapsed(
  presetsCollapsed: Record<string, boolean>,
  nodes: WorkflowNode[]
): Record<string, boolean> {
  const presetsNodeIds = new Set(nodes.filter((n) => n.kind === 'presets').map((n) => n.id));
  const out: Record<string, boolean> = {};
  for (const [id, collapsed] of Object.entries(presetsCollapsed)) {
    if (presetsNodeIds.has(id)) out[id] = collapsed;
  }
  return out;
}

function parseCredentialStub(
  raw: unknown,
  index: number
): { stub: CredentialStub; secretsDiscarded: boolean } | string {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.type !== 'string') {
    return `Enlace collection has an invalid credential at index ${index}.`;
  }
  if (!CREDENTIAL_TYPES.has(raw.type)) {
    return `Enlace collection has an unknown credential type "${raw.type}" at index ${index}.`;
  }
  const secretsDiscarded = SECRET_KEYS.some((key) => Object.prototype.hasOwnProperty.call(raw, key));
  const base = {
    id: raw.id,
    name: raw.name,
    ...(typeof raw.fromSecurityScheme === 'string' ? { fromSecurityScheme: raw.fromSecurityScheme } : {}),
  };
  const type = raw.type as CredentialType;
  switch (type) {
    case 'bearer':
      return { stub: { ...base, type: 'bearer' }, secretsDiscarded };
    case 'basic':
      return {
        stub: { ...base, type: 'basic', ...(typeof raw.username === 'string' ? { username: raw.username } : {}) },
        secretsDiscarded,
      };
    case 'apiKey':
      return {
        stub: {
          ...base,
          type: 'apiKey',
          paramName: typeof raw.paramName === 'string' ? raw.paramName : '',
          in: raw.in === 'query' ? 'query' : 'header',
        },
        secretsDiscarded,
      };
    case 'oauth2_clientCredentials':
      return {
        stub: {
          ...base,
          type: 'oauth2_clientCredentials',
          tokenUrl: typeof raw.tokenUrl === 'string' ? raw.tokenUrl : '',
          ...(typeof raw.clientId === 'string' ? { clientId: raw.clientId } : {}),
          ...(typeof raw.scope === 'string' ? { scope: raw.scope } : {}),
          ...spreadExtraTokenParams(parseExtraTokenParams(raw.extraTokenParams)),
          clientAuthMethod: parseClientAuthMethod(raw.clientAuthMethod),
        },
        secretsDiscarded,
      };
    case 'oauth2_password':
      return {
        stub: {
          ...base,
          type: 'oauth2_password',
          tokenUrl: typeof raw.tokenUrl === 'string' ? raw.tokenUrl : '',
          ...(typeof raw.username === 'string' ? { username: raw.username } : {}),
          ...(typeof raw.clientId === 'string' ? { clientId: raw.clientId } : {}),
          ...(typeof raw.scope === 'string' ? { scope: raw.scope } : {}),
          ...spreadExtraTokenParams(parseExtraTokenParams(raw.extraTokenParams)),
          clientAuthMethod: parseClientAuthMethod(raw.clientAuthMethod),
        },
        secretsDiscarded,
      };
    case 'cookie':
      return {
        stub: {
          ...base,
          type: 'cookie',
          ...(typeof raw.loginUrl === 'string' && raw.loginUrl ? { loginUrl: raw.loginUrl } : {}),
        },
        secretsDiscarded,
      };
  }
}

function parseFullCredential(raw: unknown, index: number): { credential: Credential } | string {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.type !== 'string') {
    return `Enlace collection has an invalid credential at index ${index}.`;
  }
  if (!CREDENTIAL_TYPES.has(raw.type)) {
    return `Enlace collection has an unknown credential type "${raw.type}" at index ${index}.`;
  }
  const base = {
    id: raw.id,
    name: raw.name,
    ...(typeof raw.fromSecurityScheme === 'string' ? { fromSecurityScheme: raw.fromSecurityScheme } : {}),
  };
  const stringValue = (key: string) => (typeof raw[key] === 'string' ? raw[key] : '');
  switch (raw.type as CredentialType) {
    case 'bearer':
      return { credential: { ...base, type: 'bearer', token: stringValue('token') } };
    case 'basic':
      return {
        credential: {
          ...base,
          type: 'basic',
          username: stringValue('username'),
          password: stringValue('password'),
        },
      };
    case 'apiKey':
      return {
        credential: {
          ...base,
          type: 'apiKey',
          paramName: stringValue('paramName'),
          in: raw.in === 'query' ? 'query' : 'header',
          key: stringValue('key'),
        },
      };
    case 'oauth2_clientCredentials':
      return {
        credential: {
          ...base,
          type: 'oauth2_clientCredentials',
          tokenUrl: stringValue('tokenUrl'),
          clientId: stringValue('clientId'),
          clientSecret: stringValue('clientSecret'),
          ...(typeof raw.scope === 'string' ? { scope: raw.scope } : {}),
          ...spreadExtraTokenParams(parseExtraTokenParams(raw.extraTokenParams)),
          clientAuthMethod: parseClientAuthMethod(raw.clientAuthMethod),
        },
      };
    case 'oauth2_password':
      return {
        credential: {
          ...base,
          type: 'oauth2_password',
          tokenUrl: stringValue('tokenUrl'),
          username: stringValue('username'),
          password: stringValue('password'),
          ...(typeof raw.clientId === 'string' ? { clientId: raw.clientId } : {}),
          ...(typeof raw.clientSecret === 'string' ? { clientSecret: raw.clientSecret } : {}),
          ...(typeof raw.scope === 'string' ? { scope: raw.scope } : {}),
          ...spreadExtraTokenParams(parseExtraTokenParams(raw.extraTokenParams)),
          clientAuthMethod: parseClientAuthMethod(raw.clientAuthMethod),
        },
      };
    case 'cookie': {
      const loginUrl = stringValue('loginUrl');
      return { credential: { ...base, type: 'cookie', ...(loginUrl ? { loginUrl } : {}) } };
    }
  }
}

function parseClientAuthMethod(raw: unknown): OAuth2ClientAuthMethod {
  return raw === 'body' ? 'body' : 'basic';
}

function parseExtraTokenParams(raw: unknown): Record<string, string> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key === 'string' && key.trim() && typeof value === 'string') {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function spreadExtraTokenParams(
  params: Record<string, string> | undefined
): { extraTokenParams: Record<string, string> } | Record<string, never> {
  return params && Object.keys(params).length > 0 ? { extraTokenParams: { ...params } } : {};
}

function parseSpecHint(raw: unknown, nodes: WorkflowNode[]): CollectionWorkflow['specHint'] {
  const operationIds =
    isRecord(raw) && Array.isArray(raw.operationIds)
      ? raw.operationIds.filter((id): id is string => typeof id === 'string')
      : [...new Set(nodes.map(operationIdOf).filter((id): id is string => typeof id === 'string'))];
  const hint: CollectionWorkflow['specHint'] = { operationIds };
  if (isRecord(raw) && typeof raw.title === 'string') hint.title = raw.title;
  if (isRecord(raw) && typeof raw.version === 'string') hint.version = raw.version;
  return hint;
}

function cloneRawBody(rawBody: RawBody): RawBody {
  return {
    template: rawBody.template,
    tags: Object.fromEntries(Object.entries(rawBody.tags).map(([id, tag]) => [id, { ...tag }])),
  };
}

/**
 * `nodePositions`, `fieldValues`, and raw-body `tags` are all built by
 * bracket-assigning an imported file's own keys (node ids / field paths /
 * tag ids) into a plain `{}`. Assigning the literal key `"__proto__"` that
 * way doesn't add an entry — `Object.prototype`'s `__proto__` is an
 * accessor (Annex B), so `obj['__proto__'] = x` reassigns `obj`'s own
 * prototype to `x` instead, silently dropping the entry and corrupting the
 * object's prototype chain for later property lookups. A `.enlace` file is
 * meant to be shared between people, so a crafted key here is a plausible
 * input, not just a theoretical one — reject it up front alongside the
 * rest of this module's "invalid" checks.
 */
function isUnsafeKey(key: string): boolean {
  return key === '__proto__';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const BODY_TAG_TYPES: BodyTagType[] = ['response_body', 'response_raw', 'response_header', 'response_status'];
function isBodyTagType(value: unknown): value is BodyTagType {
  return typeof value === 'string' && (BODY_TAG_TYPES as string[]).includes(value);
}

const ASSERT_OPERATORS: AssertOperator[] = [
  'equals',
  'notEquals',
  'contains',
  'exists',
  'notExists',
  'greaterThan',
  'lessThan',
];
function isAssertOperator(value: unknown): value is AssertOperator {
  return typeof value === 'string' && (ASSERT_OPERATORS as string[]).includes(value);
}
