// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Shared retry helper for transient upstream failures. Mirrors the chatsune
 * Python helper at `../../../chatsune/backend/_retry.py`. Three layers:
 *
 * - **Low-level helpers** (`shouldRetryStatus`, `computeRetryDelay`,
 *   `parseRetryAfter`) for callers whose retry decision lives inside an
 *   in-flight fetch lifecycle and a generic wrapper would obscure control flow.
 * - **High-level `withRetry`** for single-result calls like
 *   `one-shot-completion.ts` (title-gen) where wrapping the whole call
 *   is clean.
 * - **High-level `withStreamingRetry`** for streaming calls — owns the
 *   retry loop, fresh-request-per-attempt, and TTFB timeout.
 *
 * Defaults: up to 4 retries (= 5 attempts total) with base 1 s and
 * exponential doubling, ±25% jitter, capped at 16 s. Honour
 * `Retry-After` seconds-form (HTTP-date form ignored — rare on the
 * providers we hit). Caps Retry-After at the same 16 s ceiling.
 *
 * Retryable statuses: 408 (request timeout), 429 (rate limit),
 * 500 (internal error), 502 (bad gateway), 503 (service unavailable),
 * 504 (gateway timeout). Broader than chatsune's narrower {429, 503}
 * because we hit multiple providers each with different transient
 * behaviour.
 */

export const MAX_RETRY_ATTEMPTS = 4;
export const RETRY_BASE_DELAY_SECONDS = 1.0;
export const RETRY_MAX_DELAY_SECONDS = 16.0;
export const RETRY_JITTER_FRACTION = 0.25;

const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

export type RetryErrorKind = 'network' | 'status';

/** One retry decision, emitted to an optional sink. Sink-agnostic by design. */
export interface RetryEvent {
  /** Logical operation, e.g. 'stream-completion' | 'one-shot' | 'suite-binding:<ref>'. */
  operation: string;
  /** 0-based index of the attempt that just failed. */
  attempt: number;
  /** Computed backoff in seconds before the next attempt. */
  delaySeconds: number;
  /** Upstream status; set only when errorKind === 'status'. */
  status?: number;
  errorKind: RetryErrorKind;
}

export type OnRetry = (event: RetryEvent) => void;

/**
 * Render a RetryEvent as a single structured log line. Pure — no console, no
 * dependency. Callers in apps/ and curation/ do the actual `console.warn`.
 */
export function formatRetryEvent(e: RetryEvent): string {
  const status = e.status !== undefined ? ` status=${e.status}` : '';
  return `[llm-retry] ${e.operation} attempt=${e.attempt}${status} kind=${e.errorKind} backoff=${e.delaySeconds.toFixed(2)}s`;
}

export function shouldRetryStatus(statusCode: number): boolean {
  return RETRYABLE_STATUSES.has(statusCode);
}

export function parseRetryAfter(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (raw === null) return null;
  const seconds = Number.parseFloat(raw.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds, RETRY_MAX_DELAY_SECONDS);
}

export function computeRetryDelay(attempt: number, retryAfterSeconds: number | null): number {
  if (retryAfterSeconds !== null) {
    return Math.min(Math.max(0, retryAfterSeconds), RETRY_MAX_DELAY_SECONDS);
  }
  const base = RETRY_BASE_DELAY_SECONDS * 2 ** attempt;
  const jitterRange = base * RETRY_JITTER_FRACTION;
  const delay = base + (Math.random() - 0.5) * 2 * jitterRange;
  return Math.max(0, Math.min(delay, RETRY_MAX_DELAY_SECONDS));
}

export interface WithRetryOpts<T> {
  /** Maximum number of retries after the initial attempt (default 4). */
  maxRetries?: number;
  /** Predicate deciding whether an exception triggers a retry. */
  isRetriable?: (error: unknown) => boolean;
  /** Extract a Retry-After seconds value from the error, if available. */
  extractRetryAfter?: (error: unknown) => number | null;
  /** Abort signal — aborts propagate immediately without retry. */
  signal?: AbortSignal;
  /** Injected for tests; defaults to `setTimeout`-based sleep. */
  sleepFn?: (ms: number) => Promise<void>;
  /** Logical operation name for the emitted RetryEvent. */
  operation?: string;
  /** Classify a thrown error into a RetryEvent kind/status. Default: network. */
  classifyError?: (error: unknown) => { errorKind: RetryErrorKind; status?: number };
  /** Sink for retry decisions. Called once per retry, before sleeping. */
  onRetry?: OnRetry;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` with exponential-backoff retry on transient errors. Suitable
 * for single-result calls (one-shot completion / title-gen). Streaming
 * call sites use `withStreamingRetry` (below).
 *
 * If `signal.aborted` becomes true, the helper re-throws an AbortError
 * immediately without further retries.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: WithRetryOpts<T> = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? MAX_RETRY_ATTEMPTS;
  const isRetriable = opts.isRetriable ?? (() => true);
  const sleep = opts.sleepFn ?? defaultSleep;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (opts.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (!isRetriable(err) || attempt >= maxRetries) throw err;
      const retryAfter = opts.extractRetryAfter?.(err) ?? null;
      const delaySeconds = computeRetryDelay(attempt, retryAfter);
      if (opts.onRetry) {
        const classified = opts.classifyError?.(err) ?? { errorKind: 'network' as const };
        opts.onRetry({
          operation: opts.operation ?? 'with-retry',
          attempt,
          delaySeconds,
          status: classified.status,
          errorKind: classified.errorKind,
        });
      }
      await sleep(delaySeconds * 1000);
      if (opts.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
    }
  }
  throw lastError ?? new Error('withRetry: exhausted without result');
}

export interface StreamingRetryOpts {
  /** Pure factory called FRESH per attempt (a Request's body is consumed on fetch). */
  buildRequest: () => Request;
  /** Injectable fetch (binding / tests); defaults to global fetch. */
  doFetch?: typeof fetch;
  /** Logical operation name for emitted RetryEvents. */
  operation: string;
  /** Maximum retries after the initial attempt (default MAX_RETRY_ATTEMPTS). */
  maxRetries?: number;
  /**
   * Per-attempt time-to-first-byte timeout in ms. `null` disables it (the
   * suite binding wants no TTFB cap). Cleared as soon as the response arrives.
   */
  initialResponseTimeoutMs?: number | null;
  /** Caller abort signal — aborts propagate without retry. */
  signal?: AbortSignal;
  /** Sink for retry decisions. */
  onRetry?: OnRetry;
  /** Injectable sleep (tests). */
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * Streaming-aware retry: owns the loop, a FRESH Request per attempt (so the
 * body-stream-consumed-on-first-fetch trap is structurally impossible), an
 * optional per-attempt TTFB timeout, body-cancel before retry, network-error
 * and transient-status retry, and the onRetry hook. Returns the final Response
 * — ok, or non-ok when the status is non-retryable or attempts are exhausted.
 * NEVER throws on a non-ok status; the caller decides throw-vs-capture. Throws
 * AbortError on abort, or the last error if every attempt was a network failure.
 */
export async function withStreamingRetry(opts: StreamingRetryOpts): Promise<Response> {
  const maxRetries = opts.maxRetries ?? MAX_RETRY_ATTEMPTS;
  const doFetch = opts.doFetch ?? fetch;
  const sleep = opts.sleepFn ?? defaultSleep;
  const timeoutMs = opts.initialResponseTimeoutMs;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const request = opts.buildRequest();

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let fetchSignal: AbortSignal | undefined = opts.signal;
    if (timeoutMs != null) {
      const timeoutCtrl = new AbortController();
      timeoutId = setTimeout(
        () =>
          timeoutCtrl.abort(
            new DOMException(`upstream did not respond within ${timeoutMs}ms`, 'TimeoutError'),
          ),
        timeoutMs,
      );
      fetchSignal = opts.signal
        ? AbortSignal.any([opts.signal, timeoutCtrl.signal])
        : timeoutCtrl.signal;
    }

    let response: Response;
    try {
      response = await doFetch(request, fetchSignal ? { signal: fetchSignal } : undefined);
    } catch (err) {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      // Network-level failures (TypeError per WHATWG fetch) are retryable;
      // AbortError / TimeoutError propagate immediately.
      if (err instanceof TypeError && attempt < maxRetries && !opts.signal?.aborted) {
        lastError = err;
        const delay = computeRetryDelay(attempt, null);
        opts.onRetry?.({
          operation: opts.operation,
          attempt,
          delaySeconds: delay,
          errorKind: 'network',
        });
        await sleep(delay * 1000);
        continue;
      }
      throw err;
    }
    if (timeoutId !== undefined) clearTimeout(timeoutId);

    if (response.ok) return response;
    if (!shouldRetryStatus(response.status) || attempt >= maxRetries) return response;

    const retryAfter = parseRetryAfter(response.headers);
    await response.body?.cancel();
    const delay = computeRetryDelay(attempt, retryAfter);
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    opts.onRetry?.({
      operation: opts.operation,
      attempt,
      delaySeconds: delay,
      status: response.status,
      errorKind: 'status',
    });
    await sleep(delay * 1000);
  }
  throw lastError ?? new Error('withStreamingRetry: exhausted without response');
}
