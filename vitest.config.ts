import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // No root-level test files exist right now (all engine/UI tests moved
    // into packages/enlace-ui, run via its own `npm test`) — this is just
    // a home for future root-scoped tests (e.g. examples/sample-api), so
    // an empty run shouldn't fail CI.
    passWithNoTests: true,
    // test/e2e/** hits a real live server (see vitest.e2e.config.ts /
    // `npm run test:e2e`) and test/e2e-ui/** is Playwright, not vitest
    // (its *.spec.ts files match vitest's default "**/*.spec.ts" glob too
    // — importing @playwright/test's own test() conflicts with vitest's
    // runner). `packages/**` has its own per-package `vitest run` (see
    // `npm test`'s `--workspace @get-enlace/ui` call) — excluded here so
    // those tests run exactly once, not twice. Extending (not replacing)
    // vitest's own default exclude list.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      'test/e2e/**',
      'test/e2e-ui/**',
      'packages/**',
    ],
  },
});
