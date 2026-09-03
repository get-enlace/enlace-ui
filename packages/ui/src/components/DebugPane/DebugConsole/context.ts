import { isDraftComplete, toDraft } from '../../../utils/credentialDraft.js';
import { redactRequest } from '../debugPaneShared.js';
import type { Credential, Operation, RunStep, RunStepRequest, RunStepStatus, WorkflowNode } from '../../../types.js';
import {
  consoleNodeKey,
  type ConsoleCredentialStub,
  type ConsoleFocus,
  type ConsoleNodeContext,
  type ConsoleRunContext,
} from './types.js';

export function extractPathParams(template: string, pathname: string): Record<string, string> {
  if (!template) return {};
  const names: string[] = [];
  const pattern = template
    .split('/')
    .map((seg) => {
      const m = seg.match(/^\{([^}]+)\}$/);
      if (m) {
        names.push(m[1]);
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  const re = new RegExp(`${pattern}/?$`);
  const match = pathname.match(re);
  if (!match) return {};
  const out: Record<string, string> = {};
  names.forEach((name, i) => {
    try {
      out[name] = decodeURIComponent(match[i + 1] ?? '');
    } catch {
      out[name] = match[i + 1] ?? '';
    }
  });
  return out;
}

export function extractQueryParams(url: string): Record<string, string> {
  try {
    const parsed = new URL(url);
    const out: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  } catch {
    return {};
  }
}

export function buildConsoleNodeContext(
  request: RunStepRequest,
  extras?: { response?: RunStep['response']; error?: string; operationPath?: string }
): ConsoleNodeContext {
  const redacted = redactRequest(request);
  let pathname = '';
  try {
    pathname = new URL(redacted.url).pathname;
  } catch {
    pathname = redacted.url.split('?')[0] ?? '';
  }

  const node: ConsoleNodeContext = {
    request: {
      method: redacted.method,
      url: redacted.url,
      path: pathname,
      params: extractPathParams(extras?.operationPath ?? '', pathname),
      query: extractQueryParams(redacted.url),
      headers: redacted.headers,
      ...(redacted.body !== undefined ? { payload: redacted.body } : {}),
    },
  };
  if (extras?.response) {
    node.response = {
      status: extras.response.status,
      headers: extras.response.headers,
      body: extras.response.body,
      ...(extras.error ? { error: extras.error } : {}),
    };
  } else if (extras?.error) {
    node.response = {
      status: 0,
      headers: {},
      body: undefined,
      error: extras.error,
    };
  }
  return node;
}

export function buildConsoleCredentials(credentials: Credential[]): Record<string, ConsoleCredentialStub> {
  const out: Record<string, ConsoleCredentialStub> = {};
  for (const c of credentials) {
    const key = consoleNodeKey(c.name);
    out[key] = {
      name: c.name,
      type: c.type,
      complete: isDraftComplete(toDraft(c)),
    };
  }
  return out;
}

/**
 * Always returns a `$` context (may have empty nodes). Focus shorthand is
 * set when a node with a request is focused.
 */
export function resolveConsoleFocus(args: {
  nodes: WorkflowNode[];
  orderedNodes: WorkflowNode[];
  selectedNodeId: string | null;
  stepStatusByNodeId: Record<string, RunStepStatus>;
  stepsByNodeId: Map<string, RunStep>;
  previewRequestByNodeId: Record<string, RunStepRequest>;
  operationsById: Map<string, Operation>;
  nodeLabels: Map<string, string>;
  credentials: Credential[];
}): ConsoleFocus {
  const {
    nodes,
    orderedNodes,
    selectedNodeId,
    stepStatusByNodeId,
    stepsByNodeId,
    previewRequestByNodeId,
    operationsById,
    nodeLabels,
    credentials,
  } = args;

  const operationPathFor = (nodeId: string): string | undefined => {
    const n = nodes.find((x) => x.id === nodeId);
    if (!n?.operationId) return undefined;
    return operationsById.get(n.operationId)?.path;
  };

  const contextFor = (nodeId: string): ConsoleNodeContext | null => {
    const opPath = operationPathFor(nodeId);
    const step = stepsByNodeId.get(nodeId);
    if (step) {
      return buildConsoleNodeContext(step.request, {
        response: step.response,
        error: step.error,
        operationPath: opPath,
      });
    }
    const preview = previewRequestByNodeId[nodeId];
    if (preview) return buildConsoleNodeContext(preview, { operationPath: opPath });
    return null;
  };

  const nodeMap: Record<string, ConsoleNodeContext> = {};
  const nodeOrder: string[] = [];
  const keyByNodeId = new Map<string, string>();
  for (const node of orderedNodes) {
    const ctx = contextFor(node.id);
    if (!ctx) continue;
    const label = nodeLabels.get(node.id) ?? node.id;
    const key = consoleNodeKey(label);
    nodeMap[key] = ctx;
    nodeOrder.push(key);
    keyByNodeId.set(node.id, key);
  }

  const pickFocusId = (): string | null => {
    if (selectedNodeId && keyByNodeId.has(selectedNodeId)) return selectedNodeId;
    const pausedIds = orderedNodes.filter((n) => stepStatusByNodeId[n.id] === 'paused').map((n) => n.id);
    const pauseFocusId = pausedIds.includes(selectedNodeId ?? '') ? selectedNodeId! : pausedIds[0];
    if (pauseFocusId && keyByNodeId.has(pauseFocusId)) return pauseFocusId;
    for (let i = orderedNodes.length - 1; i >= 0; i--) {
      if (keyByNodeId.has(orderedNodes[i].id)) return orderedNodes[i].id;
    }
    return null;
  };

  const focusId = pickFocusId();
  const focusKey = focusId ? keyByNodeId.get(focusId)! : null;
  const focusLabel = focusId ? (nodeLabels.get(focusId) ?? focusId) : null;
  const focusNode = focusKey ? nodeMap[focusKey] : null;

  const context: ConsoleRunContext = {
    focus: focusLabel,
    focusKey,
    nodes: nodeMap,
    nodeOrder,
    credentials: buildConsoleCredentials(credentials),
    ...(focusNode
      ? {
          request: focusNode.request,
          response: focusNode.response,
        }
      : {}),
  };

  return { nodeId: focusId, label: focusLabel, context };
}

