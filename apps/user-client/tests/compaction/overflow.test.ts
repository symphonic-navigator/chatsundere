// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { wouldOverflow } from '../../src/compaction/overflow.js';

describe('wouldOverflow', () => {
  it('is true when used tokens meet or exceed the window', () => {
    expect(wouldOverflow(131072, 131072)).toBe(true);
    expect(wouldOverflow(200000, 131072)).toBe(true);
  });
  it('is false with headroom', () => {
    expect(wouldOverflow(100000, 131072)).toBe(false);
  });
});
