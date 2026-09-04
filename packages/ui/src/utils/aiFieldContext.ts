import { areFieldTypesCompatible, flattenResponseFields } from './flattenSchema.js';
import type { SchemaField } from './flattenSchema.js';
import type { AiCandidateBinding, AiCredentialOption, AiNodeSuggestionContext, Credential, Operation, WorkflowNode } from '../types.js';

/** OperationNode-only — a presets collection never has an operationId. Mirrors NodeConfig.tsx's own operationIdOf; duplicated here in miniature since this file has no other reason to import that component. */
function operationIdOf(node: WorkflowNode | undefined): string | undefined {
  return node && node.kind !== 'presets' ? node.operationId : undefined;
}

/**
 * Bridges Enlace's real data model (Operation/WorkflowNode/SchemaField/
 * Credential) into the portable, schema-only bundle @get-enlace/core's
 * ai/prompts.ts turns into a single LLM request covering every suggestable
 * field on one node, plus which credential (if any) to attach — see that
 * module's own header comment for why this split exists (the adapter, and
 * everything in packages/core/src/ai/, must stay ignorant of Enlace's data
 * model). Credentials are reduced to id/name/type only (`AiCredentialOption`)
 * — never a secret value — and captured `RunResult` response values are
 * never sent at all: only spec-declared shapes and credential identity
 * leave the browser here (see the plan's "Context content" decision).
 *
 * Each target field's own `candidateBindings` reuses the exact same "map
 * from…" filtering NodeConfig.tsx's own Mapped picker already applies
 * (flattenResponseFields + areFieldTypesCompatible), so a suggestion the
 * model returns for that field is always something the UI's own picker
 * would have offered too — never a mapping that could fail its own
 * compatibility check. `tagId`s are minted once per (ancestor, response
 * field) pair and reused across every target field they're compatible
 * with, so the same upstream field only ever gets one placeholder across
 * the whole node-level prompt.
 */
export function buildNodeSuggestionContext(params: {
  fields: SchemaField[];
  operation: Operation;
  ancestorNodes: WorkflowNode[];
  operations: Operation[];
  nodeLabels: Map<string, string>;
  /** Every credential configured in this workflow — reduced to id/name/type below (AiCredentialOption), never a secret value. */
  credentials: Credential[];
}): AiNodeSuggestionContext {
  const { fields, operation, ancestorNodes, operations, nodeLabels, credentials } = params;
  const operationsById = new Map(operations.map((o) => [o.id, o]));

  // Built once, independent of any one target field — every ancestor
  // response field that has a representable shape gets a stable tagId,
  // regardless of whether any target field can actually use it; per-field
  // compatibility is applied below, when assembling each target field's
  // own candidateBindings list.
  const allBindings: AiCandidateBinding[] = [];
  const ancestorOperations: AiNodeSuggestionContext['ancestorOperations'] = [];

  ancestorNodes.forEach((node, nodeIndex) => {
    const sourceOperation = operationsById.get(operationIdOf(node) ?? '');
    if (!sourceOperation) return;

    const nodeLabel = nodeLabels.get(node.id) ?? node.id;
    ancestorOperations.push({
      nodeLabel,
      method: sourceOperation.method,
      path: sourceOperation.path,
      summary: sourceOperation.summary,
    });

    flattenResponseFields(sourceOperation).forEach((rf, fieldIndex) => {
      if (!rf.supported) return;
      allBindings.push({
        // Synthetic and scoped to this one request — never a real BodyTag
        // id, never persisted (see AiCandidateBinding's own comment).
        tagId: `af${nodeIndex}_${fieldIndex}`,
        fromNodeId: node.id,
        fromNodeLabel: nodeLabel,
        fromResponseFieldPath: rf.path,
        type: rf.type,
      });
    });
  });

  const targetFields: AiNodeSuggestionContext['targetFields'] = fields.map((field) => ({
    path: field.path,
    required: field.required,
    type: field.type,
    format: field.format,
    enum: field.enum,
    candidateBindings: allBindings.filter((b) => areFieldTypesCompatible(field.type, b.type)),
  }));

  const availableCredentials: AiCredentialOption[] = credentials.map((c) => ({ id: c.id, name: c.name, type: c.type }));

  return {
    targetFields,
    currentOperation: {
      method: operation.method,
      path: operation.path,
      summary: operation.summary,
      requiredCredentialTypes: operation.requiredCredentialTypes,
    },
    ancestorOperations,
    availableCredentials,
  };
}
