// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import {
  MAX_RETRY_ATTEMPTS,
  RETRY_BASE_DELAY_SECONDS,
  RETRY_MAX_DELAY_SECONDS,
  type RetryEvent,
  computeRetryDelay,
  formatRetryEvent,
  parseRetryAfter,
  shouldRetryStatus,
  withRetry,
  withStreamingRetry,
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

describe('formatRetryEvent', () => {
  it('renders a status event with status and backoff', () => {
    const e: RetryEvent = {
      operation: 'one-shot',
      attempt: 1,
      delaySeconds: 2.5,
      status: 503,
      errorKind: 'status',
    };
    expect(formatRetryEvent(e)).toBe(
      '[llm-retry] one-shot attempt=1 status=503 kind=status backoff=2.50s',
    );
  });

  it('omits status for a network event', () => {
    const e: RetryEvent = {
      operation: 'stream-completion',
      attempt: 0,
      delaySeconds: 1,
      errorKind: 'network',
    };
    expect(formatRetryEvent(e)).toBe(
      '[llm-retry] stream-completion attempt=0 kind=network backoff=1.00s',
    );
  });
});

describe('withRetry onRetry hook', () => {
  it('fires onRetry once per retry with a classified event', async () => {
    const events: RetryEvent[] = [];
    let calls = 0;
    const result = await withRetry<string>(
      async () => {
        calls++;
        if (calls < 3) {
          const err = new Error('boom') as Error & { status?: number };
          err.status = 503;
          throw err;
        }
        return 'ok';
      },
      {
        operation: 'unit',
        sleepFn: async () => {},
        classifyError: (err) => {
          const e = err as { status?: number };
          return typeof e.status === 'number'
            ? { errorKind: 'status', status: e.status }
            : { errorKind: 'network' };
        },
        onRetry: (e) => events.push(e),
      },
    );
    expect(result).toBe('ok');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      operation: 'unit',
      attempt: 0,
      status: 503,
      errorKind: 'status',
    });
    expect(events[1]).toMatchObject({ attempt: 1, status: 503, errorKind: 'status' });
  });
});

// ---------------------------------------------------------------------------
// withStreamingRetry
// ---------------------------------------------------------------------------

function okStream(): Response {
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

describe('withStreamingRetry', () => {
  it('retries a transient 503 then returns the ok response, firing onRetry', async () => {
    let attempts = 0;
    const events: RetryEvent[] = [];
    const res = await withStreamingRetry({
      buildRequest: () => new Request('https://x.test', { method: 'POST', body: '{}' }),
      doFetch: (async () => {
        attempts++;
        return attempts < 2 ? new Response('busy', { status: 503 }) : okStream();
      }) as unknown as typeof fetch,
      operation: 'unit-stream',
      initialResponseTimeoutMs: null,
      sleepFn: async () => {},
      onRetry: (e) => events.push(e),
    });
    expect(res.ok).toBe(true);
    expect(attempts).toBe(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      operation: 'unit-stream',
      attempt: 0,
      status: 503,
      errorKind: 'status',
    });
    expect(typeof events[0]?.delaySeconds).toBe('number');
  });

  it('builds a FRESH Request per attempt (regression: real fetch consumes the body)', async () => {
    const bodies: string[] = [];
    let attempts = 0;
    // Mock that READS the body, exactly as real fetch does — the old reuse bug
    // would surface here as the second read throwing on an already-used body.
    const res = await withStreamingRetry({
      buildRequest: () => new Request('https://x.test', { method: 'POST', body: '{"n":1}' }),
      doFetch: (async (req: Request) => {
        attempts++;
        bodies.push(await req.text()); // consumes the body
        return attempts < 2 ? new Response('busy', { status: 503 }) : okStream();
      }) as unknown as typeof fetch,
      operation: 'unit-stream',
      initialResponseTimeoutMs: null,
      sleepFn: async () => {},
    });
    expect(res.ok).toBe(true);
    expect(bodies).toEqual(['{"n":1}', '{"n":1}']); // both attempts sent the same body, no throw
  });

  it('returns the final non-ok response after exhausting all retries on a retryable status', async () => {
    let attempts = 0;
    const res = await withStreamingRetry({
      buildRequest: () => new Request('https://x.test', { method: 'POST', body: '{}' }),
      doFetch: (async () => {
        attempts++;
        return new Response('busy', { status: 503 });
      }) as unknown as typeof fetch,
      operation: 'unit-stream',
      initialResponseTimeoutMs: null,
      sleepFn: async () => {},
    });
    expect(res.status).toBe(503);
    expect(attempts).toBe(MAX_RETRY_ATTEMPTS + 1); // initial attempt + 4 retries, then give up
  });

  it('returns the final non-ok response on a non-retryable status (no throw)', async () => {
    const res = await withStreamingRetry({
      buildRequest: () => new Request('https://x.test', { method: 'POST', body: '{}' }),
      doFetch: (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch,
      operation: 'unit-stream',
      initialResponseTimeoutMs: null,
      sleepFn: async () => {},
    });
    expect(res.status).toBe(401);
  });

  it('throws AbortError when the signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      withStreamingRetry({
        buildRequest: () => new Request('https://x.test', { method: 'POST', body: '{}' }),
        doFetch: (async () => okStream()) as unknown as typeof fetch,
        operation: 'unit-stream',
        initialResponseTimeoutMs: null,
        signal: ctrl.signal,
        sleepFn: async () => {},
      }),
    ).rejects.toThrow(/abort/i);
  });

  it('retries a network TypeError then succeeds', async () => {
    let attempts = 0;
    const res = await withStreamingRetry({
      buildRequest: () => new Request('https://x.test', { method: 'POST', body: '{}' }),
      doFetch: (async () => {
        attempts++;
        if (attempts < 2) throw new TypeError('network gone');
        return okStream();
      }) as unknown as typeof fetch,
      operation: 'unit-stream',
      initialResponseTimeoutMs: null,
      sleepFn: async () => {},
    });
    expect(res.ok).toBe(true);
    expect(attempts).toBe(2);
  });

  it('401 + onUnauthorised(true) retries immediately without consuming a retry', async () => {
    let calls = 0;
    const doFetch = (async () =>
      ++calls === 1
        ? new Response('', { status: 401 })
        : new Response('ok')) as unknown as typeof fetch;
    const res = await withStreamingRetry({
      buildRequest: () => new Request('https://x.test'),
      doFetch,
      operation: 'unit-stream',
      initialResponseTimeoutMs: null,
      onUnauthorised: async () => true,
      sleepFn: async () => {},
    });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it('onUnauthorised fires at most once, then the 401 returns as normal', async () => {
    let calls = 0;
    let hookCalls = 0;
    const doFetch = (async () => {
      calls += 1;
      return new Response('', { status: 401 });
    }) as unknown as typeof fetch;
    const res = await withStreamingRetry({
      buildRequest: () => new Request('https://x.test'),
      doFetch,
      operation: 'unit-stream',
      initialResponseTimeoutMs: null,
      onUnauthorised: async () => {
        hookCalls += 1;
        return true;
      },
      sleepFn: async () => {},
    });
    expect(res.status).toBe(401);
    expect(hookCalls).toBe(1);
    expect(calls).toBe(2);
  });
});
