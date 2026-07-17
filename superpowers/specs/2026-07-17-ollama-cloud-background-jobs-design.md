# Repair Ollama Cloud background jobs — design

> Status: awaiting Chris's approval · Date: 2026-07-17 · Author: Liz
> Mode 3 (verify/repair) under the [`/curate`](../../.claude/skills/curate/) skill.

## 1. The report

Title generation and memory do not work for GLM 5.2 on Ollama Cloud. Chatting
works normally. Chris suspected the fault was provider-wide rather than specific
to GLM 5.2.

**The suspicion was correct.** The fault is model-independent and provider-wide.
Blast radius, verified: the one-shot entry point has **four** callers —
title generation (`lib/title-generator.ts:118`), memory
(`memory/pipeline.ts:72`), compaction (`compaction/runner.ts:71`), and vision
substitution (`attachments/substitute-vision.ts:42`, via the `runOneShot`
injection wired at `state/stream-manager.store.ts:676`). Three are reachable on
Ollama; vision substitution is not, because Ollama has no vision offering.
`tools/ask-expert.ts` and `lib/artefact-author.ts` use `streamCompletion` and are
**not** affected.

## 2. Evidence (live probes, 2026-07-17)

Probed against `ollama.com` with `keys/.ollama-test-key`. Local only, never CI.

### The fault

| # | Probe | Result |
|---|---|---|
| 1 | `POST /chat/completions` — what one-shot sends today | **HTTP 404** for `glm-5.2:cloud`, `glm-5.1` **and** `deepseek-v4-pro` |
| 2 | `POST /api/chat`, `stream:false` | HTTP 200, native shape: `.message.content`, **no `.choices`** |
| 3 | `POST /api/chat`, `think:false` | Clean content, **empty** thinking channel — **but see the retraction below; this probe was mis-designed** |

### The sampling leak

| # | Probe | Result |
|---|---|---|
| 4 | native, top-level `max_tokens:8` | `eval_count: 120` — **ignored** |
| 5A | native, `options:{num_predict:8}` | `eval_count: 8` — **honoured exactly** |
| 15 | native, `options:{temperature:5}` | **HTTP 400** — `"temperature must be between 0.0 and 2.0"` |
| 14 | native, top-level `temperature:5` | **HTTP 200**, coherent output |

Probes 14/15 are the decisive pair: the server **validates** `options.temperature`
(so it reads it) and silently accepts an impossible top-level `temperature` (so
nothing reads it). Ollama's own documentation confirms it: the `options` fields
"must be nested under `options` in the request body, not at the top level".
Native `options` accepts `seed`, `temperature`, `top_k`, `top_p`, `min_p`,
`stop`, `num_ctx`, `num_predict`.

> **Superseded:** an earlier probe inferred this from `temperature:0` failing to
> produce identical outputs. That inference was **invalid** — probe 8 showed
> GLM is non-deterministic at `temperature:0` even on `/v1`, where temperature
> demonstrably works. Determinism is not a test for whether a parameter arrives.

> **Retracted — probe 3 was mis-designed (2026-07-17, later the same day).**
> Probe 3 concluded `think:false` disables reasoning on GLM 5.2, and §9 built a
> follow-up on it claiming `fixed-on` was wrong. **Both are withdrawn.** Probe 3
> used a *title* prompt ("Reply with a short chat title only"), which never
> triggers reasoning in the first place — so its clean, short answer showed
> nothing about the flag. Re-probed with a prompt that genuinely warrants
> reasoning, GLM 5.2's `think:false` empties the thinking channel but **relocates
> the reasoning into the answer**: content 869 → 3265 chars, eval_count 526 →
> **1010**. "Off" costs roughly twice as much and only lengthens the reply — the
> textbook `fixed-on` / "off only hides" case. **The catalogue was right and the
> original comment was right.**
>
> The generalisable lesson, which is worth more than the finding: *a negative
> result only counts if the stimulus was present.* The same error shape as the
> superseded determinism argument above — a test that cannot distinguish the two
> hypotheses, read as if it had.
>
> The re-probe did surface a real, opposite finding: on **`glm-5.1`** and
> **`deepseek-v4-pro`**, `think:false` IS a measured off-switch (eval_count −61%
> / −41%, answer complete). Their `fixed-on` is now the questionable one. Logged
> as a follow-up; not acted on here.

### Context is not truncated

| # | Probe | Result |
|---|---|---|
| 18-20 | Needle at position 0, no `num_ctx`, ~2k / 10k / 30k tokens | `prompt_eval` 1 722 / 8 442 / 25 242 — needle **found every time** |

Ollama Cloud applies no small `num_ctx` default. We do not need to send it.
(Verified to 25k, not 200k; the "defaults to 4096" hypothesis is dead.)

### The `/v1` shim (Chris's documentation finding)

| # | Probe | Result |
|---|---|---|
| 7 | `POST /v1/chat/completions` | HTTP 200, OpenAI envelope, `usage` present |
| 10 | `/v1`, `max_tokens:8` | `completion_tokens: 8` — honoured |
| 17 | `/v1`, streaming | reasoning streams as `delta.reasoning` (216 deltas); `usage` via `stream_options` |
| — | `/v1`, `reasoning_effort:'none'` | reasoning **off**, completion tokens 481 → 222 |
| — | `/v1`, `think:false` | **ignored** — reasoning still streams |

**Tool-replay matrix** (real `buildPrompt` system prompt, 3 859 chars; streaming;
3 runs per cell; the 2026-06-03 finding claimed the `/v1` shim re-calls the tool
instead of answering):

| Model | `/v1` generate_image | `/v1` calculate_js | native generate_image | native calculate_js |
|---|---|---|---|---|
| glm-5.1 | 3/3 | 3/3 | 3/3 | 3/3 |
| glm-5.2:cloud | 3/3 | 3/3 | 3/3 | 3/3 |
| deepseek-v4-pro | 3/3 | 3/3 | 3/3 | 3/3 |

**18/18 on each endpoint. The 2026-06-03 finding does not reproduce.** Caveats
stated honestly: the original system prompt was not preserved, so this is a
reconstruction; n=3 per cell. This refutes the *stated* justification for the
native adapter but is not proof it was never real.

## 3. Root cause

Three independent faults, all instances of one class: **an OpenAI-shaped
assumption hard-wired outside the adapter.** Faults A and B sit on the one-shot
seam and break background jobs outright; Fault C sits on the sampling seam and
silently disables controls on every path, chat included.

### Fault A — the adapter's endpoint path is discarded

`streamCompletion` honours it (`stream-completion.ts:70-75`):

```ts
let path = '/chat/completions';
if (wire.path) path = wire.path;
```

`composeOneShotWire` (`one-shot-completion.ts:70-101`) takes only `body` and
`headers` and **drops `wire.path` entirely**; `runOneShotCompletionWithSleep`
hard-codes `path: '/chat/completions'` (`one-shot-completion.ts:128`). Ollama's
`baseUrl` is the bare host `https://ollama.com` and `ollamaNativeAdapter` sets
`path: '/api/chat'` (`ollama-native.ts:106`), so every background job requests
`https://ollama.com/chat/completions` → 404. 404 is not in `RETRYABLE_STATUSES`
(`retry.ts:33`), so the job fails immediately and silently — matching the symptom
(fallback title, no hang).

`baseUrl` cannot simply gain a `/v1` prefix: the web adapters build
`/api/web_search` and `/api/web_fetch` against the same `baseUrl`
(`web-adapters/ollama-web.ts:38-41`), so the bare host is load-bearing. The
endpoint path must come from the adapter — which is exactly what one-shot ignores.

### Fault B — the response is parsed as OpenAI

`one-shot-completion.ts:144-162` reads `json.choices[0].message.content`. The
native endpoint answers `{ message: { content, thinking }, done, eval_count, … }`
with no `choices` (probe 2) → `undefined` → `throw new Error('one-shot returned
empty content')`.

**Fixing only Fault A trades a 404 for an empty-content error.** Both must go.

### Fault C — sampling never reaches the adapter (chat *and* jobs)

`stream-completion.ts:196` composes `{ ...sampling, ...wire.body }`, spreading
`temperature` and `max_tokens` as OpenAI top-level keys **outside** the adapter,
where the ollama adapter cannot translate them into `options`. Ollama ignores
unknown top-level keys silently: no error, no log, no red assertion.

Consequence: **Ollama Cloud has had no working temperature control and no working
token cap since onboarding — on the chat path too.**

### Why the conversation-suite never saw it

**There are three independent wire compositions:** `stream-completion.ts`,
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
  **no sampling at all**. The suite has never sent `temperature` or `max_tokens`.

This is why `obsidian/providers/ollama-cloud.md` records "core 11/11, verified"
while three background jobs were broken the whole time. It is the sharper form of
the gap already noted at `ollama-cloud.md:97-100`: **the suite verifies a pipe it
reimplements, rather than the pipe production uses.** A verification harness that
rebuilds its subject cannot fail the way its subject fails.

## 4. Scope (decided with Chris)

| Decision | Choice |
|---|---|
| Fix approach | Reroute one-shot through `streamCompletion` — delete the parallel path |
| Sampling leak (Fault C) | **In scope** — a measured-dead control, not cosmetic |
| Sampling seam | Approach A: optional `mapSampling` hook on `ModelAdapter` |
| Retry semantics | Inherit streaming retry; preserve the per-caller overall timeout |
| Suite | `assertUsageWithinCap` mandatory; `runOneShot` optional, wired for ollama |
| **Native vs `/v1`** | **Stay native** |

### Why stay native, given `/v1` works

The `/v1` route was seriously considered and measured (§2). It works: 18/18 tool
replay, streamed reasoning, `reasoning_effort:'none'`, free OpenAI sampling. The
decision to stay native rests on a corrected cost estimate:

There is **no reusable OpenAI adapter base** — every adapter is provider-bespoke
and reimplements the OpenAI SSE parse with tool-call fragment accumulation:
chutes 175, wafer 190, tensorix 187, mistral 238, openrouter 264, xai 267 lines.
`ollama-native.ts` is **160 — the smallest of all**. A `/v1` adapter for Ollama
would be the seventh clone of that parse, ~175–190 lines: **net +15 to +30 lines,
not −160.** The simplification does not exist. Against that: `/v1` returns us to
SSE fragment accumulation (which the `/curate` checklist flags as error-prone)
instead of native's atomic tool-call arguments, and asks us to trust a shim our
own record documents as once broken.

Native's remaining merits are independent of the stale justification: it is
Ollama's first-class API, tool-call arguments arrive atomically, reasoning has a
dedicated channel, and `think:false` genuinely disables reasoning (probe 3). The
price is a ~6-line `mapSampling` hook whose efficacy is measured (probe 5A).

The real lever against the duplication is a shared `openAiCompatAdapter` for all
six OpenAI providers — a separate project with its own spec, noted in §9.

### ADR 0003 tension

This bundles three fixes into one squash, against "one squashed commit per
feature unit". Accepted deliberately by Chris: one root cause, one goal — make
Ollama Cloud background jobs work.

### Why a reroute rather than a second patch

`one-shot-completion.ts:57-68` documents that **this seam was already patched
once** (the adapter was introduced for body and headers, because reasoning models
drained `max_tokens` into their reasoning channel and left `content` empty). That
fix left path and response shape behind. Per CLAUDE.md §13 ("simplify after 2-3
failed fixes"), the second patch on the same seam is the signal to delete the
duplicate rather than extend it.

## 5. Design

### 5.1 Architecture

`runOneShotCompletion` becomes a thin fold over `streamCompletion`. Its public
signature (`OneShotArgs` → `Promise<string>`) is **unchanged**, so all callers
stay untouched.

Deleted from `one-shot-completion.ts`: `composeOneShotWire`, the
`OneShotResponse` interface, the hard-coded path, the OpenAI JSON parse, the
`withRetry` loop and `runOneShotCompletionWithSleep` (its `sleepFn` injection
existed only for that retry loop).

### 5.2 Components

| File | Change |
|---|---|
| `src/one-shot-completion.ts` | Parallel path deleted; chunk fold added |
| `src/stream-completion.ts` | `operation?: string`; throws `UpstreamHttpError`; `buildWire` exported as `composeWire` |
| `src/adapter-contract.ts` | `ModelAdapter.mapSampling?(sampling)` |
| `src/adapters/ollama-native.ts` | Implements `mapSampling` → `{ options: … }` |
| `curation/conversation-suite/binding.ts` | Uses `composeWire`; `LiveBindingArgs.sampling` |
| `curation/conversation-suite/` | `assertUsageWithinCap`; optional `RunnerBinding.runOneShot` |

**`composeWire` is a required consequence, not extra scope.** `assertUsageWithinCap`
needs the suite to *send* a cap, and the cap only reaches the wire through
`mapSampling`. Hand-rolling that inside `binding.ts` would put the hook in two
places — reintroducing the drift this spec removes. The binding keeps its own
**fetch** (status captured, not thrown — `binding.ts:33-41` still holds); only the
body/headers/path composition is shared. After this, the suite exercises the same
composition production uses, which is the point of a verification harness.

The two additions to `streamCompletion` are preconditions for behavioural
equivalence, not embellishments:

- **`operation`** — `withStreamingRetry` labels retry events with `opts.operation`;
  without it, background-job retry logs silently relabel from `'one-shot'` to
  `'stream-completion'`.
- **`UpstreamHttpError`** — `classifyMemoryActionError` (`memory/classify-error.ts:21-22`)
  reads `e.status` and maps 429/500/502/503/504 to `'upstream-busy'`.
  `stream-completion.ts:116` throws a bare `Error` with no `status`, so a naive
  reroute would degrade every memory error to `'failed'` — a user-visible
  regression on the constructive-error-handling surface. The chat path gains
  `.status` as a by-product.

### 5.3 Data flow

```
title-gen / memory / compaction / vision-substitution
  └─ runOneShotCompletion(args)
       signal = any([args.signal, AbortSignal.timeout(timeoutMs)])
       └─ streamCompletion({ ...args, signal,
                             initialResponseTimeoutMs: timeoutMs,
                             operation: 'one-shot' })
            ├─ adapter.buildRequest → wire.path        (now honoured)
            ├─ mapSampling → { options: … }            (now translated)
            └─ transport → NDJSON | SSE → StreamChunk[]
       ├─ fold: token→content, reasoning→reasoning, finish→finishReason
       ├─ onRawResponse?.({ content, reasoning, finishReason })
       └─ content === '' ? throw 'one-shot returned empty content' : return content
```

`initialResponseTimeoutMs: timeoutMs` is deliberate. `streamCompletion` defaults
to a 15 s time-to-first-byte cap; inheriting it would impose a **new** 15 s TTFB
limit on dreaming (180 s budget, `DREAM_BATCH_SIZE = 40`) and compaction (180 s),
which today have no TTFB constraint. Passing the caller's overall budget keeps the
effective semantics identical.

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
| Mid-stream failure | Whole call retried | Not retried (accepted — §4) |

### 5.5 The sampling hook

```ts
/** Translate canonical OpenAI-shaped sampling params into this provider's wire
 *  form. Absent → the params are spread as top-level keys (OpenAI default). */
mapSampling?(sampling: Record<string, unknown>): Record<string, unknown>;
```

`composeWire` uses `adapter.mapSampling?.(sampling) ?? sampling` in place of the
raw spread. `src/adapters/` holds 12 adapter factories (counted, excluding tests
and the `_anthropic-cache` helper). Only `ollamaNativeAdapter` implements the
hook; the other 11 keep the OpenAI default, which is correct for them. Presence of
the hook *is* the ownership statement — no second flag.

Ollama's implementation returns a **nested** fragment, per the documented schema:

```ts
mapSampling(s) {
  const options: Record<string, unknown> = {};
  if ('temperature' in s) options.temperature = s.temperature;
  if ('max_tokens' in s) options.num_predict = s.max_tokens;   // the rename
  if ('top_p' in s) options.top_p = s.top_p;
  if ('seed' in s) options.seed = s.seed;
  if ('stop' in s) options.stop = s.stop;
  return Object.keys(options).length > 0 ? { options } : {};
}
```

Scope of the mapping: the callers send only `temperature` and `max_tokens` today
(verified by grep), so those two are what must work. `top_p`, `seed` and `stop`
are included because they are in Ollama's documented `options` schema and cost one
line each. `num_ctx` is deliberately **not** sent: probes 18-20 show no truncation
without it.

**`top_k` and `min_p` are deliberately omitted — decided by Chris, 2026-07-17.**
This is a conscious call, not an oversight, and it was contested. The Task 1
reviewer argued it should be reversed: both fields *are* in Ollama's documented
`options` schema, `bodyExtras` is a generic `Record<string, unknown>`, so a future
caller adding Ollama-specific tuning would have `top_k` **silently dropped** —
precisely the failure class this spec exists to fix, reproduced in miniature. The
counter-argument, which governs: neither is an OpenAI-side parameter, nothing in
the codebase sends them, Chatsundere exposes no UI for them, and YAGNI (CLAUDE.md
§14) says do not build for a hypothetical caller. Whoever needs them adds two
lines and a test at that point.

Consequence to keep in mind: the mapping rule is **"the params we send"**, not
"the params Ollama accepts". The `ollama-native.test.ts` case named "drops keys
ollama does not accept" therefore overstates its own premise — `frequency_penalty`
is genuinely rejected by Ollama, whereas `top_k` is accepted and merely
unimplemented. Logged as a Minor for the final review sweep.

### 5.6 The suite

**`assertUsageWithinCap(maxTokens)`** — mandatory. Asserts
`usage.completionTokens <= cap` for a turn that requests a small cap. Purely
mechanical, no judgement of output quality, fully within "validate the pipe, never
the intelligence". **This assertion would have caught Fault C at onboarding**
(`eval_count: 120` against `max_tokens: 8` is red) and will catch it for any
future non-OpenAI provider.

It only has teeth once the binding sends a cap, hence `LiveBindingArgs.sampling`
and the `composeWire` share (§5.2). The suite's failure to send sampling was not an
oversight to route around — it was half the reason Fault C survived onboarding.

**Correction (2026-07-17, found in review, ruled by Chris).** This spec originally
put the cap turn in the shared `coreScenario` and hung the cap off the binding.
Both were wrong, for one reason: **sampling is a property of the turn, not of the
binding.**

- `coreScenario` is shared by all 13 `run-*-suite.ts` runners, but only ollama's
  wires a cap — so every other provider's next live run would have reported a
  **false failure** on that turn. A harness that cries wolf is worse than none.
- `binding.ts` applies `sampling` inside `runTurn`, i.e. to **every** turn. The cap
  would have truncated ollama's own reasoning-probe, tool-call and memory-echo
  turns to 16 tokens, turning those red too — it would have blown up at the live
  run in §6.

The cap turn therefore lives in its own `samplingCapScenario`, run by
`run-ollama-suite.ts` with its own dedicated binding — the same shape as the
one-shot coverage below. `coreScenario` is untouched for the other twelve
providers. Modelling sampling per-turn (a `ScenarioTurn.sampling` field) is the
cleaner model and was considered; it was rejected as a larger interface change
than this fix warrants, and remains the right move if a second capped turn ever
appears.

**`RunnerBinding.runOneShot?`** — optional, wired for ollama. Honest accounting:
once the parallel path is deleted, one-shot *is* `streamCompletion`, so this turn
largely re-tests a pipe the suite already covers eleven times. It is kept as thin
insurance and because it encodes the lesson — the suite must touch the
background-job entry point, not only the chat entry point.

`RunnerBinding` is produced centrally by `makeLiveBinding` / `makeGenericLiveBinding`
in `binding.ts`; the `run-*-suite.ts` scripts consume it (only `run-claude-suite.ts`
carries binding code of its own). `runOneShot` therefore lands in one place. It
stays optional because `makeGenericLiveBinding` has no adapter to delegate to.

## 6. Testing

**CI (key-free):**
- `mapSampling` unit test: `temperature`/`max_tokens` → `options.temperature`/`options.num_predict`; unknown keys dropped; empty in → empty out.
- `composeWire` test: `mapSampling` output is used; adapter structural keys still win on clash.
- one-shot fold tests: chunks → content/reasoning/finishReason; `onRawResponse` fires before the empty-content throw; timeout composition; neither `cacheKey` nor `tools` sent.
- `binding.test.ts` already injects `fetchImpl`/`sleepImpl`, so the `composeWire` switch is assertable key-free.

**The 11 existing tests** in `one-shot-completion.test.ts` mock OpenAI JSON bodies
and must be rewritten against a streamed response. The four retry tests (429
retry, 401 no-retry, retries exhausted, fresh-Request-per-attempt) become
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
   `proxy-auth.ts` names the memory-extraction job as a common trigger. Needs a
   dedicated test.
2. **Retry-case coverage** in `stream-completion`'s tests before deleting the
   one-shot retry tests (§6).
3. **`composeWire` must not alter suite behaviour.** `makeLiveBinding` passes no
   sampling today, so `composeWire` with empty sampling must produce a
   byte-identical body to today's `wire.body` for every existing adapter. Assert
   before trusting; a silent body change would invalidate every provider record at
   once.

## 8. Records to update

`obsidian/providers/ollama-cloud.md` — the honesty surface, currently wrong on
three counts:

- **Record the faults**: the 404 on background jobs, the sampling leak.
- **Replace the "Why native" justification.** It currently rests on the
  2026-06-03 `/v1` tool-replay defect, which no longer reproduces (18/18, §2).
  The honest statement: native is chosen for the first-class API, atomic
  tool-call arguments, and a smaller adapter than an OpenAI clone would be; the
  original defect is not reproducible as of 2026-07-17 and `/v1` is a viable
  fallback.
- **Refine the `think:false` claim** at `ollama-cloud.ts:67` ("still streams
  reasoning (leaks into content)"). It is **right for GLM 5.2** and wrong as a
  blanket statement: re-probed 2026-07-17, `think:false` relocates GLM 5.2's
  reasoning into the answer (eval_count 526 → 1010), but is a genuine off-switch
  on `glm-5.1` (−61%) and `deepseek-v4-pro` (−41%). It is per-model. On `/v1`,
  `think` is ignored outright and `reasoning_effort` is the lever.
- **Qualify "live-verified, core 11/11"** — demonstrably not a statement of
  completeness.

## 9. Follow-ups (out of scope)

- ~~GLM 5.2's `fixed-on` reasoning classification is probably wrong.~~
  **Retracted the same day — see the retraction in §2.** GLM 5.2's `fixed-on` is
  **correct**; the follow-up rested on a mis-designed probe.
- **`glm-5.1` / `deepseek-v4-pro`'s `fixed-on` is probably wrong** — the real
  finding the retraction surfaced. `think:false` is a measured off-switch on both
  (eval_count −61% / −41%, content length unchanged, answer complete), which
  contradicts the 2026-06-03 "think:false is a no-op on these models" line. A
  `toggle` would save users 40-60% of completion tokens on these two. UX-visible →
  Chris's judgement. Needs a wider probe (n=2 so far) and, if it lands, a suite
  re-run: a `toggle` produces two reasoning permutations, so `assertReasoningAbsent`
  begins to apply.
- **A shared `openAiCompatAdapter`** for the six near-duplicate OpenAI adapters
  (1 321 lines between them). The real lever against this duplication, and the
  thing that would make `/v1` nearly free. Own spec.
- **`runOneShot` for `makeGenericLiveBinding`** — generic offerings have no
  adapter to delegate to.
- **Stale comment** at `binding.ts:106`: `makeGenericLiveBinding` is documented as
  serving "vanilla OpenAI-compatible providers (e.g. ollama-cloud)". ollama-cloud
  has been a catalogue/native offering since 2026-06-03; the example misleads.
- **`/v1` viability is now measured** and recorded here, so a future decision to
  switch needs no re-probing.

## 10. Manual verification (Chris, on device)

1. New chat with GLM 5.2 via Ollama Cloud, send one message → **a real title
   appears**, not "New chat — …".
2. Trigger memory extraction → memory is written, no error toast.
3. Trigger compaction on a long chat → it completes.
4. Repeat 1 with GLM 5.1 and DeepSeek V4 Pro → titles appear (proves the
   provider-wide claim, not just GLM 5.2).
5. Disconnect mid-job → the error surfaces as "upstream busy"/timeout copy, not a
   generic failure (proves `UpstreamHttpError` threading).
6. **Start a new chat on a NON-ollama model (e.g. a nano-gpt one) and confirm a
   real title appears.** Added after the whole-branch review flagged it, and it is
   the one step that is not about Ollama at all: the reroute changes background
   jobs on the *generic* (non-adapter) path from `stream: false` to `stream: true`
   for **every** provider. The risk is low — the same `buildBody` already streams
   for chat there, and the fold consumes the identical `parseOpenAiSseStream`
   chunks — but the eleven deleted one-shot tests were the only nano-gpt one-shot
   coverage, their replacements use a fake stream, and the live suite run was
   Ollama-only. One title on one nano-gpt model closes the gap for a minute's work.
