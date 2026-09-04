// Adapter-side translation from Enlace's generic chat-completions wire
// shape (see enlace.ts's EnlaceAiOptions / POST api/ai/complete) to the
// OpenAI chat-completions wire shape — the only one this adapter speaks.
// Kept as its own file rather than folded into enlace.ts, so enlace.ts
// stays close to what @get-enlace/express will eventually need to
// hand-sync (see that file's own header comment) — this is the part most
// likely to grow (retries, alternate wire shapes) and least likely to need
// staying in sync by hand.
//
// Everything here is deliberately ignorant of Enlace's data model —
// Operations, WorkflowNode, schemas — it only ever sees an already-built
// messages array and forwards it. See ARCHITECTURE.md's "Browser ↔ adapter
// ↔ LLM provider" section for why that split matters.
import type { EnlaceAiOptions } from './enlace.js';

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiCompleteRequest {
  messages: AiChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/** Outbound provider-call budget — this is a local prototype harness, not a production abuse-hardened endpoint (see ARCHITECTURE.md's caveat); a generous but finite timeout is the one protection built in. */
const PROVIDER_TIMEOUT_MS = 30_000;

/**
 * Forwards one completion request to whatever OpenAI-compatible endpoint is
 * configured (`ai.baseUrl` — self-hosted gateways, LM Studio, vLLM,
 * OpenRouter, Ollama's own `/v1` endpoint, a proxy in front of another
 * provider, etc.), injecting the server-side BYOK key when present — never
 * echoed back, never logged. `ai.apiKey` and `ai.model` are both optional
 * (see their doc comments on EnlaceAiOptions); `ai.baseUrl` is required
 * (enlace.ts's aiIsUsable already guarantees that before a call ever
 * reaches here). Throws on any failure (non-2xx, timeout, unexpected
 * response shape); the caller (enlace.ts) turns that into a 502.
 */
export async function callAiProvider(ai: EnlaceAiOptions, request: AiCompleteRequest): Promise<string> {
  const baseUrl = ai.baseUrl.replace(/\/+$/, '');
  const messages = request.messages.map((m) => ({ role: m.role, content: m.content }));

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(ai.apiKey ? { authorization: `Bearer ${ai.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: request.model ?? ai.model,
      messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AI provider returned ${res.status}${body ? `: ${body}` : ''}`);
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new Error('AI provider response had no message content.');
  }
  return text;
}
