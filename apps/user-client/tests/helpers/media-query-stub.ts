// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

/** A controllable `prefers-reduced-motion` media query for tests. */
export interface ReducedMotionQueryStub {
  /** Flip the system setting and fire the `change` listeners. */
  set(reduce: boolean): void;
  /** Number of `change` listeners currently attached. */
  listenerCount(): number;
}

/**
 * Stubs `window.matchMedia` so `(prefers-reduced-motion: reduce)` matches
 * `initial` and can be flipped live; every other query never matches. Undo
 * with `vi.unstubAllGlobals()`.
 */
export function stubReducedMotionQuery(initial: boolean): ReducedMotionQueryStub {
  let reduce = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => {
    const isMotion = query === '(prefers-reduced-motion: reduce)';
    return {
      get matches() {
        return isMotion && reduce;
      },
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: (_type: string, fn: () => void) => {
        if (isMotion) listeners.add(fn);
      },
      removeEventListener: (_type: string, fn: () => void) => {
        listeners.delete(fn);
      },
      dispatchEvent: () => false,
    };
  });
  return {
    set(next) {
      reduce = next;
      for (const fn of [...listeners]) fn();
    },
    listenerCount: () => listeners.size,
  };
}
