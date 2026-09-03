import { defineConfig } from 'vitest/config';

// Plain Node — no jsdom. This is the portability proof for @get-enlace/core.
export default defineConfig({
  test: {
    environment: 'node',
  },
});
