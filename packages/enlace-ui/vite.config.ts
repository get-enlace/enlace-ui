import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// This package calls relative "api/..." paths (see src/api/client.ts), and
// the built bundle's own <script>/<link> tags must be just as mount-path-
// agnostic — `base: './'` keeps them relative to index.html's own URL
// instead of the site root, so the bundle works whether the adapter mounts
// it at "/enlace" or anywhere else the host app picks.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist' },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (p) => `/enlace${p}`,
      },
    },
  },
});
