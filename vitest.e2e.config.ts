import { defineConfig } from 'vitest/config';

// Separate from the default vitest.config.ts (which mocks fetch and never
// touches the network): this suite starts the real
// examples/sample-api/app.ts server and hits it over real HTTP, so it needs
// its own timeouts and must not run files in parallel — they share one
// fixed-port server (see test/e2e/helpers.ts).
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    fileParallelism: false,
    hookTimeout: 20_000,
    testTimeout: 20_000,
  },
});
