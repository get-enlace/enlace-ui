// Local copy of @get-enlace/express's mount function — that package now
// lives in the separate get-enlace/enlace-js repo, so this repo no longer
// depends on it (as a workspace or otherwise) for its
// own local dev/e2e testing. It's small enough that a copy is simpler and
// more self-contained than depending on the other repo's published
// package here, which would mean auth against GitHub Packages just to run
// `npm start` or the e2e suite. Keep this in sync with
// get-enlace/enlace-js's packages/enlace-express/src/index.ts by hand if
// that package's behavior ever changes — there's no other coupling
// between the two repos.
import express from 'express';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import path from 'node:path';
import { createRequire } from 'node:module';
import yaml from 'js-yaml';
import { callAiProvider } from './aiProviders.js';

const require = createRequire(import.meta.url);

export type SpecSource = string | Record<string, any>;

function loadSpec(source: SpecSource): Record<string, any> {
  if (typeof source !== 'string') return source;
  const raw = readFileSync(source, 'utf-8');
  const ext = extname(source);
  if (ext === '.yaml' || ext === '.yml') {
    return yaml.load(raw) as Record<string, any>;
  }
  return JSON.parse(raw);
}

/**
 * Config for the opt-in AI-assist proxy (see the two routes below and
 * ARCHITECTURE.md's "Browser ↔ adapter ↔ LLM provider" section) — a
 * separate, non-execution channel from spec/static serving. Kept out of
 * `EnlaceOptions.spec`'s own shape (own optional field instead) so an
 * operator who never sets `ai` gets a router that's byte-for-byte what this
 * file always served: no `/api/ai/*` behavior change from before this
 * existed.
 */
export interface EnlaceAiOptions {
  /** Explicit opt-in — the UI hides every AI affordance unless this is true AND the provider is actually usable (see aiIsUsable below). Never inferred from apiKey's mere presence alone. */
  enabled: boolean;
  provider: 'anthropic' | 'ollama';
  /**
   * BYOK secret. Read by the *consuming app* (see app.ts) from wherever it
   * likes — env var, secret manager — and passed in here explicitly; this
   * module never reads `process.env` itself, same as it never reads `spec`
   * from one. Never echoed back in any response.
   *
   * Required for `provider: 'anthropic'`. Optional for `provider: 'ollama'`
   * when talking to a local daemon — auth there is whatever `ollama signin`
   * session already exists on the machine running the adapter, not a key
   * this process holds (see aiProviders.ts's callOllama).
   */
  apiKey?: string;
  /** Only meaningful for `provider: 'ollama'` — overrides the default local `http://localhost:11434`, e.g. to point at Ollama's cloud API directly instead of a local daemon. Ignored by every other provider. */
  baseUrl?: string;
  model: string;
}

export interface EnlaceOptions {
  /** A file/URL path or an already-parsed object — the only input this needs is a valid OpenAPI 3.x document, however it's produced or served. */
  spec: SpecSource;
  /**
   * Opt-in AI-assist proxy. Omitted (the default) means no `/api/ai/*`
   * route exists at all — not a route that exists but reports itself
   * disabled — so an operator who never configures this sees nothing added
   * to their app's route table.
   */
  ai?: EnlaceAiOptions;
}

/**
 * Whether `options.ai` is enough to actually make a provider call — not
 * every provider needs the same things. `anthropic` always needs a BYOK
 * `apiKey`; `ollama` doesn't (see EnlaceAiOptions.apiKey's own comment) —
 * `enabled` + a `model` is enough.
 */
function aiIsUsable(ai: EnlaceAiOptions | undefined): ai is EnlaceAiOptions {
  if (!ai?.enabled || !ai.model) return false;
  return ai.provider === 'anthropic' ? Boolean(ai.apiKey) : true;
}

/**
 * Mounts the Enlace canvas.
 *
 *   app.use('/enlace', enlace({ spec }))
 */
export function enlace(options: EnlaceOptions): express.Router {
  const router = express.Router();

  // Read fresh on each request, not cached — matches the "not stored, read
  // fresh each load" rule from ARCHITECTURE.md §4.
  router.get('/api/spec', (_req, res) => {
    res.json(loadSpec(options.spec));
  });

  // Scoped to just the AI routes rather than applied to the whole router —
  // this stays a drop-in Router mountable into a host app that hasn't
  // already called express.json() itself (examples/sample-api/app.ts's own
  // app-level express.json() would otherwise make this redundant, but a
  // real consuming app might mount only this router).
  router.use('/api/ai', express.json());

  // Capability signal the UI checks before rendering ANY AI affordance —
  // see store/slices/aiSlice.ts's loadAiCapabilities. Always 200; never
  // requires a valid key to answer. Provider/model are omitted when
  // disabled — don't leak adapter config to an operator who hasn't opted in.
  router.get('/api/ai/capabilities', (_req, res) => {
    if (!aiIsUsable(options.ai)) {
      res.json({ enabled: false });
      return;
    }
    res.json({ enabled: true, provider: options.ai.provider, model: options.ai.model });
  });

  // Dumb, symmetric, authenticated LLM proxy — zero Enlace-specific
  // knowledge (no Operations, no WorkflowNode, no schemas; see
  // ARCHITECTURE.md). All prompt/context assembly happens in the browser;
  // this only injects the server-side BYOK key and forwards to the
  // configured provider (aiProviders.ts).
  router.post('/api/ai/complete', async (req, res) => {
    if (!aiIsUsable(options.ai)) {
      // The route genuinely doesn't exist for an operator who hasn't
      // opted in — matches "the UI shows nothing", not "shows a disabled
      // affordance". Never 200s with a stub reply.
      res.status(404).json({ error: 'AI assist is not enabled on this adapter.' });
      return;
    }
    const { messages, model, temperature, maxTokens } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Expected a non-empty "messages" array.' });
      return;
    }
    try {
      const content = await callAiProvider(options.ai, { messages, model, temperature, maxTokens });
      res.json({ content });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Static canvas UI bundle, resolved via Node's own module resolution
  // against the installed @get-enlace/ui package — must already be built
  // (`npm run build:ui`) before this resolves; see scripts/ensure-ui-built.mjs.
  const uiPackageJson = require.resolve('@get-enlace/ui/package.json');
  const uiDist = path.join(path.dirname(uiPackageJson), 'dist');
  router.use(express.static(uiDist));

  return router;
}
