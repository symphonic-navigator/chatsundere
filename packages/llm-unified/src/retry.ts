// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Shared retry helper for transient upstream failures. Mirrors the chatsune
 * Python helper at `../../../chatsune/backend/_retry.py`. Two layers:
 *
 * - **Low-level helpers** (`shouldRetryStatus`, `computeRetryDelay`,
 *   `parseRetryAfter`) for callers like `stream-completion.ts` whose
 *   retry decision lives inside an in-flight fetch lifecycle and a
 *   generic wrapper would obscure control flow.
 * - **High-level `withRetry`** for single-result calls like
 *   `one-shot-completion.ts` (title-gen) where wrapping the whole call
 *   is clean.
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
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` with exponential-backoff retry on transient errors. Suitable
 * for single-result calls (one-shot completion / title-gen). Streaming
 * call sites use the low-level helpers directly.
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
      await sleep(delaySeconds * 1000);
      if (opts.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
    }
  }
  throw lastError ?? new Error('withRetry: exhausted without result');
}
