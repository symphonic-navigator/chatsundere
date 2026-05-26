// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { relativeTimeLabel } from '../../src/lib/relative-time';

describe('relativeTimeLabel', () => {
  const NOW = new Date('2026-05-26T12:00:00').getTime();
  it('< 60s → "just now"', () => {
    expect(relativeTimeLabel(NOW - 30 * 1000, NOW)).toBe('just now');
  });
  it('< 1h → "Xm ago"', () => {
    expect(relativeTimeLabel(NOW - 5 * 60 * 1000, NOW)).toBe('5m ago');
  });
  it('< 24h → "Xh ago"', () => {
    expect(relativeTimeLabel(NOW - 2 * 60 * 60 * 1000, NOW)).toBe('2h ago');
  });
  it('>= 24h → "D MMM"', () => {
    expect(relativeTimeLabel(new Date('2026-05-20T10:00:00').getTime(), NOW)).toBe('20 May');
  });
});
