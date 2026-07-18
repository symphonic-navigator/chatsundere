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
Chris values). Two routes are now curated: Moonshot's own API via **OpenRouter**
(the original, `fixed-on`) and **novita** (added 2026-07-18, `steps` with a real
off). novita reports a native 1M window and full text+image vision.

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
