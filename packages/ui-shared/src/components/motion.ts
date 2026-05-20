// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Deterministic pseudo-random number generator seeded by an integer.
 * Uses a fast xorshift-based hash so per-element jitter is stable across
 * renders when the same seed is supplied.
 */
export function seedRandom(seed: number): () => number {
  let v = seed | 0;
  return () => {
    v = (v + 0x6d2b79f5) | 0;
    let t = v;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns a random float in [min, max) using the supplied RNG. */
export function pickWithin(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/**
 * Returns true when the user has requested reduced motion via the OS
 * accessibility preference. Defaults to true in non-browser environments so
 * server-rendered output is always motion-free.
 */
export function respectsReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
