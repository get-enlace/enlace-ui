// Portable AI-assist plumbing — shared shapes for talking to the adapter's
// dumb LLM-proxy endpoint (see examples/sample-api/enlace.ts's
// EnlaceAiOptions / POST api/ai/complete) and for describing what an AI
// feature is being asked to do. Deliberately provider-agnostic and
// Enlace-shaped-but-thin: nothing here reaches into WorkflowNode/Operation
// directly — the UI-owned bridge (packages/ui/src/utils/aiFieldContext.ts)
// builds an AiNodeSuggestionContext from the real data model; this module
// (and prompts.ts alongside it) only knows how to turn that bundle into
// chat messages and parse a reply back. Idea 1 (a future chat-driven
// workflow builder) is expected to add its own sibling context/prompt-
// builder here later, reusing AiChatMessage and the adapter-call plumbing,
// not this file's field-suggestion-specific shapes.

/** Generic chat-completions message — the wire shape the adapter's POST api/ai/complete accepts, independent of which provider is actually configured server-side. */
export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** What the adapter reports at GET api/ai/capabilities — checked before any AI affordance renders (see store/slices/aiSlice.ts's loadAiCapabilities). Absent provider/model when disabled is deliberate: don't leak adapter config to an operator who hasn't opted in. */
export type AiCapabilities = { enabled: false } | { enabled: true; provider: string; model: string };

/**
 * One field on an ancestor node's response a target field may reference as
 * a mapped `FieldValue` — pre-filtered by the UI (flattenResponseFields +
 * areFieldTypesCompatible) against the *specific* target field it's nested
 * under in `AiTargetField.candidateBindings`, so every entry there is a
 * legitimate answer for that field, not just a candidate to double-check.
 * `tagId` is synthetic — minted fresh per suggestion request (see
 * utils/aiFieldContext.ts) from `(ancestor index, response-field index)`,
 * shared across every target field it's compatible with — never a real
 * persisted `BodyTag` id — it only exists so the model has something short
 * and stable to echo back inside a `{{enlace:<tagId>}}` placeholder (see
 * bodyTags.ts's own tagPattern/makeTagPlaceholder, reused as-is by
 * prompts.ts for this).
 */
export interface AiCandidateBinding {
  tagId: string;
  fromNodeId: string;
  fromNodeLabel: string;
  fromResponseFieldPath: string;
  type?: string;
}

/** One request field the model is being asked to suggest a value for, alongside the upstream response fields it could legitimately map from. */
export interface AiTargetField {
  path: string;
  required: boolean;
  type?: string;
  format?: string;
  enum?: unknown[];
  candidateBindings: AiCandidateBinding[];
}

/** One credential the model may recommend attaching to the node — name/type only, never a secret value; see AiNodeSuggestionContext.availableCredentials's own comment. */
export interface AiCredentialOption {
  id: string;
  name: string;
  type: string;
}

/**
 * Everything the model needs to suggest a value for every suggestable
 * field on one node, plus (optionally) which credential to attach to it, in
 * a single call — spec-declared shapes only (see this module's own header
 * comment): never a credential's secret value, never a captured RunResult
 * response body/value. One call per node (not per field) is deliberate:
 * it's the difference between one LLM round trip and N of them for an
 * N-field request. Built by
 * packages/ui/src/utils/aiFieldContext.ts's buildNodeSuggestionContext,
 * consumed by prompts.ts's buildNodeSuggestionMessages /
 * parseNodeSuggestionResponse.
 */
export interface AiNodeSuggestionContext {
  targetFields: AiTargetField[];
  currentOperation: {
    method: string;
    path: string;
    summary?: string;
    /**
     * Credential type(s) the spec's own `security` requirement declares for
     * this operation (Operation.requiredCredentialTypes, passed through
     * as-is) — e.g. `['bearer']`. Omitted when the spec declares none, or
     * only a scheme this phase can't resolve to a type; never inferred or
     * guessed beyond what the spec actually states.
     */
    requiredCredentialTypes?: string[];
  };
  ancestorOperations: Array<{
    nodeLabel: string;
    method: string;
    path: string;
    summary?: string;
  }>;
  /**
   * Every credential already configured in this workflow, id/name/type
   * only — never a secret value (token, password, key, clientSecret, …).
   * The model may recommend one of these ids for the node; it never
   * fabricates a new credential or sees enough to fabricate one
   * meaningfully anyway.
   */
  availableCredentials: AiCredentialOption[];
}
