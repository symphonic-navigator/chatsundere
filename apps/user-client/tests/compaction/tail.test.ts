// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { selectTailStartIndex } from '../../src/compaction/tail.js';

describe('selectTailStartIndex', () => {
  it('returns 0 (keep everything) when at or below the coherence floor', () => {
    expect(selectTailStartIndex(new Array(8).fill(10), 131072)).toBe(0);
    expect(selectTailStartIndex(new Array(12).fill(10), 131072)).toBe(0);
  });

  it('stops at the 12-message floor when large messages meet the token fraction early', () => {
    // 20 msgs of 5000 tokens, window 131072 → 20 % = 26214; reached by msg 6,
    // but the floor needs ≥ 12 → keep 12.
    expect(selectTailStartIndex(new Array(20).fill(5000), 131072)).toBe(20 - 12);
  });

  it('caps at 36 messages when small messages never meet the token fraction', () => {
    // 100 msgs of 1 token, window 131072 → 20 % = 26214 never reached within 36 → cap.
    expect(selectTailStartIndex(new Array(100).fill(1), 131072)).toBe(100 - 36);
  });

  it('keeps the count where the token fraction is first met beyond the floor', () => {
    // window 1000 → 20 % = 200; 30 msgs of 10 tokens → met at 20 messages.
    expect(selectTailStartIndex(new Array(30).fill(10), 1000)).toBe(30 - 20);
  });
});
