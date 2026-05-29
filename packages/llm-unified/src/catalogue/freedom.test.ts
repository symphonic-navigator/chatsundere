// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { effectiveFreedom } from './freedom.js';

describe('effectiveFreedom', () => {
  it('is free only when both model and deployment are free', () => {
    expect(effectiveFreedom(true, true)).toBe('free');
  });
  it('is restricted when either side is false', () => {
    expect(effectiveFreedom(true, false)).toBe('restricted');
    expect(effectiveFreedom(false, true)).toBe('restricted');
    expect(effectiveFreedom(false, false)).toBe('restricted');
  });
  it('is unknown when either side is null (uncurated)', () => {
    expect(effectiveFreedom(null, true)).toBe('unknown');
    expect(effectiveFreedom(true, null)).toBe('unknown');
    expect(effectiveFreedom(null, null)).toBe('unknown');
  });
});
