// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { rateLimitMessage } from '../../src/lib/recovery-copy.js';

describe('rateLimitMessage', () => {
  it('300 seconds → "about 5 minutes"', () => {
    expect(rateLimitMessage(300)).toBe('Too many attempts. Please wait about 5 minutes.');
  });

  it('60 seconds → "about 1 minute" (singular, no trailing s)', () => {
    expect(rateLimitMessage(60)).toBe('Too many attempts. Please wait about 1 minute.');
  });

  it('undefined (no Retry-After) → "a few minutes"', () => {
    expect(rateLimitMessage(undefined)).toBe('Too many attempts. Please wait a few minutes.');
  });

  // Unified with the connectivity badge via the shared formatter: sub-minute
  // waits now read in seconds, and non-round waits round UP (never sooner).
  it('45 seconds → "about 45 seconds" (finer than the old minute floor)', () => {
    expect(rateLimitMessage(45)).toBe('Too many attempts. Please wait about 45 seconds.');
  });

  it('80 seconds → "about 2 minutes" (rounded up, matching the badge)', () => {
    expect(rateLimitMessage(80)).toBe('Too many attempts. Please wait about 2 minutes.');
  });
});
