// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { SEEDREAM_RESOLUTIONS, seedreamResolution } from './seedream-resolutions.js';

describe('SEEDREAM_RESOLUTIONS', () => {
  test('covers all 7 aspects × 3 qualities', () => {
    expect(Object.keys(SEEDREAM_RESOLUTIONS)).toHaveLength(21);
  });
  test('every cell is >= 3,686,400 pixels and a multiple of 32', () => {
    for (const [w, h] of Object.values(SEEDREAM_RESOLUTIONS)) {
      expect(w * h).toBeGreaterThanOrEqual(3_686_400);
      expect(w % 32).toBe(0);
      expect(h % 32).toBe(0);
    }
  });
  test('spot-checks match the chatsune source table', () => {
    expect(seedreamResolution('1:1', 'standard')).toEqual([1920, 1920]);
    expect(seedreamResolution('16:9', 'ultra')).toEqual([3520, 1984]);
    expect(seedreamResolution('2:3', 'high')).toEqual([1824, 2752]);
  });
  test('throws on an unknown combination', () => {
    expect(() => seedreamResolution('5:4', 'standard')).toThrow('seedream: no resolution');
  });
});
