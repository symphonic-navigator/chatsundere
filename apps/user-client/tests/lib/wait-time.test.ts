// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { formatRetryWait, formatWaitPhrase } from '../../src/lib/wait-time.js';

describe('formatWaitPhrase', () => {
  it('renders sub-minute waits in seconds, rounded up, with singular/plural', () => {
    expect(formatWaitPhrase(1)).toBe('about 1 second');
    expect(formatWaitPhrase(45)).toBe('about 45 seconds');
    expect(formatWaitPhrase(58.6)).toBe('about 59 seconds');
    // A sub-second wait still reads as at least one second, never "0 seconds".
    expect(formatWaitPhrase(0.2)).toBe('about 1 second');
  });

  it('renders minute-plus waits in whole minutes, rounded up', () => {
    expect(formatWaitPhrase(60)).toBe('about 1 minute');
    expect(formatWaitPhrase(80)).toBe('about 2 minutes');
    expect(formatWaitPhrase(300)).toBe('about 5 minutes');
    expect(formatWaitPhrase(900)).toBe('about 15 minutes');
  });
});

describe('formatRetryWait', () => {
  const now = 1_000_000;
  it('derives the phrase from the remaining time', () => {
    expect(formatRetryWait(now + 45_000, now)).toBe('about 45 seconds');
    expect(formatRetryWait(now + 118_000, now)).toBe('about 2 minutes');
  });

  it('returns null with no hint or an already-elapsed window', () => {
    expect(formatRetryWait(undefined, now)).toBeNull();
    expect(formatRetryWait(now - 1, now)).toBeNull();
    expect(formatRetryWait(now, now)).toBeNull();
  });
});
