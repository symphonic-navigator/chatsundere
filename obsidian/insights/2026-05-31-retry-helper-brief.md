# Brief — Retry helper: observability, consolidation, background convention

> A brief from Liz to next-context-Liz (2026-05-31). Chris asked for a
> "general-purpose retry helper, effective for background jobs too (title
> generation, memory extraction, …)". **Investigation finding: the retry helper
> already exists and is already general-purpose.** This brief is therefore NOT
> "build retry" — it is the genuine remaining work: make retries *observable*,
> consolidate the call-sites, and lock the background-job convention so it stays
> general-purpose as new jobs land.

## TL;DR

`packages/llm-unified/src/retry.ts` is a complete port of chatsune's
`backend/_retry.py` and is wired into all three provider-call paths. Title
generation (the one existing background job) already retries via it. The work
that remains is observability + consolidation + a written convention — small,
high-leverage, and exactly what would have surfaced today's Tensorix
timeouts/429s instead of letting them fail silently.

## Current state (do not re-derive — verified 2026-05-31)

**The helper — `packages/llm-unified/src/retry.ts`:**
- `shouldRetryStatus(status)` — retryable set `{408, 429, 500, 502, 503, 504}`
  (deliberately broader than chatsune's `{429, 503}`: we hit many providers).
- `parseRetryAfter(headers)` — seconds-form only (HTTP-date form ignored), capped
  at 16 s.
- `computeRetryDelay(attempt, retryAfter)` — `Retry-After` if present, else
  `1s · 2**attempt` with ±25 % jitter, capped at 16 s.
- `withRetry<T>(fn, opts)` — high-level wrapper: `maxRetries` (default 4),
  `isRetriable`, `extractRetryAfter`, `signal` (AbortError propagates without
  retry), `sleepFn` (test seam). Tested in `retry.test.ts`.
- Constants: `MAX_RETRY_ATTEMPTS = 4` (→ 5 attempts), base 1 s, cap 16 s,
  jitter 0.25.

**Call-sites (all three already retry):**
- `src/stream-completion.ts:89–136` — interactive streaming path. Inline retry
  loop using the *low-level* helpers (not `withRetry`, because the decision lives
  inside the in-flight fetch lifecycle). Has a per-attempt **TTFB timeout**
  (15 s, cleared on header arrival), catches network `TypeError`, cancels the
  failed response body (`:132`) to free the connection, throws
  `streamCompletion: upstream <status>` on a non-ok final response (`:142`).
- `src/one-shot-completion.ts:52–86` — **the background / non-streaming path.**
  Wraps fetch+parse in `withRetry`; builds a custom error carrying `.status` +
  `.retryAfter`; `isRetriable` = network `TypeError` OR `shouldRetryStatus`.
  Exported as `runOneShotCompletion` (`src/index.ts:33`).
- `curation/conversation-suite/binding.ts:48–66` — suite runner. Inline
  low-level loop. **Carries the 3c0642d lesson** (below).

**Background callers today:** only title generation —
`apps/user-client/src/lib/title-generator.ts:103` → `runOneShotCompletion`, with
a fallback title on exhaustion (`:121–126`). Memory-extraction / summarisation
do **not** exist in the codebase yet.

**Critical invariant to preserve (commit `3c0642d`):** a `Request`'s body stream
is consumed on first `fetch`; reusing the same `Request` on retry throws
`ERR_BODY_ALREADY_USED`. The fix is to call `transport.buildRequest()` (a pure
factory, `src/transport.ts:27`) **fresh inside the retry loop** — see
`binding.ts:49–60`. `one-shot` is safe because `withRetry` re-runs the whole
fn; `stream-completion` builds once outside but never reuses the Request object.
Any consolidation MUST keep this property.

## The remaining work

### 1. Observability (headline — the real gap)

`retry.ts` emits nothing. chatsune's `_retry.py` logged every retry (operation,
attempt, delay, status, correlation id). Today's Tensorix timeouts and the
flaky-looking suite were invisible at the retry layer — we only saw the *effect*.

- Add an optional `onRetry` hook to `withRetry` **and** thread an equivalent
  callback into the two inline loops, called once per retry decision with
  `{ operation, attempt, delaySeconds, status?, errorKind }`.
- Wire callers to emit:
  - a structured `pino` line (server-side paths) /
    client telemetry line (browser path);
  - a counter `llm_upstream_retries_total{provider, status, operation}` and a
    histogram of retry delay where a metrics sink exists.
- **Open question (see below): the browser problem.** `stream-completion` runs
  client-side, so it cannot touch `prom-client` directly. Decide where
  client-side retry signals land (client telemetry endpoint? surfaced via the
  Phase-2 proxy-service? counted only server-side for one-shot?).

### 2. Consolidate the two inline loops

`stream-completion` and `binding` hand-roll nearly the same loop around the
low-level helpers. Either:
- (a) extract a small streaming-aware helper (`withStreamingRetry`) that takes a
  `buildRequest` factory + an `attemptOnce` and owns the loop, TTFB timeout,
  body-cancel, and fresh-Request-per-attempt; or
- (b) leave them separate but add a shared `onRetry`/logging seam and a comment
  cross-linking the 3c0642d invariant.

Lean (a) only if the streaming TTFB-timeout + body-cancel semantics fold in
cleanly; otherwise (b). Do **not** force streaming into `withRetry` — the
control flow genuinely differs (per-attempt timeout, partial-stream handling).

### 3. Lock the background-job convention (forward-looking)

Title-gen already does the right thing. Write the rule down so the next job
inherits it: **every background / non-interactive provider call goes through
`runOneShotCompletion` (or `withRetry` directly) — never a bare `fetch`.** When
memory-extraction lands, it uses this path and gets retry + the new logging for
free. Add this as a one-liner to the `llm-unified` README and/or `conventions`.

### 4. Optional hardening (only if cheap)

- A typed `RetriableUpstreamError { status?, retryAfter? }` to replace the
  duck-typing in `one-shot` (`.status`/`.retryAfter`) and unify `isRetriable`
  across call-sites.
- `Retry-After` HTTP-date form (currently ignored) — rare on our providers;
  skip unless a provider is shown to use it.
- Confirm `one-shot-completion` has an overall timeout for background jobs
  (stream has a TTFB timeout; verify one-shot does not hang forever on a stalled
  background call — add an `AbortSignal.timeout()` if missing).

## Open design questions (for Chris)

1. **Client-side metrics sink** — where do `stream-completion` (browser) retry
   signals go? This blocks the metrics half of §1; the logging half is doable
   immediately.
2. **Consolidation appetite** — refactor the two loops into one (§2a), or just
   add the logging seam and leave them (§2b)? Trade-off: less duplication vs.
   touching the load-bearing streaming path.
3. **Scope** — is this its own small squash now, or fold §1 (logging only) into
   the next curation/provider commit and defer §2–4?

## Manual verification (when implemented)

- Point a curated offering at a provider returning 429/503 (or stub one) and
  confirm: retries happen, backoff grows, `Retry-After` is honoured, and **each
  retry now produces a log line / metric increment**.
- Title generation against a flaky provider still falls back cleanly and now
  logs the retries.
- The 3c0642d regression test (fresh Request per attempt) still passes; no
  `ERR_BODY_ALREADY_USED`.
- `pnpm typecheck` + Bun tests green; live suite unaffected.

## Pointers

- Helper: `packages/llm-unified/src/retry.ts` (+ `retry.test.ts`)
- Streaming path: `packages/llm-unified/src/stream-completion.ts:89–136`
- Background path: `packages/llm-unified/src/one-shot-completion.ts:52–86`
- Suite path + 3c0642d pattern: `curation/conversation-suite/binding.ts:48–66`
- Title-gen caller: `apps/user-client/src/lib/title-generator.ts:103`
- Prior art: `~/workspace/chatsune/backend/_retry.py` (has the logging we lack)
- Today's motivation: Tensorix response-caching + timeouts — see
  [[../providers/tensorix]] and [[../../.claude/.../memory project_tensorix_provider]].
