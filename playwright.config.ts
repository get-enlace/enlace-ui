import { defineConfig } from '@playwright/test';

// Deliberately minimal: confirms the built frontend actually serves and
// renders (the class of bug this project hit earlier — a Vite `base` path
// misconfiguration that produced a blank page — is exactly what a pure
// API-level e2e test can't catch). Does not automate canvas drag-and-drop;
// that's the flakiest part of this app even under careful manual control,
// and isn't worth relying on for every PR.
export default defineConfig({
  testDir: 'test/e2e-ui',
  webServer: {
    // `npm start` (not a bare `tsx examples/sample-api/server.ts`) so its
    // `predev` hook still builds enlace-ui automatically if `public/` is
    // missing — CI builds it explicitly beforehand anyway, but this keeps a
    // plain local `npm run test:e2e-ui` working without a separate build
    // step too.
    command: 'npm start',
    port: 4000,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
  use: {
    baseURL: 'http://localhost:4000',
  },
});
