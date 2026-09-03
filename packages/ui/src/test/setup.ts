// Registers jest-dom's matchers (toBeInTheDocument, toBeDisabled, etc.)
// onto vitest's own `expect` — loaded once for every test file via
// vitest.config.ts's setupFiles.
import '@testing-library/jest-dom/vitest';

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom doesn't implement ResizeObserver (a real browser API) — React Flow
// (Canvas.tsx) uses it to measure its container and throws without one.
// A no-op stub is enough: tests don't depend on it actually firing.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// CodeMirror measures text via Range#getClientRects; jsdom's Range stub
// omits it, which surfaces as unhandled exceptions during EditorView layout.
Range.prototype.getClientRects ??= function getClientRects() {
  return [] as unknown as DOMRectList;
};
Range.prototype.getBoundingClientRect ??= function getBoundingClientRect() {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON() {
      return {};
    },
  } as DOMRect;
};

// React Testing Library's auto-cleanup relies on detecting a global
// `afterEach` (as Jest provides one); this project doesn't set vitest's
// `globals: true` (keeps `describe`/`it`/`expect` explicitly imported,
// matching every other test file in this repo), so cleanup has to be
// wired up manually here instead — otherwise each test file's later tests
// render on top of the previous test's un-unmounted DOM.
afterEach(() => {
  cleanup();
});
