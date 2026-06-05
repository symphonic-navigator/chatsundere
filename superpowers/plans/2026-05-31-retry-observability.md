# Retry Observability + `withStreamingRetry` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make provider-call retries observable, fix the latent `ERR_BODY_ALREADY_USED` bug at all three call-sites, and consolidate the two hand-rolled streaming loops into one helper.

**Architecture:** `packages/llm-unified/src/retry.ts` stays dependency-free and gains a typed `RetryEvent`, an `onRetry` hook on both retry helpers, a pure `formatRetryEvent` formatter, and a new `withStreamingRetry` helper that owns the streaming loop (fresh Request per attempt, optional TTFB timeout, body-cancel, `onRetry`). Callers in `apps/` and `curation/` inject a `console.warn(formatRetryEvent(e))` sink — `src/` never calls `console`. one-shot gets the same fresh-Request fix plus an overall timeout.

**Tech Stack:** TypeScript (strict), Bun test runner, WHATWG `fetch`/`Request`/`AbortSignal`.

**Spec:** [`superpowers/specs/2026-05-31-retry-observability-design.md`](../specs/2026-05-31-retry-observability-design.md)

**Test commands:**
- Single file: `cd packages/llm-unified && bun test src/retry.test.ts`
- Filter: `cd packages/llm-unified && bun test src/retry.test.ts -t "withStreamingRetry"`
- Full package: `cd packages/llm-unified && bun test`
- Type gate (run before final commit): `pnpm typecheck` (repo root)

**Commit style:** free-form imperative, capitalised subject. Co-author trailer `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. These commits touch code → **no** `[skip ci]`. The whole plan is one feature unit; the final task squashes intent — but commit per task during execution, then squash at the end per ADR 0003.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/llm-unified/src/retry.ts` | `RetryEvent`/`OnRetry` types, `formatRetryEvent`, `onRetry` on `withRetry`, new `withStreamingRetry` | Modify |
| `packages/llm-unified/src/retry.test.ts` | Unit tests for the above incl. fresh-Request regression | Modify |
| `packages/llm-unified/src/index.ts` | Barrel: export the new public symbols | Modify |
| `packages/llm-unified/src/stream-completion.ts` | Use `withStreamingRetry`; add `onRetry` arg | Modify |
| `packages/llm-unified/src/stream-completion.test.ts` | Un-mask the 503 retry test (body-reading mock) | Modify |
| `packages/llm-unified/src/one-shot-completion.ts` | Fresh-Request fix, `onRetry`, `timeoutMs` | Modify |
| `packages/llm-unified/src/one-shot-completion.test.ts` | Body-reading regression test | Modify |
| `packages/llm-unified/curation/conversation-suite/binding.ts` | Use `withStreamingRetry`; default `console` sink | Modify |
| `packages/llm-unified/curation/conversation-suite/binding.test.ts` | `onRetry` fires; 3c0642d regression still green | Modify |
| `apps/user-client/src/lib/stream-engine.ts` | Inject `console` sink into `streamCompletion` | Modify |
| `apps/user-client/src/lib/title-generator.ts` | Inject `console` sink into `runOneShotCompletion` | Modify |
| `packages/llm-unified/README.md` | Background-job convention line | Modify |
| `obsidian/insights/follow-ups-index.md` | Record the deferred `prom-client` metrics half | Modify |

---

## Task 1: `RetryEvent` types + `formatRetryEvent`

**Files:**
- Modify: `packages/llm-unified/src/retry.ts`
- Modify: `packages/llm-unified/src/retry.test.ts`
- Modify: `packages/llm-unified/src/index.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/llm-unified/src/retry.test.ts`:

```ts
import { formatRetryEvent, type RetryEvent } from './retry.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/retry.test.ts -t "formatRetryEvent"`
Expected: FAIL — `formatRetryEvent` is not exported.

- [ ] **Step 3: Add the types and formatter to `retry.ts`**

Insert after the constants block (after `RETRYABLE_STATUSES` definition, before `shouldRetryStatus`):

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/retry.test.ts -t "formatRetryEvent"`
Expected: PASS (2 tests).

- [ ] **Step 5: Export from the barrel**

In `packages/llm-unified/src/index.ts`, find the existing `retry.js` re-export (or add one) and ensure it includes the new symbols. Add this line (or extend the existing retry export):

```ts
export { formatRetryEvent, type RetryEvent, type OnRetry, type RetryErrorKind } from './retry.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/llm-unified/src/retry.ts packages/llm-unified/src/retry.test.ts packages/llm-unified/src/index.ts
git commit -m "Add RetryEvent type and formatRetryEvent to llm-unified retry helper

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 2: `onRetry` + `classifyError` on `withRetry`

**Files:**
- Modify: `packages/llm-unified/src/retry.ts:56-106`
- Modify: `packages/llm-unified/src/retry.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `retry.test.ts`:

```ts
import { withRetry, type RetryEvent as RE } from './retry.js';

describe('withRetry onRetry hook', () => {
  it('fires onRetry once per retry with a classified event', async () => {
    const events: RE[] = [];
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
    expect(events[0]).toMatchObject({ operation: 'unit', attempt: 0, status: 503, errorKind: 'status' });
    expect(events[1]).toMatchObject({ attempt: 1, status: 503, errorKind: 'status' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/retry.test.ts -t "onRetry hook"`
Expected: FAIL — `operation`/`classifyError`/`onRetry` not in `WithRetryOpts`.

- [ ] **Step 3: Extend `WithRetryOpts` and `withRetry`**

In `retry.ts`, replace the `WithRetryOpts` interface with:

```ts
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
```

Then, inside `withRetry`, in the `catch` block, after `const delaySeconds = computeRetryDelay(attempt, retryAfter);` and **before** `await sleep(delaySeconds * 1000);`, insert:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/retry.test.ts -t "onRetry hook"`
Expected: PASS.

- [ ] **Step 5: Run the full retry test file (no regressions)**

Run: `cd packages/llm-unified && bun test src/retry.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-unified/src/retry.ts packages/llm-unified/src/retry.test.ts
git commit -m "Add onRetry/classifyError hook to withRetry

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 3: `withStreamingRetry` helper (incl. fresh-Request regression)

**Files:**
- Modify: `packages/llm-unified/src/retry.ts`
- Modify: `packages/llm-unified/src/retry.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `retry.test.ts`:

```ts
import { withStreamingRetry } from './retry.js';

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
    const events: RE[] = [];
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
    expect(events).toEqual([
      { operation: 'unit-stream', attempt: 0, delaySeconds: events[0]!.delaySeconds, status: 503, errorKind: 'status' },
    ]);
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/llm-unified && bun test src/retry.test.ts -t "withStreamingRetry"`
Expected: FAIL — `withStreamingRetry` not exported.

- [ ] **Step 3: Implement `withStreamingRetry`**

Append to `retry.ts`:

```ts
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
        opts.onRetry?.({ operation: opts.operation, attempt, delaySeconds: delay, errorKind: 'network' });
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/llm-unified && bun test src/retry.test.ts -t "withStreamingRetry"`
Expected: PASS (5 tests).

- [ ] **Step 5: Export from the barrel**

In `packages/llm-unified/src/index.ts`, extend the retry export to include the helper and its opts type:

```ts
export { withStreamingRetry, type StreamingRetryOpts } from './retry.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/llm-unified/src/retry.ts packages/llm-unified/src/retry.test.ts packages/llm-unified/src/index.ts
git commit -m "Add withStreamingRetry helper with fresh-Request-per-attempt

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 4: Refactor `stream-completion` onto `withStreamingRetry`

**Files:**
- Modify: `packages/llm-unified/src/stream-completion.ts:1-152`
- Modify: `packages/llm-unified/src/stream-completion.test.ts:253-278`

- [ ] **Step 1: Un-mask the existing 503 retry test (write the stricter test first)**

In `stream-completion.test.ts`, replace the body of the test at `:254` (`'retries on 503 then succeeds with streamed content'`) so its mock **reads the request body** — the old reuse bug would throw on the second read:

```ts
  it('retries on 503 then succeeds with streamed content', async () => {
    let attempts = 0;
    const bodies: string[] = [];
    const fetchMock = mock(async (req: Request) => {
      attempts++;
      bodies.push(await req.text()); // consume the body, as real fetch does
      if (attempts < 3) {
        return new Response('upstream busy', { status: 503 });
      }
      return new Response(
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
    // All three attempts sent an identical, fully-readable body.
    expect(bodies).toHaveLength(3);
    expect(new Set(bodies).size).toBe(1);
  });
```

- [ ] **Step 2: Run it to confirm it fails on the current code**

Run: `cd packages/llm-unified && bun test src/stream-completion.test.ts -t "retries on 503"`
Expected: FAIL — second `fetch(request)` throws on the already-used body (the bug, now un-masked).

- [ ] **Step 3: Refactor `stream-completion.ts`**

Replace the imports block at the top (`retry.js` import) so it brings in the helper and the type:

```ts
import { withStreamingRetry, type OnRetry } from './retry.js';
```

(Remove `MAX_RETRY_ATTEMPTS, computeRetryDelay, parseRetryAfter, shouldRetryStatus` from the retry import — they are no longer used here.)

Add an `onRetry` field to `StreamCompletionArgs` (after `initialResponseTimeoutMs?`):

```ts
  /** Optional sink for retry decisions. Caller (apps/) wires the console line. */
  onRetry?: OnRetry;
```

Replace the request-build + retry loop + null-guard (current `:72-139`, from `const request = buildRequest({` through the `if (!response) { ... }` block) with:

```ts
  const timeoutMs = args.initialResponseTimeoutMs ?? DEFAULT_INITIAL_RESPONSE_TIMEOUT_MS;

  const response = await withStreamingRetry({
    buildRequest: () =>
      buildRequest({
        provider: args.providerConfig,
        apiKey: args.apiKey,
        corsProxyUrl: args.corsProxyUrl,
        corsProxyKey: args.corsProxyKey,
        path: '/chat/completions',
        method: 'POST',
        body,
        extraHeaders,
      }),
    operation: 'stream-completion',
    initialResponseTimeoutMs: timeoutMs,
    signal: args.signal,
    onRetry: args.onRetry,
  });
```

Leave the subsequent `if (!response.ok) { throw ... }`, `if (!response.body) { throw ... }`, and the adapter/SSE yield untouched.

- [ ] **Step 4: Run the un-masked test + full file**

Run: `cd packages/llm-unified && bun test src/stream-completion.test.ts`
Expected: all PASS, including `retries on 503` now that fresh Requests are built per attempt.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/stream-completion.ts packages/llm-unified/src/stream-completion.test.ts
git commit -m "Move stream-completion onto withStreamingRetry; fix Request reuse bug

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 5: Wire the console sink into `stream-engine` (user-client)

**Files:**
- Modify: `apps/user-client/src/lib/stream-engine.ts:1-10,76-86`

- [ ] **Step 1: Add the import**

In the `@chatsundere/llm-unified` import block (`:1-10`), add `formatRetryEvent` to the imported names:

```ts
  composeSystemPrompt,
  formatRetryEvent,
  offeringToTarget,
  streamCompletion,
```

- [ ] **Step 2: Inject the sink into the `streamCompletion` call**

In the `for await (const chunk of streamCompletion({ ... }))` args (`:76-86`), add as the last property before the closing `})`:

```ts
    signal: args.signal,
    onRetry: (e) => console.warn(formatRetryEvent(e)),
```

(Replace the existing `signal: args.signal,` line with the two lines above.)

- [ ] **Step 3: Typecheck the user-client**

Run: `pnpm typecheck`
Expected: PASS (no type errors; `onRetry` is a known optional field).

This sink is a one-liner integration point — no unit test (CLAUDE.md §10: no tests for trivial one-liners). Covered by the Manual verification section of the spec.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/lib/stream-engine.ts
git commit -m "Log stream-completion retries to the console in the user-client

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 6: one-shot — fresh-Request fix, `onRetry`, `timeoutMs`

**Files:**
- Modify: `packages/llm-unified/src/one-shot-completion.ts:1-97`
- Modify: `packages/llm-unified/src/one-shot-completion.test.ts`
- Modify: `apps/user-client/src/lib/title-generator.ts:1-12,103-112`

- [ ] **Step 1: Write the failing regression test**

Append to `one-shot-completion.test.ts` (match the existing import/test style in that file; adjust the `OneShotArgs` builder to the file's existing helper if one exists):

```ts
import { runOneShotCompletionWithSleep } from './one-shot-completion.js';

describe('one-shot fresh Request per attempt (regression)', () => {
  it('retries a 503 sending a readable body each time, then succeeds', async () => {
    let attempts = 0;
    const bodies: string[] = [];
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async (req: Request) => {
      attempts++;
      bodies.push(await req.text()); // consume body as real fetch does
      if (attempts < 2) return new Response('busy', { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Hi' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    try {
      const out = await runOneShotCompletionWithSleep(
        oneShotArgs(), // existing test helper that builds OneShotArgs
        async () => {},
      );
      expect(out).toBe('Hi');
      expect(attempts).toBe(2);
      expect(new Set(bodies).size).toBe(1); // identical body both attempts, no throw
    } finally {
      globalThis.fetch = oldFetch;
    }
  });
});
```

> If `one-shot-completion.test.ts` has no `oneShotArgs()` helper, build the `OneShotArgs` inline using the same shape the existing tests in that file use (provider/providerConfig/apiKey/target/messages/bodyExtras). Read the file first.

- [ ] **Step 2: Run it to confirm it fails on the current code**

Run: `cd packages/llm-unified && bun test src/one-shot-completion.test.ts -t "fresh Request"`
Expected: FAIL — the second `fetch(request)` throws on the already-used body.

- [ ] **Step 3: Refactor `one-shot-completion.ts`**

Replace the `retry.js` import with one that also pulls the type:

```ts
import { parseRetryAfter, shouldRetryStatus, withRetry, type OnRetry } from './retry.js';
```

Add a timeout constant after the imports:

```ts
const DEFAULT_ONE_SHOT_TIMEOUT_MS = 30_000;
```

Add two fields to `OneShotArgs` (after `signal?`):

```ts
  /** Overall timeout for the whole call (default 30 000 ms). Background jobs must not hang forever. */
  timeoutMs?: number;
  /** Optional sink for retry decisions. Caller (apps/) wires the console line. */
  onRetry?: OnRetry;
```

Replace the body of `runOneShotCompletionWithSleep` (from `const request = buildRequest({` through the end of the `withRetry(...)` call) so the Request is built **inside** the callback and the timeout + onRetry are wired:

```ts
  const timeoutMs = args.timeoutMs ?? DEFAULT_ONE_SHOT_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = args.signal ? AbortSignal.any([args.signal, timeoutSignal]) : timeoutSignal;

  return withRetry<string>(
    async () => {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      // Fresh Request each attempt: a Request's body is consumed on first fetch,
      // so reusing it on retry throws ERR_BODY_ALREADY_USED. buildRequest is pure.
      const request = buildRequest({
        provider: args.providerConfig,
        apiKey: args.apiKey,
        corsProxyUrl: args.corsProxyUrl,
        corsProxyKey: args.corsProxyKey,
        path: '/chat/completions',
        method: 'POST',
        body: { model: modelId, messages: args.messages, stream: false, ...extras },
      });
      const response = await fetch(request, { signal });
      if (!response.ok) {
        const err = new Error(`one-shot upstream returned ${response.status}`) as Error & {
          status?: number;
          retryAfter?: number | null;
        };
        err.status = response.status;
        err.retryAfter = parseRetryAfter(response.headers);
        await response.body?.cancel();
        throw err;
      }
      const json = (await response.json()) as OneShotResponse;
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.length === 0) {
        throw new Error('one-shot returned empty content');
      }
      return content;
    },
    {
      signal,
      sleepFn,
      operation: 'one-shot',
      onRetry: args.onRetry,
      classifyError: (err) => {
        const e = err as { status?: number };
        return typeof e.status === 'number'
          ? { errorKind: 'status', status: e.status }
          : { errorKind: 'network' };
      },
      isRetriable: (err) => {
        if (err instanceof TypeError) return true;
        const e = err as { status?: number };
        return typeof e.status === 'number' && shouldRetryStatus(e.status);
      },
      extractRetryAfter: (err) => {
        const e = err as { retryAfter?: number | null };
        return e.retryAfter ?? null;
      },
    },
  );
```

> Note: `modelId` and `extras` are still computed above this block (the nano-gpt pair-map logic at `:32-41` is unchanged). Keep them.

- [ ] **Step 4: Run the regression test + full file**

Run: `cd packages/llm-unified && bun test src/one-shot-completion.test.ts`
Expected: all PASS.

- [ ] **Step 5: Wire the console sink in `title-generator.ts`**

In `apps/user-client/src/lib/title-generator.ts`, add `formatRetryEvent` to the `@chatsundere/llm-unified` import block (`:1-12`), then add to the `runOneShotCompletion({ ... })` args (`:103-112`), after `bodyExtras: { ... },`:

```ts
      bodyExtras: { temperature: 0.3, max_tokens: 20 },
      onRetry: (e) => console.warn(formatRetryEvent(e)),
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/llm-unified/src/one-shot-completion.ts packages/llm-unified/src/one-shot-completion.test.ts apps/user-client/src/lib/title-generator.ts
git commit -m "Fix one-shot Request reuse, add overall timeout and retry logging

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 7: Refactor `binding` onto `withStreamingRetry` + default console sink

**Files:**
- Modify: `packages/llm-unified/curation/conversation-suite/binding.ts:1-87`
- Modify: `packages/llm-unified/curation/conversation-suite/binding.test.ts`

- [ ] **Step 1: Read the binding test to learn its harness**

Read `packages/llm-unified/curation/conversation-suite/binding.test.ts` in full — note the existing 3c0642d regression test (body-reading mock) and the `fetchImpl`/`sleepImpl` injection pattern.

- [ ] **Step 2: Write the failing onRetry test**

Append a test asserting `onRetry` fires on a transient status (match the file's existing arg-builder + injection style):

```ts
import type { RetryEvent } from '../../src/retry.js';

it('fires onRetry on a transient 503 and captures the eventual outcome', async () => {
  let calls = 0;
  const events: RetryEvent[] = [];
  const binding = makeLiveBinding({
    offeringRef: 'prov/model',
    providerConfig: { baseUrl: 'https://x.test/v1', authScheme: 'bearer' } as never,
    apiKey: 'k',
    adapter: passthroughAdapter, // the test file's existing stub adapter
    fetchImpl: (async (req: Request) => {
      calls++;
      await req.text();
      if (calls < 2) return new Response('busy', { status: 503 });
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            c.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }) as unknown as typeof fetch,
    sleepImpl: async () => {},
    onRetry: (e) => events.push(e),
  });
  const outcome = await binding.runTurn([{ role: 'user', content: 'hi' }], { enabled: false });
  expect(calls).toBe(2);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ status: 503, errorKind: 'status' });
  expect(outcome.status).toBe(200);
});
```

> Adapt `providerConfig`/`passthroughAdapter` to whatever the existing tests in this file use. Read first; do not invent shapes.

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd packages/llm-unified && bun test curation/conversation-suite/binding.test.ts -t "onRetry"`
Expected: FAIL — `onRetry` not in `LiveBindingArgs`.

- [ ] **Step 4: Refactor `binding.ts`**

Replace the `retry.js` import with the helper + formatter + types:

```ts
import {
  type OnRetry,
  type RetryEvent,
  formatRetryEvent,
  withStreamingRetry,
} from '../../src/retry.js';
```

Add a module-level default sink (curation/ may use console — it is not `src/`):

```ts
/** Default retry sink for suite runs: a structured CLI line. */
const logRetryToConsole: OnRetry = (e: RetryEvent) => console.warn(formatRetryEvent(e));
```

Add `onRetry?: OnRetry;` to `LiveBindingArgs` (after `sleepImpl?`):

```ts
  /** Optional retry sink; defaults to a structured console line. */
  onRetry?: OnRetry;
```

Replace the retry loop + null-guard inside `runTurn` (current `:47-73`, from `let response: Response | null = null;` through the `if (!response.ok || !response.body) { ... }` block) with:

```ts
      const response = await withStreamingRetry({
        buildRequest: () =>
          buildRequest({
            provider: args.providerConfig,
            apiKey: args.apiKey,
            corsProxyUrl: args.corsProxyUrl ?? null,
            corsProxyKey: args.corsProxyKey ?? null,
            path: '/chat/completions',
            method: 'POST',
            body: wire.body,
          }),
        doFetch: args.fetchImpl,
        operation: `suite-binding:${args.offeringRef}`,
        initialResponseTimeoutMs: null,
        sleepFn: args.sleepImpl,
        onRetry: args.onRetry ?? logRetryToConsole,
      });

      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {});
        return assembleOutcome(response.status, []);
      }
```

(The `MAX_RETRY_ATTEMPTS`/`computeRetryDelay`/`parseRetryAfter`/`shouldRetryStatus` imports are no longer used in this file — remove them. The fresh-Request comment block at the old `:49-51` is now owned by the helper; drop it here.)

- [ ] **Step 5: Run the onRetry test + full file (3c0642d regression still green)**

Run: `cd packages/llm-unified && bun test curation/conversation-suite/binding.test.ts`
Expected: all PASS — including the existing fresh-Request regression test.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-unified/curation/conversation-suite/binding.ts packages/llm-unified/curation/conversation-suite/binding.test.ts
git commit -m "Move suite binding onto withStreamingRetry with a console retry sink

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 8: Convention line, deferral record, full green gate

**Files:**
- Modify: `packages/llm-unified/README.md`
- Modify: `obsidian/insights/follow-ups-index.md`

- [ ] **Step 1: Add the background-job convention to the README**

Read `packages/llm-unified/README.md`, then add a short subsection (place it near any existing "usage"/"completion" section; if none, append before the licence footer):

```markdown
## Retry & background jobs

Every background / non-interactive provider call goes through
`runOneShotCompletion` (or `withRetry` directly) — never a bare `fetch`. This
gives it transient-failure retry and the `onRetry` observability hook for free.
Interactive streaming uses `withStreamingRetry` (owned by `streamCompletion`).
The retry helpers are sink-agnostic: pass an `onRetry` callback and choose where
the signal lands (`console`, a metrics sink, …). The library itself never logs.
```

- [ ] **Step 2: Record the deferred metrics half**

In `obsidian/insights/follow-ups-index.md`, add a row to the **Active — Implementation (Liz-tracked)** table:

```markdown
| `prom-client` metrics half of retry observability (`llm_upstream_retries_total{provider,status,operation}` + retry-delay histogram) | Phase-2 proxy-service (first server-side call-site for llm-unified) | The sink-agnostic `onRetry` hook is in place; the proxy attaches its prom-client sink to the same callback. Spec: `superpowers/specs/2026-05-31-retry-observability-design.md` §4.3. |
```

- [ ] **Step 3: Full package test run**

Run: `cd packages/llm-unified && bun test`
Expected: all PASS (no `ERR_BODY_ALREADY_USED`, all retry/onRetry/streaming tests green).

- [ ] **Step 4: Full type gate**

Run: `pnpm typecheck`
Expected: PASS across the workspace (this is the CI gate per project convention).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/README.md obsidian/insights/follow-ups-index.md
git commit -m "Document the background-job retry convention; record metrics deferral [skip ci]

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Final: squash

After all tasks pass, squash the per-task commits into one feature unit per ADR 0003 (keep the `[skip ci]` doc-only Task 8 README/follow-ups change inside it — the squash as a whole touches code, so the squashed commit does **not** carry `[skip ci]`):

```bash
git log --oneline   # confirm the task commits
# interactive rebase is unavailable in this environment; use a soft reset to the
# pre-Task-1 commit, then a single commit:
git reset --soft <commit-before-Task-1>
git commit -m "Add retry observability and fix Request-reuse bug across all call-sites

withStreamingRetry consolidates the two hand-rolled streaming loops and makes
the ERR_BODY_ALREADY_USED trap structurally impossible (it had surfaced in
stream-completion and one-shot, both unfixed; binding was fixed in 3c0642d). A
sink-agnostic onRetry hook plus formatRetryEvent give every call-site a
structured console line; llm-unified stays dependency-free. one-shot also gains
a 30s overall timeout. prom-client metrics deferred to the Phase-2 proxy.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

**Larissa:** not required — `packages/llm-unified` is out of audit scope (CLAUDE.md §9).

**STATUS update:** after the squash, update `obsidian/STATUS-CLIENT-ONLY.md` — move retry observability from "next concrete step" to Done, refresh the `Last updated` line.

---

## Self-review notes (author check, completed)

- **Spec coverage:** §2 bug → Tasks 4/6/7 (all three sites); §4.1 RetryEvent/onRetry → Tasks 1/2; §4.2 withStreamingRetry → Task 3; §4.3 sinks → Tasks 5/6/7; §4.4 convention + one-shot timeout → Tasks 6/8; §5 tests → embedded per task. All covered.
- **Type consistency:** `OnRetry`/`RetryEvent`/`formatRetryEvent`/`withStreamingRetry`/`StreamingRetryOpts` names are used identically across tasks and exported from `index.ts` in Tasks 1 & 3.
- **No placeholders:** every code step shows full code; the two "read the file first" notes (one-shot/binding test harness) are explicit because those test files' arg-builders must be matched, not invented.
