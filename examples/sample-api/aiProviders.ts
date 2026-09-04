// Adapter-side translation from Enlace's generic chat-completions wire
// shape (see enlace.ts's EnlaceAiOptions / POST api/ai/complete) to
// whatever the configured provider's real API actually expects. Kept as
// its own file rather than folded into enlace.ts, so enlace.ts stays close
// to what @get-enlace/express will eventually need to hand-sync (see that
// file's own header comment) — this is the part most likely to grow (more
// providers, retries) and least likely to need staying in sync by hand.
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
 * Forwards one completion request to the configured provider, injecting
 * the server-side BYOK key — never echoed back, never logged. Throws on
 * any failure (non-2xx, timeout, unexpected response shape); the caller
 * (enlace.ts) turns that into a 502.
 */
export async function callAiProvider(ai: EnlaceAiOptions, request: AiCompleteRequest): Promise<string> {
  switch (ai.provider) {
    case 'anthropic':
      return callAnthropic(ai, request);
    case 'ollama':
      return callOllama(ai, request);
  }
}

async function callAnthropic(ai: EnlaceAiOptions, request: AiCompleteRequest): Promise<string> {
  // aiIsUsable (enlace.ts) already requires apiKey for this provider before
  // a request ever reaches here — this is just narrowing the optional
  // EnlaceAiOptions.apiKey (required for ollama) back to a plain string for
  // the fetch call below, not a fresh runtime check.
  if (!ai.apiKey) {
    throw new Error('Anthropic provider requires an apiKey.');
  }
  const apiKey = ai.apiKey;

  // Anthropic's Messages API takes the system prompt as its own top-level
  // field, not as a message with role "system" — Enlace's wire shape is
  // provider-agnostic, so this split happens here, not on the browser side.
  const systemPrompt = request.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const conversation = request.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: request.model ?? ai.model,
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature,
      system: systemPrompt || undefined,
      messages: conversation,
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API returned ${res.status}${body ? `: ${body}` : ''}`);
  }

  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find((block) => block.type === 'text')?.text;
  if (typeof text !== 'string') {
    throw new Error('Anthropic API response had no text content block.');
  }
  return text;
}

/**
 * Local Ollama daemon, cloud-proxied — used for testing against gpt-oss
 * cloud models without spending Anthropic credits. Calls the *local*
 * `http://localhost:11434/api/chat` (or `ai.baseUrl` if overridden), the
 * same endpoint `ollama run <model>` itself talks to; for a `-cloud`
 * suffixed model (e.g. `gpt-oss:20b-cloud`) the local daemon transparently
 * proxies the request to Ollama's cloud infra using whatever `ollama
 * signin` session already exists on this machine. No API key is sent from
 * here — `ai.apiKey` is genuinely optional for this provider (see
 * enlace.ts's aiIsUsable), unlike Anthropic where it's required.
 */
async function callOllama(ai: EnlaceAiOptions, request: AiCompleteRequest): Promise<string> {
  const baseUrl = ai.baseUrl ?? 'http://localhost:11434';
  const messages = request.messages.map((m) => ({ role: m.role, content: m.content }));

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(ai.apiKey ? { authorization: `Bearer ${ai.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: request.model ?? ai.model,
      messages,
      stream: false,
      options: {
        temperature: request.temperature,
      },
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama API returned ${res.status}${body ? `: ${body}` : ''}`);
  }

  const data = (await res.json()) as { message?: { content?: string } };
  const text = data.message?.content;
  if (typeof text !== 'string') {
    throw new Error('Ollama API response had no message content.');
  }
  console.log("Ollama response data at BE:", data);
  return text;
}
