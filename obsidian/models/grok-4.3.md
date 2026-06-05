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

The single first-class xAI model we curate. Grok 4.20 is deliberately excluded —
its multi-agent value requires orchestration machinery Chatsundere does not support;
4.3 is the smaller-but-smoother, more popular choice.

## Offering — xAI

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
