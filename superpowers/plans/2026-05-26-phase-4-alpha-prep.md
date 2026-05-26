# Phase 4 — Alpha-Prep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four pre-alpha polish items (retry helper, animation polish, per-card streaming orb, MINDSPACE_FALLBACK harden) AND the GitHub-Actions Pages-deploy pipeline that publishes the PWA to `teaser.chatsundere.me/alpha/` with a chatsune-style version string visible in the Entrance Hall + Account About surfaces.

**Architecture:** Two parallel concerns: (a) `packages/llm-unified` gains a chatsune-shaped retry module with high-level (`withRetry`) and low-level (`shouldRetryStatus`, `computeRetryDelay`, `parseRetryAfter`) helpers consumed at the two existing `fetch` call sites; (b) a new `version.txt`-driven workflow injects `__APP_VERSION__` / `__APP_SHA__` / `__APP_BUILT_AT__` via Vite `define`, the PWA renders them in two surfaces, and `actions/deploy-pages@v4` publishes both teaser and alpha trees from a single workflow. Pages source is switched once from "deploy from branch" to "GitHub Actions" via the GitHub UI.

**Tech Stack:** TypeScript 5 strict, Vite 6 + vite-plugin-pwa, React 18, Bun test runner (`packages/llm-unified`), Vitest (`apps/user-client`), Tailwind v4. GitHub Actions: `actions/checkout@v4`, `jdx/mise-action@v2`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`.

**Spec:** [`superpowers/specs/2026-05-26-phase-4-alpha-prep-design.md`](../specs/2026-05-26-phase-4-alpha-prep-design.md).

---

## Task layout

16 tasks, each a TDD-paired step + commit. Pre-public-phase squash discipline (ADR 0003): task-commits land sequentially on master, squashed into one `Phase 4 alpha-prep squashed` commit at the end via Task 16 after Chris's smoke.

- Tasks 1-3 — retry helper module + integration at both `fetch` call sites
- Tasks 4-6 — animation polish (affordance breathing, scroll-to-end swap, pin glow)
- Tasks 7-9 — per-card streaming orb (component + Circle + History integrations)
- Task 10 — MINDSPACE_FALLBACK defensive harden
- Tasks 11-12 — version pipeline (Vite injection, version.ts helper, display surfaces)
- Task 13 — GitHub Actions `pages.yml`
- Task 14 — README versioning section
- Task 15 — Full verification (typecheck + lint + build + tests; manual Pages-settings click-folge surfaced for Chris)
- Task 16 — STATUS-CLIENT-ONLY update + squash + tag v0.0.1

---

### Task 1: `packages/llm-unified/src/retry.ts` — chatsune-style retry helpers

**Files:**
- Create: `packages/llm-unified/src/retry.ts`
- Create: `packages/llm-unified/src/retry.test.ts`

This module mirrors `../chatsune/backend/_retry.py` in TypeScript. Two layers:
- Low-level helpers (`shouldRetryStatus`, `computeRetryDelay`, `parseRetryAfter`) for callers that need granular control (stream-completion's manual retry loop).
- High-level `withRetry(fn, opts)` for single-result calls (one-shot-completion).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/llm-unified/src/retry.test.ts
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
    expect(parseRetryAfter(new Headers({ 'retry-after': 'Wed, 21 Oct 2015 07:28:00 GMT' }))).toBeNull();
  });
});

describe('computeRetryDelay', () => {
  it('uses retryAfter when provided, capped at max', () => {
    expect(computeRetryDelay(0, 3)).toBe(3);
    expect(computeRetryDelay(0, RETRY_MAX_DELAY_SECONDS + 100)).toBe(RETRY_MAX_DELAY_SECONDS);
  });
  it('uses exponential backoff when retryAfter is null', () => {
    // attempt 0 → ~base, attempt 1 → ~2*base, attempt 2 → ~4*base, attempt 3 → ~8*base
    // ±25% jitter — assert range.
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
      sleepFn: async () => {},  // skip real timers in tests
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
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
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
        // Abort before the helper gets to call us again.
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @chatsundere/llm-unified test -- retry`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `retry.ts`**

```ts
// packages/llm-unified/src/retry.ts
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

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  // Unreachable — the loop always returns or throws.
  throw lastError ?? new Error('withRetry: exhausted without result');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @chatsundere/llm-unified test -- retry`
Expected: all cases pass.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/retry.ts packages/llm-unified/src/retry.test.ts
git commit -m "$(cat <<'EOF'
Phase 4 alpha-prep task 1 — retry helper module (chatsune-style)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `stream-completion.ts` wraps initial fetch with retry helpers

**Files:**
- Modify: `packages/llm-unified/src/stream-completion.ts:60-83` (the TTFB fetch block)
- Modify: `packages/llm-unified/src/stream-completion.test.ts` (add retry cases)

Streaming retries can only happen BEFORE the response body has started flowing. Once `fetch` resolves with `response.ok` we hand off to the SSE parser; from that point a network error is not retriable (we can't replay the half-streamed reply).

- [ ] **Step 1: Add failing tests**

Append to `packages/llm-unified/src/stream-completion.test.ts`:

```ts
import { shouldRetryStatus } from './retry';
// (other existing imports retained)

describe('streamCompletion retry on transient initial-fetch failure', () => {
  it('retries on 503 then succeeds with streamed content', async () => {
    let attempts = 0;
    const fetchMock = mock(async () => {
      attempts++;
      if (attempts < 3) {
        return new Response('upstream busy', { status: 503 });
      }
      return new Response(
        // Minimal SSE that ends immediately.
        new ReadableStream({
          start(ctrl) {
            ctrl.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            ctrl.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    });
    spyOn(globalThis, 'fetch').mockImplementation(fetchMock as never);

    const chunks: StreamChunk[] = [];
    for await (const c of streamCompletion(streamArgs())) {
      chunks.push(c);
    }
    expect(attempts).toBe(3);
  });

  it('does not retry once the response body is being read', async () => {
    let bodyReads = 0;
    const stream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
        bodyReads++;
        ctrl.error(new TypeError('network gone'));
      },
    });
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    await expect(async () => {
      for await (const _c of streamCompletion(streamArgs())) {
        // consume
      }
    }).toThrow();
    expect(bodyReads).toBe(1); // No retry attempted.
  });

  it('does not retry on non-retryable status codes (401)', async () => {
    let attempts = 0;
    spyOn(globalThis, 'fetch').mockImplementation(async () => {
      attempts++;
      return new Response('unauthorised', { status: 401 });
    });
    await expect(async () => {
      for await (const _c of streamCompletion(streamArgs())) { /* consume */ }
    }).toThrow();
    expect(attempts).toBe(1);
  });

  it('aborts cleanly when signal fires during retry backoff', async () => {
    const ctrl = new AbortController();
    let attempts = 0;
    spyOn(globalThis, 'fetch').mockImplementation(async () => {
      attempts++;
      queueMicrotask(() => ctrl.abort());
      return new Response('busy', { status: 503 });
    });
    await expect(async () => {
      for await (const _c of streamCompletion({ ...streamArgs(), signal: ctrl.signal })) {
        // consume
      }
    }).toThrow();
    // At most one retry attempt before abort observed.
    expect(attempts).toBeLessThanOrEqual(2);
  });
});

function streamArgs(): StreamCompletionArgs {
  // Re-use the existing test helper if present, else inline a minimal one.
  // …match the shape of the existing tests in this file…
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @chatsundere/llm-unified test -- stream-completion`
Expected: FAIL — no retry logic yet.

- [ ] **Step 3: Wrap the fetch block in `stream-completion.ts`**

Replace the existing fetch block (around lines 60-83) with a manual retry loop using the low-level helpers:

```ts
import {
  MAX_RETRY_ATTEMPTS,
  computeRetryDelay,
  parseRetryAfter,
  shouldRetryStatus,
} from './retry.js';

// …inside streamCompletion, after `const request = buildRequest(...)`:

const timeoutMs = args.initialResponseTimeoutMs ?? DEFAULT_INITIAL_RESPONSE_TIMEOUT_MS;

let response: Response | null = null;
let lastError: unknown = null;
for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
  if (args.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const timeoutCtrl = new AbortController();
  const timeoutId = setTimeout(
    () =>
      timeoutCtrl.abort(
        new DOMException(`upstream did not respond within ${timeoutMs}ms`, 'TimeoutError'),
      ),
    timeoutMs,
  );
  const fetchSignal = args.signal
    ? AbortSignal.any([args.signal, timeoutCtrl.signal])
    : timeoutCtrl.signal;

  let attemptResponse: Response;
  try {
    attemptResponse = await fetch(request, { signal: fetchSignal });
  } catch (err) {
    clearTimeout(timeoutId);
    // Treat fetch-network failures as retryable (TypeError per WHATWG).
    if (err instanceof TypeError && attempt < MAX_RETRY_ATTEMPTS && !args.signal?.aborted) {
      lastError = err;
      const delay = computeRetryDelay(attempt, null);
      await new Promise<void>((r) => setTimeout(r, delay * 1000));
      continue;
    }
    throw err;
  }
  clearTimeout(timeoutId);

  if (attemptResponse.ok) {
    response = attemptResponse;
    break;
  }
  // Non-2xx response. Retry if status is retryable, else throw.
  if (!shouldRetryStatus(attemptResponse.status) || attempt >= MAX_RETRY_ATTEMPTS) {
    response = attemptResponse;
    break;
  }
  const retryAfter = parseRetryAfter(attemptResponse.headers);
  // Consume the body so the connection can be reused.
  await attemptResponse.body?.cancel();
  const delay = computeRetryDelay(attempt, retryAfter);
  if (args.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  await new Promise<void>((r) => setTimeout(r, delay * 1000));
}
if (!response) {
  throw lastError ?? new Error('streamCompletion: exhausted without response');
}

// …existing post-fetch path: yield* parseOpenAiSseStream(response.body, { signal: args.signal });
```

The existing `yield*` line and everything below it stays unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @chatsundere/llm-unified test -- stream-completion`
Expected: all stream-completion tests pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/stream-completion.ts packages/llm-unified/src/stream-completion.test.ts
git commit -m "$(cat <<'EOF'
Phase 4 alpha-prep task 2 — stream-completion retry on transient initial-fetch

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `one-shot-completion.ts` wraps full call with `withRetry`

**Files:**
- Modify: `packages/llm-unified/src/one-shot-completion.ts:47` (the fetch line and surrounding response-handling)
- Modify: `packages/llm-unified/src/one-shot-completion.test.ts` (add retry cases)

- [ ] **Step 1: Add failing tests**

Append to `packages/llm-unified/src/one-shot-completion.test.ts`:

```ts
describe('runOneShotCompletion retry on transient failure', () => {
  it('retries on 429 then returns the eventual content', async () => {
    let attempts = 0;
    spyOn(globalThis, 'fetch').mockImplementation(async () => {
      attempts++;
      if (attempts < 2) {
        return new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '0' },
        });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'recovered' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const result = await runOneShotCompletion(oneShotArgs());
    expect(result).toBe('recovered');
    expect(attempts).toBe(2);
  });

  it('does not retry non-retryable 401', async () => {
    let attempts = 0;
    spyOn(globalThis, 'fetch').mockImplementation(async () => {
      attempts++;
      return new Response('unauthorised', { status: 401 });
    });
    await expect(runOneShotCompletion(oneShotArgs())).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it('throws after exhausting retries', async () => {
    let attempts = 0;
    spyOn(globalThis, 'fetch').mockImplementation(async () => {
      attempts++;
      return new Response('busy', { status: 503 });
    });
    await expect(runOneShotCompletion(oneShotArgs())).rejects.toThrow();
    expect(attempts).toBe(5); // initial + 4 retries
  });
});

function oneShotArgs(): OneShotCompletionArgs {
  // Re-use existing helper in this file or inline.
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @chatsundere/llm-unified test -- one-shot-completion`
Expected: FAIL — no retry yet.

- [ ] **Step 3: Wrap the call body in `withRetry`**

In `packages/llm-unified/src/one-shot-completion.ts`, replace the call body (the `response = await fetch(...)` plus JSON parse) with a `withRetry` invocation:

```ts
import { shouldRetryStatus, withRetry } from './retry.js';

// Existing call signature unchanged.
export async function runOneShotCompletion(args: OneShotCompletionArgs): Promise<string> {
  const request = buildRequest({ /* …existing… */ });

  return withRetry<string>(
    async () => {
      if (args.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const response = await fetch(request, { signal: args.signal });
      if (!response.ok) {
        // Throw a tagged error so `isRetriable` can decide.
        const err = new Error(`one-shot HTTP ${response.status}`) as Error & {
          status?: number;
          retryAfter?: number | null;
        };
        err.status = response.status;
        err.retryAfter = parseRetryAfter(response.headers);
        // Consume the body so the connection can be reused.
        await response.body?.cancel();
        throw err;
      }
      const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = json.choices?.[0]?.message?.content;
      return content ?? '';
    },
    {
      signal: args.signal,
      isRetriable: (err) => {
        if (err instanceof TypeError) return true; // network failure
        const e = err as { status?: number };
        return typeof e.status === 'number' && shouldRetryStatus(e.status);
      },
      extractRetryAfter: (err) => {
        const e = err as { retryAfter?: number | null };
        return e.retryAfter ?? null;
      },
    },
  );
}
```

Add `import { parseRetryAfter } from './retry.js';` to the existing imports if not already.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @chatsundere/llm-unified test -- one-shot-completion`
Expected: all cases pass.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/one-shot-completion.ts packages/llm-unified/src/one-shot-completion.test.ts
git commit -m "$(cat <<'EOF'
Phase 4 alpha-prep task 3 — one-shot-completion retry via withRetry

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: BottomAffordance breathing animation

**Files:**
- Modify: `apps/user-client/src/index.css` (add `@keyframes affordance-breath` + rule)
- Modify: `apps/user-client/tests/unit/bottom-affordance.test.tsx` (add CSS-class assertion)

`BottomAffordance.tsx` already renders with class `bottom-affordance` — only CSS changes needed.

- [ ] **Step 1: Add failing test**

Append to `apps/user-client/tests/unit/bottom-affordance.test.tsx`:

```tsx
it('carries the .bottom-affordance class for CSS-driven breathing', () => {
  const { container } = render(<BottomAffordance onTap={vi.fn()} />);
  const el = container.querySelector('.bottom-affordance');
  expect(el).not.toBeNull();
  // The animation itself isn't testable in jsdom (CSS @keyframes don't run),
  // but the class — which the @keyframes rule attaches to — is the right
  // structural assertion.
});
```

If `BottomAffordance` requires additional props, pad them with `vi.fn()` placeholders matching the existing test conventions in this file.

- [ ] **Step 2: Run test to verify it passes structurally**

Run: `pnpm --filter user-client test -- bottom-affordance`
Expected: PASS (the class is already attached in the component).

- [ ] **Step 3: Add CSS rules**

Append to `apps/user-client/src/index.css` (near the existing `.bottom-affordance` rules):

```css
@keyframes affordance-breath {
  0%, 100% { transform: scale(1);    opacity: 0.9; }
  50%      { transform: scale(1.02); opacity: 1;   }
}

.bottom-affordance {
  animation: affordance-breath 3.5s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .bottom-affordance { animation: none; opacity: 1; }
}
```

- [ ] **Step 4: Run test to verify it still passes + visual smoke not required (manual §15)**

Run: `pnpm --filter user-client test -- bottom-affordance`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/index.css apps/user-client/tests/unit/bottom-affordance.test.tsx
git commit -m "$(cat <<'EOF'
Phase 4 alpha-prep task 4 — BottomAffordance breathing animation

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: ScrollToEnd swap-in / swap-out animation

**Files:**
- Modify: `apps/user-client/src/components/chat/ScrollToEnd.tsx` (add `data-visible` attribute)
- Modify: `apps/user-client/src/index.css` (add keyframes + rules)
- Modify: `apps/user-client/tests/unit/chat-stream.test.tsx` or wherever ScrollToEnd is tested (add data-visible assertion). Create a dedicated test file if none exists.

- [ ] **Step 1: Add failing test**

Find the existing test for ScrollToEnd. If none exists, create `apps/user-client/tests/unit/scroll-to-end.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScrollToEnd } from '../../src/components/chat/ScrollToEnd';

describe('ScrollToEnd', () => {
  it('renders with data-visible="true" when visible', () => {
    const { container } = render(<ScrollToEnd visible={true} onTap={vi.fn()} />);
    const el = container.querySelector('.scroll-to-end-btn') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.getAttribute('data-visible')).toBe('true');
  });

  it('renders with data-visible="false" when not visible', () => {
    const { container } = render(<ScrollToEnd visible={false} onTap={vi.fn()} />);
    const el = container.querySelector('.scroll-to-end-btn') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.getAttribute('data-visible')).toBe('false');
  });
});
```

Adapt props (`visible`, `onTap`) to match the actual `ScrollToEnd` interface.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter user-client test -- scroll-to-end`
Expected: FAIL — no `data-visible` attribute.

- [ ] **Step 3: Modify ScrollToEnd.tsx**

Look at the existing component and add `data-visible={String(visible)}` to the root `<button>` (or whatever element it returns). If the component currently conditionally renders `null` when not visible, change it to ALWAYS render and use `data-visible` to gate the animation via CSS (otherwise the swap-out animation can't play).

Sketch:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
interface Props {
  visible: boolean;
  onTap: () => void;
}

export function ScrollToEnd({ visible, onTap }: Props): JSX.Element {
  return (
    <button
      type="button"
      className="scroll-to-end-btn"
      data-visible={visible ? 'true' : 'false'}
      onClick={onTap}
      aria-label="Scroll to end"
    >
      ↓
    </button>
  );
}
```

Add to `apps/user-client/src/index.css`:

```css
@keyframes scroll-to-end-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes scroll-to-end-out {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(4px); }
}

.scroll-to-end-btn[data-visible="true"]  { animation: scroll-to-end-in  240ms ease-out forwards; }
.scroll-to-end-btn[data-visible="false"] { animation: scroll-to-end-out 180ms ease-in  forwards; pointer-events: none; }

@media (prefers-reduced-motion: reduce) {
  .scroll-to-end-btn[data-visible="true"]  { animation: none; opacity: 1; }
  .scroll-to-end-btn[data-visible="false"] { animation: none; opacity: 0; pointer-events: none; }
}
```

The `pointer-events: none` on hidden state matters — without it the invisible button still intercepts clicks.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter user-client test -- scroll-to-end chat-stream`
Expected: PASS. Verify no chat-stream regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/chat/ScrollToEnd.tsx apps/user-client/src/index.css apps/user-client/tests/unit/scroll-to-end.test.tsx
git commit -m "$(cat <<'EOF'
Phase 4 alpha-prep task 5 — ScrollToEnd swap-in/swap-out animation

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Cockpit pin glow

**Files:**
- Modify: `apps/user-client/src/components/chat/Cockpit.tsx` (add `data-pinned` attribute on root)
- Modify: `apps/user-client/src/index.css` (add `.cockpit[data-pinned="true"]` rule)
- Modify: `apps/user-client/tests/unit/cockpit.test.tsx` (add data-pinned assertion)

- [ ] **Step 1: Add failing test**

Append to the existing `apps/user-client/tests/unit/cockpit.test.tsx` (find the cockpit test file under tests/unit/):

```tsx
it('toggles data-pinned attribute when pin state changes', () => {
  // Use the existing test setup pattern in the file — render Cockpit with
  // a mounted Zustand store that has isPinned=true vs false. Mirror the
  // existing isPinned-related tests in this file for the exact harness.
  useCurrentChatStore.setState({ isPinned: true });
  const { container } = render(/* …Cockpit mount harness… */);
  expect(container.querySelector('.cockpit')?.getAttribute('data-pinned')).toBe('true');

  useCurrentChatStore.setState({ isPinned: false });
  // re-render or rerender …
  expect(container.querySelector('.cockpit')?.getAttribute('data-pinned')).toBe('false');
});
```

If the existing test file doesn't have a pinned-state harness, look at how `interaction-mode.test.tsx` or similar handles `isPinned` and copy the pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter user-client test -- cockpit`
Expected: FAIL — no data-pinned attribute.

- [ ] **Step 3: Add data-pinned + CSS**

In `apps/user-client/src/components/chat/Cockpit.tsx`, find the root element (likely `<div className="cockpit" …>`) and add:

```tsx
<div
  className="cockpit"
  data-pinned={isPinned ? 'true' : 'false'}
  /* …existing props… */
>
```

Add to `apps/user-client/src/index.css`:

```css
.cockpit[data-pinned="true"] {
  border: 1px solid var(--mindspace-accent-border-active);
  box-shadow: 0 0 4px 0 color-mix(in srgb, var(--mindspace-accent) 12%, transparent);
}
```

NB: the CSS variables `--mindspace-accent-border-active` and `--mindspace-accent` must already be exposed by the mindspace-resolver layer. Verify by grep:

```bash
grep -rn "mindspace-accent\b" apps/user-client/src/components/MindspaceLayer.tsx
```

If they're not yet exposed as CSS variables (they may live only on the JS store), surface them via the existing MindspaceLayer's inline style. Adapt CSS to reference the actual variable names — `--accent`, `--accent-border-active`, or whatever the existing convention is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter user-client test -- cockpit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/chat/Cockpit.tsx apps/user-client/src/index.css apps/user-client/tests/unit/cockpit.test.tsx
git commit -m "$(cat <<'EOF'
Phase 4 alpha-prep task 6 — Cockpit pin glow

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: StreamingOrb component

**Files:**
- Create: `apps/user-client/src/components/StreamingOrb.tsx`
- Create: `apps/user-client/tests/unit/streaming-orb.test.tsx`
- Modify: `apps/user-client/src/index.css` (add `.streaming-orb` + `@keyframes orb-breath`)

- [ ] **Step 1: Write failing tests**

```tsx
// apps/user-client/tests/unit/streaming-orb.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { StreamingOrb } from '../../src/components/StreamingOrb';
import { useStreamManagerStore } from '../../src/state/stream-manager.store';

describe('StreamingOrb', () => {
  beforeEach(() => {
    useStreamManagerStore.setState({ streams: new Map() });
  });

  it('renders null when no stream for the persona', () => {
    const { container } = render(<StreamingOrb personaId="p1" colour="#abc" />);
    expect(container.querySelector('[data-streaming-orb]')).toBeNull();
  });

  it('renders the orb when a matching stream exists', () => {
    useStreamManagerStore.setState({
      streams: new Map([
        ['c1', {
          chatId: 'c1', personaId: 'p1',
          draftMessageId: 'd1',
          controller: new AbortController(),
          status: 'streaming',
          contentBuffer: [], pillBuffer: [], startedAt: 0,
        }],
      ]),
    });
    const { container } = render(<StreamingOrb personaId="p1" colour="#abc" />);
    const orb = container.querySelector('[data-streaming-orb]') as HTMLElement;
    expect(orb).not.toBeNull();
    // background style reflects the passed colour
    expect(orb.style.background).toContain('rgb(170, 187, 204)');
  });

  it('does not render when the live stream is for a different persona', () => {
    useStreamManagerStore.setState({
      streams: new Map([
        ['c1', {
          chatId: 'c1', personaId: 'OTHER',
          draftMessageId: 'd1',
          controller: new AbortController(),
          status: 'streaming',
          contentBuffer: [], pillBuffer: [], startedAt: 0,
        }],
      ]),
    });
    const { container } = render(<StreamingOrb personaId="p1" colour="#abc" />);
    expect(container.querySelector('[data-streaming-orb]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter user-client test -- streaming-orb`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement StreamingOrb + CSS**

```tsx
// apps/user-client/src/components/StreamingOrb.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useStreamManagerStore } from '../state/stream-manager.store.js';

interface Props {
  personaId: string;
  colour: string;
}

/**
 * Tiny pulsing dot, shown only when this persona has any live stream.
 * Consumed by PersonaCard and HistoryRow to surface background activity
 * without dominating the listing layout.
 */
export function StreamingOrb({ personaId, colour }: Props): JSX.Element | null {
  const streaming = useStreamManagerStore((s) =>
    [...s.streams.values()].some((h) => h.personaId === personaId),
  );
  if (!streaming) return null;
  return (
    <span
      data-streaming-orb
      aria-hidden
      className="streaming-orb"
      style={{ background: colour, boxShadow: `0 0 6px 0 ${colour}` }}
    />
  );
}
```

Add to `apps/user-client/src/index.css`:

```css
.streaming-orb {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  animation: orb-breath 1.5s ease-in-out infinite;
  z-index: 2;
}

@keyframes orb-breath {
  0%, 100% { transform: scale(1);   opacity: 0.5; }
  50%      { transform: scale(1.2); opacity: 1;   }
}

@media (prefers-reduced-motion: reduce) {
  .streaming-orb { animation: none; opacity: 1; }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter user-client test -- streaming-orb`
Expected: PASS — 3 cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/StreamingOrb.tsx apps/user-client/tests/unit/streaming-orb.test.tsx apps/user-client/src/index.css
git commit -m "$(cat <<'EOF'
Phase 4 alpha-prep task 7 — StreamingOrb component

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: PersonaCard integrates StreamingOrb

**Files:**
- Modify: `apps/user-client/src/components/PersonaCard.tsx`
- Modify: `apps/user-client/tests/unit/persona-card.test.tsx`

- [ ] **Step 1: Add failing test**

Append to `apps/user-client/tests/unit/persona-card.test.tsx`:

```tsx
import { useStreamManagerStore } from '../../src/state/stream-manager.store';

it('shows the streaming orb when this persona has a live stream', () => {
  const persona = makePersona({ id: 'p1' });  // existing helper in the file
  const mindspace = makeMindspace();           // ditto
  useStreamManagerStore.setState({
    streams: new Map([
      ['c1', {
        chatId: 'c1', personaId: 'p1',
        draftMessageId: 'd1',
        controller: new AbortController(),
        status: 'streaming',
        contentBuffer: [], pillBuffer: [], startedAt: 0,
      }],
    ]),
  });
  const { container } = render(
    <MemoryRouter>
      <PersonaCard persona={persona} mindspace={mindspace} hasProvider={true} onChat={vi.fn()} />
    </MemoryRouter>,
  );
  expect(container.querySelector('[data-streaming-orb]')).not.toBeNull();
});

it('does NOT show the streaming orb when no stream exists', () => {
  useStreamManagerStore.setState({ streams: new Map() });
  const persona = makePersona({ id: 'p1' });
  const mindspace = makeMindspace();
  const { container } = render(
    <MemoryRouter>
      <PersonaCard persona={persona} mindspace={mindspace} hasProvider={true} onChat={vi.fn()} />
    </MemoryRouter>,
  );
  expect(container.querySelector('[data-streaming-orb]')).toBeNull();
});
```

Adapt `makePersona`, `makeMindspace` to whichever helpers the existing file uses.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter user-client test -- persona-card`
Expected: FAIL — no orb rendered.

- [ ] **Step 3: Wire StreamingOrb into PersonaCard**

In `apps/user-client/src/components/PersonaCard.tsx`, add the import and the orb inside the `<li data-persona-card …>` (the outer container that already has `relative` positioning via the texture overlay):

```tsx
import { StreamingOrb } from './StreamingOrb.js';

// …inside the JSX, just before <MindspaceTexture …>:
<StreamingOrb personaId={persona.id} colour={mindspace.palette.accent} />
```

Since `.persona-card` already has `position: relative` (or gets it from the existing texture overlay rules), the orb's `position: absolute` pins to the card's corner correctly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter user-client test -- persona-card`
Expected: PASS — existing + new tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/PersonaCard.tsx apps/user-client/tests/unit/persona-card.test.tsx
git commit -m "$(cat <<'EOF'
Phase 4 alpha-prep task 8 — PersonaCard shows StreamingOrb

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: HistoryRow integrates StreamingOrb

**Files:**
- Modify: `apps/user-client/src/components/history/HistoryRow.tsx`
- Modify: `apps/user-client/tests/unit/history-row.test.tsx`

- [ ] **Step 1: Add failing test**

Append to `apps/user-client/tests/unit/history-row.test.tsx`:

```tsx
import { useStreamManagerStore } from '../../src/state/stream-manager.store';

it('shows the streaming orb when the row\'s persona has a live stream', () => {
  useStreamManagerStore.setState({
    streams: new Map([
      ['cX', {
        chatId: 'cX', personaId: 'p1',
        draftMessageId: 'd1',
        controller: new AbortController(),
        status: 'streaming',
        contentBuffer: [], pillBuffer: [], startedAt: 0,
      }],
    ]),
  });
  const { container } = render(
    wrap(<HistoryRow chat={chat} persona={persona} onRename={vi.fn()} onDelete={vi.fn()} />),
  );
  expect(container.querySelector('[data-streaming-orb]')).not.toBeNull();
});

it('does NOT show the orb when no live stream', () => {
  useStreamManagerStore.setState({ streams: new Map() });
  const { container } = render(
    wrap(<HistoryRow chat={chat} persona={persona} onRename={vi.fn()} onDelete={vi.fn()} />),
  );
  expect(container.querySelector('[data-streaming-orb]')).toBeNull();
});
```

`chat`, `persona`, `wrap` are already defined in the existing file. The `persona.id` should be `'p1'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter user-client test -- history-row`
Expected: FAIL.

- [ ] **Step 3: Add orb to HistoryRow + CSS**

In `apps/user-client/src/components/history/HistoryRow.tsx`, add the import and place the orb inside the row's outer `<li>`. The row's outer container may not yet have `position: relative` — add it via a class or inline style:

```tsx
import { StreamingOrb } from '../StreamingOrb.js';

// …inside the idle-mode return, just inside the <li>:
<li className="history-row relative rounded-lg border border-white/5 bg-white/[0.02]">
  <StreamingOrb personaId={persona.id} colour={persona.colour} />
  <div className="flex items-stretch">
    {/* …existing row body… */}
  </div>
</li>
```

The `relative` class addition is essential — `position: absolute` on the orb needs an ancestor with `position: relative`.

Same for the confirm-delete return path: keep the orb inside the outer `<li>` if visible (typically the orb stays even during confirm-tray mode — the stream's still alive even while the user considers deletion).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter user-client test -- history-row`
Expected: PASS — existing + new cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/history/HistoryRow.tsx apps/user-client/tests/unit/history-row.test.tsx
git commit -m "$(cat <<'EOF'
Phase 4 alpha-prep task 9 — HistoryRow shows StreamingOrb

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: MINDSPACE_FALLBACK defensive harden

**Files:**
- Modify: `apps/user-client/src/components/chat/ChatStream.tsx`
- Modify: `apps/user-client/tests/unit/chat-stream.test.tsx` (add a destructure-completeness test)

- [ ] **Step 1: Add failing test**

Append to `apps/user-client/tests/unit/chat-stream.test.tsx`:

```tsx
import { MINDSPACE_FALLBACK } from '../../src/components/chat/ChatStream';

describe('MINDSPACE_FALLBACK', () => {
  it('has all ResolvedMindspace fields populated (no undefined)', () => {
    expect(MINDSPACE_FALLBACK.id).toBeTruthy();
    expect(MINDSPACE_FALLBACK.displayName).toBeTruthy();
    expect(MINDSPACE_FALLBACK.texture).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.bg).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.surfaceBase).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.accent).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.accentSubtle).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.accentBorder).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.accentBorderActive).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.accentGlow).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.text.primary).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.text.secondary).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.text.muted).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.text.ghost).toBeTruthy();
  });
});
```

The `import { MINDSPACE_FALLBACK }` requires that the constant becomes a named export. The implementation step exports it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter user-client test -- chat-stream`
Expected: FAIL — `MINDSPACE_FALLBACK` not exported, or fields undefined.

- [ ] **Step 3: Replace the placeholder + export**

In `apps/user-client/src/components/chat/ChatStream.tsx`, find the existing `MINDSPACE_FALLBACK` declaration and replace with:

```ts
import type { ResolvedMindspace } from '../../state/mindspace-resolver.js';

/**
 * Load-bearing default — survives the brief window between component mount
 * and the global mindspace store being populated. Any consumer that reads
 * `mindspace.accent`, `mindspace.palette.text.*`, etc. before the store
 * hydrates lands on these neutral values rather than `undefined`.
 */
export const MINDSPACE_FALLBACK: ResolvedMindspace = {
  id: 'fallback',
  displayName: 'Fallback',
  texture: 'grain',
  palette: {
    bg: '#1a1a1a',
    surfaceBase: '#222222',
    surfaceRaised: '#2a2a2a',
    surfaceInput: '#1e1e1e',
    accent: '#888888',
    accentSubtle: 'rgba(136,136,136,0.06)',
    accentBorder: 'rgba(136,136,136,0.3)',
    accentBorderActive: 'rgba(136,136,136,0.6)',
    accentGlow: 'rgba(136,136,136,0.5)',
    text: {
      primary: '#e6e6e6',
      secondary: '#bdbdbd',
      muted: '#8a8a8a',
      ghost: '#5a5a5a',
    },
  },
};
```

The existing in-component reference (`mindspace ?? MINDSPACE_FALLBACK` or similar) stays unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter user-client test -- chat-stream`
Expected: PASS — existing + new completeness test.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/chat/ChatStream.tsx apps/user-client/tests/unit/chat-stream.test.tsx
git commit -m "$(cat <<'EOF'
Phase 4 alpha-prep task 10 — MINDSPACE_FALLBACK defensive harden

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: version.txt + Vite injection + lib/version.ts

**Files:**
- Create: `version.txt` at repo root
- Modify: `apps/user-client/vite.config.ts`
- Modify: `apps/user-client/src/vite-env.d.ts` (add ambient declares)
- Create: `apps/user-client/src/lib/version.ts`
- Create: `apps/user-client/tests/unit/version.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/user-client/tests/unit/version.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../../src/lib/version';

describe('APP_VERSION', () => {
  it('exposes version, sha, and builtAt strings', () => {
    expect(typeof APP_VERSION.version).toBe('string');
    expect(typeof APP_VERSION.sha).toBe('string');
    expect(typeof APP_VERSION.builtAt).toBe('string');
  });
  it('defaults to "dev" when no build-time globals are defined', () => {
    // In the Vitest environment, the globals are NOT defined via vite.config.ts's
    // `define` (Vitest has its own config). So defaults apply.
    expect(APP_VERSION.version).toBe('dev');
    expect(APP_VERSION.sha).toBe('dev');
    expect(APP_VERSION.builtAt).toBe('dev');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter user-client test -- version`
Expected: FAIL — module not found.

- [ ] **Step 3: Create version.txt, lib/version.ts, vite-env.d.ts, vite.config.ts changes**

Create `version.txt` at repo root:

```
0.0.1
```

Create `apps/user-client/src/lib/version.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

declare const __APP_VERSION__: string;
declare const __APP_SHA__: string;
declare const __APP_BUILT_AT__: string;

export interface VersionInfo {
  version: string;   // "0.0.1" | "0.0.1-pre.42" | "dev"
  sha: string;       // "1796752" | "dev"
  builtAt: string;   // ISO-8601 UTC | "dev"
}

/**
 * Build-time-injected version info. Defaults to "dev" everywhere when the
 * globals aren't defined (local dev, vitest, etc.). The GitHub Actions
 * `pages.yml` workflow injects these via Vite `define` at build time.
 */
export const APP_VERSION: VersionInfo = {
  version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev',
  sha: typeof __APP_SHA__ !== 'undefined' ? __APP_SHA__ : 'dev',
  builtAt: typeof __APP_BUILT_AT__ !== 'undefined' ? __APP_BUILT_AT__ : 'dev',
};
```

Add ambient declarations to `apps/user-client/src/vite-env.d.ts` (or create the file if missing):

```ts
/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
declare const __APP_SHA__: string;
declare const __APP_BUILT_AT__: string;
```

Modify `apps/user-client/vite.config.ts`. Add `base` and `define`:

```ts
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  define: {
    __APP_VERSION__:  JSON.stringify(process.env.APP_VERSION  ?? 'dev'),
    __APP_SHA__:      JSON.stringify(process.env.APP_SHA      ?? 'dev'),
    __APP_BUILT_AT__: JSON.stringify(process.env.APP_BUILT_AT ?? 'dev'),
  },
  plugins: [
    react(),
    tailwindcss(),
    dbDumpReceiver(),
    VitePWA({
      // …existing options retained…
      base: process.env.VITE_BASE ?? '/',
      scope: process.env.VITE_BASE ?? '/',
      manifest: {
        // …existing fields retained…
        start_url: process.env.VITE_BASE ?? '/',
        scope: process.env.VITE_BASE ?? '/',
      },
    }),
  ],
});
```

Look at the existing `vite.config.ts` first — preserve all current options (plugins, build settings, the `dbDumpReceiver`, etc.). Only add the `base` field at the top and the `define` block; merge the `base`/`scope`/`start_url` into existing PWA options.

- [ ] **Step 4: Run tests + typecheck to verify**

Run: `pnpm --filter user-client test -- version`
Expected: PASS.
Run: `pnpm typecheck`
Expected: clean (the ambient declares satisfy `lib/version.ts`'s declarations).

- [ ] **Step 5: Commit**

```bash
git add version.txt apps/user-client/vite.config.ts apps/user-client/src/vite-env.d.ts apps/user-client/src/lib/version.ts apps/user-client/tests/unit/version.test.ts
git commit -m "$(cat <<'EOF'
Phase 4 alpha-prep task 11 — version.txt + Vite define + lib/version.ts

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Version display in Entrance Hall + Account About

**Files:**
- Modify: `apps/user-client/src/routes/app/entrance-hall.tsx`
- Modify: `apps/user-client/src/routes/app/account-sections/about-section.tsx`
- Modify: `apps/user-client/tests/unit/entrance-hall.test.tsx`
- Modify: `apps/user-client/tests/unit/account.about.test.tsx` (or wherever About is tested — create if absent)

- [ ] **Step 1: Add failing tests**

Append to `apps/user-client/tests/unit/entrance-hall.test.tsx`:

```tsx
import { APP_VERSION } from '../../src/lib/version';

it('renders the version footer with the current pre-version + sha', async () => {
  await _resetClientDataDbForTests();
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app']}>
        <EntranceHall />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // In the test environment APP_VERSION = { version: 'dev', sha: 'dev', builtAt: 'dev' }
  // The footer copy renders both pieces; assert structurally.
  const footer = document.querySelector('footer');
  expect(footer).not.toBeNull();
  expect(footer?.textContent).toContain(`v${APP_VERSION.version}`);
  expect(footer?.textContent).toContain(`sha ${APP_VERSION.sha}`);
});
```

Find or create `apps/user-client/tests/unit/account.about.test.tsx` and add (creating the file with the right harness):

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AboutSection } from '../../src/routes/app/account-sections/about-section';
import { APP_VERSION } from '../../src/lib/version';

describe('AboutSection', () => {
  it('renders the version block with version, sha, and built-at', () => {
    const { container } = render(<AboutSection />);
    const text = container.textContent ?? '';
    expect(text).toContain(`Version`);
    expect(text).toContain(APP_VERSION.version);
    expect(text).toContain(`sha`);
    expect(text).toContain(APP_VERSION.sha);
    expect(text).toContain(`built`);
    expect(text).toContain(APP_VERSION.builtAt);
  });
});
```

If `AboutSection` requires props (e.g. settings), inject the minimal stub or use a render wrapper. Check the existing file for context.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter user-client test -- entrance-hall account.about`
Expected: FAIL.

- [ ] **Step 3: Add the version footer + About block**

In `apps/user-client/src/routes/app/entrance-hall.tsx`, locate the outer `<section …>` and add a `<footer>` at its end:

```tsx
import { APP_VERSION } from '../../lib/version.js';

// …at the end of the EntranceHall return, just before </section>:
<footer className="mt-auto pt-6 text-center text-[10px] uppercase tracking-widest text-paper-soft/40">
  v{APP_VERSION.version} · sha {APP_VERSION.sha}
</footer>
```

The outer `<section>` already has `flex min-h-[80dvh] flex-col`. `mt-auto` pushes the footer to the bottom of the flex column. If the structure differs, adapt accordingly.

In `apps/user-client/src/routes/app/account-sections/about-section.tsx`, near the top of the About accordion's contents, add:

```tsx
import { APP_VERSION } from '../../../lib/version.js';

// …inside the section JSX, before the existing copy:
<div className="mb-3 rounded-md border border-paper-soft/20 bg-black/20 p-3 font-mono text-xs text-paper-soft">
  <div>Version <span className="text-paper">{APP_VERSION.version}</span></div>
  <div>sha     <span className="text-paper">{APP_VERSION.sha}</span></div>
  <div>built   <span className="text-paper">{APP_VERSION.builtAt}</span></div>
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter user-client test -- entrance-hall account.about`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/entrance-hall.tsx apps/user-client/src/routes/app/account-sections/about-section.tsx apps/user-client/tests/unit/entrance-hall.test.tsx apps/user-client/tests/unit/account.about.test.tsx
git commit -m "$(cat <<'EOF'
Phase 4 alpha-prep task 12 — version display in Entrance Hall + Account About

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: GitHub Actions `pages.yml`

**Files:**
- Create: `.github/workflows/pages.yml`

No tests for this — verification is via a workflow run (Task 15 + manual Pages-source flip).

- [ ] **Step 1: Create the workflow**

```yaml
# .github/workflows/pages.yml
name: GitHub Pages Deploy

on:
  push:
    branches: [master]
    tags: ['v*.*.*']

concurrency:
  group: pages
  cancel-in-progress: true

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up mise (bun, node, pnpm)
        uses: jdx/mise-action@v2

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck

      - name: Compute version
        id: version
        run: |
          BASE=$(cat version.txt | tr -d '[:space:]')
          if [[ "$GITHUB_REF" == refs/tags/v* ]]; then
            VERSION="${GITHUB_REF#refs/tags/v}"
          else
            VERSION="${BASE}-pre.${GITHUB_RUN_NUMBER}"
          fi
          SHORT_SHA=$(echo "$GITHUB_SHA" | cut -c1-7)
          BUILT_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
          echo "version=$VERSION"     >> $GITHUB_OUTPUT
          echo "short_sha=$SHORT_SHA" >> $GITHUB_OUTPUT
          echo "built_at=$BUILT_AT"   >> $GITHUB_OUTPUT
          echo "Resolved version: $VERSION (sha=$SHORT_SHA built_at=$BUILT_AT)"

      - name: Build PWA with /alpha/ base
        env:
          VITE_BASE: /alpha/
          APP_VERSION:  ${{ steps.version.outputs.version }}
          APP_SHA:      ${{ steps.version.outputs.short_sha }}
          APP_BUILT_AT: ${{ steps.version.outputs.built_at }}
        run: pnpm --filter user-client build

      - name: Stage Pages output
        run: |
          mkdir -p _pages
          cp -r docs/* _pages/
          cp -r apps/user-client/dist _pages/alpha

      - name: Write build manifest
        env:
          VERSION:   ${{ steps.version.outputs.version }}
          SHORT_SHA: ${{ steps.version.outputs.short_sha }}
          BUILT_AT:  ${{ steps.version.outputs.built_at }}
        run: |
          cat > _pages/alpha/build-manifest.json << EOF
          {
            "schema": "chatsundere-build/v1",
            "built_at": "$BUILT_AT",
            "trigger": "${GITHUB_EVENT_NAME}",
            "ref": "$GITHUB_REF",
            "artifact": {
              "name": "user-client",
              "type": "pwa",
              "version": "$VERSION",
              "git_sha": "$SHORT_SHA"
            }
          }
          EOF

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: _pages

      - name: Deploy to GitHub Pages
        id: deploy
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Verify YAML parses with a quick lint**

Run: `cat .github/workflows/pages.yml | head -1`
(or any quick YAML inspector if available locally — at minimum check that the file is valid YAML syntactically.)
Expected: file exists, no obvious indentation errors.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "$(cat <<'EOF'
Phase 4 alpha-prep task 13 — GitHub Actions Pages deploy workflow

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

After this commit lands on master, the workflow will attempt to run. It will SUCCEED at the build step but FAIL at the deploy step until Chris manually switches the Pages source. That's expected and OK — Task 15 surfaces the click-folge for Chris to do that flip.

---

### Task 14: README versioning section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read existing README**

Run: `head -30 README.md`
Identify where to insert. Likely at the end, before any existing "License" section.

- [ ] **Step 2: Append a new section**

Append to `README.md` (find the right place — typically after Installation / Usage, before Licence):

```markdown
## Versioning & deployment

This repo follows a `version.txt`-driven scheme adapted from
[chatsune](https://github.com/symphonic-navigator/chatsune). The base
version lives in `version.txt` at the repo root.

- A push to `master` builds `<base>-pre.<run-number>` and deploys to
  `https://teaser.chatsundere.me/alpha/`.
- A push of an annotated tag `vX.Y.Z` (matching `version.txt`) builds
  `X.Y.Z` and replaces the `/alpha/` deployment.

The current alpha-deploy is a PWA served from GitHub Pages alongside
the public teaser site. There is intentionally no link from the teaser
to the alpha — access is invite-only by URL.

See `superpowers/specs/2026-05-26-phase-4-alpha-prep-design.md` for
the full design.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
Phase 4 alpha-prep task 14 — README versioning section [skip ci]

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

NB: `[skip ci]` because this is a doc-only commit.

---

### Task 15: Full verification

**Files:** none modified — verification only.

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: clean exit (13 successful).

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: clean exit, no fixes applied.

- [ ] **Step 3: Build PWA locally with default base**

Run: `pnpm --filter user-client build`
Expected: clean exit, dist artefacts written. Version footer in dist will read "vdev · sha dev" because no env vars set.

- [ ] **Step 4: Build PWA with simulated alpha env**

Run:
```bash
APP_VERSION=0.0.1-pre.simulated APP_SHA=abcdef0 APP_BUILT_AT=2026-05-26T20:00:00Z VITE_BASE=/alpha/ pnpm --filter user-client build
```
Expected: clean exit. Inspect `apps/user-client/dist/index.html` to confirm `/alpha/` base in asset paths. Inspect `dist/assets/index-*.js` for the literal strings `"0.0.1-pre.simulated"` and `"abcdef0"` — verifies the `define` injection works.

- [ ] **Step 5: Full test suite**

Run: `pnpm --filter user-client test`
Expected: ~516 pass / 8 known-fail (cockpit-draft localStorage cascade — unchanged).

Run: `pnpm --filter @chatsundere/llm-unified test`
Expected: ~192 pass / 0 fail (existing 172 + ~20 new from retry/stream-completion/one-shot tests).

- [ ] **Step 6: Surface Pages-source click-folge for Chris**

After all of the above is green, output the following click-folge so Chris can do the one-time manual flip:

> **One-time Pages settings flip (Chris does this once):**
>
> 1. Open `https://github.com/symphonic-navigator/chatsundere/settings/pages`
> 2. Under **Source**, change "Deploy from a branch" → "GitHub Actions"
> 3. The page may auto-save; if not, click Save
> 4. Trigger a re-run: Actions → "GitHub Pages Deploy" → Run workflow on master
> 5. After the workflow goes green, visit `https://teaser.chatsundere.me/alpha/` and verify the PWA loads
>
> If the CNAME stops resolving after the source switch, re-add `teaser.chatsundere.me` under the same Pages settings page's "Custom domain" field (it should persist, but worth a glance).

No commit at this step. Verification only.

---

### Task 16: STATUS-CLIENT-ONLY update + squash + tag v0.0.1

**Files:**
- Modify: `obsidian/STATUS-CLIENT-ONLY.md` (record what landed)

This task is interactive — Chris does step 3 (smoke) + step 5 (tag) manually. The implementer prepares everything else.

- [ ] **Step 1: Update STATUS-CLIENT-ONLY.md**

Add a new "Done" section entry above the existing "Phase 4 simple-history" block, summarising what landed across tasks 1-14. Follow the existing summary style — list the new modules, file additions, test counts, what surfaces changed.

Suggested shape:

```markdown
- **Phase 4 alpha-prep (2026-05-26 evening, 14 task-commits, awaiting
  manual smoke + squash + v0.0.1 tag)**. Four polish items deferred
  from Phase 3.3 (chatsune-style retry helper in
  `packages/llm-unified/src/retry.ts` consumed by stream-completion
  initial-fetch loop AND wrapping the one-shot title-gen via
  `withRetry`; affordance breathing / scroll-to-end swap-in/out /
  cockpit pin glow CSS; per-card `StreamingOrb` on Circle + History;
  `MINDSPACE_FALLBACK` defensive harden) PLUS the build/deploy
  pipeline (`version.txt` at repo root = "0.0.1"; chatsune-style
  version computation in `.github/workflows/pages.yml`; Vite-time
  `__APP_VERSION__` / `__APP_SHA__` / `__APP_BUILT_AT__` injection;
  Entrance-Hall footer + Account About surfacing the version; PWA
  deploys to `teaser.chatsundere.me/alpha/` via `actions/deploy-pages@v4`).
  ~30 new Vitest + Bun cases. `pnpm typecheck`, `pnpm lint`, full
  test suite all clean. Pages-source flip happens manually once
  before the first successful deploy; click-folge in §15.
  Spec: [`superpowers/specs/2026-05-26-phase-4-alpha-prep-design.md`](../superpowers/specs/2026-05-26-phase-4-alpha-prep-design.md).
  Plan: [`superpowers/plans/2026-05-26-phase-4-alpha-prep.md`](../superpowers/plans/2026-05-26-phase-4-alpha-prep.md).
```

Also update **Doing now / Next session** to reflect the post-alpha-prep state — v0.0.1 tag + first-tester invitations are the next milestone.

Commit:

```bash
git add obsidian/STATUS-CLIENT-ONLY.md
git commit -m "$(cat <<'EOF'
Phase 4 alpha-prep — STATUS update [skip ci]

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Squash all task-commits + STATUS commit**

After Chris's manual smoke (spec §7 items 1-10) passes:

```bash
git log --oneline -20  # confirm range
git rebase -i HEAD~15  # tasks 1-14 + STATUS commit
# In the editor: keep first commit as `pick`, mark the rest `squash`
```

Use this commit message for the squashed result:

```
Phase 4 alpha-prep squashed — polish + build pipeline + v0.0.1 baseline

Lands the four pre-alpha polish items (chatsune-style retry helper in
packages/llm-unified consumed by stream-completion initial fetch and
one-shot title-gen; affordance breathing / scroll-to-end swap / pin
glow CSS; per-card StreamingOrb on Circle + History; hardened
MINDSPACE_FALLBACK) plus the build/deploy pipeline (version.txt at
repo root, chatsune-style version computation in
.github/workflows/pages.yml, Vite-time __APP_VERSION__ / __APP_SHA__ /
__APP_BUILT_AT__ injection, Entrance-Hall footer + Account About
surface, deploy to teaser.chatsundere.me/alpha/ via actions/deploy-pages@v4).

Spec: superpowers/specs/2026-05-26-phase-4-alpha-prep-design.md
Plan: superpowers/plans/2026-05-26-phase-4-alpha-prep.md

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
```

- [ ] **Step 3: Chris flips Pages settings (manual, click-folge from §15)**

Per §15 Step 6 instructions, Chris navigates to Pages settings and switches the source to GitHub Actions.

- [ ] **Step 4: Trigger the first master-push deploy**

Push the squashed commit to master:

```bash
git push origin master
```

GH Actions runs `pages.yml`. Verify it succeeds end-to-end.
Visit `https://teaser.chatsundere.me/alpha/` and confirm the app loads
with `v0.0.1-pre.<N> · sha <abc1234>` in the Entrance-Hall footer.

- [ ] **Step 5: Tag v0.0.1**

After Chris's pre-deploy smoke is green:

```bash
git tag -a v0.0.1 -m "First alpha release"
git push origin v0.0.1
```

GH Actions runs `pages.yml` again with the tag context. Version
resolves to `0.0.1` (no `-pre` suffix). `/alpha/` updates.

- [ ] **Step 6: Final smoke**

After tag deploy, refresh `https://teaser.chatsundere.me/alpha/`.
Confirm footer reads `v0.0.1 · sha <abc1234>`.

Workflow complete. Chris can now start inviting alpha testers.

---

## Self-review summary

**Spec coverage:**
- §1 In-scope items → Tasks 1-14 (14 items, all covered).
- §2 Decisions → embedded in tasks: D1 bundled (single plan ✓), D2-D3 retry shape (Task 1), D4-D5 polish defaults (Tasks 4-9), D6 fallback harden (Task 10), D7-D10 version pipeline (Tasks 11-12), D11-D13 deploy mechanism (Task 13), D14 manual flip (Task 15 click-folge), D15 no teaser→alpha link (covered — no link added in any task), D16 no-retry-on-abort (Task 1 test + Task 2/3 integration), D17 opt-in retry (transport.ts and one-shot-completion.ts both wrap explicitly).
- §7 manual verification → Task 15 instructions cover §7 items.

**Placeholder scan:**
- One TBD in Task 2 / Task 3 test code: `function streamArgs(): StreamCompletionArgs { … }` and `function oneShotArgs(): OneShotCompletionArgs { … }`. These are explicit re-use directives ("Re-use the existing test helper in this file if present, else inline a minimal one"). Acceptable because the existing test files in `packages/llm-unified/src/*.test.ts` already define their own arg-helpers — the implementer pads the test with whatever the file already has. If the implementer reports DONE_WITH_CONCERNS because no such helper exists, controller can guide them to inline a minimal one.

**Type consistency:**
- `withRetry<T>(fn, opts)` defined Task 1, consumed Task 3 → ✓.
- `shouldRetryStatus(status)` / `computeRetryDelay(attempt, retryAfter)` / `parseRetryAfter(headers)` defined Task 1, consumed Task 2 → ✓.
- `StreamingOrb({ personaId, colour })` defined Task 7, consumed Tasks 8 + 9 → ✓.
- `APP_VERSION: VersionInfo` defined Task 11, consumed Task 12 → ✓.
- `MINDSPACE_FALLBACK: ResolvedMindspace` defined Task 10, exported via `export const` for the test to import → ✓.

**Discovery note:**
- Chatsune retry uses `{429, 503}` only as default; this plan uses `[408, 429, 500, 502, 503, 504]` (broader). Documented in Task 1's JSDoc with rationale ("hit multiple providers"). If alpha-test feedback shows the broader set causes false retries on real fatal errors, narrow in Phase 5.
