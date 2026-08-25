// Local dev harness only — not part of any published package. Runs the
// sample API + the Enlace canvas in one process. Also mounts
// swagger-ui-express alongside it — Enlace has no dependency on Swagger UI
// at all (ARCHITECTURE.md §1: the only input contract is "a URL that
// returns a valid OpenAPI 3.x document"), this is here purely to
// demonstrate that Enlace can ride along an existing Swagger UI setup
// without conflict, for consumers who happen to have one already.
import swaggerUi from 'swagger-ui-express';
import { createApp, spec } from './app.js';
import { MOCK_OAUTH2_ISSUER_URL, startMockOAuth2Server } from './mockOAuth2.js';

const PORT = 4000;

// Started before the app itself — see auth.ts's requireOAuth2Token, which
// verifies against this server's live JWKS. Its JWKS fetch is lazy (first
// verify, not startup), so the ordering here isn't strictly required for
// correctness, but starting it first means a credential attached before
// this finishes still just works rather than racing.
await startMockOAuth2Server();

const app = createApp();

// Existing Swagger UI, unchanged — optional, see comment above.
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec));

app.listen(PORT, () => {
  console.log(`Sample API docs: http://localhost:${PORT}/api-docs`);
  console.log(`Enlace UI:       http://localhost:${PORT}/enlace`);
  console.log(`Mock OAuth2 issuer (client_credentials/password grants): ${MOCK_OAUTH2_ISSUER_URL}`);
});
