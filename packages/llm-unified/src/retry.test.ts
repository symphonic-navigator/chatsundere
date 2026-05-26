// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import {
  RETRY_BASE_DELAY_SECONDS,
  RETRY_MAX_DELAY_SECONDS,
  computeRetryDelay,
  parseRetryAfter,
  shouldRetryStatus,
  withRetry,
} from './retry';

describe('shouldRetryStatus', () => {
  for (const s of [408, 429, 500, 502, 503, 504]) {
    it(`returns true for ${s}`, () => {
      expect(shouldRetryStatus(s)).toBe(true);
    });
  }
  for (const s of [200, 201, 204, 301, 400, 401, 403, 404, 422]) {
    it(`returns false for ${s}`, () => {
      expect(shouldRetryStatus(s)).toBe(false);
    });
  }
});

describe('parseRetryAfter', () => {
  it('parses seconds-form integers', () => {
    expect(parseRetryAfter(new Headers({ 'retry-after': '5' }))).toBe(5);
  });
  it('parses seconds-form floats', () => {
    expect(parseRetryAfter(new Headers({ 'retry-after': '2.5' }))).toBe(2.5);
  });
  it('case-insensitive header name', () => {
    expect(parseRetryAfter(new Headers({ 'Retry-After': '3' }))).toBe(3);
  });
  it('returns null for missing header', () => {
    expect(parseRetryAfter(new Headers())).toBeNull();
  });
  it('returns null for malformed values', () => {
    expect(parseRetryAfter(new Headers({ 'retry-after': 'soon' }))).toBeNull();
  });
  it('returns null for negative values', () => {
    expect(parseRetryAfter(new Headers({ 'retry-after': '-5' }))).toBeNull();
  });
  it('caps at RETRY_MAX_DELAY_SECONDS', () => {
    expect(parseRetryAfter(new Headers({ 'retry-after': '999' }))).toBe(RETRY_MAX_DELAY_SECONDS);
  });
  it('returns null for HTTP-date form (rare, falls back to backoff)', () => {
    expect(
      parseRetryAfter(new Headers({ 'retry-after': 'Wed, 21 Oct 2015 07:28:00 GMT' })),
    ).toBeNull();
  });
});

describe('computeRetryDelay', () => {
  it('uses retryAfter when provided, capped at max', () => {
    expect(computeRetryDelay(0, 3)).toBe(3);
    expect(computeRetryDelay(0, RETRY_MAX_DELAY_SECONDS + 100)).toBe(RETRY_MAX_DELAY_SECONDS);
  });
  it('uses exponential backoff when retryAfter is null', () => {
    for (const attempt of [0, 1, 2, 3]) {
      const expected = RETRY_BASE_DELAY_SECONDS * 2 ** attempt;
      const samples = Array.from({ length: 50 }, () => computeRetryDelay(attempt, null));
      for (const s of samples) {
        expect(s).toBeGreaterThanOrEqual(expected * 0.75 - 0.001);
        expect(s).toBeLessThanOrEqual(Math.min(expected * 1.25, RETRY_MAX_DELAY_SECONDS) + 0.001);
      }
    }
  });
  it('caps backoff at RETRY_MAX_DELAY_SECONDS for high attempts', () => {
    const sample = computeRetryDelay(10, null);
    expect(sample).toBeLessThanOrEqual(RETRY_MAX_DELAY_SECONDS);
  });
  it('treats negative retryAfter as zero floor', () => {
    expect(computeRetryDelay(0, -5)).toBeGreaterThanOrEqual(0);
  });
});

describe('withRetry', () => {
  it('resolves first attempt without retrying', async () => {
    const fn = mock(async () => 'ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries up to maxRetries times then returns the last value', async () => {
    let calls = 0;
    const fn = mock(async () => {
      calls++;
      if (calls < 3) throw new Error('transient');
      return 'recovered';
    });
    const result = await withRetry(fn, {
      maxRetries: 4,
      isRetriable: () => true,
      sleepFn: async () => {},
    });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws last error after maxRetries exhausted', async () => {
    const fn = mock(async () => {
      throw new Error('always');
    });
    await expect(
      withRetry(fn, {
        maxRetries: 2,
        isRetriable: () => true,
        sleepFn: async () => {},
      }),
    ).rejects.toThrow('always');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retriable errors', async () => {
    const fn = mock(async () => {
      throw new Error('fatal');
    });
    await expect(
      withRetry(fn, {
        isRetriable: () => false,
        sleepFn: async () => {},
      }),
    ).rejects.toThrow('fatal');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('aborts immediately on signal abort, no retry', async () => {
    const ctrl = new AbortController();
    const fn = mock(async () => {
      ctrl.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(
      withRetry(fn, {
        signal: ctrl.signal,
        isRetriable: () => true,
        sleepFn: async () => {},
      }),
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('aborts during sleep without retrying', async () => {
    const ctrl = new AbortController();
    let calls = 0;
    const fn = mock(async () => {
      calls++;
      if (calls === 1) {
        queueMicrotask(() => ctrl.abort());
        throw new Error('transient');
      }
      return 'never';
    });
    await expect(
      withRetry(fn, {
        signal: ctrl.signal,
        isRetriable: () => true,
        sleepFn: async () => {},
      }),
    ).rejects.toThrow(/aborted|abort/i);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
