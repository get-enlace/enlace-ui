// Real HTTP e2e tests share a single server on this fixed port (not port 0
// / a random free port) — vitest.e2e.config.ts disables file parallelism
// so nothing else in this suite can collide with it. Chosen to avoid the
// 4000 default `npm start` uses, in case both happen to run on the same
// machine at once.
import type { Server } from 'node:http';
import { createApp } from '../../examples/sample-api/app.js';
import { MOCK_OAUTH2_ISSUER_URL, startMockOAuth2Server, stopMockOAuth2Server } from '../../examples/sample-api/mockOAuth2.js';

export const E2E_PORT = 4123;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

// Same issuer auth.ts's requireOAuth2Token verifies against — re-exported
// so credentials.e2e.test.ts can fetch a real token from it without
// reaching into examples/sample-api/mockOAuth2.ts directly.
export const E2E_OAUTH2_ISSUER_URL = MOCK_OAUTH2_ISSUER_URL;

let server: Server | undefined;

// Started alongside the sample app (not just when server.ts's own
// standalone `npm start` runs it) so the credential e2e tests can exercise
// oauth2ClientCreds/oauth2Password for real — a genuine POST for a token,
// a genuine signature verification against a live JWKS — not a stub.
export async function startTestServer(): Promise<void> {
  await startMockOAuth2Server();
  const app = createApp();
  server = app.listen(E2E_PORT);
  await new Promise<void>((resolve, reject) => {
    server!.once('listening', () => resolve());
    server!.once('error', reject);
  });
}

export async function stopTestServer(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
    server = undefined;
  }
  await stopMockOAuth2Server();
}
