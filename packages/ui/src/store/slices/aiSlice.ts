import type { StateCreator } from 'zustand';
import {
  buildNodeLabels,
  buildNodeSuggestionMessages,
  computeAncestors,
  parseNodeSuggestionResponse,
} from '@get-enlace/core';
import { fetchAiCapabilities, postAiComplete } from '../../api/aiClient.js';
import type { AiCapabilitiesResponse } from '../../api/aiClient.js';
import { buildNodeSuggestionContext } from '../../utils/aiFieldContext.js';
import { coerceStaticValue } from '../../utils/coerceValue.js';
import { flattenRequestFields } from '../../utils/flattenSchema.js';
import type { FieldValue, Operation } from '../../types.js';
import type { WorkflowState } from '../types.js';

export type AiSuggestionEntry =
  | { status: 'loading' }
  | { status: 'suggested'; fieldValue: FieldValue; rawText: string }
  /** The model considered the field and found no feasible value (the NO_SUGGESTION_SENTINEL reply) — distinct from 'error': nothing failed, there's just nothing to offer. */
  | { status: 'none' }
  | { status: 'error'; error: string };

export type AiCredentialSuggestionEntry =
  | { status: 'loading' }
  | { status: 'suggested'; credentialId: string }
  | { status: 'none' }
  | { status: 'error'; error: string };

/** Key for aiSuggestionsByKey — same "nodeId::fieldPath" shape as store/types.ts's uploadedFileKey. */
export function aiSuggestionKey(nodeId: string, fieldPath: string): string {
  return `${nodeId}::${fieldPath}`;
}

/** Fields requestNodeSuggestions asks the model about — path/query/body, never header, never a field the schema can't represent. Shared with NodeConfig.tsx's own canSuggest gating (renderField), kept here too since the slice needs the same list independent of what's currently rendered. */
function suggestableFieldsOf(operation: Operation) {
  return flattenRequestFields(operation).filter((f) => f.supported && !f.path.startsWith('header.'));
}

export interface AiSlice {
  /** null = not checked yet. Every AI-related render anywhere must gate on `aiCapabilities?.enabled === true` — both null and {enabled:false} render nothing. */
  aiCapabilities: AiCapabilitiesResponse | null;
  aiSuggestionsByKey: Record<string, AiSuggestionEntry>;
  /** Live AI credential-suggestion state, keyed by nodeId — populated by the same requestNodeSuggestions call as aiSuggestionsByKey, just a separate record since a credential isn't a request field. */
  aiCredentialSuggestionByNodeId: Record<string, AiCredentialSuggestionEntry>;
  /** Stale-reply guard: one counter per NODE, bumped on every requestNodeSuggestions call — a single call resolves every suggestable field (and the credential) on that node together, so one generation number covers all of them. A resolving async call only applies its result if the generation it captured still matches. */
  aiSuggestionGenerationByNodeId: Record<string, number>;
  loadAiCapabilities: () => Promise<void>;
  /** Fire-and-forget — never awaited by the caller, never touches isRunning/isLocked, never disables any field itself (see this file's own comment below). One LLM call covers every suggestable field on the node, plus a credential recommendation, at once — deliberately not one call per field, which would multiply provider cost by field count for no real benefit. */
  requestNodeSuggestions: (nodeId: string) => void;
  acceptAiSuggestion: (nodeId: string, fieldPath: string) => void;
  dismissAiSuggestion: (nodeId: string, fieldPath: string) => void;
  /** Applies every currently-'suggested' field (and the credential, if suggested) on the node in one go, then clears all of that node's entries — same underlying setFieldValue/setCredential calls as accepting each individually, just batched. Entries in 'loading'/'none'/'error' are left untouched by the apply step, but are cleared along with everything else at the end (an error, in particular, shouldn't linger once the user has decided to move on). */
  acceptAllAiSuggestions: (nodeId: string) => void;
  /** Clears every suggestion entry (fields and credential) for the node without applying any of them. */
  dismissAllAiSuggestions: (nodeId: string) => void;
}

export const createAiSlice: StateCreator<WorkflowState, [], [], AiSlice> = (set, get) => ({
  aiCapabilities: null,
  aiSuggestionsByKey: {},
  aiCredentialSuggestionByNodeId: {},
  aiSuggestionGenerationByNodeId: {},

  loadAiCapabilities: async () => {
    // fetchAiCapabilities already degrades to {enabled:false} on any
    // failure — nothing to catch here, and no `error` state to set: AI
    // being unavailable is never a blocking app error.
    const aiCapabilities = await fetchAiCapabilities();
    set({ aiCapabilities });
  },

  requestNodeSuggestions: (nodeId) => {
    const { nodes, operations, credentials } = get();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || node.kind !== 'operation') return;
    const operation = operations.find((o) => o.id === node.operationId);
    if (!operation) return;

    const fields = suggestableFieldsOf(operation);
    if (fields.length === 0) return;

    const keys = fields.map((f) => aiSuggestionKey(nodeId, f.path));
    const generation = (get().aiSuggestionGenerationByNodeId[nodeId] ?? 0) + 1;

    set((state) => ({
      aiSuggestionGenerationByNodeId: { ...state.aiSuggestionGenerationByNodeId, [nodeId]: generation },
      aiSuggestionsByKey: {
        ...state.aiSuggestionsByKey,
        ...Object.fromEntries(keys.map((key) => [key, { status: 'loading' } as const])),
      },
      aiCredentialSuggestionByNodeId: { ...state.aiCredentialSuggestionByNodeId, [nodeId]: { status: 'loading' } },
    }));

    // Deliberately not returned/awaited — the caller (NodeConfig.tsx's
    // onClick) fires this and moves on immediately. Only these keys' own
    // entries (which decorate the node-level Suggest button and each
    // field's own panel) reflect 'loading'; the rest of the canvas,
    // including every field's input, stays fully interactive for the
    // whole round trip.
    void (async () => {
      try {
        const { nodes: currentNodes, connections, operations: currentOperations, credentials: currentCredentials } = get();
        const ancestorIds = computeAncestors(currentNodes, connections, nodeId);
        const ancestorNodes = currentNodes.filter((n) => ancestorIds.has(n.id));
        const operationsById = new Map(currentOperations.map((o) => [o.id, o]));
        const nodeLabels = buildNodeLabels(currentNodes, operationsById);

        const ctx = buildNodeSuggestionContext({
          fields,
          operation,
          ancestorNodes,
          operations: currentOperations,
          nodeLabels,
          credentials: currentCredentials,
        });
        const rawText = await postAiComplete(buildNodeSuggestionMessages(ctx));
        const parsed = parseNodeSuggestionResponse(rawText, ctx);

        // Stale-reply guard: if the user re-requested this node since this
        // call started, that later call's own resolution owns the final
        // state, not this one.
        if (get().aiSuggestionGenerationByNodeId[nodeId] !== generation) return;

        set((state) => {
          const nextByKey = { ...state.aiSuggestionsByKey };
          for (const field of fields) {
            const key = aiSuggestionKey(nodeId, field.path);
            const result = parsed.fields.get(field.path) ?? { kind: 'none' as const };
            if (result.kind === 'none') {
              nextByKey[key] = { status: 'none' };
            } else {
              const fieldValue: FieldValue =
                result.kind === 'mapped'
                  ? { source: 'mapped', fromNodeId: result.fromNodeId, fromResponseFieldPath: result.fromResponseFieldPath }
                  : { source: 'static', value: coerceStaticValue(result.rawValue, field.type) };
              nextByKey[key] = { status: 'suggested', fieldValue, rawText };
            }
          }

          const credentialEntry: AiCredentialSuggestionEntry =
            parsed.credential.kind === 'suggested'
              ? { status: 'suggested', credentialId: parsed.credential.credentialId }
              : { status: 'none' };

          return {
            aiSuggestionsByKey: nextByKey,
            aiCredentialSuggestionByNodeId: { ...state.aiCredentialSuggestionByNodeId, [nodeId]: credentialEntry },
          };
        });
      } catch (err) {
        if (get().aiSuggestionGenerationByNodeId[nodeId] !== generation) return;
        const error = err instanceof Error ? err.message : String(err);
        set((state) => ({
          aiSuggestionsByKey: {
            ...state.aiSuggestionsByKey,
            ...Object.fromEntries(keys.map((key) => [key, { status: 'error', error } as const])),
          },
          aiCredentialSuggestionByNodeId: { ...state.aiCredentialSuggestionByNodeId, [nodeId]: { status: 'error', error } },
        }));
      }
    })();
  },

  acceptAiSuggestion: (nodeId, fieldPath) => {
    const key = aiSuggestionKey(nodeId, fieldPath);
    const entry = get().aiSuggestionsByKey[key];
    if (!entry || entry.status !== 'suggested') return;
    // Reuses the existing, already isLocked-guarded mutation path — no new
    // field-writing logic. The row re-renders exactly like a manual edit
    // would, including flipping Source to Mapped when applicable.
    get().setFieldValue(nodeId, fieldPath, entry.fieldValue);
    set((state) => {
      const rest = { ...state.aiSuggestionsByKey };
      delete rest[key];
      return { aiSuggestionsByKey: rest };
    });
  },

  dismissAiSuggestion: (nodeId, fieldPath) => {
    const key = aiSuggestionKey(nodeId, fieldPath);
    set((state) => {
      const rest = { ...state.aiSuggestionsByKey };
      delete rest[key];
      return { aiSuggestionsByKey: rest };
    });
  },

  acceptAllAiSuggestions: (nodeId) => {
    const { aiSuggestionsByKey, aiCredentialSuggestionByNodeId, setFieldValue, setCredential } = get();
    const prefix = `${nodeId}::`;

    for (const [key, entry] of Object.entries(aiSuggestionsByKey)) {
      if (!key.startsWith(prefix) || entry.status !== 'suggested') continue;
      const fieldPath = key.slice(prefix.length);
      setFieldValue(nodeId, fieldPath, entry.fieldValue);
    }

    const credentialEntry = aiCredentialSuggestionByNodeId[nodeId];
    if (credentialEntry?.status === 'suggested') {
      setCredential(nodeId, credentialEntry.credentialId);
    }

    get().dismissAllAiSuggestions(nodeId);
  },

  dismissAllAiSuggestions: (nodeId) => {
    const prefix = `${nodeId}::`;
    set((state) => {
      const nextByKey = { ...state.aiSuggestionsByKey };
      for (const key of Object.keys(nextByKey)) {
        if (key.startsWith(prefix)) delete nextByKey[key];
      }
      const nextCredential = { ...state.aiCredentialSuggestionByNodeId };
      delete nextCredential[nodeId];
      return { aiSuggestionsByKey: nextByKey, aiCredentialSuggestionByNodeId: nextCredential };
    });
  },
});
