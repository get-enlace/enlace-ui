import { API_BASE } from './client.js';
import type { AiChatMessage } from '../types.js';

export interface AiCapabilitiesResponse {
  enabled: boolean;
  model?: string;
}

/**
 * Degrades to `{enabled:false}` on ANY failure — network error, 404 (an
 * adapter too old to know this route, or one that just never configured
 * AI), a malformed response — never throws. AI is optional; its absence
 * must never surface as a blocking app error the way loadOperations()'s
 * spec fetch does (see specSlice.ts).
 */
export async function fetchAiCapabilities(): Promise<AiCapabilitiesResponse> {
  try {
    const res = await fetch(`${API_BASE}/ai/capabilities`);
    if (!res.ok) return { enabled: false };
    const data = await res.json();
    return data?.enabled ? { enabled: true, model: data.model } : { enabled: false };
  } catch {
    return { enabled: false };
  }
}

/**
 * Throws on any failure (network, non-2xx, malformed body) — callers
 * (store/slices/aiSlice.ts) decide how to surface that as an `'error'`
 * suggestion entry. Unlike `fetchAiCapabilities`, this is only ever called
 * after capabilities has already reported `enabled: true`, so a failure
 * here is a real error worth showing, not an expected "AI isn't on" case.
 */
export async function postAiComplete(messages: AiChatMessage[]): Promise<string> {
  const res = await fetch(`${API_BASE}/ai/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `AI request failed: ${res.status}`);
  }
  const data = await res.json();
  console.log("AI response data at UI:", data);
  if (typeof data?.content !== 'string') throw new Error('AI response had no content.');
  return data.content;
}
