# Model Curation Record — Grok 4.5

> Curation record. See [[../providers/xai]], [[../providers/openrouter]] and
> [[../providers/nano-gpt]] for the shared provider mechanics, and [[grok-4.3]]
> for its sibling. Same family, same wire shape — but 4.5 is **not** a 4.3 with a
> bigger number: see the reasoning section.

- **Identity:** Grok 4.5 · family `grok`
- **T/R/V:** tools ✅ · reasoning ✅ (**mandatory** — see below) · vision ✅
  (input image; output text-only)
- **replayReasoning:** false — the reasoning summary is human-readable on the
  wire and there is nothing to replay. On xAI-direct and OpenRouter the summary
  is all there is. On nano-gpt an **encrypted reasoning blob**
  (`reasoning.encrypted`, format `xai-responses-v1`) additionally leaks in the
  `reasoning_details` array, because nano-gpt proxies 4.5 through xAI's
  **Responses API**; the adapter reads only the `reasoning` summary channel and
  ignores `reasoning_details`, so the blob is inert → display-only.
- **🕊️ Freedom:** free — `freedomOriented: true`, `freedomOrientedDeployment: true`
  on all three deployments (Chris, 2026-07-09: Grok 4.5 is judged even *more*
  freedom-oriented than 4.3; tested and approved). None of the three providers
  adds censorship of its own.

Curated on **three deployments**: xAI-direct, OpenRouter (the 🔒 ZDR route) and
nano-gpt. xAI-direct and OpenRouter were onboarded **2026-07-15**, the day xAI
cleared the model for the EU — that clearance was the sole blocker.

## Reasoning is MANDATORY — the headline finding (probed 2026-07-15)

**Grok 4.5 cannot be told to stop reasoning. On any route.** This is the one way
it departs from 4.3, and it is why none of the three offerings carries an off
switch. The providers differ only in *how honestly they say so*:

| Route | Asking for reasoning off | What actually happens |
|---|---|---|
| **OpenRouter** | `reasoning: {enabled:false}` | **HTTP 400** — *"Reasoning is mandatory for this endpoint and cannot be disabled."* Honest. |
| **xAI-direct** | `reasoning_effort: 'none'` | **HTTP 400** — *"This model does not support `reasoning_effort` value `none`."* Honest. |
| **xAI-direct** | `reasoning: {enabled:false}` | **HTTP 200, silently ignored.** The reply still carries `reasoning_content`. |
| **nano-gpt** | `reasoning: {enabled:false}` | **HTTP 200, trace hidden, `reasoning_tokens: 0` reported — while the model reasons anyway and the user is billed for it.** |

The nano-gpt case deserves stating plainly. Asked for a river-crossing answer
with reasoning "off", the visible reply was the single token **`7`** — and
`usage.completion_tokens` was **198**, with `reasoning_tokens` reported as **0**.
Roughly 197 tokens of invisible work: performed, charged, denied. This is the
textbook **"off only hides"** case from the curation checklist.

### The 2026-07-09 curation got this wrong — corrected 2026-07-15

The original nano-gpt curation recorded `{enabled:false}` as *"a genuine off (0
reasoning tokens, probed 2026-07-09)"* and shipped the offering as a `toggle`.
That reading trusted `reasoning_tokens: 0` — **a number the provider fabricates**.

The conversation-suite did not catch it either: its `reasoning-absent` assertion
**passed**, because the trace genuinely was absent *from the channel*. The suite
validates the channel, not the billing, so a hidden trace is indistinguishable
from no trace. That is a real limitation of the harness, not a bug in it.

What caught it was **cross-route comparison**: OpenRouter refuses the identical
request outright, and for the same prompt xAI-direct reports
`completion_tokens: 1` + `reasoning_tokens: 39` where nano-gpt reports
`completion_tokens: 54` + `reasoning_tokens: 0`. Two routes calling it mandatory
beats one route's counter.

**Lesson worth keeping:** a provider-reported `reasoning_tokens: 0` is not
evidence of an off. Check it against `completion_tokens` and the visible answer
length — a one-token answer costing 198 completion tokens is reasoning, whatever
the counter claims. Where a model exists on several routes, probe the off on all
of them before believing any of them.

## Context window — 500k, not 1M

Both authoritative sources agree: xAI's own `/models` reports
`context_length: 500000` for `grok-4.5`, and OpenRouter reports the same. The
`long_context_threshold` is **200 000** — above it xAI roughly doubles the price
(prompt 20k→40k, completion 60k→120k ticks), which is why `recommended` sits at
200k on every offering, exactly as for 4.3.

The 1M originally recorded on the nano-gpt offering was an **assumption**
mirrored from 4.3 (nano-gpt reports no window of its own) and overstated the
ceiling by a factor of two. Corrected 2026-07-15. Chris's context: the 500k is a
deliberate xAI decision — 4.5 is internally "V9", a ~1.5T model, and window size
acts multiplicatively on compute effort; Colossus 2 is not infinite either.

## Offering — xAI-direct

- **slug:** `grok-4.5` · **adapterId:** `xai:grok-4.5`
- **context:** recommended **200 000** / max **500 000**.
- **reasoning control:** the native **`reasoning_effort`** param, exactly as 4.3
  — except `none` is rejected (HTTP 400). `low|medium|high` all return 200.
  Modelled as `{ mode: 'steps', steps: ['low','medium','high'], offStep: null,
  defaultStep: 'low' }`; `offStep: null` is what encodes "no off", and the
  adapter therefore never emits an off value. Effort is accepted and does
  *something*, but the measured token counts do not differentiate cleanly
  (low 373 / medium 520 / high 437 reasoning tokens, one sample each) — single
  samples on a nondeterministic model, so this is recorded rather than claimed
  either way. Per the suite's rule we validate the pipe, not the intelligence.
- **tool calls:** streamed, single-block in practice (one delta carries `id`,
  `name` and the full `arguments`), `finish_reason: "tool_calls"`, concurrent
  with reasoning.
- **vision:** ✅.
- **reasoning channel:** `delta.reasoning_content`, the human-readable summary —
  **no `reasoning_details`, no encrypted blob** (0 occurrences across the probed
  stream). The cleanest of the three routes.
- 🔒 **Privacy:** no TEE / no ZDR, US jurisdiction. (An NGO-negotiated ZDR remains
  a future possibility — the venice.ai precedent — which would flip `zdr` and add
  a header.)
- **caching:** the `x-grok-conv-id` header works as for 4.3 (`cached_tokens: 128`
  observed on a repeated turn).
- **confidence:** `verified` — `run-grok-suite.ts` 2026-07-15: core **33/33**
  (all three effort permutations) + vision **4/4**, 0 fail, with the exact
  production adapter (`xaiAdapter('grok-4.5', …)`).

## Offering — OpenRouter (🔒 ZDR)

- **slug:** `x-ai/grok-4.5` · **adapterId:** `openrouter:x-ai/grok-4.5`
- **context:** recommended **200 000** / max **500 000** (OpenRouter-reported,
  agreeing with xAI).
- **reasoning control:** the unified `reasoning` object. `{enabled:false}` is an
  honest **HTTP 400**; effort buckets are accepted. Same control as xAI-direct:
  `steps` with `offStep: null`. Effort likewise does not differentiate cleanly
  (low 529 / high 505 reasoning tokens, one sample each) — recorded, not claimed.
- **tool calls:** streamed (fragmented `arguments` reassembled by the adapter),
  concurrent with reasoning.
- **vision:** ✅ (`architecture.modality: text+image+file->text`).
- 🔒 **Privacy:** **ZDR ✅** — `provider: {zdr: true}` routes to xAI's
  Zero-Data-Retention endpoint (verified live 2026-07-15: HTTP 200,
  `provider: "xAI"`). Enforced per-request on the wire from `trust.zdr`, so the
  claim is honoured rather than asserted; the request fails rather than route to
  a retaining endpoint. **This is the privacy route for Grok 4.5**, as it is for
  4.3 — xAI-direct offers no ZDR today. Jurisdiction US, no TEE.
- **confidence:** `verified` — `run-grok-suite.ts` 2026-07-15: core **33/33** +
  vision **4/4**, 0 fail, with the exact production adapter
  (`openRouterAdapter('x-ai/grok-4.5', { zdr: true, … })`).

## Offering — nano-gpt

- **slug:** `x-ai/grok-4.5` · **adapterId:** `nano-gpt:x-ai/grok-4.5`
- **context:** recommended **200 000** / max **500 000** (corrected from 1M).
- **reasoning control:** **`{ mode: 'fixed-on' }`** (corrected from `toggle`).
  nano-gpt's off neither errors nor obeys — it hides (see the table above). Since
  reasoning cannot be disabled, no off is offered; the adapter always sends
  `{enabled: true}` and the summary streams honestly on `delta.reasoning`.
  nano-gpt's `reasoning_tokens` counter is unreliable on this route and is not
  used as evidence for anything.
- **tool calls:** single-block (`streaming: false`) when fired, concurrent with
  reasoning. See the route quirks below.
- **vision:** ✅.
- 🔒 **Privacy:** no TEE / no ZDR (routes to the xAI upstream, US jurisdiction).
- **confidence:** `verified` — `run-grok-suite.ts` 2026-07-15 (post-correction):
  core **11/11** (the single reasoning-on permutation `fixed-on` implies) +
  vision **4/4**, 0 fail. The `reasoning-present` assertion now passes, where the
  pre-correction run passed `reasoning-absent` against a merely hidden trace.

## Tool-calling — route quirks

1. **Occasional write-as-text nondeterminism.** The model sometimes emits the
   tool call as markdown (`` ```generate_image ``) as `content` and finishes with
   `stop` instead of firing it — the known DSv4-Flash / Gemma-4-style
   nondeterminism (a weights behaviour, not a protocol break). Seen across the
   Grok family and routes, including a 2026-07-15 `grok-4.3`-on-OpenRouter run
   that failed `tool-call-fired` and then passed 22/22 on an immediate re-run.
   Mitigation, if a user hits it: the usual explicit tool-mention in prompt
   composition.
2. **`tool_choice: "required"` errors** on the nano-gpt route, returning
   `finish_reason: "error"` with a `` ```generate_image `` content leak. We never
   send `tool_choice: "required"` in production (the standard flow uses `auto`),
   so this is recorded but not exercised.

## Usage shape

OpenAI-standard envelope on all three routes — `prompt_tokens`,
`completion_tokens` (**excluding** reasoning), `total_tokens` (**including**
reasoning), `completion_tokens_details.reasoning_tokens`,
`prompt_tokens_details.cached_tokens`. Delivered on the final `choices`-bearing
chunk under `stream_options: { include_usage: true }`. Normalises to
`NormalisedUsage` with `reasoningTokens` and `cachedTokens` populated.

**Caveat (nano-gpt):** its `reasoning_tokens` is **not trustworthy** on this
route — it reports 0 while reasoning demonstrably occurs, and the reasoning cost
appears folded into `completion_tokens` instead. nano-gpt also attaches its own
`x_nanogpt_pricing` / `x_nanogpt_cache` fields, which the adapter ignores.

## Validation

Live suite (`run-grok-suite.ts`), run 2026-07-15, serially, with the exact
production adapters:

| Target | Core | Vision |
|---|---|---|
| `xai:grok-4.5` | **33/33** (low · medium · high) | **4/4** |
| `openrouter:x-ai/grok-4.5 (ZDR)` | **33/33** (low · medium · high) | **4/4** |
| `nano-gpt:x-ai/grok-4.5` | **11/11** (fixed-on) | **4/4** |
| `openrouter:x-ai/grok-4.3 (ZDR)` — regression, the adapters are shared | **22/22** | **4/4** |

Confirmed across all three routes:

1. **Reasoning** → present on the correct channel in every permutation; no route
   offers an off, and none is advertised.
2. **Tools** → `generate_image` fires, arguments valid JSON.
3. **Vision** → test image described correctly.
4. **Memory/recall** → injected token echoed back through the protocol.
5. **Usage** → normalised, `totalTokens > 0` on every turn.
6. **ZDR** (OpenRouter only) → enforced on the wire, routes to xAI.
