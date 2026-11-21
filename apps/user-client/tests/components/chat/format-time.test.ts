// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { formatTime } from '../../../src/components/chat/media/format-time.js';

describe('formatTime', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(46_000)).toBe('0:46');
    expect(formatTime(61_999)).toBe('1:01');
  });

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatTime(3_725_000)).toBe('1:02:05');
  });

  it('treats a missing or invalid time as zero', () => {
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatTime(-5)).toBe('0:00');
  });
});
