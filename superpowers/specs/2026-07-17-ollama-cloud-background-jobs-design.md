# Repair Ollama Cloud background jobs — design

> Status: awaiting Chris's approval · Date: 2026-07-17 · Author: Liz
> Mode 3 (verify/repair) under the [`/curate`](../../.claude/skills/curate/) skill.

## 1. The report

Title generation and memory do not work for GLM 5.2 on Ollama Cloud. Chatting
works normally. Chris suspected the fault was provider-wide rather than specific
to GLM 5.2.

**The suspicion was correct**, and the blast radius is wider than reported:
compaction (`apps/user-client/src/compaction/runner.ts:71`) uses the same entry
point and is equally broken.

## 2. Evidence (live probes, 2026-07-17)

Probed directly against `ollama.com` with `keys/.ollama-test-key`. Local only,
never CI.

| # | What was probed | Result |
|---|---|---|
| 1 | `POST /chat/completions` — what `runOneShotCompletion` sends today | **HTTP 404** for `glm-5.2:cloud`, `glm-5.1` **and** `deepseek-v4-pro` |
| 2 | `POST /api/chat`, `stream:false` | HTTP 200, native shape: `.message.content` = `"OK"`, **no `.choices`** |
| 3 | `POST /api/chat`, `think:false` | Clean content, **empty** thinking channel |
| 4 | `POST /api/chat`, top-level `max_tokens:8` | `eval_count: 120` — **ignored** |
| 5A | `POST /api/chat`, `options:{num_predict:8}` | `eval_count: 8` — **honoured exactly** |
| 5B | Uncapped memory-dream-shaped prompt | `eval_count: 600` against a 3000 budget |
| 6 | Top-level `temperature:0` ×3 vs `options:{temperature:0}` ×3 | Top-level **varies** (ignored); `options` form is **deterministic** (honoured) |

Probe 1 reproduces the reported failure and settles the question: it is
model-independent, so it is an Ollama Cloud fault, not a GLM 5.2 fault.

## 3. Root cause

Three independent faults, all instances of one class: **an OpenAI-shaped
assumption hard-wired outside the adapter.** Faults A and B sit on the one-shot
seam and break background jobs outright; Fault C sits on the sampling seam and
silently disables controls on every path, chat included.

### Fault A — the adapter's endpoint path is discarded

`streamCompletion` honours the adapter's path (`stream-completion.ts:70-75`):

```ts
let path = '/chat/completions';
if (wire.path) path = wire.path;
```

`composeOneShotWire` (`one-shot-completion.ts:70-101`) takes only `body` and
`headers` from the adapter and **drops `wire.path` entirely**;
`runOneShotCompletionWithSleep` then hard-codes `path: '/chat/completions'`
(`one-shot-completion.ts:128`). Ollama's `baseUrl` is the bare host
`https://ollama.com` and `ollamaNativeAdapter` sets `path: '/api/chat'`
(`ollama-native.ts:106`), so every background job requests
`https://ollama.com/chat/completions` → 404. 404 is not in `RETRYABLE_STATUSES`
(`retry.ts:33`), so the job fails immediately and silently — matching the
observed symptom (fallback title, no hang).

### Fault B — the response is parsed as OpenAI

`one-shot-completion.ts:144-162` reads `json.choices[0].message.content`. The
native endpoint answers `{ message: { content, thinking }, done, eval_count, … }`
with no `choices` (probe 2), so even on the correct path the parse yields
`undefined` → `throw new Error('one-shot returned empty content')`.

**Fixing only Fault A trades a 404 for an empty-content error.** Both must go.

### Fault C — sampling never reaches the adapter (chat *and* jobs)

`stream-completion.ts:196` composes `{ ...sampling, ...wire.body }`, spreading
`temperature` and `max_tokens` as OpenAI top-level keys **outside** the adapter.
Ollama silently ignores unknown top-level keys; it wants
`options: { temperature, num_predict }`. Measured in probes 4, 5A and 6.

Consequence: Ollama Cloud has had **no working temperature control and no
working token cap since onboarding — on the chat path too.** It fails silently:
no error, no log, no red assertion. It reads as "the model is just like that".

### Why the conversation-suite never saw it

**There are three independent wire compositions, not two:** `stream-completion.ts`,
`one-shot-completion.ts`, and the suite's own `curation/conversation-suite/binding.ts`.
`makeLiveBinding` deliberately "does its OWN fetch (not streamCompletion) so the
HTTP status is captured rather than thrown" (`binding.ts:33-41`) — a defensible
reason for a third path, with an indefensible consequence.

The suite was blind for two distinct reasons:

- **Fault A was invisible** because `binding.ts:56` composes
  `path: wire.path ?? '/chat/completions'` — the suite honours the adapter's path
  **correctly**. It was *more correct than the production code it verifies*, so it
  could not reproduce the 404. It never touches `runOneShotCompletion` at all.
- **Fault C was invisible** because `binding.ts:58` sends `body: wire.body` and
  **no sampling at all**. The suite has never sent `temperature` or `max_tokens`,
  so an ignored cap could not surface.

This is why `obsidian/providers/ollama-cloud.md` records "core 11/11, verified"
while three background jobs were broken the whole time. It is the sharper form of
the gap already noted at `ollama-cloud.md:97-100`: **the suite verifies a pipe it
reimplements, rather than the pipe production uses.** A verification harness that
rebuilds its subject cannot fail the way its subject fails.

The provider record states the framework hooks are "honoured by `streamCompletion`
AND the suite binding" — precisely the two paths that got it right, with one-shot
unmentioned. The omission names the blind spot exactly.

## 4. Scope (decided with Chris)

| Decision | Choice |
|---|---|
| Fix approach | Reroute one-shot through `streamCompletion` — delete the parallel path, not patch it |
| Sampling leak (Fault C) | **In scope** — measured as a dead control, not cosmetic |
| Sampling seam | Approach A: optional `mapSampling` hook on `ModelAdapter` |
| Retry semantics | Inherit streaming retry; preserve the per-caller overall timeout |
| Suite | `assertUsageWithinCap` mandatory; `runOneShot` optional, wired for ollama only |

This bundles three fixes into one squash, in tension with ADR 0003
(one squashed commit per feature unit). Accepted deliberately by Chris: they
share one root cause and one goal — make Ollama Cloud background jobs work.

A note on why the reroute rather than a second patch: `one-shot-completion.ts:57-68`
documents that **this seam was already patched once** (the adapter was introduced
for body and headers, because reasoning models drained `max_tokens` into their
reasoning channel and left `content` empty). That fix left path and response shape
behind. Per CLAUDE.md §13 ("simplify after 2-3 failed fixes"), the second patch on
the same seam is the signal to delete the duplicate rather than extend it.

## 5. Design

### 5.1 Architecture

`runOneShotCompletion` becomes a thin fold over `streamCompletion`. Its public
signature (`OneShotArgs` → `Promise<string>`) is **unchanged**, so all three
callers stay untouched.

Deleted from `one-shot-completion.ts`: `composeOneShotWire`, the
`OneShotResponse` interface, the hard-coded path, the OpenAI JSON parse, the
`withRetry` loop and `runOneShotCompletionWithSleep` (its `sleepFn` injection
existed only for the retry loop).

### 5.2 Components

| File | Change |
|---|---|
| `src/one-shot-completion.ts` | Parallel path deleted; chunk fold added |
| `src/stream-completion.ts` | `operation?: string` (default `'stream-completion'`); throws `UpstreamHttpError`; `buildWire` exported as `composeWire` |
| `src/adapter-contract.ts` | `ModelAdapter.mapSampling?(sampling)` |
| `src/adapters/ollama-native.ts` | Implements `mapSampling` → `options: { temperature, num_predict }` |
| `curation/conversation-suite/binding.ts` | Uses `composeWire` instead of composing the wire itself; `LiveBindingArgs.sampling` |
| `curation/conversation-suite/` | `assertUsageWithinCap`; optional `RunnerBinding.runOneShot` |

**`composeWire` is a required consequence, not extra scope.** `assertUsageWithinCap`
needs the suite to *send* a cap, and the cap only reaches the wire through
`mapSampling`. Hand-rolling that inside `binding.ts` would put the hook in two
places — reintroducing the very drift this spec removes. Exporting the existing
private `buildWire` and having `makeLiveBinding` call it collapses the third wire
composition into the first. The binding keeps its own **fetch** (status captured,
not thrown — the documented reason at `binding.ts:33-41` still holds); only the
body/headers/path composition is shared. After this, the suite exercises the same
composition production uses, which is the entire point of a verification harness.

The two additions to `streamCompletion` are preconditions for behavioural
equivalence, not embellishments:

- **`operation`** — `withStreamingRetry` labels retry events with `opts.operation`;
  without it, background-job retry logs would silently relabel from `'one-shot'`
  to `'stream-completion'`.
- **`UpstreamHttpError`** — `classifyMemoryActionError` (`memory/classify-error.ts:21-22`)
  reads `e.status` and maps 429/500/502/503/504 to `'upstream-busy'`.
  `stream-completion.ts:116` throws a bare `Error` with no `status`, so a naive
  reroute would degrade every memory error to `'failed'` — a user-visible
  regression on the constructive-error-handling surface. The chat path gains
  `.status` as a by-product.

### 5.3 Data flow

```
title-gen / memory / compaction
  └─ runOneShotCompletion(args)
       signal = any([args.signal, AbortSignal.timeout(timeoutMs)])
       └─ streamCompletion({ ...args, signal,
                             initialResponseTimeoutMs: timeoutMs,
                             operation: 'one-shot' })
            ├─ adapter.buildRequest → wire.path        (now honoured)
            ├─ mapSampling → options {}                (now translated)
            └─ transport → NDJSON | SSE → StreamChunk[]
       ├─ fold: token→content, reasoning→reasoning, finish→finishReason
       ├─ onRawResponse?.({ content, reasoning, finishReason })
       └─ content === '' ? throw 'one-shot returned empty content' : return content
```

`initialResponseTimeoutMs: timeoutMs` is deliberate. `streamCompletion` defaults
to a 15 s time-to-first-byte cap; inheriting it would impose a **new** 15 s TTFB
limit on dreaming (180 s budget, `DREAM_BATCH_SIZE = 40`) and compaction (180 s),
which today have no TTFB constraint at all. Passing the caller's overall budget
keeps the effective semantics identical.

Preserved deliberately: **no `cacheKey`** (chat-only conversation affinity; the
existing comment travels with the code) and **no `tools`**.

Resulting Ollama wire: `POST https://ollama.com/api/chat`, `stream: true`,
`think: false`, `options: { temperature: 0.3, num_predict: 256 }`.

### 5.4 Error handling

| Case | Today | After |
|---|---|---|
| Upstream 4xx/5xx | `Error` with `.status` | `UpstreamHttpError` with `.status` + `.retryAfter` |
| Timeout | DOMException `TimeoutError` | Unchanged — `withStreamingRetry:224` propagates abort/timeout |
| Empty content | `throw 'one-shot returned empty content'` | Identical message |
| Opaque proxy redirect | Unhandled | `ProxyRedirectError`, inherited |
| Mid-stream failure | Whole call retried | Not retried (accepted — see §4) |

### 5.5 The sampling hook

```ts
/** Translate canonical OpenAI-shaped sampling params into this provider's wire
 *  form. Absent → the params are spread as top-level keys (OpenAI default). */
mapSampling?(sampling: Record<string, unknown>): Record<string, unknown>;
```

`composeWire` uses `adapter.mapSampling?.(sampling) ?? sampling` in place of the
raw spread. `src/adapters/` holds **12** adapter factories (counted, excluding
tests and the `_anthropic-cache` helper). Only `ollamaNativeAdapter` implements
the hook; the other **11** are untouched and keep the OpenAI default, which is
correct for them. Presence of the hook *is* the ownership statement — no second
flag.

### 5.6 The suite

**`assertUsageWithinCap(maxTokens)`** — mandatory. Asserts
`usage.completionTokens <= cap` for a turn that requests a small cap. Purely
mechanical, no judgement of output quality, fully within "validate the pipe,
never the intelligence". **This assertion would have caught Fault C at
onboarding** (`eval_count: 120` against `max_tokens: 8` is red) and will catch it
for any future non-OpenAI provider.

It only has teeth once the binding actually sends a cap, hence
`LiveBindingArgs.sampling` and the `composeWire` share (§5.2). The suite's failure
to send sampling was not an oversight to route around — it was half the reason
Fault C survived onboarding.

**`RunnerBinding.runOneShot?`** — optional, wired for ollama only. Honest
accounting of its value: once the parallel path is deleted, one-shot *is*
`streamCompletion`, so this turn largely re-tests a pipe the suite already covers
eleven times. It is kept as thin insurance and because it encodes the lesson —
the suite must touch the background-job entry point, not only the chat entry
point.

The earlier worry that this meant touching 13 runner scripts was **wrong**:
`RunnerBinding` is produced centrally by `makeLiveBinding` / `makeGenericLiveBinding`
in `binding.ts`; the `run-*-suite.ts` scripts consume it (only `run-claude-suite.ts`
carries binding code of its own). `runOneShot` therefore lands in one place. It
stays optional on the interface because `makeGenericLiveBinding` has no adapter to
delegate to, not because wiring it is expensive.

## 6. Testing

**CI (key-free):**
- `mapSampling` unit test: `temperature` / `max_tokens` → `options.temperature` / `options.num_predict`.
- `composeWire` test: `mapSampling` output is used, and adapter structural keys still win on clash.
- one-shot fold tests: chunks → content/reasoning/finishReason; `onRawResponse` fires before the empty-content throw; timeout composition; neither `cacheKey` nor `tools` are sent.
- `binding.test.ts` already injects `fetchImpl`/`sleepImpl`, so the `composeWire`
  switch is assertable key-free: same path/headers/body as before for an
  OpenAI-compatible adapter, `options: {}` for ollama.

**The 11 existing tests** in `one-shot-completion.test.ts` mock OpenAI JSON
bodies and must be rewritten against a streamed response. The four retry tests
(429 retry, 401 no-retry, retries exhausted, fresh-Request-per-attempt) become
`withStreamingRetry`'s responsibility. **They are only deleted after verifying
`stream-completion`'s own tests cover the same cases** — otherwise we silently
lose a regression guard, including the fresh-Request-per-attempt regression that
was expensive to find once already.

**Live, local (never CI):** `run-ollama-suite.ts` and `run-glm52-suite.ts`, every
reasoning permutation green, including the new cap assertion.

## 7. Verification obligations (not assumptions)

1. **Proxy 401 refresh equivalence.** one-shot uses `fetchWithProxyAuth`;
   `streamCompletion` uses `withStreamingRetry`'s `onUnauthorised`. Both refresh
   the proxy token, but the equivalence is **read, not proven** — and
   `proxy-auth.ts` names the memory-extraction job as a common trigger, so this
   path is live. Needs a dedicated test.
2. **Retry-case coverage** in `stream-completion`'s tests before deleting the
   one-shot retry tests (§6).
3. **`composeWire` must not alter suite behaviour.** `makeLiveBinding` currently
   passes no sampling, so `composeWire` with an empty sampling object must
   produce a byte-identical body to today's `wire.body` for every existing
   adapter. Assert before trusting; a silent body change would invalidate every
   provider record at once.

## 8. Records to update

`obsidian/providers/ollama-cloud.md` — the honesty surface, currently wrong:
- Record the 404 finding and the sampling leak.
- Correct the `think:false` claim at `ollama-cloud.ts:67` ("still streams
  reasoning (leaks into content)"): probe 3 shows clean content and an empty
  thinking channel on the native endpoint. The claim likely dates from the `/v1`
  shim era.
- Qualify "live-verified, core 11/11" — demonstrably not a statement of
  completeness.

## 9. Follow-ups (out of scope)

- **GLM 5.2's `fixed-on` reasoning classification** may be wrong on the native
  path (probe 3). Catalogue accuracy — Chris's judgement, needs its own probe
  across permutations.
- **`runOneShot` for `makeGenericLiveBinding`** — generic offerings have no
  adapter to delegate to; covering them needs a separate decision.
- **Stale comment** at `binding.ts:106`: `makeGenericLiveBinding` is documented as
  serving "vanilla OpenAI-compatible providers (e.g. ollama-cloud)". ollama-cloud
  has been a catalogue/native offering since 2026-06-03; the example is wrong and
  actively misleads.
- **Chris is reading Ollama's own documentation** in parallel (2026-07-17). If it
  contradicts probes 4/5A/6, the measurement wins per CLAUDE.md §13 — but the
  contradiction is worth recording.

## 10. Manual verification (Chris, on device)

1. Start a new chat with GLM 5.2 via Ollama Cloud, send one message → **a real
   title appears**, not "New chat — …".
2. Trigger memory extraction → memory is written, no error toast.
3. Trigger compaction on a long chat → it completes.
4. Repeat 1 with GLM 5.1 and DeepSeek V4 Pro → titles appear (proves the
   provider-wide claim, not just GLM 5.2).
5. Disconnect mid-job → the error surfaces as "upstream busy"/timeout copy, not
   a generic failure (proves `UpstreamHttpError` threading).
