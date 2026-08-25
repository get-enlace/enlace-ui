// Local dev harness only — a real (self-signed) OAuth2/OIDC token issuer,
// via oauth2-mock-server, so the sample API's oauth2-protected routes (see
// auth.ts's requireOAuth2Token) can be exercised against an actual
// signed-JWT round-trip instead of a stub: Enlace really POSTs here for a
// token, gets back a genuine RS256-signed JWT, and the sample API verifies
// it against this server's live /jwks endpoint. Accepts any
// client_id/client_secret or username/password for any grant — it's
// explicitly not a real authorization server, just enough to make the
// credentials demo (see README) a genuine end-to-end test rather than
// cosmetic.
import { OAuth2Server } from 'oauth2-mock-server';

// Fixed, not a random free port — openapi.json's oauth2ClientCreds/
// oauth2Password securitySchemes hardcode this as their tokenUrl, so it
// has to be a value both sides agree on ahead of time.
export const MOCK_OAUTH2_PORT = 4001;
export const MOCK_OAUTH2_ISSUER_URL = `http://localhost:${MOCK_OAUTH2_PORT}`;

let server: OAuth2Server | undefined;

export async function startMockOAuth2Server(): Promise<void> {
  server = new OAuth2Server();
  await server.issuer.keys.generate('RS256');
  await server.start(MOCK_OAUTH2_PORT, 'localhost');
}

export async function stopMockOAuth2Server(): Promise<void> {
  await server?.stop();
  server = undefined;
}
