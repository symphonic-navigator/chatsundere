// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { GPT_IMAGE_2_RESOLUTIONS, gptImage2Resolution } from './gpt-image-2-resolutions.js';

describe('GPT_IMAGE_2_RESOLUTIONS', () => {
  test('covers all 8 aspects × 2 resolutions', () => {
    expect(Object.keys(GPT_IMAGE_2_RESOLUTIONS)).toHaveLength(16);
  });
  test('every cell obeys the upstream limits and is a multiple of 32', () => {
    for (const [w, h] of Object.values(GPT_IMAGE_2_RESOLUTIONS)) {
      expect(w).toBeGreaterThanOrEqual(512);
      expect(h).toBeGreaterThanOrEqual(512);
      expect(w).toBeLessThanOrEqual(2560);
      expect(h).toBeLessThanOrEqual(2560);
      expect(w * h).toBeGreaterThanOrEqual(655_360);
      expect(w * h).toBeLessThanOrEqual(3_686_400);
      expect(w % 32).toBe(0);
      expect(h % 32).toBe(0);
    }
  });
  test('every cell is an exact ratio of its aspect key', () => {
    for (const [key, [w, h]] of Object.entries(GPT_IMAGE_2_RESOLUTIONS)) {
      const aspect = key.split('|')[0] ?? '';
      const [aw, ah] = aspect.split(':').map(Number);
      expect(w * (ah ?? 0)).toBe(h * (aw ?? 0));
    }
  });
  test('spot-checks match the probe-verified table', () => {
    expect(gptImage2Resolution('1:1', '1k')).toEqual([1024, 1024]);
    expect(gptImage2Resolution('16:9', '2k')).toEqual([2560, 1440]);
    expect(gptImage2Resolution('21:9', '1k')).toEqual([1568, 672]);
    expect(gptImage2Resolution('21:9', '2k')).toEqual([2464, 1056]);
  });
  test('throws on an unknown combination', () => {
    expect(() => gptImage2Resolution('5:4', '1k')).toThrow('gpt-image-2: no resolution');
  });
});
