// Relative — resolves under whatever path this bundle is served from,
// whether that's the Vite dev server (proxied, see vite.config.ts) or the
// adapter's mount path in a real host app. Exported for reuse by
// api/aiClient.ts, which needs the same base for its own `api/ai/*` calls.
export const API_BASE = 'api';

/**
 * The raw OpenAPI document, unparsed — the adapter just passes it through
 * (see @get-enlace/express's `loadSpec`). Parsing it into the Operation[]
 * shape this app actually works with happens client-side, via
 * engine/specParser.ts's `parseOperations()`, since that's where execution
 * itself now runs too.
 */
export async function fetchSpec(): Promise<Record<string, any>> {
  const res = await fetch(`${API_BASE}/spec`);
  if (!res.ok) throw new Error(`Failed to load spec: ${res.status}`);
  return res.json();
}
