# Model Curation Record — Kimi K3

> Curation record. See [[../providers/openrouter]] for the shared OpenRouter
> mechanics, and [[kimi-k2.6]] for the family predecessor.

- **Identity:** Kimi K3 · family `kimi`
- **T/R/V:** tools ✅ · reasoning ✅ (mandatory — see below) · vision ✅ (input
  image; output text-only)
- **replayReasoning:** false (soft-CoT — Kimi never re-reads its own thinking)
- **🕊️ Freedom:** **unknown** — `freedomOriented: null` (Chris, 2026-07-16). Moonshot
  AI is a **PRC** company (KPCh content obligations), so the model-intrinsic
  freedom is genuinely unassessed, **not** `false`: absence of evidence is not
  evidence of restriction (the anti-censorship stance's own rule). There are
  unconfirmed reports that Moonshot drops censorship for Western API clients; until
  an eval measures it, the honest encoding is `null`, which resolves the 🕊️ badge to
  *unknown* regardless of the deployment axis. **Follow-up:** revisit once the
  eval lands (Ksena confirmed Inkling; Kimi K3 pending).

A **2.5T** model trained with **QAT** (quantisation-aware training — native 4-bit
weights, so quantised behaviour stays close to full precision; the family trait
Chris values). Three routes are now curated: Moonshot's own API via **OpenRouter**
(the original, `fixed-on`), **novita** (added 2026-07-18, `steps` with a real
off) and **ollama Cloud** (added 2026-07-27, `fixed-on` — by policy, not by
inability). novita reports a native 1M window and full text+image vision.

> **The open weights landed on 2026-07-27**, eleven days after the API-only
> onboarding above (the community ran a public countdown to the drop). ollama
> served the model within the hour, which is what prompted this third route.
> `/api/show` reports **2.812T** parameters at **MXFP4** — worth noting against
> the "2.5T" figure the OpenRouter onboarding recorded from Moonshot's own
> material.

## Offering — openrouter — `fixed-on` (reasoning cannot be disabled)

- **slug:** `moonshotai/kimi-k3` · **adapterId:** `openrouter:moonshotai/kimi-k3`
- **context:** recommended **262 144** / max **1 048 576**. OpenRouter reports a 1M
  ceiling; `recommended` stays at the Kimi-family sweet-spot (matching
  [[kimi-k2.6]]) because we have **no long-context "stays smart" evidence** for K3
  yet. `recommended ≠ max` is deliberate — revisit when we do.
- **reasoning control:** **`fixed-on`** (the "off cannot be honoured" case, but for
  a different reason than wafer/Tensorix). Two live findings (probed 2026-07-16):
  - **Off is refused, not faked.** `reasoning:{enabled:false}` returns **HTTP 400
    "Reasoning is mandatory for this endpoint and cannot be disabled"** — exactly
    like [[grok-4.5]]. OpenRouter is honest about it rather than hiding the trace
    while still billing (the nano-gpt anti-pattern noted in [[../providers/openrouter]]).
  - **Effort does not modulate.** low/medium/high on the same task produced
    ~50–110 reasoning tokens with no monotonic trend (pure prompt noise), so a
    `steps` control would offer steering that does nothing. `fixed-on` is the
    honest model. This is the divergence from K2.6, which is a **clean toggle** on
    OpenRouter — K3 cannot be silenced upstream at all.
  - The generic `openRouterAdapter` handles this with no new code: `fixed-on` sets
    `canDisableReasoning = false`, so `buildRequest` **never** emits the
    400-triggering `{enabled:false}` — it always sends `reasoning:{enabled:true}`.
- **reasoning channel:** `reasoning` (OpenRouter's unified channel; arrives
  unprompted — no `include_reasoning` flag needed, unlike the ChatGPT family).
- **tool calls:** streaming (fragmented args, reassembled by the adapter),
  concurrent with reasoning.
- **vision:** ✅ — image-input pipe carries through (suite `vision` green — names
  the clothing colour "green" on the test image).
- **usage:** OpenAI-standard — `reasoning_tokens` under `completion_tokens_details`,
  `cached_tokens` under `prompt_tokens_details`. Pricing (2026-07-16): prompt
  $3/M, completion $15/M, cache-read $0.30/M.
- 🔒 **Privacy:** **no** — US router/aggregator, not ZDR/TEE, and the sole upstream
  is Moonshot (PRC). Trust `{ tee: false, zdr: false, jurisdiction: 'US' }`.
- 🕊️ **Freedom (deployment):** `freedomOrientedDeployment: true` — OpenRouter itself
  routes verbatim and adds no censorship layer; the unknown lives on the **model**
  axis (Moonshot-PRC), so the composed 🕊️ badge is *unknown* (Chris, 2026-07-16).

## Offering — novita — `steps` (`reasoning_effort`, `none` = off)

Added 2026-07-18 (Chris). The interesting contrast to OpenRouter: on novita K3
reasoning **can** be disabled.

- **slug:** `moonshotai/kimi-k3` · **adapterId:** `novita:moonshotai/kimi-k3`
- **context:** recommended **262 144** / max **1 048 576** (novita reports the 1M
  ceiling; `recommended` matches the OpenRouter K3 sweet-spot — still no
  long-context "stays smart" evidence).
- **reasoning control:** **`steps`** (off/low/medium/high). `reasoning_effort: 'none'`
  is a **clean off** — 0 reasoning tokens (probed 2026-07-18) — where OpenRouter
  refuses `enabled:false` with a 400 and cannot be silenced. `enable_thinking:
  false` is **ignored** on this newer novita slug (the newer-slug trap — see
  [[../providers/novita]]); `reasoning_effort` is the switch. low/medium/high all
  reason (202 / 97 / 101 tokens on a trivial prompt). Trace on `reasoning_content`,
  handled by the `novitaReasoningEffortAdapter`.
- **tool calls:** single block, concurrent with reasoning.
- **vision:** ✅ — image-input pipe carries through (suite `vision` green,
  reliably — no MiniMax-style channel dump).
- 🔒 **Privacy:** no — `{ tee: false, zdr: false }`.
- 🕊️ **Freedom (deployment):** `true` — novita routes verbatim. The unknown lives
  on the model axis (Moonshot-PRC), so the composed 🕊️ badge stays *unknown*.
- **Validation (2026-07-18):** core **PASS 44/44** (off + low/medium/high); vision
  **PASS 4/4**.

## Offering — ollama-cloud — `fixed-on` (a policy, not an inability)

Added 2026-07-27 (Chris), the day the open weights dropped. This is the **only**
`fixed-on` in the catalogue that does not describe an upstream refusal: ollama
offers a working off-switch and **we decline to use it**. The reason is measured
below, and it is the interesting part of this route.

- **slug:** `kimi-k3:cloud` · **adapterId:** `ollama-cloud:kimi-k3:cloud` ·
  native `/api/chat` (NDJSON) via `ollamaNativeAdapter`, like every ollama
  offering. Bare `kimi-k3` resolves to an identical `/api/show`; we keep
  `:cloud`, the tag the library page documents (the same situation as GLM 5.2).
- **context:** recommended **262 144** / max **1 048 576** — matching the other
  two K3 routes. `/api/show` reports the 1M ceiling; we still have no
  long-context "stays smart" evidence for K3, so `recommended ≠ max` stands.
- **Access:** ollama serves K3 as **extra usage only** — *"Currently Kimi K3
  requires a Pro or Max subscription, and consumes extra usage credits"*, tier
  *"Extra High Usage"*. With an empty extra-usage balance every request answers
  `this model uses extra usage only … your extra usage balance is empty`, not a
  401 or 404. Worth recognising: it reads like a broken key or a wrong slug.
- **vision:** ✅ — `/api/show` lists `vision`, and the suite's `vision` scenario
  names the colour "green" on the test image. The native adapter already sends
  images as raw base64, so no adapter change was needed.
- **tools:** fire reliably **with reasoning on** (19/20 across three tools);
  arguments arrive atomically, as on every ollama route.
- 🔒 **Privacy:** **no** — `{ tee: false, zdr: false }`. ollama states US/EU
  zero-retention for **GLM 5.2 only**; the K3 library page makes no retention
  statement at all, so nothing is claimed here.
- 🕊️ **Freedom (deployment):** `null` — the provider-wide open question for
  ollama (see [[../providers/ollama-cloud]]). The 🕊️ badge is *unknown* either
  way, because the model axis is `null`.

### The reasoning-off defect that decided the control

`think` on this model is a genuine off — 0 thinking chars in 6/6 runs, and the
answer length is **unchanged** (217 → 211 chars), so the reasoning is not merely
relocating into the content the way GLM 5.2's did. The levels, however, do not
separate: measured 2 reasoning-warranting prompts × 6 values × 3 repetitions,
`max` (248) landed **below** `low` (306) on P1, and the spread within one cell
(514 / 666 / 605) exceeded every difference between cells. So no ladder — the
same discipline that keeps GLM 5.2 at off/on/max, and consistent with the
OpenRouter finding that effort does not modulate K3's trace.

That left a clean `toggle`. What ruled it out is what reasoning-off does to tool
calls (n=5 per cell, 2026-07-27):

| Tool | `think:false` | `think:true` |
|---|---|---|
| `generate_image`, no system prompt | 2/5 | 5/5 |
| `generate_image`, real 3 680-char prompt | 2/5 | 5/5 |
| `calculate_js` | 4/5 | 5/5 |
| `write_memory` | 2/5 | 4/5 |
| **aggregate** | **10/20 (50%)** | **19/20 (95%)** |

The failures are the dangerous kind: the model **narrates the result it never
produced** — *"Got it! I'll remember that you're allergic…"* with no
`write_memory` call, and once a Markdown image link for an image that was never
generated. On `write_memory` this is invisible to the user: the memory is simply
absent while the reply says it was stored. A realistic system prompt does not
rescue it (identical 2/5), so prompt composition is not the lever.

`fixed-on` sets `canDisableReasoning = false`, so `think:false` never reaches
the wire and the cockpit shows reasoning as always-on. **Chris's call,
2026-07-27**, taking the honest-but-broken option off the table rather than
documenting a trap. Revisit if the behaviour changes upstream — re-enabling
costs one line, since the off-switch itself works.

A pleasant side effect: title generation improved from a **644-character**
paragraph to a **24-character** title, because the background-job path now
reasons too.

### The usage gap

**K3 on ollama reports no token counts at all.** No `prompt_eval_count`, no
`eval_count`, on `/api/chat` — non-streaming and streaming alike. It is
model-specific, not a provider regression: glm-5.1, glm-5.2, deepseek-v4-pro and
even **kimi-k2.6** all still report them on the same key, the same day. The `/v1`
shim is worse than silent — it emits `{prompt_tokens: 0, completion_tokens: 0,
total_tokens: 0}`, dressing an absence as a measurement.

Consequences, in order of who cares:

- **Runtime: none today.** The Context-Gauge and the compaction valve run on
  `estimateTokens` client-side, not on provider usage (`chat-page.tsx`), and
  `stream-engine.ts` reads only `reasoningTokens`, for the hidden-reasoning
  marker — which K3 does not need, since it streams its trace. Usage *display*
  is a later slice; when it lands, this model will have nothing to show.
- **Suite: every remaining red is this one cause.** Core 8/11, vision 3/4,
  sampling-cap 1/3 — all six failures are `usage-present` or derived from it.
- **The sampling cap still works**, and had to be proven another way. With
  `usage` unavailable, `done_reason` is the witness: no cap → `stop` at 110
  chars; `options.num_predict: 16` (the shape our adapter sends) → **`length`**
  at 16 chars; top-level `max_tokens: 16` → `stop` at 368 chars, ignored. The
  cap reaches the wire; only its *verification through usage* is impossible.

The offering is kept at `confidence: 'verified'`: everything measurable was
measured live, and the one gap is an upstream absence recorded here rather than
a claim we could not test.

## Validation (2026-07-16, live conversation-suite)

Run via `curation/run-openrouter-suite.ts kimi-k3` (`makeLiveBinding`,
`keys/.or-test-key`, direct routing):

- **Core scenario:** **PASS 11/11** — reasoning-on (reasoning present on the
  `reasoning` channel, no HTTP/stream error, usage normalised), `generate_image`
  fires with valid JSON args, memory token ("cat") carried through and echoed.
  Only the reasoning-**on** permutation runs (`fixed-on` has no off to assert
  absent).
- **Vision scenario:** **PASS 4/4** — image carried through, "green" named, usage
  present.
- One transient HTTP 429 on the first attempt retried green (Moonshot capacity;
  same class as the historical Gemma 429).
