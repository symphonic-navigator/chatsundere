// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Node 26 exposes an experimental `localStorage` getter that returns undefined
// without --localstorage-file and shadows jsdom's implementation. Do not read
// that getter: each test realm gets deterministic, isolated in-memory storage.
const localStorageValues = new Map<string, string>();
const localStorageStub: Storage = {
  get length() {
    return localStorageValues.size;
  },
  clear: () => localStorageValues.clear(),
  getItem: (key: string) => localStorageValues.get(key) ?? null,
  key: (index: number) => Array.from(localStorageValues.keys())[index] ?? null,
  removeItem: (key: string) => {
    localStorageValues.delete(key);
  },
  setItem: (key: string, value: string) => {
    localStorageValues.set(key, String(value));
  },
};
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStorageStub,
});

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

// jsdom 25.x does not implement URL.createObjectURL / revokeObjectURL.
// Components such as AttachmentThumb call these to display blob previews.
// A no-op stub (returning a fixed string) is sufficient for unit tests that
// do not assert on the rendered image URL itself.
if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = (_blob: Blob | MediaSource) => 'blob:stub';
  URL.revokeObjectURL = (_url: string) => undefined;
}

afterEach(() => cleanup());
