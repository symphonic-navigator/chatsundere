// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickWithin, respectsReducedMotion, seedRandom } from '../../src/components/motion.js';

describe('seedRandom', () => {
  it('produces the same sequence when called twice with the same seed', () => {
    const rng1 = seedRandom(42);
    const rng2 = seedRandom(42);

    const samples1 = Array.from({ length: 20 }, () => rng1());
    const samples2 = Array.from({ length: 20 }, () => rng2());

    expect(samples1).toEqual(samples2);
  });

  it('produces a different sequence for different seeds', () => {
    const rng1 = seedRandom(1);
    const rng2 = seedRandom(2);

    // Very unlikely to be identical across 10 samples.
    const samples1 = Array.from({ length: 10 }, () => rng1());
    const samples2 = Array.from({ length: 10 }, () => rng2());

    expect(samples1).not.toEqual(samples2);
  });
});

describe('pickWithin', () => {
  it('always returns values in [min, max] across 200 calls', () => {
    const rng = seedRandom(42);
    const min = 5;
    const max = 10;

    for (let i = 0; i < 200; i++) {
      const value = pickWithin(rng, min, max);
      expect(value).toBeGreaterThanOrEqual(min);
      expect(value).toBeLessThanOrEqual(max);
    }
  });
});

describe('respectsReducedMotion', () => {
  function stubSystem(reduce: boolean): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: reduce && query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.motion;
  });

  it('is false when neither the system nor the root attribute asks', () => {
    stubSystem(false);
    expect(respectsReducedMotion()).toBe(false);
  });

  it('is true when the system asks for reduced motion', () => {
    stubSystem(true);
    expect(respectsReducedMotion()).toBe(true);
  });

  it("is true when the root carries data-motion='reduced'", () => {
    stubSystem(false);
    document.documentElement.dataset.motion = 'reduced';
    expect(respectsReducedMotion()).toBe(true);
  });
});
