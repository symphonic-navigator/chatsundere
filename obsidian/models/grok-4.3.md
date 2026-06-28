# Model Curation Record — Grok 4.3

> Curation record. See [[../providers/xai]] for the shared xAI mechanics.

- **Identity:** Grok 4.3 · family `grok`
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅ (input image; output text-only)
- **replayReasoning:** false — reasoning streams as a **summarised** human-readable
  form on `delta.reasoning_content`. There is no opaque encrypted blob on the Chat
  Completions surface (encrypted_content is Responses-API-only, which we do not
  use). Nothing to replay → display-only, `replayReasoning: false`.
- **🕊️ Freedom:** free — `freedomOriented: true`, `freedomOrientedDeployment: true`
  (Chris, 2026-06-02: xAI/Grok refuses near-nothing despite Californian HQ).

Curated on **three deployments**: xAI-direct, nano-gpt, and OpenRouter. The
OpenRouter route is the **ZDR** route (see below). Its sibling [[grok-4.20]] was
added in the same 2026-06-28 round (the earlier "4.20 excluded" framing was a
misread — see that record).

## Offering — xAI (direct)

- **slug:** `grok-4.3` · **adapterId:** `xai:grok-4.3`
- **context:** recommended **200 000** / max **1 000 000**. Above 200k xAI roughly
  doubles the price — "compact and continue" rather than enter the expensive band;
  the gauge reads recommended (Chris, 2026-06-02).
- **reasoning control:** native `reasoning_effort` param — **no slug swap**. Values:
  `none` (off), `low` (xAI default), `medium`, `high`. Modelled as `steps`
  (`offStep: 'none'`, `steps: ['low','medium','high']`, `defaultStep: 'low'`).
  Reasoning is **default-on** at effort `low`.
- **tool calls:** streaming, concurrent with reasoning.
- **vision:** ✅ (in scope — strong user demand; Grok's vision is good).
- 🔒 **Privacy:** no TEE / no ZDR (US jurisdiction, today). See [[../providers/xai]]
  for the future NGO-negotiated ZDR possibility.
- **Freedom:** `freedomOrientedDeployment: true`.
- **confidence:** `verified` — `run-xai-suite.ts` passed live on 2026-06-02
  (core 44/44 + vision 4/4, 0 fail).

## Offering — OpenRouter (🔒 ZDR)

- **slug:** `x-ai/grok-4.3` · **adapterId:** `openrouter:x-ai/grok-4.3`
- **context:** recommended **200 000** / max **1 000 000** (OpenRouter reports a
  1M ceiling; recommended stays at our 200k sweet-spot — xAI roughly doubles the
  price above 200k).
- **reasoning control:** unified `reasoning` object — `{enabled:true,effort}` on,
  `{enabled:false}` a **genuine off** (0 reasoning tokens, probed 2026-06-28).
  Modelled as a `toggle` (defaultOn), consistent with the other OpenRouter
  offerings — OpenRouter is the portable on/off surface, not Grok's native
  effort steps.
- **tool calls:** streamed **fragmented** (reassembled by the adapter), concurrent
  with reasoning.
- **vision:** ✅.
- 🔒 **Privacy: ZDR.** `trust: { tee: false, zdr: true, jurisdiction: 'US' }`. The
  adapter sends `provider: { zdr: true }` on every request, so OpenRouter routes
  **only** to xAI's Zero-Data-Retention endpoint (probed 2026-06-28: HTTP 200,
  `provider: "xAI"`). **This is the privacy route for Grok** — xAI-direct offers
  no ZDR today. See [[../providers/openrouter]] for the ZDR mechanics and the
  fail-closed evidence.
- **Freedom:** `freedomOrientedDeployment: true`.
- **confidence:** `verified` — `run-grok-suite.ts` 2026-06-28: core 22/22 +
  vision 4/4, 0 fail (ZDR enforced on the wire).

## Offering — nano-gpt

- **slug:** `x-ai/grok-4.3` · **adapterId:** `nano-gpt:x-ai/grok-4.3`
- **context:** recommended **200 000** / max **1 000 000**.
- **reasoning control:** the OpenAI-style `reasoning` **object** —
  `{enabled:false}` is a genuine off (probed 2026-06-28). Note the trap:
  `reasoning_effort: none` does **not** disable it on nano-gpt (it keeps
  reasoning), so the offering reuses the unified reasoning-object adapter, not the
  slug-swap one. `toggle` (defaultOn).
- **tool calls:** single-block (`streaming: false`), concurrent with reasoning.
- **vision:** ✅.
- 🔒 **Privacy:** no TEE / no ZDR (routes to the xAI upstream, US jurisdiction).
- **Freedom:** `freedomOrientedDeployment: true` (nano-gpt adds no censorship).
- **confidence:** `verified` — `run-grok-suite.ts` 2026-06-28: core 22/22 +
  vision 4/4, 0 fail.

## Reasoning — empirical findings (probed 2026-06-02)

On `/chat/completions`, `reasoning_content` streams as a **summarised** form
already — a request burning 270 `reasoning_tokens` returned a one-sentence
`reasoning_content`. It is human-readable; there is no opaque encrypted blob
on this surface. This differs from what some xAI docs imply about
`encrypted_content` — that field is Responses-API-only, which Chatsundere does
not use (completions-not-responses rule). Reasoning is therefore display-only;
`replayReasoning: false` is correct and consistent with Chris's "encrypted-only
replay" decision resolving to "no replay" since no blob exists.

## Usage shape (probed 2026-06-02)

OpenAI-standard envelope:

| Field | Meaning |
|---|---|
| `prompt_tokens` | input tokens |
| `completion_tokens` | output tokens, **excluding** reasoning tokens |
| `total_tokens` | prompt + completion + reasoning (i.e. **includes** reasoning) |
| `prompt_tokens_details.text_tokens` | text portion of prompt |
| `prompt_tokens_details.image_tokens` | image portion of prompt |
| `prompt_tokens_details.cached_tokens` | cache hits (per `x-grok-conv-id`) |
| `completion_tokens_details.reasoning_tokens` | reasoning token count |

Note: `total_tokens` already includes reasoning tokens; `completion_tokens`
does **not**. Adapter normalises to `NormalisedUsage` with `reasoningTokens` and
`cachedTokens` populated.

## SSE flow

Delta chunks → finish-reason chunk → usage-only chunk (`choices: []`) → `[DONE]`.
Usage is delivered on the final `choices: []` chunk when `stream_options: {
include_usage: true }` is set.

## Validation

Live suite (`run-xai-suite.ts`): **PASS** — run on 2026-06-02 against
`api.x.ai/v1` (core scenario 44/44 checks, vision scenario 4/4 checks, 0 fail).
Confirmed:
1. Reasoning **off** (`none`) → `reasoning-absent` green (no trace leak — Grok's
   `none` is a genuine off, NOT the wafer/Kimi `fixed-on` failure mode).
2. Effort `low` / `medium` / `high` → `reasoning-present` green (trace + answer).
3. **Vision** → test image described correctly.
4. **Tools** → `generate_image` fires and reassembles from fragmented streaming args.
5. **Memory/recall** → prior turn recalled correctly.
6. **Caching** → `cachedTokens` populated on a repeated `x-grok-conv-id` turn.
