// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom does not implement window.matchMedia; stub it so components that call
// respectsReducedMotion() (e.g. BreathingOrb) do not throw in tests.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// jsdom 25.x doesn't implement ResizeObserver; ChatStream uses it to lock
// the scroll position to the bottom when layout shifts (cockpit open/close).
// A no-op stub is enough for unit tests — those don't trigger real resizes.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  // biome-ignore lint/suspicious/noExplicitAny: minimal browser API shim
  (window as any).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

afterEach(() => cleanup());
