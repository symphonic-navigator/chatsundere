# Model Curation Record — Inkling

> Curation record. See [[../providers/nano-gpt]] and [[../providers/openrouter]]
> for the shared provider mechanics. Inkling is **Thinking Machines' first public
> model** (Mira Murati's lab) — a community first for Chatsundere. Onboarded
> **2026-07-16**, curated live against nano-gpt. **Re-curated 2026-07-17** after
> nano-gpt wired the reasoning-trace passthrough and exposed a real effort ladder
> — see the update note below. **Second route added 2026-07-18**: OpenRouter (sole
> upstream Together AI) — see the OpenRouter offering section.

- **Identity:** Inkling · family `inkling`
- **Architecture:** sparse MoE, **975B total / 41B active**, natively multimodal
  (vision + audio in; we surface vision, text out). Apache-2.0. Routed by
  nano-gpt to **Baseten** (`owned_by: baseten`).
- **T/R/V:** tools ✅ · reasoning ✅ (a four-band effort ladder, trace visible) ·
  vision ✅ (image input; output text-only)
- **replayReasoning:** false — soft-CoT; the trace now surfaces on this route but
  is never replayed back into history.
- **🕊️ Freedom:** **unknown** → the muted `Uncensored?` badge. `freedomOriented:
  null` (not yet assessed), `freedomOrientedDeployment: true` (nano-gpt adds no
  censorship of its own). See the freedom section.
- **🔒 Privacy:** no TEE / no ZDR, **US jurisdiction** (Baseten upstream).

## Update 2026-07-17 — the passthrough landed and it brought an effort ladder

Chris pinged nano-gpt (Milan) on 2026-07-16 about the withheld trace; Milan
replied *"oops, will fix asap"* and by 2026-07-17 had wired **more than** the
trace. Two things changed, both re-probed live and serially:

1. **The trace now surfaces** on the OpenAI-compatible route — on **both** the
   base slug (production form `reasoning:{enabled:true}`) and a **newly-appeared
   `thinkingmachines/inkling:thinking` sibling**. So `reasoningTraceHidden` was
   dropped from the offering; Inkling is once again an ordinary visible-reasoning
   model with full CoT reverb. The suite's `reasoning-hidden-billed` assertion
   fired exactly as it was designed to and has been retired.
2. **Effort genuinely modulates.** Inkling's HF card documents seven upstream
   effort levels (`none/minimal/low/medium/high/xhigh/max`), and nano-gpt now
   honours `effort` in the unified object — reasoning tokens span roughly a factor
   of ten from the low band to the high band. It is modelled as **`steps`**, not
   the interim toggle.

### The two slugs differ only in their default

`thinkingmachines/inkling` defaults reasoning **off** (no flags → 0 reasoning
tokens even on a hard prompt); `thinkingmachines/inkling:thinking` defaults **on**
(429 tokens on the same flagless prompt). Both honour explicit steering, and
`{enabled:false}` is a genuine off on the `:thinking` slug too. Because our
adapter **always** sends an explicit `reasoning` object for a reasoning-capable
offering, the two slugs are behaviourally identical for us — so we stay on the
**base slug** and do **not** add a second offering. (This corrects the original
record's "default on, matching Inkling's native behaviour": native default on the
base slug is *off*; our `defaultStep: 'medium'` is house style, not upstream.)

The likely mechanism behind the earlier gap is now confirmed by the fix's shape:
nano-gpt's passthrough was keyed to the `:thinking`-slug convention (GLM/DeepSeek),
Inkling shipped without such a sibling, and Milan added both the sibling and
body-flag passthrough together.

## Reasoning control — a four-band effort ladder

Modelled as **`{ mode: 'steps', steps: ['off','low','medium','high'], offStep:
'off', defaultStep: 'medium' }`** on the unified `reasoning` object (reused via
`openRouterAdapter`, exactly like Grok/OpenAI on nano-gpt). The catalogue constant
`INKLING_STEPS` is deliberately **separate** from the shape-identical
`OPENAI_STEPS`: the two describe unrelated upstreams that agree today, and one
constant would assert a coupling that does not exist.

- `reasoning:{enabled:false}` is a **genuine off** — `reasoning_tokens` drops to
  **0** and the answer is direct (re-probed 2026-07-17).
- **Four bands, not seven.** The card's seven labels do not all separate under
  measurement. Two samples per level in the production form
  (`reasoning:{enabled:true,effort:X}`) gave, in reasoning tokens:

  | level | minimal | low | medium | high | xhigh | max |
  |---|---|---|---|---|---|---|
  | run a | 62 | 65 | 104 | 523 | 622 | 391 |
  | run b | 53 | 81 | 219 | 817 | 745 | 435 |

  Within-level spread exceeds between-level spacing for the fine gradations,
  `minimal ≈ low`, `xhigh ≈ high`, and `max` measured **below** `high`. Only four
  bands are honestly separable — off (0) · low (~70) · medium (~160) · high
  (~670) — and those four are exactly the labels the client's
  `resolveReasoningBodyExtras` already maps onto `effort` (`low|medium|high`;
  others fall back to a bare enabled intent). We ship the four and under-claim
  rather than offer positions that do nothing.
- The top-level `reasoning_effort` param modulates too, but our adapter sends the
  unified `reasoning:{enabled,effort}` object; both were probed and agree.

Contrast with **Grok 4.5** (a superficially similar "billed-but-hidden" story
from the earlier record): Grok 4.5's *normal fixed-on operation* **does** surface
a reasoning summary on `delta.reasoning`; its hiding only occurred on the unused
`{enabled:false}` path. Grok 4.5 was therefore never a `reasoningTraceHidden`
case. With Inkling's flag dropped, **no offering carries `reasoningTraceHidden`
today** — the mechanism is retained (a passthrough gap on a freshly-added model
recurs) but has no current consumer.

## Context window — unconfirmed, conservative 128k

nano-gpt's `/models` reports **no** window for Inkling, and the HF model card
specifies none. Set conservatively to **recommended 131 072 / max 131 072** —
truncation is graceful, an over-limit request is not, so we under-claim pending
confirmation. Raise once the true window is known.

## Offering — nano-gpt

- **slug:** `thinkingmachines/inkling` · **adapterId:**
  `nano-gpt:thinkingmachines/inkling`. A `thinkingmachines/inkling:thinking`
  sibling now exists (it did not on 2026-07-16) but we do **not** use it — it
  differs only in its default (see the update note); the base slug plus our
  always-explicit `reasoning` object covers both behaviours.
- **adapter:** the shared `openRouterAdapter` — it emits
  `stream_options:{include_usage:true}` (required; without it Inkling sends only
  `x_nanogpt_pricing`, no OpenAI `usage`) and the unified `reasoning` object, and
  reassembles tool calls.
- **context:** recommended **131 072** / max **131 072** (see above).
- **tool calls:** **single-block** (`streaming: false`) — one delta carries `id`,
  `name` and full `arguments`; `finish_reason: "tool_calls"`.
- **vision:** ✅ — a real photo's clothing colour named reliably (6/6 "green"
  once the image-gen tool is out of the way; see the quirk below).
- 🔒 **Privacy:** no TEE / no ZDR, US jurisdiction (Baseten).
- **confidence:** `verified` — `run-inkling-suite.ts` re-run 2026-07-17
  (core 44/44 across the four-band ladder, vision 4/4).

## Offering — OpenRouter (added 2026-07-18)

Inkling's second route, added the day it reached OpenRouter (the moment the
freedom section had been waiting for). Probed live and serially, 2026-07-18.

- **slug:** `thinkingmachines/inkling` · **adapterId:**
  `openrouter:thinkingmachines/inkling` · **adapter:** the shared
  `openRouterAdapter` (no bespoke code — the generic OpenRouter adapter covers it:
  `stream_options:{include_usage:true}`, the unified `reasoning` object, and
  fragmented-tool-call reassembly).
- **Sole upstream: Together AI (US).** There is **no second OpenRouter endpoint**
  and no fallback route. The model-level `/models` reports a 1,048,576 ceiling,
  but the only servable endpoint (Together) caps at **524 288** — empirical truth
  over the aggregate. **context:** recommended **131 072** (the conservative
  nano-gpt sweet-spot, kept pending long-context evidence) / max **524 288**.
- **Account gotcha — "may train" blocks the only provider.** Because Together is
  the *sole* endpoint, an OpenRouter account whose privacy settings disable
  "providers that may train on inputs" gets **HTTP 404 "All providers have been
  ignored"** on *every* Inkling request. A per-request
  `provider:{data_collection:'allow'}` does **not** override an account-level
  ignored provider (probed 2026-07-18) — it must be changed at
  `openrouter.ai/settings/privacy`. This is a real product signal, not just a
  probe artefact: a privacy-conservative end user will hit the same wall. Worth a
  future onboarding hint if users report it.
- **🔒 Privacy:** no TEE / no ZDR, **US jurisdiction** (Together). The honest
  US-router baseline — no 🔒 badge. Note the may-train posture above.

### Two measured divergences from the nano-gpt route

Both re-probed live 2026-07-18; each route is measured independently (the same
principle that makes GLM-5.1 fixed-on on wafer but a clean toggle on OpenRouter).

1. **Reasoning is a plain `toggle` here, not the four-band `steps` ladder.**
   `reasoning:{enabled:false}` is a **genuine off** (0 reasoning tokens, empty
   channel); the trace surfaces **unprompted** on `delta.reasoning` (no
   `include_reasoning` needed, unlike OpenAI on this router). But **effort does
   not separate monotonically** on Together — three prompts, in reasoning tokens:

   | prompt | low | medium | high |
   |---|---|---|---|
   | irrationality/Fibonacci/halting | 46 | 460 | 489 |
   | snail-in-well (a) | 229 | 286 | 280 |
   | snail-in-well (b) | 234 | 236 | 439 |

   The ordering swaps across prompts (`low≪med≈high`, `low≈med≈high`,
   `low≈med≪high`) — between-level spacing is buried in within-level noise. Only
   **off vs on** is robustly separable, so the honest control is
   `{ mode: 'toggle', defaultOn: true }` (Chris, 2026-07-18). Offering effort
   steps that do nothing on this route is exactly what the nano-gpt section argues
   against. The cockpit therefore shows a plain on/off switch on the OpenRouter
   route and the four-band ladder on nano-gpt — same model, per-route regulator.
2. **Tool calls stream fragmented.** On OpenRouter/Together the tool-call
   arguments arrive across **~28 SSE deltas**, reassembled by the adapter into a
   single valid-JSON call (`streaming: true`); nano-gpt delivers the same call
   **single-block**. `concurrentWithReasoning: true` (the tool fires with
   reasoning enabled). Vision is ✅ via a data URL exactly as on nano-gpt (a
   *remote* image URL fails with `multimodal_processing_failed` — Together fetches
   it server-side and hotlink-protected hosts 403 the fetcher; a probe artefact,
   never the product path, which inlines the user's image as base64).

### Freedom — the OpenRouter deployment axis

`freedomOrientedDeployment: true` — OpenRouter routes verbatim and adds no
censorship of its own. The **model-intrinsic** judgement stays deferred:
`freedomOriented: null` on the canonical, so effective freedom is still
**unknown → `Uncensored?`**. Reaching OpenRouter is precisely the trigger the
freedom section names for Lex's independent safety evaluation; the judgement is
revisited when his results land, not guessed here.

## Tool-calling — over-eagerness quirk

Inkling is **tool-eager on image prompts**. Offered a `generate_image` tool *and*
asked to **describe** an image ("what colour is the clothing?"), it fires
`generate_image` instead of answering — **0/5** with the tool present, **6/6**
without (probed 2026-07-16). The vision *pipe* is sound; the tool presence
confounds it. Consequences:

- The conversation-suite runs the **vision scenario with a tools-free binding**
  (the image-gen tool is irrelevant to an image-*input* check), where it passes
  cleanly.
- Product note: when `generate_image` is offered alongside a user's image and a
  describe-style prompt, Inkling may generate rather than answer. This is a
  weights-level eagerness we record rather than mask; the standard mitigation
  (don't offer image-gen when the intent is clearly description) applies if users
  hit it. When *asked to draw*, the tool fires correctly (core suite 22/22).

## Usage shape

OpenAI-standard envelope **only when `stream_options:{include_usage:true}` is
sent** — `prompt_tokens`, `completion_tokens`, `total_tokens`,
`completion_tokens_details.reasoning_tokens` (mirrored top-level as
`reasoning_tokens`), `prompt_tokens_details.cached_tokens`. Delivered on the final
`choices`-bearing chunk. Without `include_usage`, only nano-gpt's own
`x_nanogpt_pricing` (with `inputTokens`/`outputTokens`) is emitted — the adapter
ignores it. Unlike Grok 4.5's nano-gpt route, Inkling's `reasoning_tokens` **is**
trustworthy: it goes to a genuine 0 on `{enabled:false}`.

## Freedom — deferred to an independent evaluation

`freedomOriented: null` deliberately. Inkling is a **US model**, and its own HF
card is candid that guardrails are **present but leaky**: *"occasional tendency to
comply with role-play and indirectly framed prompts concerning harmful topics"*,
recommending operators add **defence-in-depth** (content filtering, Llama-Guard
compatibility) rather than rely on the built-in refusals. The model's in-chat
self-description ("weights-level, system prompt cannot fully override") is **not**
taken as evidence — models routinely confabulate about their own alignment
(GLM 4.6 made the identical claim).

We therefore **do not guess**. An independent safety evaluation (Lex's
safetymaxxed bench) is pending — he will run it once Inkling reaches OpenRouter.
Until then effective freedom resolves to **unknown → `Uncensored?`**, and the
judgement is reviewed when his results land. This is the honest posture the new
badge exists to express.

## Validation

Live suite (`run-inkling-suite.ts`), re-run **2026-07-17**, serially, with the
exact production adapter (`openRouterAdapter('thinkingmachines/inkling', …)`).
The harness now derives its matrix from the offering's own `ReasoningControl`
via `permutationsForReasoning`, so it exercises every effort band:

| Route | Scenario | Result |
|---|---|---|
| nano-gpt | core (reasoning-off · effort:low · effort:medium · effort:high) | **44/44** |
| nano-gpt | vision (tools-free) | **4/4** |
| OpenRouter (`run-openrouter-suite.ts inkling`, 2026-07-18) | core (reasoning-off · reasoning-on — a `toggle`) | **22/22** |
| OpenRouter | vision (tools-free) | **4/4** |

Confirmed:

1. **Reasoning off** → genuine (`reasoning-absent` passes, `reasoning_tokens` 0).
2. **Each effort band** → `reasoning-present` passes; the trace now populates the
   reasoning channel on every band (the passthrough landed 2026-07-17).
3. **Tools** → `generate_image` fires on a draw request, arguments valid JSON, on
   every band.
4. **Vision** → test image described correctly (tools-free; see the quirk).
5. **Memory/recall** → injected token echoed back through the protocol.
6. **Usage** → normalised, `totalTokens > 0` on every turn.

The earlier run (2026-07-16, core 22/22) used a bespoke `reasoning-hidden-billed`
assertion for the then-withheld trace; it fired on the flip as designed and was
retired.
