import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts (which is build-only concerns — base path,
// dev proxy) same as the root's own vitest.config.ts / vitest.e2e.config.ts
// split. jsdom is needed here specifically for component tests
// (NodeInspector, DebugPane, etc.) — the existing pure-logic tests
// (engine/, utils/) don't need a DOM and ran fine under vitest's default
// 'node' environment before this file existed.
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
