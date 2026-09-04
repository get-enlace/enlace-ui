import { makeTagPlaceholder, tagPattern } from '../bodyTags.js';
import type { AiCandidateBinding, AiChatMessage, AiCredentialOption, AiNodeSuggestionContext, AiTargetField } from './types.js';

/**
 * Literal reply text the model is instructed to send back, per field (and
 * for the credential line), when no feasible value/choice exists —
 * parseNodeSuggestionResponse treats this (trimmed, exact match) as "no
 * suggestion", never as a literal static string value someone genuinely
 * wanted stored.
 */
export const NO_SUGGESTION_SENTINEL = 'NO_SUGGESTION';

/** Reserved line key for the credential suggestion — never a legal field path (every real target field path is prefixed `path.`/`query.`/`body.`), so it can share the same `<key>: <answer>` reply line format without any ambiguity. */
const CREDENTIAL_KEY = 'credential';

function describeField(field: AiTargetField): string {
  const parts = [field.type ?? 'unknown type'];
  if (field.format) parts.push(`format: ${field.format}`);
  if (field.enum?.length) parts.push(`one of: ${field.enum.map(String).join(', ')}`);
  return `${field.path} (${parts.join(', ')}${field.required ? ', required' : ''})`;
}

function describeBinding(binding: AiCandidateBinding): string {
  return `${makeTagPlaceholder(binding.tagId)} — "${binding.fromResponseFieldPath}" from "${binding.fromNodeLabel}"${binding.type ? ` (${binding.type})` : ''}`;
}

function describeTargetField(field: AiTargetField, index: number): string {
  const bindingLines = field.candidateBindings.length
    ? field.candidateBindings.map((b) => `   - ${describeBinding(b)}`).join('\n')
    : '   (none available — this field has no compatible upstream data to map from)';
  return [`${index + 1}. ${describeField(field)}`, '   Available placeholders:', bindingLines].join('\n');
}

function describeCredential(cred: AiCredentialOption): string {
  return `- ${cred.id} — "${cred.name}" (${cred.type})`;
}

/**
 * Builds the system + user messages for one node-suggestion call — every
 * suggestable field on the node (path/query/body, never header, never a
 * field the schema can't represent) plus which credential (if any) to
 * attach, all asked about together in a single request, rather than one
 * call per field or a separate call for the credential: cheaper, and lets
 * the model see the whole node at once instead of each piece in isolation.
 *
 * The system prompt spends its first few lines explaining what Enlace, a
 * node, and a credential actually are — this is meant to stand alone for a
 * model with no other context about the product, not assume prior
 * familiarity.
 */
export function buildNodeSuggestionMessages(ctx: AiNodeSuggestionContext): AiChatMessage[] {
  const system = [
    'You are an assistant embedded in Enlace, a visual API workflow canvas. Enlace lets a user drag OpenAPI operations onto a canvas as "nodes", connect one node\'s output into another node\'s input fields, and run the resulting chain of HTTP requests directly from the browser.',
    'A "node" represents one HTTP operation (e.g. POST /orders) plus the concrete values it will send: its path parameters, query parameters, and request body fields (together, its "fields"), and optionally a "credential" used to authenticate the request.',
    'A "credential" holds how to authenticate with the target API (e.g. a bearer token, HTTP basic auth, an API key, an OAuth2 client-credentials or password grant). You are only ever shown a credential\'s id, name, and type here — never its secret value — and you may only ever recommend one by id, never invent one.',
    'Your job: for the one target node described below, suggest a value for each of its target fields, and separately decide which available credential (if any) it should use.',
    "A field's value is either a plain value, or a reference to an upstream node's response written as a placeholder in the exact form {{enlace:<tagId>}} — never any other syntax.",
    `Reply with exactly one line per item below, each in the form "<key>: <answer>", in this exact order: first "${CREDENTIAL_KEY}", then one line per target field in the order they're listed. Nothing else: no markdown, no blank lines, no headers, no explanation.`,
    `For "${CREDENTIAL_KEY}", <answer> is exactly one of: (1) one of the available credential ids listed below, verbatim, if one is a reasonable fit; (2) the exact text ${NO_SUGGESTION_SENTINEL} if none fit or none are needed.`,
    `For each target field, <answer> is exactly one of: (1) one of that field's own listed placeholders, verbatim, if it is a feasible value; (2) a plain static value that fits the field's type/format/enum, if no listed placeholder fits but a reasonable literal value exists; (3) the exact text ${NO_SUGGESTION_SENTINEL} if neither applies.`,
  ].join('\n');

  const requiredCredLine = ctx.currentOperation.requiredCredentialTypes?.length
    ? `This operation's declared security requirement accepts: ${ctx.currentOperation.requiredCredentialTypes.join(', ')}.`
    : "This operation's spec declares no security requirement (or one this feature doesn't recognize) — a credential may still be relevant, or may not be needed at all.";

  const credentialLines = ctx.availableCredentials.length
    ? ctx.availableCredentials.map(describeCredential).join('\n')
    : '(none configured in this workflow yet)';

  const user = [
    `Target node: ${ctx.currentOperation.method.toUpperCase()} ${ctx.currentOperation.path}${ctx.currentOperation.summary ? ` — ${ctx.currentOperation.summary}` : ''}`,
    requiredCredLine,
    ctx.ancestorOperations.length
      ? `Upstream operations already in this chain:\n${ctx.ancestorOperations
          .map((o) => `- ${o.nodeLabel}: ${o.method.toUpperCase()} ${o.path}${o.summary ? ` — ${o.summary}` : ''}`)
          .join('\n')}`
      : 'No upstream operations are connected yet.',
    `Available credentials:\n${credentialLines}`,
    `Target fields:\n${ctx.targetFields.map(describeTargetField).join('\n')}`,
    `Suggest a credential (or ${NO_SUGGESTION_SENTINEL}) and a value for each target field listed above.`,
  ].join('\n\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export type FieldSuggestionResult =
  | { kind: 'mapped'; fromNodeId: string; fromResponseFieldPath: string }
  | { kind: 'static'; rawValue: string }
  | { kind: 'none' };

export type CredentialSuggestionResult = { kind: 'suggested'; credentialId: string } | { kind: 'none' };

export interface NodeSuggestionResult {
  fields: Map<string, FieldSuggestionResult>;
  credential: CredentialSuggestionResult;
}

function parseOneFieldAnswer(answer: string, candidateBindings: AiCandidateBinding[]): FieldSuggestionResult {
  if (answer === NO_SUGGESTION_SENTINEL) return { kind: 'none' };

  const matches = [...answer.matchAll(tagPattern())];
  if (matches.length === 1 && matches[0][0] === answer) {
    const binding = candidateBindings.find((b) => b.tagId === matches[0][1]);
    if (binding) {
      return { kind: 'mapped', fromNodeId: binding.fromNodeId, fromResponseFieldPath: binding.fromResponseFieldPath };
    }
  }

  return { kind: 'static', rawValue: answer };
}

function parseCredentialAnswer(answer: string, availableCredentials: AiCredentialOption[]): CredentialSuggestionResult {
  if (answer === NO_SUGGESTION_SENTINEL) return { kind: 'none' };
  // An id the model didn't actually see listed (hallucinated or malformed)
  // is treated the same as "no suggestion" — unlike a field's static-value
  // fallback, there's no meaningful "literal" credential to fall back to.
  const known = availableCredentials.find((c) => c.id === answer);
  return known ? { kind: 'suggested', credentialId: known.id } : { kind: 'none' };
}

/**
 * Parses the model's `<key>: <answer>` reply — one line for `credential`,
 * one per target field — back into a suggestion per field plus a
 * credential suggestion. A line whose key doesn't match `credential` or any
 * target field's path (hallucinated or malformed) is ignored; an item the
 * model never produced a line for resolves to `{kind:'none'}` rather than
 * being left out, so callers never have to special-case a missing entry.
 * Each field's answer is only ever matched against *that field's own*
 * `candidateBindings` — same "whole match, nothing else in the string"
 * rule bodyTags.ts's own resolveTagsInString uses — so a suggestion can
 * never reference a binding that wasn't declared compatible for that
 * specific field, and the credential answer is only ever matched against
 * `ctx.availableCredentials`. Final `FieldValue` construction (`source:
 * 'static' | 'mapped'`, plus `coerceStaticValue`) and the node's
 * `credentialId` assignment both stay UI-owned — this only decides *which*
 * of the possible answers, and supplies the raw pieces.
 */
export function parseNodeSuggestionResponse(rawText: string, ctx: AiNodeSuggestionContext): NodeSuggestionResult {
  const byPath = new Map(ctx.targetFields.map((f) => [f.path, f]));
  const fields = new Map<string, FieldSuggestionResult>();
  let credential: CredentialSuggestionResult = { kind: 'none' };
  let sawCredentialLine = false;

  for (const rawLine of rawText.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const sep = line.indexOf(':');
    if (sep === -1) continue;

    const key = line.slice(0, sep).trim();
    const answer = line.slice(sep + 1).trim();

    if (key === CREDENTIAL_KEY) {
      if (sawCredentialLine) continue; // first line for this key wins, same as fields below
      sawCredentialLine = true;
      credential = parseCredentialAnswer(answer, ctx.availableCredentials);
      continue;
    }

    const field = byPath.get(key);
    if (!field || fields.has(key)) continue;
    fields.set(key, parseOneFieldAnswer(answer, field.candidateBindings));
  }

  for (const field of ctx.targetFields) {
    if (!fields.has(field.path)) fields.set(field.path, { kind: 'none' });
  }

  return { fields, credential };
}
