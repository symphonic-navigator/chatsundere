// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'vitest';
import { mergePcm } from '../../../../src/lib/voice/live/merge-pcm.js';

describe('mergePcm', () => {
  test('concatenates in order', () => {
    const out = mergePcm([
      new Float32Array([1, 2]),
      new Float32Array([3]),
      new Float32Array([4, 5]),
    ]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });
  test('returns an empty array for no chunks', () => {
    expect(mergePcm([]).length).toBe(0);
  });
});
