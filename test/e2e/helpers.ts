// Real HTTP e2e tests share a single server on this fixed port (not port 0
// / a random free port) — vitest.e2e.config.ts disables file parallelism
// so nothing else in this suite can collide with it. Chosen to avoid the
// 4000 default `npm start` uses, in case both happen to run on the same
// machine at once.
import type { Server } from 'node:http';
import { createApp } from '../../examples/sample-api/app.js';

export const E2E_PORT = 4123;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

let server: Server | undefined;

export async function startTestServer(): Promise<void> {
  const app = createApp();
  server = app.listen(E2E_PORT);
  await new Promise<void>((resolve, reject) => {
    server!.once('listening', () => resolve());
    server!.once('error', reject);
  });
}

export async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((err) => (err ? reject(err) : resolve()));
  });
  server = undefined;
}
