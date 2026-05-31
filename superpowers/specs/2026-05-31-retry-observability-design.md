# Retry observability + `withStreamingRetry` — design spec

**Date:** 2026-05-31
**Status:** Design approved by Chris; plan + implementation are the next steps.
**Implements:** the genuine remaining work from the retry-helper investigation in
[`obsidian/insights/2026-05-31-retry-helper-brief.md`](../../obsidian/insights/2026-05-31-retry-helper-brief.md).
The retry helper itself (`packages/llm-unified/src/retry.ts`) is a complete port
of chatsune's `backend/_retry.py` and is already wired into all three
provider-call paths. This spec is **not** "build retry" — it is: (1) fix a
latent correctness bug, (2) make retries observable, (3) consolidate the two
hand-rolled streaming loops, (4) lock the background-job convention.
**Lead:** Liz, with Chris in walk-through mode.
**Audit:** `packages/llm-unified` is **not** in Larissa's scope (CLAUDE.md §9 —
auth/sync/proxy/crypto only). No security gate.
**Out of scope (deferred):** the `prom-client` metrics half (no call-site runs
server-side today — deferred to the Phase-2 proxy-service); any user-facing UX
surfacing of retries; an in-memory client telemetry ring-buffer; HTTP-date form
of `Retry-After` (rare on our providers).

---

## 1. Purpose

`packages/llm-unified/src/retry.ts` emits nothing — no log line, no counter.
chatsune's `_retry.py` logged every retry (operation, attempt, delay, status,
correlation id). On 2026-05-31, Tensorix response-caching + timeouts and a
flaky-looking conversation-suite were **invisible at the retry layer** — we only
saw the effect, never the retries themselves. This spec closes that gap.

While investigating, a latent correctness bug surfaced in the streaming path
(see §2). It is the **second appearance** of the same `ERR_BODY_ALREADY_USED`
fault that commit `3c0642d` fixed in the suite binding. CLAUDE.md Lesson 13
("simplify after 2-3 failed fixes — a third attempt is a signal") drives the
consolidation decision in §4: kill the duplication so there is no third
appearance.

---

## 2. The bug (correctness, fix is mandatory)

`stream-completion.ts:72` builds the `request` **once, outside** the retry loop,
then calls `fetch(request)` inside the loop (`:106`). A `Request`'s body stream
is consumed on the first `fetch`; the second `fetch(request)` on a retry throws
`ERR_BODY_ALREADY_USED`. This means: when a user in the browser hits a transient
503/429, **the very retry meant to rescue the UX crashes instead**.

The existing 503-retry test (`stream-completion.test.ts:256`) masks the bug —
its fetch mock takes no `request` argument and never reads the body, unlike real
`fetch`. This is the identical masking the `3c0642d` commit message describes for
the binding's old test.

The retry-helper brief is **wrong** where it claims stream-completion "never
reuses the Request object". This spec corrects that.

---

## 3. Decisions captured during brainstorm

1. **Sink-agnostic `onRetry` callback.** `llm-unified` stays dependency-free
   (no `pino`, no `prom-client`, no `console.*` in `src/`). It emits a typed
   `RetryEvent` through an optional `onRetry` hook. Each caller chooses the sink.
   Rejected: lib logs via `console` directly (lib makes the sink decision, hard
   to filter/silence); lib takes an injected logger (larger API surface than a
   single event hook).
2. **Consolidate into a shared `withStreamingRetry` helper.** A streaming-aware
   helper owns the loop, fresh-Request-per-attempt, optional TTFB timeout,
   body-cancel, and the `onRetry` hook. `stream-completion` and `binding` both
   use it. This makes the bug structurally impossible and encapsulates the
   `3c0642d` knowledge in one place. Rejected: fix in place + add the callback
   seam to both inline loops separately (keeps the duplication, lets the next
   inline-loop author trip the same trap); fix-only-now, observability-later
   (artificially splits two changes that touch the same lines).
   **Not** folded into `withRetry` — the streaming control flow genuinely
   differs (per-attempt TTFB timeout, body-cancel, partial-stream handling).
3. **Browser sink = structured `console` line only.** Pure observability, no
   state, no UX. The sink-agnostic hook lets UX surfacing (the *dere* "connection
   is wobbling, retrying…" affordance) dock later without touching the lib.

---

## 4. Architecture

### 4.1 `RetryEvent` + `onRetry` (in `retry.ts`, dependency-free)

```ts
export type RetryErrorKind = 'network' | 'status';

export interface RetryEvent {
  operation: string;      // 'stream-completion' | 'one-shot' | 'suite-binding:<ref>'
  attempt: number;        // 0-based: the attempt that JUST failed
  delaySeconds: number;   // computed backoff before the next attempt
  status?: number;        // set when errorKind === 'status'
  errorKind: RetryErrorKind;
}

export type OnRetry = (event: RetryEvent) => void;
```

`WithRetryOpts<T>` gains `onRetry?: OnRetry`, invoked in the catch branch
**before** sleeping, once per retry decision. No other `withRetry` API change.
The library itself logs nothing — it only calls the hook.

### 4.2 `withStreamingRetry` (new helper in `retry.ts`)

```ts
export interface StreamingRetryOpts {
  buildRequest: () => Request;                 // called FRESH per attempt → bug dead
  doFetch?: typeof fetch;                      // injectable (binding / tests)
  operation: string;
  maxRetries?: number;                         // default MAX_RETRY_ATTEMPTS
  initialResponseTimeoutMs?: number | null;    // null = no TTFB timeout (binding)
  signal?: AbortSignal;
  onRetry?: OnRetry;
  sleepFn?: (ms: number) => Promise<void>;
}

export async function withStreamingRetry(opts: StreamingRetryOpts): Promise<Response>;
```

Owns, per attempt: build a fresh `Request`; arm a TTFB-timeout `AbortController`
(only when `initialResponseTimeoutMs != null`); `fetch`; clear the timeout on
response. Retry decisions:

- network `TypeError` and `attempt < maxRetries` and not aborted → `onRetry`
  with `errorKind: 'network'`, backoff, continue.
- non-ok **retryable** status and `attempt < maxRetries` → `body.cancel()`,
  `onRetry` with `errorKind: 'status'` + `status`, honour `Retry-After`, backoff,
  continue.
- ok response → return it.
- non-retryable status, or attempts exhausted → return the final Response
  (even if non-ok). The helper **never throws** on a non-ok status.
- aborted at any checkpoint → throw `AbortError` (no retry).
- exhausted after only network failures (no Response ever obtained) → throw the
  last error.

The **throw-vs-capture divergence** between the two call-sites is resolved by the
return value, not by the helper:

- `stream-completion` calls `withStreamingRetry`, then throws
  `streamCompletion: upstream <status>` itself on a non-ok final Response —
  outward behaviour unchanged.
- `binding` calls the same helper with `initialResponseTimeoutMs: null` and does
  `assembleOutcome(status, [])` on a non-ok final Response — status captured, not
  thrown.

The helper ends as soon as an ok Response (headers) is in hand. The body-reading
phase afterwards (`parseWithAdapter` / `parseOpenAiSseStream`) is untouched —
including the "do not retry once the body is being read" guarantee
(`stream-completion.test.ts:280`).

**Behaviour change to flag:** `binding` today does a bare `await doFetch(request)`
with no try/catch, so a network `TypeError` propagates (thrown). Through the
shared helper, `binding` **inherits network-`TypeError` retry** — strictly an
improvement (a transient network blip in a suite run is now retried) but a real
change in binding semantics. Recorded here so it is not a surprise.

`one-shot-completion` stays on `withRetry` (non-streaming; the high-level wrapper
fits) and only gains the `onRetry` wiring.

### 4.3 Sinks (at the three call-sites)

- `stream-completion` (browser) and `one-shot`/title-gen (browser): `onRetry` →
  one structured `console.warn` line carrying the full `RetryEvent`. No state,
  no UX.
- `binding` (curation CLI): the same structured `console` line — this is exactly
  what would have made the Tensorix timeouts visible.
- **Metrics half (deferred):** a `prom-client` counter
  `llm_upstream_retries_total{provider, status, operation}` + a retry-delay
  histogram. No call-site runs server-side today, so this lands with the Phase-2
  proxy-service, which attaches its own prom-client sink to the *same* `onRetry`.
  Tracked as a follow-up-index entry.

### 4.4 Cheap-and-worth-it extras

- **Background-job convention** (§3 of the brief): one line in
  `packages/llm-unified/README` — *"Background / non-interactive provider calls
  go through `runOneShotCompletion` / `withRetry` — never a bare `fetch`."* So
  memory-extraction etc. inherit retry + logging for free.
- **one-shot overall timeout** (§4 of the brief): `one-shot-completion` has no
  timeout today — a stalled background call (title-gen) can hang forever. Add an
  optional `timeoutMs` on `OneShotArgs` (default **30 000 ms** — covers a full
  non-streaming generation, where streaming only needs a 15 s *TTFB* timeout),
  realised as `AbortSignal.timeout(timeoutMs)` combined with `args.signal` via
  `AbortSignal.any`. (Approved into this squash; Chris can strike it at spec
  review if he wants it separate.)

---

## 5. Testing (TDD — load-bearing path)

1. **Bug regression test:** a fetch mock that **reads the body** (as real fetch
   does) → reproduces `ERR_BODY_ALREADY_USED` on the old code, green on the new.
   The `3c0642d` equivalent for the streaming path.
2. **Un-mask the existing 503 test:** rebuild `stream-completion.test.ts:256`'s
   mock so it reads the body and asserts both attempts send the identical body.
3. **`onRetry` fires correctly:** asserted at all three sites — correct
   `operation`, `attempt`, `delaySeconds`, `status`, `errorKind`.
4. **`withStreamingRetry` unit tests:** TTFB-timeout path; `null`-timeout path
   (binding); abort during backoff; non-retryable status → final Response
   returned (not thrown); exhausted-network → last error thrown.
5. **one-shot timeout:** a stalled fetch aborts at the configured ceiling.

`pnpm typecheck` + Bun tests green. The live conversation-suite is unaffected
(provider keys never enter CI; suite is manual per CLAUDE.md §10).

---

## 6. Squash boundary

Bug fix + `withStreamingRetry` + `RetryEvent`/`onRetry` + the three sinks +
the README convention line + the one-shot timeout land as **one squash** — all of
it touches the retry paths. No Larissa gate (`llm-unified` out of scope).

Follow-up-index entry: the `prom-client` metrics half, deferred to the
Phase-2 proxy-service.

---

## 7. Manual verification (Chris, when implemented)

- Point a curated offering at a provider returning 429/503 (or stub one) and
  confirm: retries happen, backoff grows, `Retry-After` is honoured, and **each
  retry now produces a `console` line** with the structured event.
- Title generation against a flaky provider still falls back cleanly and now
  logs its retries.
- A live conversation-suite run that hits a transient 5xx now shows the retries
  in the CLI output instead of looking flaky.
- No `ERR_BODY_ALREADY_USED` under a real transient 503 in the browser stream
  path.
